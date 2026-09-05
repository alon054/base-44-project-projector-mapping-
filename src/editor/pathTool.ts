/**
 * P5-D — the path tool, as pure state.
 *
 * D19: **one tool, drawn one way.** A click adds a point, a drag draws a run of
 * them, and there is no mode switch between the two — which is a claim about
 * this file and not about the UI, because the decision is made here. A press
 * appends its point immediately; whether that press turns out to be a *click*
 * or the head of a *stroke* is decided by what the pointer subsequently does,
 * so the two cases share a code path rather than a toggle. There is nowhere for
 * a mode to live: `PathToolState` has no field for one, and adding one would be
 * visible as a type change rather than as a behaviour change nobody notices.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS NOT.
 *
 * **Not a store.** A finished path has no home in `Scene` — paths belong to the
 * surface tree, which is calibration and is Phase 6 (I-15, §11's order note).
 * So the tool yields a `Path` and the caller decides what to do with it; this
 * file never writes one anywhere.
 *
 * **Not a simplifier.** Ramer–Douglas–Peucker lives in `core/paths.ts`, where
 * Block A put it and where its tests are. The tool *calls* it on release with a
 * tolerance in normalized units. Simplification in the UI would be a second
 * implementation of the shape rule, and the one in `core/` is the one Phase 6's
 * surfaces will load stored paths through.
 *
 * **Not pixel-aware.** Every coordinate here is normalized (I-1); `aspect` is
 * dimensionless and is used for two things only — measuring a grab radius and
 * choosing which axis a right-angle constraint snaps to — for the reason
 * `handleAt` states: a radius of 0.02 in x and 0.02 in y is an ellipse on a
 * 16:9 canvas, and a hit that is easy from above and hard from the side is a
 * bug the mouse reports as "it feels wrong".
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  createPath,
  pathSegments,
  perpendicularDistance,
  simplifyPoints,
  type Path,
  type PathPoint,
} from '../core/paths';
import type { NormalizedPoint } from './interaction';

/**
 * How far a press may travel and still count as a click, in normalized units
 * measured in the square space.
 *
 * This is the whole of "no mode switch": above it the press is a stroke, below
 * it a click, and nothing else in the file asks the question.
 *
 * **It shipped at 0.006 and that was wrong.** 0.006 of the frame is 2.9 px on
 * the 480-wide preview — below the noise floor of a human click, and well below
 * the ~5 px every desktop platform uses to separate a click from a drag. The
 * operator reported one click producing two points at a sharp corner, which is
 * exactly the shape of this fault: the hand is already moving toward the next
 * point as the button comes up, so a direction change is where the release
 * travels furthest from the press. The press then latched into a stroke and
 * appended a second point at the pointer.
 *
 * 0.015 is 7.2 px on the preview — above anything a hand does by accident,
 * below anything it does on purpose. The number is in normalized units for
 * I-1's reason and is stated in pixels here because that is the only frame in
 * which it can be judged.
 */
export const CLICK_SLOP = 0.015;

/** Grab-and-close radius for an existing point. Square space, as `handleAt`. */
export const POINT_HIT_RADIUS = 0.02;

/**
 * Minimum spacing between two recorded freehand samples.
 *
 * A pointer stream at 120 Hz over a slow stroke delivers many samples at one
 * coordinate. Dropping them here rather than leaving them to the simplifier is
 * deliberate: a run of identical points is a run of zero-length segments, and
 * `segmentAtProgress` has one guard for exactly that case (P5-C) which should
 * be catching float drift, not catching this tool's own laziness.
 */
export const FREEHAND_MIN_STEP = 0.0015;

/**
 * The tolerance a freehand run is simplified with on release, in normalized
 * units (D19: "simplified to tens of points on release").
 *
 * 0.006 of the frame is ~8 px on a 1280-wide projector and ~3 px on the 480-wide
 * preview — under the width of the stroke the operator was watching while
 * drawing, so the simplified path lands inside the line they drew. The value
 * was chosen by measurement, not by taste: below 0.005 a jittered 400-sample
 * stroke simplifies to 162 points rather than to tens, because the hand's own
 * wobble is then a feature the algorithm is obliged to keep. It is a constant here
 * and a *parameter* in `simplifyPoints`, which is the split that matters: the
 * algorithm has no opinion about fidelity, this tool has one, and a later panel
 * that wants a fidelity fader changes this file only.
 */
