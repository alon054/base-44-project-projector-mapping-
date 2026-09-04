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
import type { JsonObject } from '../../core/layer';
import type {
  ContentParamSpec,
  ContentProvider,
  LayerFrame,
  LayerView,
  ProviderContext,
} from '../ContentProvider';

export const PROCEDURAL_PROVIDER_ID = 'procedural';

export const PROCEDURAL_KINDS = ['testPattern', 'tree', 'water', 'glow', 'rect', 'rain', 'fault'] as const;
export type ProceduralKind = (typeof PROCEDURAL_KINDS)[number];

export function isProceduralKind(v: unknown): v is ProceduralKind {
  return typeof v === 'string' && (PROCEDURAL_KINDS as readonly string[]).includes(v);
}

/**
 * Structural keys: they select WHICH object a layer is, not a value on it.
 * `kind` is excluded because changing it does not modulate the layer, it
 * replaces it — that is an edit to the scene, not a parameter to map a knob to.
 * `when` is the I-13 fault fixture's switch and is the same kind of thing.
 * Everything else a provider reads MUST be declared (rule 9), and a unit test
 * greps this file to enforce it.
 */
const STRUCTURAL_CONTENT_KEYS = ['kind', 'when'] as const;

export class ProceduralProvider implements ContentProvider {
  readonly id = PROCEDURAL_PROVIDER_ID;

  contentParameters(content: JsonObject): ContentParamSpec[] {
    const kind = content['kind'];
    // Every kind carries a tint; the rest depend on what is being drawn.
    const tint: ContentParamSpec = {
      key: 'tint',
      label: 'Tint',
      kind: 'number',
      default: 0xffffff,
      min: 0,
      max: 0xffffff,
      step: 1,
    };
    switch (kind) {
      case 'water':
        return [
          tint,
          { key: 'bands', label: 'Bands', kind: 'number', default: 14, min: 1, max: 200, step: 1 },
          {
            key: 'bodyAlpha',
            label: 'Body alpha',
            kind: 'number',
            default: 0.72,
            min: 0,
            max: 1,
            step: 0.01,
          },
        ];
      case 'glow':
        return [
          tint,
          { key: 'rings', label: 'Rings', kind: 'number', default: 20, min: 2, max: 128, step: 1 },
        ];
      case 'testPattern':
        return [
          tint,
          { key: 'cells', label: 'Cells', kind: 'number', default: 8, min: 1, max: 64, step: 1 },
        ];
      case 'rain':
        return [
          tint,
          // **A8 / I-12.** `drops` is scene state and is NOT derived from the
          // output's pixel area. SPEC.md §11 Phase 4 is explicit: 1080p has
          // 2.25x the pixels of 720p, so a count derived from area would make
          // the same seed and the same state produce 2.25x the drops and a
          // different intended look at a different resolution. Only the drops'
          // POSITIONS and SIZES come from the box, via I-1.
          { key: 'drops', label: 'Drops', kind: 'number', default: 220, min: 1, max: 2000, step: 1 },
          {
            key: 'length',
            label: 'Drop length',
            kind: 'number',
            default: 0.045,
            min: 0.005,
            max: 0.3,
            step: 0.005,
          },
          {
            key: 'fallRate',
            label: 'Fall rate',
            kind: 'number',
            default: 0.9,
            min: 0.05,
            max: 4,
            step: 0.01,
          },
        ];
      case 'tree':
      case 'rect':
        return [tint];
      default:
        return [];
    }
  }

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
      case 'rain':
        return new RainView(ctx);
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
    // Still nothing per frame, and in Phase 4 that is the POINT rather than an
    // omission. The tree sways because the compositor applies the force bus's
    // `offsetX`/`offsetY`/`rotate` axes to its holder (I-4) — this provider
    // does not know that wind exists, has no susceptibility logic in it, and
    // did not change when forces arrived. That is what "forces are broadcast"
    // buys: the mechanism is in one place and every entity gets it for free.
  }
}

/**
 * A body of water: a filled surface with ripple lines on it.
 *
 * The fill is not decoration. Without it this layer was ripple lines and
 * nothing else — thin, translucent, and drawn on black — so it could not
 * occlude anything, and moving it through the draw order changed the frame by
 * 0.5% of mean luminance. The operator reported "everything reorders except
 * the water" twice, and both times the ordering was provably correct and the
 * object simply had nothing to show it with. A placeholder object that cannot
 * demonstrate the invariant it sits under is the wrong placeholder.
 */
class WaterView extends BaseView {
  private readonly g = new Graphics();
  private readonly bands: { y: number; amp: number; speed: number; alpha: number }[] = [];
  private readonly tint: number;
  private readonly bodyAlpha: number;

