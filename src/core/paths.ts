/**
 * I-17 — one path primitive, three uses, implemented once.
 *
 * A path is an ordered list of points in normalized space (I-1) with a `closed`
 * flag and an `interpolation` field. The three uses are **boundary** (a closed
 * path that contains content), **outline** (a closed path that is itself drawn)
 * and **route** (an open path content travels along). They are the same stored
 * object; nothing here knows which one a given path is for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE THINGS THIS FILE IS DELIBERATELY NOT.
 *
 * **Not a curve library.** `interpolation` serializes from the first commit
 * with exactly one legal value, `linear` (S5). A curve mode is a later *value*
 * of an existing field, never a later migration of every stored path. The field
 * is free today and expensive to add once scenes exist, which is the entire
 * reason it is here before anything reads it. §10 row 9 decides post-v1 whether
 * a second value ever joins it, and only if the wall shows straight runs
 * reading badly.
 *
 * **Not a surface.** Phase 6's surface tree carries paths; it is not built here
 * and must not be reached for (§11's order note, §0.2). This file is the shape
 * primitive alone.
 *
 * **Not a playhead.** Route progress is a pure function of clock time (I-2,
 * I-16) — `progressAlong` is `phaseAt`, reused rather than reimplemented, so a
 * route pauses in the same frame as everything else and a scrub lands exactly
 * where the arithmetic puts it. There is no accumulated position anywhere in
 * this file and there must not be one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { phaseAt } from './clock';
import { clamp01 } from './layer';

/**
 * The only legal `interpolation` value (S5, §10 row 9).
 *
 * A list of one, rather than a bare string literal, so that adding a second
 * value later is an edit to this array and its type — and so the refusal
 * message below can name what IS legal without a second place to update.
 */
export const PATH_INTERPOLATIONS = ['linear'] as const;
export type PathInterpolation = (typeof PATH_INTERPOLATIONS)[number];

/** A point in normalized space (I-1). Pixels exist at the final draw, not here. */
export interface PathPoint {
  x: number;
  y: number;
}

/**
 * The stored path. **Open and closed are the same type, one flag apart.**
 *
 * `closed` changes what is *derived* — whether a segment joins the last point
 * back to the first — and changes nothing about how the path is stored,
 * serialized or edited. A surface's shape and a movement route are the same
 * object; a closed path is merely one whose last point joins its first (I-17).
 */
export interface Path {
  id: string;
  points: PathPoint[];
  closed: boolean;
  interpolation: PathInterpolation;
}

export class PathFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathFormatError';
  }
}

export function createPath(init: {
  id: string;
  points?: readonly PathPoint[];
  closed?: boolean;
  interpolation?: PathInterpolation;
}): Path {
  return {
    id: init.id,
    points: (init.points ?? []).map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })),
    closed: init.closed ?? false,
    interpolation: init.interpolation ?? 'linear',
  };
}

/**
 * The validation boundary for untrusted path data — a scene file, an IPC
 * payload, the editor's pointer stream.
 *
 * **Coordinates are clamped; `interpolation` is refused.** The two are treated
 * differently on purpose:
 *
 * - A coordinate is clamped with `clamp01`, which is what every other stored
 *   position in this project does (`layer.ts`'s transform, `scene.ts`'s
 *   parallax). A path point half a pixel outside the frame after float drift is
 *   not a corrupt scene, and refusing to load a show over it would be I-13
 *   failing in the least forgivable place — at the start of a live session.
 * - `interpolation` is refused, because S5 says exactly one value is legal and
 *   an unknown one means the file was written by something this build does not
 *   understand. Clamping it would mean silently rendering a curve as a
 *   polyline, which is a plausible wrong answer (A9) rather than a loud one.
 */
