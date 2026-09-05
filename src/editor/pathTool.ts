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
import { createPath, simplifyPoints, type Path, type PathPoint } from '../core/paths';
import type { NormalizedPoint } from './interaction';

/**
 * How far a press may travel and still count as a click, in normalized units
 * measured in the square space.
 *
 * This is the whole of "no mode switch": above it the press is a stroke, below
 * it a click, and nothing else in the file asks the question. It is generous on
 * purpose — a hand on a trackpad moves a few thousandths of the frame while
 * clicking, and a click that silently became a two-point stroke would leave a
 * duplicate point the operator has to find and delete.
 */
export const CLICK_SLOP = 0.006;

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
  return { points: [], closed: false, press: null, lastSimplification: null };
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
 * - **Draw** — below `CLICK_SLOP` the appended point simply follows the pointer
 *   (so a click that wobbles lands where the finger lifted, not where it fell);
 *   above it, the press has latched into a stroke and every sample far enough
 *   from the last one is appended.
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

  const freehand = press.freehand || squareDistance(press.origin, p, aspect) > CLICK_SLOP;
  if (!freehand) {
    const points = state.points.slice();
    points[press.startIndex] = placedPoint(
      { ...state, points: points.slice(0, press.startIndex) },
      p,
      aspect,
      shift,
    );
    return { ...state, points };
  }

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
  const press = state.press;
  if (!press) return state;
  const moved = p ? pathToolMove(state, p, aspect, shift) : state;
  const settled = moved.press?.kind === 'draw' ? moved.press : null;

  if (!settled || !settled.freehand) return { ...moved, press: null };

  const head = moved.points.slice(0, settled.startIndex);
  const run = moved.points.slice(settled.startIndex);
  const simplified = simplifyPoints(run, FREEHAND_TOLERANCE);
  return {
    ...moved,
    points: [...head, ...simplified],
    press: null,
    lastSimplification: { before: run.length, after: simplified.length },
  };
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
 * press the appended point already tracks the pointer.
 */
export function previewPoints(
  state: PathToolState,
  hover: NormalizedPoint | null,
  aspect: number,
  shift = false,
): PathPoint[] {
  const points = state.points.map((q) => ({ ...q }));
  if (!hover || state.press || state.closed || points.length === 0) return points;
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
