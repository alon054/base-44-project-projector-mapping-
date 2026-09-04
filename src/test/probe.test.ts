/**
 * A8 — the render-multiplier probe's arithmetic. Pure logic, no GPU (§8.1);
 * the Pixi burst itself is exercised on hardware and recorded in `BUILD_LOG.md`.
 */
import { describe, expect, it } from 'vitest';
import { PROBE_ITERATIONS, computeK, perRenderFromBurst } from '../debug/probe';

const N60 = 1000 / 60;

describe('perRenderFromBurst — the readback must cancel', () => {
  it('subtracts the fixed GPU-sync cost exactly', () => {
    // A readback costing 20 ms and a render costing 2 ms.
    const readback = 20;
    const render = 2;
    const one = readback + render;
    const many = readback + render * 32;
    expect(perRenderFromBurst(one, many, 32)).toBeCloseTo(render, 10);
  });

  it('is independent of how large the readback is', () => {
    const render = 0.4;
    const a = perRenderFromBurst(1 + render, 1 + render * 32, 32);
    const b = perRenderFromBurst(500 + render, 500 + render * 32, 32);
    expect(a).toBeCloseTo(b, 10);
  });

  it('naive division by the iteration count would NOT cancel it — the reason this exists', () => {
    const readback = 20;
    const render = 2;
    const naive = (readback + render * 32) / 32; // 2.625, and it shrinks as n grows
    expect(naive).toBeGreaterThan(render);
    expect(perRenderFromBurst(readback + render, readback + render * 32, 32)).toBeCloseTo(render, 10);
  });

  it('clamps timing noise to 0 rather than reporting a negative cost', () => {
    expect(perRenderFromBurst(5, 4.9, 32)).toBe(0);
  });

  it('needs at least two points', () => {
    expect(perRenderFromBurst(1, 10, 1)).toBe(0);
    expect(perRenderFromBurst(1, 10, 0)).toBe(0);
  });

  it('the default iteration count is usable', () => {
    expect(PROBE_ITERATIONS).toBeGreaterThan(1);
  });
});

describe('computeK', () => {
  it('is how many times the scene fits into one frame interval', () => {
    expect(computeK(N60, N60)).toBeCloseTo(1, 10);
    expect(computeK(N60, N60 / 4)).toBeCloseTo(4, 10);
    expect(computeK(16, 0.4)).toBeCloseTo(40, 10);
  });

  it('A9: an unusable N yields 0, never a plausible wrong number', () => {
    expect(computeK(0, 0.4)).toBe(0);
    expect(computeK(Number.NaN, 0.4)).toBe(0);
    expect(computeK(1000, 0.4)).toBe(0);
    expect(computeK(undefined as unknown as number, 0.4)).toBe(0);
  });

  it('a zero or negative render cost yields 0, not Infinity', () => {
    expect(computeK(N60, 0)).toBe(0);
    expect(computeK(N60, -1)).toBe(0);
    expect(Number.isFinite(computeK(N60, 0))).toBe(true);
  });
});

describe('the fill-rate coefficient is what A8 is actually for', () => {
  const ratio = (devMs: number, targetMs: number): number =>
    computeK(N60, devMs) / computeK(N60, targetMs);

  it('a purely fill-rate-bound scene shows the 2.25x pixel ratio', () => {
    // 1920x1080 is 2.25x the pixels of 1280x720. If cost is all fill, k_target
    // is 2.25x smaller than k_dev — which is precisely what metric 2, timing
    // CPU only, cannot see.
    expect(ratio(1, 2.25)).toBeCloseTo(2.25, 6);
  });

  it('a purely CPU-bound scene shows ~1.0 and warns of nothing', () => {
    expect(ratio(1, 1)).toBeCloseTo(1, 6);
  });

  it('a mixed scene lands between the two, which is the useful signal', () => {
    const r = ratio(1, 1.6);
    expect(r).toBeGreaterThan(1);
    expect(r).toBeLessThan(2.25);
  });
});

/**
 * A8's Phase 3 ruling: fix the subject, then attack the spread.
 *
 * The probe carried two defects into Gate 3. It rendered `app.stage`, so with
 * the warp enabled it timed the mesh rather than the composite — k_dev 42-50
 * warp-off against 90-96 warp-on, which is not a speedup. And eight real-scene
 * samples spanned 0.9262-1.3269 against a theoretical 2.25 fill-bound / 1.0
 * CPU-bound, which makes a single sample a draw from a distribution rather than
 * a measurement. A1's thermal derate is a DELTA between two such draws, so the
 * second defect is the one that decides whether the derate can mean anything.
 *
 * The GPU half cannot be unit-tested (§8.1: no GPU). What is tested here is the
 * statistics the fix rests on, and the reporting that lets a reader tell a real
 * derate from the instrument's own noise.
 */
describe('A8 — median and spread (Phase 3)', () => {
  it('takes a real sample as the median for an odd count', async () => {
    const { median, PROBE_REPEATS } = await import('../debug/probe');
    // Odd on purpose: the median of an odd list is a number the instrument
    // actually produced, not the average of two it did not.
    expect(PROBE_REPEATS % 2).toBe(1);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1.3269, 0.9262, 1.0, 0.9655, 0.9815])).toBe(0.9815);
  });

  it('averages the middle pair for an even count, and handles the empty case', async () => {
    const { median } = await import('../debug/probe');
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(median([7])).toBe(7);
  });

  it('reports dispersion as a fraction of the median', async () => {
    const { spreadOf } = await import('../debug/probe');
    // The eight historical samples, as a single set: 0.9262 to 1.3269 about a
    // median of ~0.9908 is a spread of ~0.40. A derate smaller than that is
    // not a measurement of anything, and this is the number that says so.
    const historical = [1.3269, 0.9262, 1.2773, 0.9655, 1.0, 0.9815, 0.9649, 1.037];
    const spread = spreadOf(historical);
    expect(spread).toBeGreaterThan(0.3);
    expect(spread).toBeLessThan(0.5);
  });

  it('a single sample has no spread, and says so rather than implying precision', async () => {
    const { spreadOf } = await import('../debug/probe');
    expect(spreadOf([1.234])).toBe(0);
    expect(spreadOf([])).toBe(0);
  });

  it('spread is 0 for identical repeats', async () => {
    const { spreadOf } = await import('../debug/probe');
    expect(spreadOf([2, 2, 2, 2, 2])).toBe(0);
  });

  it('a zero or negative median cannot produce an infinite spread', async () => {
    const { spreadOf } = await import('../debug/probe');
    // A9: an instrument that emits a plausible wrong number is worse than one
    // that fails loudly. `Infinity%` dispersion is neither.
    expect(spreadOf([0, 0, 0])).toBe(0);
    expect(Number.isFinite(spreadOf([0, 1, 2]))).toBe(true);
  });

  it('the host probes the COMPOSITE, and a grep proves it', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../render/host.ts', import.meta.url).pathname,
      'utf8',
    );
    // The whole of A8's correctness defect was one argument. A grep, because
    // the failure is silent: `app.stage` produces confident numbers that
    // describe the warp mesh, and nothing anywhere says so.
    expect(src).toMatch(/runRenderMultiplierProbe\(\s*app\.renderer,\s*compositor\.view/);
    expect(src).not.toMatch(/runRenderMultiplierProbe\(\s*app\.renderer,\s*app\.stage/);
    expect(src).toMatch(/subject: 'composite'/);
  });
});
