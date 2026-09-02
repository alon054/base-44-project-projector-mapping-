import { describe, expect, it } from 'vitest';
import {
  CAPTURE_CAPACITY,
  DEFAULT_CAPACITY,
  FrameMetrics,
  LATE_FACTOR,
  MAX_LATE_FRACTION,
  MAX_LATE_RUN,
  MAX_MAGNITUDE_EVENTS,
  MAX_RENDER_FRACTION,
  formatReport,
  passesHeadroom,
  passesPresentation,
  percentile,
  unattributedMagnitude,
  validateNominal,
} from '../debug/hud';

const N60 = 1000 / 60;

/** Feed a sequence of presentation intervals, with an optional render cost each. */
function feed(m: FrameMetrics, intervals: readonly number[], render: number | number[] = 0): void {
  let t = 0;
  m.notePresentation(t);
  intervals.forEach((iv, i) => {
    m.noteRenderDuration(Array.isArray(render) ? (render[i] ?? 0) : render);
    t += iv;
    m.notePresentation(t);
  });
}

describe('percentile', () => {
  it('is 0 for empty input, not NaN', () => {
    expect(percentile([], 0.95)).toBe(0);
  });

  it('uses nearest-rank and includes the maximum at p95 for small n', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
    expect(percentile([5, 1, 3], 0.95)).toBe(5);
  });

  it('does not mutate its input', () => {
    const xs = [3, 1, 2];
    percentile(xs, 0.5);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe('FrameMetrics — SPEC.md §4 measurement protocol', () => {
  it('discards the warmup window', () => {
    const m = new FrameMetrics(N60, { warmupMs: 100 });
    // 9 frames of 10 ms reaches t=90: still inside warmup.
    feed(m, Array.from({ length: 9 }, () => 10));
    expect(m.warmedUp).toBe(false);
    expect(m.report().samples).toBe(0);
  });

  it('admits nothing until an interval lies wholly outside warmup', () => {
    const m = new FrameMetrics(N60, { warmupMs: 100 });
    // t=100 exactly: warmup has elapsed, but every interval so far either sat
    // inside it or straddled its boundary, so none was sampled.
    feed(m, Array.from({ length: 10 }, () => 10));
    expect(m.warmedUp).toBe(true);
    expect(m.report().samples).toBe(0);

    // The next interval starts at t=100 and is the first admissible one.
    m.notePresentation(110);
    expect(m.report().samples).toBe(1);
  });

  it('counts nothing as late when every interval is nominal', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, () => N60), 2);
    const r = m.report();
    expect(r.samples).toBe(100);
    expect(r.lateFraction).toBe(0);
    expect(r.worstLateRun).toBe(0);
    expect(r.fps).toBeCloseTo(60, 1);
    expect(passesPresentation(r)).toBe(true);
  });

  it('flags intervals over 1.5 x N as late', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    const intervals = Array.from({ length: 100 }, (_, i) =>
      i < 4 ? N60 * LATE_FACTOR + 0.01 : N60,
    );
    feed(m, intervals);
    const r = m.report();
    expect(r.lateFraction).toBeCloseTo(0.04, 5);
    expect(passesPresentation(r)).toBe(false); // 4 consecutive => run of 4
    expect(r.worstLateRun).toBe(4);
  });

  it('does not flag an interval exactly at 1.5 x N', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, [N60 * LATE_FACTOR, N60, N60]);
    expect(m.report().lateFraction).toBe(0);
  });

  it('fails gate metric 1 on late fraction alone', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    // 6 late in 100, spaced out so no run exceeds MAX_LATE_RUN.
    const intervals = Array.from({ length: 100 }, (_, i) => (i % 16 === 0 ? N60 * 3 : N60));
    feed(m, intervals);
    const r = m.report();
    expect(r.lateFraction).toBeGreaterThan(MAX_LATE_FRACTION);
    expect(r.worstLateRun).toBeLessThanOrEqual(MAX_LATE_RUN);
    expect(passesPresentation(r)).toBe(false);
  });

  it('fails gate metric 1 on a run of 3 even with a tiny late fraction', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    const intervals = Array.from({ length: 300 }, (_, i) => (i >= 10 && i <= 12 ? N60 * 2 : N60));
    feed(m, intervals);
    const r = m.report();
    expect(r.lateFraction).toBeLessThan(MAX_LATE_FRACTION);
    expect(r.worstLateRun).toBe(3);
    expect(passesPresentation(r)).toBe(false);
  });

  it('computes render p95 as a fraction of N — gate metric 2', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    // 90 cheap frames, 10 expensive ones: the expensive tail is wide enough to
    // reach p95.
    const render = Array.from({ length: 100 }, (_, i) => (i < 90 ? 4 : 15));
    feed(m, Array.from({ length: 100 }, () => N60), render);
    const r = m.report();
    expect(r.renderP95Ms).toBe(15);
    expect(r.renderP95OfNominal).toBeCloseTo(15 / N60, 5);
    expect(passesHeadroom(r)).toBe(false);
  });

  it('A10: p99 closes the seam that p95 left open at a 5% tail', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    // Exactly 5 expensive frames in 100 — precisely the tail gate metric 1 is
    // allowed to forgive. Nearest-rank p95 is the 95th smallest and reports the
    // CHEAP value, so a p95-gated metric 2 was structurally blind to the same
    // frames M1 permits: between them, nothing looked at that tail at all.
    // p99 looks into it. This test asserts the seam is CLOSED, not that it exists.
    const render = Array.from({ length: 100 }, (_, i) => (i < 95 ? 4 : 15));
    feed(m, Array.from({ length: 100 }, () => N60), render);
    const r = m.report();

    expect(r.renderP95Ms).toBe(4); // still blind — retained, informational only
    expect(r.renderP99Ms).toBe(15); // sees the tail
    expect(passesHeadroom(r)).toBe(false); // and the gate now fails on it
  });

  it('A10: the gate reads p99, so a p95-passing run with an expensive tail fails', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    // 96 cheap, 4 catastrophic. p95 = cheap and would have passed; p99 does not.
    const render = Array.from({ length: 100 }, (_, i) => (i < 96 ? 1 : N60 * 0.9));
    feed(m, Array.from({ length: 100 }, () => N60), render);
    const r = m.report();
    expect(r.renderP95OfNominal).toBeLessThan(MAX_RENDER_FRACTION);
    expect(r.renderP99OfNominal).toBeGreaterThan(MAX_RENDER_FRACTION);
    expect(passesHeadroom(r)).toBe(false);
  });

  it('separates the two metrics: smooth presentation, no headroom', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    // Every frame presented perfectly on time, but render eats 95% of N.
    feed(m, Array.from({ length: 200 }, () => N60), N60 * 0.95);
    const r = m.report();
    expect(passesPresentation(r)).toBe(true);
    expect(passesHeadroom(r)).toBe(false);
    expect(r.renderP99OfNominal).toBeGreaterThan(MAX_RENDER_FRACTION);
  });

  it('passes both metrics at the boundary of gate metric 2', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 200 }, () => N60), N60 * MAX_RENDER_FRACTION);
    const r = m.report();
    expect(passesPresentation(r)).toBe(true);
    expect(passesHeadroom(r)).toBe(true);
  });

  it('derives N from the display mode and resets when it changes', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 50 }, () => N60), 5);
    expect(m.report().samples).toBe(50);
    m.setNominalMs(1000 / 30);
    expect(m.nominal).toBeCloseTo(33.33, 2);
    expect(m.report().samples).toBe(0);
  });

  it('is a no-op when N is set to the value it already has', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 10 }, () => N60));
    m.setNominalMs(N60);
    expect(m.report().samples).toBe(10);
  });

  it('records the worst warmup interval without gating on it', () => {
    const m = new FrameMetrics(N60, { warmupMs: 100 });
    feed(m, [250, 20, 20, 20, 20, 20]);
    expect(m.warmupWorstMs).toBe(250);
    expect(m.report().worstIntervalMs).toBeLessThan(250);
  });

  it('rolls the window forward, dropping samples older than windowMs', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0, windowMs: 100 });
    feed(m, Array.from({ length: 60 }, () => 10));
    // 60 frames x 10 ms = 600 ms elapsed; a 100 ms window keeps ~10.
    expect(m.report().samples).toBeLessThanOrEqual(11);
    expect(m.report().samples).toBeGreaterThan(0);
  });

  it('reports zeroes rather than NaN before any sample arrives', () => {
    const r = new FrameMetrics(N60).report();
    expect(r.samples).toBe(0);
    expect(r.fps).toBe(0);
    expect(r.lateFraction).toBe(0);
    expect(r.renderP95Ms).toBe(0);
    expect(Number.isNaN(r.renderP95OfNominal)).toBe(false);
  });
});


