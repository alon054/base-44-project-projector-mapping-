import { describe, expect, it } from 'vitest';
import {
  FrameMetrics,
  LATE_FACTOR,
  MAX_LATE_FRACTION,
  MAX_LATE_RUN,
  MAX_RENDER_FRACTION,
  passesHeadroom,
  passesPresentation,
  percentile,
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

  it('p95 is blind to a tail of exactly 5% — the deliberate seam between the two metrics', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    // Exactly 5 expensive frames in 100. Nearest-rank p95 is the 95th smallest,
    // so it reports the cheap value. Gate metric 1 is what governs this tail;
    // gate metric 2 governs the body. Recorded here so the seam is a decision,
    // not a surprise at Phase 9.
    const render = Array.from({ length: 100 }, (_, i) => (i < 95 ? 4 : 15));
    feed(m, Array.from({ length: 100 }, () => N60), render);
    expect(m.report().renderP95Ms).toBe(4);
  });

  it('separates the two metrics: smooth presentation, no headroom', () => {
    const m = new FrameMetrics(N60, { warmupMs: 0 });
    // Every frame presented perfectly on time, but render eats 95% of N.
    feed(m, Array.from({ length: 200 }, () => N60), N60 * 0.95);
    const r = m.report();
    expect(passesPresentation(r)).toBe(true);
    expect(passesHeadroom(r)).toBe(false);
    expect(r.renderP95OfNominal).toBeGreaterThan(MAX_RENDER_FRACTION);
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
