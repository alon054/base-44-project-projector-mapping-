/**
 * The Lottie layer view (§5, I-2, I-13).
 *
 * §5: "**lottie-web** → rendered to a texture. Editable in place at runtime
 * (color/speed/parts). **Cost:** re-renders on the main thread every frame.
 * Every on-screen Lottie is an active CPU cost. Cap the count."
 *
 * **The player is driven by the clock, never by its own timeline.** lottie-web
 * will happily run itself off `requestAnimationFrame`; that is a second time
 * source and I-2 forbids it. So the player is created with `autoplay: false`
 * and every frame we compute `goToAndStop(phase * totalFrames, true)` from the
 * global clock. A paused clock therefore freezes the Lottie in the same frame
 * as everything else — not because we remembered to pause it, but because the
 * number it is told stops changing.
 *
 * That also makes the scrub condition free: `goToAndStop` at a derived frame
 * has no history, so a Lottie and a sprite sheet of different lengths land
 * where the arithmetic puts them after any scrub.
 *
 * **No seam crossfade, and that is a decision rather than an omission.** The
 * two-copy crossfade in `seam.ts` needs the animation drawn at two phases in
 * the same frame, and a canvas-rendered Lottie has exactly one canvas — the
 * second phase would mean a second player and a second main-thread re-render.
 * §5 says every on-screen Lottie is an active CPU cost and to cap the count;
 * doubling it silently to smooth a seam would spend that cap on the wrong
 * thing. The authored asset is seamless by construction instead, which is D5's
 * other sanctioned route ("filtering to seamless assets").
 *
 * **Canvas renderer, into a Pixi texture.** The SVG renderer would build a DOM
 * subtree per animation and composite it in the browser, which is pixels paid
 * for twice and unreachable from the warp stage (I-5 needs the composite in one
 * render target). Canvas gives one `HTMLCanvasElement` we upload as a texture.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import type { AnimationItem, LottiePlayer } from 'lottie-web';
import type { LottieAsset } from '../../core/library';
import type { LayerFrame, LayerView } from '../ContentProvider';
import { createPlaceholderGraphic } from '../../render/placeholder';
import { phaseAt } from '../../core/clock';

/**
 * THE LIGHT CANVAS BUILD, LOADED LAZILY. Two separate decisions.
 *
 * **Why that build.** The default `lottie-web` entry evaluates Lottie
 * *expressions* with a direct `eval`, and this app runs a hardened CSP with no
 * 'unsafe-eval' — the same constraint that makes `render/host.ts` import
 * `pixi.js/unsafe-eval`. The full build's eval is reachable only from
 * expression-bearing animations, so it would have loaded fine and then failed
 * on somebody's downloaded LottieFile in Phase 8, which is the worst possible
 * moment to discover it. `lottie_light_canvas` contains zero `eval(` — checked
 * against the file, not assumed — and drops the SVG and HTML renderers.
 *
 * **Why lazily.** lottie-web calls `document.createElement` at module scope. A
 * static import therefore made every module that could reach this one require a
 * DOM — including `core/defaultScene.ts`, by way of a provider-id constant —
 * and three unit-test files that had never heard of Lottie failed to load with
 * `ReferenceError: document is not defined`. SPEC.md §8.1 says the unit suite
 * is "pure logic, no GPU"; a scene model that cannot be constructed without a
 * browser is not that. Running those tests in a DOM environment instead would
 * have hidden the coupling rather than removed it.
 *
 * It also means a scene with no Lottie layer never parses ~300 KB it will not
 * use, which is the spirit of §5's "cap the count".
 */
let lottie: LottiePlayer | null = null;
let lottieLoading: Promise<void> | null = null;

/**
 * Loads the player. Idempotent, and safe to call before it is needed.
 *
 * Callers that want the FIRST Lottie layer to render without a frame of
 * placeholder — the golden harness, and the render host at startup — await this
 * up front. A view created before it resolves shows its I-13 placeholder and
 * swaps in afterwards, which is the same populate-yourself contract every other
 * view in this directory follows (I-3).
 */
export async function ensureLottie(): Promise<void> {
  if (lottie) return;
  lottieLoading ??= import('lottie-web/build/player/esm/lottie_light_canvas.min.js').then((m) => {
    lottie = m.default;
  });
  return lottieLoading;
}

export interface LottieViewOptions {
  asset: LottieAsset;
  width: number;
  height: number;
  /**
   * The offscreen canvas edge, in pixels. §5 caps Lottie in the preview ("at
   * reduced size, capped"), and this is the knob that does it — a preview
   * Lottie at output resolution would be the same main-thread cost twice.
   */
  resolution: number;
  onFailed?: (reason: string) => void;
}

