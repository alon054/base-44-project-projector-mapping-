/**
 * The video layer view (D5, I-7, I-13, §5).
 *
 * Three separate requirements meet in this file and it is worth naming them
 * apart, because each one alone would suggest a simpler design that the other
 * two forbid.
 *
 * **D5 — phase alignment at loop boundaries, not per frame.** The clock is
 * authoritative (I-2), but a `<video>` cannot be seeked to an arbitrary time
 * every frame without visible stutter. So the element free-runs and is realigned
 * only when the clock's phase wraps. A scrub does not seek; it lands at the
 * *next* boundary, which is exactly how Gate 3 words it. The state machine is
 * in `videoSync.ts`, pure, so it can be tested without a decoder.
 *
 * **§5 / A2 — the preview does not decode.** "Video layers render in the
 * preview as their poster frame plus a badge." That is load-bearing, not tidy:
 * TARGET_MACHINE has 16 GB shared between CPU and GPU, and a second decoder
 * spends that pool twice for a preview nobody projects. `decode: false` is how
 * the preview asks for the poster, and there is no code path by which a preview
 * host creates a `<video>` at all.
 *
 * **I-13 — the fallback chain is poster, then placeholder.** "A video that
 * fails to decode falls back to its poster frame, then to the placeholder."
 * Both rungs matter and they are different failures: a decode error with a good
 * poster leaves something on the wall that looks deliberate, while a decode
 * error with a *bad* poster must still not be a black rectangle. The chain
 * never throws — by the time a decoder fails, no frame is inside `create`, so
 * there is nothing for `isolateCreate` to catch.
 */
import { Assets, Container, Sprite, Texture, Text } from 'pixi.js';
import type { VideoAsset } from '../../core/library';
import type { LayerFrame, LayerView } from '../ContentProvider';
import { createPlaceholderGraphic } from '../../render/placeholder';
import { phaseAt } from '../../core/clock';
import { createVideoSyncState, noteScrub, stepVideoSync } from './videoSync';
import {
  decoderAction,
  decoderShouldRun,
  resolveVideoStage,
  type VideoStage,
  type VideoStageInput,
} from './videoStage';

// The chain itself lives in `videoStage.ts`, pure, and is tested as a table —
// see that file for why the ORDER the two loads settle in must not matter.
export type { VideoStage } from './videoStage';

export interface VideoViewOptions {
  asset: VideoAsset;
  width: number;
  height: number;
  /** False in the editor preview (§5/A2). No `<video>` is created at all. */
  decode: boolean;
  /** Emitted once per stage change, never per frame. */
  onStage?: (stage: VideoStage, detail: string) => void;
}

function fitCover(sprite: Sprite, w: number, h: number, texW: number, texH: number): void {
  if (texW <= 0 || texH <= 0 || w <= 0 || h <= 0) return;
  // COVER, not contain: a video layer is a full-frame background (D7's
  // "use video mainly for full-frame backgrounds"), and letterboxing it inside
  // its own box would put black bars in the middle of a projection.
  const scale = Math.max(w / texW, h / texH);
  sprite.width = texW * scale;
  sprite.height = texH * scale;
  sprite.position.set((w - sprite.width) / 2, (h - sprite.height) / 2);
}

