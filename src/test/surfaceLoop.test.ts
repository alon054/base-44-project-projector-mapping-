/**
 * B3 — the wall loop: mark, light, drag, adjust.
 *
 * Four claims, and they fail in different ways, so they are tested apart:
 *
 *  1. **One funnel.** Every gesture the path tool can produce — bank, point
 *     drag, point delete, whole-face move, delete — becomes a room through one
 *     function, `reconcileSurfaces`, which keeps a face's role and name across
 *     every geometric edit. Pure arithmetic over pure data.
 *  2. **The gestures reach it.** Closing a path banks it, a banked face's
 *     points are still draggable, and Delete trims a corner rather than losing
 *     the face. `pathTool.ts`'s session, no DOM.
 *  3. **The wall can answer while a finger is down.** A point drag reshapes the
 *     masks the compositor already has and creates NO provider view; a face
 *     added, removed or re-roled rebuilds. This is the one that decides whether
 *     the loop is usable at a projector, and it is checked on a real
 *     `Compositor` with a recording provider — the same harness B2 built.
 *  4. **A field can be cleared.** A `fillRole` emptied through the registry
 *     leaves a layer deep-equal to one that never had the key.
 *
 * What is NOT here: whether any of it looks right on a box. That is the wall,
 * and this file cannot speak to it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { Container, Graphics } from 'pixi.js';
import { Compositor, surfacesShapeKey } from '../render/compositor';
import { MASK_MIN_POINTS, pathPixelBounds } from '../render/mask';
import { createPath, type Path } from '../core/paths';
import {
  DEFAULT_SURFACE_ROLE,
  canonicalizeSurface,
  createSurface,
  reconcileSurfaces,
  type SurfaceTree,
} from '../core/surfaces';
import { resetRoleLog } from '../core/roles';
import { readSurfaces, writeSurfaces } from '../render/calibration';
import {
  calibrationFilePath,
  loadSurfacesRaw,
  saveSurfacesRaw,
  surfacesFilePath,
} from '@shared/calibration';
import { applyLayerPatch, createLayer, type Layer } from '../core/layer';
import { createScene } from '../core/scene';
import { addWhiteFill } from '../core/sceneEdit';
import { ParameterRegistry, defineLayerParameters } from '../core/parameters';
import { EMPTY_FORCE_FIELD } from '../core/forces';
import {
  ProviderRegistry,
  type ContentProvider,
  type LayerFrame,
  type LayerView,
  type ProviderContext,
} from '../providers/ContentProvider';
import {
  commitActivePath,
  deleteFromPathSession,
  emptyPathSession,
  pathSessionDown,
  pathSessionMove,
  pathSessionUp,
  pointIndexAt,
  pointIndexOnPath,
  withPathPoint,
  withoutPathPoint,
  type PathSession,
} from '../editor/pathTool';

const W = 1280;
const H = 720;
/** 16:9, the aspect every session call below measures distances in. */
const WIDE = 16 / 9;

const FRAME: LayerFrame = {
  timeSeconds: 1,
  phase: 0.25,
  playing: false,
  rate: 1,
  scrubSeq: 0,
  forces: EMPTY_FORCE_FIELD,
};

function quad(id: string, x = 0.1, y = 0.2): Path {
  return createPath({
    id,
    closed: true,
    points: [
      { x, y },
      { x: x + 0.3, y },
      { x: x + 0.3, y: y + 0.3 },
      { x, y: y + 0.3 },
    ],
  });
}

function room(...paths: Path[]): SurfaceTree {
  return paths.map((p, i) =>
    createSurface({ id: `surface-${i + 1}`, name: `face ${i + 1}`, path: p }),
  );
}

// ---------------------------------------------------------------------------
// 1. The funnel.
// ---------------------------------------------------------------------------

