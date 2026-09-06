/**
 * The four creation modes, and the anchor a builder inserts when a quad will
 * not sit on a face.
 *
 * Three claims, and the first one is the design:
 *
 *  1. **There is no shape kind.** `generateShape` runs once and produces a plain
 *     I-17 `Path`. Nothing downstream — not `Surface`, not `surfaces.json`, not
 *     the mask — records how a face was drawn, and a face made by dragging a
 *     rect is byte-identical to the same four points drawn with the pen. That is
 *     what makes "no bounding box, no handles, no rotation" affordable rather
 *     than a restriction: there is no invariant like "this one must stay
 *     rectangular" for a transform stack to have to preserve.
 *  2. **The generator is the preview.** The outline drawn during the drag comes
 *     from the same call the release banks, so the shape a builder watches is
 *     the face they get.
 *  3. **Insert-on-segment reuses the hit test.** `bankedHitAt` is one walk, and
 *     both the gesture and the shape tool ask it — so "is the pointer over a
 *     face" cannot get two answers on one press.
 */
import { describe, expect, it } from 'vitest';
import {
  ELLIPSE_POINTS,
  MIN_SHAPE_EXTENT,
  SURFACE_MODES,
  draftBounds,
  generateShape,
  isDraftPlaceable,
  isGeneratedMode,
  type ShapeDraft,
  type SurfaceMode,
} from '../editor/shapeTool';
import {
  PATH_HIT_TOLERANCE,
  bankedHitAt,
  commitActivePath,
  emptyPathSession,
  insertPointOnSegment,
  nearestSegment,
  pathSessionDown,
  pathSessionMove,
  pathSessionUp,
  type PathSession,
} from '../editor/pathTool';
import { createPath, pathSegments, type Path } from '../core/paths';
import { reconcileSurfaces } from '../core/surfaces';
import { isMaskable } from '../render/mask';

const WIDE = 16 / 9;

function draft(mode: 'rect' | 'triangle' | 'ellipse', x0 = 0.2, y0 = 0.2, x1 = 0.6, y1 = 0.5): ShapeDraft {
  return { mode, origin: { x: x0, y: y0 }, current: { x: x1, y: y1 } };
}

