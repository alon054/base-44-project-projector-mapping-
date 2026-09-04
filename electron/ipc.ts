/**
 * Typed IPC contract. JSON only, never pixel buffers (I-7).
 *
 * This module is deliberately dependency-free so both the main process and the
 * renderers can import it, and so `assertJsonOnly` is unit-testable as pure
 * logic with no GPU and no Electron (SPEC.md §8.1).
 */

/** SPEC.md §4. Measured resolution through Phase 8 — the projector's native mode. */
export const DEV_RESOLUTION = { width: 1280, height: 720 } as const;
/** SPEC.md §4. The v1 spec target, validated when better hardware exists. */
export const TARGET_RESOLUTION = { width: 1920, height: 1080 } as const;

export const CH = {
  /** editor -> main -> output: one parameter value. */
  paramSet: 'param:set',
  /**
   * output -> main -> editor: the same token, sent the instant the output
   * renderer RECEIVES it, before any frame wait (A11 transport latency).
   */
  paramRecv: 'param:recv',
  /** output -> main -> editor: the same token, once the change has been presented. */
  paramAck: 'param:ack',
  /** main -> renderer: resolution, display mode, measurement-mode state. */
  outputConfig: 'output:config',
  /**
   * renderer -> main (invoke): pull the current config.
   * A push alone races the renderer's async setup — the renderer awaits its Pixi
   * init before it can register a listener, by which time `did-finish-load` has
   * already fired and the pushed message is gone. The pull is what makes N
   * reliably reach the metrics.
   */
  outputConfigRequest: 'output:config:get',
  /**
   * editor -> main -> output: the whole scene, as JSON (I-7, I-12).
   *
   * The scene and not a delta: Phase 1's scenes are small, edits are
   * operator-paced rather than per-frame, and a delta protocol is a second
   * description of the state whose only job is to agree with the first one.
   * Phase 6 owns history and coalescing (D12); if the payload ever gets large
   * enough to matter, that is the phase that will know it.
   */
  sceneSet: 'scene:set',
  /** output -> main -> editor: layers currently showing an I-13 placeholder. */
  sceneFailures: 'scene:failures',
  /**
   * I-5. editor -> main -> output: the whole warp calibration for one viewport.
   * Main persists it to `calibration/` on the way through and forwards it; it
   * never inspects it (see electron/calibration.ts).
   *
   * A separate channel from `scene:set` on purpose. Sharing one would make
   * "loading a different scene keeps the same calibration" a property of
   * message ordering rather than of the design, and I-5 says these are
   * different kinds of state.
   */
  calibrationSet: 'calibration:set',
  /** renderer -> main (invoke): the stored calibration, or null. Read at launch. */
  calibrationGet: 'calibration:get',
  /** output -> main -> editor: HUD numbers, for the editor's always-on text mirror (C4). */
  metrics: 'metrics:report',
  /** editor -> main (invoke): enumerate displays. */
  displaysList: 'displays:list',
  /** editor -> main (invoke): choose the projector display. */
  displaysSelect: 'displays:select',
  /** editor -> main (invoke): toggle uncapped measurement mode; needs a relaunch (ADD-2). */
  measurementMode: 'measurement:set',
  /** output -> main: persist HUD visibility to `config/` (SPEC.md §7). */
  hudState: 'hud:state',
  /** main -> renderer: a warning banner the operator must see. */
  warning: 'warning:show',
  /** output -> main: an unattended measurement run has finished; quit. */
  measureDone: 'measure:done',
  /**
   * output -> main (invoke): perform one unattended provocation. Attribution
   * runs only — a gate run never sends this. The renderer owns the schedule
   * because it owns the post-warmup clock every other timestamp is on.
   */
  provoke: 'run:provoke',
} as const;

/** SPEC.md I-8: hierarchical key. Registered in `parameters.ts` in Phase 1 (§0.2). */
export const PARAM_TEST_PATTERN_SPEED = 'debug.testPattern.speed';

/**
 * The scene, unvalidated. Typed as `unknown` on purpose: this module is
 * dependency-free so main and both renderers can import it, and `Scene` lives
 * in `src/core/scene.ts`. The receiving renderer runs `canonicalizeScene()`,
 * which is the validation boundary that module exists to be — so a malformed
 * scene is refused where it can be refused loudly, not typed away here.
 */
export interface SceneSet {
  scene: unknown;
}

/** I-13: what the output is showing as broken, mirrored into the layer list. */
/**
 * The wire shape of one viewport's calibration. Structural and JSON-only (I-7):
 * main relays it without understanding it, and the renderer canonicalizes on
 * receipt exactly as it does for a scene. `corners` is TL, TR, BR, BL in
 * normalized [0,1] output space (I-1) — no pixels cross this channel either.
 */