describe('reconcileSurfaces — every gesture becomes a room through one function', () => {
  it('a path the room has never seen is banked, with the default role and name', () => {
    const next = reconcileSurfaces([], [quad('path-1')]);
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe('surface-1');
    expect(next[0]!.name).toBe('face 1');
    expect(next[0]!.role).toBe(DEFAULT_SURFACE_ROLE);
    expect(next[0]!.role).toBe('panel');
  });

  it('a moved path keeps the face it belongs to — role and name survive a drag', () => {
    const marked = reconcileSurfaces([], [quad('path-1')]);
    const tagged: SurfaceTree = [{ ...marked[0]!, role: 'box-left', name: 'the left one' }];
    // The same path id, different geometry: this is what a point drag produces.
    const dragged = reconcileSurfaces(tagged, [quad('path-1', 0.15, 0.25)]);
    expect(dragged[0]!.role).toBe('box-left');
    expect(dragged[0]!.name).toBe('the left one');
    expect(dragged[0]!.id).toBe('surface-1');
    expect(dragged[0]!.path.points[0]).toEqual({ x: 0.15, y: 0.25 });
  });

  it('a path that is gone deletes its face, and only its face', () => {
    const three = reconcileSurfaces([], [quad('path-1'), quad('path-2'), quad('path-3')]);
    const two = reconcileSurfaces(three, [quad('path-1'), quad('path-3')]);
    expect(two.map((s) => s.id)).toEqual(['surface-1', 'surface-3']);
  });

  it('order follows the paths, because marking order is the order faces light', () => {
    const marked = reconcileSurfaces([], [quad('path-1'), quad('path-2')]);
    expect(marked.map((s) => s.name)).toEqual(['face 1', 'face 2']);
  });

  it('deleting the MIDDLE of three and marking again does not reuse the dead id', () => {
    // B1's `nextSurfaceId` rule, reached through the funnel: the next id comes
    // from the highest suffix still in use, not from the length. Delete the
    // second of three and mark a fourth, and it must not inherit `surface-2` —
    // a run log naming that id would then mean two different faces.
    //
    // Note what this deliberately does NOT claim: deleting the LAST face does
    // free its suffix, because nothing higher is left to count from. That is
    // B1's shipped behaviour and its comment says so; the id is still unique
    // in the room at every moment, which is what the room needs it to be.
    const three = reconcileSurfaces([], [quad('path-1'), quad('path-2'), quad('path-3')]);
    const gapped = reconcileSurfaces(three, [quad('path-1'), quad('path-3')]);
    const refilled = reconcileSurfaces(gapped, [quad('path-1'), quad('path-3'), quad('path-9')]);
    expect(refilled.map((s) => s.id)).toEqual(['surface-1', 'surface-3', 'surface-4']);
  });

  it('two faces marked in ONE reconciliation do not collide', () => {
    const both = reconcileSurfaces([], [quad('path-1'), quad('path-2')]);
    expect(new Set(both.map((s) => s.id)).size).toBe(2);
  });

  it('returns the SAME tree when nothing moved — the identity the write depends on', () => {
    // Not an optimisation. `applySession` writes `surfaces.json` and crosses to
    // the output window whenever this returns something new, so a still pointer
    // producing a fresh array would be a file write and an IPC message per
    // frame for a hand that is not moving.
    const marked = reconcileSurfaces([], [quad('path-1')]);
    const same = reconcileSurfaces(marked, [marked[0]!.path]);
    expect(same).toBe(marked);
  });

  it('the room round-trips through the file envelope unchanged', () => {
    const marked = reconcileSurfaces([], [quad('path-1'), quad('path-2', 0.5, 0.5)]);
    const tagged = marked.map((s, i) => (i === 0 ? { ...s, role: 'box-left' } : s));
    // `writeSurfaces` is what crosses IPC and what lands on disk — one shape,
    // so the wire and the file cannot drift.
    const back = readSurfaces(
      JSON.parse(JSON.stringify(writeSurfaces(tagged))) as unknown,
      canonicalizeSurface,
    );
    expect(back).toEqual(tagged);
  });
});

// ---------------------------------------------------------------------------
// 2. The gestures.
// ---------------------------------------------------------------------------

