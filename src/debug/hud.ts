/**
 * I-11: the frame budget is visible from Phase 0.
 *
 * `FrameMetrics` is pure logic with no DOM and no Pixi, so SPEC.md §4's two gate
 * metrics are unit-testable rather than eyeballed (§8.1). `Hud` is the overlay.
 *
 * The overlay is DOM, not Pixi, on purpose: a Pixi-drawn HUD would be inside the
 * measured `renderer.render()` call and would inflate gate metric 2 with the
 * cost of the instrument.
 */
import type { KReport, MagnitudeEvent, MetricsReport, ScaleReport } from '@shared/ipc';

/** SPEC.md §4: the first 10 seconds are discarded. */
export const WARMUP_MS = 10_000;
/** SPEC.md §4: a 60-second continuous measurement window. */
export const WINDOW_MS = 60_000;
/** SPEC.md §4 gate metric 1: an interval over 1.5 x N is "late". */
export const LATE_FACTOR = 1.5;
/** SPEC.md §4 gate metric 1: at most 5% of intervals may be late. */
export const MAX_LATE_FRACTION = 0.05;
/** SPEC.md §4 gate metric 1: zero runs of 3 or more consecutive late frames. */
export const MAX_LATE_RUN = 2;
/**
 * A12, SPEC.md §4 gate metric 1 clause 3: an interval over 3 x N is a stall
 * whose magnitude matters, not merely a late frame. Each one is attributed.
 */
export const MAGNITUDE_FACTOR = 3;
/** A12: keep the report bounded; a run with more than this is failing anyway. */
export const MAX_MAGNITUDE_EVENTS = 32;
/** Intervals captured after a provocation resume. More than this is not a hitch. */
export const CAPTURE_CAPACITY = 32;
/** SPEC.md §4 gate metric 2: render p99 must sit at or under 60% of N (A10). */
export const MAX_RENDER_FRACTION = 0.6;

/**
 * A9: the plausible range for a real display mode's frame interval —
 * 1 ms is 1000 Hz, 100 ms is 10 Hz. Nothing outside this is a display.
 */
export const N_MIN_MS = 1;
export const N_MAX_MS = 100;

/**
 * A9: no metric renders a number from unvalidated inputs. An instrument that
 * emits a plausible wrong number is worse than one that fails loudly — this is
 * the guard that would have caught N=0 reporting a confident "100% late".
 */
export function validateNominal(ms: unknown): { valid: boolean; reason: string } {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return { valid: false, reason: `N is not a finite number (${String(ms)})` };
  }
  if (ms <= 0) {
    return { valid: false, reason: `N is ${ms} ms; a frame interval must be > 0` };
  }
  if (ms < N_MIN_MS || ms > N_MAX_MS) {
    return {
      valid: false,
      reason: `N is ${ms} ms, outside the plausible display range ${N_MIN_MS}-${N_MAX_MS} ms`,
    };
  }
  return { valid: true, reason: '' };
}

export interface FrameMetricsOptions {
  warmupMs?: number;
  windowMs?: number;
  capacity?: number;
}

/**
 * A14: the ring is preallocated so the steady state allocates nothing.
 * 60 s at the uncapped ~825 fps measured under ADD-2 is ~49,500 samples; 65,536
 * covers that with margin. Three Float64Arrays at this size is ~1.5 MB, paid
 * once at construction.
 */
export const DEFAULT_CAPACITY = 65_536;

/**
 * A14 — the measurement apparatus is subject to the budget it measures.
 *
 * Three times the instrument has been the bug: N=0 emitting a confident wrong
 * number, the warmup-boundary leak, and `report()`'s allocation churn plausibly
 * triggering the GC that showed up as a 67.7 ms stall. So this class:
 *
 *  - allocates **nothing** per frame — samples live in preallocated typed
 *    arrays addressed by a ring head, and the old `samples.slice()` that ran
 *    every frame at steady state is gone;
 *  - does no synchronous I/O and touches no DOM;
 *  - **times itself**, per frame and per report, and reports that cost as a HUD
 *    row. A metric whose overhead is invisible to itself cannot be trusted.
 */
export class FrameMetrics {
  private readonly warmupMs: number;
  private readonly windowMs: number;
  private readonly capacity: number;

