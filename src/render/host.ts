/**
 * Pixi application host, shared by the output window and the editor preview at
 * different sizes (I-7: separate render targets, same scene model).
 *
 * The frame ticker here is Phase 0 scaffolding and is DELETED in Phase 3 when
 * `core/clock.ts` (I-2) lands. Permitted by SPEC.md §0.2, "when an invariant
 * starts applying". Phase 1 replaced the test pattern with the compositor but
 * deliberately left the ticker alone — it is the other half of that same
 * sanctioned exception, and it dies on schedule.
 */
// A hardened CSP (no 'unsafe-eval') forbids the `new Function` that Pixi v8
// uses to generate shader/uniform sync code. This side-effect import installs
// Pixi's interpreted polyfills instead. It must precede `Application.init`.
// Cost is measured, not assumed — see BUILD_LOG.md.
import 'pixi.js/unsafe-eval';
import { Application } from 'pixi.js';
import { DEV_RESOLUTION, TARGET_RESOLUTION, type KReport, type ScaleReport } from '@shared/ipc';
import { FrameMetrics } from '../debug/hud';
import { runRenderMultiplierProbe } from '../debug/probe';
import { createDefaultScene } from '../core/defaultScene';
import type { Scene } from '../core/scene';
import type { PlaceholderInfo } from '../core/resilience';
import { ProviderRegistry } from '../providers/ContentProvider';
import { ProceduralProvider } from '../providers/procedural/ProceduralProvider';
import { Compositor } from './compositor';

export interface RenderHostOptions {
  parent: HTMLElement;
  width: number;
  height: number;
  nominalMs: number;
  /** Called on the frame after a pending change has been presented. */
  onPresented?: (token: number, t0: number) => void;
  /** I-13: a layer failed and is showing a placeholder. Once per failure. */
  onLayerFailed?: (info: PlaceholderInfo, error: unknown) => void;
}

export interface RenderHost {
  readonly metrics: FrameMetrics;
  setSpeed(v: number): void;
  /** Replaces the whole layer stack. Operator-paced, never per-frame. */
  setScene(scene: Scene): void;
  /** I-13: layers currently showing a placeholder. */
  failures(): PlaceholderInfo[];
  markPending(token: number, t0: number): void;
  setNominalMs(ms: number): void;
  resize(width: number, height: number): void;
  /** A3: current backing-store vs CSS geometry, so a scaler cannot hide. */
  scaleReport(): ScaleReport;
  /** A8: run the render-multiplier probe. Hitches by design; resets metrics. */
  probe(order?: 'dev-first' | 'target-first'): KReport;
  destroy(): void;
}

const LOOP_SECONDS = 4;