  constructor(ctx: ProviderContext) {
    super(ctx);
    const tint = ctx.content['tint'];
    this.tint = typeof tint === 'number' ? tint >>> 0 : 0x1d5f7a;
    const bodyAlpha = ctx.content['bodyAlpha'];
    this.bodyAlpha =
      typeof bodyAlpha === 'number' && bodyAlpha >= 0 && bodyAlpha <= 1 ? bodyAlpha : 0.72;
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

    // The surface itself, under the ripples. Dark enough to stay in D1's
    // additive world — on a projector this reads as water rather than as a
    // panel of paint — and opaque enough that what is behind it is behind it.
    if (this.bodyAlpha > 0) {
      g.rect(0, 0, w, h).fill({ color: this.tint, alpha: this.bodyAlpha });
    }

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

/** One drop's geometry, normalized and generated once (I-1, I-12). */
interface Drop {
  /** Column, [0, 1) of the box width. */
  x: number;
  /** Where in its fall this drop starts, [0, 1). Keeps drops out of lockstep. */
  phase: number;
  /** Per-drop speed multiplier — near drops fall faster than distant ones. */
  speed: number;
  /** Length multiplier on the layer's `length`, giving depth within the sheet. */
  scale: number;
  alpha: number;
}

/**
 * Rain — the **entity** half of the `rain` force (Phase 4).
 *
 * A force maps parameters onto the axis vocabulary; it cannot create geometry.
 * The `rain` force definition therefore contributes only the wetness tint, and
 * the drops live here, as content that reads the force's raw parameters off
 * `frame.forces`. That is what `LayerFrame.forces` is for.
 *
 * Three constraints this view is built around, all of them named in SPEC.md:
 *
 * **A8 — density is scene state.** The drop COUNT comes from
 * `content.drops`. Nothing here reads the output resolution to decide how many
 * of anything to draw. Only positions and stroke widths derive from the box
 * (I-1), so the same scene at 1080p is the same rain, larger.
 *
 * **I-2 — position is derived from clock time, never accumulated.** A drop's
 * height is `frac(phase + t * rate)`. There is no per-drop state that a scrub
 * could fail to update, so scrubbing lands the rain exactly where that time
 * landed before, the same way Gate 3's sprite loops do.
 *
 * **The strokes are deliberately thick.** Gate 2 established, and Phase 3
 * confirmed, that the blur on the wall is CONTENT and not the projector: thin
 * strokes, translucent lines and soft gradients are what read as soft. Rain is
 * exactly that content, so the drop width is floored at 2 px and scaled from
 * the box rather than left at a hairline.
 */
class RainView extends BaseView {
  private readonly g = new Graphics();
  private readonly drops: Drop[] = [];
  private readonly tint: number;
  private readonly length: number;
  private readonly fallRate: number;

  constructor(ctx: ProviderContext) {
    super(ctx);
    const tint = ctx.content['tint'];
    this.tint = typeof tint === 'number' ? tint >>> 0 : 0xaad4ff;
    const len = ctx.content['length'];
    this.length = typeof len === 'number' && len > 0 ? Math.min(0.3, Math.max(0.005, len)) : 0.045;
    const rate = ctx.content['fallRate'];
    this.fallRate = typeof rate === 'number' && rate > 0 ? Math.min(4, Math.max(0.05, rate)) : 0.9;

    // A8: from scene state. Generated ONCE, like the tree's branches — drawing
    // a fresh stream on resize would give a different rain at a different
    // resolution, which is the same I-12 violation from the other direction.
    const count = numberOr(ctx.content['drops'], 220, 1, 2000);
    const rng = ctx.rng('drops');
    for (let i = 0; i < count; i++) {
      this.drops.push({
        x: rng.next(),
        phase: rng.next(),
        speed: rng.range(0.7, 1.45),
        scale: rng.range(0.55, 1.3),
        alpha: rng.range(0.35, 0.95),
      });
    }
    this.view.addChild(this.g);
    this.redraw();
  }

  protected redraw(): void {
    // Nothing resolution-derived is cached; `update` redraws from the box every
    // frame. Present because `BaseView` requires it.
  }

  update(frame: LayerFrame): void {
    const { w, h } = this;
    const g = this.g.clear();
    if (w === 0 || h === 0) return;

    const intensity = frame.forces.param('rain', 'intensity');
    if (intensity <= 0) return;

    // Wind slants the rain. The view reads the wind force's raw parameters for
    // the same reason it reads rain's: a slant is geometry, and geometry is not
    // something an axis can express. The rain LAYER is authored with a wind
    // susceptibility of 0 in `defaultScene.ts`, because translating a
    // full-frame sheet would drag its edges into view — the sheet stays put and
    // the drops inside it lean.
    const windStrength = frame.forces.param('wind', 'strength');
    const windAngle = frame.forces.param('wind', 'direction') * Math.PI * 2;
    const slant = Math.cos(windAngle) * windStrength * 0.55;

    // Intensity thins the rain out by drawing fewer of the SAME drops, in a
    // stable order, so turning it up adds drops rather than rearranging them.
    const shown = Math.max(1, Math.round(this.drops.length * intensity));
    const t = frame.timeSeconds;
    // Floored at 2 px — see this class's header on why rain is the content most
    // likely to read as soft on a wall.
    const width = Math.max(2, h * 0.005);

    for (let i = 0; i < shown; i++) {
      const d = this.drops[i]!;
      // Derived, never accumulated (I-2). `frac` of a linear function of clock
      // time, so a scrub is exact and a pause is a held frame.
      const fall = d.phase + t * this.fallRate * d.speed;
      const y = (fall - Math.floor(fall)) * (1 + this.length) - this.length;
      const len = this.length * d.scale;
      const x0 = d.x * w;
      g.moveTo(x0, y * h).lineTo(x0 + slant * len * h, (y + len) * h);
      g.stroke({
        width: width * d.scale,
        color: this.tint,
        alpha: d.alpha * Math.min(1, 0.3 + intensity),
      });
    }
  }
}

function numberOr(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}