export interface CalibrationSet {
  viewportId: string;
  enabled: boolean;
  corners: { x: number; y: number }[];
}

export interface SceneFailure {
  layerId: string;
  layerName: string;
  providerId: string;
  reason: string;
}

export interface ParamSet {
  key: string;
  value: number;
  /** Round-trip correlation id. */
  token: number;
  /** Editor-local `performance.now()` at send. Only the editor interprets it. */
  t0: number;
}

export interface ParamAck {
  token: number;
  t0: number;
}

/**
 * A11: SPEC.md §4 records two latency figures and never conflates them.
 * Transport is the one that moves under load; presented is conservative by one
 * frame by construction. This is the transport half.
 */
export type ParamRecv = ParamAck;

/** A11, SPEC.md §4: transport latency gate, p95. */
export const TRANSPORT_GATE_MS = 5;
/** A11, SPEC.md §4: presented round-trip gate, p95. Four frames at 60 Hz. */
export const PRESENTED_GATE_MS = 66;

export interface OutputConfig {
  width: number;
  height: number;
  /** Read from `Display.displayFrequency` — never assumed (SPEC.md §4). */
  displayFrequency: number;
  /** Device pixel ratio of the target display. */
  scaleFactor: number;
  /** True when the frame-rate cap was disabled at launch (ADD-2). */
  uncapped: boolean;
  /** Which window this is; the preview is an approximation, not a mirror (I-7). */
  role: 'output' | 'preview';
  /** Persisted HUD visibility (SPEC.md §7 `config/`). Off by default (C4). */
  hudVisible: boolean;
  /**
   * Unattended measurement run: a label, or '' for normal interactive use.
   * The run enables the HUD, resets the window, waits out §4's warmup plus
   * measurement window untouched, emits a structured summary, probes k, quits.
   */
  measureLabel: string;
  /**
   * Post-warmup seconds at which to show an on-wall cue. Used only by the
   * operator-driven disturbance run, where the point is a timed interruption.
   */
  measureCues: number[];
  /**
   * Unattended provocations, fired by the harness with no human involved.
   * Empty for every gate run — a run carrying these is an attribution run and
   * its M1 numbers describe the provocation, not the engine.
   */
  provocations: ProvocationSpec[];
  /**
   * §8.2's soak, in minutes. 0 is the ordinary §4 protocol window, untouched —
   * a gate run and a soak run must not be confusable for one another.
   */
  soakMinutes: number;
  /** Captured once at run start, reported in the summary. */
  conditions: RunConditions | null;
}

/**
 * The conditions a run was made under, captured by the app rather than
 * reconstructed afterwards.
 *
 * This exists because run5-mc's null result could not be interpreted: whether
 * `Displays have separate Spaces` was on decided whether the run had tested its
 * mechanism at all, and the answer had to be recovered from `defaults read`
 * after the fact. Same class as A9 and A14 — an instrument that cannot see the
 * conditions it measured under cannot say what it measured.
 */
export interface RunConditions {
  platform: string;
  /** Raw `com.apple.spaces spans-displays`: '0', '1', or 'absent'. macOS only. */
  spansDisplaysRaw: string;
  /**
   * True when each display has its own Spaces. macOS defaults to on, which is
   * `spans-displays` absent or 0; the key is only written once toggled.
   * Null off darwin.
   */
  separateSpaces: boolean | null;
  /** The output window's `hiddenInMissionControl`, read from the window itself. */
  hiddenInMissionControl: boolean | null;
  /** Attached displays at run start. */
  displayCount: number;
  outputDisplay: {
    id: number;
    label: string;
    width: number;
    height: number;
    scaleFactor: number;
    displayFrequency: number;
    internal: boolean;
    isPrimary: boolean;
  } | null;
  /** False means the window is framed — a stale pin or an unconfirmed display. */
  outputFullscreen: boolean;
  /** A13: `PINNED (...)` or `HEURISTIC (...)`, verbatim from the picker. */
  pin: string;
}

/**
 * Unattended provocations for an attribution run. Each one drives a real OS
 * event from the harness itself, so no human presses a key and no human reports
 * what they saw.
 *
 * - `hide` / `apphide` — genuine surface suspend/resume, the positive controls.
 *   If these produce no stall beyond the deliberate gap, surface suspend/resume
 *   is not the mechanism regardless of what triggers it.
 * - `mc` — Mission Control in the shipping configuration.
 * - `mcvisible` — Mission Control with `hiddenInMissionControl` temporarily
 *   cleared, which is the only way to tell that flag's effect apart from a
 *   Spaces setting without a second binary.
 */
