/**
 * D11. The preview's scene-space grid.
 *
 * The preview is scene space, pre-warp — placement here happens in the same
 * normalized coordinates the output composites in, and the forward warp carries
 * a scene point to its physical spot on the wall. Without a grid the preview
 * reads as a small photograph of the projection, and an operator who believes
 * that reaches for the corner of the *image* rather than the corner of the
 * *frame*. The grid is the cheapest way to say "this rectangle is [0,1] × [0,1]"
 * before the first placement rather than after the first surprise.
 *
 * Pure geometry, normalized (I-1). Nothing here knows the preview is 480 px
 * wide; the multiplication happens in the SVG and nowhere else.
 *
 * **Cells are not square, and that is the point.** Scene space is normalized on
 * both axes, so an eighth of the width and an eighth of the height are the same
 * number and different distances on a 16:9 frame. A grid drawn in square pixel
 * cells would be a prettier picture of the wrong space.
 */

/** How a line is drawn. `centre` is 0.5; `major` is a quarter; everything else. */
export type GridWeight = 'centre' | 'major' | 'minor';

export interface GridLine {
  axis: 'x' | 'y';
  /** Normalized position along that axis, strictly inside (0, 1). */
  at: number;
  weight: GridWeight;
}

/** Divisions per axis. Eight puts a line on every quarter and every eighth. */
export const GRID_DIVISIONS = 8;

/**
 * The interior lines of an `n`-by-`n` normalized grid, x lines then y lines.
 *
 * The frame edge (0 and 1) is NOT in the list: the preview's own border already
 * draws it, and a line at 0 would be a half-width line clipped by the canvas
 * edge rather than the boundary it is trying to show.
 *
 * Refuses a division count it cannot draw, naming it — an unusable `n` is a
 * caller bug, not float drift, and P5-A settled that those get refused rather
 * than clamped.
 */
export function gridLines(divisions: number = GRID_DIVISIONS): GridLine[] {
  if (!Number.isInteger(divisions) || divisions < 2) {
    throw new RangeError(`grid divisions must be an integer >= 2, got ${divisions}`);
  }
  const lines: GridLine[] = [];
  for (const axis of ['x', 'y'] as const) {
    for (let i = 1; i < divisions; i += 1) {
      const at = i / divisions;
      lines.push({ axis, at, weight: weightAt(at) });
    }
  }
  return lines;
}

/**
 * Exact comparison, and it is exact on purpose.
 *
 * The first version compared with a 1e-9 tolerance, against `i / divisions`
 * being a float. It is a float, but not an inexact one here: a quarter line
 * exists only when `divisions` is `4m`, and `m / 4m` is the correctly-rounded
 * form of a quotient that is exactly representable — so it lands on 0.25
 * whatever `m` is, 3/12 and 5/20 alike. The tolerance could therefore never be
 * the reason for an answer. Replacing it with `===` killed no test, because no
 * input tells the two apart; that is the same class of thing as a guard nothing
 * can trip, and it is gone for the same reason.
 */
function weightAt(at: number): GridWeight {
  if (at === 0.5) return 'centre';
  if (at === 0.25 || at === 0.75) return 'major';
  return 'minor';
}