/** Three clicks: a path with three points, ready to be closed on the first. */
function triangleInProgress(): PathSession {
  let s = emptyPathSession();
  for (const p of [
    { x: 0.2, y: 0.2 },
    { x: 0.6, y: 0.2 },
    { x: 0.6, y: 0.6 },
  ]) {
    s = pathSessionUp(pathSessionDown(s, p, WIDE), p, WIDE);
  }
  return s;
}

describe('B3 — finishing a path banks it, by either gesture', () => {
  it('clicking the first point closes AND banks it', () => {
    const drawn = triangleInProgress();
    expect(drawn.paths).toHaveLength(0);
    const banked = pathSessionDown(drawn, { x: 0.2, y: 0.2 }, WIDE);
    expect(banked.paths).toHaveLength(1);
    expect(banked.paths[0]!.closed).toBe(true);
    // And the tool is ready for the next face rather than still holding the
    // one just finished — the affordance nobody finds twice.
    expect(banked.active.points).toHaveLength(0);
  });

  it('Enter still banks an OPEN path, and the two gestures agree on the points', () => {
    const drawn = triangleInProgress();
    const byEnter = commitActivePath(drawn, WIDE);
    const byClose = pathSessionDown(drawn, { x: 0.2, y: 0.2 }, WIDE);
    expect(byEnter.paths).toHaveLength(1);
    expect(byEnter.paths[0]!.closed).toBe(false);
    // Same three points either way. Closing adds no segment and Enter joins
    // nothing — the only difference is the flag.
    expect(byEnter.paths[0]!.points).toEqual(byClose.paths[0]!.points);
  });

  it('a banked closed path takes no further points — the click that closed it was terminal', () => {
    const banked = pathSessionDown(triangleInProgress(), { x: 0.2, y: 0.2 }, WIDE);
    // A click in open space starts the NEXT face rather than appending a
    // seventh point to the square that was just finished.
    const after = pathSessionDown(banked, { x: 0.9, y: 0.9 }, WIDE);
    expect(after.paths[0]!.points).toHaveLength(3);
    expect(after.active.points).toHaveLength(1);
  });
});

