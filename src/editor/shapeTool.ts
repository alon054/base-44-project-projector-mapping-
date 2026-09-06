/**
 * Drag out a face instead of clicking its corners — Photoshop's shape tools,
 * for a room.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A GENERATOR, NOT FOUR SHAPE KINDS.
 *
 * `generateShape` runs ONCE, at the moment the pointer is released, and its
 * output is a plain I-17 `Path` — the same object the pen tool produces, the
 * same object `calibration/surfaces.json` stores, the same object the mask is
 * built from. **Nothing anywhere records that a face was born a rectangle.**
 * There is no `kind` field on `Surface`, none on `Path`, and none is coming:
 * once the generator has run, a rect, a triangle, an ellipse and a hand-drawn
 * outline are indistinguishable, and every one of them is edited by exactly the
 * same three gestures — drag a point, delete a point, insert a point.
 *
 * That is the whole design, and it is what keeps this cheap. A stored shape kind
 * would mean a rect that must stay rectangular, which means bounds, which means
 * an anchor, which means scale handles, which means rotation, which means a
 * transform stack in the one file that must never grow one. A generated shape
 * has none of that: it is four points, and they are just points.
 *
 * WHY DRAG-TO-CREATE, AND WHY THERE ARE NO HANDLES.
 *
 * A shape born at the right size never needs resizing. Press at one corner of
 * the face, drag to the opposite one, release — and the outline is already
 * roughly on the box, needing only its points nudged. The alternative is to drop
 * a fixed-size shape and then scale it, which needs a bounding box, eight
 * handles, a rotation grip and an origin, all of which must then be hit-tested
 * against the point handles that are already there. **None of that is built and
 * none of it should be.** Dragging individual points is the only transform, and
 * for putting an outline on a physical box it is not merely enough, it is the
 * one that maps to what the builder is actually doing.
 *
 * ELLIPSE IS 32 POINTS, WHICH IS A DECISION AND NOT A DEFAULT.
 *
 * A projected ellipse edge is judged by eye at three metres against a real
 * curved surface. 32 segments put the worst-case chord error under a tenth of a
 * percent of the radius, which is well inside a projector pixel at 1280x720 —
 * and 32 points is still a list a builder can drag individual anchors out of
 * without hunting. It is stored as 32 literal points because I-17 has one
 * representation and a "circle" that stored a centre and a radius would be a
 * second one, needing its own mask path, its own hit test and its own editing
 * rules.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createPath, type Path, type PathPoint } from '../core/paths';
import type { NormalizedPoint } from './interaction';

/**
 * How a new face is drawn. `pen` is the existing `pathTool` — it is in this list
 * so the picker has one vocabulary, not because it generates anything.
 */
export const SURFACE_MODES = ['rect', 'triangle', 'ellipse', 'pen'] as const;
export type SurfaceMode = (typeof SURFACE_MODES)[number];

/** The modes `generateShape` actually produces geometry for. */
export type GeneratedMode = Exclude<SurfaceMode, 'pen'>;

export function isGeneratedMode(mode: SurfaceMode): mode is GeneratedMode {
  return mode !== 'pen';
}

/** Operator-facing, for the picker. Never an identifier. */
export const SURFACE_MODE_LABELS: Record<SurfaceMode, string> = {
  rect: 'Rect',
  triangle: 'Triangle',
  ellipse: 'Ellipse',
  pen: 'Pen',
};

/** See this file's header. Not a tuning knob — a measured sufficiency. */
export const ELLIPSE_POINTS = 32;

/**
 * The smallest drag that makes a face, per axis, normalized (I-1).
 *
 * A press that never travelled is "never mind", not a face one pixel across:
 * `generateShape` returns `null` and nothing is banked. Refused rather than
 * clamped up to a minimum, because a degenerate drag is the operator changing
 * their mind — and silently inventing a face they did not draw is A9's
 * plausible wrong answer, on a list they would then have to find and delete.
 *
 * Equal to `MIN_LAYER_EXTENT` by value and not by import: that constant is the
 * smallest a CONTENT region may be scaled to, which is a different question
 * about a different tree that happens to have the same answer today.
 */
export const MIN_SHAPE_EXTENT = 0.02;

/** The drag in flight. Editor state; never stored, never sent. */
export interface ShapeDraft {
  mode: GeneratedMode;
  /** Where the pointer went down. */
  origin: NormalizedPoint;
  /** Where it is now. */
  current: NormalizedPoint;
}

/** The axis-aligned box two drag corners describe. Order-independent. */
export function draftBounds(draft: ShapeDraft): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const { origin: a, current: b } = draft;
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** Whether this drag has gone far enough to be a face. See `MIN_SHAPE_EXTENT`. */
export function isDraftPlaceable(draft: ShapeDraft): boolean {
  const b = draftBounds(draft);
  return b.maxX - b.minX >= MIN_SHAPE_EXTENT && b.maxY - b.minY >= MIN_SHAPE_EXTENT;
}

/**
 * The generator. One drag, one `Path`, and then it is out of the picture.
 *
 * Every mode returns a **closed** path, because every one of them encloses an
 * area and `closed` is I-17's word for exactly that. A face is an area; the pen
 * is the only way to make an open outline, and that is a route, not a face.
 *
 * Winding is clockwise in screen space (y down) for all three, so the point
 * order a builder sees when they select a face is the same order whichever tool
 * drew it. Nothing depends on the winding — `drawMask` closes the polygon
 * whatever it is given — but two tools that disagreed about it would be two
 * behaviours to learn for no reason.
 *
 * Returns `null` for a drag too small to be meant, and for `pen`, which has no
 * geometry to generate.
 */
export function generateShape(
  mode: SurfaceMode,
  draft: ShapeDraft,
  id: string,
): Path | null {
  if (!isGeneratedMode(mode) || !isDraftPlaceable(draft)) return null;
  const b = draftBounds(draft);
  const points = pointsFor(mode, b);
  // Through `createPath`, so a generated path takes the same clamp and the same
  // validation every other path source does (I-1). A generator that wrote its
  // own point objects would be a second way for an out-of-range coordinate to
  // reach the room.
  return createPath({ id, points, closed: true });
}

function pointsFor(
  mode: GeneratedMode,
  b: { minX: number; minY: number; maxX: number; maxY: number },
): PathPoint[] {
  switch (mode) {
    case 'rect':
      return [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ];
    case 'triangle':
      // Apex at the top centre, base along the bottom of the drag — the shape
      // the drag box implies, so the outline lands where the pointer said.
      return [
        { x: (b.minX + b.maxX) / 2, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ];
    case 'ellipse': {
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const rx = (b.maxX - b.minX) / 2;
      const ry = (b.maxY - b.minY) / 2;
      const points: PathPoint[] = [];
      for (let i = 0; i < ELLIPSE_POINTS; i += 1) {
        // Starting at the top (-90 degrees) and increasing, which is clockwise
        // on a y-down canvas — the same winding as the two above.
        const t = -Math.PI / 2 + (i / ELLIPSE_POINTS) * Math.PI * 2;
        points.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
      }
      return points;
    }
  }
}