export const FREEHAND_TOLERANCE = 0.006;

/**
 * The fewest points a path may have before its first point will close it.
 *
 * Two points cannot enclose anything; closing them would produce a path whose
 * closing segment retraces its only segment backwards. Three is the smallest
 * number that makes `closed` mean something.
 */
export const CLOSE_MIN_POINTS = 3;

/**
 * What a press is doing. Decided once, on pointer-down, by `pathToolDown` —
 * and, like `Gesture` in `interaction.ts`, it holds indices rather than copies,
 * so nothing here can go stale against the point list it refers to.
 */
export type PathPress =
  | {
      /**
       * A new point was appended and is being placed. `freehand` starts false
       * and latches true the first time the pointer leaves `CLICK_SLOP`; it
       * never latches back, because a stroke that returns to where it started
       * is still a stroke.
       */
      kind: 'draw';
      /**
       * Where the POINTER went down, not where the point was placed. The two
       * differ under the shift constraint, and measuring the slop from the
       * placed point would make every constrained click read as a drag — the
       * constraint moves the point by more than `CLICK_SLOP` by design.
       */
      origin: PathPoint;
      /** Index of the first point this press appended. The run starts here. */
      startIndex: number;
      freehand: boolean;
    }
  | { kind: 'grab'; index: number };

/**
 * The tool's whole state. Editor state, never scene state — this file's header
 * says why there is nowhere to put it yet.
 *
 * Every function below returns a NEW state and mutates nothing, so a press can
 * be replayed from its start and the live preview can be drawn from the same
 * value the commit will use rather than from a parallel approximation.
 */
export interface PathToolState {
  points: PathPoint[];
  closed: boolean;
  /**
   * Editing is over — the operator pressed Enter, or otherwise said "that's the
   * path". Orthogonal to `closed` on purpose, and the two answer different
   * questions:
   *
   *  - `closed` is **geometry**: does a segment join the last point to the
   *    first. It is the flag I-17 stores and the renderer reads.
   *  - `finished` is **editing**: does the next click extend this path. It is
   *    editor state and never reaches a stored path.
   *
   * An open path had no way to end before this. Closing one was the only
   * terminal act available, so an operator drawing a run along the top of a box
   * — a route, an outline that is not a loop — had to leave it dangling and
   * hope the next click landed somewhere harmless. That is what Enter fixes,
   * and it is why finishing does NOT set `closed`: a finished open path is a
   * perfectly ordinary path, and forcing a loop onto it would be the tool
   * inventing a segment the operator never drew.
   */
  finished: boolean;
  press: PathPress | null;
  /**
   * Point count before and after the last release that simplified something,
   * or null when nothing has been simplified yet.
   *
   * The tool reports it rather than leaving the caller to count, for A9's
   * reason and for Gate 5's: a caller that subtracts two array lengths itself
   * will eventually subtract the wrong two, and the count belongs to the
   * release that produced it, not to whatever the state looks like later.
   */
  lastSimplification: { before: number; after: number } | null;
}

/** The empty tool. A separate function so no caller writes the shape by hand. */
export function emptyPathTool(): PathToolState {
  return { points: [], closed: false, finished: false, press: null, lastSimplification: null };
}

/** Square-space distance, the same measure `handleAt` uses. Dimensionless. */
function squareDistance(a: NormalizedPoint, b: NormalizedPoint, aspect: number): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) / aspect);
}

/**
 * The index of the point under the pointer, or `null`.
 *
 * Walks backwards, so the MOST RECENT point wins an overlap. A freehand run
 * doubling back over itself leaves points on top of each other, and the one the
 * operator means is the one they just drew.
 */
export function pointIndexAt(
  state: PathToolState,
  p: NormalizedPoint,
  aspect: number,
  radius: number = POINT_HIT_RADIUS,
): number | null {
  for (let i = state.points.length - 1; i >= 0; i--) {
    if (squareDistance(state.points[i]!, p, aspect) <= radius) return i;
  }
  return null;
}