export function createVideoView(opts: VideoViewOptions): LayerView {
  const { asset, decode } = opts;
  const view = new Container();
  const poster = new Sprite();
  const video = new Sprite();
  poster.visible = false;
  video.visible = false;

  const ph = createPlaceholderGraphic({
    layerId: asset.id,
    layerName: asset.name,
    providerId: 'bundled',
    reason: 'loading video',
  });

  /** §5's badge. Only in the preview, and only once a poster is showing. */
  const badge = new Text({
    text: '▶ live in output',
    style: { fontFamily: 'monospace', fontSize: 13, fill: 0xffffff },
  });
  badge.visible = false;
  badge.alpha = 0.85;

  view.addChild(ph.view, poster, video, badge);

  let w = opts.width;
  let h = opts.height;
  let posterW = 0;
  let posterH = 0;
  let videoW = 0;
  let videoH = 0;
  let destroyed = false;
  let stage: VideoStage = 'loading';
  let el: HTMLVideoElement | null = null;
  let videoTexture: Texture | null = null;
  const sync = createVideoSyncState();

  /**
   * The facts. The STAGE is derived from these and never assigned directly, so
   * the order the poster and the decoder settle in cannot change where the
   * layer ends up (I-13; see `videoStage.ts`).
   */
  const facts: VideoStageInput = {
    decoding: decode,
    decoded: false,
    decodeFailed: false,
    hasPoster: false,
    posterFailed: false,
  };

  ph.draw(w, h);

  /** Record a fact, re-derive the stage, and log only when it actually moved. */
  const note = (change: Partial<VideoStageInput>, detail: string): void => {
    if (destroyed) return;
    Object.assign(facts, change);
    const next = resolveVideoStage(facts);
    if (next === stage) return;
    stage = next;
    ph.view.visible = next === 'placeholder' || next === 'loading';
    poster.visible = next === 'poster';
    video.visible = next === 'playing';
    badge.visible = !decode && next === 'poster';
    // A placeholder is drawn at full strength; there is nothing behind it.
    ph.view.alpha = 1;
    opts.onStage?.(next, detail);
  };

  const layout = (): void => {
    ph.draw(w, h);
    fitCover(poster, w, h, posterW, posterH);
    fitCover(video, w, h, videoW, videoH);
    badge.position.set(Math.min(10, w * 0.04), Math.min(10, h * 0.04));
  };

  // The poster first, always — including in the output window. It is what is on
  // the wall during the decoder's first few hundred milliseconds, and it is the
  // fallback if the decode never succeeds.
  void Assets.load<Texture>(asset.posterUrl)
    .then((tex) => {
      if (destroyed) return;
      poster.texture = tex;
      posterW = tex.width;
      posterH = tex.height;
      layout();
      // A poster that arrives after the decoder already failed still rescues
      // the layer. Nothing here checks the current stage — the resolver does.
      note({ hasPoster: tex.width > 0 && tex.height > 0 }, 'poster ready');
    })
    .catch(() => {
      // Poster gone. Whether that is the END of the chain depends on the
      // decoder, which the resolver knows about and this callback does not.
      note({ posterFailed: true }, 'poster failed to load');
    });

  if (decode) {
    el = document.createElement('video');
    el.src = asset.url;
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    // Never in the DOM. An attached element would be composited by the browser
    // as well as sampled by us, which is the same pixels paid for twice.
    el.crossOrigin = 'anonymous';

    // I-13: never a throw, and never a black rectangle. Which rung this lands
    // on is the resolver's decision, not this callback's.
    const fail = (detail: string): void => note({ decodeFailed: true }, detail);

    el.addEventListener('error', () => {
      const code = el?.error?.code;
      fail(`decode failed (MediaError ${code ?? 'unknown'})`);
    });
    el.addEventListener('stalled', () => {
      // Not a failure on its own — a stall recovers. Recorded, not acted on.
      opts.onStage?.(stage, 'stalled');
    });
    el.addEventListener('loadeddata', () => {
      if (destroyed || !el) return;
      videoW = el.videoWidth;
      videoH = el.videoHeight;
      if (videoW === 0 || videoH === 0) {
        fail('decoded to a zero-sized frame');
        return;
      }
      videoTexture = Texture.from(el);
      video.texture = videoTexture;
      layout();
      note({ decoded: true }, `decoding ${videoW}x${videoH}`);
    });
    // A rejected play() is not fatal — the element may still be primed and the
    // poster is already on the wall.
    void el.play().catch(() => {
      /* handled by the error listener, or recovered by the clock below */
    });
  } else {
    // Preview (§5/A2). No element, no decoder, no second copy of the frame
    // pool. The poster load above is the whole of this layer's cost, and
    // `decoding: false` is already in `facts` — the resolver will settle on
    // the poster the moment it arrives.
    opts.onStage?.('loading', 'preview: poster only, no decode');
  }

  return {
    view,
    update: (frame: LayerFrame) => {
      if (!el || stage !== 'playing') return;

      // The clock decides whether the decoder runs at all. This is what makes
      // Gate 3's "video pauses too, at frame granularity" true: `pause()` holds
      // the frame the decoder is on, it does not blank or drift.
      // ONE decision, applied once. This used to be two independent `if`s and
      // they fought: at rate 0 the first resumed a paused element and the
      // second paused a running one, sixty times a second. See
      // `decoderAction` for how that was found.
      //
      // Logged on the TRANSITION, never per frame. `[scene]`, `[warp]` and
      // `[clock]` between them found most of this project's defects, and "did
      // the decoder actually obey the clock" is exactly the kind of question
      // that is unanswerable from a still photograph of a wall.
      const decode = decoderAction(frame.playing, frame.rate, el.paused);
      if (decode === 'run') {
        opts.onStage?.(stage, 'decoder resumed');
        void el.play().catch(() => {});
      } else if (decode === 'hold') {
        // Gate 3: "video pauses too, at frame granularity". The time is
        // reported because that is the claim — the decoder holds the frame it
        // is on; it does not drift, blank, or keep running.
        const why = frame.playing ? 'rate 0' : 'clock paused';
        opts.onStage?.(stage, `decoder HELD at ${el.currentTime.toFixed(3)}s (${why})`);
        el.pause();
      }
      if (decoderShouldRun(frame.playing, frame.rate)) {
        const wanted = clampRate(frame.rate);
        if (el.playbackRate !== wanted) el.playbackRate = wanted;
      }

      // D5: realign only at a loop boundary. A scrub arms the resync and the
      // element carries on until the boundary arrives.
      noteScrub(sync, frame.scrubSeq);
      const phase = phaseAt(frame.timeSeconds * 1000, asset.loopSeconds);
      const action = stepVideoSync(sync, phase, el.duration);
      if (action.kind === 'seek') {
        // `fastSeek` where available: an exact seek decodes back to the
        // preceding keyframe and is the stutter D5 is avoiding.
        if (typeof el.fastSeek === 'function') el.fastSeek(action.timeSeconds);
        else el.currentTime = action.timeSeconds;
      }
    },
    resize: (nw, nh) => {
      w = nw;
      h = nh;
      layout();
    },
    destroy: () => {
      destroyed = true;
      if (el) {
        el.pause();
        // Emptying the src is what actually releases the decoder. Dropping the
        // reference alone leaves it alive until GC, and §4's texture-memory
        // soak would see it.
        el.removeAttribute('src');
        el.load();
        el = null;
      }
      videoTexture?.destroy(true);
      videoTexture = null;
      view.destroy({ children: true });
    },
  };
}

/** Media elements reject absurd rates; the clock's range is wider than theirs. */
function clampRate(rate: number): number {
  return rate < 0.0625 ? 0.0625 : rate > 16 ? 16 : rate;
}
