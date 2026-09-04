/**
 * The layer compositor. Stacks layers in z-order into one output (I-6, I-9),
 * with per-layer opacity, blend mode and a normalized transform (I-1).
 *
 * Three things this file is deliberately responsible for, because putting them
 * anywhere else weakens an invariant:
 *
 *  - **It owns the normalized-to-pixel step.** Providers are handed a pixel box
 *    and never see a normalized transform, so a provider cannot store one in
 *    pixels (I-1).
 *  - **It owns error isolation.** Every provider call goes through
 *    `core/resilience.ts`, so one throwing layer costs its own layer and not
 *    the frame (I-13).
 *  - **It owns the placeholder's appearance.** `resilience.ts` decides policy
 *    and stays free of PixiJS so §8.1 can test it without a GPU; this is the
 *    only file that knows a placeholder is a magenta outline with a label.
 */
import { Container, Graphics } from 'pixi.js';
import { toPixelRect, type Layer } from '../core/layer';
import { identityModulation, type Modulation } from '../core/forces';
import {
  failedLayers,
  isolateCreate,
  isolateUpdate,
  type IsolatedLayer,
  type PlaceholderInfo,
} from '../core/resilience';
import { layersInDrawOrder, type Scene } from '../core/scene';
import { layerRng } from '../core/rng';
import type { LayerFrame, LayerView, ProviderRegistry } from '../providers/ContentProvider';
import { toPixiBlendMode } from './blend';
import { createPlaceholderGraphic } from './placeholder';

/** Frozen: the compositor reads it every mount and must never mutate it. */
const IDENTITY_MODULATION: Modulation = Object.freeze(identityModulation());

export interface CompositorOptions {
  providers: ProviderRegistry;
  width: number;
  height: number;
  /** Called once per failure, not once per frame — see `isolateUpdate`. */
  onLayerFailed?: (info: PlaceholderInfo, error: unknown) => void;
}

interface Mounted {
  /** Holds the provider view, and carries the layer's transform/blend/alpha. */
  holder: Container;
  /**
   * The last modulated values written to `holder`, so a frame in which nothing
   * moved writes nothing (A14).
   *
   * This is not premature: `tint` and `blendMode` are the two properties in
   * PixiJS v8 whose setters can invalidate a batch, and writing them 60 times a
   * second on eight layers that are not being modulated would put a cost on the
   * render thread that no force is asking for. `blendMode` is written only at
   * mount for the same reason.
   */
  applied: AppliedModulation;
}

/** What actually reaches the renderer, after modulation. Pixels and radians. */
interface AppliedModulation {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  alpha: number;
  tint: number;
}

const TAU = Math.PI * 2;

/** The axis triple as a PixiJS tint. White is the no-op — see `forces.ts`. */
function tintFromAxes(m: Modulation): number {
  const to8 = (v: number): number => {
    const n = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
    return n < 0 ? 0 : n > 255 ? 255 : n;
  };
  return (to8(m.tintR) << 16) | (to8(m.tintG) << 8) | to8(m.tintB);
}

export class Compositor {
  /** Add this to a stage. The compositor never touches the stage itself. */
  readonly view = new Container();

  private readonly background = new Graphics();
  private readonly layerRoot = new Container();
  private readonly providers: ProviderRegistry;
  private readonly onLayerFailed: (info: PlaceholderInfo, error: unknown) => void;

  private width: number;
  private height: number;
  private scene: Scene | null = null;
  private entries: IsolatedLayer<LayerView>[] = [];
  private mounts = new Map<string, Mounted>();

  constructor(opts: CompositorOptions) {
    this.providers = opts.providers;
    this.onLayerFailed = opts.onLayerFailed ?? (() => {});
    this.width = opts.width;
    this.height = opts.height;
    this.view.addChild(this.background, this.layerRoot);
  }

  /**
   * Rebuilds the whole stack. Phase 1's content is static and scene edits are
   * operator-paced, not per-frame, so a full rebuild is the honest
   * implementation; a diff here would be optimising something that does not
   * happen 60 times a second. Old views are destroyed, which is what keeps
   * texture memory flat across a reorder (Gate 1's rolling check).
   */
  setScene(scene: Scene): void {
    this.teardownLayers();
    this.scene = scene;
    this.drawBackground();

    const ordered = layersInDrawOrder(scene);
    this.entries = isolateCreate<LayerView>(
      ordered,
      (layer) => this.createView(scene, layer),
      (info) => this.createPlaceholder(info),
      this.onLayerFailed,
    );

    for (const entry of this.entries) this.mount(entry);
  }