/** Whether a press at `p` would close the path rather than add to it. */
export function wouldClose(state: PathToolState, p: NormalizedPoint, aspect: number): boolean {
  if (state.closed || state.points.length < CLOSE_MIN_POINTS) return false;
  return squareDistance(state.points[0]!, p, aspect) <= POINT_HIT_RADIUS;
}

/**
 * `p` snapped to a right angle from `anchor` — D19's shift constraint.
 *
 * The axis kept is the one the pointer travelled further along **as seen on the
 * canvas**, not as measured in normalized units: a drag of 0.1 in x and 0.1 in
 * y is a 45° line in normalized space and a much flatter one on a 16:9 canvas,
 * and snapping it to the vertical because the numbers tied would be the tool
 * disagreeing with the operator's eyes.
 *
 * A tie goes to the horizontal. Reachable — a diagonal drag on a square canvas
 * hits it — and it has to go somewhere, so it goes to the axis a table of
 * rectangular panels is mostly drawn along.
 */
export function constrainToRightAngle(
  anchor: NormalizedPoint,
  p: NormalizedPoint,
  aspect: number,
): PathPoint {
  const dx = Math.abs(p.x - anchor.x);
  const dy = Math.abs(p.y - anchor.y) / aspect;
  return dy > dx ? { x: anchor.x, y: p.y } : { x: p.x, y: anchor.y };
}

/** The point a press at `p` would place, constraint honoured. */
function placedPoint(
  state: PathToolState,
  p: NormalizedPoint,
  aspect: number,
  shift: boolean,
): PathPoint {
  const last = state.points[state.points.length - 1];
  if (!shift || !last) return { x: p.x, y: p.y };
  return constrainToRightAngle(last, p, aspect);
}

/**
 * Pointer-down. The ordering IS the decision, so it is a function with a test
 * rather than a branch in a handler — the same shape `beginGesture` has:
 *
 *  1. **The first point, on a path long enough to enclose something** — close
 *     it. Closing wins over grabbing that same point, because a path is closed
 *     once and its points are dragged many times; the operator who wanted to
 *     drag it can do so after, on a closed path, where rule 1 no longer fires.
 *  2. **An existing point** — grab it.
 *  3. **Anywhere else** — append a point and start placing it. Whether that is
 *     a click or a stroke is not decided here (D19).
 */
export function pathToolDown(
  state: PathToolState,
  p: NormalizedPoint,
  aspect: number,
  shift = false,
): PathToolState {
  // A finished path takes no more pointer input. This is what makes finishing
  // mean something rather than being a label — without it, `finished` would be
  // a flag the status line reads and the tool ignores.
  if (state.finished) return state;
  if (wouldClose(state, p, aspect)) {
    // `closed` is the only field that changes. Not "the only field that
    // *should* change" — the spread is the mechanism, and the test asserts the
    // rest of the state is deep-equal to what it was.
    return { ...state, closed: true };
  }
  const hit = pointIndexAt(state, p, aspect);
  if (hit !== null) {
    return { ...state, press: { kind: 'grab', index: hit } };
  }
  const point = placedPoint(state, p, aspect, shift);
  return {
    ...state,
    points: [...state.points, point],
    press: {
      kind: 'draw',
      origin: { x: p.x, y: p.y },
      startIndex: state.points.length,
      freehand: false,
    },
  };
}

/**
 * Pointer-move. Three shapes, and only one of them appends:
 *
 * - **No press** — nothing. The preview's rubber band is drawn from
 *   `previewPoints`, which takes the pointer as an argument rather than
 *   requiring the state to remember it.
 * - **Grab** — the grabbed point follows the pointer. Editing an existing point
 *   ignores `shift`: the constraint is about the angle a point is *placed* at
 *   relative to the one before it, and applying it to a drag would silently
 *   re-anchor a mid-path point to its predecessor.
 * - **Draw** — below `CLICK_SLOP` nothing happens at all: the point stays where
 *   it fell. Above it, the press has latched into a stroke and every sample far
 *   enough from the last one is appended.
 */
