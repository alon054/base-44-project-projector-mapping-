/**
 * Pixi application host, shared by the output window and the editor preview at
 * different sizes (I-7: separate render targets, same scene model).
 *
 * The frame ticker here is Phase 0 scaffolding and is DELETED in Phase 3 when
 * `core/clock.ts` (I-2) lands. Permitted by SPEC.md §0.2, "when an invariant
 * starts applying".
 */
// A hardened CSP (no 'unsafe-eval') forbids the `new Function` that Pixi v8
// uses to generate shader/uniform sync code. This side-effect import installs
// Pixi's interpreted polyfills instead. It must precede `Application.init`.
// Cost is measured, not assumed — see BUILD_LOG.md.
import 'pixi.js/unsafe-eval';
import { Application, Container } from 'pixi.js';
import { FrameMetrics } from '../debug/hud';
import { TestPattern } from './testPattern';

export interface RenderHostOptions {
  parent: HTMLElement;
  width: number;
  height: number;
  nominalMs: number;
  /** Called on the frame after a pending change has been presented. */
  onPresented?: (token: number, t0: number) => void;
}

export interface RenderHost {
  readonly metrics: FrameMetrics;
  setSpeed(v: number): void;
  markPending(token: number, t0: number): void;
  setNominalMs(ms: number): void;
  resize(width: number, height: number): void;
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

  const root = new Container();
  const pattern = new TestPattern();
  root.addChild(pattern.view);
  app.stage.addChild(root);
  pattern.resize(opts.width, opts.height);

  const metrics = new FrameMetrics(opts.nominalMs);

  let speed = 1;
  let phase = 0;
  let lastTick: number | null = null;
  let renderedPending: { token: number; t0: number } | null = null;
  let pending: { token: number; t0: number } | null = null;
  let raf = 0;
  let alive = true;

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

    pattern.update(phase);

    const t0 = performance.now();
    app.renderer.render(app.stage);
    metrics.noteRenderDuration(performance.now() - t0);
    metrics.notePresentation(now);

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
    markPending(token, t0) {
      pending = { token, t0 };
    },
    setNominalMs(ms) {
      metrics.setNominalMs(ms);
    },
    resize(width, height) {
      app.renderer.resize(width, height);
      pattern.resize(width, height);
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      pattern.destroy();
      app.destroy(true, { children: true });
    },
  };
}
