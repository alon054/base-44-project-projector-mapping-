/**
 * Phase 1's `ContentProvider` (I-3): a few placeholder objects drawn from code.
 *
 * Everything is drawn into the layer's own pixel box, whose size the compositor
 * supplies. Nothing here reads the output resolution and nothing stores a pixel
 * value (I-1) — all internal geometry is a fraction of the box, so a layer
 * looks the same at 1280×720 and at 1920×1080, which is what Gate 1 checks.
 *
 * All randomness comes from the seeded stream in `ctx.rng()` (I-12). There is
 * no `Math.random()` in this directory and a unit test asserts it (CLAUDE.md
 * rule 6).
 */
import { Container, Graphics } from 'pixi.js';
import type {
  ContentProvider,
  LayerFrame,
  LayerView,
  ProviderContext,
} from '../ContentProvider';

export const PROCEDURAL_PROVIDER_ID = 'procedural';

export const PROCEDURAL_KINDS = ['testPattern', 'tree', 'water', 'glow', 'rect', 'fault'] as const;
export type ProceduralKind = (typeof PROCEDURAL_KINDS)[number];

export function isProceduralKind(v: unknown): v is ProceduralKind {
  return typeof v === 'string' && (PROCEDURAL_KINDS as readonly string[]).includes(v);
}

export class ProceduralProvider implements ContentProvider {
  readonly id = PROCEDURAL_PROVIDER_ID;

  create(ctx: ProviderContext): LayerView {
    const kind = ctx.content['kind'];
    if (!isProceduralKind(kind)) {
      throw new Error(
        `unknown procedural kind: ${JSON.stringify(kind)} (expected one of ${PROCEDURAL_KINDS.join(', ')})`,
      );
    }
    switch (kind) {
      case 'testPattern':
        return new TestPatternView(ctx);
      case 'tree':
        return new TreeView(ctx);
      case 'water':
        return new WaterView(ctx);
      case 'glow':
        return new GlowView(ctx);
      case 'rect':
        return new RectView(ctx);
      case 'fault':
        return new FaultView(ctx);
    }
  }
}

/** Shared plumbing: a container, a pixel box, and redraw-on-resize. */
abstract class BaseView implements LayerView {
  readonly view = new Container();
  protected w: number;
  protected h: number;

  constructor(ctx: ProviderContext) {
    this.w = ctx.width;
    this.h = ctx.height;
  }

  resize(width: number, height: number): void {
    if (width === this.w && height === this.h) return;
    this.w = width;
    this.h = height;
    this.redraw();
  }

  abstract update(frame: LayerFrame): void;
  protected abstract redraw(): void;

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

/**
 * Phase 0's test pattern, absorbed (CLAUDE.md session note 1). `render/testPattern.ts`
 * is deleted in the same commit rather than kept as a second drawing path.
 */
class TestPatternView extends BaseView {
  private readonly grid = new Graphics();
  private readonly sweep = new Graphics();
  private readonly cross = new Graphics();
  private readonly cells: number;

  constructor(ctx: ProviderContext) {
    super(ctx);
    const cells = ctx.content['cells'];
    this.cells = typeof cells === 'number' && cells >= 1 ? Math.floor(cells) : 8;
    this.view.addChild(this.grid, this.sweep, this.cross);
    this.redraw();
  }

  protected redraw(): void {
    const { w, h, cells } = this;
    // Stroke width derives from the box height, never a constant — a constant
    // tuned at DEV_RESOLUTION comes out a third as thick at TARGET_RESOLUTION.
    const thin = Math.max(1, Math.round(h * 0.0015));
    const g = this.grid.clear();
    for (let i = 0; i <= cells; i++) {
      const t = i / cells;
      g.moveTo(t * w, 0).lineTo(t * w, h);
      g.moveTo(0, t * h).lineTo(w, t * h);
    }
    g.stroke({ width: thin, color: 0x2a6b52, alpha: 0.85 });
    // Edge frame, so "is the whole panel visible" is answerable from the wall.
    g.rect(0, 0, w, h).stroke({ width: thin * 3, color: 0xff00ff, alpha: 0.9 });
  }

  update(frame: LayerFrame): void {
    const { w, h } = this;
    if (w === 0 || h === 0) return;
    const phase = frame.phase;

    const x = phase * w;
    this.sweep
      .clear()
      .rect(x - w * 0.01, 0, w * 0.02, h)
      .fill({ color: 0x40e0ff, alpha: 0.95 });

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
}

/** Branch geometry, drawn once from the layer's seeded stream (I-12). */
interface Branch {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
}

class TreeView extends BaseView {
  private readonly g = new Graphics();
  private readonly branches: Branch[] = [];
  private readonly tint: number;

  constructor(ctx: ProviderContext) {
    super(ctx);
    const tint = ctx.content['tint'];
    this.tint = typeof tint === 'number' ? tint >>> 0 : 0x6b4a2f;
    // Geometry is normalized: generated once, scaled at draw. Regenerating it
    // on resize would consume the stream again and give a different tree at a
    // different resolution, which is the I-12 violation SPEC.md §11 Phase 4
    // names for particle counts.
    this.grow(ctx);
    this.view.addChild(this.g);
    this.redraw();
  }