export function pathToolMove(
  state: PathToolState,
  p: NormalizedPoint,
  aspect: number,
  shift = false,
): PathToolState {
  const press = state.press;
  if (!press) return state;

  if (press.kind === 'grab') {
    const points = state.points.slice();
    points[press.index] = { x: p.x, y: p.y };
    return { ...state, points };
  }

  // Below the slop the press is still a click, and **the point does not move**.
  // It stays where the pointer went down.
  //
  // It used to follow the pointer, on the theory that a click lands where the
  // finger lifted. At a 2.9 px slop that was invisible either way. At a real
  // 7.2 px slop it is the difference between aiming at a corner and getting it,
  // and aiming at a corner and getting a point up to seven pixels away — and it
  // also cost a freehand stroke its first seven pixels, because the origin
  // point was dragged along to wherever the press finally latched. Doing
  // nothing here is both the simpler branch and the correct one.
  const freehand = press.freehand || squareDistance(press.origin, p, aspect) > CLICK_SLOP;
  if (!freehand) return state;

  const last = state.points[state.points.length - 1]!;
  if (squareDistance(last, p, aspect) < FREEHAND_MIN_STEP) {
    // Too close to record, but the press has latched — so the latch is stored
    // even when the sample is dropped. Losing it here would make a stroke that
    // paused mid-drag finish as a click.
    return press.freehand ? state : { ...state, press: { ...press, freehand: true } };
  }
  return {
    ...state,
    points: [...state.points, { x: p.x, y: p.y }],
    press: { ...press, freehand: true },
  };
}

/**
 * Pointer-up. **The only place simplification happens**, and only for the run
 * this press drew.
 *
 * The run is `points[startIndex …]` — everything the press appended and nothing
 * before it. Simplifying the whole path instead would move points the operator
 * placed one deliberate click at a time, which is the difference between a tool
 * that tidies a stroke and a tool that argues with you.
 *
 * A click releases with a one-point run, which `simplifyPoints` returns
 * unchanged; `lastSimplification` is only written when a run was actually
 * simplified, so the reported pair always belongs to a stroke.
 */
export function pathToolUp(
  state: PathToolState,
  p: NormalizedPoint | null,
  aspect: number,
  shift = false,
): PathToolState {
  if (!state.press) return state;
  const moved = p ? pathToolMove(state, p, aspect, shift) : state;
  return endPress(moved);
}

/**
 * End whatever press is in flight, simplifying the run it drew.
 *
 * Shared by `pathToolUp` and `finishPath` rather than written twice, because
 * "a stroke is simplified exactly once, on release" is the rule and two copies
 * of it is one copy too many — Enter pressed with the pointer still down has to
 * take the same path a normal release does or it would commit a raw stroke.
 */
function endPress(state: PathToolState): PathToolState {
  const settled = state.press?.kind === 'draw' ? state.press : null;
  if (!settled || !settled.freehand) return { ...state, press: null };

  const head = state.points.slice(0, settled.startIndex);
  const run = state.points.slice(settled.startIndex);
  const simplified = simplifyPoints(run, FREEHAND_TOLERANCE);
  return {
    ...state,
    points: [...head, ...simplified],
    press: null,
    lastSimplification: { before: run.length, after: simplified.length },
  };
}

/**
 * Finish the path where it stands — the Enter key.
 *
 * The path ends at **the last point the operator marked**. Nothing is appended,
 * nothing is joined, `closed` is not touched: an open path that has been
 * finished is an open path, which is exactly what a route is (I-17) and what an
 * outline along one edge of a box is.
 *
 * A path of fewer than two points cannot be finished, and this returns it
 * unfinished rather than throwing. One point is not a shape — `pathSegments`
 * yields nothing for it — and an operator who pressed Enter after a single
 * stray click means "never mind", not "commit this". The press still ends, so
 * the key is never inert.
 */
export function finishPath(state: PathToolState): PathToolState {
  if (state.finished) return state;
  const ended = state.press ? endPress(state) : state;
  if (ended.points.length < 2) return ended;
  return { ...ended, finished: true };
}

/**
 * Remove one point. Single-concern on purpose: it removes a point and touches
 * nothing else.
 *
 * In particular it does NOT clear `closed` when the path drops below
 * `CLOSE_MIN_POINTS`. Deleting a point from a triangle would then flip a second
 * field the operator did not ask about, and the degenerate result — a two-point
 * closed path whose closing segment retraces its only segment — is a shape
 * `pathSegments` already handles and the operator can see and undo by deleting
 * one more point.
 *
 * An out-of-range index returns the state unchanged rather than throwing: the
 * index comes from a hit test on a list the pointer can shorten mid-gesture,
 * which is drift, not corruption (Block A's clamp-versus-refuse rule).
 */
