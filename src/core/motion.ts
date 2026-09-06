/**
 * I-18 — route motion is declared, and progress is derived.
 *
 * A `RouteMotion` is a four-field record stored on **the entity that travels**,
 * never on the path it travels along (I-18's closing paragraph, D21). A path is
 * a shape and knows nothing about who walks it — Block A registered no
 * parameter at all for exactly this reason, and the registry keys this block
 * adds are `entity.<id>.motion.*` for the same one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR THINGS THIS FILE IS DELIBERATELY NOT.
 *
 * **Not a second clock.** `progressAt` is a pure function of a time it is
 * handed and a record it is handed. There is no cursor, no `lastTime`, no
 * `+=` anywhere in this file and there must not be one (I-2, I-16, I-18).
 * Asking for t=10 after asking for t=90 returns the t=10 answer exactly, which
 * is what makes a scrub land where the arithmetic puts it rather than where a
 * history of deltas happened to leave it.
 *
 * **Not a reimplementation of phase.** I-2 says there is exactly one function
 * turning clock time into a normalized position — `phaseAt` — and anything
 * needing that behaviour re-exports it. `paths.ts` already re-exported it as
 * `progressAlong`; this file calls *that*. The three end behaviours differ only
 * in what time they hand it and what they do with the number afterwards:
 *
 *   - `loop`     — `progressAlong` over `periodSeconds`
 *   - `pingpong` — `progressAlong` over `2 × periodSeconds`, folded to a
 *                  triangle. The fold is a waveform, not phase arithmetic.
 *   - `hold`     — a ratio with a ceiling. Not a loop, so not `phaseAt`.
 *
 * There is no `% 1` and no `Math.floor` below. Both of those are `phaseAt`'s
 * job and it does them once, in `clock.ts`.
 *
 * **`phaseOffset` shifts the TIME, not the answer.** I-18 gives `hold` as
 * `min(1, t / period + phaseOffset)`, which is `min(1, (t + offset × period) /
 * period)` — the same shift, applied a step earlier. Doing it to the time makes
 * one line serve all three behaviours, and it means the offset never touches
 * the wrapped result, which is where a second `% 1` would otherwise appear.
 *
 * **Not a path editor.** Arc length, heading and nothing else. `paths.ts` owns
 * the shape; `pointAtProgress` is re-exported from there rather than rewritten,
 * so "where is the entity" has one answer.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ON CLAMP VERSUS REFUSE (P5-A's rule, applied here).
 *
 * Clamped, because it is drift: `phaseOffset` outside `[0,1)`. A phase offset
 * is a turn, and "a turn past 1 is a turn, not an error" — `wrapTurn`'s own
 * comment. Note that a *clamp* cannot land 1.0 inside a half-open range at all;
 * wrapping can, and it is also the semantically correct answer, since offset 1
 * and offset 0 are the same position on a loop.
 *
 * Refused, because it is wrong: a `periodSeconds` that is not a finite number
 * greater than zero, a non-finite `phaseOffset`, an `endBehavior` this build
 * does not know, and a route with fewer than two points. The last one is the
 * only one that is about the path rather than the record, and it is refused
 * *here* rather than in `paths.ts` because a one-point path is a perfectly
 * legal shape and only an illegal **route** — the same object, judged by the
 * use it is being put to.
 *
 * WHERE THE REFUSAL HAPPENS, AND WHERE IT DOES NOT. Refusal lives at the
 * validation boundary — `canonicalizeRouteMotion`, `deserializeRouteMotion`,
 * `assertRouteTraversable`, `canonicalizeRoute` — which is where untrusted data
 * arrives. The per-frame functions below degrade instead, on I-13's principle:
 * an entity that holds still at the start of its route is a visible defect an
 * operator can report, where an exception 60 times a second disables the layer.
 * The one exception is an unknown `endBehavior` reaching `progressAt`, which
 * cannot come from a scene file — the canonicalizer refused it there — and so
 * means a caller skipped the boundary. That is a programming fault and it says
 * so out loud rather than holding still and looking like a content problem.
 */
import { GLOBAL_LOOP_SECONDS } from './clock';
import { clamp01, wrapTurn } from './layer';
import { pathSegments, pointAtProgress, progressAlong, type Path, type PathPoint } from './paths';

/**
 * I-2's one function, reachable from here.
 *
 * Re-exported, never reimplemented — see the header. `progressAlong` is itself
 * `phaseAt` under the name routes use for it, so this is one function under
 * three names and zero copies of the arithmetic.
 */
export { pointAtProgress, progressAlong };

