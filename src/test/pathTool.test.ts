/**
 * P5-D — the path tool.
 *
 * Every test here drives the tool through the same three functions a pointer
 * would (`pathToolDown` / `pathToolMove` / `pathToolUp`), because D19's claim is
 * about what a sequence of pointer events *means* and a test that called an
 * internal helper directly would prove nothing about the sequence.
 *
 * The fixtures are jittered. That is not decoration: P5-A's one wrong assertion
 * was a corner asserted at its idealised coordinate, and a corner in real
 * freehand input carries the jitter like every other sample in the run.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserializePath, serializePath, type PathPoint } from '../core/paths';
import { aspectOf } from '../editor/interaction';
import {
  CLICK_SLOP,
  CLOSE_MIN_POINTS,
  MIN_STROKE_LENGTH,
  FREEHAND_MIN_STEP,
  FREEHAND_TOLERANCE,
  POINT_HIT_RADIUS,
  commitActivePath,
  constrainToRightAngle,
  deletePointAt,
  discardActivePath,
  deleteFromPathSession,
  distanceToPath,
  emptyPathSession,
  finishPath,
  nextPathId,
  pathBounds,
  pathContains,
  pathHitTest,
  pathSessionDown,
  pathSessionMove,
  pathSessionUp,
  removePath,
  translatePath,
  emptyPathTool,
  pathToolDown,
  pathToolMove,
  pathToolPath,
  pathToolUp,
  pointIndexAt,
  previewPoints,
  wouldClose,
  type PathSession,
  type PathToolState,
} from '../editor/pathTool';

/** The preview's aspect, and a square one, so no test is 16:9-only by accident. */
const WIDE = aspectOf(480, 270);
const SQUARE = aspectOf(512, 512);

/** A click: down and up at one point, with no move between them. */
const click = (s: PathToolState, x: number, y: number, shift = false): PathToolState =>
  pathToolUp(pathToolDown(s, { x, y }, WIDE, shift), { x, y }, WIDE, shift);

/** A drag: down, every sample, up — the pointer stream, in order. */
const drag = (s: PathToolState, samples: readonly PathPoint[], aspect = WIDE): PathToolState => {
  let next = pathToolDown(s, samples[0]!, aspect);
  for (let i = 1; i < samples.length; i++) next = pathToolMove(next, samples[i]!, aspect);
  return pathToolUp(next, samples[samples.length - 1]!, aspect);
};

/**
 * The jitter amplitude every fixture below is built with, in normalized units.
 *
 * Above `FREEHAND_MIN_STEP`, so a jittered sample is recorded rather than
 * dropped as a duplicate — a fixture whose jitter the tool silently discarded
 * would test the simplifier against a clean line while claiming otherwise.
 * Below `FREEHAND_TOLERANCE`, so the simplifier is supposed to remove it.
 */
const JITTER = 0.002;

/**
 * Float drift, allowed on top of a bound expressed in fixture coordinates.
 *
 * `0.5 + JITTER` is 0.502, and `0.502 - 0.5` is `0.0020000000000000018` — so a
 * bound of exactly `JITTER` rejects the very sample the fixture placed there.
 * Block A ruled on this class already: a value that drifted is accepted, not
 * refused.
 */
const DRIFT = 1e-9;

/** A straight horizontal run to a real corner, then straight down. Jittered. */
const corneredStroke = (): PathPoint[] => {
  const out: PathPoint[] = [];
  const wobble = (i: number): number => (i % 2 === 0 ? JITTER : -JITTER);
  for (let i = 0; i <= 20; i++) out.push({ x: 0.3 + i * 0.01, y: 0.5 + wobble(i) });
  for (let i = 1; i <= 20; i++) out.push({ x: 0.5 + wobble(i), y: 0.5 + i * 0.01 });
  return out;
};