export function deletePointAt(state: PathToolState, index: number): PathToolState {
  if (!Number.isInteger(index) || index < 0 || index >= state.points.length) return state;
  return {
    ...state,
    points: state.points.filter((_, i) => i !== index),
    // A press holds an index into the list this call is reindexing. Ending it
    // is the mechanism; keeping it and adjusting would leave a grab pointing at
    // a neighbour of the point that was deleted.
    press: null,
  };
}

/**
 * The points to draw right now, including the rubber band to a pointer that has
 * not pressed yet.
 *
 * The preview is drawn from this and the commit is built from `pathToolPath`,
 * both off the same `points` array, so the line the operator watches and the
 * path they get are not two approximations of each other. `hover` is `null`
 * when the pointer is outside the surface or a press is in flight — during a
 * press the appended point already tracks the pointer. A closed or finished
 * path gets no band: there is no next point for it to lead to.
 */
export function previewPoints(
  state: PathToolState,
  hover: NormalizedPoint | null,
  aspect: number,
  shift = false,
): PathPoint[] {
  const points = state.points.map((q) => ({ ...q }));
  if (!hover || state.press || state.closed || state.finished || points.length === 0) return points;
  points.push(placedPoint(state, hover, aspect, shift));
  return points;
}

/**
 * The path the tool has drawn.
 *
 * Built through `createPath`, so the pointer stream goes through the same
 * clamp every other path source does (I-1) rather than trusting that a
 * normalized point from `toNormalizedPoint` was already in range.
 */
export function pathToolPath(state: PathToolState, id: string): Path {
  return createPath({ id, points: state.points, closed: state.closed });
}

/**
 * More than one path.
 *
 * The tool draws one path at a time, which is right — a pointer has one
 * position and a stroke has one owner. But a room has many paths: a box has a
 * face per side, a table of panels has one per panel, and a scene has a route
 * *and* the boundary it stays inside. The first version of this block could
 * hold exactly one and threw it away to start another, which made the tool
 * useless for the thing it exists for.
 *
 * A session is therefore the finished paths plus the one being drawn. It is
 * **editor state and nothing else** — not serialized, not sent over IPC, not
 * written to `calibration/`. P6-A is where a finished path becomes a `Surface`
 * with a role and a home in `calibration/surfaces.json`; until then this is a
 * drawing board, and `commitActivePath` is the single call that block will
 * re-point at the surface tree.
 */
export interface PathSession {
  /** Finished paths, in the order they were drawn. */
  paths: Path[];
  /** The one taking pointer input. */
  active: PathToolState;
  /** The banked path under selection, or null. Editor state, as P5-B's is. */
  selectedId: string | null;
  /**
   * A move in flight. Holds an id and the grab offset — **never a copy of the
   * path**, which is `interaction.ts`'s ruling and is what makes the move a
   * function of the current session rather than of a snapshot: a path removed
   * mid-drag ends the move instead of resurrecting itself.
   */
  move: { id: string; grab: NormalizedPoint } | null;
}

export function emptyPathSession(): PathSession {
  return { paths: [], active: emptyPathTool(), selectedId: null, move: null };
}

/** How near a banked path's outline the pointer must be to hit it. Square space. */
export const PATH_HIT_TOLERANCE = 0.012;

/** A point with y scaled so distances measure what the canvas shows (`handleAt`). */
function square(p: NormalizedPoint, aspect: number): PathPoint {
  return { x: p.x, y: p.y / aspect };
}

/**
 * Distance from `p` to the nearest point of the path's outline.
 *
 * `pathSegments` supplies the segments, so a closed path's closing segment is
 * hit-testable and an open one's is not — the one place `closed` changes
 * behaviour stays the one place. `perpendicularDistance` comes from
 * `core/paths.ts`, the same function the simplifier uses, with both inputs
 * pre-scaled into square space here: anisotropy is the editor's problem, and
 * `core/` stays a pure normalized-space measure.
 */
