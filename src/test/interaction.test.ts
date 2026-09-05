/**
 * P5-B — pointer interaction on the preview, as pure geometry.
 *
 * Written the way Block A's path tests were: the arithmetic that decides what a
 * gesture means gets pinned before any of it is judged by clicking, because a
 * hit test that is right on a 480 px preview and wrong on a 960 px one is not
 * something a mouse will tell you. Half of this file exists for exactly that
 * question — I-1's claim that no pixel value reaches stored state is only worth
 * anything if the *input* path honours it too, and the input path is the one
 * place in the editor that legitimately starts with pixels.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLayer, isNormalizedTransform, type NormalizedTransform } from '../core/layer';
import { createScene, deserializeScene, serializeScene, type Scene } from '../core/scene';
import { MIN_LAYER_EXTENT, addLayer, removeLayer, setLayerRect } from '../core/sceneEdit';
import {
  EDGE_TOLERANCE,
  HANDLES,
  HANDLE_RADIUS,
  InteractionError,
  aspectOf,
  beginGesture,
  containsPoint,
  fromLocal,
  gestureRect,
  handleAt,
  handlePoint,
  hitTest,
  isHandleId,
  isPlaceable,
  rectBetween,
  toLocal,
  toNormalizedPoint,
} from '../editor/interaction';

/** The preview's size, and a second one four times larger in each axis. */
const SMALL = { width: 480, height: 270 } as const;
const LARGE = { width: 1920, height: 1080 } as const;

const box = (
  id: string,
  t: Partial<NormalizedTransform>,
  extra: { visible?: boolean; zOrder?: number } = {},
) =>
  createLayer({
    id,
    providerId: 'procedural',
    transform: { x: 0.5, y: 0.5, width: 0.2, height: 0.2, rotation: 0, ...t },
    ...(extra.visible === undefined ? {} : { visible: extra.visible }),
    ...(extra.zOrder === undefined ? {} : { zOrder: extra.zOrder }),
  });

const sceneWith = (...layers: ReturnType<typeof box>[]): Scene =>
  createScene({ id: 'p5b', layers });

const transformOf = (s: Scene, id: string): NormalizedTransform =>
  s.layers.find((l) => l.id === id)!.transform;

describe('I-1 — the pixel boundary, and it is one function wide', () => {
  it('the same relative pointer position normalizes identically at two resolutions', () => {
    const a = toNormalizedPoint(144, 162, SMALL.width, SMALL.height);
    const b = toNormalizedPoint(576, 648, LARGE.width, LARGE.height);
    expect(a).toEqual(b);
    expect(a).toEqual({ x: 0.3, y: 0.6 });
  });

  it('clamps a pointer released outside the canvas — drift, not corruption', () => {
    // A drag that ends a few pixels past the edge is an ordinary gesture. This
    // is the same ruling `clamp01` makes for a stored coordinate (Block A).
    expect(toNormalizedPoint(-4, 300, SMALL.width, SMALL.height)).toEqual({ x: 0, y: 1 });
  });

  it('refuses a canvas that has not been laid out, naming the value', () => {
    // Not pedantry: 0 width divides to Infinity, which clamps to a confident
    // 1.0 — a pointer event reported at the exact right edge of a canvas
    // nobody clicked. That is the plausible wrong answer, so it is refused.
    expect(() => toNormalizedPoint(10, 10, 0, 270)).toThrow(InteractionError);
    expect(() => toNormalizedPoint(10, 10, 0, 270)).toThrow(/width.*got 0/);
    expect(() => toNormalizedPoint(10, 10, 480, -270)).toThrow(/height.*got -270/);
    expect(() => aspectOf(480, 0)).toThrow(InteractionError);
  });

  it('refuses a non-finite pointer coordinate, naming the value', () => {
    expect(() => toNormalizedPoint(Number.NaN, 10, 480, 270)).toThrow(/pointer x.*got null/);
    expect(() => toNormalizedPoint(10, Number.POSITIVE_INFINITY, 480, 270)).toThrow(/pointer y/);
  });

  it('nothing in interaction.ts stores a pixel value — the whole module is normalized', () => {
    // The mechanical form of the claim: `toNormalizedPoint` is the only export
    // taking a canvas dimension, and `aspectOf` returns a ratio. If a second
    // function ever grows a pixel parameter, this reads as a reminder that the
    // boundary moved.
    const src = readInteractionSource();
    const takesPixels = [...src.matchAll(/export function (\w+)\(([^)]*)\)/gs)]
      .filter((m) => /canvasWidth|canvasHeight|pixelX|pixelY/.test(m[2]!))
      .map((m) => m[1]!);
    expect(takesPixels.sort()).toEqual(['aspectOf', 'toNormalizedPoint']);
  });
});

