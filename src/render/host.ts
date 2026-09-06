/**
 * Pixi application host, shared by the output window and the editor preview at
 * different sizes (I-7: separate render targets, same scene model).
 *
 * **Phase 0's throwaway ticker is gone.** It accumulated its own phase
 * (`phase += dt / LOOP_SECONDS`) and was the sanctioned forward-reach SPEC.md
 * §0.2 permitted until I-2 started applying. It came due in Phase 3 and was
 * deleted, not preserved: the host no longer owns any notion of time. It owns a
 * `Clock` and feeds it real deltas, and every phase the compositor sees is
 * derived from that clock's authoritative time.
 *
 * The frame loop is still the ONLY caller of `clock.advance`. Two callers would
 * be two time sources, which is the thing I-2 forbids.
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
import {
  describeClockSource,
  selectClockSource,
  type ClockSourceReport,
} from '../debug/clock-source';
import { readGpuResources, type GpuResourceReport } from '../debug/gpu';
import { createDefaultScene } from '../core/defaultScene';
import { Clock, type ClockTransport } from '../core/clock';
import { evaluateForces, type ForceField } from '../core/forces';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import type { Scene } from '../core/scene';
import type { SurfaceTree } from '../core/surfaces';
import type { PlaceholderInfo } from '../core/resilience';
import { ProviderRegistry } from '../providers/ContentProvider';
import { ProceduralProvider } from '../providers/procedural/ProceduralProvider';
import { BundledProvider } from '../providers/bundled/BundledProvider';
import { createBundledLibrary } from '../providers/bundled/manifest';
import { ensureLottie } from '../providers/bundled/LottieView';
import { Compositor, type RoleMiss } from './compositor';
import { WarpStage } from './warp';
import type { ViewportCalibration } from './calibration';

export interface RenderHostOptions {
  parent: HTMLElement;
  width: number;
  height: number;
  nominalMs: number;
  /** Called on the frame after a pending change has been presented. */
  onPresented?: (token: number, t0: number) => void;
  /** I-13: a layer failed and is showing a placeholder. Once per failure. */
  onLayerFailed?: (info: PlaceholderInfo, error: unknown) => void;
  /**
   * I-5: put the warp stage in this host's path. The OUTPUT window sets it;
   * the editor preview deliberately does not.
   *
   * D11 is the reason. Placement happens in scene (pre-warp) space, and the
   * preview is the placement space — "a scene-space grid overlay, not a photo
   * of the wall". A warped preview would put the operator's objects on a
   * distorted canvas and teach exactly the mental model D11 says to avoid. The
   * warp is judged on the surface it corrects, which is what Gate 2 asks for.
   */
  warp?: boolean;
  /** I-13: the warp stage failed and fell back to an unwarped draw. Once. */
  onWarpFallback?: (reason: string) => void;
  /**
   * §5 / A2: create real `<video>` elements. The OUTPUT window sets this; the
   * editor preview must not.
   *
   * Defaults to FALSE, which is the safe default in the direction that matters:
   * a host that forgot to ask for decoding shows posters, while a host that
   * accidentally got it spends a second decoder out of a 16 GB pool shared
   * between CPU and GPU. §5 calls that decision load-bearing and says not to
   * relax it for preview fidelity.
   */
  decodeVideo?: boolean;
  /** §5: Lottie runs in the preview at reduced size. Canvas edge in px. */
  lottieResolution?: number;
  /** Video stage changes, for the run log. Never per frame. */
  onVideoStage?: (layerId: string, stage: string, detail: string) => void;
}