describe('B3 — a banked face is still editable, point by point', () => {
  /** One banked, closed face, selected. */
  function selectedFace(): PathSession {
    const banked = pathSessionDown(triangleInProgress(), { x: 0.2, y: 0.2 }, WIDE);
    // A press inside the face selects it (P5-B's one-press rule).
    return pathSessionUp(pathSessionDown(banked, { x: 0.45, y: 0.35 }, WIDE), null, WIDE);
  }

  it('a press ON a point of the selected face grabs THAT point, not the face', () => {
    const s = pathSessionDown(selectedFace(), { x: 0.2, y: 0.2 }, WIDE);
    expect(s.grabPoint).toEqual({ id: 'path-1', index: 0 });
    expect(s.move).toBeNull();
  });

  it('dragging it moves that point and leaves the others exactly where they were', () => {
    const grabbed = pathSessionDown(selectedFace(), { x: 0.2, y: 0.2 }, WIDE);
    const before = grabbed.paths[0]!.points;
    const moved = pathSessionMove(grabbed, { x: 0.3, y: 0.25 }, WIDE);
    const after = moved.paths[0]!.points;
    expect(after[0]).toEqual({ x: 0.3, y: 0.25 });
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it('a press on the face AWAY from every point still moves the whole face', () => {
    const s = pathSessionDown(selectedFace(), { x: 0.45, y: 0.35 }, WIDE);
    expect(s.grabPoint).toBeNull();
    expect(s.move?.id).toBe('path-1');
  });

  it('points on an UNSELECTED face are not grabbable — the handles are not drawn there', () => {
    const banked = pathSessionDown(triangleInProgress(), { x: 0.2, y: 0.2 }, WIDE);
    expect(banked.selectedId).toBeNull();
    const s = pathSessionDown(banked, { x: 0.2, y: 0.2 }, WIDE);
    // Selects and moves, one press — and the next press reaches the point.
    expect(s.grabPoint).toBeNull();
    expect(s.selectedId).toBe('path-1');
  });

  it('a pointer that has not moved returns the SAME session, so the room is not rewritten', () => {
    const grabbed = pathSessionDown(selectedFace(), { x: 0.2, y: 0.2 }, WIDE);
    expect(pathSessionMove(grabbed, { x: 0.2, y: 0.2 }, WIDE)).toBe(grabbed);
  });

  it('a face deleted mid-drag ends the drag instead of resurrecting the point', () => {
    const grabbed = pathSessionDown(selectedFace(), { x: 0.2, y: 0.2 }, WIDE);
    const gone: PathSession = { ...grabbed, paths: [] };
    const after = pathSessionMove(gone, { x: 0.3, y: 0.3 }, WIDE);
    expect(after.grabPoint).toBeNull();
    expect(after.paths).toEqual([]);
  });

  it('pointer-up ends the point drag and not the face move', () => {
    const grabbed = pathSessionDown(selectedFace(), { x: 0.2, y: 0.2 }, WIDE);
    const up = pathSessionUp(grabbed, { x: 0.3, y: 0.3 }, WIDE);
    expect(up.grabPoint).toBeNull();
    expect(up.paths[0]!.points).toHaveLength(3);
  });

  it('Delete over a point trims that corner; Delete elsewhere removes the face', () => {
    const face = selectedFace();
    const trimmed = deleteFromPathSession(face, { x: 0.2, y: 0.2 }, WIDE);
    expect(trimmed.paths).toHaveLength(1);
    expect(trimmed.paths[0]!.points).toHaveLength(2);
    // Away from every point, P5-D's behaviour is unchanged.
    const removed = deleteFromPathSession(face, { x: 0.45, y: 0.35 }, WIDE);
    expect(removed.paths).toHaveLength(0);
  });

  it('trimming a face below three points is allowed and flagged, never refused', () => {
    // The operator is deleting points on purpose and can see the result. The
    // compositor skips an unmaskable face (B2) and its siblings still light.
    let s = selectedFace();
    s = deleteFromPathSession(s, { x: 0.2, y: 0.2 }, WIDE);
    expect(s.paths[0]!.points).toHaveLength(2);
    expect(s.paths[0]!.points.length).toBeLessThan(MASK_MIN_POINTS);
  });
});

describe('the path-level point helpers', () => {
  it('withPathPoint returns the SAME path when the point did not move', () => {
    const p = quad('path-1');
    expect(withPathPoint(p, 0, { x: 0.1, y: 0.2 })).toBe(p);
    expect(withPathPoint(p, 0, { x: 0.11, y: 0.2 })).not.toBe(p);
  });

  it('withoutPathPoint leaves `closed` alone and refuses no index', () => {
    const p = quad('path-1');
    expect(withoutPathPoint(p, 1).points).toHaveLength(3);
    expect(withoutPathPoint(p, 1).closed).toBe(true);
    // Out of range is drift, not corruption: unchanged, not a throw.
    expect(withoutPathPoint(p, 99)).toBe(p);
    expect(withoutPathPoint(p, -1)).toBe(p);
  });

  it('pointIndexOnPath and pointIndexAt answer the same question of the same points', () => {
    const p = quad('path-1');
    // One body, two callers: the handle the operator is looking at must not
    // move when the path is banked, and it cannot, because the hit test is the
    // same loop with the same radius over the same points.
    const asTool = { points: p.points.slice(), closed: true, finished: false, press: null, lastSimplification: null };
    for (const probe of [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }, { x: 0.9, y: 0.9 }]) {
      expect(pointIndexOnPath(p, probe, WIDE)).toBe(pointIndexAt(asTool, probe, WIDE));
    }
    expect(pointIndexOnPath(p, { x: 0.1, y: 0.2 }, WIDE)).toBe(0);
    expect(pointIndexOnPath(p, { x: 0.9, y: 0.9 }, WIDE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. The wall answering live.
// ---------------------------------------------------------------------------

class RecordingProvider implements ContentProvider {
  readonly id = 'recording';
  creates = 0;
  readonly resizes: [number, number][] = [];

  create(ctx: ProviderContext): LayerView {
    this.creates++;
    const view = new Container();
    view.addChild(new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: 0x808080 }));
    return {
      view,
      update: () => {},
      resize: (w, h) => {
        this.resizes.push([w, h]);
      },
      destroy: () => {},
    };
  }
}

function fillScene(role = 'panel') {
  return createScene({
    id: 'fill',
    layers: [
      createLayer({ id: 'fill-1', providerId: 'recording', content: {}, fillRole: role }),
    ],
  });
}

function compositorFor(surfaces: SurfaceTree, provider: ContentProvider): Compositor {
  const providers = new ProviderRegistry();
  providers.register(provider);
  return new Compositor({ providers, width: W, height: H, surfaces });
}

/** The pixel points a mask actually recorded, straight out of its context. */
function maskPointsOf(g: Graphics): number[] {
  const fill = g.context.instructions[0] as
    | { data: { path?: { instructions: { data: unknown[] }[] } } }
    | undefined;
  return ((fill?.data.path?.instructions[0]?.data[0] as number[]) ?? []).slice();
}

/**
 * Every live fill mask, found by walking the display list for containers that
 * HAVE one.
 *
 * Read off the arrangement rather than out of a private field on purpose: the
 * claim being tested is that each face's content sits inside a masked
 * container, and a test that reached into `compositor.mounts` would keep
 * passing if that arrangement were replaced by something that merely recorded
 * the same numbers.
 */
function masksOf(c: Compositor): Graphics[] {
  const out: Graphics[] = [];
  const walk = (node: Container): void => {
    if (node.mask instanceof Graphics) out.push(node.mask);
    for (const child of node.children) walk(child as Container);
  };
  walk(c.view);
  return out;
}

describe('B3 — a point drag reshapes the masks it has and rebuilds nothing', () => {
  it('THE CLAIM: dragging a point creates no provider view', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const c = compositorFor(room(quad('path-1'), quad('path-2', 0.5, 0.5)), provider);
    c.setScene(fillScene());
    c.update(FRAME);
    // Two faces carry `panel`, so one layer became two instances.
    expect(provider.creates).toBe(2);

    const dragged = reconcileSurfaces(
      room(quad('path-1'), quad('path-2', 0.5, 0.5)),
      [quad('path-1', 0.12, 0.22), quad('path-2', 0.5, 0.5)],
    );
    c.setSurfaces(dragged);
    // The whole point of the block. A rebuild here is a decoder torn down and
    // re-created per pointer sample once the scene has a video layer in it.
    expect(provider.creates).toBe(2);
    c.destroy();
  });

  it('...and the mask actually moved, so "no rebuild" is not "no effect"', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const start = room(quad('path-1'));
    const c = compositorFor(start, provider);
    c.setScene(fillScene());
    c.update(FRAME);
    const before = maskPointsOf(masksOf(c)[0]!);

    const dragged = reconcileSurfaces(start, [quad('path-1', 0.3, 0.4)]);
    c.setSurfaces(dragged);
    const after = maskPointsOf(masksOf(c)[0]!);

    expect(after).not.toEqual(before);
    // I-1: rebuilt from the normalized path, not translated. The first point
    // is exactly the new normalized point times the output size.
    expect(after.slice(0, 2)).toEqual([0.3 * W, 0.4 * H]);
    c.destroy();
  });

  it('the provider is re-sized to the FACE\'s new box, not the layer\'s', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const start = room(quad('path-1'));
    const c = compositorFor(start, provider);
    c.setScene(fillScene());
    c.update(FRAME);
    provider.resizes.length = 0;

    const moved = quad('path-1', 0.3, 0.4);
    c.setSurfaces(reconcileSurfaces(start, [moved]));
    const box = pathPixelBounds(moved, W, H);
    expect(provider.resizes.at(-1)).toEqual([
      Math.max(1, Math.round(box.width)),
      Math.max(1, Math.round(box.height)),
    ]);
    c.destroy();
  });

  it('only the face that moved is reshaped — four faces, one drag', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const paths = [quad('path-1'), quad('path-2', 0.5, 0.1), quad('path-3', 0.1, 0.6)];
    const start = room(...paths);
    const c = compositorFor(start, provider);
    c.setScene(fillScene());
    c.update(FRAME);
    provider.resizes.length = 0;

    c.setSurfaces(reconcileSurfaces(start, [quad('path-1', 0.15, 0.25), paths[1]!, paths[2]!]));
    // One reshape, not three: `reconcileSurfaces` hands back the same object
    // for a face nothing touched and `setSurfaces` compares by identity.
    expect(provider.resizes).toHaveLength(1);
    c.destroy();
  });

  it('marking a NEW face rebuilds, and the new face lights itself — beat 7', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const start = room(quad('path-1'));
    const c = compositorFor(start, provider);
    c.setScene(fillScene());
    c.update(FRAME);
    expect(provider.creates).toBe(1);

    c.setSurfaces(reconcileSurfaces(start, [quad('path-1'), quad('path-2', 0.5, 0.5)]));
    // Two instances now exist, so a rebuild is the honest answer: no amount of
    // mask redrawing creates a provider view that was not there.
    expect(masksOf(c)).toHaveLength(2);
    expect(provider.creates).toBe(3);
    c.destroy();
  });

  it('deleting a face puts its light out and leaves the others alone', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const start = room(quad('path-1'), quad('path-2', 0.5, 0.5));
    const c = compositorFor(start, provider);
    c.setScene(fillScene());
    c.update(FRAME);
    expect(masksOf(c)).toHaveLength(2);

    c.setSurfaces(reconcileSurfaces(start, [quad('path-1')]));
    expect(masksOf(c)).toHaveLength(1);
    c.destroy();
  });

  it('re-tagging a face rebuilds — a role change moves it between layers', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const start = room(quad('path-1'));
    const c = compositorFor(start, provider);
    c.setScene(fillScene('panel'));
    c.update(FRAME);
    expect(provider.creates).toBe(1);

    c.setSurfaces([{ ...start[0]!, role: 'box-left' }]);
    // Nothing fills `box-left`, so the layer now lands nowhere — I-13's flag,
    // and it cannot be reached by moving a mask.
    expect(masksOf(c)).toHaveLength(0);
    expect(c.roleMisses()).toHaveLength(1);
    c.destroy();
  });

  it('a face trimmed below three points loses its mask rather than keeping a stale one', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const start = room(quad('path-1'));
    const c = compositorFor(start, provider);
    c.setScene(fillScene());
    c.update(FRAME);
    expect(masksOf(c)).toHaveLength(1);

    const trimmed = createPath({
      id: 'path-1',
      closed: true,
      points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.2 }],
    });
    c.setSurfaces(reconcileSurfaces(start, [trimmed]));
    // Maskability is in the shape key precisely so this is a rebuild. Without
    // it the face would still be wearing the triangle's mask.
    expect(masksOf(c)).toHaveLength(0);
    c.destroy();
  });
});