/**
 * A9: no metric renders a number from unvalidated inputs. This is the guard for
 * the failure that produced a confident, precise, completely wrong gate number
 * — N never reached the metrics, every interval was compared against 0, and the
 * HUD reported "100% late" rather than reporting that it could not measure.
 */
describe('A9 — input validation', () => {
  it('N = 0 yields INVALID, never a percentage', () => {
    const m = new FrameMetrics(0, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, () => N60), 4);
    const r = m.report();
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toContain('must be > 0');
    // The critical part: not "100% late".
    expect(r.lateFraction).toBe(0);
    expect(r.renderP99OfNominal).toBe(0);
    expect(passesPresentation(r)).toBe(false);
    expect(passesHeadroom(r)).toBe(false);
  });

  it('N unset (undefined) yields INVALID', () => {
    const m = new FrameMetrics(undefined as unknown as number, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, () => N60), 4);
    const r = m.report();
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toContain('not a finite number');
    expect(passesHeadroom(r)).toBe(false);
  });

  it('N = 1000 ms is not a display mode and yields INVALID', () => {
    const m = new FrameMetrics(1000, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, () => N60), 4);
    const r = m.report();
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toContain('outside the plausible display range');
    expect(passesPresentation(r)).toBe(false);
  });

  it('NaN yields INVALID rather than propagating', () => {
    const m = new FrameMetrics(Number.NaN, { warmupMs: 0 });
    feed(m, Array.from({ length: 10 }, () => N60), 4);
    const r = m.report();
    expect(r.valid).toBe(false);
    expect(Number.isNaN(r.renderP99OfNominal)).toBe(false);
  });

  it('a real display mode is valid', () => {
    for (const hz of [24, 30, 60, 120, 144, 240]) {
      expect(validateNominal(1000 / hz).valid).toBe(true);
    }
  });

  it('formatReport says INVALID instead of printing derived numbers', () => {
    const m = new FrameMetrics(0, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, () => N60), 4);
    const text = formatReport(m.report(), false);
    expect(text).toContain('INVALID');
    expect(text).not.toContain('PASS');
  });

  it('an invalid N recorded mid-run resets rather than mixing two Ns', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 50 }, () => N60), 4);
    expect(m.report().samples).toBe(50);
    m.setNominalMs(0);
    expect(m.report().samples).toBe(0);
    expect(m.report().valid).toBe(false);
  });
});

