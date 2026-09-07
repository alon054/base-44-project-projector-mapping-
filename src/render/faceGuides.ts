/**
 * W1 fix — a white guide grid on every marked face, on the projection.
 *
 * The builder's W1 note, in their words: "when I create a new surface for
 * animation I want to see where I put her with a grid like the one that is
 * now, but also for the small layers." The wall grid (`wallGrid.ts`) answers
 * "where is scene space on the wall"; it does not answer "where is THIS face",
 * and until now the only way to see a face on the wall was to give it a white
 * fill — a content layer standing in for a calibration aid.
 *
 * This is that aid, drawn as a guide: the face's outline, bright, plus a 4×4
 * grid over its bounding box, clipped to the face by the same mask the fills
 * use (`mask.ts`), so a triangle shows a triangle's worth of grid. Guides,
 * not content: they live beside the wall grid in the compositor, follow its
 * ONE toggle and its `[grid]` log line, go through the warp exactly as content
 * does (drawn pre-warp), and the golden harness never enables them, so no
 * blessed frame can contain one. Hard rule 9's argument in `wallGrid.ts`
 * applies unchanged — and so does its warning: **guides on the projection are
 * a re-shoot.** The toggle is for the take.
 *
 * Normalized positions become pixels here and nowhere else (I-1). Redrawn from
 * the path on every room write and on resize — never scaled, for the reason
 * `reshapeFill` gives: a guide that remembered where it used to be would sit
 * half a face out.
 */
import { Container, Graphics } from 'pixi.js';
import type { Path } from '../core/paths';
import type { SurfaceTree } from '../core/surfaces';
import { buildMask, isMaskable, pathPixelBounds, pathPixelPoints } from './mask';

const WHITE = 0xffffff;
const OUTLINE_WIDTH = 2;
const OUTLINE_ALPHA = 0.95;
const LINE_WIDTH = 1;
const LINE_ALPHA = 0.45;
/** Divisions of the face's bounding box, each axis. Four reads as a grid, not a mess, at three metres. */
export const FACE_GRID_DIVISIONS = 4;

/** One face's guide, into `g`, in output pixels. Clears first (the resize path). */
export function drawFaceGuide(g: Graphics, path: Path, width: number, height: number): Graphics {
  g.clear();
  if (!isMaskable(path)) return g;
  const box = pathPixelBounds(path, width, height);
  for (let i = 1; i < FACE_GRID_DIVISIONS; i++) {
    const t = i / FACE_GRID_DIVISIONS;
    const x = box.x + box.width * t;
    const y = box.y + box.height * t;
    g.moveTo(x, box.y).lineTo(x, box.y + box.height);
    g.moveTo(box.x, y).lineTo(box.x + box.width, y);
  }
  g.stroke({ color: WHITE, width: LINE_WIDTH, alpha: LINE_ALPHA });
  // The outline last and brightest: it is the line being aligned to cardboard.
  g.poly(pathPixelPoints(path, width, height), true);
  g.stroke({ color: WHITE, width: OUTLINE_WIDTH, alpha: OUTLINE_ALPHA });
  return g;
}

/**
 * Rebuild every face guide under `root` for the current room. One child per
 * maskable face: a container holding the guide and masked by the face. The
 * previous children are destroyed, not reused — a room write is operator-paced
 * (a pointer sample at most), and this allocates nothing per frame (A14).
 */
export function drawFaceGuides(root: Container, surfaces: SurfaceTree, width: number, height: number): void {
  for (const child of root.removeChildren()) child.destroy({ children: true });
  for (const surface of surfaces) {
    if (!isMaskable(surface.path)) continue;
    const holder = new Container();
    holder.label = `guide:${surface.id}`;
    const mask = buildMask(surface.path, width, height);
    holder.addChild(mask);
    holder.mask = mask;
    holder.addChild(drawFaceGuide(new Graphics(), surface.path, width, height));
    root.addChild(holder);
  }
}