describe('I-1 — hit testing is resolution-independent', () => {
  const scene = sceneWith(box('a', { x: 0.3, y: 0.6, width: 0.2, height: 0.2 }));

  /**
   * Gate 5's condition, in the only form a headless test can put it: the same
   * physical click on two differently sized canvases must select the same
   * region and produce the same stored transform, bit for bit.
   */
  it('the same click selects the same region on a 480x270 and a 1920x1080 canvas', () => {
    const small = hitTest(
      scene,
      toNormalizedPoint(144, 162, SMALL.width, SMALL.height),
      aspectOf(SMALL.width, SMALL.height),
    );
    const large = hitTest(
      scene,
      toNormalizedPoint(576, 648, LARGE.width, LARGE.height),
      aspectOf(LARGE.width, LARGE.height),
    );
    expect(small).toBe('a');
    expect(large).toBe('a');
  });

  it('a click just outside the region misses at BOTH resolutions', () => {
    // The negative control. Without it the test above passes for a hit test
    // that returns the first layer whatever it is handed.
    const justOutside = { small: [144, 162 - 28], large: [576, 648 - 112] } as const;
    expect(
      hitTest(
        scene,
        toNormalizedPoint(justOutside.small[0], justOutside.small[1], SMALL.width, SMALL.height),
        aspectOf(SMALL.width, SMALL.height),
      ),
    ).toBeNull();
    expect(
      hitTest(
        scene,
        toNormalizedPoint(justOutside.large[0], justOutside.large[1], LARGE.width, LARGE.height),
        aspectOf(LARGE.width, LARGE.height),
      ),
    ).toBeNull();
  });

  it('a whole drag produces a bit-identical transform at two resolutions', () => {
    // Press at the region's centre, release a quarter of the frame right and
    // an eighth down. The two runs share not one pixel value.
    const run = (size: { width: number; height: number }): NormalizedTransform => {
      const aspect = aspectOf(size.width, size.height);
      const down = toNormalizedPoint(0.3 * size.width, 0.6 * size.height, size.width, size.height);
      const up = toNormalizedPoint(0.55 * size.width, 0.725 * size.height, size.width, size.height);
      const start = beginGesture(scene, null, down, aspect);
      const rect = gestureRect(scene, start.gesture, up, aspect)!;
      return transformOf(setLayerRect(scene, start.selectedId!, rect), 'a');
    };
    const small = run(SMALL);
    expect(run(LARGE)).toEqual(small);
    expect(small.x).toBeCloseTo(0.55, 12);
    expect(small.y).toBeCloseTo(0.725, 12);
    expect(small.width).toBe(0.2);
  });

  it('an unrotated region hit-tests the same at any aspect ratio at all', () => {
    // Aspect only enters the rotated case. Stated as a test so that a future
    // change which starts scaling x by the aspect fails here rather than on a
    // wall, where it would read as "the preview is slightly off".
    const p = { x: 0.3, y: 0.6 };
    for (const aspect of [1, 16 / 9, 4 / 3, 0.5]) {
      expect(hitTest(scene, p, aspect)).toBe('a');
    }
  });

  it('the handle radius is normalized, so the same near-miss decides the same way', () => {
    // The defect this exists to prevent: a handle radius in PIXELS is 0.025 of
    // a 480 px frame and 0.00625 of a 1920 px one, so this exact click would
    // grab the handle on the preview and miss it on a larger canvas.
    const t = transformOf(scene, 'a');
    const nw = handlePoint(t, 'nw', 1);
    const nearMiss = { x: nw.x - HANDLE_RADIUS * 0.6, y: nw.y };
    for (const size of [SMALL, LARGE]) {
      const aspect = aspectOf(size.width, size.height);
      expect(handleAt(t, { x: nw.x, y: nw.y }, aspect)).toBe('nw');
      expect(handleAt(t, nearMiss, aspect)).toBe('nw');
      expect(handleAt(t, { x: nw.x - HANDLE_RADIUS * 2, y: nw.y }, aspect)).toBeNull();
    }
  });
});