/**
 * A12: rate and magnitude are separate facts. A low late-rate does not license
 * an unexplained stall, so every interval over 3 x N is surfaced individually
 * with the sample number it happened at.
 */
describe('A12 — magnitude, not just rate', () => {
  it('records an interval over 3 x N with its sample index', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    const intervals = Array.from({ length: 200 }, (_, i) => (i === 120 ? 67.7 : N60));
    feed(m, intervals, 0.4);
    const r = m.report();

    // The exact shape of the run that passed while hiding a four-frame stall.
    expect(passesPresentation(r)).toBe(true);
    expect(r.lateFraction).toBeLessThan(MAX_LATE_FRACTION);
    expect(r.worstLateRun).toBe(1);

    // ...and the stall is nonetheless reported, individually, for attribution.
    expect(r.magnitudeEvents).toHaveLength(1);
    expect(r.magnitudeEvents[0]!.intervalMs).toBeCloseTo(67.7, 5);
    expect(r.magnitudeEvents[0]!.index).toBe(121);
    expect(unattributedMagnitude(r)).toHaveLength(1);
  });

  it('an interval merely late (1.6 x N) is not a magnitude event', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, (_, i) => (i === 40 ? N60 * 1.6 : N60)), 0.4);
    const r = m.report();
    expect(r.lateFraction).toBeGreaterThan(0);
    expect(r.magnitudeEvents).toHaveLength(0);
  });

  it('a clean run reports no magnitude events', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 3601 }, () => 16.7), 0.4);
    expect(m.report().magnitudeEvents).toHaveLength(0);
  });

  it('the event list is bounded so a pathological run cannot grow it forever', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 400 }, () => N60 * 4), 0.4);
    expect(m.report().magnitudeEvents.length).toBeLessThanOrEqual(MAX_MAGNITUDE_EVENTS);
  });

  it('A9 before A12: an invalid N produces no magnitude events either', () => {
    const m = new FrameMetrics(0, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, (_, i) => (i === 50 ? 500 : N60)), 0.4);
    expect(m.report().magnitudeEvents).toHaveLength(0);
  });

  it('formatReport surfaces the stall rather than burying it in the rate', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 200 }, (_, i) => (i === 120 ? 67.7 : N60)), 0.4);
    const text = formatReport(m.report(), false);
    expect(text).toContain('M1 clause 3');
    expect(text).toContain('ATTRIBUTE EACH');
  });
});


