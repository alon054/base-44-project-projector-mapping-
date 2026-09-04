/**
 * I-13's visible placeholder — magenta outline, crossed box, label.
 *
 * "A missing or unreadable asset renders a **visible placeholder** (magenta
 * outline + label) and logs; it never throws into the render loop."
 *
 * Lifted out of `render/compositor.ts` in Phase 3, and the reason is a
 * requirement rather than tidiness. Phase 1's compositor was the only thing
 * that could produce a placeholder, because the only way to fail was to throw
 * out of `create` and be caught by `isolateCreate`. Phase 3 adds a failure that
 * happens *later than create and cannot throw at all*: a video whose decode
 * fails asynchronously, three seconds into a show, on a frame nobody is inside.
 * That view has to draw its own placeholder.
 *
 * The compositor's block comment claimed it was "the only file that knows a
 * placeholder is a magenta outline with a label". Two implementations would
 * have quietly falsified that, and the day they drifted, an operator would be
 * told two different things by the same failure. So there is still exactly one
 * definition; it lives here and the compositor calls it.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { PlaceholderInfo } from '../core/resilience';

export interface PlaceholderGraphic {
  view: Container;
  /** Redraw at a new pixel box. Providers call this from `resize`. */
  draw(width: number, height: number): void;
  destroy(): void;
}

/**
 * Visible is the point. A silently-black layer in a live session is
 * indistinguishable from content that is meant to be black (D1), so the failure
 * has to announce itself in a colour no scene would choose.
 */
export function createPlaceholderGraphic(info: PlaceholderInfo): PlaceholderGraphic {
  const view = new Container();
  const outline = new Graphics();
  const label = new Text({
    text: `${info.layerName} — ${info.providerId}\n${info.reason}`,
    style: {
      fontFamily: 'monospace',
      fontSize: 14,
      fill: 0xff00ff,
      align: 'left',
      wordWrap: true,
      wordWrapWidth: 320,
    },
  });
  view.addChild(outline, label);

  const draw = (w: number, h: number): void => {
    outline
      .clear()
      .rect(0, 0, w, h)
      .stroke({ width: Math.max(2, Math.round(h * 0.008)), color: 0xff00ff, alpha: 0.9 });
    outline.moveTo(0, 0).lineTo(w, h).moveTo(w, 0).lineTo(0, h);
    outline.stroke({ width: Math.max(1, Math.round(h * 0.004)), color: 0xff00ff, alpha: 0.5 });
    label.position.set(Math.min(8, w * 0.05), Math.min(8, h * 0.05));
    label.visible = w > 80 && h > 40;
  };

  return {
    view,
    draw,
    destroy: () => view.destroy({ children: true }),
  };
}