export function distanceToPath(path: Path, p: NormalizedPoint, aspect: number): number {
  const segments = pathSegments(path);
  if (segments.length === 0) {
    const only = path.points[0];
    if (!only) return Infinity;
    const q = square(only, aspect);
    const s = square(p, aspect);
    return Math.hypot(s.x - q.x, s.y - q.y);
  }
  let best = Infinity;
  const s = square(p, aspect);
  for (const seg of segments) {
    const d = perpendicularDistance(s, square(seg.a, aspect), square(seg.b, aspect));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Whether `p` falls inside a closed path. Ray casting, half-open on `y` so a
 * vertex is counted once rather than twice.
 *
 * No `aspect`, and that is not an oversight: containment is unchanged by
 * scaling one axis, so the square-space correction that distance needs would be
 * arithmetic with no effect. Open paths contain nothing — an outline along one
 * edge of a box has no inside.
 */
export function pathContains(path: Path, p: NormalizedPoint): boolean {
  if (!path.closed || path.points.length < 3) return false;
  let inside = false;
  const pts = path.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The banked path under the pointer, or null.
 *
 * Walks backwards, so the most recently drawn path wins an overlap — the same
 * rule `pointIndexAt` uses, for the same reason. A closed path is hit anywhere
 * inside it, not only on its outline: a marked face of a box is a region on the
 * wall, and requiring the operator to click its one-pixel edge would be an
 * affordance that exists on paper.
 */
export function pathHitTest(
  paths: readonly Path[],
  p: NormalizedPoint,
  aspect: number,
  tolerance: number = PATH_HIT_TOLERANCE,
): string | null {
  for (let i = paths.length - 1; i >= 0; i--) {
    const path = paths[i]!;
    if (pathContains(path, p) || distanceToPath(path, p, aspect) <= tolerance) return path.id;
  }
  return null;
}

/** The path's bounding box in normalized space, or null when it has no points. */
export function pathBounds(
  path: Path,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const first = path.points[0];
  if (!first) return null;
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const q of path.points) {
    if (q.x < minX) minX = q.x;
    if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Move every point of a path by the same offset.
 *
 * **The offset is clamped, not the points.** Clamping each point on its own
 * would deform the shape the moment it touched an edge — the leading points
 * would stop while the trailing ones kept coming, and a square dragged off the
 * frame would come back a trapezoid. Clamping the offset by the bounding box
 * slides the path until it touches the edge and then stops it, whole. This is
 * the same ruling `setLayerRect` makes for a region and it matters more here,
 * because a path has no width and height to restore it from.
 */
export function translatePath(path: Path, dx: number, dy: number): Path {
  const b = pathBounds(path);
  if (!b) return path;
  const cdx = Math.min(Math.max(dx, -b.minX), 1 - b.maxX);
  const cdy = Math.min(Math.max(dy, -b.minY), 1 - b.maxY);
  if (cdx === 0 && cdy === 0) return path;
  return { ...path, points: path.points.map((q) => ({ x: q.x + cdx, y: q.y + cdy })) };
}

/**
 * The next free `path-N`, picked the way `addLayer` picks a layer id: the first
 * suffix nothing is using, not a counter.
 *
 * A counter would drift the moment a path is removed — two paths could end up
 * sharing an id after a delete and a redraw, and an id collision in a list that
 * P6-A will turn into surfaces is the kind of fault that surfaces as "the wrong
 * wall lit up".
 */
export function nextPathId(paths: readonly Path[]): string {
  let n = 1;
  while (paths.some((q) => q.id === `path-${n}`)) n++;
  return `path-${n}`;
}

/**
 * Finish the active path and bank it — the Enter key, end to end.
 *
 * One gesture, not two. The operator who has just finished drawing a face wants
 * to draw the next one, and making them press Enter and then click a button is
 * the affordance nobody finds twice.
 *
 * A path that cannot be finished is not banked, and the session comes back with
 * its press ended and its points intact — `finishPath` decides that, so "what
 * counts as a path" is answered in exactly one place.
 */
export function commitActivePath(session: PathSession): PathSession {
  const finished = finishPath(session.active);
  if (!finished.finished) return { ...session, active: finished };
  const paths = [...session.paths, pathToolPath(finished, nextPathId(session.paths))];
  return { ...session, paths, active: emptyPathTool() };
}

/** Throw away the path being drawn. The banked ones are untouched. */
export function discardActivePath(session: PathSession): PathSession {
  return { ...session, active: emptyPathTool() };
}

/**
 * Remove a banked path by id. Unknown id returns the session unchanged — the id
 * comes from a list the operator can shorten, which is drift rather than
 * corruption (Block A's rule).
 */
export function removePath(session: PathSession, id: string): PathSession {
  if (!session.paths.some((q) => q.id === id)) return session;
  return {
    ...session,
    paths: session.paths.filter((q) => q.id !== id),
    // A selection and a move that name a path no longer in the list are
    // dangling references, cleared here rather than checked for at every read.
    selectedId: session.selectedId === id ? null : session.selectedId,
    move: session.move?.id === id ? null : session.move,
  };
}

/**
 * Pointer-down on the session. The ordering IS the decision, the way
 * `beginGesture` and `pathToolDown` are, and it resolves the one real conflict
 * in having both drawing and selecting on the same button:
 *
 *  1. **A path is being drawn** — every press goes to it. Mid-path, a click is
 *     always the next point, so a stroke that happens to cross a banked path
 *     cannot select it out from under the operator.
 *  2. **A banked path under the pointer** — select it and move it, in one
 *     press. P5-B's ruling, for its reason: two gestures to move an unselected
 *     thing is the affordance nobody finds.
 *  3. **Empty space** — deselect and start a new path.
 *
 * There is no mode here either. What decides is whether a path is in progress,
 * which is a fact about the session rather than a switch the operator sets —
 * and Enter, which banks the active path, is the same key that ends rule 1.
 */
export function pathSessionDown(
  session: PathSession,
  p: NormalizedPoint,
  aspect: number,
  shift = false,
): PathSession {
  if (session.active.points.length > 0) {
    return { ...session, active: pathToolDown(session.active, p, aspect, shift) };
  }
  const hit = pathHitTest(session.paths, p, aspect);
  if (hit !== null) {
    const path = session.paths.find((q) => q.id === hit)!;
    const anchor = path.points[0]!;
    return {
      ...session,
      selectedId: hit,
      move: { id: hit, grab: { x: p.x - anchor.x, y: p.y - anchor.y } },
    };
  }
  return {
    ...session,
    selectedId: null,
    active: pathToolDown(session.active, p, aspect, shift),
  };
}

/**
 * Pointer-move on the session.
 *
 * A move in flight translates the whole path; anything else goes to the active
 * path. The offset is computed from the path's CURRENT first point against the
 * grab, so nothing accumulates and a move interrupted and resumed lands in the
 * same place as one that was not.
 */
export function pathSessionMove(
  session: PathSession,
  p: NormalizedPoint,
  aspect: number,
  shift = false,
): PathSession {
  const move = session.move;
  if (move) {
    const path = session.paths.find((q) => q.id === move.id);
    if (!path) return { ...session, move: null };
    const anchor = path.points[0]!;
    const moved = translatePath(path, p.x - move.grab.x - anchor.x, p.y - move.grab.y - anchor.y);
    if (moved === path) return session;
    return { ...session, paths: session.paths.map((q) => (q.id === move.id ? moved : q)) };
  }
  return { ...session, active: pathToolMove(session.active, p, aspect, shift) };
}

/** Pointer-up on the session. Ends a move, or releases the active path's press. */
export function pathSessionUp(
  session: PathSession,
  p: NormalizedPoint | null,
  aspect: number,
  shift = false,
): PathSession {
  if (session.move) return { ...session, move: null };
  return { ...session, active: pathToolUp(session.active, p, aspect, shift) };
}

/**
 * The Delete key, in the same order pointer-down uses: a path in progress owns
 * the key and loses a point; otherwise the selected banked path is removed.
 *
 * `hover` picks which point goes when a path is in progress — the one under the
 * pointer, or the last one placed, which is what "undo that click" means.
 */
export function deleteFromPathSession(
  session: PathSession,
  hover: NormalizedPoint | null,
  aspect: number,
): PathSession {
  if (session.active.points.length > 0) {
    const at = hover ? pointIndexAt(session.active, hover, aspect) : null;
    return {
      ...session,
      active: deletePointAt(session.active, at ?? session.active.points.length - 1),
    };
  }
  if (session.selectedId === null) return session;
  return removePath(session, session.selectedId);
}