/**
 * A14 — the measurement apparatus is subject to the budget it measures.
 * Three times the instrument has been the bug; these are the regression tests
 * for the class of failure, not for the three instances.
 */
describe('A14 — the instrument is subject to its own budget', () => {
  it('evicts by time without reallocating, and the window stays bounded', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0, windowMs: 1000, capacity: 256 });
    // 10 seconds of frames through a 1-second window.
    feed(m, Array.from({ length: 600 }, () => N60), 0.4);
    const r = m.report();
    // ~60 frames fit in a 1 s window at 60 Hz; never the full 600.
    expect(r.samples).toBeGreaterThan(50);
    expect(r.samples).toBeLessThan(70);
  });

  it('a ring overrun drops the oldest sample rather than growing', () => {
    // Window long enough that time-eviction never fires: only capacity bounds it.
    const cap = 64;
    const m = new FrameMetrics(N60, { warmupMs: 0, windowMs: 1e9, capacity: cap });
    feed(m, Array.from({ length: 500 }, () => N60), 0.4);
    expect(m.report().samples).toBe(cap);
  });

  it('the newest samples survive a ring overrun, not the oldest', () => {
    const cap = 8;
    const m = new FrameMetrics(N60, { warmupMs: 0, windowMs: 1e9, capacity: cap });
    // Render cost climbs; after overrun only the expensive tail should remain.
    const render = Array.from({ length: 100 }, (_, i) => i);
    feed(m, Array.from({ length: 100 }, () => N60), render);
    const r = m.report();
    expect(r.samples).toBe(cap);
    expect(r.renderP99Ms).toBe(99);
  });

  it('reports its own per-frame cost', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, () => N60), 0.4);
    m.noteInstrumentCost(0.01);
    m.noteInstrumentCost(0.05);
    m.noteInstrumentCost(0.03);
    const inst = m.report().instrument;
    expect(inst.perFrameMaxMs).toBe(0.05);
    expect(inst.perFrameMeanMs).toBeCloseTo(0.03, 10);
    expect(inst.maxShareOfNominal).toBeCloseTo(0.05 / N60, 10);
  });

  it('reports its own per-tick cost', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 10 }, () => N60), 0.4);
    m.noteInstrumentTick(0.42);
    expect(m.report().instrument.tickMs).toBe(0.42);
  });

  it('the instrument cost surfaces in the HUD, not only in the payload', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, () => N60), 0.4);
    m.noteInstrumentCost(0.02);
    expect(formatReport(m.report(), false)).toContain('instrument');
  });

  it('A9 before A14: an invalid N does not produce an instrument share either', () => {
    const m = new FrameMetrics(0, { warmupMs: 0 });
    feed(m, Array.from({ length: 10 }, () => N60), 0.4);
    m.noteInstrumentCost(0.02);
    expect(m.report().instrument.maxShareOfNominal).toBe(0);
  });

  it('reset clears the instrument counters with everything else', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 100 }, () => N60), 0.4);
    m.noteInstrumentCost(0.9);
    m.reset();
    const r = m.report();
    expect(r.samples).toBe(0);
    expect(r.instrument.perFrameMaxMs).toBe(0);
    expect(r.instrument.perFrameMeanMs).toBe(0);
  });

  it('the default capacity covers a 60 s window at the measured uncapped rate', () => {
    // ADD-2 measured ~823 fps uncapped; 60 s of that must not overrun the ring.
    expect(DEFAULT_CAPACITY).toBeGreaterThan(823 * 60);
  });

  it('steady-state reporting is stable — the same window reports the same numbers', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0, windowMs: 60_000 });
    feed(m, Array.from({ length: 3601 }, () => 16.7), 0.4);
    const a = m.report();
    const b = m.report();
    expect(b.samples).toBe(a.samples);
    expect(b.renderP99Ms).toBe(a.renderP99Ms);
    expect(b.lateFraction).toBe(a.lateFraction);
  });
});

