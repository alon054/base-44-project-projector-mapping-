/**
 * A14 — the instrument's own clock is chosen by measurement, not by preference.
 *
 * "The measurement apparatus is subject to the budget it measures. … A metric
 * whose overhead is invisible to itself cannot be trusted."
 *
 * The reason this module exists at all is that `performance.now()` is coarsened
 * to 100 us in a renderer, and §4's metric 2 — PixiJS CPU render duration — is
 * about 47 us at Phase 3's layer load. Metric 2 therefore reported the same
 * value, 1.200% of N, at four consecutive gates and across a load ladder from
 * one video to six. The fix is a finer clock; the DISCIPLINE is that a finer
 * clock is only adopted if it is measurably finer AND measurably affordable.
 */
import { describe, expect, it } from 'vitest';
import {
  CLOCK_CALL_BUDGET_MS,
  calibrate,
  describeClockSource,
  selectClockSource,
} from '../debug/clock-source';

/**
 * A synthetic clock that behaves like a real one: it advances cheaply and
 * REPORTS values quantised to `quantumMs`.
 *
 * The distinction matters and the first version of this fixture got it wrong.
 * A fake that simply returned `t += quantumMs` conflates two different things
 * — how fast time moves and how much a call costs — so a clock with a 10 ms
 * quantum also looked like it cost 10 ms to call, and `selectClockSource`
 * rejected it for expense before it ever reached the resolution test. Real
 * clocks tick along cheaply and round their answers.
 */
function quantisedClock(quantumMs: number, costMs = quantumMs / 1000): () => number {
  let t = 0;
  return () => {
    t += costMs;
    return Math.floor(t / quantumMs) * quantumMs;
  };
}

describe('calibrate', () => {
  it('measures the quantum of a coarse clock', () => {
    // A clock that only ever moves in 0.1 ms steps resolves 0.1 ms. That is
    // `performance.now()` in a renderer, and it is wider than the thing §4
    // asks us to measure.
    const res = calibrate(quantisedClock(0.1)).resolutionMs;
    expect(res).toBeCloseTo(0.1, 9);
  });

  it('measures the quantum of a fine clock', () => {
    expect(calibrate(quantisedClock(0.000001)).resolutionMs).toBeCloseTo(0.000001, 12);
  });
});