describe('hit testing picks what the operator can see', () => {
  it('topmost wins where regions overlap', () => {
    const s = sceneWith(
      box('under', { x: 0.5, y: 0.5, width: 0.4, height: 0.4, rotation: 0 }, { zOrder: 0 }),
      box('over', { x: 0.5, y: 0.5, width: 0.2, height: 0.2, rotation: 0 }, { zOrder: 1 }),
    );
    expect(hitTest(s, { x: 0.5, y: 0.5 }, 1)).toBe('over');
    // And the one underneath is still reachable where the top one is not.
    expect(hitTest(s, { x: 0.65, y: 0.5 }, 1)).toBe('under');
  });

  it('an invisible layer is not hittable', () => {
    const s = sceneWith(
      box('under', { width: 0.4, height: 0.4 }, { zOrder: 0 }),
      box('hidden', { width: 0.4, height: 0.4 }, { zOrder: 1, visible: false }),
    );
    expect(hitTest(s, { x: 0.5, y: 0.5 }, 1)).toBe('under');
  });

  it('empty space is null, not the nearest layer', () => {
    expect(hitTest(sceneWith(box('a', {})), { x: 0.95, y: 0.05 }, 1)).toBeNull();
  });

  it('the edge tolerance admits an ulp and nothing a pointer can express', () => {
    // Both halves. The corner of a region is one ulp outside it in floating
    // point and must be a hit; a point a thousandth of the frame outside must
    // not be, or the tolerance has quietly become a margin.
    const s = sceneWith(box('a', { x: 0.5, y: 0.5, width: 0.3, height: 0.3 }));
    const t = transformOf(s, 'a');
    expect(hitTest(s, handlePoint(t, 'se', 1), 1)).toBe('a');
    expect(hitTest(s, { x: 0.65 + EDGE_TOLERANCE * 10, y: 0.5 }, 1)).toBeNull();
    expect(hitTest(s, { x: 0.651, y: 0.5 }, 1)).toBeNull();
  });
});

describe('rotation is honoured, and not written', () => {
  const rotated = sceneWith(
    box('r', { x: 0.5, y: 0.5, width: 0.4, height: 0.4, rotation: 0.125 }),
  );

  it('a point inside the axis-aligned box but outside the rotated one misses', () => {
    // 45 degrees. The unrotated corner (0.68, 0.68) is well inside the stored
    // box and well outside the diamond that is actually drawn.
    expect(containsPoint(transformOf(rotated, 'r'), { x: 0.68, y: 0.68 }, 1)).toBe(false);
    // ...while the rotated tip, further from the centre, is inside it.
    expect(containsPoint(transformOf(rotated, 'r'), { x: 0.5, y: 0.77 }, 1)).toBe(true);
  });

  it('toLocal and fromLocal are inverses at a non-square aspect', () => {
    const t = transformOf(rotated, 'r');
    const aspect = aspectOf(SMALL.width, SMALL.height);
    const p = { x: 0.42, y: 0.61 };
    const back = fromLocal(t, toLocal(t, p, aspect), aspect);
    expect(back.x).toBeCloseTo(p.x, 12);
    expect(back.y).toBeCloseTo(p.y, 12);
  });

  it('no gesture writes rotation — it survives a move and a scale untouched', () => {
    const aspect = aspectOf(SMALL.width, SMALL.height);
    const start = beginGesture(rotated, null, { x: 0.5, y: 0.5 }, aspect);
    const moved = setLayerRect(
      rotated,
      'r',
      gestureRect(rotated, start.gesture, { x: 0.6, y: 0.4 }, aspect)!,
    );
    expect(transformOf(moved, 'r').rotation).toBe(0.125);

    const grab = beginGesture(moved, 'r', handlePoint(transformOf(moved, 'r'), 'se', aspect), aspect);
    expect(grab.gesture.kind).toBe('scale');
    const scaled = setLayerRect(
      moved,
      'r',
      gestureRect(moved, grab.gesture, { x: 0.75, y: 0.7 }, aspect)!,
    );
    expect(transformOf(scaled, 'r').rotation).toBe(0.125);
  });
});

