/**
 * §8.1's I-17 group, and Gate 5's path conditions.
 *
 * Written before any UI exists, which is Block A's whole point: the primitive
 * that Phase 6's surfaces and Phase 5's routes both depend on gets its
 * behaviour pinned while it is still small enough to reason about, rather than
 * inferred later from what the drawing tool happens to produce.
 */
import { describe, expect, it } from 'vitest';
import {
  PATH_INTERPOLATIONS,
  PathFormatError,
  canonicalizePath,
  createPath,
  deserializePath,
  pathLength,
  pathSegments,
  pointAtProgress,
  pointAtTime,
  progressAlong,
  serializePath,
  simplifyPath,
  simplifyPoints,
  type PathPoint,
} from '../core/paths';

const pts = (...xy: [number, number][]): PathPoint[] => xy.map(([x, y]) => ({ x, y }));

describe('I-17 — a path round-trips deep-equal with both fields', () => {
  it('round-trips an open path', () => {
    const p = createPath({ id: 'route', points: pts([0, 0], [0.5, 0.25], [1, 1]) });
    expect(deserializePath(serializePath(p))).toEqual(p);
  });

  it('round-trips a closed path', () => {
    const p = createPath({
      id: 'window',
      points: pts([0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]),
      closed: true,
    });
    expect(deserializePath(serializePath(p))).toEqual(p);
  });

  it('carries `closed` and `interpolation` through the round trip, not just points', () => {
    const p = createPath({ id: 'p', points: pts([0, 0], [1, 1]), closed: true });
    const back = deserializePath(serializePath(p));
    expect(back.closed).toBe(true);
    expect(back.interpolation).toBe('linear');
  });

  it('round-trips an empty path and a single-point path', () => {
    for (const points of [pts(), pts([0.5, 0.5])]) {
      const p = createPath({ id: 'degenerate', points });
      expect(deserializePath(serializePath(p))).toEqual(p);
    }
  });
});

describe('I-17 / S5 — `interpolation` has exactly one legal value', () => {
  it('has exactly one legal value today', () => {
    expect(PATH_INTERPOLATIONS).toEqual(['linear']);
  });

  it('defaults to linear when the field is absent', () => {
    expect(canonicalizePath({ id: 'p', points: [] }).interpolation).toBe('linear');
  });

  it('accepts linear', () => {
    expect(canonicalizePath({ id: 'p', points: [], interpolation: 'linear' }).interpolation).toBe(
      'linear',
    );
  });

  it('REFUSES any other value, rather than falling back to linear', () => {
    // A curve silently rendered as a polyline is a plausible wrong answer (A9).
    for (const bad of ['bezier', 'catmull-rom', 'smooth', '', 0, null, true]) {
      expect(() => canonicalizePath({ id: 'p', points: [], interpolation: bad })).toThrow(
        PathFormatError,
      );
    }
  });

  it('names the offending value AND the legal set in the message', () => {
    expect(() => canonicalizePath({ id: 'p', points: [], interpolation: 'bezier' })).toThrow(
      /"bezier".*"linear"/s,
    );
  });
});

describe('I-1 — every stored point is normalized', () => {
  it('clamps out-of-range coordinates, the way every other stored position does', () => {
    const p = canonicalizePath({
      id: 'p',
      points: [
        { x: -0.5, y: 2 },
        { x: 1.5, y: -3 },
      ],
    });
    expect(p.points).toEqual(pts([0, 1], [1, 0]));
  });

  it('every point of a canonicalized path is inside [0,1]', () => {
    const p = canonicalizePath({
      id: 'p',
      points: [
        { x: -9, y: 0.5 },
        { x: 0.25, y: 42 },
        { x: 0.5, y: 0.5 },
      ],
    });
    for (const q of p.points) {
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.x).toBeLessThanOrEqual(1);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeLessThanOrEqual(1);
    }
  });

  it('createPath clamps too, so a path cannot be built out of range in the first place', () => {
    expect(createPath({ id: 'p', points: pts([-1, 5]) }).points).toEqual(pts([0, 1]));
  });

  it('REFUSES a non-number coordinate rather than defaulting it to zero', () => {
    // Clamping is for numbers out of range. A missing or non-numeric coordinate
    // is not a number at all, and a point silently at the origin is a shape
    // that is wrong in a way nobody can see.
    for (const bad of [undefined, null, '0.5', NaN, Infinity, {}]) {
      expect(() => canonicalizePath({ id: 'p', points: [{ x: bad, y: 0.5 }] })).toThrow(
        PathFormatError,
      );
      expect(() => canonicalizePath({ id: 'p', points: [{ x: 0.5, y: bad }] })).toThrow(
        PathFormatError,
      );
    }
  });

  it('names the path, the point index and the value it refused', () => {
    expect(() => canonicalizePath({ id: 'outline', points: [{ x: 'nope', y: 0 }] })).toThrow(
      /"outline".*point 0\.x.*"nope"/s,
    );
  });
});

