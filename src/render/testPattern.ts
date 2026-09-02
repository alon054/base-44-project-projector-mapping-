/**
 * Phase 0 test pattern. THROWAWAY — absorbed by `compositor.ts` in Phase 1.
 *
 * Everything here is positioned in normalized [0,1] space and multiplied by the
 * render size at draw time only (I-1). No pixel value is stored.
 */
import { Container, Graphics } from 'pixi.js';

const GRID = 8;

export class TestPattern {
  readonly view = new Container();
  private readonly grid = new Graphics();
  private readonly sweep = new Graphics();
  private readonly cross = new Graphics();
  private w = 0;
  private h = 0;

  constructor() {
    this.view.addChild(this.grid, this.sweep, this.cross);
  }

  resize(width: number, height: number): void {
    if (width === this.w && height === this.h) return;
    this.w = width;
    this.h = height;
    this.drawGrid();
  }

  /** `phase` is a normalized [0,1) position in the loop, from the host clock. */
  update(phase: number): void {
    const { w, h } = this;
    if (w === 0 || h === 0) return;

    // A hard-edged sweeping bar: the fastest way for an eye to see a speed
    // change land, which is what Gate 0's latency check is looking at.
    const x = phase * w;
    this.sweep
      .clear()
      .rect(x - w * 0.01, 0, w * 0.02, h)
      .fill({ color: 0x40e0ff, alpha: 0.95 });

    // A rotating cross at the centre, so direction of travel is unambiguous.
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = Math.min(w, h) * 0.18;
    const a = phase * Math.PI * 2;
    this.cross
      .clear()
      .moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      .lineTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r)
      .moveTo(cx + Math.cos(a + Math.PI / 2) * r, cy + Math.sin(a + Math.PI / 2) * r)
      .lineTo(cx - Math.cos(a + Math.PI / 2) * r, cy - Math.sin(a + Math.PI / 2) * r)
      .stroke({ width: Math.max(1, Math.round(h * 0.004)), color: 0xffffff, alpha: 0.9 });
  }

  private drawGrid(): void {
    const { w, h } = this;
    // Stroke width is derived from render height, never a constant — a constant
    // tuned at DEV_RESOLUTION would come out a third as thick at
    // TARGET_RESOLUTION (SPEC.md §4's two resolutions).
    const thin = Math.max(1, Math.round(h * 0.0015));
    const g = this.grid.clear();
    for (let i = 0; i <= GRID; i++) {
      const t = i / GRID;
      g.moveTo(t * w, 0).lineTo(t * w, h);
      g.moveTo(0, t * h).lineTo(w, t * h);
    }
    g.stroke({ width: thin, color: 0x2a6b52, alpha: 0.85 });
    // Edge frame, so "is the whole panel visible" is answerable from the wall.
    g.rect(0, 0, w, h).stroke({ width: thin * 3, color: 0xff00ff, alpha: 0.9 });
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