describe('beginGesture — the ordering IS the decision', () => {
  const scene = sceneWith(box('a', { x: 0.5, y: 0.5, width: 0.3, height: 0.3 }));
  const aspect = aspectOf(SMALL.width, SMALL.height);

  it('a handle of the SELECTED layer beats the layer body underneath it', () => {
    const se = handlePoint(transformOf(scene, 'a'), 'se', aspect);
    // The handle sits ON the region, so a body-first order would make every
    // handle unreachable — the gesture would be a move that started at a corner.
    expect(containsPoint(transformOf(scene, 'a'), se, aspect)).toBe(true);
    expect(beginGesture(scene, 'a', se, aspect).gesture).toEqual({
      kind: 'scale',
      layerId: 'a',
      handle: 'se',
    });
  });

  it('the same handle position on an UNSELECTED layer is a move, not a scale', () => {
    const se = handlePoint(transformOf(scene, 'a'), 'se', aspect);
    const start = beginGesture(scene, null, se, aspect);
    expect(start.gesture.kind).toBe('move');
    expect(start.selectedId).toBe('a');
  });

  it('a press on a layer selects and moves it in one gesture', () => {
    const start = beginGesture(scene, null, { x: 0.55, y: 0.52 }, aspect);
    expect(start.selectedId).toBe('a');
    expect(start.gesture).toEqual({
      kind: 'move',
      layerId: 'a',
      grab: { x: 0.55 - 0.5, y: 0.52 - 0.5 },
    });
  });

  it('a press on empty space deselects and starts placing', () => {
    const start = beginGesture(scene, 'a', { x: 0.05, y: 0.05 }, aspect);
    expect(start.selectedId).toBeNull();
    expect(start.gesture).toEqual({ kind: 'place', origin: { x: 0.05, y: 0.05 } });
  });

  it('a gesture against a layer that has since been deleted yields no rect', () => {
    const start = beginGesture(scene, null, { x: 0.5, y: 0.5 }, aspect);
    const gone = removeLayer(scene, 'a');
    expect(gestureRect(gone, start.gesture, { x: 0.6, y: 0.6 }, aspect)).toBeNull();
  });
});

