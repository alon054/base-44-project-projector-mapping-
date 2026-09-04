/**
 * The clock the INSTRUMENT uses. Not `core/clock.ts` — that is the scene's
 * time (I-2); this is the stopwatch §4's metrics are timed with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS.
 *
 * `performance.now()` in a renderer is coarsened to 100 us by Chromium, as a
 * Spectre mitigation. §4's gate metric 2 is "PixiJS CPU render duration,
 * p99 <= 60% of N". At Phase 3's stated layer load that duration is about
 * **47 us** — half of one tick of the only clock the renderer had.
 *
 * The consequence was not subtle and it was not noticed for three phases:
 * metric 2 reported **0.200 ms = 1.200% of N** at Gate 0, at Gate 1, at Gate 2
 * and at Gate 3 — and, at Gate 3, across a load ladder from 1 video to 6. Four
 * gates and six load steps agreeing to three decimal places is not stability.
 * It is a ruler whose smallest mark is wider than everything being measured.
 * The handoff into Phase 3 predicted that Phase 3's load would make metric 2
 * report a real number. It did not, and this is why.
 *
 * `process.hrtime.bigint()` is not coarsened, which made the preload the
 * obvious place to get a finer clock. **It is not available there.** This
 * preload is sandboxed (`sandbox: true`), and a sandboxed preload receives a
 * stripped `process` polyfill with no `hrtime` — so on this build the fine
 * clock is refused and `performance.now()` is what times every frame.
 *
 * That refusal is the POINT of this module rather than a failure of it. The
 * first attempt reached for `hrtime` unguarded and threw
 * `Cannot read properties of undefined (reading 'bigint')` straight through
 * render-host creation, killing the output window before it drew a frame — the
 * fifth time in this project that the instrument has been the bug. Whether a
 * candidate clock is finer, and whether it is affordable, are MEASUREMENTS
 * here, not assumptions (A14: "the measurement apparatus is subject to the
 * budget it measures"), and a candidate that cannot answer is dropped loudly.
 *
 * Getting metric 2 off its floor therefore needs a decision this module cannot
 * make: drop the preload sandbox, serve the app from a custom protocol with
 * COOP/COEP so the renderer becomes cross-origin isolated (which lowers
 * `performance.now()` to 5 us), or accept that p99 is a ceiling reading and
 * judge on the informational mean. All three are the operator's call.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Milliseconds, monotonic. Resolution depends on which source was chosen. */
export type NowFn = () => number;

export interface ClockSourceReport {
  /** `hrtime` when the fine clock is in use, `performance` when it is not. */
  source: 'hrtime' | 'performance';
  /**
   * True when the chosen clock cannot resolve a typical render duration.
   *
   * Phase 3's render cost is ~47 us against a 100 us quantum, so metric 2's
   * p99 is a CEILING reading rather than a measurement. Stated in the report
   * so a later reader does not mistake four identical gate numbers for
   * stability, which is exactly what happened for three phases.
   */
  coarserThanSubject: boolean;
  /** Measured smallest non-zero step, in milliseconds. */
  resolutionMs: number;
  /** Measured cost of one call, in milliseconds, averaged over many. */
  callCostMs: number;
  /** Why the fine clock was rejected, when it was. Empty otherwise. */
  rejectedBecause: string;
}

/**
 * How much of one frame the instrument's own clock reads may take before the
 * fine clock is not worth having.
 *
 * Two reads per timed region, roughly six regions a frame, so a budget of
 * 0.2% of a 16.67 ms frame is about 33 us total, or ~2.8 us per call. A14's
 * sibling clause A15 puts the whole instrument's trigger at 2% of N; this
 * spends a tenth of that on the clock alone.
 */
export const CLOCK_CALL_BUDGET_MS = 0.0028;

/**
 * The render duration this instrument exists to measure, in ms — Phase 3's
 * measured mean at the gate's stated layer load.
 *
 * Used only to state whether the chosen clock can resolve its subject. It is
 * not a threshold anything passes or fails; it is what turns "0.1 ms
 * resolution" into "wider than the thing being measured".
 */
const TYPICAL_RENDER_MS = 0.047;

/** Calls used to measure the call cost. Enough to average out scheduling. */
const CALIBRATION_CALLS = 2000;

/**
 * Measures a candidate clock: its cost per call, and the smallest non-zero
 * step it can actually resolve.
 *
 * The resolution probe is a busy loop rather than a sleep, because what is
 * being measured is the clock's QUANTUM — the smallest difference it will ever
 * report — and a sleep would measure the scheduler instead.
 */