describe('the generator — one drag, one Path, no stored kind', () => {
  it('rect is four closed points on the drag box', () => {
    const p = generateShape('rect', draft('rect'), 'path-1')!;
    expect(p.closed).toBe(true);
    expect(p.points).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.5 },
      { x: 0.2, y: 0.5 },
    ]);
  });

  it('triangle is three closed points, apex at the top centre', () => {
    const p = generateShape('triangle', draft('triangle'), 'path-1')!;
    expect(p.closed).toBe(true);
    expect(p.points).toEqual([
      { x: 0.4, y: 0.2 },
      { x: 0.6, y: 0.5 },
      { x: 0.2, y: 0.5 },
    ]);
  });

  it('ellipse is 32 closed points on the inscribed ellipse', () => {
    // The literal, not the constant. Asserting `toHaveLength(ELLIPSE_POINTS)`
    // alone is a test that cannot fail — halving the constant kept it green,
    // which is exactly the mutation check catching a check that checks nothing.
    // 32 is the specified number and a measured sufficiency (see `shapeTool.ts`),
    // so it is pinned here rather than merely referenced.
    expect(ELLIPSE_POINTS).toBe(32);
    const p = generateShape('ellipse', draft('ellipse'), 'path-1')!;
    expect(p.closed).toBe(true);
    expect(p.points).toHaveLength(32);
    const cx = 0.4;
    const cy = 0.35;
    const rx = 0.2;
    const ry = 0.15;
    for (const q of p.points) {
      // Every point is ON the ellipse: (dx/rx)^2 + (dy/ry)^2 == 1.
      const v = ((q.x - cx) / rx) ** 2 + ((q.y - cy) / ry) ** 2;
      expect(v).toBeCloseTo(1, 10);
    }
    // Starts at the top and goes clockwise on a y-down canvas, like the other two.
    expect(p.points[0]!.x).toBeCloseTo(cx, 10);
    expect(p.points[0]!.y).toBeCloseTo(cy - ry, 10);
    expect(p.points[ELLIPSE_POINTS / 4]!.x).toBeCloseTo(cx + rx, 10);
  });

  it('the drag is order-independent — dragging up-left makes the same face', () => {
    const downRight = generateShape('rect', draft('rect', 0.2, 0.2, 0.6, 0.5), 'p')!;
    const upLeft = generateShape('rect', draft('rect', 0.6, 0.5, 0.2, 0.2), 'p')!;
    expect(upLeft.points).toEqual(downRight.points);
  });

  it('pen generates nothing — it is the existing tool, not a shape', () => {
    expect(generateShape('pen', draft('rect'), 'p')).toBeNull();
    expect(isGeneratedMode('pen')).toBe(false);
    for (const m of SURFACE_MODES.filter((x) => x !== 'pen')) {
      expect(isGeneratedMode(m)).toBe(true);
    }
  });

  it('a drag too small to be meant makes nothing, rather than a face one pixel across', () => {
    const tiny = draft('rect', 0.5, 0.5, 0.5 + MIN_SHAPE_EXTENT / 2, 0.5 + MIN_SHAPE_EXTENT / 2);
    expect(isDraftPlaceable(tiny)).toBe(false);
    expect(generateShape('rect', tiny, 'p')).toBeNull();
    // Refused, not clamped up to a minimum: silently inventing a face nobody
    // drew is one they then have to find in the list and delete.
    const justBig = draft('rect', 0.5, 0.5, 0.5 + MIN_SHAPE_EXTENT, 0.5 + MIN_SHAPE_EXTENT);
    expect(generateShape('rect', justBig, 'p')).not.toBeNull();
  });

  it('a thin drag is refused on the SHORT axis, not on area', () => {
    // A face 0.9 wide and 3 thousandths tall has plenty of "area" and is not a
    // face. Both extents have to clear the threshold.
    const sliver = draft('rect', 0.05, 0.5, 0.95, 0.503);
    expect(isDraftPlaceable(sliver)).toBe(false);
  });

  it('every generated face is maskable, so it can be filled the moment it is banked', () => {
    for (const m of ['rect', 'triangle', 'ellipse'] as const) {
      expect(isMaskable(generateShape(m, draft(m), 'p')!), m).toBe(true);
    }
  });

  it('THE DESIGN: nothing records how a face was made', () => {
    const generated = generateShape('rect', draft('rect'), 'path-1')!;
    // The same four points, drawn by hand instead.
    const byHand = createPath({
      id: 'path-1',
      closed: true,
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.6, y: 0.2 },
        { x: 0.6, y: 0.5 },
        { x: 0.2, y: 0.5 },
      ],
    });
    expect(generated).toEqual(byHand);
    // And once banked, the surfaces are indistinguishable too — no `kind`
    // anywhere, so nothing can branch on it later.
    const a = reconcileSurfaces([], [generated]);
    const b = reconcileSurfaces([], [byHand]);
    expect(a).toEqual(b);
    expect(Object.keys(a[0]!).sort()).toEqual(['id', 'name', 'path', 'role']);
  });

  it('draftBounds is order-independent and is what placeability reads', () => {
    expect(draftBounds(draft('rect', 0.6, 0.5, 0.2, 0.2))).toEqual({
      minX: 0.2,
      minY: 0.2,
      maxX: 0.6,
      maxY: 0.5,
    });
  });
});

// ---------------------------------------------------------------------------
// Insert an anchor on a segment.
// ---------------------------------------------------------------------------

function quad(id = 'path-1'): Path {
  return createPath({
    id,
    closed: true,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.6 },
      { x: 0.2, y: 0.6 },
    ],
  });
}

describe('nearestSegment — which edge, out of the walk distanceToPath already did', () => {
  it('names the segment under the pointer', () => {
    // Just below the top edge, which is segment 0.
    expect(nearestSegment(quad(), { x: 0.4, y: 0.205 }, WIDE)?.index).toBe(0);
    // Just inside the right edge, segment 1.
    expect(nearestSegment(quad(), { x: 0.595, y: 0.4 }, WIDE)?.index).toBe(1);
  });

  it('finds the CLOSING segment of a closed path, which is the last one', () => {
    // The left edge runs from the last point back to the first.
    const seg = nearestSegment(quad(), { x: 0.205, y: 0.4 }, WIDE);
    expect(seg?.index).toBe(3);
    expect(pathSegments(quad())).toHaveLength(4);
  });

  it('an open path has one fewer segment and no closing one', () => {
    const open = createPath({
      id: 'p',
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.6, y: 0.2 },
        { x: 0.6, y: 0.6 },
      ],
    });
    expect(pathSegments(open)).toHaveLength(2);
    expect(nearestSegment(open, { x: 0.4, y: 0.4 }, WIDE)?.index).toBeLessThan(2);
  });

  it('a path with no segments has no nearest one', () => {
    expect(nearestSegment(createPath({ id: 'p' }), { x: 0.5, y: 0.5 }, WIDE)).toBeNull();
  });
});