  private createView(scene: Scene, layer: Layer): LayerView {
    const provider = this.providers.get(layer.providerId);
    if (!provider) {
      // A missing provider is an I-13 placeholder, not a crash: a scene saved
      // against a build that had a provider must still open on one that does not.
      throw new Error(`no provider registered for "${layer.providerId}"`);
    }
    const box = toPixelRect(layer.transform, this.width, this.height);
    return provider.create({
      layer,
      content: layer.content,
      rng: (label?: string) => layerRng(scene.seed, layer.seed, label ?? ''),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height)),
    });
  }

  /**
   * I-13's visible placeholder. The APPEARANCE moved to
   * `render/placeholder.ts` in Phase 3, because a video whose decode fails
   * asynchronously has to draw one too and cannot throw into the render loop to
   * get it. There is still exactly one definition of what a placeholder looks
   * like — see that file's header.
   */
  private createPlaceholder(info: PlaceholderInfo): LayerView {
    const g = createPlaceholderGraphic(info);
    return {
      view: g.view,
      update: () => {},
      resize: g.draw,
      destroy: g.destroy,
    };
  }

  private mount(entry: IsolatedLayer<LayerView>): void {
    const holder = new Container();
    holder.addChild(entry.view.view);
    this.applyTransform(holder, entry.layer);
    this.layerRoot.addChild(holder);
    this.mounts.set(entry.layer.id, {
      holder,
      // Seeded with exactly what `applyTransform` just wrote, so an unmodulated
      // scene writes nothing on its first frame and the blessed golden frames
      // are unchanged by the force bus existing (§8.1).
      applied: this.appliedFor(entry.layer, IDENTITY_MODULATION),
    });
    const box = this.pixelBox(entry.layer);
    entry.view.resize(box.w, box.h);
  }

  /**
   * I-1 and I-4 meeting. The stored transform is normalized and the modulation
   * is normalized; both become pixels here and nowhere else, and neither is
   * ever written back into the layer — a modulated position is a fact about
   * this frame, not an edit to the scene.
   */
  private appliedFor(layer: Layer, m: Modulation): AppliedModulation {
    const rect = toPixelRect(layer.transform, this.width, this.height);
    return {
      x: rect.cx + m.offsetX * this.width,
      y: rect.cy + m.offsetY * this.height,
      rotation: rect.rotation + m.rotate * TAU,
      scale: m.scale,
      alpha: layer.opacity * m.opacity,
      tint: tintFromAxes(m),
    };
  }

  /**
   * Writes only what changed. `blendMode`, `visible` and the pivot are not here
   * — no force axis drives them, and they are written at mount and on resize.
   */
  private writeModulation(mount: Mounted, next: AppliedModulation): void {
    const prev = mount.applied;
    const holder = mount.holder;
    if (next.x !== prev.x || next.y !== prev.y) holder.position.set(next.x, next.y);
    if (next.rotation !== prev.rotation) holder.rotation = next.rotation;
    if (next.scale !== prev.scale) holder.scale.set(next.scale);
    if (next.alpha !== prev.alpha) holder.alpha = next.alpha;
    if (next.tint !== prev.tint) holder.tint = next.tint;
    mount.applied = next;
  }

  private pixelBox(layer: Layer): { w: number; h: number } {
    const box = toPixelRect(layer.transform, this.width, this.height);
    return { w: Math.max(1, Math.round(box.width)), h: Math.max(1, Math.round(box.height)) };
  }

  /**
   * I-1's only consumer. The provider draws into a box whose origin is its own
   * top-left; the pivot puts the layer's stored centre at the stored position,
   * so resizing a layer does not move it and rotation turns about its middle.
   */
  private applyTransform(holder: Container, layer: Layer): void {
    const rect = toPixelRect(layer.transform, this.width, this.height);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    holder.pivot.set(w / 2, h / 2);
    holder.position.set(rect.cx, rect.cy);
    holder.rotation = rect.rotation;
    holder.alpha = layer.opacity;
    holder.blendMode = toPixiBlendMode(layer.blendMode);
    holder.visible = layer.visible;
  }

  private drawBackground(): void {
    const color = this.scene?.background ?? 0x000000;
    this.background.clear().rect(0, 0, this.width, this.height).fill({ color, alpha: 1 });
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.drawBackground();
    for (const entry of this.entries) {
      const mount = this.mounts.get(entry.layer.id);
      if (mount) {
        this.applyTransform(mount.holder, entry.layer);
        // Every cached pixel value was derived from the old size. Rebase, or
        // the next frame's change detection compares against stale pixels and
        // a layer stays where the previous resolution put it.
        mount.applied = this.appliedFor(entry.layer, IDENTITY_MODULATION);
      }
      const box = this.pixelBox(entry.layer);
      entry.view.resize(box.w, box.h);
    }
  }

  /** Per frame. A layer that throws is swapped for a placeholder (I-13). */
  update(frame: LayerFrame): void {
    const changed = isolateUpdate<LayerView>(
      this.entries,
      (entry) => entry.view.update(frame),
      (info) => this.createPlaceholder(info),
      this.onLayerFailed,
    );
    for (const entry of changed) {
      const mount = this.mounts.get(entry.layer.id);
      if (!mount) continue;
      mount.holder.removeChildren();
      mount.holder.addChild(entry.view.view);
      const box = this.pixelBox(entry.layer);
      entry.view.resize(box.w, box.h);
    }

    // I-4. The force bus reaches EVERY layer here, generically — a layer sways
    // in the wind without its provider knowing that wind exists, which is what
    // makes "one wind change ripples through the whole scene" (D4) a property
    // of the compositor rather than of the providers that happened to
    // implement it. A layer showing an I-13 placeholder is modulated too: a
    // broken layer that stopped responding to the scene would read as a second
    // failure on top of the first.
    for (const entry of this.entries) {
      const mount = this.mounts.get(entry.layer.id);
      if (!mount) continue;
      this.writeModulation(mount, this.appliedFor(entry.layer, frame.forces.modulationFor(entry.layer)));
    }
  }

  /** I-13: the layers a live session should be showing as broken. */
  failures(): PlaceholderInfo[] {
    return failedLayers(this.entries).map((e) => ({
      layerId: e.layer.id,
      layerName: e.layer.name,
      providerId: e.layer.providerId,
      reason: e.error,
    }));
  }

  private teardownLayers(): void {
    for (const entry of this.entries) {
      try {
        entry.view.destroy();
      } catch {
        // A provider that throws on teardown must not prevent the rest of the
        // stack from being disposed — that is how a scene switch leaks (I-13).
      }
    }
    for (const mount of this.mounts.values()) mount.holder.destroy({ children: true });
    this.entries = [];
    this.mounts.clear();
    this.layerRoot.removeChildren();
  }

  destroy(): void {
    this.teardownLayers();
    this.view.destroy({ children: true });
  }
}