describe('D19 — one tool, no mode switch', () => {
  it('a click adds a point', () => {
    let s = click(emptyPathTool(), 0.2, 0.3);
    expect(s.points).toEqual([{ x: 0.2, y: 0.3 }]);
    s = click(s, 0.8, 0.3);
    expect(s.points).toHaveLength(2);
    expect(s.press).toBeNull();
  });

  it('a drag draws a run of points, through the same three calls', () => {
    const s = drag(emptyPathTool(), corneredStroke());
    expect(s.points.length).toBeGreaterThan(2);
    expect(s.press).toBeNull();
  });

  it('a click and a drag build one path with no tool switch between them', () => {
    // Two clicked corners, then a freehand run, then one more click — the
    // sequence D19 describes, run without anything in between resembling a mode.
    let s = click(emptyPathTool(), 0.1, 0.1);
    s = click(s, 0.3, 0.1);
    const clickedThenDragged = drag(s, corneredStroke());
    const afterOneMoreClick = click(clickedThenDragged, 0.9, 0.9);
    expect(afterOneMoreClick.points[0]).toEqual({ x: 0.1, y: 0.1 });
    expect(afterOneMoreClick.points[1]).toEqual({ x: 0.3, y: 0.1 });
    expect(afterOneMoreClick.points[afterOneMoreClick.points.length - 1]).toEqual({
      x: 0.9,
      y: 0.9,
    });
    expect(afterOneMoreClick.points.length).toBeGreaterThan(4);
  });

  it('the clicked points a drag was appended to are left exactly where they were', () => {
    let s = click(emptyPathTool(), 0.1, 0.1);
    s = click(s, 0.3, 0.1);
    const before = s.points.map((p) => ({ ...p }));
    const after = drag(s, corneredStroke());
    // Simplification touches the run this press drew and nothing before it.
    expect(after.points.slice(0, 2)).toEqual(before);
  });

  it('a press that wobbles under CLICK_SLOP is still a click, not a two-point run', () => {
    const start = { x: 0.4, y: 0.4 };
    let s = pathToolDown(emptyPathTool(), start, WIDE);
    s = pathToolMove(s, { x: start.x + CLICK_SLOP / 2, y: start.y }, WIDE);
    s = pathToolUp(s, { x: start.x + CLICK_SLOP / 2, y: start.y }, WIDE);
    expect(s.points).toHaveLength(1);
    // It lands where the finger FELL. The operator aimed at that spot before
    // pressing; the drift between press and release is the hand, not intent.
    expect(s.points[0]).toEqual(start);
    expect(s.lastSimplification).toBeNull();
  });

  it('the slop is a real drag threshold, not a sub-pixel one', () => {
    // The bug the operator hit: one click at a sharp corner produced two
    // points, because the hand is already moving toward the next point as the
    // button comes up and the old 0.006 slop was 2.9 px on the preview.
    // Asserted in pixels, because that is the only frame this can be judged in.
    expect(CLICK_SLOP * 480).toBeGreaterThan(5);
    const corner = { x: 0.5, y: 0.5 };
    let s = click(emptyPathTool(), 0.2, 0.5);
    // A click that drifts 4 px while the button is down — normal hand noise.
    s = pathToolDown(s, corner, WIDE);
    s = pathToolMove(s, { x: corner.x + 4 / 480, y: corner.y + 3 / 270 }, WIDE);
    s = pathToolUp(s, { x: corner.x + 4 / 480, y: corner.y + 3 / 270 }, WIDE);
    expect(s.points).toHaveLength(2);
    expect(s.points[1]).toEqual(corner);
  });

  it('a press past CLICK_SLOP latches into a stroke and stays one', () => {
    let s = pathToolDown(emptyPathTool(), { x: 0.4, y: 0.4 }, WIDE);
    s = pathToolMove(s, { x: 0.4 + MIN_STROKE_LENGTH, y: 0.4 }, WIDE);
    // Back to where it started. A stroke that returns home is still a stroke —
    // which is why MIN_STROKE_LENGTH measures length ALONG the run and not
    // displacement, since this one ends where it began.
    s = pathToolMove(s, { x: 0.4, y: 0.4 }, WIDE);
    s = pathToolUp(s, { x: 0.4, y: 0.4 }, WIDE);
    expect(s.points.length).toBeGreaterThan(1);
    expect(s.lastSimplification).not.toBeNull();
  });

  it('a click that SLIPS past the slop is still one point — the fault from the wall', () => {
    // The operator's screenshot: one click at a corner, two points on screen.
    // A press that clears CLICK_SLOP produces at least two points no matter
    // where the slop is set, so the release decides instead, with the whole run
    // in hand. Every one of these is a slip, not a stroke.
    for (const px of [8, 12, 18, 23]) {
      let s = click(emptyPathTool(), 0.2, 0.5);
      const corner = { x: 0.6, y: 0.5 };
      s = pathToolDown(s, corner, WIDE);
      // Several samples, the way a real pointer stream delivers a slip.
      for (let i = 1; i <= 4; i++) {
        s = pathToolMove(s, { x: corner.x + (px * i) / 4 / 480, y: corner.y }, WIDE);
      }
      s = pathToolUp(s, { x: corner.x + px / 480, y: corner.y }, WIDE);
      expect(s.points).toHaveLength(2);
      expect(s.points[1]).toEqual(corner);
      expect(s.lastSimplification).toBeNull();
    }
  });

  it('a stroke just over the minimum is still a stroke', () => {
    let s = pathToolDown(emptyPathTool(), { x: 0.3, y: 0.5 }, WIDE);
    for (let i = 1; i <= 8; i++) {
      s = pathToolMove(s, { x: 0.3 + (MIN_STROKE_LENGTH * 1.5 * i) / 8, y: 0.5 }, WIDE);
    }
    s = pathToolUp(s, { x: 0.3 + MIN_STROKE_LENGTH * 1.5, y: 0.5 }, WIDE);
    expect(s.points.length).toBeGreaterThan(1);
    expect(s.lastSimplification).not.toBeNull();
  });

  it('a stroke that pauses mid-drag does not finish as a click', () => {
    let s = pathToolDown(emptyPathTool(), { x: 0.4, y: 0.4 }, WIDE);
    // Long enough to be a real stroke, so this tests the latch and not the
    // release-time length rule.
    s = pathToolMove(s, { x: 0.4 + MIN_STROKE_LENGTH * 2, y: 0.4 }, WIDE);
    // A sample under FREEHAND_MIN_STEP from the last one: dropped as a point,
    // but the latch it would otherwise clear is what this asserts.
    s = pathToolMove(
      s,
      { x: 0.4 + MIN_STROKE_LENGTH * 2 + FREEHAND_MIN_STEP / 2, y: 0.4 },
      WIDE,
    );
    expect((s.press as { freehand: boolean }).freehand).toBe(true);
    expect(pathToolUp(s, null, WIDE).lastSimplification).not.toBeNull();
  });

  it('has nowhere for a mode to live', () => {
    // The structural half of "no mode switch": the state carries four fields
    // and none of them is a mode, so adding one is a visible type change rather
    // than a behaviour nobody notices. Read as source, like P5-C's grep test.
    expect(Object.keys(emptyPathTool()).sort()).toEqual([
      'closed',
      'finished',
      'lastSimplification',
      'points',
      'press',
    ]);
    const src = readFileSync(join(process.cwd(), 'src/editor/pathTool.ts'), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l))
      .join('\n');
    expect(/\bmode\b/i.test(src)).toBe(false);
  });
});

