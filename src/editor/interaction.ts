/**
 * Pointer interaction over the editor preview: hit testing, selection and the
 * three gestures — **place**, **move**, **scale** (I-1, I-7, D11).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR THINGS THIS FILE IS DELIBERATELY NOT.
 *
 * **Not a place where pixels live.** `toNormalizedPoint` is the one function
 * in the editor that turns a pointer's pixel coordinate into a normalized one,
 * and it is the last thing in the gesture pipeline that sees a pixel value at
 * all. Everything after it — hit test, handle test, gesture geometry, the
 * mutation — is `[0, 1]` (I-1). The consequence is testable and is tested: the
 * same pointer position expressed at two canvas resolutions produces the same
 * selection and the same stored transform, bit for bit. Nothing here takes a
 * canvas size except that one function and `aspect`, which is a ratio and not a
 * length.
 *
 * **Not a mutation.** These functions compute *what the operator asked for* as
 * a normalized rect. `core/sceneEdit.ts` performs it, purely, and the result
 * crosses to the output as JSON on the existing `scene:set` channel (I-7). This
 * file imports the mutation's constants and never the renderer.
 *
 * **Not selection state.** Selection is editor UI state and lives in the
 * preview component's `useState`. It is not on `Scene`, so it cannot enter a
 * scene file, cross IPC or round-trip — the strongest available form of that
 * guarantee, since there is no field for it to occupy.
 *
 * **Not a rotate handle.** `NormalizedTransform.rotation` exists, in turns, and
 * P5-B ships no gesture that writes it. It is nevertheless *read* here: the
 * geometry below un-rotates the pointer into the layer's own frame, so a
 * rotated layer is hit where it is drawn rather than where its axis-aligned box
 * would be. Honouring a field is not the same as editing it, and the block that
 * adds the handle inherits correct maths instead of writing them then.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { type NormalizedTransform } from '../core/layer';
import { layersInDrawOrder, type Scene } from '../core/scene';
import { MIN_LAYER_EXTENT, type NormalizedRect } from '../core/sceneEdit';

/** A point in normalized space (I-1). The only kind this file passes around. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/**
 * The four corner handles, in a fixed order so the overlay draws them in the
 * same order the hit test walks them.
 *
 * Corners only. Edge handles would let a region be scaled on one axis, which is
 * useful and is not what "Done when" asks for; they are the cheap addition once
 * the corner case is proven, and adding them now would double the case table
 * before a single one had been seen on the wall.
 */
export const HANDLES = ['nw', 'ne', 'se', 'sw'] as const;
export type HandleId = (typeof HANDLES)[number];

export function isHandleId(v: unknown): v is HandleId {
  return typeof v === 'string' && (HANDLES as readonly string[]).includes(v);
}

/**
 * How close the pointer must come to a corner to grab its handle, in
 * **normalized units** — not pixels, and that is the whole point.
 *
 * A handle radius in pixels would make the hit test resolution-dependent: at
 * 480 px wide a 12 px radius is 0.025 of the frame and at 960 px it is 0.0125,
 * so the same *relative* pointer position would grab the handle on one canvas
 * and miss it on the other. That is precisely the defect I-1 exists to prevent,
 * and it would arrive through the input path rather than through stored state,
 * where nobody is looking for it.
 */
export const HANDLE_RADIUS = 0.025;

export class InteractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractionError';
  }
}

const TAU = Math.PI * 2;

/**
 * The pixel-to-normalized boundary. **The only function here that sees a pixel
 * value**, and it does not return one.
 *
 * Out-of-range results are **clamped**, following Block A: a pointer released a
 * few pixels past the canvas edge during a drag is an ordinary gesture, not a
 * corrupt one, and refusing it would mean a drag that ended slightly outside
 * the frame silently did nothing.
 *
 * A non-finite coordinate or a non-positive canvas size is **refused**, naming
 * the value. Neither is a number out of range: a zero-width canvas means the
 * element has not been laid out and the division would produce `Infinity`,
 * which `clamp01` would turn into a confident 1.0 — a pointer event reported at
 * the exact right edge of a canvas nobody clicked.
 */