  // Ring buffer. `head` is the oldest live sample; `count` is how many are live.
  private readonly ts: Float64Array;
  private readonly intervals: Float64Array;
  private readonly renders: Float64Array;
  private readonly scratch: Float64Array;
  private head = 0;
  private count = 0;

  private startedAt: number | null = null;
  private lastPresent: number | null = null;
  private pendingRender = 0;
  private worstInterval = 0;
  /** Informational, not gated (SPEC.md §4): hitches seen during warmup. */
  private warmupWorst = 0;
  /** A12: intervals over 3 x N in the current window, each needing attribution. */
  private magnitude: (MagnitudeEvent & { t: number })[] = [];
  /** Post-warmup sample counter. Not reset by window trimming, so "at what n" survives. */
  private postWarmupCount = 0;
  private kReport: KReport | null = null;
  private scaleReport: ScaleReport | null = null;

  /**
   * Attribution support: the first intervals after a provocation's surface
   * resume. Preallocated and armed on demand, so it costs one comparison per
   * frame and allocates nothing (A14).
   */
  private readonly capture = new Float64Array(CAPTURE_CAPACITY);
  private captureWant = 0;
  private captureLen = 0;

  // A14: the instrument's own cost, tracked without allocating.
  private instrumentMax = 0;
  private instrumentSum = 0;
  private instrumentCount = 0;
  private instrumentTick = 0;

  constructor(
    private nominalMs: number,
    opts: FrameMetricsOptions = {},
  ) {
    this.warmupMs = opts.warmupMs ?? WARMUP_MS;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.ts = new Float64Array(this.capacity);
    this.intervals = new Float64Array(this.capacity);
    this.renders = new Float64Array(this.capacity);
    this.scratch = new Float64Array(this.capacity);
  }

  /**
   * N changes if the display mode changes; never assume it (SPEC.md §4).
   * An implausible value is stored rather than ignored, so A9's validity check
   * can report *why* the metrics are unusable instead of silently keeping a
   * stale N and producing a confident wrong number.
   */
  setNominalMs(ms: number): void {
    if (ms !== this.nominalMs) {
      this.nominalMs = ms;
      this.reset();
    }
  }

  /** A8: record the latest render-multiplier probe. */
  setK(k: KReport | null): void {
    this.kReport = k;
  }

  /** A3: record the canvas geometry, so a non-1:1 path is visible, not inferred. */
  setScale(s: ScaleReport | null): void {
    this.scaleReport = s;
  }

  get nominal(): number {
    return this.nominalMs;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.startedAt = null;
    this.lastPresent = null;
    this.worstInterval = 0;
    this.warmupWorst = 0;
    this.magnitude.length = 0;
    this.postWarmupCount = 0;
    this.instrumentMax = 0;
    this.instrumentSum = 0;
    this.instrumentCount = 0;
    this.instrumentTick = 0;
    this.captureWant = 0;
    this.captureLen = 0;
  }

  /** Pixi CPU render duration for the frame about to be presented. */
  noteRenderDuration(ms: number): void {
    this.pendingRender = ms;
  }

  /**
   * A14: the per-frame cost of the instrument itself, measured by the caller
   * around `notePresentation`. Kept as max + running mean so it costs no
   * allocation to track.
   */
  noteInstrumentCost(ms: number): void {
    if (ms > this.instrumentMax) this.instrumentMax = ms;
    this.instrumentSum += ms;
    this.instrumentCount++;
  }

  /** A14: the cost of one report + format + DOM write tick, from the caller. */
  noteInstrumentTick(ms: number): void {
    this.instrumentTick = ms;
  }

  /** Call once per presented frame, with a monotonic clock reading. */
  notePresentation(now: number): void {
    this.startedAt ??= now;
    const prev = this.lastPresent;
    this.lastPresent = now;
    if (prev === null) return;

    const interval = now - prev;
    // Both endpoints must be past warmup. Testing only `now` lets an interval
    // that STARTED during warmup be counted as a gate sample — which is exactly
    // the startup hitch SPEC.md §4's warmup clause exists to exclude.
    if (prev - this.startedAt < this.warmupMs) {
      this.warmupWorst = Math.max(this.warmupWorst, interval);
      return;
    }

    // Ring write. No allocation, no array growth, no slice.
    const slot = (this.head + this.count) % this.capacity;
    this.ts[slot] = now;
    this.intervals[slot] = interval;
    this.renders[slot] = this.pendingRender;
    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.count++;
    }