describe('the right-angle constraint', () => {
  it('snaps the next point to the horizontal or the vertical from the previous one', () => {
    let s = click(emptyPathTool(), 0.2, 0.5);
    s = click(s, 0.7, 0.56, true); // mostly horizontal
    expect(s.points[1]).toEqual({ x: 0.7, y: 0.5 });
    s = click(s, 0.74, 0.9, true); // mostly vertical
    expect(s.points[2]).toEqual({ x: 0.7, y: 0.9 });
  });

  it('chooses the axis by what the canvas shows, not by the raw numbers', () => {
    const anchor = { x: 0.5, y: 0.5 };
    const p = { x: 0.6, y: 0.6 };
    // Equal in normalized units. On a 16:9 canvas that is a shallow line — the
    // x travel is nearly twice the y travel in pixels — so it snaps horizontal.
    expect(constrainToRightAngle(anchor, p, WIDE)).toEqual({ x: 0.6, y: 0.5 });
    // On a square canvas the same numbers are a true 45°, and the documented
    // tie-break sends it to the horizontal.
    expect(constrainToRightAngle(anchor, p, SQUARE)).toEqual({ x: 0.6, y: 0.5 });
    // Tip it past the tie and the vertical wins.
    expect(constrainToRightAngle(anchor, { x: 0.6, y: 0.75 }, SQUARE)).toEqual({ x: 0.5, y: 0.75 });
    // The case that separates the two: 0.1 across and 0.15 down is vertical by
    // the raw numbers and HORIZONTAL on a 16:9 canvas, where 0.1 of the width
    // is 48 px and 0.15 of the height is 40. The operator sees the wider one.
    expect(constrainToRightAngle({ x: 0.4, y: 0.4 }, { x: 0.5, y: 0.55 }, WIDE)).toEqual({
      x: 0.5,
      y: 0.4,
    });
    expect(constrainToRightAngle({ x: 0.4, y: 0.4 }, { x: 0.5, y: 0.55 }, SQUARE)).toEqual({
      x: 0.4,
      y: 0.55,
    });
  });

  it('does nothing to the first point — there is no previous one to be square to', () => {
    const s = click(emptyPathTool(), 0.37, 0.61, true);
    expect(s.points[0]).toEqual({ x: 0.37, y: 0.61 });
  });

  it('constrains the live preview with the same arithmetic the commit uses', () => {
    const s = click(emptyPathTool(), 0.2, 0.5);
    const preview = previewPoints(s, { x: 0.7, y: 0.56 }, WIDE, true);
    expect(preview[1]).toEqual({ x: 0.7, y: 0.5 });
    expect(click(s, 0.7, 0.56, true).points[1]).toEqual(preview[1]);
  });

  it('is not applied when dragging an existing point', () => {
    let s = click(emptyPathTool(), 0.2, 0.5);
    s = click(s, 0.7, 0.5);
    s = pathToolDown(s, { x: 0.2, y: 0.5 }, WIDE, true);
    s = pathToolMove(s, { x: 0.25, y: 0.62 }, WIDE, true);
    s = pathToolUp(s, { x: 0.25, y: 0.62 }, WIDE, true);
    expect(s.points[0]).toEqual({ x: 0.25, y: 0.62 });
  });
});

describe('Enter finishes an open path at the last point marked', () => {
  const run = (): PathToolState => {
    let s = click(emptyPathTool(), 0.2, 0.3);
    s = click(s, 0.5, 0.3);
    return click(s, 0.8, 0.45);
  };

  it('ends the path where it stands, without joining it into a loop', () => {
    const open = run();
    const done = finishPath(open, WIDE);
    expect(done.finished).toBe(true);
    // The three assertions that matter to the operator who asked for this: the
    // points are the ones they marked, the last one is still the last one, and
    // nothing became a loop.
    expect(done.points).toEqual(open.points);
    expect(done.points[done.points.length - 1]).toEqual({ x: 0.8, y: 0.45 });
    expect(done.closed).toBe(false);
    expect(pathToolPath(done, 'route-1').closed).toBe(false);
  });

  it('a finished path takes no more points', () => {
    const done = finishPath(run(), WIDE);
    expect(click(done, 0.9, 0.9)).toEqual(done);
    expect(pathToolDown(done, { x: 0.2, y: 0.3 }, WIDE)).toBe(done);
    // Including the one press that is not an append: it cannot be closed either.
    expect(pathToolDown(done, { x: 0.2, y: 0.3 }, WIDE).closed).toBe(false);
  });

  it('finishing mid-stroke ends the press and simplifies it, exactly like a release', () => {
    const stroke = corneredStroke();
    let s = pathToolDown(emptyPathTool(), stroke[0]!, WIDE);
    for (let i = 1; i < stroke.length; i++) s = pathToolMove(s, stroke[i]!, WIDE);
    const done = finishPath(s, WIDE);
    expect(done.press).toBeNull();
    expect(done.finished).toBe(true);
    // The same counts a normal release produces — one rule, not two.
    expect(done.lastSimplification).toEqual(drag(emptyPathTool(), stroke).lastSimplification);
    expect(done.points).toEqual(drag(emptyPathTool(), stroke).points);
  });

  it('a single stray click cannot be finished — one point is not a path', () => {
    const one = click(emptyPathTool(), 0.4, 0.4);
    const after = finishPath(one, WIDE);
    expect(after.finished).toBe(false);
    expect(after.points).toHaveLength(1);
    expect(finishPath(emptyPathTool(), WIDE).finished).toBe(false);
  });

  it('finishing twice is the same as finishing once', () => {
    const done = finishPath(run(), WIDE);
    expect(finishPath(done, WIDE)).toBe(done);
  });

  it('a closed path is not automatically finished, and vice versa', () => {
    // The two flags answer different questions, and the block's own deliverable
    // requires closing to change exactly one field — so closing must not set
    // this one.
    let tri = click(emptyPathTool(), 0.2, 0.2);
    tri = click(tri, 0.8, 0.2);
    tri = click(tri, 0.5, 0.8);
    expect(pathToolDown(tri, { x: 0.2, y: 0.2 }, WIDE).finished).toBe(false);
    expect(finishPath(tri, WIDE).closed).toBe(false);
  });

  it('the preview stops offering a next point once the path is finished', () => {
    const done = finishPath(run(), WIDE);
    expect(previewPoints(done, { x: 0.95, y: 0.95 }, WIDE)).toEqual(done.points);
  });
});

