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
} as const;

/** SPEC.md I-8: hierarchical key. Registered in `parameters.ts` in Phase 1 (§0.2). */
export const PARAM_TEST_PATTERN_SPEED = 'debug.testPattern.speed';

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