describe('surfacesShapeKey — what counts as a shape change', () => {
  const one = room(quad('path-1'));

  it('geometry alone is NOT a shape change — that is the reshape path', () => {
    const moved = reconcileSurfaces(one, [quad('path-1', 0.4, 0.4)]);
    expect(surfacesShapeKey(moved)).toBe(surfacesShapeKey(one));
  });

  it('a role, an id, an order, a count and maskability all are', () => {
    expect(surfacesShapeKey([{ ...one[0]!, role: 'other' }])).not.toBe(surfacesShapeKey(one));
    expect(surfacesShapeKey([{ ...one[0]!, id: 'surface-9' }])).not.toBe(surfacesShapeKey(one));
    expect(surfacesShapeKey(room(quad('path-1'), quad('path-2')))).not.toBe(surfacesShapeKey(one));
    const two = room(quad('path-1'), quad('path-2'));
    expect(surfacesShapeKey([two[1]!, two[0]!])).not.toBe(surfacesShapeKey(two));
    const flat = createPath({ id: 'path-1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    expect(surfacesShapeKey(reconcileSurfaces(one, [flat]))).not.toBe(surfacesShapeKey(one));
  });

  it('a role cannot forge a field boundary — roles are operator-typed free strings', () => {
    // The separators are control characters for this reason. A role containing
    // a comma, a colon or a pipe is a thing an operator will type at a wall.
    const a = [createSurface({ id: 'surface-1', role: 'a', path: quad('p') })];
    const b = [createSurface({ id: 'surface-1', role: 'a|1', path: quad('p') })];
    expect(surfacesShapeKey(a)).not.toBe(surfacesShapeKey(b));
  });
});

// ---------------------------------------------------------------------------
// 4. Clearing a field, and the preset.
// ---------------------------------------------------------------------------

describe('applyLayerPatch — an optional field can be cleared, not just set', () => {
  it('a cleared fillRole leaves a layer deep-equal to one that never had it', () => {
    const bound = createLayer({ id: 'l1', providerId: 'p', fillRole: 'panel' });
    const cleared = applyLayerPatch(bound, { fillRole: undefined });
    const never = createLayer({ id: 'l1', providerId: 'p' });
    expect(cleared).toStrictEqual(never);
    // The mechanism, not the value: the KEY is gone, which a spread would have
    // left behind holding `undefined`.
    expect(Object.keys(cleared)).not.toContain('fillRole');
    expect(Object.keys({ ...bound, fillRole: undefined })).toContain('fillRole');
  });

  it('an ordinary patch still just patches', () => {
    const l = createLayer({ id: 'l1', providerId: 'p' });
    expect(applyLayerPatch(l, { opacity: 0.5 }).opacity).toBe(0.5);
  });
});

describe('entity.<id>.fillRole — the layer panel writes it through the registry', () => {
  function bind(): { r: ParameterRegistry; read: () => Layer } {
    let layer = createLayer({ id: 'l1', providerId: 'p' });
    const r = new ParameterRegistry();
    r.registerAll(
      defineLayerParameters('l1', () => layer, (patch) => {
        layer = applyLayerPatch(layer, patch);
      }),
    );
    return { r, read: () => layer };
  }

  it('reads empty for an unbound layer and binds it on write', () => {
    const { r, read } = bind();
    expect(r.read('entity.l1.fillRole')).toBe('');
    r.write('entity.l1.fillRole', 'panel');
    expect(read().fillRole).toBe('panel');
  });

  it('emptying it unbinds the layer entirely', () => {
    const { r, read } = bind();
    r.write('entity.l1.fillRole', 'panel');
    r.write('entity.l1.fillRole', '');
    expect(read().fillRole).toBeUndefined();
    expect(Object.keys(read())).not.toContain('fillRole');
  });

  it('trims, because a trailing space is a face that silently never lights', () => {
    const { r, read } = bind();
    r.write('entity.l1.fillRole', '  panel  ');
    expect(read().fillRole).toBe('panel');
  });

  it('accepts a role no surface carries — that is I-13\'s flag, not an error', () => {
    const { r, read } = bind();
    expect(() => r.write('entity.l1.fillRole', 'not-a-role-yet')).not.toThrow();
    expect(read().fillRole).toBe('not-a-role-yet');
  });

  it('clamps an over-long paste rather than refusing it', () => {
    const { r, read } = bind();
    r.write('entity.l1.fillRole', 'x'.repeat(500));
    expect(read().fillRole).toHaveLength(64);
  });

  it('refuses a non-string, which is a caller bug and not an operator typo', () => {
    const { r } = bind();
    expect(() => r.write('entity.l1.fillRole', 3)).toThrow();
  });
});

describe('the white-fill preset — the calibration aid and the reel\'s first beat', () => {
  it('is flat white, bound to panel, and NOT given a staggered tint', () => {
    const s = addWhiteFill(createScene({ id: 'empty' }), 'panel');
    const layer = s.layers[0]!;
    expect(layer.fillRole).toBe('panel');
    expect(layer.content['kind']).toBe('rect');
    // `addLayer` colours any layer whose content omits `tint`. A "white" preset
    // that forgot to name white would come out one of six pastels, and on a
    // dark box at three metres a pale green reads as white until it does not.
    expect(layer.content['tint']).toBe(0xffffff);
  });

  it('lights every face carrying the role, with no further action', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const c = compositorFor(room(quad('path-1'), quad('path-2', 0.5, 0.5)), provider);
    // The preset's own layer, through the compositor that ships — with the
    // procedural provider swapped for the recorder so no GPU is needed.
    const scene = addWhiteFill(createScene({ id: 'empty' }), 'panel');
    c.setScene({
      ...scene,
      layers: scene.layers.map((l) => ({ ...l, providerId: 'recording' })),
    });
    c.update(FRAME);
    expect(masksOf(c)).toHaveLength(2);
    expect(c.roleMisses()).toEqual([]);
    c.destroy();
  });

  it('its transform is inert — the face places it, not the layer', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    const face = quad('path-1', 0.3, 0.3);
    const c = compositorFor(room(face), provider);
    const scene = addWhiteFill(createScene({ id: 'empty' }), 'panel');
    c.setScene({
      ...scene,
      layers: scene.layers.map((l) => ({ ...l, providerId: 'recording' })),
    });
    c.update(FRAME);
    // The provider was handed the FACE's box, never the layer's half-frame one.
    const box = pathPixelBounds(face, W, H);
    expect(provider.resizes.at(-1)).toEqual([
      Math.max(1, Math.round(box.width)),
      Math.max(1, Math.round(box.height)),
    ]);
    expect(provider.resizes.at(-1)).not.toEqual([W / 2, H / 2]);
    c.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. The disk half — the room survives the app being closed.
// ---------------------------------------------------------------------------

/**
 * `electron/calibration.ts`, through the same stub `config.test.ts` uses: the
 * `electron` module is aliased in `vitest.config.ts`, and `app.getAppPath()`
 * returns a temp dir. So the file store IS reachable from the unit suite, and
 * "the room is written to disk and comes back" stops being a claim that rests
 * on the code looking like the warp's.
 *
 * What this still cannot say: that the IPC handler in `electron/main.ts` calls
 * these on every message. That is one `saveSurfacesRaw` behind an `ipcMain.on`
 * and it is discharged by running the app, not here.
 */
describe('the file store — surfaces.json lands beside warp.json and survives', () => {
  afterAll(() => {
    const dir = surfacesFilePath().replace(/\/[^/]+$/, '');
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes and reads back a room, through the envelope that crosses IPC', () => {
    const tree = reconcileSurfaces([], [quad('path-1'), quad('path-2', 0.5, 0.5)]);
    const tagged = tree.map((s, i) => (i === 0 ? { ...s, role: 'box-left' } : s));
    saveSurfacesRaw(writeSurfaces(tagged));
    expect(readSurfaces(loadSurfacesRaw(), canonicalizeSurface)).toEqual(tagged);
  });

  it('a missing file is an empty room, not a throw — a first launch has no faces', () => {
    rmSync(surfacesFilePath(), { force: true });
    expect(loadSurfacesRaw()).toBeNull();
    expect(readSurfaces(loadSurfacesRaw(), canonicalizeSurface)).toEqual([]);
  });

  it('the room and the warp are two files, so re-marking cannot destroy an alignment', () => {
    // I-5, made structural rather than promised. One night's warp survives an
    // evening of re-marking because they are not the same bytes.
    expect(surfacesFilePath()).not.toBe(calibrationFilePath());
    expect(surfacesFilePath().endsWith('surfaces.json')).toBe(true);
    expect(calibrationFilePath().endsWith('warp.json')).toBe(true);
    // ...and in the same directory, which is what makes "commit both, that is
    // the undo" one gesture at the wall (SPRINT.md's W1 close-out).
    const dir = (f: string): string => f.replace(/\/[^/]+$/, '');
    expect(dir(surfacesFilePath())).toBe(dir(calibrationFilePath()));
  });
});