    if (interval > this.worstInterval) this.worstInterval = interval;
    this.postWarmupCount++;

    // Attribution: one comparison per frame, and only ever active for the few
    // frames after a provocation resume.
    if (this.captureLen < this.captureWant) {
      this.capture[this.captureLen++] = interval;
    }

    // A12: magnitude is a separate fact from rate. A low late-rate does not
    // license an unexplained stall, so every interval over 3 x N is kept with
    // the sample number it happened at — a hitch that recurs at the same n is
    // ours, one that wanders is the OS.
    if (
      validateNominal(this.nominalMs).valid &&
      interval > this.nominalMs * MAGNITUDE_FACTOR &&
      this.magnitude.length < MAX_MAGNITUDE_EVENTS
    ) {
      this.magnitude.push({
        t: now,
        index: this.postWarmupCount,
        intervalMs: interval,
        atSeconds: this.startedAt === null ? 0 : (now - this.startedAt - this.warmupMs) / 1000,
      });
    }

    // Time-based eviction, in place. The previous implementation called
    // `samples.slice()` here, which at steady state allocated a ~3600-element
    // array EVERY FRAME on the render thread — worse than the report() churn it
    // sat beside, and invisible until A14 forced this audit.
    const cutoff = now - this.windowMs;
    while (this.count > 0 && this.ts[this.head]! < cutoff) {
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }
    if (this.magnitude.length > 0 && this.magnitude[0]!.t < cutoff) {
      let w = 0;
      for (let r = 0; r < this.magnitude.length; r++) {
        const e = this.magnitude[r]!;
        if (e.t >= cutoff) this.magnitude[w++] = e;
      }
      this.magnitude.length = w;
    }
  }

  get warmedUp(): boolean {
    return this.startedAt !== null && this.lastPresent !== null
      ? this.lastPresent - this.startedAt >= this.warmupMs
      : false;
  }

  /** Hitches during warmup — reported, never gated (SPEC.md §4). */
  get warmupWorstMs(): number {
    return this.warmupWorst;
  }

  /**
   * Post-warmup seconds — the same clock A12's `atSeconds` uses. External
   * events (focus, blur, occlusion) are logged against this so a stall can be
   * correlated with something that happened, rather than attributed by guess.
   */
  get elapsedSeconds(): number {
    if (this.startedAt === null || this.lastPresent === null) return 0;
    return (this.lastPresent - this.startedAt - this.warmupMs) / 1000;
  }

  /**
   * Arm a capture of the next `n` presentation intervals.
   *
   * A deliberate suspend of D ms yields one interval of ~D by construction, so
   * the gap itself attributes nothing. What follows it is the only thing that
   * can show a resume cost, and this is how that is read off the machine rather
   * than eyeballed from a log.
   */
  armCapture(n: number): void {
    this.captureWant = Math.min(Math.max(0, Math.floor(n)), CAPTURE_CAPACITY);
    this.captureLen = 0;
  }

  /** Read back an armed capture. Allocates once, on demand, never per frame. */
  takeCapture(): number[] {
    const out = Array.from(this.capture.subarray(0, this.captureLen));
    this.captureWant = 0;
    this.captureLen = 0;
    return out;
  }

  /**
   * Worst interval and clause-3 count inside a post-warmup time range, so a
   * provocation window can be judged without re-deriving it from the log.
   * Scans the live ring; called a handful of times per run, never per frame.
   */
  intervalsInElapsedRange(fromSeconds: number, toSeconds: number): {
    maxIntervalMs: number;
    samples: number;
    clause3: number;
  } {
    let maxIntervalMs = 0;
    let samples = 0;
    let clause3 = 0;
    if (this.startedAt === null) return { maxIntervalMs, samples, clause3 };
    const valid = validateNominal(this.nominalMs).valid;
    const threshold = this.nominalMs * MAGNITUDE_FACTOR;
    for (let i = 0; i < this.count; i++) {
      const slot = (this.head + i) % this.capacity;
      const at = (this.ts[slot]! - this.startedAt - this.warmupMs) / 1000;
      if (at < fromSeconds || at > toSeconds) continue;
      const iv = this.intervals[slot]!;
      samples++;
      if (iv > maxIntervalMs) maxIntervalMs = iv;
      if (valid && iv > threshold) clause3++;
    }
    return { maxIntervalMs, samples, clause3 };
  }

  report(): MetricsReport {
    const n = this.count;
    const validity = validateNominal(this.nominalMs);
    const lateThreshold = this.nominalMs * LATE_FACTOR;

    let late = 0;
    let run = 0;
    let worstRun = 0;
    let elapsed = 0;
    for (let i = 0; i < n; i++) {
      const iv = this.intervals[(this.head + i) % this.capacity]!;
      elapsed += iv;
      if (validity.valid && iv > lateThreshold) {
        late++;
        run++;
        if (run > worstRun) worstRun = run;
      } else {
        run = 0;
      }
    }

    const { p95, p99 } = this.renderPercentiles();
    const share = (v: number): number => (validity.valid ? v / this.nominalMs : 0);

    return {
      nominalMs: this.nominalMs,
      valid: validity.valid,
      invalidReason: validity.reason,
      lateFraction: validity.valid && n > 0 ? late / n : 0,
      worstLateRun: worstRun,
      magnitudeEvents: this.magnitude.map(({ index, intervalMs, atSeconds }) => ({
        index,
        intervalMs,
        atSeconds,
      })),
      renderP99Ms: p99,
      renderP99OfNominal: share(p99),
      renderP95Ms: p95,
      renderP95OfNominal: share(p95),
      fps: elapsed > 0 ? (n / elapsed) * 1000 : 0,
      samples: n,
      warmedUp: this.warmedUp,
      worstIntervalMs: this.worstInterval,
      k: this.kReport,
      scale: this.scaleReport,
      instrument: {
        perFrameMaxMs: this.instrumentMax,
        perFrameMeanMs: this.instrumentCount > 0 ? this.instrumentSum / this.instrumentCount : 0,
        tickMs: this.instrumentTick,
        maxShareOfNominal: share(this.instrumentMax),
      },
    };
  }

  /**
   * One in-place sort over a preallocated scratch, two percentiles.
   * Runs 4x/s, not per frame, and allocates only the subarray view.
   */
  private renderPercentiles(): { p95: number; p99: number } {
    const n = this.count;
    if (n === 0) return { p95: 0, p99: 0 };
    for (let i = 0; i < n; i++) {
      this.scratch[i] = this.renders[(this.head + i) % this.capacity]!;
    }
    const view = this.scratch.subarray(0, n);
    view.sort();
    return { p95: nearestRankTyped(view, 0.95), p99: nearestRankTyped(view, 0.99) };
  }
}