describe('insertPointOnSegment — Photoshop Add Anchor Point, for a box that is not a quad', () => {
  it('splits the segment and puts the point between the two it was drawn between', () => {
    const grown = insertPointOnSegment(quad(), 0, { x: 0.4, y: 0.2 });
    expect(grown.points).toHaveLength(5);
    expect(grown.points[1]).toEqual({ x: 0.4, y: 0.2 });
    // Winding unchanged: the three originals are still in order around it.
    expect(grown.points[0]).toEqual({ x: 0.2, y: 0.2 });
    expect(grown.points[2]).toEqual({ x: 0.6, y: 0.2 });
  });

  it('appends when the segment is the closing one, which is the correct answer', () => {
    const grown = insertPointOnSegment(quad(), 3, { x: 0.2, y: 0.4 });
    expect(grown.points).toHaveLength(5);
    expect(grown.points[4]).toEqual({ x: 0.2, y: 0.4 });
  });

  it('leaves `closed` alone and refuses no index', () => {
    expect(insertPointOnSegment(quad(), 0, { x: 0.4, y: 0.2 }).closed).toBe(true);
    const q = quad();
    expect(insertPointOnSegment(q, 99, { x: 0.4, y: 0.2 })).toBe(q);
    expect(insertPointOnSegment(q, -1, { x: 0.4, y: 0.2 })).toBe(q);
  });
});

describe('bankedHitAt — one hit test, asked in the only order geometry allows', () => {
  function selectedQuad(): PathSession {
    const s: PathSession = { ...emptyPathSession(), paths: [quad()], selectedId: 'path-1' };
    return s;
  }

  it('a point wins over the edge it sits on, and the edge over the face it bounds', () => {
    const s = selectedQuad();
    expect(bankedHitAt(s, { x: 0.2, y: 0.2 }, WIDE)).toEqual({
      kind: 'point',
      id: 'path-1',
      index: 0,
    });
    expect(bankedHitAt(s, { x: 0.4, y: 0.2 }, WIDE)).toEqual({
      kind: 'segment',
      id: 'path-1',
      index: 0,
    });
    expect(bankedHitAt(s, { x: 0.4, y: 0.4 }, WIDE)).toEqual({ kind: 'face', id: 'path-1' });
  });

  it('offers points and edges on the SELECTED face only', () => {
    const s: PathSession = { ...selectedQuad(), selectedId: null };
    // Same press, nothing selected: it is the face, not one of its corners.
    expect(bankedHitAt(s, { x: 0.2, y: 0.2 }, WIDE)).toEqual({ kind: 'face', id: 'path-1' });
  });

  it('empty space hits nothing, which is what lets a shape drag start there', () => {
    expect(bankedHitAt(selectedQuad(), { x: 0.95, y: 0.95 }, WIDE)).toBeNull();
  });

  it('the tolerance it uses for an edge is the one the tool publishes', () => {
    const s = selectedQuad();
    const inside = bankedHitAt(s, { x: 0.4, y: 0.2 + PATH_HIT_TOLERANCE / 2 }, WIDE);
    expect(inside?.kind).toBe('segment');
  });
});