describe('Gate 5 — open and closed paths are the SAME stored type, one flag apart', () => {
  const square = pts([0, 0], [1, 0], [1, 1], [0, 1]);

  it('differ in exactly one field, demonstrated rather than asserted in prose', () => {
    const open = createPath({ id: 'p', points: square, closed: false });
    const closed = createPath({ id: 'p', points: square, closed: true });

    const differing = (Object.keys(open) as (keyof typeof open)[]).filter(
      (k) => JSON.stringify(open[k]) !== JSON.stringify(closed[k]),
    );
    expect(differing).toEqual(['closed']);
  });

  it('serialize to JSON differing only in the `closed` value', () => {
    const open = serializePath(createPath({ id: 'p', points: square, closed: false }));
    const closed = serializePath(createPath({ id: 'p', points: square, closed: true }));
    expect(open.replace('"closed":false', '"closed":true')).toBe(closed);
  });

  it('flipping the flag on a stored path is the whole conversion', () => {
    const open = createPath({ id: 'p', points: square });
    const closed = deserializePath(serializePath({ ...open, closed: true }));
    expect(closed).toEqual({ ...open, closed: true });
  });

  it('the flag changes only the DERIVED geometry: one extra segment', () => {
    const open = createPath({ id: 'p', points: square, closed: false });
    const closed = createPath({ id: 'p', points: square, closed: true });
    expect(pathSegments(open)).toHaveLength(3);
    expect(pathSegments(closed)).toHaveLength(4);
    // ...and the extra one joins last back to first.
    expect(pathSegments(closed)[3]).toEqual({ a: { x: 0, y: 1 }, b: { x: 0, y: 0 } });
  });

  it('a closed unit square is longer than the open one by exactly the closing side', () => {
    const open = createPath({ id: 'p', points: square, closed: false });
    const closed = createPath({ id: 'p', points: square, closed: true });
    expect(pathLength(closed) - pathLength(open)).toBeCloseTo(1, 12);
  });
});