/** Nearest-rank over a sorted typed-array view. */
function nearestRankTyped(sorted: Float64Array, q: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx]!;
}

/** Nearest-rank index into an already-sorted array. */
function nearestRank(sorted: readonly number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx]!;
}

/** Nearest-rank p95. Empty input is 0, not NaN. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * SPEC.md §4 gate metric 1, clauses 1 and 2 (rate).
 *
 * A9: an invalid N fails rather than reporting a percentage of nonsense.
 * Clause 3 (A12, magnitude) is deliberately NOT folded in here — it needs an
 * attribution no function can make, so `unattributedMagnitude` surfaces the
 * events and the gate is signed off in `BUILD_LOG.md`.
 */
export function passesPresentation(r: MetricsReport): boolean {
  if (!r.valid) return false;
  return r.lateFraction <= MAX_LATE_FRACTION && r.worstLateRun <= MAX_LATE_RUN;
}

/**
 * SPEC.md §4 gate metric 2 — the one that gets recorded.
 *
 * A10: gated on p99, not p95. M1 permits a 5% late tail, and nearest-rank p95
 * over exactly that tail reports the CHEAP value — so a p95 gate was
 * structurally blind to the same frames M1 was allowed to forgive. p99 sees
 * into that tail; with thousands of samples per run it is well defined.
 */
export function passesHeadroom(r: MetricsReport): boolean {
  if (!r.valid) return false;
  return r.renderP99OfNominal <= MAX_RENDER_FRACTION;
}