export type ProvocationKind =
  | 'hide'
  | 'apphide'
  | 'mc'
  | 'mcvisible'
  /**
   * The control that isolates the variable. `backgroundThrottling: false` has
   * been set on the output window since the first scaffold commit, and Electron
   * documents that it "also affects the Page Visibility API" — so it is the
   * candidate explanation for why `hide`, `apphide`, `mc` and `mcvisible` all
   * produced no suspend at all. These re-enable throttling for the duration of
   * the provocation, and are the only configurations in which a suspend should
   * be reachable.
   */
  | 'hidethrottled'
  | 'mcthrottled';

export interface ProvocationSpec {
  kind: ProvocationKind;
  /** Post-warmup seconds at which to fire. */
  atSeconds: number;
}

/**
 * What one provocation actually did, decided by the machine.
 *
 * `visibilityHidden` is the ground truth for "the surface really suspended" —
 * the renderer's `visibilitychange` listener demonstrably fires on a real
 * surface hide and did not fire in run5-mc.
 */
export interface ProvocationVerdict {
  kind: ProvocationKind;
  requestedAtSeconds: number;
  /** Did the surface genuinely suspend? The whole experiment turns on this. */
  visibilityHidden: boolean;
  focusLost: boolean;
  /** Longest presentation interval inside the provocation window, ms. */
  maxIntervalMs: number;
  /** Clause-3 events inside the window — the deliberate gap included. */
  clause3InWindow: number;
  /**
   * The first intervals after the surface came back. This is the number that
   * separates "the gap we asked for" from "a resume cost we did not" — a
   * suspend of D ms yields one interval of ~D by construction, so only what
   * follows it can attribute a stall to resume.
   */
  intervalsAfterResume: number[];
  /** Anything the main process reported back about performing it. */
  note: string;
}

/**
 * A12: a presentation interval over 3 x N. Rate and magnitude are separate
 * facts, so these are carried individually and attributed in `BUILD_LOG.md`.
 */
export interface MagnitudeEvent {
  /** Post-warmup sample number, so a recurring hitch can be spotted by its n. */
  index: number;
  /** The offending interval, ms. */
  intervalMs: number;
  /** Seconds since the measurement window opened. */
  atSeconds: number;
}

/**
 * A8: the render-multiplier probe. `k` is how many times the current scene fits
 * into one frame interval at a given resolution, GPU included.
 */
export interface KReport {
  /** k at DEV_RESOLUTION (1280x720). */
  dev: number;
  /** k against an offscreen 1920x1080 RenderTexture. */
  target: number;
  /** k_dev / k_target — the measured fill-rate coefficient. */
  ratio: number;
  /** Per-render cost behind k_dev, ms, GPU sync included. */
  devMs: number;
  /** Per-render cost behind k_target, ms, GPU sync included. */
  targetMs: number;
  /** Renders per resolution in the probe burst. */
  iterations: number;
}

/**
 * §8.2: managed GPU resources, for the "texture memory flat over a soak"
 * rolling check. Named `gpu` and not `texture` deliberately — Phase 1 has no
 * textures at all, and what it allocates and frees is geometry and buffers.
 */
export interface GpuResources {
  valid: boolean;
  invalidReason: string;
  textureCount: number;
  textureBytesEstimate: number;
  bufferCount: number;
  geometryCount: number;
}

/**
 * A3: scaleFactor is a first-class concern. One backing-store pixel must land
 * on exactly one panel pixel, or something between us and the wall is scaling.
 */
export interface ScaleReport {
  /** Pixi backing store, device pixels. */
  bufferWidth: number;
  bufferHeight: number;
  /** The CSS box the canvas occupies. */
  cssWidth: number;
  cssHeight: number;
  /** `window.devicePixelRatio` in the window holding the canvas. */
  dpr: number;
  /** True when buffer == css x dpr on both axes: no scaler in the path. */
  oneToOne: boolean;
}

/**
 * A14: the measurement apparatus is subject to the budget it measures, so it
 * reports its own cost rather than leaving it to be inferred from a stall.
 */
export interface InstrumentCost {
  /** Worst per-frame cost of the metrics call itself, ms. */
  perFrameMaxMs: number;
  /** Mean per-frame cost of the metrics call itself, ms. */
  perFrameMeanMs: number;
  /** Cost of one report + format + DOM write tick, ms. */
  tickMs: number;
  /** `perFrameMaxMs` as a share of N. Anything visible here is a problem. */
  maxShareOfNominal: number;
}