describe('the insert gesture, end to end', () => {
  function selected(): PathSession {
    let s: PathSession = { ...emptyPathSession(), paths: [quad()], selectedId: 'path-1' };
    s = pathSessionUp(s, null, WIDE);
    return s;
  }

  it('clicking an edge inserts a point there AND grabs it, in one press', () => {
    const s = pathSessionDown(selected(), { x: 0.4, y: 0.2 }, WIDE);
    expect(s.paths[0]!.points).toHaveLength(5);
    expect(s.paths[0]!.points[1]).toEqual({ x: 0.4, y: 0.2 });
    // Grabbed but not live — the press still has to travel (DRAG_SLOP), so a
    // click that drifts a pixel does not drag the point it just made.
    expect(s.grabPoint).toEqual({
      id: 'path-1',
      index: 1,
      origin: { x: 0.4, y: 0.2 },
      live: false,
    });
  });

  it('and the new point can be dragged straight into place', () => {
    let s = pathSessionDown(selected(), { x: 0.4, y: 0.2 }, WIDE);
    s = pathSessionMove(s, { x: 0.42, y: 0.32 }, WIDE);
    expect(s.paths[0]!.points[1]).toEqual({ x: 0.42, y: 0.32 });
    expect(s.paths[0]!.points).toHaveLength(5);
  });

  it('the inserted point survives the funnel as an ordinary point', () => {
    const before = reconcileSurfaces([], [quad()]);
    const s = pathSessionDown(
      { ...emptyPathSession(), paths: [before[0]!.path], selectedId: 'path-1' },
      { x: 0.4, y: 0.2 },
      WIDE,
    );
    const after = reconcileSurfaces(before, s.paths);
    // Same face — same id, same role, same name. It grew a corner, it did not
    // become a different surface.
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[0]!.role).toBe(before[0]!.role);
    expect(after[0]!.path.points).toHaveLength(5);
  });

  it('clicking INSIDE the face still moves it rather than inserting', () => {
    const s = pathSessionDown(selected(), { x: 0.4, y: 0.4 }, WIDE);
    expect(s.paths[0]!.points).toHaveLength(4);
    expect(s.move?.id).toBe('path-1');
  });
});

describe('after creation, every face behaves identically', () => {
  /** Bank one face by each route, then run the same three edits on both. */
  function bankGenerated(): PathSession {
    const path = generateShape('rect', draft('rect'), 'path-1')!;
    return { ...emptyPathSession(), paths: [path], selectedId: 'path-1' };
  }

  function bankByPen(): PathSession {
    let s = emptyPathSession();
    for (const p of [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.5 },
      { x: 0.2, y: 0.5 },
    ]) {
      s = pathSessionUp(pathSessionDown(s, p, WIDE), p, WIDE);
    }
    s = commitActivePath(s, WIDE);
    return { ...s, selectedId: s.paths[0]!.id };
  }

  it('a dragged rect and a pen-drawn one take the same edits to the same result', () => {
    for (const start of [bankGenerated(), bankByPen()]) {
      // Insert on the top edge...
      let s = pathSessionDown(start, { x: 0.4, y: 0.2 }, WIDE);
      s = pathSessionMove(s, { x: 0.4, y: 0.1 }, WIDE);
      s = pathSessionUp(s, { x: 0.4, y: 0.1 }, WIDE);
      expect(s.paths[0]!.points).toHaveLength(5);
      expect(s.paths[0]!.points[1]).toEqual({ x: 0.4, y: 0.1 });
    }
  });

  it('a dragged ellipse is 32 ordinary points a builder can trim one at a time', () => {
    const path = generateShape('ellipse', draft('ellipse'), 'path-1')!;
    const s: PathSession = { ...emptyPathSession(), paths: [path], selectedId: 'path-1' };
    // Grab the top point, which is point 0, and move it.
    const grabbed = pathSessionDown(s, path.points[0]!, WIDE);
    expect(grabbed.grabPoint?.index).toBe(0);
    const moved = pathSessionMove(grabbed, { x: 0.45, y: 0.1 }, WIDE);
    expect(moved.paths[0]!.points[0]).toEqual({ x: 0.45, y: 0.1 });
    expect(moved.paths[0]!.points).toHaveLength(ELLIPSE_POINTS);
  });
});

describe('the mode list', () => {
  it('is exactly the four the block names, pen last', () => {
    expect(SURFACE_MODES).toEqual(['rect', 'triangle', 'ellipse', 'pen']);
  });

  it('every generated mode produces a closed path — a face is an area', () => {
    for (const m of SURFACE_MODES) {
      const p = generateShape(m as SurfaceMode, draft('rect'), 'p');
      if (p) expect(p.closed, m).toBe(true);
    }
  });
});