/**
 * The legal `endBehavior` values, exactly as I-18 lists them.
 *
 * An array rather than a bare union so the refusal message can name what IS
 * legal without a second place to update, and so the registry's enum options
 * come from the same source the validator uses (`PATH_INTERPOLATIONS` is the
 * precedent).
 */
export const ROUTE_END_BEHAVIORS = ['loop', 'pingpong', 'hold'] as const;
export type RouteEndBehavior = (typeof ROUTE_END_BEHAVIORS)[number];

/**
 * I-18, field for field, plus the ONE field sprint block B5 added.
 *
 * Stored on the entity, never on the path.
 */
export interface RouteMotion {
  /** > 0. One full traversal of the route, in seconds. */
  periodSeconds: number;
  /** Rotate the content to the path heading. */
  orient: boolean;
  endBehavior: RouteEndBehavior;
  /** [0,1). Two entities on one route differ only in this. */
  phaseOffset: number;
  /**
   * B5. WHICH route: the role of the surface whose path this entity travels
   * (I-15 — by role, never by surface id; I-17 — a route is an open path, and a
   * surface carrying `role: 'route'` is how one is stored in `calibration/`).
   *
   * `''` means "no route declared", which is what every layer had before this
   * field existed: the entity draws at its base transform, motionless, and is
   * NOT flagged — a default cannot be a defect. A non-empty role matching no
   * surface, or matching one too short to travel, is I-13's flag path: the
   * layer draws at its base transform, motionless, and `roleMisses()` says why.
   *
   * A free string like `fillRole`, for the same reason: the role is typed by a
   * person in a dark room, and a typo lights nothing rather than ending the
   * session. One token, never split — see `roleTokens`.
   */
  travelRole: string;
}

/** A guard against a paste, not a validation rule — see `TextParameterDef`. */
export const MOTION_TRAVEL_ROLE_MAX_LENGTH = 64;

/**
 * The control range for `periodSeconds` in the registry (I-8).
 *
 * A *control* range, not the legality boundary: the canonicalizer refuses
 * anything at or below zero, while a mapped fader clamps into this. They are
 * different questions — "is this file loadable" and "what can a knob reach" —
 * and conflating them would either put a fader's bottom stop on an illegal
 * value or make a scene file's 0.05 s unloadable.
 */
export const MOTION_PERIOD_MIN_SECONDS = 0.1;
export const MOTION_PERIOD_MAX_SECONDS = 600;

/**
 * What a layer with no `motion` record means. Stated values, never `undefined`.
 *
 * The period is the engine's existing default loop rather than a new number:
 * an entity given a route and nothing else travels it in step with everything
 * else that has no period of its own (I-2, `GLOBAL_LOOP_SECONDS`).
 */
export const DEFAULT_ROUTE_MOTION: RouteMotion = {
  periodSeconds: GLOBAL_LOOP_SECONDS,
  orient: false,
  endBehavior: 'loop',
  phaseOffset: 0,
  travelRole: '',
};

export class MotionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotionFormatError';
  }
}

export function isRouteEndBehavior(v: unknown): v is RouteEndBehavior {
  return typeof v === 'string' && (ROUTE_END_BEHAVIORS as readonly string[]).includes(v);
}

/**
 * The validation boundary for untrusted motion data — a scene file, an IPC
 * payload, an editor field.
 *
 * **A missing record is not a malformed one.** `undefined` and `null` mean "no
 * motion declared", which is legal and yields `DEFAULT_ROUTE_MOTION`; that is
 * the checklist's "deserializes to the stated defaults, not to `undefined`".
 * Anything else that is not an object is refused, because a number or a string
 * where a record belongs is a file this build does not understand.
 */