export function canonicalizePath(raw: unknown): Path {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PathFormatError('path must be an object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || o['id'] === '') {
    throw new PathFormatError('path.id must be a non-empty string');
  }
  const rawPoints = o['points'];
  if (rawPoints !== undefined && !Array.isArray(rawPoints)) {
    throw new PathFormatError(`path "${o['id']}": points must be an array`);
  }
  const points = (rawPoints ?? []).map((p, i) => canonicalizePoint(p, o['id'] as string, i));

  // S5. Absent means `linear` — the field is defaulted, never guessed at from
  // the data. Present and unknown is refused, with both the offending value and
  // the legal set in the message (A9: state the value, not only the verdict).
  const rawInterp = o['interpolation'];
  let interpolation: PathInterpolation = 'linear';
  if (rawInterp !== undefined) {
    if (!isPathInterpolation(rawInterp)) {
      throw new PathFormatError(
        `path "${o['id']}": interpolation ${JSON.stringify(rawInterp)} is not legal ` +
          `(only ${PATH_INTERPOLATIONS.map((v) => JSON.stringify(v)).join(', ')})`,
      );
    }
    interpolation = rawInterp;
  }

  return {
    id: o['id'],
    points,
    closed: o['closed'] === true,
    interpolation,
  };
}

export function isPathInterpolation(v: unknown): v is PathInterpolation {
  return typeof v === 'string' && (PATH_INTERPOLATIONS as readonly string[]).includes(v);
}

function canonicalizePoint(raw: unknown, pathId: string, index: number): PathPoint {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PathFormatError(`path "${pathId}": point ${index} must be an object`);
  }
  const p = raw as Record<string, unknown>;
  // A non-number is refused rather than defaulted to 0: a point silently at the
  // origin is a shape that is wrong in a way nobody can see, which is the
  // failure mode A9 names. Out-of-range NUMBERS are clamped; non-numbers are
  // not numbers at all.
  if (typeof p['x'] !== 'number' || !Number.isFinite(p['x'])) {
    throw new PathFormatError(
      `path "${pathId}": point ${index}.x must be a finite number, got ${JSON.stringify(p['x'])}`,
    );
  }
  if (typeof p['y'] !== 'number' || !Number.isFinite(p['y'])) {
    throw new PathFormatError(
      `path "${pathId}": point ${index}.y must be a finite number, got ${JSON.stringify(p['y'])}`,
    );
  }
  return { x: clamp01(p['x']), y: clamp01(p['y']) };
}

export function serializePath(path: Path): string {
  return JSON.stringify(path);
}

export function deserializePath(json: string): Path {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new PathFormatError(`path is not valid JSON: ${(e as Error).message}`);
  }
  return canonicalizePath(raw);
}

/**
 * The segments a path actually has — the closing segment included when, and
 * only when, `closed` is set.
 *
 * This is the ONE place `closed` changes behaviour, which is what makes the
 * "same stored type, one flag apart" claim true rather than asserted: everything
 * geometric downstream (length, point-at-progress, hit testing later) is built
 * on this function, so the flag is honoured in exactly one spot.
 */
export function pathSegments(path: Path): { a: PathPoint; b: PathPoint }[] {
  const n = path.points.length;
  if (n < 2) return [];
  const out: { a: PathPoint; b: PathPoint }[] = [];
  for (let i = 0; i < n - 1; i++) out.push({ a: path.points[i]!, b: path.points[i + 1]! });
  if (path.closed) out.push({ a: path.points[n - 1]!, b: path.points[0]! });
  return out;
}