export function toNormalizedPoint(
  pixelX: number,
  pixelY: number,
  canvasWidth: number,
  canvasHeight: number,
): NormalizedPoint {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) {
    throw new InteractionError(
      `canvas width must be a positive finite number, got ${JSON.stringify(canvasWidth)}`,
    );
  }
  if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) {
    throw new InteractionError(
      `canvas height must be a positive finite number, got ${JSON.stringify(canvasHeight)}`,
    );
  }
  if (!Number.isFinite(pixelX)) {
    throw new InteractionError(`pointer x must be a finite number, got ${JSON.stringify(pixelX)}`);
  }
  if (!Number.isFinite(pixelY)) {
    throw new InteractionError(`pointer y must be a finite number, got ${JSON.stringify(pixelY)}`);
  }
  return { x: clampUnit(pixelX / canvasWidth), y: clampUnit(pixelY / canvasHeight) };
}

/**
 * The canvas aspect ratio, `width / height`. **Dimensionless**, which is why it
 * is allowed to travel with normalized geometry.
 *
 * It is needed for exactly one thing: rotation. The compositor rotates a layer
 * in *pixel* space, so on a 16:9 canvas a normalized rotation is not the same
 * transform as a pixel one, and a hit test that ignored the difference would
 * miss a rotated region by a margin that grows with the angle. The ratio is not
 * a length and never reaches stored state — nothing below writes it anywhere.
 */
export function aspectOf(canvasWidth: number, canvasHeight: number): number {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0 || !Number.isFinite(canvasHeight) || canvasHeight <= 0) {
    throw new InteractionError(
      `aspect needs positive finite dimensions, got ${JSON.stringify(canvasWidth)}×${JSON.stringify(canvasHeight)}`,
    );
  }
  return canvasWidth / canvasHeight;
}

/** Local, so this file needs no pixel-space helper from `layer.ts`. */
function clampUnit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * A world point in the layer's own frame — origin at the layer's centre, axes
 * along the layer's edges, still in normalized units.
 *
 * The `aspect` round trip (divide y, rotate, multiply y) is what makes this
 * agree with the compositor: it rotates in a square space, which is the space
 * pixels are square in, and returns to normalized units afterwards.
 *
 * **The unrotated case returns before touching it, and that is not an
 * optimisation.** `(dy / aspect) * aspect` is exact in real arithmetic and off
 * by an ulp in floating point, which is enough to put a click on a region's
 * exact corner a hair *outside* it — and a corner is where the operator clicks
 * most, because that is where the handles are. Doing nothing when there is
 * nothing to rotate makes the boundary exact for every layer this block can
 * produce; the rotated path keeps the ulp, where it is unreachable by a mouse.
 */
export function toLocal(t: NormalizedTransform, p: NormalizedPoint, aspect: number): NormalizedPoint {
  if (t.rotation === 0) return { x: p.x - t.x, y: p.y - t.y };
  const dx = p.x - t.x;
  const dy = (p.y - t.y) / aspect;
  const a = -t.rotation * TAU;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: dx * cos - dy * sin, y: (dx * sin + dy * cos) * aspect };
}

/** The inverse of `toLocal`, exactly — including the unrotated short circuit. */
export function fromLocal(
  t: NormalizedTransform,
  local: NormalizedPoint,
  aspect: number,
): NormalizedPoint {
  if (t.rotation === 0) return { x: t.x + local.x, y: t.y + local.y };
  const lx = local.x;
  const ly = local.y / aspect;
  const a = t.rotation * TAU;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: t.x + (lx * cos - ly * sin), y: t.y + (lx * sin + ly * cos) * aspect };
}

/**
 * How far outside its own edge a point may fall and still be inside the region,
 * in normalized units. Float drift only — 1e-9 of a 1920 px frame is two
 * millionths of a pixel, so nothing a pointer can express reaches it.
 *
 * It has to exist, and the reason is not fussiness. A region's stored centre is
 * 0.5 and its half-width 0.15, so its edge is at `0.5 + 0.15 = 0.65`; asked
 * where that edge is, floating point answers `0.65`, and asked how far `0.65`
 * is from `0.5` it answers `0.15000000000000002`. The corner of a region is
 * therefore one ulp outside it — and the corner is the single most-clicked
 * point on a region, because that is where the handles are. This is the same
 * ruling Block A made for a coordinate half a pixel outside the frame: the
 * value drifted, so it is accepted rather than refused.
 */