export function canonicalizeRouteMotion(raw: unknown): RouteMotion {
  if (raw === undefined || raw === null) return { ...DEFAULT_ROUTE_MOTION };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MotionFormatError(`motion must be an object, got ${JSON.stringify(raw)}`);
  }
  const o = raw as Record<string, unknown>;

  let periodSeconds = DEFAULT_ROUTE_MOTION.periodSeconds;
  const rawPeriod = o['periodSeconds'];
  if (rawPeriod !== undefined) {
    if (typeof rawPeriod !== 'number' || !Number.isFinite(rawPeriod) || rawPeriod <= 0) {
      throw new MotionFormatError(
        `motion.periodSeconds must be a finite number greater than 0, got ${JSON.stringify(rawPeriod)}`,
      );
    }
    periodSeconds = rawPeriod;
  }

  let endBehavior = DEFAULT_ROUTE_MOTION.endBehavior;
  const rawEnd = o['endBehavior'];
  if (rawEnd !== undefined) {
    if (!isRouteEndBehavior(rawEnd)) {
      throw new MotionFormatError(
        `motion.endBehavior ${JSON.stringify(rawEnd)} is not legal ` +
          `(only ${ROUTE_END_BEHAVIORS.map((v) => JSON.stringify(v)).join(', ')})`,
      );
    }
    endBehavior = rawEnd;
  }

  // Out of range is drift and wraps; not a number at all is not a phase.
  let phaseOffset = DEFAULT_ROUTE_MOTION.phaseOffset;
  const rawOffset = o['phaseOffset'];
  if (rawOffset !== undefined) {
    if (typeof rawOffset !== 'number' || !Number.isFinite(rawOffset)) {
      throw new MotionFormatError(
        `motion.phaseOffset must be a finite number, got ${JSON.stringify(rawOffset)}`,
      );
    }
    phaseOffset = wrapTurn(rawOffset);
  }

  // A present-but-not-a-string role is a file this build does not understand,
  // refused for `canonicalizeFillRole`'s reason. `''` and absent both mean "no
  // route", and are the same stored value so a defaulted record is one record.
  let travelRole = DEFAULT_ROUTE_MOTION.travelRole;
  const rawRole = o['travelRole'];
  if (rawRole !== undefined && rawRole !== null) {
    if (typeof rawRole !== 'string') {
      throw new MotionFormatError(
        `motion.travelRole must be a string, got ${JSON.stringify(rawRole)}`,
      );
    }
    travelRole = rawRole;
  }

  return {
    periodSeconds,
    // Only an explicit `true` orients, exactly as `canonicalizePath` treats
    // `closed`: a boolean has no unknown values to refuse, only true and
    // not-true, and the two files answer this the same way on purpose.
    orient: o['orient'] === true,
    endBehavior,
    phaseOffset,
    travelRole,
  };
}

/** Whether a path can be travelled — `assertRouteTraversable` as a question. */
export function isRouteTraversable(path: Path): boolean {
  return path.points.length >= 2;
}

/**
 * The trusted constructor. Delegates to the canonicalizer so there is one
 * validator rather than a lenient path and a strict one that disagree.
 */
export function createRouteMotion(init?: Partial<RouteMotion>): RouteMotion {
  return canonicalizeRouteMotion({ ...DEFAULT_ROUTE_MOTION, ...init });
}

export function serializeRouteMotion(motion: RouteMotion): string {
  return JSON.stringify(motion);
}

export function deserializeRouteMotion(json: string): RouteMotion {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new MotionFormatError(`motion is not valid JSON: ${(e as Error).message}`);
  }
  return canonicalizeRouteMotion(raw);
}

/**
 * A path is a legal **route** only if something can travel along it.
 *
 * Refused here rather than in `paths.ts`: a one-point path is a fine shape and
 * the path canonicalizer is right to accept it. It is this use of it that is
 * wrong, so this is where it is named.
 */
export function assertRouteTraversable(path: Path): void {
  const n = path.points.length;
  if (n < 2) {
    throw new MotionFormatError(
      `route "${path.id}" needs at least 2 points to travel along, got ${n}`,
    );
  }
}

/**
 * The one entry point for untrusted route data: the shape and the record
 * together, each judged by its own rule.
 *
 * A mechanism rather than an instruction to remember two calls — a caller that
 * validates the motion and forgets the path is exactly the gap a comment
 * would leave reachable.
 */
export function canonicalizeRoute(
  path: Path,
  rawMotion: unknown,
): { path: Path; motion: RouteMotion } {
  assertRouteTraversable(path);
  return { path, motion: canonicalizeRouteMotion(rawMotion) };
}

/**
 * Progress along the route at a clock time, in [0, 1]. **Pure — no state, no
 * accumulation** (I-18).
 *
 * `timeSeconds`, not milliseconds: I-18 states all three behaviours in seconds
 * and `Clock` exposes `timeSeconds` for the asking. The conversion to the
 * millisecond `progressAlong` takes happens on one line, below, and nowhere
 * else in this file.
 *
 * A nonsense time or period yields 0 rather than NaN — an entity parked at the
 * start of its route, which an operator can see and report, where a NaN
 * position is content that vanishes for reasons nobody can see. Same rule, and
 * the same wording, as `phaseAt`'s guard.
 */
