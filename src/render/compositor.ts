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
    this.mounts.set(entry.layer.id, { holder });
    const box = this.pixelBox(entry.layer);
    entry.view.resize(box.w, box.h);
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
      if (mount) this.applyTransform(mount.holder, entry.layer);
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