export const EDGE_TOLERANCE = 1e-9;

/** True when the point falls inside the layer's box, rotation honoured. */
export function containsPoint(
  t: NormalizedTransform,
  p: NormalizedPoint,
  aspect: number,
): boolean {
  const local = toLocal(t, p, aspect);
  return (
    Math.abs(local.x) <= t.width / 2 + EDGE_TOLERANCE &&
    Math.abs(local.y) <= t.height / 2 + EDGE_TOLERANCE
  );
}

/**
 * The layer under the pointer, or `null` for empty space.
 *
 * **Topmost first**, so a click on overlapping regions selects the one the
 * operator can see. `layersInDrawOrder` is back-to-front, which is the order
 * the compositor draws in, so this walks it in reverse — the same list read the
 * other way rather than a second ordering to keep in step with it.
 *
 * An invisible layer is not hittable: a layer hidden with the visibility
 * checkbox that still swallowed clicks would be a region the operator cannot
 * see and cannot click past.
 */
export function hitTest(scene: Scene, p: NormalizedPoint, aspect: number): string | null {
  const ordered = layersInDrawOrder(scene);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const layer = ordered[i]!;
    if (!layer.visible) continue;
    if (containsPoint(layer.transform, p, aspect)) return layer.id;
  }
  return null;
}

/** A corner's local offset from the layer centre, in half-extents. */
const HANDLE_SIGNS: Record<HandleId, { sx: -1 | 1; sy: -1 | 1 }> = {
  nw: { sx: -1, sy: -1 },
  ne: { sx: 1, sy: -1 },
  se: { sx: 1, sy: 1 },
  sw: { sx: -1, sy: 1 },
};

/** Where a handle sits in normalized space. Used by the hit test and the overlay. */
export function handlePoint(t: NormalizedTransform, handle: HandleId, aspect: number): NormalizedPoint {
  const sign = HANDLE_SIGNS[handle];
  if (!sign) {
    throw new InteractionError(
      `unknown handle ${JSON.stringify(handle)} (only ${HANDLES.join(', ')})`,
    );
  }
  return fromLocal(t, { x: (sign.sx * t.width) / 2, y: (sign.sy * t.height) / 2 }, aspect);
}

/**
 * The handle under the pointer, or `null`.
 *
 * Distance is measured in the square space, for the same reason `toLocal`
 * rotates there: a radius that is 0.025 of the width horizontally and 0.025 of
 * the *height* vertically is an ellipse on a 16:9 canvas, and the handle would
 * be easier to grab from above than from the side by nearly a factor of two.
 */
export function handleAt(
  t: NormalizedTransform,
  p: NormalizedPoint,
  aspect: number,
  radius: number = HANDLE_RADIUS,
): HandleId | null {
  let best: HandleId | null = null;
  let bestDistance = radius;
  for (const handle of HANDLES) {
    const c = handlePoint(t, handle, aspect);
    const d = Math.hypot(p.x - c.x, (p.y - c.y) / aspect);
    // Strictly less, so the first handle in `HANDLES` wins a tie. Reachable:
    // a region at `MIN_LAYER_EXTENT` has all four corners inside one radius.
    if (d < bestDistance) {
      bestDistance = d;
      best = handle;
    }
  }
  return best;
}

/**
 * What a pointer-down started. Pure data — no scene, no element, no timer, so
 * the whole gesture replays from its start point and the pointer's position.
 *
 * A gesture holds no *transform*, only ids and the grab offset. Re-reading the
 * layer from the scene on every move is what makes `gestureRect` a function of
 * the current scene rather than of a snapshot that could have gone stale — a
 * layer deleted mid-drag ends the gesture instead of resurrecting itself from
 * a copy nothing else can see.
 */
export type Gesture =
  | {
      kind: 'move';
      layerId: string;
      /** Pointer minus centre at pointer-down, so the region does not jump. */
      grab: NormalizedPoint;
    }
  | { kind: 'scale'; layerId: string; handle: HandleId }
  | { kind: 'place'; origin: NormalizedPoint };

export interface GestureStart {
  gesture: Gesture;
  /** Selection after the press. `null` for a press on empty space. */
  selectedId: string | null;
}