export function createLottieView(opts: LottieViewOptions): LayerView {
  const { asset } = opts;
  const view = new Container();
  const a = new Sprite();
  a.visible = false;
  const ph = createPlaceholderGraphic({
    layerId: asset.id,
    layerName: asset.name,
    providerId: 'bundled',
    reason: 'loading lottie',
  });
  view.addChild(ph.view, a);

  let w = opts.width;
  let h = opts.height;
  let destroyed = false;
  let anim: AnimationItem | null = null;
  let texture: Texture | null = null;
  let totalFrames = 0;
  let lastFrame = -1;
  const canvas = document.createElement('canvas');
  canvas.width = opts.resolution;
  canvas.height = opts.resolution;

  ph.draw(w, h);

  const layout = (): void => {
    ph.draw(w, h);
    const scale = Math.min(w / canvas.width, h / canvas.height);
    a.width = canvas.width * scale;
    a.height = canvas.height * scale;
    a.position.set((w - a.width) / 2, (h - a.height) / 2);
  };

  const fail = (reason: string): void => {
    if (destroyed) return;
    // I-13. A Lottie has no poster rung — there is no still to fall back to —
    // so the chain for this kind is content, then placeholder.
    a.visible = false;
    ph.view.visible = true;
    opts.onFailed?.(reason);
  };

  // Loaded synchronously from the asset's own data. This used to `fetch(url)`,
  // which worked in dev and failed in the built app: the bundler inlines a
  // small asset as a `data:` URI and `fetch()` on one is a `connect-src`
  // violation under this app's hardened CSP. The run log caught it on the first
  // launch of the Phase 3 scene.
  //
  // Still wrapped, and still ending at an I-13 placeholder rather than a throw:
  // `loadAnimation` on a malformed animation throws, and by Phase 8 this data
  // will be arriving from a catalog rather than from the build.
  const build = (): void => {
    const player = lottie;
    if (!player || destroyed) return;
    try {
    // NO `container`, and that is load-bearing rather than an omission.
    //
    // `CanvasRendererBase.prototype.configAnimation` branches on it:
    //
    //     if (this.animationItem.wrapper) { ...create our own canvas... }
    //     else { this.canvasContext = this.renderConfig.context; }
    //
    // A container — even a detached one passed only to satisfy the type —
    // makes lottie build a canvas of its own and IGNORE `context`, so our
    // texture stays blank forever. The golden frame for this case came back
    // as an empty rectangle, which is exactly how that failure presents: no
    // error, no placeholder, nothing drawn.
    //
    // With no wrapper, `updateContainerSize` also takes its dimensions from
    // `this.canvasContext.canvas.width/height` — our 256 px canvas — rather
    // than from a detached element's `offsetWidth` of 0.
    //
    // The cast is because the published type marks `container` required for
    // every renderer, which is true of the SVG and HTML ones and not of this
    // path.
    anim = player.loadAnimation<'canvas'>({
      renderer: 'canvas',
      // I-2: no autoplay, no internal timeline. See this file's header.
      loop: false,
      autoplay: false,
      animationData: asset.data,
      rendererSettings: {
        context: canvas.getContext('2d') as CanvasRenderingContext2D,
        clearCanvas: true,
        preserveAspectRatio: 'xMidYMid meet',
      },
    } as unknown as Parameters<typeof player.loadAnimation<'canvas'>>[0]);
    totalFrames = anim.totalFrames;
    if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
      fail('lottie reported no frames');
    } else {
      texture = Texture.from(canvas);
      a.texture = texture;
      a.visible = true;
      ph.view.visible = false;
      layout();
    }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  };

  if (lottie) build();
  else void ensureLottie().then(build).catch((e: unknown) => fail(String(e)));

  return {
    view,
    update: (frame: LayerFrame) => {
      const player = anim;
      if (!player || !texture) return;
      const phase = phaseAt(frame.timeSeconds * 1000, asset.loopSeconds);

      // `totalFrames - 1` is the last addressable frame; `phase * totalFrames`
      // would ask for one past the end at the very top of the loop.
      const target = Math.min(totalFrames - 1, phase * totalFrames);
      const rounded = Math.round(target * 100) / 100;
      if (rounded !== lastFrame) {
        // The `true` is "this is a frame number, not a time" — the overload
        // that takes seconds would re-introduce a second notion of time.
        player.goToAndStop(rounded, true);
        lastFrame = rounded;
        // The canvas changed under the texture; Pixi has no way to know.
        texture.source.update();
      }
    },
    resize: (nw, nh) => {
      w = nw;
      h = nh;
      layout();
    },
    destroy: () => {
      destroyed = true;
      anim?.destroy();
      anim = null;
      texture?.destroy(true);
      texture = null;
      view.destroy({ children: true });
    },
  };
}