describe('selectClockSource — the fine clock has to earn its place', () => {
  it('falls back, with a reason, when no fine clock is offered', () => {
    const { report } = selectClockSource(undefined);
    expect(report.source).toBe('performance');
    expect(report.rejectedBecause).toMatch(/no fine clock/);
  });

  it('rejects a non-monotonic clock', () => {
    // A clock that goes backwards produces negative durations, and a negative
    // p99 would be a confident precise wrong number — A9's exact target.
    let t = 100;
    const { report } = selectClockSource(() => (t -= 10));
    expect(report.source).toBe('performance');
    expect(report.rejectedBecause).toMatch(/monotonic/);
  });

  it('rejects a clock that never advances', () => {
    const { report } = selectClockSource(() => 42);
    expect(report.source).toBe('performance');
    // Not monotonic-failing — it is constant, which reads as zero resolution.
    expect(report.rejectedBecause).toBeTruthy();
  });

  it('rejects a fine clock that is no finer than the coarse one', () => {
    // Measured against whatever THIS environment's `performance.now()` really
    // resolves, rather than against an assumed 100 us — under Node it is much
    // finer than in a renderer, and a test that hard-coded the renderer's
    // number would pass for the wrong reason.
    const coarse = calibrate(() => performance.now()).resolutionMs;
    const { report } = selectClockSource(quantisedClock(coarse * 100));
    expect(report.source).toBe('performance');
    // Taking a bridge call for no extra resolution would be cargo cult.
    expect(report.rejectedBecause).toMatch(/no better than/);
  });

  it('rejects a fine clock that costs more than it resolves', () => {
    // The whole point of A14. A clock that resolves a nanosecond and costs a
    // millisecond to read makes every number it produces worse.
    const expensive = quantisedClock(1e-6, CLOCK_CALL_BUDGET_MS * 10);
    const { report } = selectClockSource(expensive);
    expect(report.source).toBe('performance');
    expect(report.rejectedBecause).toMatch(/over the .* budget/);
  });

  it('accepts a clock that is finer and cheap', () => {
    const coarse = calibrate(() => performance.now()).resolutionMs;
    const { report } = selectClockSource(quantisedClock(coarse / 100));
    expect(report.source).toBe('hrtime');
    expect(report.rejectedBecause).toBe('');
    expect(report.resolutionMs).toBeLessThan(coarse);
  });

  it('states the budget it is judging against', () => {
    // Two reads per timed region, roughly six regions a frame: 0.0028 ms per
    // call is about 0.2% of a 16.67 ms frame, a tenth of A15's 2% trigger.
    expect(CLOCK_CALL_BUDGET_MS).toBeGreaterThan(0);
    expect(CLOCK_CALL_BUDGET_MS).toBeLessThan(0.02);
  });

  it('always returns a usable clock, whichever way it rules', () => {
    for (const candidate of [undefined, () => 42, quantisedClock(1e-7), quantisedClock(10)]) {
      const { now } = selectClockSource(candidate);
      const a = now();
      const b = now();
      expect(Number.isFinite(a)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(a);
    }
  });

  it('describes itself in one line, including why it fell back', () => {
    const line = describeClockSource(selectClockSource(undefined).report);
    expect(line).toMatch(/^\[timer\] instrument clock: performance/);
    expect(line).toMatch(/rejected/);
    const ok = describeClockSource(selectClockSource(quantisedClock(1e-7)).report);
    expect(ok).toMatch(/hrtime/);
    expect(ok).not.toMatch(/rejected/);
  });
});

/**
 * The crash. A module whose whole job is to protect the instrument from itself
 * must not be the thing that kills the renderer.
 *
 * The first version called the candidate clock unguarded. This preload is
 * sandboxed, so `process.hrtime` does not exist, and
 * `Cannot read properties of undefined (reading 'bigint')` came up through
 * render-host creation and killed the output window before it drew a frame.
 * The whole measurement run was lost to it.
 */
describe('a broken candidate clock can never take the renderer down', () => {
  it('falls back when the candidate throws on the first call', () => {
    const { now, report } = selectClockSource(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'bigint')");
    });
    expect(report.source).toBe('performance');
    expect(report.rejectedBecause).toMatch(/threw/);
    // And the returned clock still works — the caller gets a usable stopwatch
    // out of every path through this function.
    expect(Number.isFinite(now())).toBe(true);
  });

  it('falls back when the candidate throws only later, during calibration', () => {
    let calls = 0;
    const { now, report } = selectClockSource(() => {
      calls++;
      if (calls > 2) throw new Error('boom');
      return calls * 1e-6;
    });
    expect(report.source).toBe('performance');
    expect(report.rejectedBecause).toMatch(/threw/);
    expect(Number.isFinite(now())).toBe(true);
  });

  it('falls back when the preload returns null rather than a number', () => {
    // What the sandboxed preload actually does now: it declines rather than
    // handing back a function that throws.
    const { report } = selectClockSource(() => null);
    expect(report.source).toBe('performance');
    expect(report.rejectedBecause).toMatch(/non-number/);
  });

  it('says out loud when the chosen clock is coarser than its subject', () => {
    // The failure that hid for three phases: metric 2's p99 read the same
    // 1.200% of N at four gates because the ruler's smallest mark (100 us) is
    // wider than the render it measures (~47 us). It must not be possible to
    // read that number without also reading this warning.
    const { report } = selectClockSource(undefined);
    if (report.resolutionMs > 0.047) {
      expect(report.coarserThanSubject).toBe(true);
      expect(describeClockSource(report)).toMatch(/COARSER THAN ITS SUBJECT/);
      expect(describeClockSource(report)).toMatch(/ceiling, not a measurement/);
    } else {
      // Under Node, `performance.now()` is not coarsened and this branch is
      // the honest one. The renderer is the environment that matters.
      expect(report.coarserThanSubject).toBe(false);
    }
  });
});