export async function createRenderHost(opts: RenderHostOptions): Promise<RenderHost> {
  const app = new Application();
  await app.init({
    width: opts.width,
    height: opts.height,
    background: 0x000000,
    antialias: false,
    // WebGL is the ship target; WebGPU is an experimental opt-in only (SPEC.md §5).
    preference: 'webgl',
    // Backing store is exactly width x height regardless of the display's DPR.
    // Without this, a Retina display would silently give us a 2x buffer and
    // every §4 number would describe a different pixel count than DEV_RESOLUTION.
    resolution: 1,
    autoDensity: false,
    // We drive our own loop so gate metric 2 can time `render()` precisely.
    autoStart: false,
    sharedTicker: false,
  });

  const canvas = app.canvas;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.imageRendering = 'pixelated';
  opts.parent.appendChild(canvas);

  const providers = new ProviderRegistry();
  providers.register(new ProceduralProvider());

  const compositor = new Compositor({
    providers,
    width: opts.width,
    height: opts.height,
    ...(opts.onLayerFailed ? { onLayerFailed: opts.onLayerFailed } : {}),
  });
  app.stage.addChild(compositor.view);
  compositor.setScene(createDefaultScene());

  const metrics = new FrameMetrics(opts.nominalMs);

  let speed = 1;
  let phase = 0;
  let lastTick: number | null = null;
  let renderedPending: { token: number; t0: number } | null = null;
  let pending: { token: number; t0: number } | null = null;
  let raf = 0;
  let alive = true;

  /**
   * A3: scaleFactor is a first-class concern from Phase 0. The internal display
   * is 2x and the projector 1x, so "the canvas is 1280x720" says nothing on its
   * own about what reaches the panel. This is the same subject as the
   * two-scaler problem — stated and checked rather than discovered on a wall.
   */
  let scaleCache: ScaleReport | null = null;
  const readScale = (): ScaleReport => {
    // A14: `getBoundingClientRect()` forces a synchronous layout. Calling it on
    // the 250 ms metrics tick put a forced reflow on the render thread four
    // times a second, for a value that only changes on resize. Cached.
    if (scaleCache) return scaleCache;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.round(rect.width);
    const cssHeight = Math.round(rect.height);
    const dpr = window.devicePixelRatio;
    const next: ScaleReport = {
      bufferWidth: app.renderer.width,
      bufferHeight: app.renderer.height,
      cssWidth,
      cssHeight,
      dpr,
      oneToOne:
        cssWidth > 0 &&
        cssHeight > 0 &&
        Math.abs(cssWidth * dpr - app.renderer.width) < 1 &&
        Math.abs(cssHeight * dpr - app.renderer.height) < 1,
    };
    scaleCache = next;
    return next;
  };
  const invalidateScale = (): void => {
    scaleCache = null;
  };
  window.addEventListener('resize', invalidateScale);
  metrics.setScale(readScale());

  const loop = (now: number): void => {
    if (!alive) return;

    // Ack one frame after the change was actually rendered, so the number
    // describes something that has been presented, not merely submitted.
    if (renderedPending) {
      opts.onPresented?.(renderedPending.token, renderedPending.t0);
      renderedPending = null;
    }

    // --- Phase 0 throwaway ticker. Deleted in Phase 3 (I-2). -----------------
    const dt = lastTick === null ? 0 : (now - lastTick) / 1000;
    lastTick = now;
    phase = (phase + (dt * speed) / LOOP_SECONDS) % 1;
    // ------------------------------------------------------------------------

    compositor.update({ phase });

    const t0 = performance.now();
    app.renderer.render(app.stage);
    const t1 = performance.now();
    metrics.noteRenderDuration(t1 - t0);
    metrics.notePresentation(now);
    // A14: one extra clock read per frame buys the instrument's own per-frame
    // cost as a reported number instead of an inference from a later stall.
    metrics.noteInstrumentCost(performance.now() - t1);

    if (pending) {
      renderedPending = pending;
      pending = null;
    }

    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    metrics,
    setSpeed(v) {
      speed = v;
    },
    setScene(scene) {
      compositor.setScene(scene);
    },
    failures() {
      return compositor.failures();
    },
    markPending(token, t0) {
      pending = { token, t0 };
    },
    setNominalMs(ms) {
      metrics.setNominalMs(ms);
    },
    resize(width, height) {
      app.renderer.resize(width, height);
      compositor.resize(width, height);
      invalidateScale();
      metrics.setScale(readScale());
    },
    scaleReport: readScale,
    probe(order = 'dev-first' as 'dev-first' | 'target-first') {
      const k = runRenderMultiplierProbe(app.renderer, app.stage, {
        nominalMs: metrics.nominal,
        dev: DEV_RESOLUTION,
        target: TARGET_RESOLUTION,
        order,
      });
      metrics.setK(k);
      // The probe deliberately saturates the GPU. Anything measured across it
      // is not a gate number, so the window restarts rather than carrying the
      // hitch the instrument itself caused.
      metrics.reset();
      return k;
    },
    destroy() {
      alive = false;
      window.removeEventListener('resize', invalidateScale);
      cancelAnimationFrame(raf);
      compositor.destroy();
      app.destroy(true, { children: true });
    },
  };
}