describe('closing changes exactly one field', () => {
  const triangle = (): PathToolState => {
    let s = click(emptyPathTool(), 0.2, 0.2);
    s = click(s, 0.8, 0.2);
    return click(s, 0.5, 0.8);
  };

  it('a press on the first point closes the path, and closed is the only difference', () => {
    const open = triangle();
    const closed = pathToolDown(open, { x: 0.2, y: 0.2 }, WIDE);
    expect(closed.closed).toBe(true);
    expect(open.closed).toBe(false);
    // Everything else deep-equal — including `press`, which stays null: closing
    // is not the start of a gesture.
    expect({ ...closed, closed: false }).toEqual(open);
  });

  it('closes from anywhere inside the hit radius, not only from the exact point', () => {
    const s = triangle();
    expect(wouldClose(s, { x: 0.2 + POINT_HIT_RADIUS / 2, y: 0.2 }, WIDE)).toBe(true);
    expect(wouldClose(s, { x: 0.2 + POINT_HIT_RADIUS * 2, y: 0.2 }, WIDE)).toBe(false);
  });

  it('two points cannot close — a closing segment would retrace the only segment', () => {
    let s = click(emptyPathTool(), 0.2, 0.2);
    s = click(s, 0.8, 0.2);
    expect(s.points).toHaveLength(CLOSE_MIN_POINTS - 1);
    const after = pathToolDown(s, { x: 0.2, y: 0.2 }, WIDE);
    expect(after.closed).toBe(false);
    // It grabbed the point instead, which is rule 2 of the ordering.
    expect(after.press).toEqual({ kind: 'grab', index: 0 });
  });

  it('a closed path stops closing and lets its first point be dragged', () => {
    const closed = pathToolDown(triangle(), { x: 0.2, y: 0.2 }, WIDE);
    const again = pathToolDown(closed, { x: 0.2, y: 0.2 }, WIDE);
    expect(again.press).toEqual({ kind: 'grab', index: 0 });
    expect(again.closed).toBe(true);
  });

  it('the closed flag survives into the path, and the path round-trips', () => {
    const p = pathToolPath(pathToolDown(triangle(), { x: 0.2, y: 0.2 }, WIDE), 'surface-1');
    expect(p.closed).toBe(true);
    expect(p.interpolation).toBe('linear');
    expect(deserializePath(serializePath(p))).toEqual(p);
  });
});