/**
 * Decides what a pointer-down means, in one place and in this order:
 *
 *  1. **A handle of the selected layer** — scale. Handles win over the layer
 *     body because a corner handle overlaps it, and if the body won the handles
 *     would be unreachable.
 *  2. **A layer** — select it and move it. Selecting and dragging in one press
 *     rather than click-then-drag: two gestures to move an unselected region is
 *     the affordance nobody finds.
 *  3. **Empty space** — deselect, and start drawing a new region.
 *
 * Ordering is the whole decision, which is why it is a function with a test and
 * not a branch inside a pointer handler.
 */
export function beginGesture(
  scene: Scene,
  selectedId: string | null,
  p: NormalizedPoint,
  aspect: number,
): GestureStart {
  const selected = selectedId === null ? undefined : scene.layers.find((l) => l.id === selectedId);
  if (selected) {
    const handle = handleAt(selected.transform, p, aspect);
    if (handle) {
      return { gesture: { kind: 'scale', layerId: selected.id, handle }, selectedId: selected.id };
    }
  }
  const hit = hitTest(scene, p, aspect);
  if (hit !== null) {
    const layer = scene.layers.find((l) => l.id === hit)!;
    return {
      gesture: {
        kind: 'move',
        layerId: hit,
        grab: { x: p.x - layer.transform.x, y: p.y - layer.transform.y },
      },
      selectedId: hit,
    };
  }
  return { gesture: { kind: 'place', origin: { x: p.x, y: p.y } }, selectedId: null };
}

/**
 * The normalized rect the gesture asks for at the pointer's current position.
 *
 * Pure, and pure in the strong sense: called twice with the same gesture and
 * the same point it returns the same rect, whatever happened in between. That
 * is what lets the preview draw a live outline during the drag while the scene
 * is mutated exactly once, on release — the outline and the committed
 * transform are the same arithmetic, not two approximations of each other.
 *
 * Returns `null` when the gesture's layer has left the scene.
 */
export function gestureRect(
  scene: Scene,
  gesture: Gesture,
  p: NormalizedPoint,
  aspect: number,
): NormalizedRect | null {
  if (gesture.kind === 'place') {
    return rectBetween(gesture.origin, p);
  }
  const layer = scene.layers.find((l) => l.id === gesture.layerId);
  if (!layer) return null;
  const t = layer.transform;

  if (gesture.kind === 'move') {
    // Size untouched. Clamping happens in `setLayerRect`; a centre outside
    // [0,1] here would only mean the pointer left the canvas, and clamping it
    // twice would be two places for the rule to live.
    return { x: p.x - gesture.grab.x, y: p.y - gesture.grab.y, width: t.width, height: t.height };
  }

  // Scale. The OPPOSITE corner is the anchor and does not move — which is what
  // makes a corner drag feel like grabbing that corner, and is also why the
  // centre has to move as the size changes. Worked in the layer's local frame
  // so the rotated case needs no separate branch.
  const sign = HANDLE_SIGNS[gesture.handle];
  const anchorLocal = { x: (-sign.sx * t.width) / 2, y: (-sign.sy * t.height) / 2 };
  const pointerLocal = toLocal(t, p, aspect);
  const width = Math.abs(pointerLocal.x - anchorLocal.x);
  const height = Math.abs(pointerLocal.y - anchorLocal.y);
  const centreLocal = {
    x: (pointerLocal.x + anchorLocal.x) / 2,
    y: (pointerLocal.y + anchorLocal.y) / 2,
  };
  const centre = fromLocal(t, centreLocal, aspect);
  return { x: centre.x, y: centre.y, width, height };
}

/** The box two corners describe, however they are ordered. */
export function rectBetween(a: NormalizedPoint, b: NormalizedPoint): NormalizedRect {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Whether a `place` gesture drew a region or merely clicked.
 *
 * The threshold is `MIN_LAYER_EXTENT` — the same constant the mutation clamps
 * to, deliberately shared rather than copied. A stroke below it would be
 * clamped up to a region the operator did not draw, so a press-and-release on
 * empty space deselects and creates nothing, which is what a click on empty
 * space is supposed to do.
 */
export function isPlaceable(rect: NormalizedRect): boolean {
  return rect.width >= MIN_LAYER_EXTENT && rect.height >= MIN_LAYER_EXTENT;
}
