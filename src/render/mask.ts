/**
 * SPRINT.md §3 R3 — clipping a fill to a marked face, with no render target.
 *
 * One I-17 `Path` becomes one Pixi `Graphics`, set as the `mask` of the
 * container holding that face's content. Nothing else in the engine turns a
 * surface into pixels.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A `Graphics` AND NEVER A `Sprite` OR A `RenderTexture`.
 *
 * PixiJS v8 picks the masking implementation from the TYPE of the object handed
 * to `container.mask`, in `MaskEffectManager.getMaskEffect`:
 *
 *   - `AlphaMask.test(mask)` is `mask instanceof Sprite` — an alpha mask, which
 *     renders the masked subtree into a texture and multiplies. That is a
 *     render target per masked container, allocated on the render thread, and
 *     with one fill per face it is a render target per face.
 *   - `StencilMask.test(mask)` is `mask instanceof Container` — the stencil
 *     buffer. No texture, no target, no allocation past the geometry.
 *
 * A `Graphics` is a `Container` and is not a `Sprite`, so it takes the stencil
 * path by construction rather than by intention. That is the whole of R3, and
 * it is why this file returns a `Graphics` and why the type is asserted rather
 * than assumed: swapping in a sprite mask later would still clip correctly on
 * the wall while quietly allocating a target per face, which is the kind of
 * regression a picture cannot show.
 *
 * The render-target count in the HUD (`debug/gpu.ts`) is the number that
 * catches it, and the golden runner reads it before and after a fill.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PIXELS HAPPEN HERE.
 *
 * A surface's path is normalized (I-1) and stays normalized in storage, in the
 * IPC payload and in every editor edit. This file multiplies by the output size
 * at draw time, once, into a `Graphics` that is rebuilt when the output resizes.
 * There is no pixel value anywhere upstream of `drawMask`, and a mask built at
 * one resolution is discarded rather than scaled.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Graphics } from 'pixi.js';
import type { Path } from '../core/paths';

/**
 * A face's footprint in device pixels: top-left, width, height.
 *
 * Deliberately NOT `PixelRect` (`core/layer.ts`), which is centre-based and
 * carries a rotation. A surface has no stored rotation — the shape is already
 * drawn in the room's coordinates — and the provider contract (I-3) wants a box
 * to draw into, so the top-left form is the honest one here.
 */
export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fewer than three points cannot enclose an area, so there is nothing to clip
 * to: a two-point path masks everything away.
 *
 * A face mid-mark has one or two points, and B3 puts a finger on exactly that
 * path while dragging. So this is a real state, not a corrupt one, and the
 * compositor skips the instance and flags it (I-13) rather than drawing a fill
 * that is invisible for a reason nobody in a dark room can see.
 */
export const MASK_MIN_POINTS = 3;

export function isMaskable(path: Path): boolean {
  return path.points.length >= MASK_MIN_POINTS;
}

/**
 * The path's points as a flat `[x0, y0, x1, y1, ...]` pixel array, which is
 * what `Graphics.poly` takes without allocating a point object per vertex.
 */
export function pathPixelPoints(path: Path, width: number, height: number): number[] {
  const out: number[] = [];
  for (const p of path.points) {
    out.push(p.x * width, p.y * height);
  }
  return out;
}

/**
 * The path's pixel bounding box — I-3's "providers are handed a pixel box".
 *
 * The BOX is what the provider draws into and the MASK is what cuts it to the
 * real outline, which is why a six-point L can be filled by a provider that
 * only knows how to draw into a rectangle. The two must be derived from the
 * same path at the same size or the content slides against its own clip.
 *
 * An empty path has no box; the caller gets a zero box and must not draw it.
 * `isMaskable` is the guard, and it is checked first.
 */
export function pathPixelBounds(path: Path, width: number, height: number): PixelBox {
  if (path.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of path.points) {
    const x = p.x * width;
    const y = p.y * height;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * (Re)draw a face's outline into an existing `Graphics`, in output pixels.
 *
 * Separate from `buildMask` so a resize redraws the mask it already has rather
 * than allocating a new one — the geometry is rebuilt either way, but the
 * `Graphics`, its context and its place in the display list survive, and the
 * container's `mask` reference does not have to be re-set.
 *
 * **Always closed**, whatever the path's `closed` flag says. `closed` decides
 * whether the shape's own outline joins up when it is DRAWN (I-17's "outline"
 * use); a boundary that content is clipped to is an area, and an area is closed
 * or it is not an area. An open path used as a face therefore clips to its
 * implied polygon instead of clipping to nothing.
 *
 * The fill colour is irrelevant to a stencil mask — only coverage is read — and
 * is white at full alpha because a zero-alpha fill records no geometry at all.
 */
export function drawMask(g: Graphics, path: Path, width: number, height: number): Graphics {
  g.clear();
  if (!isMaskable(path)) return g;
  g.poly(pathPixelPoints(path, width, height), true).fill({ color: 0xffffff, alpha: 1 });
  return g;
}

/** One face's mask. See the header: a `Graphics`, never a `Sprite`. */
export function buildMask(path: Path, width: number, height: number): Graphics {
  return drawMask(new Graphics(), path, width, height);
}