describe('freehand simplification on release', () => {
  it('removes the jitter but keeps the corner', () => {
    const s = drag(emptyPathTool(), corneredStroke());
    expect(s.points.length).toBeLessThan(10);
    // The tolerance is JITTER, and that is the point of the test rather than a
    // convenience. The corner the operator drew is at (0.5, 0.5); the corner
    // the tool receives is whichever sample sat at the turn, and that sample
    // carries the jitter like every other sample in the run — so it is at
    // (0.5, 0.5 ± JITTER). Asserting the idealised corner would pass only if
    // the simplifier happened to cut on an even-numbered sample, which is an
    // accident of the fixture and not a property of the algorithm. Asserting a
    // small epsilon instead would be the same mistake wearing a smaller number.
    const corner = s.points.find(
      (p) => Math.abs(p.x - 0.5) <= JITTER + DRIFT && Math.abs(p.y - 0.5) <= JITTER + DRIFT,
    );
    expect(corner).toBeDefined();
    // And it is the jittered sample, not the ideal one — stated as an equality
    // so the test would notice if the simplifier ever started moving points.
    expect(corner).toEqual({ x: 0.5, y: 0.5 + JITTER });
  });

  it('the same stroke gives the same result, every time', () => {
    const first = drag(emptyPathTool(), corneredStroke());
    for (let i = 0; i < 20; i++) {
      expect(drag(emptyPathTool(), corneredStroke())).toEqual(first);
    }
  });

  it('a stroke of hundreds of points simplifies to tens', () => {
    // A wandering stroke — a curve with jitter on top, which is what a hand
    // drawing a cable run on a wall actually produces.
    const samples: PathPoint[] = [];
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      samples.push({
        x: 0.05 + 0.9 * t + (i % 2 === 0 ? JITTER : -JITTER),
        y: 0.5 + 0.35 * Math.sin(t * Math.PI * 3) + (i % 3 === 0 ? JITTER : -JITTER),
      });
    }
    const s = drag(emptyPathTool(), samples);
    const { before, after } = s.lastSimplification!;
    expect(before).toBeGreaterThan(200);
    expect(after).toBeLessThan(100);
    expect(after).toBe(s.points.length);
    // Recorded in BUILD_LOG.md — pinned here so the number in the log is the
    // number the tool produces, not a number somebody typed. `before` is 400
    // against 401 delivered samples: one pair of consecutive samples fell under
    // FREEHAND_MIN_STEP and was never recorded, which is the tool declining to
    // hand the simplifier a zero-length segment to think about.
    expect(samples).toHaveLength(401);
    expect({ before, after }).toEqual({ before: 398, after: 19 });
  });

  it('reports the counts of the run it simplified, not of the whole path', () => {
    let s = click(emptyPathTool(), 0.05, 0.05);
    s = click(s, 0.1, 0.05);
    const after = drag(s, corneredStroke());
    // The same run drawn alone reports the same `before` — so the number is the
    // run's, not the path's, which would be two larger. Asserted against the
    // tool rather than against the fixture length, because the tool
    // legitimately records fewer samples than were delivered: the ones under
    // CLICK_SLOP and the ones under FREEHAND_MIN_STEP never become points.
    const alone = drag(emptyPathTool(), corneredStroke());
    expect(after.lastSimplification!.before).toBe(alone.lastSimplification!.before);
    expect(after.lastSimplification!.before).toBeLessThan(corneredStroke().length);
    expect(after.points).toHaveLength(2 + after.lastSimplification!.after);
  });

  it('a click leaves the last reported counts alone', () => {
    const dragged = drag(emptyPathTool(), corneredStroke());
    const counts = dragged.lastSimplification;
    expect(counts).not.toBeNull();
    expect(click(dragged, 0.95, 0.95).lastSimplification).toEqual(counts);
  });

  it('keeps both ends of the run, so the path it joins is not broken', () => {
    const stroke = corneredStroke();
    const s = drag(emptyPathTool(), stroke);
    expect(s.points[0]).toEqual(stroke[0]);
    expect(s.points[s.points.length - 1]).toEqual(stroke[stroke.length - 1]);
  });

  it('drops samples closer together than FREEHAND_MIN_STEP', () => {
    let s = pathToolDown(emptyPathTool(), { x: 0.4, y: 0.4 }, WIDE);
    s = pathToolMove(s, { x: 0.4 + CLICK_SLOP * 2, y: 0.4 }, WIDE);
    const recorded = s.points.length;
    for (let i = 1; i <= 10; i++) {
      s = pathToolMove(s, { x: 0.4 + CLICK_SLOP * 2 + FREEHAND_MIN_STEP / 100, y: 0.4 }, WIDE);
    }
    expect(s.points).toHaveLength(recorded);
  });
});

describe('editing points', () => {
  const square = (): PathToolState => {
    let s = click(emptyPathTool(), 0.2, 0.2);
    s = click(s, 0.8, 0.2);
    s = click(s, 0.8, 0.8);
    return click(s, 0.2, 0.8);
  };

  it('an existing point is draggable', () => {
    let s = pathToolDown(square(), { x: 0.8, y: 0.2 }, WIDE);
    expect(s.press).toEqual({ kind: 'grab', index: 1 });
    s = pathToolMove(s, { x: 0.6, y: 0.3 }, WIDE);
    expect(s.points[1]).toEqual({ x: 0.6, y: 0.3 });
    s = pathToolUp(s, { x: 0.6, y: 0.3 }, WIDE);
    expect(s.press).toBeNull();
    expect(s.points).toHaveLength(4);
    // A grab appends nothing and simplifies nothing.
    expect(s.lastSimplification).toBeNull();
  });

  it('a point is deletable, and deleting one changes only the list', () => {
    const s = square();
    const after = deletePointAt(s, 1);
    expect(after.points).toEqual([s.points[0], s.points[2], s.points[3]]);
    expect(after.closed).toBe(s.closed);
    expect(after.lastSimplification).toBe(s.lastSimplification);
  });

  it('deleting at an index the list does not have is a no-op, not a throw', () => {
    const s = square();
    for (const i of [-1, 4, 1.5, NaN]) expect(deletePointAt(s, i)).toBe(s);
  });

  it('the most recent point wins an overlap', () => {
    // Built the way an overlap actually happens — a point dragged onto another,
    // or a freehand run doubling back — rather than by clicking twice in one
    // spot, which the ordering turns into a grab before any overlap exists.
    let s = click(emptyPathTool(), 0.5, 0.5);
    s = click(s, 0.8, 0.5);
    s = pathToolDown(s, { x: 0.8, y: 0.5 }, WIDE);
    s = pathToolMove(s, { x: 0.5 + POINT_HIT_RADIUS / 4, y: 0.5 }, WIDE);
    s = pathToolUp(s, { x: 0.5 + POINT_HIT_RADIUS / 4, y: 0.5 }, WIDE);
    expect(s.points).toHaveLength(2);
    expect(pointIndexAt(s, { x: 0.5, y: 0.5 }, WIDE)).toBe(1);
  });

  it('the grab radius is round on the canvas, not an ellipse', () => {
    const s = click(emptyPathTool(), 0.5, 0.5);
    // The same pixel distance in each axis: one radius across in x, and the
    // same across in y once the 16:9 canvas is accounted for.
    expect(pointIndexAt(s, { x: 0.5 + POINT_HIT_RADIUS * 0.9, y: 0.5 }, WIDE)).toBe(0);
    expect(pointIndexAt(s, { x: 0.5, y: 0.5 + POINT_HIT_RADIUS * 0.9 * WIDE }, WIDE)).toBe(0);
    expect(pointIndexAt(s, { x: 0.5, y: 0.5 + POINT_HIT_RADIUS * 1.1 * WIDE }, WIDE)).toBeNull();
  });

  it('a press ends when a point is deleted under it', () => {
    const s = pathToolDown(square(), { x: 0.8, y: 0.2 }, WIDE);
    expect(deletePointAt(s, 1).press).toBeNull();
  });
});

