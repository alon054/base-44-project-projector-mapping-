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

/** What the view is currently showing. Reported to the HUD and the log. */
export type VideoStage = 'loading' | 'poster' | 'playing' | 'placeholder';

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

  ph.draw(w, h);

  const setStage = (next: VideoStage, detail: string): void => {
    if (stage === next) return;
    stage = next;
    ph.view.visible = next === 'placeholder' || next === 'loading';
    poster.visible = next === 'poster' || (next === 'placeholder' && posterW > 0);
    video.visible = next === 'playing';
    badge.visible = !decode && next === 'poster';
    // I-13's second rung, made explicit: a decode failure with a usable poster
    // is NOT a placeholder, it is a poster. Only a failure with no poster
    // either falls all the way through.
    if (next === 'placeholder' && posterW > 0) {
      poster.visible = true;
      ph.view.alpha = 0.55;
    }
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
      // the layer: I-13's chain is poster THEN placeholder, and which rung the
      // layer lands on does not depend on which load finished first.
      if (stage === 'loading' || stage === 'placeholder') {
        setStage('poster', 'poster ready');
      }
    })
    .catch(() => {
      if (destroyed) return;
      // Poster gone too. The placeholder is the whole of the chain that is
      // left, and it is why the chain has three rungs and not two.
      setStage('placeholder', 'poster failed to load');
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

    const fail = (detail: string): void => {
      if (destroyed) return;
      // I-13: poster if we have one, placeholder if we do not. Never a throw,
      // and never a black rectangle.
      setStage(posterW > 0 ? 'poster' : 'placeholder', detail);
    };

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
      setStage('playing', `decoding ${videoW}x${videoH}`);
    });
    // A rejected play() is not fatal — the element may still be primed and the
    // poster is already on the wall.
    void el.play().catch(() => {
      /* handled by the error listener, or recovered by the clock below */
    });
  } else {
    // Preview (§5/A2). No element, no decoder, no second copy of the frame
    // pool. The poster load above is the whole of this layer's cost.
    setStage('loading', 'preview: poster only, no decode');
  }

  return {
    view,
    update: (frame: LayerFrame) => {
      if (!el || stage !== 'playing') return;

      // The clock decides whether the decoder runs at all. This is what makes
      // Gate 3's "video pauses too, at frame granularity" true: `pause()` holds
      // the frame the decoder is on, it does not blank or drift.
      if (frame.playing) {
        if (el.paused) void el.play().catch(() => {});
        // Rate 0 is a held frame, and asking a decoder for playbackRate 0 is
        // an error in some engines. Pause it instead — same result on the wall.
        if (frame.rate <= 0) el.pause();
        else if (el.playbackRate !== frame.rate) el.playbackRate = clampRate(frame.rate);
      } else if (!el.paused) {
        el.pause();
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