describe('gestureRect — move, scale, place', () => {
  const scene = sceneWith(box('a', { x: 0.5, y: 0.5, width: 0.3, height: 0.2 }));
  const aspect = aspectOf(SMALL.width, SMALL.height);

  it('a move keeps the grab offset, so the region does not jump under the cursor', () => {
    const start = beginGesture(scene, null, { x: 0.6, y: 0.55 }, aspect);
    const rect = gestureRect(scene, start.gesture, { x: 0.7, y: 0.35 }, aspect)!;
    expect(rect.x).toBeCloseTo(0.6, 12);
    expect(rect.y).toBeCloseTo(0.3, 12);
    expect(rect.width).toBe(0.3);
    expect(rect.height).toBe(0.2);
  });

  const OPPOSITE = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' } as const;

  it('a scale holds the OPPOSITE corner still — the property that makes it feel right', () => {
    // One drag per handle, each pulled AWAY from its anchor so the box does not
    // turn inside out. The inside-out case is the test below, and it has a
    // different right answer: the anchor is still a corner, but no longer the
    // corner it started as.
    const outward = { nw: { x: 0.2, y: 0.3 }, ne: { x: 0.8, y: 0.3 }, se: { x: 0.8, y: 0.7 }, sw: { x: 0.2, y: 0.7 } } as const;
    for (const handle of HANDLES) {
      const t = transformOf(scene, 'a');
      const anchorBefore = handlePoint(t, OPPOSITE[handle], aspect);
      const start = beginGesture(scene, 'a', handlePoint(t, handle, aspect), aspect);
      expect(start.gesture.kind).toBe('scale');
      const dragged = setLayerRect(
        scene,
        'a',
        gestureRect(scene, start.gesture, outward[handle], aspect)!,
      );
      const after = transformOf(dragged, 'a');
      const anchorAfter = handlePoint(after, OPPOSITE[handle], aspect);
      expect(anchorAfter.x, `${handle}: anchor x moved`).toBeCloseTo(anchorBefore.x, 12);
      expect(anchorAfter.y, `${handle}: anchor y moved`).toBeCloseTo(anchorBefore.y, 12);
      // And the drag actually did something, or holding a corner still is free.
      expect(after.width).toBeGreaterThan(t.width);
    }
  });

  it('a corner dragged PAST its anchor keeps the anchor as a corner, sizes positive', () => {
    // The box turns inside out. Naming the surviving property rather than the
    // one that stops holding: "the se corner does not move" is false here, and
    // "the anchor is still a corner of the box" is what the operator sees.
    const t = transformOf(scene, 'a');
    const anchor = handlePoint(t, 'se', aspect);
    const start = beginGesture(scene, 'a', handlePoint(t, 'nw', aspect), aspect);
    const dragged = setLayerRect(scene, 'a', gestureRect(scene, start.gesture, { x: 0.9, y: 0.9 }, aspect)!);
    const after = transformOf(dragged, 'a');
    expect(after.width).toBeGreaterThan(0);
    expect(after.height).toBeGreaterThan(0);
    const corners = HANDLES.map((h) => handlePoint(after, h, aspect));
    expect(
      corners.some((c) => Math.abs(c.x - anchor.x) < 1e-12 && Math.abs(c.y - anchor.y) < 1e-12),
      'the anchor stopped being a corner of the box',
    ).toBe(true);
  });

  it('a scale dragged past the anchor gives a positive size, not a negative one', () => {
    const t = transformOf(scene, 'a');
    const start = beginGesture(scene, 'a', handlePoint(t, 'se', aspect), aspect);
    // Well past the north-west corner: the box turns inside out geometrically
    // and must still be a box.
    const rect = gestureRect(scene, start.gesture, { x: 0.1, y: 0.1 }, aspect)!;
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });

  it('placing draws the box between the two corners, in either order', () => {
    expect(rectBetween({ x: 0.2, y: 0.8 }, { x: 0.6, y: 0.4 })).toEqual(
      rectBetween({ x: 0.6, y: 0.4 }, { x: 0.2, y: 0.8 }),
    );
    const r = rectBetween({ x: 0.2, y: 0.4 }, { x: 0.6, y: 0.8 });
    expect(r.x).toBeCloseTo(0.4, 12);
    expect(r.y).toBeCloseTo(0.6, 12);
    expect(r.width).toBeCloseTo(0.4, 12);
    expect(r.height).toBeCloseTo(0.4, 12);
  });

  it('a click on empty space places nothing — the threshold is the mutation constant', () => {
    // Shared with `setLayerRect`, not copied: a stroke below the minimum would
    // otherwise be clamped UP into a region the operator did not draw.
    expect(isPlaceable(rectBetween({ x: 0.4, y: 0.4 }, { x: 0.4, y: 0.4 }))).toBe(false);
    expect(
      isPlaceable(rectBetween({ x: 0.4, y: 0.4 }, { x: 0.4 + MIN_LAYER_EXTENT / 2, y: 0.9 })),
    ).toBe(false);
    expect(
      isPlaceable(rectBetween({ x: 0.4, y: 0.4 }, { x: 0.4 + MIN_LAYER_EXTENT, y: 0.9 })),
    ).toBe(true);
  });
});