describe('I-2 / I-16 — route progress is DERIVED from the clock, never accumulated', () => {
  it('progress is a pure function of time: the same time always gives the same answer', () => {
    for (const t of [0, 1, 250, 999, 1000, 4321, 60_000]) {
      expect(progressAlong(t, 4)).toBe(progressAlong(t, 4));
    }
  });

  it('is monotonic within a loop', () => {
    const period = 10;
    let prev = -1;
    for (let t = 0; t < period * 1000; t += 137) {
      const p = progressAlong(t, period);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('wraps at the period rather than running away', () => {
    expect(progressAlong(0, 4)).toBeCloseTo(0, 12);
    expect(progressAlong(2000, 4)).toBeCloseTo(0.5, 12);
    expect(progressAlong(4000, 4)).toBeCloseTo(0, 12);
    expect(progressAlong(6000, 4)).toBeCloseTo(0.5, 12);
  });

  it('going back in time returns the earlier position exactly — no accumulated state', () => {
    const path = createPath({ id: 'r', points: pts([0, 0], [1, 0]) });
    const early = pointAtTime(path, 1000, 8);
    // Walk far forward, then ask for the earlier time again.
    for (let t = 1000; t < 90_000; t += 250) pointAtTime(path, t, 8);
    expect(pointAtTime(path, 1000, 8)).toEqual(early);
  });

  it('a nonsense period holds still rather than yielding NaN (I-13)', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(progressAlong(1234, bad)).toBe(0);
    }
  });
});

describe('point at progress along a path', () => {
  const line = createPath({ id: 'r', points: pts([0, 0], [1, 0]) });

  it('lands on the endpoints at 0 and 1', () => {
    expect(pointAtProgress(line, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAtProgress(line, 1)).toEqual({ x: 1, y: 0 });
  });

  it('interpolates linearly along a straight run', () => {
    expect(pointAtProgress(line, 0.25).x).toBeCloseTo(0.25, 12);
    expect(pointAtProgress(line, 0.5).x).toBeCloseTo(0.5, 12);
  });

  it('spends progress in proportion to LENGTH, not to point count', () => {
    // A long segment then a short one: half the progress must not mean the
    // midpoint of the point list.
    const p = createPath({ id: 'r', points: pts([0, 0], [0.9, 0], [1, 0]) });
    expect(pointAtProgress(p, 0.5).x).toBeCloseTo(0.5, 12);
  });

  it('returns to the start of a closed path at progress 1', () => {
    const p = createPath({ id: 'r', points: pts([0, 0], [1, 0], [1, 1], [0, 1]), closed: true });
    expect(pointAtProgress(p, 1)).toEqual({ x: 0, y: 0 });
  });

  it('a zero-length or empty path holds still rather than yielding NaN (I-13)', () => {
    expect(pointAtProgress(createPath({ id: 'r', points: pts() }), 0.5)).toEqual({ x: 0, y: 0 });
    expect(pointAtProgress(createPath({ id: 'r', points: pts([0.3, 0.7]) }), 0.5)).toEqual({
      x: 0.3,
      y: 0.7,
    });
    const degenerate = createPath({ id: 'r', points: pts([0.2, 0.2], [0.2, 0.2]) });
    const q = pointAtProgress(degenerate, 0.5);
    expect(Number.isNaN(q.x)).toBe(false);
    expect(q).toEqual({ x: 0.2, y: 0.2 });
  });
});

describe('simplification is deterministic for a given input and tolerance', () => {
  // A freehand-ish stroke: a straight run with jitter, then a real corner.
  const stroke = (): PathPoint[] => {
    const out: PathPoint[] = [];
    for (let i = 0; i <= 40; i++) out.push({ x: i / 80, y: 0.5 + (i % 2 === 0 ? 0.0005 : -0.0005) });
    for (let i = 1; i <= 40; i++) out.push({ x: 0.5, y: 0.5 + i / 80 });
    return out;
  };

  it('the same input and tolerance give a bit-identical result, every time', () => {
    const a = simplifyPoints(stroke(), 0.01);
    for (let i = 0; i < 20; i++) {
      expect(simplifyPoints(stroke(), 0.01)).toEqual(a);
    }
  });

  it('a different tolerance gives a different result — the parameter is real', () => {
    const loose = simplifyPoints(stroke(), 0.05);
    const tight = simplifyPoints(stroke(), 0.0001);
    expect(loose.length).toBeLessThan(tight.length);
  });

  it('removes the jitter but keeps the corner', () => {
    const out = simplifyPoints(stroke(), 0.01);
    expect(out.length).toBeLessThan(10);
    // The corner survives. It sits at (0.5, 0.5005), not (0.5, 0.5): the last
    // point of the horizontal run carries the jitter like every other point in
    // it, and the tolerance here is the jitter amplitude rather than an
    // epsilon. Asserting the idealised corner instead would have passed only by
    // accident of where the simplifier happened to cut.
    expect(out.some((p) => Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.5) < 1e-3)).toBe(true);
  });

  it('always keeps both endpoints, so a closed shape does not change topology', () => {
    const s = stroke();
    const out = simplifyPoints(s, 0.05);
    expect(out[0]).toEqual(s[0]);
    expect(out[out.length - 1]).toEqual(s[s.length - 1]);
  });

  it('a tolerance of zero and a short path are returned unchanged', () => {
    const s = stroke();
    expect(simplifyPoints(s, 0)).toEqual(s);
    expect(simplifyPoints(pts([0, 0], [1, 1]), 0.5)).toEqual(pts([0, 0], [1, 1]));
  });

  it('a non-finite tolerance is treated as zero, not as NaN', () => {
    const s = stroke();
    for (const bad of [NaN, Infinity, -1]) expect(simplifyPoints(s, bad)).toEqual(s);
  });

  it('does not mutate its input', () => {
    const s = stroke();
    const copy = s.map((p) => ({ ...p }));
    simplifyPoints(s, 0.01);
    expect(s).toEqual(copy);
  });

  it('reports the point count before and after, so Gate 5 does not have to count', () => {
    const p = createPath({ id: 'freehand', points: stroke() });
    const r = simplifyPath(p, 0.01);
    expect(r.before).toBe(81);
    expect(r.after).toBe(r.path.points.length);
    expect(r.after).toBeLessThan(r.before);
  });

  it('preserves `closed` and `interpolation` through simplification', () => {
    const p = createPath({ id: 'freehand', points: stroke(), closed: true });
    const r = simplifyPath(p, 0.01);
    expect(r.path.closed).toBe(true);
    expect(r.path.interpolation).toBe('linear');
    expect(r.path.id).toBe('freehand');
  });

  it('a simplified path still round-trips deep-equal', () => {
    const p = createPath({ id: 'freehand', points: stroke(), closed: true });
    const s = simplifyPath(p, 0.01).path;
    expect(deserializePath(serializePath(s))).toEqual(s);
  });
});

describe('the canonicalizer refuses malformed paths loudly', () => {
  it('refuses a non-object', () => {
    for (const bad of [null, undefined, 42, 'path', []]) {
      expect(() => canonicalizePath(bad)).toThrow(PathFormatError);
    }
  });

  it('refuses a missing or empty id', () => {
    expect(() => canonicalizePath({ points: [] })).toThrow(/id/);
    expect(() => canonicalizePath({ id: '', points: [] })).toThrow(/id/);
  });

  it('refuses points that are not an array', () => {
    expect(() => canonicalizePath({ id: 'p', points: 'nope' })).toThrow(/must be an array/);
  });

  it('treats a missing `closed` as open rather than throwing', () => {
    expect(canonicalizePath({ id: 'p', points: [] }).closed) .toBe(false);
    // Only an explicit `true` closes it — a truthy string does not.
    expect(canonicalizePath({ id: 'p', points: [], closed: 'yes' }).closed).toBe(false);
  });

  it('refuses invalid JSON with a message naming the cause', () => {
    expect(() => deserializePath('{oops')).toThrow(/not valid JSON/);
  });
});
