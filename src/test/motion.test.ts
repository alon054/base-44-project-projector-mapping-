/**
 * §8.1's I-18 group, and Gate 5's motion conditions.
 *
 * Written before any UI, any renderer and any editor field exists, which is
 * P5-A's precedent: the arithmetic that Phase 5's routes and Phase 7's groups
 * both stand on gets pinned while it is small enough to reason about, rather
 * than inferred later from whatever the editor happens to send.
 *
 * The load-bearing group is `I-18 — progress is derived, never accumulated`.
 * Everything else here is a boundary or a spelling; that one is the invariant.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLOBAL_LOOP_SECONDS, phaseAt } from '../core/clock';
import { createPath, pathLength, type PathPoint } from '../core/paths';
import {
  DEFAULT_ROUTE_MOTION,
  MOTION_PERIOD_MAX_SECONDS,
  MOTION_PERIOD_MIN_SECONDS,
  MotionFormatError,
  ROUTE_END_BEHAVIORS,
  assertRouteTraversable,
  canonicalizeRoute,
  canonicalizeRouteMotion,
  createRouteMotion,
  deserializeRouteMotion,
  headingAtMotion,
  headingAtProgress,
  isRouteEndBehavior,
  pointAtMotion,
  pointAtProgress,
  progressAlong,
  progressAt,
  segmentAtProgress,
  serializeRouteMotion,
  type RouteMotion,
} from '../core/motion';
import { ParameterRegistry, defineMotionParameters } from '../core/parameters';

const pts = (...xy: [number, number][]): PathPoint[] => xy.map(([x, y]) => ({ x, y }));

/** A straight run of unit-ish length, so progress and x are the same number. */
const line = () => createPath({ id: 'route', points: pts([0, 0.5], [1, 0.5]) });

/** An L: right along the top, then down. Two segments, unequal lengths. */
const corner = () =>
  createPath({ id: 'corner', points: pts([0, 0], [0.8, 0], [0.8, 0.6]) });

const motion = (init?: Partial<RouteMotion>): RouteMotion => createRouteMotion(init);

// ─────────────────────────────────────────────────────────────────────────────