describe('FrameMetrics — attribution support for unattended provocations', () => {
  it('captures exactly the armed number of following intervals', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    m.armCapture(4);
    feed(m, [1, 2, 3, 4, 5, 6]);
    expect(m.takeCapture()).toEqual([1, 2, 3, 4]);
  });

  it('a capture is single-use — reading it disarms', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    m.armCapture(3);
    feed(m, [1, 2, 3]);
    expect(m.takeCapture()).toEqual([1, 2, 3]);
    feed(m, [9, 9, 9]);
    expect(m.takeCapture()).toEqual([]);
  });

  it('never captures more than its preallocated capacity (A14: no growth)', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    m.armCapture(CAPTURE_CAPACITY + 50);
    feed(m, Array.from({ length: CAPTURE_CAPACITY + 100 }, () => N60));
    expect(m.takeCapture().length).toBe(CAPTURE_CAPACITY);
  });

  it('reset disarms a pending capture', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    m.armCapture(4);
    m.reset();
    feed(m, [1, 2, 3, 4]);
    expect(m.takeCapture()).toEqual([]);
  });

  it('holds the suspend gap and the frames after it, in order', () => {
    // The shape a provocation produces: normal frames, one long gap while the
    // surface is suspended, then the recovery. Only what follows the gap can
    // attribute a stall to resume — the gap itself is what we asked for.
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    m.armCapture(6);
    feed(m, [N60, N60, 2000, N60, N60, N60]);
    const trace = m.takeCapture();
    const peak = Math.max(...trace);
    expect(peak).toBe(2000);
    const after = trace.slice(trace.indexOf(peak) + 1);
    expect(after).toHaveLength(3);
    // Intervals are differences of an accumulated clock, so compare by value,
    // not by exact float identity.
    after.forEach((ms) => expect(ms).toBeCloseTo(N60, 6));
  });

  it('scopes max interval and clause-3 count to a post-warmup time range', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    // A 300 ms stall at about t=1.0 s, everything else nominal.
    const intervals = Array.from({ length: 120 }, (_, i) => (i === 60 ? 300 : N60));
    feed(m, intervals);
    const around = m.intervalsInElapsedRange(0.9, 1.4);
    expect(around.maxIntervalMs).toBe(300);
    expect(around.clause3).toBe(1);
    const before = m.intervalsInElapsedRange(0, 0.5);
    expect(before.clause3).toBe(0);
    expect(before.maxIntervalMs).toBeCloseTo(N60, 5);
  });

  it('an empty range reports zeroes rather than NaN', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    feed(m, Array.from({ length: 20 }, () => N60));
    expect(m.intervalsInElapsedRange(500, 600)).toEqual({
      maxIntervalMs: 0,
      samples: 0,
      clause3: 0,
    });
  });

  it('A9: an invalid N yields no clause-3 count from a range scan', () => {
    const m = new FrameMetrics(0, { warmupMs: 0 });
    feed(m, Array.from({ length: 60 }, (_, i) => (i === 30 ? 500 : N60)));
    const r = m.intervalsInElapsedRange(0, 10);
    expect(r.maxIntervalMs).toBe(500);
    expect(r.clause3).toBe(0);
  });
});