/**
 * A12: the stalls a human must account for in `BUILD_LOG.md`. More than one
 * "unknown" attribution per run is a gate failure, but only a human can say
 * which are engine, OS, or unknown.
 */
export function unattributedMagnitude(r: MetricsReport): readonly MagnitudeEvent[] {
  return r.magnitudeEvents;
}

export function formatReport(r: MetricsReport, uncapped: boolean): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  // A9: never render a derived number from an unusable N.
  if (!r.valid) {
    return [
      `INVALID   ${r.invalidReason}`,
      'M1 presentation INVALID  — no gate number can be recorded',
      'M2 headroom     INVALID  — no gate number can be recorded',
      `samples ${r.samples}  ${r.warmedUp ? 'warm' : 'WARMUP'}`,
    ].join('\n');
  }

  const m1 = passesPresentation(r) ? 'PASS' : 'FAIL';
  const m2 = passesHeadroom(r) ? 'PASS' : 'FAIL';
  const lines = [
    `${r.fps.toFixed(1)} fps   N=${r.nominalMs.toFixed(2)} ms${uncapped ? '  [UNCAPPED]' : ''}`,
    `M1 presentation ${m1}  late ${pct(r.lateFraction)} (<=5%)  worst run ${r.worstLateRun} (<=2)`,
    `M2 headroom     ${m2}  render p99 ${r.renderP99Ms.toFixed(2)} ms = ${pct(r.renderP99OfNominal)} of N (<=60%)`,
    `                       p95 ${r.renderP95Ms.toFixed(2)} ms = ${pct(r.renderP95OfNominal)} of N (informational)`,
    `samples ${r.samples}  worst interval ${r.worstIntervalMs.toFixed(1)} ms  ${r.warmedUp ? 'warm' : 'WARMUP'}`,
  ];

  // A12: a stall over 3 x N is shown, not averaged away into the late rate.
  if (r.magnitudeEvents.length > 0) {
    lines.push(`M1 clause 3     ${r.magnitudeEvents.length} interval(s) over 3xN — ATTRIBUTE EACH:`);
    for (const e of r.magnitudeEvents.slice(-4)) {
      lines.push(`  n=${e.index} t=${e.atSeconds.toFixed(1)}s  ${e.intervalMs.toFixed(1)} ms`);
    }
  }

  // A3: one backing-store pixel per panel pixel, or say so loudly.
  if (r.scale) {
    const s = r.scale;
    lines.push(
      `scale  buffer ${s.bufferWidth}x${s.bufferHeight}  css ${s.cssWidth}x${s.cssHeight}  ` +
        `dpr ${s.dpr}  ${s.oneToOne ? '1:1' : 'NOT 1:1 — a scaler is in the path'}`,
    );
  }

  // A14: the instrument reports its own cost. If this row is ever a visible
  // fraction of N, the number above it is describing the instrument.
  const inst = r.instrument;
  lines.push(
    `instrument     per-frame max ${inst.perFrameMaxMs.toFixed(3)} ms (${pct(inst.maxShareOfNominal)} of N)  ` +
      `mean ${inst.perFrameMeanMs.toFixed(3)} ms  tick ${inst.tickMs.toFixed(2)} ms`,
  );

  // A8: k is informational at every gate until Phase 9 decides on a floor.
  if (r.k) {
    lines.push(
      `k_dev ${r.k.dev.toFixed(1)}x (${r.k.devMs.toFixed(2)} ms)  ` +
        `k_target ${r.k.target.toFixed(1)}x (${r.k.targetMs.toFixed(2)} ms)  ` +
        `fill-rate coeff ${r.k.ratio.toFixed(2)}`,
    );
  }

  return lines.join('\n');
}

/** The output-window overlay. Off by default (C4); key-toggled. */
export class Hud {
  private readonly el: HTMLPreElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.style.cssText = [
      'position:fixed',
      'left:12px',
      'top:12px',
      'margin:0',
      'padding:8px 10px',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#7CFFB2',
      'background:rgba(0,0,0,.62)',
      'border:1px solid rgba(124,255,178,.35)',
      'border-radius:4px',
      'pointer-events:none',
      'white-space:pre',
      'z-index:10',
      'display:none',
    ].join(';');
    parent.appendChild(this.el);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  update(text: string): void {
    if (this.visible) this.el.textContent = text;
  }
}