describe('I-1 — a full gesture round trip stores no pixel value', () => {
  const aspect = aspectOf(SMALL.width, SMALL.height);

  /** Place, move, scale, delete — the four gestures "Done when" names. */
  it('place → move → scale → delete leaves every transform normalized and round-tripping', () => {
    let s: Scene = createScene({ id: 'drawn' });

    // Place, from a drag across the middle of the frame.
    const down = toNormalizedPoint(120, 60, SMALL.width, SMALL.height);
    const up = toNormalizedPoint(360, 200, SMALL.width, SMALL.height);
    const placing = beginGesture(s, null, down, aspect);
    expect(placing.gesture.kind).toBe('place');
    const drawn = gestureRect(s, placing.gesture, up, aspect)!;
    expect(isPlaceable(drawn)).toBe(true);
    s = addLayer(s, { idPrefix: 'rect', providerId: 'procedural', content: { kind: 'rect' }, rect: drawn });
    expect(s.layers.map((l) => l.id)).toEqual(['rect-1']);
    expect(transformOf(s, 'rect-1').x).toBeCloseTo(0.5, 12);
    expectNormalizedAndRoundTrips(s);

    // Move.
    const moveStart = beginGesture(s, null, { x: 0.5, y: 0.48 }, aspect);
    expect(moveStart.selectedId).toBe('rect-1');
    s = setLayerRect(s, 'rect-1', gestureRect(s, moveStart.gesture, { x: 0.3, y: 0.3 }, aspect)!);
    expect(transformOf(s, 'rect-1').x).toBeCloseTo(0.3, 12);
    expectNormalizedAndRoundTrips(s);

    // Scale.
    const scaleStart = beginGesture(s, 'rect-1', handlePoint(transformOf(s, 'rect-1'), 'se', aspect), aspect);
    expect(scaleStart.gesture.kind).toBe('scale');
    const before = transformOf(s, 'rect-1').width;
    s = setLayerRect(s, 'rect-1', gestureRect(s, scaleStart.gesture, { x: 0.9, y: 0.9 }, aspect)!);
    expect(transformOf(s, 'rect-1').width).toBeGreaterThan(before);
    expectNormalizedAndRoundTrips(s);

    // Delete.
    s = removeLayer(s, 'rect-1');
    expect(s.layers).toEqual([]);
    expectNormalizedAndRoundTrips(s);
  });

  it('a drag off the edge of the canvas clamps into the frame rather than storing 1.4', () => {
    let s = sceneWith(box('a', { x: 0.5, y: 0.5, width: 0.3, height: 0.3 }));
    const start = beginGesture(s, null, { x: 0.5, y: 0.5 }, aspect);
    // The pointer is already clamped by `toNormalizedPoint`; this is the second
    // half of the same rule, at the mutation.
    s = setLayerRect(s, 'a', gestureRect(s, start.gesture, { x: 1.4, y: -0.3 }, aspect)!);
    expect(transformOf(s, 'a')).toMatchObject({ x: 1, y: 0 });
    expectNormalizedAndRoundTrips(s);
  });
});

describe('the vocabulary is closed', () => {
  it('there are exactly four handles and nothing else is one', () => {
    expect([...HANDLES]).toEqual(['nw', 'ne', 'se', 'sw']);
    expect(isHandleId('nw')).toBe(true);
    expect(isHandleId('n')).toBe(false);
    expect(isHandleId('rotate')).toBe(false);
  });

  it('an unknown handle is refused by name, not silently treated as a corner', () => {
    const t = transformOf(sceneWith(box('a', {})), 'a');
    expect(() => handlePoint(t, 'rotate' as never, 1)).toThrow(InteractionError);
    expect(() => handlePoint(t, 'rotate' as never, 1)).toThrow(/unknown handle "rotate"/);
  });
});

function expectNormalizedAndRoundTrips(s: Scene): void {
  for (const layer of s.layers) {
    expect(isNormalizedTransform(layer.transform), `${layer.id} left normalized space`).toBe(true);
  }
  expect(deserializeScene(serializeScene(s))).toEqual(s);
}

function readInteractionSource(): string {
  return readFileSync(join(import.meta.dirname, '..', 'editor', 'interaction.ts'), 'utf8');
}