describe('the tool is pure, and its preview is the path it will commit', () => {
  it('no call mutates the state it was given', () => {
    const s = drag(emptyPathTool(), corneredStroke());
    const copy = JSON.parse(JSON.stringify(s)) as PathToolState;
    pathToolDown(s, { x: 0.1, y: 0.9 }, WIDE);
    pathToolMove(s, { x: 0.1, y: 0.9 }, WIDE);
    pathToolUp(s, { x: 0.1, y: 0.9 }, WIDE);
    deletePointAt(s, 0);
    previewPoints(s, { x: 0.1, y: 0.9 }, WIDE);
    pathToolPath(s, 'p');
    expect(s).toEqual(copy);
  });

  it('the preview draws the rubber band to a pointer that has not pressed yet', () => {
    const s = click(emptyPathTool(), 0.2, 0.2);
    expect(previewPoints(s, { x: 0.9, y: 0.4 }, WIDE)).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.9, y: 0.4 },
    ]);
    expect(previewPoints(s, null, WIDE)).toEqual(s.points);
  });

  it('the preview adds no band mid-press or on a closed path', () => {
    const down = pathToolDown(click(emptyPathTool(), 0.2, 0.2), { x: 0.6, y: 0.6 }, WIDE);
    expect(previewPoints(down, { x: 0.9, y: 0.9 }, WIDE)).toEqual(down.points);
    let tri = click(emptyPathTool(), 0.2, 0.2);
    tri = click(tri, 0.8, 0.2);
    tri = click(tri, 0.5, 0.8);
    const closed = pathToolDown(tri, { x: 0.2, y: 0.2 }, WIDE);
    expect(previewPoints(closed, { x: 0.9, y: 0.9 }, WIDE)).toEqual(closed.points);
  });

  it('the committed path is clamped, so a pointer outside the surface stores nothing wild', () => {
    // `toNormalizedPoint` can hand back a point outside [0,1] during a capture
    // that leaves the element; I-1 says what is stored is inside it.
    let s = click(emptyPathTool(), 0.5, 0.5);
    s = click(s, 1.4, -0.3);
    expect(pathToolPath(s, 'p').points[1]).toEqual({ x: 1, y: 0 });
  });

  it('an empty tool yields an empty path, not a broken one', () => {
    const p = pathToolPath(emptyPathTool(), 'empty');
    expect(p.points).toEqual([]);
    expect(deserializePath(serializePath(p))).toEqual(p);
  });

  it('FREEHAND_TOLERANCE is above the jitter a hand produces and below a feature', () => {
    // The constant is load-bearing for every simplification test above, so the
    // relationship it depends on is asserted rather than left in a comment.
    expect(FREEHAND_TOLERANCE).toBeGreaterThan(JITTER);
    expect(FREEHAND_MIN_STEP).toBeLessThan(JITTER);
    expect(FREEHAND_TOLERANCE).toBeLessThan(POINT_HIT_RADIUS);
  });
});

