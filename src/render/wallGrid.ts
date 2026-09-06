/**
 * The white reference grid on the projection — MadMapper's, for this engine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHY IT IS NOT A BREACH OF HARD RULE 9.
 *
 * CLAUDE.md's rule 9 says nothing the builder sees in the PREVIEW may reach the
 * output window, and names the three things it is about: the grid overlay, the
 * selection outline and the live path preview. Those are SVG siblings of the
 * preview canvas, held out of the projector by an import graph — `output/main.ts`
 * and `golden/main.ts` cannot load `editor/PreviewCanvas.tsx`, and a test
 * asserts it.
 *
 * **That guard is untouched and still passes.** This is not the preview's
 * overlay arriving on the wall; it could not be, because an SVG sibling is not
 * in the Pixi scene graph and there is no path along which it could become one.
 * This is a separate pattern, drawn by the OUTPUT window into its own composite,
 * from a boolean the operator toggles. No pixels cross a process boundary (I-7),
 * and the editor's overlay remains structurally unable to reach the projector.
 *
 * What genuinely changes is rule 9's *spirit*: there can now be deliberate guide
 * lines on the projection. That is the operator's call — they asked for it, and
 * every projection-mapping tool has one, because aligning a normalized frame to
 * a physical box by eye without a reference is guesswork. Three things make it
 * safe to have:
 *
 *  - **OFF by default, every launch, and not persisted.** Deliberately unlike
 *    the HUD, which `config/` remembers. A grid remembered from yesterday is a
 *    grid in tomorrow's first take, and "a guide line on the projection is a
 *    re-shoot" is still true.
 *  - **It logs.** `[grid] ON` / `[grid] off` goes to the run log beside
 *    `[scene] applied` and `[warp]`, so a take shot with it up is answerable
 *    from the log rather than from an argument about a video.
 *  - **The golden harness never enables it**, and a test says so, so no blessed
 *    frame can contain it.
 *
 * WHY IT IS DRAWN PRE-WARP.
 *
 * It is a child of the compositor's view, so it goes through the warp mesh
 * exactly as content does. That is the whole point: the grid then shows where
 * *scene space* lands on the wall, which is the question the builder is actually
 * asking — "if I put a surface at 0.25, 0.5 in the preview, where is that on the
 * box?" A grid drawn after the warp would describe the projector's raster and
 * answer a question nobody has.
 *
 * WHY IT DRAWS THE FRAME EDGE AND THE PREVIEW'S GRID DOES NOT.
 *
 * `editor/grid.ts` omits 0 and 1 on purpose — the preview canvas has a CSS
 * border that already draws them, and a line at 0 would be half-clipped. On a
 * wall there is no border, and the frame edge is the single most useful line
 * there is: it is what W1 warps to the box. So it is drawn here, brightest.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The divisions come from `editor/grid.ts` rather than being restated, so the
 * preview's grid and the wall's grid are the SAME lines and a builder can read
 * one against the other. That module is pure normalized geometry that "knows
 * nothing about the preview" by its own header — it is misnamed rather than
 * misplaced, and `core/` is where it should eventually live. Logged rather than
 * moved, because it shipped in a passed phase.
 */
import { Graphics } from 'pixi.js';
import { gridLines, type GridWeight } from '../editor/grid';

/**
 * Line weights, in projector pixels.
 *
 * Thin, and thinner than feels right on a monitor: this is judged at three
 * metres on a textured surface, where a 2 px white line blooms and a 1 px one
 * reads as a line. The frame edge gets the extra pixel because it is the one
 * being aligned to something physical.
 */
const EDGE_WIDTH = 2;
const LINE_WIDTH = 1;

/**
 * White, at three brightnesses.
 *
 * Not full white for the interior lines. The grid shares a projection with
 * content the builder is trying to judge, and a grid as bright as the fill
 * competes with the thing it is there to help place.
 */
const ALPHA: Record<GridWeight | 'edge', number> = {
  edge: 0.95,
  centre: 0.75,
  major: 0.5,
  minor: 0.25,
};

const WHITE = 0xffffff;

/**
 * Draw the grid into `g`, in output pixels.
 *
 * Normalized positions become pixels here and nowhere else (I-1) — the same
 * contract `mask.ts` and `toPixelCorners` hold, so the grid means the same thing
 * at 1280x720 as it does at any other output size.
 *
 * Clears first, so this is also the resize path: a grid that scaled the pixels
 * it already had would drift off the frame it is describing.
 */
export function drawWallGrid(g: Graphics, width: number, height: number): Graphics {
  g.clear();

  for (const line of gridLines()) {
    const alpha = ALPHA[line.weight];
    if (line.axis === 'x') {
      const x = line.at * width;
      g.moveTo(x, 0).lineTo(x, height);
    } else {
      const y = line.at * height;
      g.moveTo(0, y).lineTo(width, y);
    }
    g.stroke({ color: WHITE, width: LINE_WIDTH, alpha });
  }

  // The frame edge last, so it draws over every interior line that meets it.
  // Inset by half a stroke, or the outer half of it falls outside the composite
  // and the builder aligns the box to a line that is one pixel thinner on two
  // sides than on the other two.
  const half = EDGE_WIDTH / 2;
  g.rect(half, half, width - EDGE_WIDTH, height - EDGE_WIDTH);
  g.stroke({ color: WHITE, width: EDGE_WIDTH, alpha: ALPHA.edge });

  return g;
}