export function calibrate(now: NowFn): { resolutionMs: number; callCostMs: number } {
  // Warm the JIT before either measurement; a cold call is not the cost that
  // will be paid 60 times a second for an hour.
  for (let i = 0; i < 200; i++) now();

  const t0 = now();
  for (let i = 0; i < CALIBRATION_CALLS; i++) now();
  const t1 = now();
  const callCostMs = (t1 - t0) / CALIBRATION_CALLS;

  let resolutionMs = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 32; attempt++) {
    const a = now();
    let b = a;
    // Spin until the value changes. That difference IS the quantum.
    for (let guard = 0; guard < 1_000_000 && b === a; guard++) b = now();
    const step = b - a;
    if (step > 0 && step < resolutionMs) resolutionMs = step;
  }
  return {
    resolutionMs: Number.isFinite(resolutionMs) ? resolutionMs : 0,
    callCostMs: callCostMs > 0 ? callCostMs : 0,
  };
}

/**
 * Picks the instrument's clock, measuring before it commits.
 *
 * Falls back to `performance.now()` — loudly, with a reason — when the fine
 * clock is absent, non-monotonic, or costs more than `CLOCK_CALL_BUDGET_MS`.
 * A9: the instrument reports what it is doing rather than quietly doing
 * something else.
 */
export function selectClockSource(fine: (() => number | null) | undefined): {
  now: NowFn;
  report: ClockSourceReport;
} {
  const coarse: NowFn = () => performance.now();
  const coarseCal = calibrate(coarse);
  const fallback = (why: string): { now: NowFn; report: ClockSourceReport } => ({
    now: coarse,
    report: {
      source: 'performance',
      ...coarseCal,
      coarserThanSubject: coarseCal.resolutionMs > TYPICAL_RENDER_MS,
      rejectedBecause: why,
    },
  });

  if (typeof fine !== 'function') {
    return fallback('no fine clock exposed by the preload');
  }

  // EVERY call into the candidate is guarded, including the first two.
  //
  // The first version of this function was not, and the candidate it was given
  // threw: this preload is sandboxed, so `process.hrtime` does not exist, and
  // `Cannot read properties of undefined (reading 'bigint')` came straight up
  // through render-host creation and killed the output window before it drew a
  // frame. A module whose entire job is to protect the instrument from itself
  // has no business being the thing that crashes it.
  //
  // Monotonic, and actually moving. A clock that never advances would produce
  // a resolution of 0 and a render duration of 0 — a confident, precise, wrong
  // number, which A9 names as worse than a loud failure.
  let a: unknown;
  let b: unknown;
  try {
    a = fine();
    b = fine();
  } catch (e) {
    return fallback(`fine clock threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof a !== 'number' || typeof b !== 'number') {
    // `null` is what the preload returns when it has no fine clock to offer.
    return fallback('fine clock returned a non-number (no hrtime in a sandboxed preload?)');
  }
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) {
    return fallback('fine clock is not monotonic');
  }

  let fineCal: { resolutionMs: number; callCostMs: number };
  try {
    fineCal = calibrate(fine as NowFn);
  } catch (e) {
    return fallback(`fine clock threw during calibration: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (fineCal.resolutionMs <= 0) {
    return fallback('fine clock does not advance');
  }
  if (fineCal.callCostMs > CLOCK_CALL_BUDGET_MS) {
    return fallback(
      `fine clock costs ${fineCal.callCostMs.toFixed(5)} ms per call, over the ` +
        `${CLOCK_CALL_BUDGET_MS} ms budget — it would cost more than it resolves`,
    );
  }
  // A fine clock no finer than the coarse one buys nothing and costs a bridge
  // call. Taking it anyway would be cargo cult.
  if (fineCal.resolutionMs >= coarseCal.resolutionMs) {
    return fallback(
      `fine clock resolves ${fineCal.resolutionMs.toFixed(5)} ms, no better than ` +
        `performance.now()'s ${coarseCal.resolutionMs.toFixed(5)} ms`,
    );
  }

  return {
    now: fine as NowFn,
    report: {
      source: 'hrtime',
      ...fineCal,
      coarserThanSubject: fineCal.resolutionMs > TYPICAL_RENDER_MS,
      rejectedBecause: '',
    },
  };
}

export function describeClockSource(r: ClockSourceReport): string {
  const base =
    `[timer] instrument clock: ${r.source}  resolution=${r.resolutionMs.toFixed(6)}ms  ` +
    `callCost=${r.callCostMs.toFixed(6)}ms (budget ${CLOCK_CALL_BUDGET_MS}ms)`;
  const warn = r.coarserThanSubject
    ? `  *** COARSER THAN ITS SUBJECT (~${TYPICAL_RENDER_MS}ms): metric 2's p99 is a ceiling, not a measurement ***`
    : '';
  const why = r.rejectedBecause === '' ? '' : `  — fine clock rejected: ${r.rejectedBecause}`;
  return `${base}${why}${warn}`;
}