describe('more than one path', () => {
  /** Draw an open three-point path into the session's active slot. */
  const draw = (session: PathSession, x: number): PathSession => {
    let a = click(session.active, x, 0.3);
    a = click(a, x + 0.05, 0.3);
    a = click(a, x + 0.05, 0.6);
    return { ...session, active: a };
  };

  it('banks the finished path and hands back an empty one to draw into', () => {
    const one = commitActivePath(draw(emptyPathSession(), 0.1), WIDE);
    expect(one.paths).toHaveLength(1);
    expect(one.active).toEqual(emptyPathTool());

    // The point of the whole exercise: a second path, without losing the first.
    const two = commitActivePath(draw(one, 0.5), WIDE);
    expect(two.paths).toHaveLength(2);
    expect(two.paths.map((q) => q.id)).toEqual(['path-1', 'path-2']);
    expect(two.paths[0]!.points[0]).toEqual({ x: 0.1, y: 0.3 });
    expect(two.paths[1]!.points[0]).toEqual({ x: 0.5, y: 0.3 });
  });

  it('a banked path is open unless it was closed, and keeps its own flag', () => {
    let s = draw(emptyPathSession(), 0.1);
    s = commitActivePath(s, WIDE);
    let closed = draw(s, 0.5);
    closed = { ...closed, active: pathToolDown(closed.active, { x: 0.5, y: 0.3 }, WIDE) };
    const both = commitActivePath(closed, WIDE);
    expect(both.paths.map((q) => q.closed)).toEqual([false, true]);
  });

  it('banks a path a face at a time — three of them, which is a box', () => {
    let s = emptyPathSession();
    for (const x of [0.1, 0.4, 0.7]) s = commitActivePath(draw(s, x), WIDE);
    expect(s.paths).toHaveLength(3);
    expect(s.paths.map((q) => q.id)).toEqual(['path-1', 'path-2', 'path-3']);
    // Every one of them a real path as far as `core/paths.ts` is concerned.
    for (const q of s.paths) expect(deserializePath(serializePath(q))).toEqual(q);
  });

  it('an unfinishable path is not banked, and is not lost either', () => {
    const stray = { ...emptyPathSession(), active: click(emptyPathTool(), 0.4, 0.4) };
    const after = commitActivePath(stray, WIDE);
    expect(after.paths).toEqual([]);
    expect(after.active.points).toHaveLength(1);
    expect(after.active.finished).toBe(false);
  });

  it('ids fill the first free slot, so a delete and a redraw cannot collide', () => {
    let s = emptyPathSession();
    for (const x of [0.1, 0.4, 0.7]) s = commitActivePath(draw(s, x), WIDE);
    const gap = removePath(s, 'path-2');
    expect(gap.paths.map((q) => q.id)).toEqual(['path-1', 'path-3']);
    expect(nextPathId(gap.paths)).toBe('path-2');
    const refilled = commitActivePath(draw(gap, 0.2), WIDE);
    expect(refilled.paths.map((q) => q.id).sort()).toEqual(['path-1', 'path-2', 'path-3']);
  });

  it('discarding the active path leaves the banked ones alone', () => {
    const one = commitActivePath(draw(emptyPathSession(), 0.1), WIDE);
    const mid = draw(one, 0.5);
    const after = discardActivePath(mid);
    expect(after.paths).toEqual(one.paths);
    expect(after.active).toEqual(emptyPathTool());
  });

  it('removing an id nothing has is a no-op, not a throw', () => {
    const one = commitActivePath(draw(emptyPathSession(), 0.1), WIDE);
    expect(removePath(one, 'path-9')).toBe(one);
  });

  it('banking does not mutate the session it was given', () => {
    const before = draw(emptyPathSession(), 0.1);
    const copy = JSON.parse(JSON.stringify(before)) as PathSession;
    commitActivePath(before, WIDE);
    discardActivePath(before);
    removePath(before, 'path-1');
    expect(before).toEqual(copy);
  });
});