  private grow(ctx: ProviderContext): void {
    const rng = ctx.rng('branches');
    const depth = 6;
    const walk = (x: number, y: number, angle: number, length: number, level: number): void => {
      if (level > depth || length < 0.005) return;
      const x1 = x + Math.cos(angle) * length * 0.6;
      const y1 = y + Math.sin(angle) * length;
      this.branches.push({
        x0: x,
        y0: y,
        x1,
        y1,
        width: Math.max(0.002, 0.02 * (1 - level / (depth + 1))),
      });
      const spread = rng.range(0.35, 0.75);
      const shrink = rng.range(0.62, 0.78);
      walk(x1, y1, angle - spread, length * shrink, level + 1);
      walk(x1, y1, angle + spread, length * shrink, level + 1);
    };
    // Up is -y. Root at the bottom centre of the layer box.
    walk(0.5, 1, -Math.PI / 2, 0.32, 0);
  }

  protected redraw(): void {
    const { w, h } = this;
    const g = this.g.clear();
    for (const b of this.branches) {
      g.moveTo(b.x0 * w, b.y0 * h).lineTo(b.x1 * w, b.y1 * h);
      g.stroke({ width: Math.max(1, b.width * h), color: this.tint, alpha: 0.95 });
    }
  }

  update(): void {
    // Static in Phase 1. Wind sway arrives in Phase 4 (I-4), driven by the
    // global clock (I-2), not by anything this view counts for itself.
  }
}

class WaterView extends BaseView {
  private readonly g = new Graphics();
  private readonly bands: { y: number; amp: number; speed: number; alpha: number }[] = [];
  private readonly tint: number;

  constructor(ctx: ProviderContext) {
    super(ctx);
    const tint = ctx.content['tint'];
    this.tint = typeof tint === 'number' ? tint >>> 0 : 0x1d5f7a;
    const count = numberOr(ctx.content['bands'], 14, 1, 200);
    const rng = ctx.rng('bands');
    for (let i = 0; i < count; i++) {
      this.bands.push({
        y: (i + 0.5) / count,
        amp: rng.range(0.004, 0.018),
        speed: rng.range(0.5, 2.2),
        alpha: rng.range(0.25, 0.7),
      });
    }
    this.view.addChild(this.g);
  }

  protected redraw(): void {
    // Redrawn every frame anyway; nothing cached against the box size.
  }

  update(frame: LayerFrame): void {
    const { w, h } = this;
    if (w === 0 || h === 0) return;
    const g = this.g.clear();
    const steps = 24;
    for (const band of this.bands) {
      const a = frame.phase * Math.PI * 2 * band.speed;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = (band.y + Math.sin(a + t * Math.PI * 4) * band.amp) * h;
        if (i === 0) g.moveTo(0, y);
        else g.lineTo(t * w, y);
      }
      g.stroke({ width: Math.max(1, h * 0.004), color: this.tint, alpha: band.alpha });
    }
  }
}

/**
 * I-6's demonstration object. Concentric rings of falling alpha rather than a
 * gradient fill: it is exact, cheap, and on `add` over a dark background it
 * visibly brightens whatever is under it, which is Gate 1's first condition.
 */
class GlowView extends BaseView {
  private readonly g = new Graphics();
  private readonly rings: number;
  private readonly tint: number;

  constructor(ctx: ProviderContext) {
    super(ctx);
    const tint = ctx.content['tint'];
    this.tint = typeof tint === 'number' ? tint >>> 0 : 0xffb040;
    this.rings = numberOr(ctx.content['rings'], 20, 2, 128);
    this.view.addChild(this.g);
    this.redraw();
  }

  protected redraw(): void {
    const { w, h } = this;
    const g = this.g.clear();
    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxR = Math.min(w, h) * 0.5;
    for (let i = this.rings; i >= 1; i--) {
      const t = i / this.rings;
      g.circle(cx, cy, maxR * t).fill({ color: this.tint, alpha: 0.05 * (1 - t) + 0.01 });
    }
  }

  update(): void {
    // Static in Phase 1.
  }
}

/**
 * A flat opaque fill. Deliberately the dullest object here, and the only one
 * that makes occlusion unambiguous: every other procedural object is either
 * translucent or mostly empty, so "is this layer on top" becomes a judgement
 * about alpha rather than a fact about order. Gate 1 asks whether reordering
 * changes occlusion *correctly*, which needs something that actually covers.
 */
class RectView extends BaseView {
  private readonly g = new Graphics();
  private readonly tint: number;

  constructor(ctx: ProviderContext) {
    super(ctx);
    const tint = ctx.content['tint'];
    this.tint = typeof tint === 'number' ? tint >>> 0 : 0xffffff;
    this.view.addChild(this.g);
    this.redraw();
  }

  protected redraw(): void {
    this.g.clear().rect(0, 0, this.w, this.h).fill({ color: this.tint, alpha: 1 });
  }

  update(): void {
    // Static in Phase 1.
  }
}

/**
 * I-13's fixture, and Gate 1's last condition: "a provider that throws produces
 * a placeholder layer, not a blank frame". It lives here rather than in a test
 * file because the gate is checked on a wall, so the operator needs to be able
 * to add a failing layer to a real scene.
 */
class FaultView extends BaseView {
  constructor(ctx: ProviderContext) {
    super(ctx);
    if (ctx.content['when'] !== 'update') {
      throw new Error('procedural fault fixture: deliberate failure at create (I-13)');
    }
  }

  protected redraw(): void {}

  update(): void {
    throw new Error('procedural fault fixture: deliberate failure at update (I-13)');
  }
}

function numberOr(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}