export function progressAt(timeSeconds: number, motion: RouteMotion): number {
  const period = motion.periodSeconds;
  if (!Number.isFinite(timeSeconds) || !Number.isFinite(period) || period <= 0) return 0;

  // The offset shifts the time, once, for all three behaviours — see header.
  const shiftedSeconds = timeSeconds + wrapTurn(motion.phaseOffset) * period;

  switch (motion.endBehavior) {
    case 'loop':
      return progressAlong(shiftedSeconds * 1000, period);
    case 'pingpong': {
      // A triangle over 2 × period: out on the first half of the cycle, back on
      // the second. `progressAlong` supplies the cycle position; this line is a
      // waveform over it and holds no time of its own.
      const cycle = progressAlong(shiftedSeconds * 1000, period * 2);
      return 1 - Math.abs(cycle * 2 - 1);
    }
    case 'hold':
      // I-18's `min(1, t / period + phaseOffset)`, with the shift already in t.
      // `clamp01` adds a floor at 0, which `min` alone does not: a negative time
      // would otherwise put the entity behind the start of its own route.
      return clamp01(shiftedSeconds / period);
    default:
      // Unreachable from a scene file; see the header's last paragraph.
      throw new MotionFormatError(
        `motion.endBehavior ${JSON.stringify(motion.endBehavior)} is not legal ` +
          `(only ${ROUTE_END_BEHAVIORS.map((v) => JSON.stringify(v)).join(', ')})`,
      );
  }
}

/** Which segment `progress` falls on, and how far along it. */
export interface RouteSegment {
  /** Index into `pathSegments(path)`. The closing segment is included when the path is closed. */
  index: number;
  a: PathPoint;
  b: PathPoint;
  /** [0,1] within the segment. */
  t: number;
}

/**
 * The segment at `progress`, located **by arc length** — the same walk
 * `pointAtProgress` makes, in the same order, over the same sums.
 *
 * It exists because `pointAtProgress` answers with a point and heading needs
 * the direction the point is moving in, which a point cannot carry. That makes
 * two walks over one geometry, and two walks can drift apart; the test
 * `segmentAtProgress agrees with pointAtProgress` binds them, sampling both
 * across the whole range and asserting the interpolated points are identical.
 *
 * Zero-length segments are skipped, so a returned segment always has a
 * direction — `headingAtProgress` relies on that and carries no guard for it.
 */
export function segmentAtProgress(path: Path, progress: number): RouteSegment | undefined {
  const segs = pathSegments(path);
  if (segs.length === 0) return undefined;

  const lengths = segs.map((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y));
  let total = 0;
  for (const len of lengths) total += len;
  if (!Number.isFinite(progress) || total <= 0) return undefined;

  const target = clamp01(progress) * total;
  let travelled = 0;
  for (let i = 0; i < segs.length; i++) {
    const len = lengths[i]!;
    if (len <= 0) continue;
    if (travelled + len >= target) {
      return { index: i, a: segs[i]!.a, b: segs[i]!.b, t: (target - travelled) / len };
    }
    travelled += len;
  }
  // Progress landed on the very end. Return the last segment that has a
  // direction, at its far end — the trailing zero-length segments a stroke can
  // end with are at the same coordinates, so this is the same point either way.
  for (let i = segs.length - 1; i >= 0; i--) {
    if (lengths[i]! > 0) return { index: i, a: segs[i]!.a, b: segs[i]!.b, t: 1 };
  }
  return undefined;
}

/**
 * The heading at `progress`, **in turns** (I-1), for `orient`.
 *
 * Turns rather than radians because every stored rotation in this project is a
 * turn, and a heading that has to be converted at the point of use is a unit
 * error waiting for the one call site that forgets.
 *
 * Measured in normalized space, where +y is down: 0 turns is towards +x, and
 * 0.25 turns is towards +y, which is down the frame. The aspect ratio enters at
 * the final draw along with the pixels, not here (I-1).
 *
 * A route with no traversable segment yields 0 — content facing along +x rather
 * than content rotated by NaN, which is content that disappears.
 */
export function headingAtProgress(path: Path, progress: number): number {
  const seg = segmentAtProgress(path, progress);
  if (seg === undefined) return 0;
  return wrapTurn(Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x) / (Math.PI * 2));
}

/** Where the entity is at a clock time. Pure; no state, no timer. */
export function pointAtMotion(path: Path, timeSeconds: number, motion: RouteMotion): PathPoint {
  return pointAtProgress(path, progressAt(timeSeconds, motion));
}

/**
 * The rotation to apply at a clock time, in turns — 0 when `orient` is off.
 *
 * Returning 0 rather than the heading is the point: a caller reads one number
 * and applies it, and cannot forget to check the flag.
 */
export function headingAtMotion(path: Path, timeSeconds: number, motion: RouteMotion): number {
  if (!motion.orient) return 0;
  return headingAtProgress(path, progressAt(timeSeconds, motion));
}