export interface MetricsReport {
  /** Nominal frame interval N in ms, derived from `displayFrequency`. */
  nominalMs: number;
  /**
   * A9: false when N is unset, zero, or outside a plausible display-mode range.
   * Every derived figure below is then meaningless and must not be recorded.
   */
  valid: boolean;
  /** A9: why the report is invalid; empty string when valid. */
  invalidReason: string;
  /** Gate metric 1: share of presentation intervals over 1.5 x N, as a fraction. */
  lateFraction: number;
  /** Gate metric 1: longest run of consecutive late presentations. */
  worstLateRun: number;
  /** A12, gate metric 1 clause 3: intervals over 3 x N, each needing attribution. */
  magnitudeEvents: MagnitudeEvent[];
  /** A10: gate metric 2 gates on p99, ms. */
  renderP99Ms: number;
  /** A10: gate metric 2 as a share of N. Gate is <= 0.60. */
  renderP99OfNominal: number;
  /** A10: p95 is retained but informational — it is blind to M1's permitted tail. */
  renderP95Ms: number;
  renderP95OfNominal: number;
  /**
   * INFORMATIONAL, never a gate. A10 stands: gate metric 2 reads p99.
   *
   * `performance.now()` is coarsened to 100 us in Electron, so every render
   * duration is a multiple of 0.1 ms and both percentiles sit pinned at exactly
   * two quanta on any light scene — measured across three separate Phase 2
   * runs, warp off and warp on, all reporting the identical 0.200 ms. A
   * percentile of quantized samples cannot resolve a change smaller than one
   * quantum, which made "what does the warp stage cost?" unanswerable with the
   * statistics that existed.
   *
   * A mean over a full 3601-sample window averages the quantization out and
   * resolves to roughly a thousandth of a quantum. It is added for that
   * question and reported beside p99, never instead of it.
   */
  renderMeanMs: number;
  renderMeanOfNominal: number;
  /** Observed presentation rate, fps. */
  fps: number;
  /** Samples in the current window, after warmup. */
  samples: number;
  /** True once the 10-second warmup has been discarded (SPEC.md §4). */
  warmedUp: boolean;
  /** Informational, not gated: worst post-warmup interval in the window. */
  worstIntervalMs: number;
  /** A8: null until the probe is run. */
  k: KReport | null;
  /** A3: null until the renderer reports its geometry. */
  scale: ScaleReport | null;
  /** §8.2: null until sampled. */
  gpu: GpuResources | null;
  /** A14: what the instrument itself costs. */
  instrument: InstrumentCost;
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  displayFrequency: number;
  internal: boolean;
  detected: boolean;
  isPrimary: boolean;
  isSelected: boolean;
}

/**
 * I-7, mechanised. Throws on anything that is not plain JSON — the point is that
 * a pixel buffer cannot cross this boundary even by accident.
 *
 * Returns the value so it can be used inline at a send site.
 */
export function assertJsonOnly<T>(value: T, path = 'payload'): T {
  walk(value, path, new Set());
  return value;
}

function walk(v: unknown, path: string, seen: Set<object>): void {
  if (v === null) return;
  const t = typeof v;
  if (t === 'boolean' || t === 'string') return;
  if (t === 'number') {
    if (!Number.isFinite(v as number)) {
      throw new TypeError(`${path}: ${String(v)} is not JSON-representable`);
    }
    return;
  }
  if (t === 'undefined') throw new TypeError(`${path}: undefined is not JSON`);
  if (t === 'function') throw new TypeError(`${path}: functions cannot cross IPC`);
  if (t === 'symbol') throw new TypeError(`${path}: symbols cannot cross IPC`);
  if (t === 'bigint') throw new TypeError(`${path}: bigint is not JSON-representable`);

  const o = v as object;
  if (seen.has(o)) throw new TypeError(`${path}: circular reference`);
  seen.add(o);

  // The whole reason this function exists (I-7).
  if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer) {
    throw new TypeError(`${path}: pixel/binary buffers must not cross IPC (I-7)`);
  }
  if (Array.isArray(o)) {
    o.forEach((item, i) => walk(item, `${path}[${i}]`, seen));
    seen.delete(o);
    return;
  }
  const proto = Object.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(
      `${path}: only plain objects cross IPC, got ${proto?.constructor?.name ?? 'unknown'}`,
    );
  }
  for (const [k, val] of Object.entries(o)) walk(val, `${path}.${k}`, seen);
  seen.delete(o);
}
