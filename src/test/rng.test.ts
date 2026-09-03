/**
 * I-12 — seeded RNG. "Same state implies same intended look" only holds if the
 * stream is a pure function of scene state, so these tests are about
 * reproducibility and independence, not about statistical quality.
 */
import { describe, expect, it } from 'vitest';
import { createRng, hashString, layerRng, mixSeed } from '../core/rng';

const take = (n: number, rng: { next(): number }): number[] =>
  Array.from({ length: n }, () => rng.next());

describe('I-12 seeded RNG', () => {
  it('the same seed gives the same sequence', () => {
    expect(take(16, createRng(12345))).toEqual(take(16, createRng(12345)));
  });

  it('different seeds give different sequences', () => {
    expect(take(16, createRng(1))).not.toEqual(take(16, createRng(2)));
  });

  it('stays in [0, 1)', () => {
    const v = take(2000, createRng(7));
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThan(1);
  });

  it('derived helpers are in range', () => {
    const r = createRng(99);
    for (let i = 0; i < 500; i++) {
      expect(r.range(-3, 5)).toBeGreaterThanOrEqual(-3);
    }
    const r2 = createRng(99);
    for (let i = 0; i < 500; i++) {
      const n = r2.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
    const r3 = createRng(99);
    for (let i = 0; i < 500; i++) {
      const s = r3.signed();
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThan(1);
    }
  });

  it('int(0) and int(-1) do not produce NaN or a negative index', () => {
    const r = createRng(3);
    expect(r.int(0)).toBe(0);
    expect(r.int(-1)).toBe(0);
  });

  it('is stable across builds — a pinned sequence, so a refactor that changes the stream is caught', () => {
    // Re-blessing this array re-blesses every golden frame with it. Do it
    // deliberately, in a commit that says why (§8.1).
    const got = take(4, createRng(1)).map((v) => Number(v.toFixed(9)));
    expect(got).toEqual([0.627073941, 0.002735721, 0.52744704, 0.981050967]);
  });
});

describe('seed mixing', () => {
  it('hashString is stable and unsigned', () => {
    expect(hashString('layer-1')).toBe(hashString('layer-1'));
    expect(hashString('layer-1')).not.toBe(hashString('layer-2'));
    expect(hashString('')).toBeGreaterThanOrEqual(0);
  });

  it('mixSeed is order-dependent — (a,b) must not collide with (b,a)', () => {
    expect(mixSeed(3, 9)).not.toBe(mixSeed(9, 3));
  });
});

describe('I-12 layer stream independence', () => {
  it('editing one layer cannot shift another layer stream', () => {
    const sceneSeed = 4242;
    const a1 = take(8, layerRng(sceneSeed, 111));
    // A second layer is added, deleted, and re-added. Its stream is consumed
    // heavily in between, which a single shared generator would leak into `a`.
    take(1000, layerRng(sceneSeed, 222));
    const a2 = take(8, layerRng(sceneSeed, 111));
    expect(a2).toEqual(a1);
  });

  it('two layers with different seeds draw different numbers', () => {
    expect(take(8, layerRng(1, 111))).not.toEqual(take(8, layerRng(1, 222)));
  });

  it('the same layer under a different scene seed draws different numbers', () => {
    expect(take(8, layerRng(1, 111))).not.toEqual(take(8, layerRng(2, 111)));
  });

  it('labelled streams within one layer are independent', () => {
    const pos = take(8, layerRng(1, 111, 'positions'));
    const col = take(8, layerRng(1, 111, 'colours'));
    expect(pos).not.toEqual(col);
    expect(take(8, layerRng(1, 111, 'positions'))).toEqual(pos);
  });
});