function distance(a: PathPoint, b: PathPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Total length in normalized units. A closed path includes its closing segment. */
export function pathLength(path: Path): number {
  let total = 0;
  for (const s of pathSegments(path)) total += distance(s.a, s.b);
  return total;
}

/**
 * The point at `progress` along the path, `progress` in [0, 1].
 *
 * Degenerate cases return the first point rather than NaN, on I-13's principle:
 * a route that holds still is a visible defect an operator can report, where a
 * NaN position is a layer that vanishes for reasons nobody can see. Same
 * reasoning, and the same wording, as `phaseAt`'s guard in `clock.ts`.
 */
export function pointAtProgress(path: Path, progress: number): PathPoint {
  const first = path.points[0];
  if (first === undefined) return { x: 0, y: 0 };
  const total = pathLength(path);
  if (!Number.isFinite(progress) || total <= 0) return { ...first };

  const target = clamp01(progress) * total;
  let travelled = 0;
  for (const s of pathSegments(path)) {
    const len = distance(s.a, s.b);
    if (len <= 0) continue;
    if (travelled + len >= target) {
      const t = (target - travelled) / len;
      return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
    }
    travelled += len;
  }
  // Progress 1.0 on an open path lands exactly on the last point; on a closed
  // one it lands back on the first. Falling out of the loop means the target
  // was the very end, so return the last segment's endpoint rather than
  // clamping to the first point.
  const segs = pathSegments(path);
  const last = segs[segs.length - 1];
  return last ? { ...last.b } : { ...first };
}

/**
 * Route progress — **derived from the clock, never accumulated** (I-2, I-16).
 *
 * This is `phaseAt` under a name that says what it is used for. It is a
 * re-export rather than a reimplementation on purpose: two functions that both
 * turn clock time into a normalized position would be two things to keep in
 * agreement, and I-2's whole point is that there is one answer to "where are we
 * in the loop".
 *
 * Monotonic within a loop by construction, because `phaseAt` is `t/period mod 1`.
 */
export function progressAlong(timeMs: number, periodSeconds: number): number {
  return phaseAt(timeMs, periodSeconds);
}

/** The point a route occupies at a given clock time. Pure; no state, no timer. */
export function pointAtTime(path: Path, timeMs: number, periodSeconds: number): PathPoint {
  return pointAtProgress(path, progressAlong(timeMs, periodSeconds));
}

/**
 * Perpendicular distance from `p` to the segment `a`–`b`.
 *
 * Written out rather than pulled from a helper because the simplifier's
 * determinism claim rests on the exact order of these floating-point
 * operations: the same input and tolerance must produce the same output on
 * every run, and "same" here means bit-identical, not visually alike.
 */
function perpendicularDistance(p: PathPoint, a: PathPoint, b: PathPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return distance(p, a);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + clamped * dx), p.y - (a.y + clamped * dy));
}

/**
 * Ramer–Douglas–Peucker, deterministic for a given input and tolerance.
 *
 * **Tolerance is a parameter, in normalized units**, not a constant: a stroke
 * drawn to mark a window frame and a stroke drawn as a movement route want
 * different fidelity, and a tolerance baked into the algorithm would be a pixel
 * value hiding in normalized clothing (I-1).
 *
 * The endpoints are always kept, which is what makes this safe for a closed
 * path: the closing segment is derived from `closed` and the first and last
 * points, so a simplifier that moved either of them would change the shape's
 * topology rather than its detail.
 *
 * Recursive and index-ordered, with no `Set` or `Map` anywhere in it — the
 * output order is a property of the input, not of a hash iteration.
 */
export function simplifyPoints(
  points: readonly PathPoint[],
  toleranceNormalized: number,
): PathPoint[] {
  const tol = Number.isFinite(toleranceNormalized) ? Math.max(0, toleranceNormalized) : 0;
  if (points.length <= 2 || tol === 0) return points.map((p) => ({ ...p }));

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const walk = (start: number, end: number): void => {
    if (end <= start + 1) return;
    let worst = -1;
    let worstIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i]!, points[start]!, points[end]!);
      // Strictly greater, so the FIRST index wins a tie. A `>=` here would make
      // the result depend on which duplicate the loop saw last, which is the
      // kind of thing that is deterministic in a test and not in a stroke.
      if (d > worst) {
        worst = d;
        worstIndex = i;
      }
    }
    if (worstIndex < 0 || worst <= tol) return;
    keep[worstIndex] = true;
    walk(start, worstIndex);
    walk(worstIndex, end);
  };
  walk(0, points.length - 1);

  const out: PathPoint[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push({ ...points[i]! });
  return out;
}

/**
 * Simplify a path, preserving `closed` and `interpolation`.
 *
 * Returns the point count before and after alongside the path, because Gate 5
 * requires those two numbers recorded and a caller that has to compute them
 * itself will eventually compute them from the wrong array (A9: the instrument
 * reports the value).
 */
export function simplifyPath(
  path: Path,
  toleranceNormalized: number,
): { path: Path; before: number; after: number } {
  const before = path.points.length;
  const points = simplifyPoints(path.points, toleranceNormalized);
  return { path: { ...path, points }, before, after: points.length };
}
