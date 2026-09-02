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
