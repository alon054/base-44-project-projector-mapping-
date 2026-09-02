import { describe, expect, it } from 'vitest';
import { PARAM_TEST_PATTERN_SPEED, assertJsonOnly } from '@shared/ipc';

describe('assertJsonOnly — I-7, no pixel buffers over IPC', () => {
  it('passes a realistic parameter payload', () => {
    const p = { key: PARAM_TEST_PATTERN_SPEED, value: 1.5, token: 7, t0: 1234.5 };
    expect(assertJsonOnly(p)).toBe(p);
  });

  it('passes nested plain structures', () => {
    expect(() =>
      assertJsonOnly({ a: [1, 'two', null, true, { b: [] }], c: {} }),
    ).not.toThrow();
  });

  it('rejects a typed array — the case the guard exists for', () => {
    expect(() => assertJsonOnly(new Float32Array(4))).toThrow(/I-7/);
    expect(() => assertJsonOnly(new Uint8ClampedArray(16))).toThrow(/I-7/);
  });

  it('rejects an ArrayBuffer', () => {
    expect(() => assertJsonOnly(new ArrayBuffer(8))).toThrow(/I-7/);
  });

  it('rejects a buffer smuggled inside a plain object', () => {
    expect(() => assertJsonOnly({ frame: { pixels: new Uint8Array(4) } })).toThrow(
      /payload\.frame\.pixels/,
    );
  });

  it('rejects a buffer smuggled inside an array', () => {
    expect(() => assertJsonOnly([{ ok: 1 }, new Uint16Array(2)])).toThrow(/payload\[1\]/);
  });

  it('rejects non-JSON scalars', () => {
    expect(() => assertJsonOnly(Number.NaN)).toThrow(/not JSON-representable/);
    expect(() => assertJsonOnly(Number.POSITIVE_INFINITY)).toThrow(/not JSON-representable/);
    expect(() => assertJsonOnly(undefined)).toThrow(/undefined is not JSON/);
    expect(() => assertJsonOnly(10n)).toThrow(/bigint/);
    expect(() => assertJsonOnly(Symbol('x'))).toThrow(/symbols/);
    expect(() => assertJsonOnly(() => 1)).toThrow(/functions/);
  });

  it('rejects class instances, including Date and Map', () => {
    expect(() => assertJsonOnly(new Date())).toThrow(/only plain objects/);
    expect(() => assertJsonOnly(new Map())).toThrow(/only plain objects/);
    expect(() => assertJsonOnly(new Set([1]))).toThrow(/only plain objects/);
  });

  it('rejects circular references instead of hanging', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => assertJsonOnly(a)).toThrow(/circular/);
  });

  it('accepts null and reuses object identity for repeat visits', () => {
    const shared = { v: 1 };
    expect(() => assertJsonOnly({ a: shared, b: shared, c: null })).not.toThrow();
  });
});