export interface RenderHost {
  readonly metrics: FrameMetrics;
  /** I-2: the one authoritative time source in this host. */
  readonly clock: Clock;
  /**
   * Phase 0's test-pattern speed slider, now driving the clock's rate.
   *
   * The control and its IPC path are unchanged — the same channel, the same
   * 0-4 range, the same `debug.testPattern.speed` registry key. What changed is
   * what sits at the far end of it: a slider that used to scale a throwaway
   * ticker now scales the clock, which is the only thing in the engine that
   * could still honestly be called a speed.
   */
  setSpeed(v: number): void;
  /**
   * I-7: whole clock state from the editor, as JSON. Never per frame.
   *
   * Takes a `ClockTransport` and not a bare `ClockState` deliberately — the
   * `scrubSeq` is what tells this host whether the sender meant "go to this
   * time" or merely happened to include one.
   */
  setClock(state: ClockTransport): void;
  /** Replaces the whole layer stack. Operator-paced, never per-frame. */
  setScene(scene: Scene): void;
  /**
   * I-15, B3. The room, from `calibration/surfaces.json` by way of the editor.
   *
   * Unlike `setScene` this one IS on a pointer path — the builder at the wall
   * drags a point and the projection has to answer while their finger is still
   * down (SPRINT.md §3 R1). `Compositor.setSurfaces` is what makes that
   * affordable: a geometric edit reshapes the masks it already has and rebuilds
   * nothing. See its header.
   */
  setSurfaces(tree: SurfaceTree): void;
  /** I-5. No-op on a host built without a warp stage (the editor preview). */
  setCalibration(cal: ViewportCalibration): void;
  /** True when the composite is going through the warp mesh this frame. */
  warpActive(): boolean;
  /** I-13: layers currently showing a placeholder. */
  failures(): PlaceholderInfo[];
  /**
   * I-13's OTHER flag: fill layers whose role matched no surface, or matched a
   * face too small to enclose an area. Separate from `failures()` on purpose —
   * a failure draws magenta and a role miss draws nothing at all, and merging
   * them would eventually put a magenta box on a wall for a mistyped role.
   */
  roleMisses(): RoleMiss[];
  markPending(token: number, t0: number): void;
  setNominalMs(ms: number): void;
  resize(width: number, height: number): void;
  /** A3: current backing-store vs CSS geometry, so a scaler cannot hide. */
  scaleReport(): ScaleReport;
  /** A8: run the render-multiplier probe. Hitches by design; resets metrics. */
  probe(order?: 'dev-first' | 'target-first'): KReport;
  /**
   * A14: which clock the instrument settled on, and what it measured about it.
   *
   * Reported rather than assumed. `performance.now()` is coarsened to 100 us
   * in a renderer, which is wider than the render duration §4's metric 2 is
   * defined as — see `debug/clock-source.ts`.
   */
  readonly clockSource: ClockSourceReport;
  /** §8.2: managed GPU resources. Cheap, but never call it per frame (A14). */
  gpuResources(): GpuResourceReport;
  /** Re-applies the current scene, exercising the teardown/rebuild path. */
  reapplyScene(): void;
  /** I-4. The field the last rendered frame was modulated by. Never per frame. */
  forceField(): ForceField;
  destroy(): void;
}

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
  // Warm the Lottie player without blocking host creation. A scene with no
  // Lottie never touches it; a scene with one gets it a beat sooner than the
  // first frame that needs it, so the layer does not flash its placeholder.
  void ensureLottie();
  // D6's second provider. The library is built here rather than shared across
  // hosts because the preview and the output are separate processes anyway
  // (I-7), and a module-global would only look shared.
  providers.register(
    new BundledProvider({
      library: createBundledLibrary(),
      decodeVideo: opts.decodeVideo ?? false,
      lottieResolution: opts.lottieResolution ?? 512,
      ...(opts.onVideoStage
        ? { onVideoStage: (id: string, stage: string, detail: string) => opts.onVideoStage?.(id, stage, detail) }
        : {}),
    }),
  );

  const compositor = new Compositor({
    providers,
    width: opts.width,
    height: opts.height,
    ...(opts.onLayerFailed ? { onLayerFailed: opts.onLayerFailed } : {}),
  });
  const warp = opts.warp
    ? new WarpStage({
        renderer: app.renderer,
        stage: app.stage,
        source: compositor.view,
        width: opts.width,
        height: opts.height,
        ...(opts.onWarpFallback ? { onFallback: opts.onWarpFallback } : {}),
      })
    : null;
  // The warp stage parents the composite itself, because whether the composite
  // is a child of the stage or feeding a render texture is precisely what it
  // owns. Without one, the Phase 1 path is unchanged.
  if (!warp) app.stage.addChild(compositor.view);

  let currentScene: Scene = createDefaultScene();
  compositor.setScene(currentScene);

  /**
   * The most recent frame's force field (I-4). Held so the HUD and the run log
   * can report what the scene is actually being modulated by, rather than
   * re-deriving it from scene state at a different instant and reporting a
   * number that was never applied to anything — the Phase 3 lesson, which was
   * an instrument that lied in six different ways.
   */
  let forceField: ForceField = evaluateForces({
    definitions: FORCE_DEFINITIONS,
    values: currentScene.forces,
    timeSeconds: 0,
    seed: currentScene.seed,
    parallax: currentScene.parallax,
  });

  // A14. Chosen by MEASUREMENT — cost per call and resolution — before any
  // frame is timed with it, and logged either way.
  const { now: instrumentNow, report: clockSource } = selectClockSource(
    typeof window !== 'undefined' && typeof window.engine?.nowMs === 'function'
      ? () => window.engine.nowMs()
      : undefined,
  );
  console.log(describeClockSource(clockSource));

  const metrics = new FrameMetrics(opts.nominalMs);

  // I-2. One per host: the output window and the editor preview are separate
  // processes with separate hosts (I-7), and only scene state crosses.
  const clock = new Clock();
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

    // I-2. The clock is advanced by real elapsed milliseconds and decides for
    // itself what that means — pause holds it, rate scales it. The host does
    // not know and must not care.
    clock.advance(lastTick === null ? 0 : now - lastTick);
    lastTick = now;

    // I-4 / I-2. ONE evaluation per frame, from the ONE clock, shared by every
    // layer. Two evaluations would be two force fields, and a scene whose
    // layers were modulated from different samples of the same gust is exactly
    // the "moves everything together" property D4 exists to provide.
    forceField = evaluateForces({
      definitions: FORCE_DEFINITIONS,
      values: currentScene.forces,
      timeSeconds: clock.timeSeconds,
      seed: currentScene.seed,
      parallax: currentScene.parallax,
    });

    compositor.update({
      timeSeconds: clock.timeSeconds,
      phase: clock.globalPhase,
      playing: clock.playing,
      rate: clock.rate,
      scrubSeq: clock.scrubSeq,
      forces: forceField,
    });

    // Both draws sit inside one timed region. The render-to-texture IS the
    // warp stage's cost, and Gate 2 asks for that cost as a number — measuring
    // it outside the clock that produces M2 would report a warp that is free.
    const t0 = instrumentNow();
    warp?.prepare();
    app.renderer.render(app.stage);
    const t1 = instrumentNow();
    metrics.noteRenderDuration(t1 - t0);
    metrics.notePresentation(now);
    // A14: one extra clock read per frame buys the instrument's own per-frame
    // cost as a reported number instead of an inference from a later stall.
    metrics.noteInstrumentCost(instrumentNow() - t1);

    if (pending) {
      renderedPending = pending;
      pending = null;
    }

    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    metrics,
    clockSource,
    clock,
    setSpeed(v) {
      clock.setRate(v);
    },
    setClock(state) {
      clock.applyTransport(state);
    },
    setScene(scene) {
      currentScene = scene;
      compositor.setScene(scene);
    },
    setSurfaces(tree) {
      compositor.setSurfaces(tree);
    },
    forceField: () => forceField,
    setCalibration(cal) {
      warp?.setCalibration(cal);
    },
    warpActive() {
      return warp?.active ?? false;
    },
    gpuResources() {
      return readGpuResources(app.renderer);
    },
    reapplyScene() {
      compositor.setScene(currentScene);
    },
    failures() {
      return compositor.failures();
    },
    roleMisses() {
      return compositor.roleMisses();
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
      warp?.resize(width, height);
      invalidateScale();
      metrics.setScale(readScale());
    },
    scaleReport: readScale,
    probe(order = 'dev-first' as 'dev-first' | 'target-first') {
      // THE COMPOSITE, not `app.stage` (A8, ruled at Phase 3).
      //
      // Through Phases 0-2 this passed the stage. Once the warp stage existed
      // the stage held the MESH — a single textured quad — so k_dev read 42-50
      // warp-off against 90-96 warp-on. Twice as fast is not what a warp does;
      // the probe had simply changed subject, and the two sets of numbers were
      // never comparable to each other.
      //
      // `compositor.view` is the scene, before the warp stage and independent
      // of whether one exists, so k now means the same thing in both
      // configurations and across every phase from here on.
      const k = runRenderMultiplierProbe(app.renderer, compositor.view, {
        nominalMs: metrics.nominal,
        dev: DEV_RESOLUTION,
        target: TARGET_RESOLUTION,
        order,
        subject: 'composite',
        now: instrumentNow,
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
      // AFTER the Application, deliberately. PixiJS caches batched textures in
      // a module-global bind-group map with no eviction, so a render texture
      // destroyed while the renderer is alive always warns. See warp.ts.
      warp?.destroy();
    },
  };
}