describe('I-18 — `RouteMotion` is exactly the four fields the spec states, plus B5\'s `travelRole`', () => {
  it('has the three end behaviours, in the spec\'s order', () => {
    expect(ROUTE_END_BEHAVIORS).toEqual(['loop', 'pingpong', 'hold']);
  });

  it('accepts only those three', () => {
    for (const good of ROUTE_END_BEHAVIORS) expect(isRouteEndBehavior(good)).toBe(true);
    for (const bad of ['bounce', 'once', 'reverse', '', 0, null, true]) {
      expect(isRouteEndBehavior(bad)).toBe(false);
    }
  });

  it('a default record carries all five fields with stated values, never undefined', () => {
    expect(DEFAULT_ROUTE_MOTION).toEqual({
      periodSeconds: GLOBAL_LOOP_SECONDS,
      orient: false,
      endBehavior: 'loop',
      phaseOffset: 0,
      // B5. `''` is "no route declared" — what every layer had before the field.
      travelRole: '',
    });
    expect(Object.keys(createRouteMotion()).sort()).toEqual([
      'endBehavior',
      'orient',
      'periodSeconds',
      'phaseOffset',
      'travelRole',
    ]);
  });

  it('B5: travelRole is a free string; a non-string is refused naming the value', () => {
    expect(canonicalizeRouteMotion({ travelRole: 'route' }).travelRole).toBe('route');
    expect(canonicalizeRouteMotion({ travelRole: null }).travelRole).toBe('');
    expect(() => canonicalizeRouteMotion({ travelRole: 3 })).toThrow(/travelRole.*3/);
    expect(() => canonicalizeRouteMotion({ travelRole: {} })).toThrow(MotionFormatError);
  });

  it('a layer with no motion canonicalizes to the defaults, not to undefined', () => {
    for (const absent of [undefined, null]) {
      const m = canonicalizeRouteMotion(absent);
      expect(m).toEqual(DEFAULT_ROUTE_MOTION);
      for (const v of Object.values(m)) expect(v).not.toBeUndefined();
    }
  });

  it('round-trips deep-equal, all five fields', () => {
    for (const m of [
      createRouteMotion(),
      motion({ periodSeconds: 12.5, orient: true, endBehavior: 'pingpong', phaseOffset: 0.75 }),
      motion({ endBehavior: 'hold' }),
      motion({ travelRole: 'route', orient: true }),
    ]) {
      expect(deserializeRouteMotion(serializeRouteMotion(m))).toEqual(m);
    }
  });

  it('a partially stated record fills the rest from the defaults', () => {
    expect(canonicalizeRouteMotion({ periodSeconds: 9 })).toEqual({
      ...DEFAULT_ROUTE_MOTION,
      periodSeconds: 9,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('I-18 — progress is derived, never accumulated', () => {
  it('walking 90 s forward and then asking for an earlier time gives the exact earlier answer', () => {
    // The load-bearing test. An accumulated position passes the forward walk
    // and fails this line, which is the whole difference between a derived
    // playhead and a counted one (I-2, I-16).
    for (const endBehavior of ROUTE_END_BEHAVIORS) {
      const m = motion({ periodSeconds: 7, endBehavior, phaseOffset: 0.3 });
      const before = progressAt(10, m);
      for (let t = 0; t <= 90; t += 0.25) progressAt(t, m);
      expect(progressAt(10, m)).toBe(before);
    }
  });

  it('is a pure function of its two arguments — same input, same bits, any order', () => {
    const m = motion({ periodSeconds: 3.7, endBehavior: 'pingpong', phaseOffset: 0.42 });
    const ascending = [0, 1, 2, 5, 13, 88].map((t) => progressAt(t, m));
    const descending = [88, 13, 5, 2, 1, 0].map((t) => progressAt(t, m)).reverse();
    expect(descending).toEqual(ascending);
  });

  it('stays inside [0,1] for every behaviour, over a long walk', () => {
    for (const endBehavior of ROUTE_END_BEHAVIORS) {
      const m = motion({ periodSeconds: 2.5, endBehavior, phaseOffset: 0.6 });
      for (let t = 0; t <= 200; t += 0.13) {
        const p = progressAt(t, m);
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it('holds still rather than going NaN on a nonsense time', () => {
    const m = motion({ periodSeconds: 4 });
    for (const t of [NaN, Infinity, -Infinity]) expect(progressAt(t, m)).toBe(0);
  });

  it('refuses an unknown endBehavior that reached it past the canonicalizer', () => {
    // Cannot arrive from a scene file; means a caller skipped the boundary.
    const smuggled = { ...DEFAULT_ROUTE_MOTION, endBehavior: 'bounce' } as unknown as RouteMotion;
    expect(() => progressAt(1, smuggled)).toThrow(MotionFormatError);
    expect(() => progressAt(1, smuggled)).toThrow(/bounce/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('I-2 — `loop` is `phaseAt`, reused and not reimplemented', () => {
  it('is bit-identical to `progressAlong`, which is bit-identical to `phaseAt`', () => {
    const m = motion({ periodSeconds: 6, endBehavior: 'loop' });
    for (let t = 0; t <= 40; t += 0.37) {
      expect(progressAlong(t * 1000, 6)).toBe(phaseAt(t * 1000, 6));
      expect(progressAt(t, m)).toBe(progressAlong(t * 1000, 6));
    }
  });

  it('shifts by phaseOffset, and the shift is the time rather than the answer', () => {
    const m = motion({ periodSeconds: 4, endBehavior: 'loop', phaseOffset: 0.25 });
    expect(progressAt(0, m)).toBeCloseTo(0.25, 12);
    expect(progressAt(1, m)).toBeCloseTo(0.5, 12);
    // Bit-identical to asking the one function for the shifted time.
    for (let t = 0; t <= 20; t += 0.41) {
      expect(progressAt(t, m)).toBe(progressAlong((t + 0.25 * 4) * 1000, 4));
    }
  });

  it('two entities on one route differ only in phaseOffset', () => {
    const a = motion({ periodSeconds: 5, phaseOffset: 0 });
    const b = motion({ periodSeconds: 5, phaseOffset: 0.5 });
    for (let t = 0; t <= 25; t += 0.29) {
      expect(progressAt(t, b)).toBeCloseTo(progressAt(t + 2.5, a), 12);
    }
  });

  it('wraps at the period rather than climbing past 1', () => {
    const m = motion({ periodSeconds: 4, endBehavior: 'loop' });
    expect(progressAt(4, m)).toBe(0);
    expect(progressAt(8, m)).toBe(0);
    expect(progressAt(2, m)).toBeCloseTo(0.5, 12);
  });

  it('the source of `motion.ts` contains no phase arithmetic of its own', () => {
    // The grep in this block's "Done when", as a mechanism rather than a
    // one-time check: a later hand reaching for `% 1` or `Math.floor` in here
    // is reimplementing I-2's one function and the suite says so.
    const code = readFileSync(new URL('../core/motion.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/%/);
    expect(code).not.toMatch(/Math\.floor/);
    expect(code).toMatch(/progressAlong\(/);
  });
});

describe('I-18 — `pingpong` is a triangle over 2 × period', () => {
  const m = motion({ periodSeconds: 4, endBehavior: 'pingpong' });

  it('goes out over the first period and back over the second', () => {
    expect(progressAt(0, m)).toBe(0);
    expect(progressAt(2, m)).toBeCloseTo(0.5, 12);
    expect(progressAt(4, m)).toBeCloseTo(1, 12);
    expect(progressAt(6, m)).toBeCloseTo(0.5, 12);
    expect(progressAt(8, m)).toBeCloseTo(0, 12);
  });

  it('is symmetric about the turn, which is what makes it a triangle and not a saw', () => {
    for (let d = 0; d <= 4; d += 0.17) {
      expect(progressAt(4 - d, m)).toBeCloseTo(progressAt(4 + d, m), 12);
    }
  });

  it('repeats every 2 × period', () => {
    for (let t = 0; t <= 8; t += 0.31) {
      expect(progressAt(t + 8, m)).toBeCloseTo(progressAt(t, m), 12);
    }
  });

  it('phaseOffset shifts by a traversal, not by a cycle', () => {
    // Offset 0.5 puts the entity half a TRAVERSAL ahead, the same meaning the
    // offset has under `loop`. Anything else would make one field mean two
    // things depending on a neighbouring field's value.
    const offset = motion({ periodSeconds: 4, endBehavior: 'pingpong', phaseOffset: 0.5 });
    expect(offset.phaseOffset).toBe(0.5);
    expect(progressAt(0, offset)).toBeCloseTo(0.5, 12);
    expect(progressAt(2, offset)).toBeCloseTo(1, 12);
  });
});

describe('I-18 — `hold` is min(1, t / period + phaseOffset)', () => {
  it('matches the spec\'s expression term for term', () => {
    const m = motion({ periodSeconds: 4, endBehavior: 'hold', phaseOffset: 0.25 });
    for (const t of [0, 0.5, 1, 2, 2.9]) {
      expect(progressAt(t, m)).toBeCloseTo(Math.min(1, t / 4 + 0.25), 12);
    }
  });

  it('reaches 1 and stays there rather than wrapping', () => {
    const m = motion({ periodSeconds: 4, endBehavior: 'hold' });
    expect(progressAt(4, m)).toBe(1);
    expect(progressAt(400, m)).toBe(1);
    expect(progressAt(4000, m)).toBe(1);
  });

  it('an offset brings the arrival forward by that fraction of the period', () => {
    const m = motion({ periodSeconds: 10, endBehavior: 'hold', phaseOffset: 0.9 });
    expect(progressAt(0, m)).toBeCloseTo(0.9, 12);
    expect(progressAt(1, m)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('I-18 — position resolves by arc length, so speed is constant', () => {
  it('an unevenly spaced path travels identically to an evenly spaced one', () => {
    // Gate condition: points at [0, 0.1, 0.9, 1.0] cover the same distance per
    // unit time as [0, 1/3, 2/3, 1], within 1e-9.
    const uneven = createPath({
      id: 'uneven',
      points: pts([0, 0.5], [0.1, 0.5], [0.9, 0.5], [1, 0.5]),
    });
    const even = createPath({
      id: 'even',
      points: pts([0, 0.5], [1 / 3, 0.5], [2 / 3, 0.5], [1, 0.5]),
    });
    expect(pathLength(uneven)).toBeCloseTo(pathLength(even), 12);
    for (let u = 0; u <= 1.0000001; u += 0.005) {
      const a = pointAtProgress(uneven, Math.min(1, u));
      const b = pointAtProgress(even, Math.min(1, u));
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-9);
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-9);
    }
  });

  it('covers equal distance in equal time on a path with unequal segments', () => {
    // The L's two runs are 0.8 and 0.6 long. Equal steps in progress must cover
    // equal distance on BOTH, which is the whole of "arc length, not point
    // index" — an index walk would spend half the time on each run and move at
    // two different speeds.
    //
    // Exactly one step is allowed to come up short: the one containing the
    // corner, where the straight line between two samples cuts across it. That
    // is the chord being shorter than the arc, not the speed changing, so the
    // test names it and requires there to be exactly one rather than waving at
    // a tolerance wide enough to hide a second.
    const p = corner();
    const total = pathLength(p);
    const steps = 200;
    const expected = total / steps;
    let previous = pointAtProgress(p, 0);
    let shortSteps = 0;
    for (let i = 1; i <= steps; i++) {
      const next = pointAtProgress(p, i / steps);
      const d = Math.hypot(next.x - previous.x, next.y - previous.y);
      if (Math.abs(d - expected) > 1e-9) {
        shortSteps++;
        expect(d).toBeLessThan(expected);
      }
      previous = next;
    }
    expect(shortSteps).toBe(1);
  });

  it('a point-spacing change does not change where the entity is at a given time', () => {
    const m = motion({ periodSeconds: 8 });
    const sparse = createPath({ id: 'r', points: pts([0.1, 0.1], [0.9, 0.9]) });
    // The same straight line, with a redundant point two thirds along it.
    const dense = createPath({
      id: 'r',
      points: pts([0.1, 0.1], [0.1 + 0.8 * (2 / 3), 0.1 + 0.8 * (2 / 3)], [0.9, 0.9]),
    });
    for (let t = 0; t <= 8; t += 0.25) {
      const a = pointAtMotion(sparse, t, m);
      const b = pointAtMotion(dense, t, m);
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-9);
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-9);
    }
  });
});

describe('the arc-length walk has one answer, not two', () => {
  it('`segmentAtProgress` agrees with `pointAtProgress` across the whole range', () => {
    // Two walks over one geometry can drift apart; this is what binds them.
    for (const p of [line(), corner(), createPath({
      id: 'closed',
      points: pts([0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]),
      closed: true,
    })]) {
      for (let u = 0; u <= 1.0000001; u += 0.01) {
        const progress = Math.min(1, u);
        const seg = segmentAtProgress(p, progress);
        expect(seg).toBeDefined();
        const walked = {
          x: seg!.a.x + (seg!.b.x - seg!.a.x) * seg!.t,
          y: seg!.a.y + (seg!.b.y - seg!.a.y) * seg!.t,
        };
        const direct = pointAtProgress(p, progress);
        expect(Math.abs(walked.x - direct.x)).toBeLessThan(1e-12);
        expect(Math.abs(walked.y - direct.y)).toBeLessThan(1e-12);
      }
    }
  });

  it('skips a zero-length segment rather than landing on one', () => {
    // A stroke that starts with two samples at the same coordinate is what a
    // freehand tool actually produces, and it is the ONLY input that reaches
    // the zero-length guard: progress 0 makes `travelled + 0 >= target` true on
    // the very first segment, and interpolating along it is a division of zero
    // by zero. The guard was written before this test and the first mutation
    // run killed nothing, which is how it was found.
    const p = createPath({ id: 'stutter', points: pts([0.5, 0], [0.5, 0], [0.5, 1]) });
    const seg = segmentAtProgress(p, 0);
    expect(seg).toBeDefined();
    expect(Number.isNaN(seg!.t)).toBe(false);
    expect(seg!.a).not.toEqual(seg!.b);
    // The heading is the run's, not a tangent to a point: down, not along +x.
    expect(headingAtProgress(p, 0)).toBeCloseTo(0.25, 12);
  });

  it('returns nothing for a path with no traversable segment', () => {
    expect(segmentAtProgress(createPath({ id: 'p', points: pts() }), 0)).toBeUndefined();
    expect(segmentAtProgress(createPath({ id: 'p', points: pts([0.5, 0.5]) }), 0)).toBeUndefined();
    const dot = createPath({ id: 'p', points: pts([0.5, 0.5], [0.5, 0.5]) });
    expect(segmentAtProgress(dot, 0.5)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('I-1 — heading is the segment tangent, in turns', () => {
  it('reads 0 turns along +x and 0.25 turns down the frame', () => {
    expect(headingAtProgress(line(), 0.5)).toBeCloseTo(0, 12);
    const down = createPath({ id: 'd', points: pts([0.5, 0], [0.5, 1]) });
    expect(headingAtProgress(down, 0.5)).toBeCloseTo(0.25, 12);
    const left = createPath({ id: 'l', points: pts([1, 0.5], [0, 0.5]) });
    expect(headingAtProgress(left, 0.5)).toBeCloseTo(0.5, 12);
    const up = createPath({ id: 'u', points: pts([0.5, 1], [0.5, 0]) });
    expect(headingAtProgress(up, 0.5)).toBeCloseTo(0.75, 12);
  });

  it('stays inside [0,1) — a turn, never a radian and never negative', () => {
    const p = createPath({
      id: 'star',
      points: pts([0.5, 0.5], [0.9, 0.2], [0.2, 0.1], [0.3, 0.8], [0.8, 0.9]),
    });
    for (let u = 0; u <= 1.0000001; u += 0.01) {
      const h = headingAtProgress(p, Math.min(1, u));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('changes at the corner, and is constant along each straight run', () => {
    const p = corner();
    expect(headingAtProgress(p, 0.1)).toBeCloseTo(0, 12);
    expect(headingAtProgress(p, 0.4)).toBeCloseTo(0, 12);
    expect(headingAtProgress(p, 0.9)).toBeCloseTo(0.25, 12);
  });

  it('yields 0 rather than NaN when there is no segment to be tangent to', () => {
    expect(headingAtProgress(createPath({ id: 'p', points: pts([0.5, 0.5]) }), 0.5)).toBe(0);
  });

  it('`headingAtMotion` is 0 unless `orient` is on', () => {
    const p = createPath({ id: 'd', points: pts([0.5, 0], [0.5, 1]) });
    expect(headingAtMotion(p, 1, motion({ orient: false }))).toBe(0);
    expect(headingAtMotion(p, 1, motion({ orient: true }))).toBeCloseTo(0.25, 12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('clamp what drifts, refuse what is wrong', () => {
  it('CLAMPS phaseOffset into [0,1) — a turn past 1 is a turn', () => {
    expect(canonicalizeRouteMotion({ phaseOffset: 1 }).phaseOffset).toBe(0);
    expect(canonicalizeRouteMotion({ phaseOffset: 1.25 }).phaseOffset).toBeCloseTo(0.25, 12);
    expect(canonicalizeRouteMotion({ phaseOffset: -0.25 }).phaseOffset).toBeCloseTo(0.75, 12);
    expect(canonicalizeRouteMotion({ phaseOffset: 2 }).phaseOffset).toBe(0);
    for (const drift of [-1e-12, 1 + 1e-12]) {
      const v = canonicalizeRouteMotion({ phaseOffset: drift }).phaseOffset;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('REFUSES a periodSeconds at or below zero, naming the value', () => {
    for (const bad of [0, -1, -0.001]) {
      expect(() => canonicalizeRouteMotion({ periodSeconds: bad })).toThrow(MotionFormatError);
      expect(() => canonicalizeRouteMotion({ periodSeconds: bad })).toThrow(
        new RegExp(String(bad).replace('-', '-')),
      );
    }
  });

  it('REFUSES non-finite numbers rather than clamping them', () => {
    for (const bad of [NaN, Infinity, -Infinity, '4', null]) {
      expect(() => canonicalizeRouteMotion({ periodSeconds: bad })).toThrow(MotionFormatError);
      expect(() => canonicalizeRouteMotion({ phaseOffset: bad })).toThrow(MotionFormatError);
    }
  });

  it('REFUSES an unknown endBehavior, naming it and the legal set', () => {
    for (const bad of ['bounce', 'once', 'LOOP', '', 0, null, true]) {
      expect(() => canonicalizeRouteMotion({ endBehavior: bad })).toThrow(MotionFormatError);
    }
    expect(() => canonicalizeRouteMotion({ endBehavior: 'bounce' })).toThrow(
      /"bounce".*"loop", "pingpong", "hold"/,
    );
  });

  it('REFUSES a route with fewer than two points, naming the count', () => {
    for (const points of [pts(), pts([0.5, 0.5])]) {
      const p = createPath({ id: 'stub', points });
      expect(() => assertRouteTraversable(p)).toThrow(MotionFormatError);
      expect(() => assertRouteTraversable(p)).toThrow(
        new RegExp(`"stub".*got ${points.length}`),
      );
    }
    expect(() => assertRouteTraversable(line())).not.toThrow();
  });

  it('a one-point path is a legal SHAPE and an illegal ROUTE', () => {
    // `paths.ts` is right to accept it; this file is right to refuse it. The
    // same stored object, judged by the use it is being put to.
    const p = createPath({ id: 'dot', points: pts([0.5, 0.5]) });
    expect(p.points).toHaveLength(1);
    expect(() => canonicalizeRoute(p, undefined)).toThrow(MotionFormatError);
  });

  it('`canonicalizeRoute` judges the shape and the record in one call', () => {
    const r = canonicalizeRoute(line(), { periodSeconds: 3, orient: true });
    expect(r.motion).toEqual({ ...DEFAULT_ROUTE_MOTION, periodSeconds: 3, orient: true });
    expect(() => canonicalizeRoute(line(), { endBehavior: 'bounce' })).toThrow(MotionFormatError);
  });

  it('refuses a record that is not an object, but accepts an absent one', () => {
    for (const bad of [42, 'loop', [], true]) {
      expect(() => canonicalizeRouteMotion(bad)).toThrow(MotionFormatError);
    }
    expect(canonicalizeRouteMotion(undefined)).toEqual(DEFAULT_ROUTE_MOTION);
  });

  it('refuses invalid JSON with a message naming the cause', () => {
    expect(() => deserializeRouteMotion('{oops')).toThrow(/not valid JSON/);
  });

  it('orients only on an explicit true, exactly as `closed` behaves on a path', () => {
    expect(canonicalizeRouteMotion({ orient: true }).orient).toBe(true);
    expect(canonicalizeRouteMotion({ orient: 'yes' }).orient).toBe(false);
    expect(canonicalizeRouteMotion({ orient: 1 }).orient).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('I-8 — the five keys are on the entity, not on the path', () => {
  const build = () => {
    let state = createRouteMotion();
    const registry = new ParameterRegistry();
    registry.registerAll(
      defineMotionParameters(
        'firefly',
        () => state,
        (patch) => {
          state = { ...state, ...patch };
        },
      ),
    );
    return { registry, read: () => state };
  };

  it('registers exactly the four keys I-18 names plus B5\'s travelRole, under entity.<id>.motion.*', () => {
    const { registry } = build();
    expect(registry.keys('entity.firefly.motion')).toEqual([
      'entity.firefly.motion.endBehavior',
      'entity.firefly.motion.orient',
      'entity.firefly.motion.periodSeconds',
      'entity.firefly.motion.phaseOffset',
      'entity.firefly.motion.travelRole',
    ]);
  });

  it('registers NOTHING under route.* or path.* — a path knows nothing about who walks it', () => {
    const { registry } = build();
    expect(registry.keys('route')).toEqual([]);
    expect(registry.keys('path')).toEqual([]);
    expect(registry.keys().every((k) => k.startsWith('entity.'))).toBe(true);
  });

  it('two entities on one route get distinct keys, so they can differ', () => {
    const registry = new ParameterRegistry();
    const a = createRouteMotion();
    const b = createRouteMotion();
    registry.registerAll(defineMotionParameters('a', () => a, () => {}));
    // The second registration must not collide, which is the whole reason the
    // key is id-based (I-8) and hangs off the entity rather than the route.
    expect(() =>
      registry.registerAll(defineMotionParameters('b', () => b, () => {})),
    ).not.toThrow();
    // Five keys per entity since B5 (`travelRole`), two entities.
    expect(registry.size).toBe(10);
  });

  it('indexes the record rather than copying it — a write lands in state', () => {
    const { registry, read } = build();
    registry.write('entity.firefly.motion.periodSeconds', 12);
    registry.write('entity.firefly.motion.orient', true);
    registry.write('entity.firefly.motion.endBehavior', 'pingpong');
    registry.write('entity.firefly.motion.phaseOffset', 0.4);
    expect(read()).toEqual({
      periodSeconds: 12,
      orient: true,
      endBehavior: 'pingpong',
      phaseOffset: 0.4,
      travelRole: '',
    });
    expect(registry.snapshot('entity.firefly.motion')).toEqual({
      'entity.firefly.motion.endBehavior': 'pingpong',
      'entity.firefly.motion.orient': true,
      'entity.firefly.motion.periodSeconds': 12,
      'entity.firefly.motion.travelRole': '',
      'entity.firefly.motion.phaseOffset': 0.4,
    });
  });

  it('reports the stated defaults for an entity that has declared no motion', () => {
    const { registry } = build();
    for (const key of registry.keys('entity.firefly.motion')) {
      const def = registry.definition(key)!;
      expect(registry.read(key)).toEqual(def.default);
    }
  });

  it('the enum options are the validator\'s own list, not a second copy', () => {
    const { registry } = build();
    const def = registry.definition('entity.firefly.motion.endBehavior')!;
    expect(def.kind).toBe('enum');
    expect((def as { options: readonly string[] }).options).toBe(ROUTE_END_BEHAVIORS);
    expect(() => registry.write('entity.firefly.motion.endBehavior', 'bounce')).toThrow();
  });

  it('the period fader cannot reach a value the canonicalizer would refuse', () => {
    const { registry } = build();
    const clamped = registry.write('entity.firefly.motion.periodSeconds', -5) as number;
    expect(clamped).toBe(MOTION_PERIOD_MIN_SECONDS);
    expect(clamped).toBeGreaterThan(0);
    expect(() => canonicalizeRouteMotion({ periodSeconds: clamped })).not.toThrow();
    expect(registry.write('entity.firefly.motion.periodSeconds', 1e9)).toBe(
      MOTION_PERIOD_MAX_SECONDS,
    );
  });
});