describe('picking and moving a whole path, the way a region is picked and moved', () => {
  /** A closed square face, banked. */
  const face = (session: PathSession, x: number, y: number): PathSession => {
    let a = click(session.active, x, y);
    a = click(a, x + 0.2, y);
    a = click(a, x + 0.2, y + 0.2);
    a = click(a, x, y + 0.2);
    a = pathToolDown(a, { x, y }, WIDE); // the first point closes it
    return commitActivePath({ ...session, active: a }, WIDE);
  };

  const two = (): PathSession => face(face(emptyPathSession(), 0.1, 0.1), 0.5, 0.5);

  it('a click on a banked path selects it and starts moving it in one press', () => {
    const s = pathSessionDown(two(), { x: 0.6, y: 0.6 }, WIDE);
    expect(s.selectedId).toBe('path-2');
    expect(s.move?.id).toBe('path-2');
  });

  it('a closed path is hit anywhere inside it, not only on its edge', () => {
    const s = two();
    expect(pathHitTest(s.paths, { x: 0.6, y: 0.6 }, WIDE)).toBe('path-2'); // inside
    expect(pathHitTest(s.paths, { x: 0.5, y: 0.6 }, WIDE)).toBe('path-2'); // on the edge
    expect(pathHitTest(s.paths, { x: 0.85, y: 0.6 }, WIDE)).toBeNull(); // outside
    expect(pathContains(s.paths[1]!, { x: 0.6, y: 0.6 })).toBe(true);
    expect(pathContains(s.paths[1]!, { x: 0.85, y: 0.6 })).toBe(false);
  });

  it('an open path has no inside — it is hit on its line only', () => {
    let a = click(emptyPathTool(), 0.2, 0.2);
    a = click(a, 0.8, 0.2);
    a = click(a, 0.8, 0.8);
    const s = commitActivePath({ ...emptyPathSession(), active: a }, WIDE);
    expect(pathContains(s.paths[0]!, { x: 0.6, y: 0.4 })).toBe(false);
    expect(pathHitTest(s.paths, { x: 0.6, y: 0.4 }, WIDE)).toBeNull();
    expect(pathHitTest(s.paths, { x: 0.6, y: 0.2 }, WIDE)).toBe('path-1');
  });

  it('the most recently drawn path wins an overlap', () => {
    const stacked = face(face(emptyPathSession(), 0.3, 0.3), 0.3, 0.3);
    expect(pathHitTest(stacked.paths, { x: 0.4, y: 0.4 }, WIDE)).toBe('path-2');
  });

  it('dragging moves every point by the same offset and keeps the shape', () => {
    let s = pathSessionDown(two(), { x: 0.6, y: 0.6 }, WIDE);
    const before = s.paths[1]!.points.map((q) => ({ ...q }));
    s = pathSessionMove(s, { x: 0.7, y: 0.65 }, WIDE);
    const after = s.paths[1]!.points;
    for (let i = 0; i < after.length; i++) {
      expect(after[i]!.x).toBeCloseTo(before[i]!.x + 0.1, 12);
      expect(after[i]!.y).toBeCloseTo(before[i]!.y + 0.05, 12);
    }
    // The other path did not move.
    expect(s.paths[0]!.points).toEqual(two().paths[0]!.points);
    s = pathSessionUp(s, { x: 0.7, y: 0.65 }, WIDE);
    expect(s.move).toBeNull();
    expect(s.selectedId).toBe('path-2');
  });

  it('a move is derived from the grab, so it does not accumulate or drift', () => {
    const start = two();
    let wandering = pathSessionDown(start, { x: 0.6, y: 0.6 }, WIDE);
    for (const q of [0.62, 0.7, 0.55, 0.9, 0.66]) {
      wandering = pathSessionMove(wandering, { x: q, y: 0.6 }, WIDE);
    }
    wandering = pathSessionMove(wandering, { x: 0.66, y: 0.62 }, WIDE);

    let direct = pathSessionDown(start, { x: 0.6, y: 0.6 }, WIDE);
    direct = pathSessionMove(direct, { x: 0.66, y: 0.62 }, WIDE);
    expect(wandering.paths[1]!.points).toEqual(direct.paths[1]!.points);
  });

  it('a path dragged off the frame stops whole, and is not deformed', () => {
    let s = pathSessionDown(two(), { x: 0.6, y: 0.6 }, WIDE);
    s = pathSessionMove(s, { x: 2, y: 2 }, WIDE);
    const b = pathBounds(s.paths[1]!)!;
    expect(b.maxX).toBeCloseTo(1, 12);
    expect(b.maxY).toBeCloseTo(1, 12);
    // Still a 0.2 square: the offset was clamped, not the points.
    expect(b.maxX - b.minX).toBeCloseTo(0.2, 12);
    expect(b.maxY - b.minY).toBeCloseTo(0.2, 12);
  });

  it('translatePath clamps the offset rather than each point', () => {
    const square4 = two().paths[0]!;
    const shoved = translatePath(square4, -5, 0);
    expect(pathBounds(shoved)!.minX).toBeCloseTo(0, 12);
    expect(pathBounds(shoved)!.maxX - pathBounds(shoved)!.minX).toBeCloseTo(0.2, 12);
  });

  it('a path removed mid-move ends the move instead of resurrecting itself', () => {
    let s = pathSessionDown(two(), { x: 0.6, y: 0.6 }, WIDE);
    s = removePath(s, 'path-2');
    expect(s.move).toBeNull();
    expect(s.selectedId).toBeNull();
    // And a move arriving late finds nothing rather than throwing.
    expect(pathSessionMove(s, { x: 0.7, y: 0.7 }, WIDE).paths).toHaveLength(1);
  });

  it('a path in progress owns the pointer — a click cannot select out from under it', () => {
    let s = two();
    s = { ...s, active: click(s.active, 0.9, 0.9) };
    // 0.6,0.6 is inside path-2, but a path is being drawn, so it is a point.
    const next = pathSessionDown(s, { x: 0.6, y: 0.6 }, WIDE);
    expect(next.selectedId).toBeNull();
    expect(next.active.points).toHaveLength(2);
    expect(next.active.points[1]).toEqual({ x: 0.6, y: 0.6 });
  });

  it('a click on empty space deselects and starts a new path', () => {
    let s = pathSessionDown(two(), { x: 0.6, y: 0.6 }, WIDE);
    s = pathSessionUp(s, { x: 0.6, y: 0.6 }, WIDE);
    expect(s.selectedId).toBe('path-2');
    const away = pathSessionDown(s, { x: 0.9, y: 0.2 }, WIDE);
    expect(away.selectedId).toBeNull();
    expect(away.active.points).toEqual([{ x: 0.9, y: 0.2 }]);
  });

  it('Delete removes the selected path only when nothing is being drawn', () => {
    let s = pathSessionUp(pathSessionDown(two(), { x: 0.6, y: 0.6 }, WIDE), null, WIDE);
    expect(s.selectedId).toBe('path-2');
    // A path in progress owns the key: the point goes, the selection stays.
    const drawing = { ...s, active: click(emptyPathTool(), 0.9, 0.9) };
    const afterPoint = deleteFromPathSession(drawing, null, WIDE);
    expect(afterPoint.paths).toHaveLength(2);
    expect(afterPoint.active.points).toHaveLength(0);
    // Nothing in progress: the selected path goes.
    s = deleteFromPathSession(s, null, WIDE);
    expect(s.paths.map((q) => q.id)).toEqual(['path-1']);
    expect(s.selectedId).toBeNull();
    // And with nothing selected it is a no-op rather than a surprise.
    expect(deleteFromPathSession(s, null, WIDE)).toBe(s);
  });

  it('distance is measured on the canvas, not in raw normalized units', () => {
    const s = two();
    const path = s.paths[0]!; // a square with its top edge at y = 0.1
    // The same pixel distance above the edge in each axis: 0.01 of the width,
    // and 0.01 * aspect of the height. Both must read as the same distance.
    const across = distanceToPath(path, { x: 0.05, y: 0.1 }, WIDE);
    const above = distanceToPath(path, { x: 0.2, y: 0.1 - 0.05 * WIDE }, WIDE);
    expect(across).toBeCloseTo(0.05, 12);
    expect(above).toBeCloseTo(0.05, 12);
  });

  it('banking a path does not disturb the selection or a move', () => {
    const s = pathSessionDown(two(), { x: 0.6, y: 0.6 }, WIDE);
    const banked = commitActivePath({ ...s, active: emptyPathTool() }, WIDE);
    expect(banked.selectedId).toBe('path-2');
    expect(banked.move?.id).toBe('path-2');
  });
});
