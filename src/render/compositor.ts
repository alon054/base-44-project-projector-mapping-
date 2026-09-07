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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * B2 — A LAYER MAY DRAW MORE THAN ONCE (SPRINT.md §3 R2).
 *
 * A layer carrying `fillRole` renders once into EVERY surface carrying that
 * role, each instance clipped to that surface's path. One layer, N provider
 * views, N masks, one entry in the layer list.
 *
 * Three consequences, all of them load-bearing:
 *
 *  - **The layer's own transform is not used.** A fill is positioned by the
 *    face it lands on, so each instance's provider is handed THAT SURFACE's
 *    pixel bounding box (I-3) and the holder stays at identity. A fill layer's
 *    stored transform is inert, not overridden.
 *  - **Force modulation moves the content, never the clip.** The mask is fixed
 *    to the face; the geometry from the force bus is written INSIDE the mask,
 *    on each instance's content container. A wind that slid the mask with the
 *    content would slide the lit shape off the box, which is a re-shoot.
 *  - **Error isolation is unchanged, and that is the point.** The whole fill
 *    stack is one `LayerView`, so a throw in any instance — at create or in a
 *    frame — reaches `resilience.ts` as that LAYER failing and costs that
 *    layer, not the frame (I-13). N instances did not add an N-way failure
 *    mode; they added N chances to hit the one that already existed.
 *
 * A `fillRole` matching no surface is the I-13 flag path and NOT a placeholder:
 * flagged, logged once, renders nowhere, substitutes nothing. A magenta box on
 * a wall for a mistyped role would be a second wrong answer on top of the
 * first — see `core/roles.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Container, Graphics } from 'pixi.js';
import { toPixelRect, type Layer } from '../core/layer';
import { composeAxes, identityModulation, type AxisWrite, type Modulation } from '../core/forces';
import {
  headingAtProgress,
  isRouteTraversable,
  pointAtProgress,
  progressAt,
  type RouteMotion,
} from '../core/motion';
import type { Path } from '../core/paths';
import {
  failedLayers,
  isolateCreate,
  isolateUpdate,
  type IsolatedLayer,
  type PlaceholderInfo,
} from '../core/resilience';
import { layersInDrawOrder, type Scene } from '../core/scene';
import { resolveAt, type Group } from '../core/groups';
import { layerRng } from '../core/rng';
import { logRoleMiss, resolveRole } from '../core/roles';
import type { Surface, SurfaceTree } from '../core/surfaces';
import type { ContentProvider, LayerFrame, LayerView, ProviderRegistry } from '../providers/ContentProvider';
import { toPixiBlendMode } from './blend';
import { buildMask, drawMask, isMaskable, pathPixelBounds, type PixelBox } from './mask';
import { drawWallGrid } from './wallGrid';
import { drawFaceGuides, drawWallGridCutout } from './faceGuides';
import { createPlaceholderGraphic } from './placeholder';

/** Frozen: the compositor reads it every mount and must never mutate it. */
const IDENTITY_MODULATION: Modulation = Object.freeze(identityModulation());

export interface CompositorOptions {
  providers: ProviderRegistry;
  width: number;
  height: number;
  /** Called once per failure, not once per frame — see `isolateUpdate`. */
  onLayerFailed?: (info: PlaceholderInfo, error: unknown) => void;
  /**
   * The room (I-15). Empty until a face is marked, which is the ordinary state
   * of a fresh install and not an error: a layer with a `fillRole` then lights
   * nothing and says so, and every layer without one draws exactly as before.
   */
  surfaces?: SurfaceTree;
}

/** I-13's flag for a fill that landed nowhere. Shown, never substituted. */
export interface RoleMiss {
  layerId: string;
  layerName: string;
  role: string;
  /** What went wrong, in the operator's words: an unknown role, or an unmarkable face. */
  reason: string;
}

/**
 * One fill instance: this layer's content on ONE face.
 *
 * `mask` is a child of `container` AND its mask. Pixi v8's `StencilMask.init`
 * sets `includeInBuild = false` on the mask, so parenting it does not draw it —
 * but it does give it a transform to be evaluated in, which a parentless mask
 * does not have.
 */
interface FillInstance {
  surface: Surface;
  /** Identity transform, so the mask's pixels are frame pixels. Masked. */
  container: Container;
  /** Inside the mask. Carries the box placement AND every force axis. */
  content: Container;
  mask: Graphics;
  view: LayerView;
  box: PixelBox;
  applied: AppliedModulation;
}

/**
 * The `LayerView` a `fillRole` layer presents to `resilience.ts`: N instances
 * behind one view, so I-13's per-layer isolation covers all of them at once.
 *
 * `resize` is deliberately a no-op. Every other view is sized to its layer's
 * box; a fill is sized to its FACE's box, which the compositor derives per
 * instance and writes directly. Accepting the layer's box here would resize
 * every instance to the wrong rectangle in the one call the compositor makes
 * without thinking about fills.
 */
class FillStack implements LayerView {
  readonly view = new Container();
  readonly instances: FillInstance[] = [];

  constructor(readonly role: string) {}

  update(frame: LayerFrame): void {
    // No try/catch: a throw here is this LAYER failing, and `isolateUpdate`
    // above is what turns that into a placeholder exactly once (I-13).
    for (const instance of this.instances) instance.view.update(frame);
  }

  resize(): void {}

  destroy(): void {
    for (const instance of this.instances) {
      try {
        instance.view.destroy();
      } catch {
        // One provider throwing on teardown must not strand the instances after
        // it — the same reason `teardownLayers` swallows here.
      }
    }
    this.instances.length = 0;
    this.view.destroy({ children: true });
  }
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
   *
   * For a fill layer this holds the ALPHA and TINT only: the holder stays at
   * identity and the geometry lives on each instance's content container.
   */
  applied: AppliedModulation;
  /**
   * B2. The instances of a `fillRole` layer, in marking order. Empty for every
   * layer without one — which is what makes the old path literally the old
   * path rather than a special case of the new one.
   */
  fills: FillInstance[];
  /**
   * True for a layer that carries a `fillRole`, INCLUDING one whose role
   * matched nothing (`fills` empty). The two states differ: an unmatched fill
   * must not fall back to drawing at the layer's transform.
   */
  isFill: boolean;
  /**
   * B5 / I-18. The route this layer travels, resolved from its
   * `motion.travelRole` against the room at mount, and re-pointed when the
   * route's own surface is reshaped. `null` for a layer that declared no
   * route, a fill layer (a fill is placed by its face), or a role that matched
   * nothing — the last of which is also in `misses`.
   */
  route: Path | null;
  /** The surface `route` came from, so a point drag on it can re-point `route`. */
  routeSurfaceId: string | null;
  /**
   * B4 / I-16. Whether this layer's `sequence` block is the one showing at the
   * last frame's time. Always `true` for a layer in no sequence — the implicit
   * `parallel` root and an explicit `parallel` group behave identically, which
   * is what makes a defaulted group byte-identical to no group at all.
   *
   * Compared before it is written (A14): an unchanged sequence writes nothing.
   */
  active: boolean;
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

/**
 * The room's SHAPE, as a string — what `setSurfaces` compares to decide between
 * reshaping the masks it has and rebuilding the stack (B3).
 *
 * Three fields per face and no geometry, which is the whole idea:
 *
 *  - **`id`** — a face added, removed or reordered changes which instances
 *    exist and in what order, and marking order is render order.
 *  - **`role`** — re-tagging a face moves it from one layer's fill list to
 *    another's, or out of every list. No amount of mask redrawing expresses
 *    that.
 *  - **maskable** — a face crossing `MASK_MIN_POINTS` in either direction
 *    gains or loses its instance, and gains or loses an I-13 role-miss flag
 *    with it. This is the one that is easy to forget, and forgetting it would
 *    leave a face that was dragged down to two points still drawing the mask it
 *    had when it was a triangle.
 *
 * Point POSITIONS are deliberately absent. Moving a point is precisely the edit
 * the reshape path exists to serve, and putting coordinates in this key would
 * make every drag a rebuild — which is the defect, not the fix.
 *
 * A string rather than a structural comparison because it is compared, never
 * read: `\u0000` and `\u0001` separate the fields and the entries, so a role
 * containing a comma or a colon cannot forge a boundary. `role` is a free
 * string typed by an operator in the dark (SPRINT.md §3 R2), so that is a real
 * input and not a hypothetical one.
 */
export function surfacesShapeKey(tree: SurfaceTree): string {
  return tree
    .map(
      (s) =>
        `${s.id}\u0000${s.role}\u0000${isMaskable(s.path) ? '1' : '0'}` +
        // B5: a route crossing the two-point threshold gains or loses its
        // travellers, exactly as a face crossing `MASK_MIN_POINTS` gains or
        // loses its fill. Same reasoning, fourth field.
        `${isRouteTraversable(s.path) ? '1' : '0'}`,
    )
    .join('\u0001');
}

export class Compositor {
  /** Add this to a stage. The compositor never touches the stage itself. */
  readonly view = new Container();

  private readonly background = new Graphics();
  private readonly layerRoot = new Container();
  /**
   * The operator's wall reference grid (`render/wallGrid.ts`). A sibling ABOVE
   * every layer, so it is readable over content, and INSIDE the composite, so it
   * goes through the warp exactly as content does.
   *
   * `visible = false` at construction and nothing turns it on but an explicit
   * `setWallGrid(true)`. The golden harness never calls that, which is why no
   * blessed frame can contain it — structural, not a promise.
   */
  private readonly wallGrid = new Graphics();
  /**
   * W1 fix. The per-face guide grids (`render/faceGuides.ts`): a sibling
   * between the layers and the wall grid, following the wall grid's ONE toggle
   * and its rules — hidden at construction, never enabled by the golden
   * harness, drawn pre-warp. Redrawn on every room write while visible; an
   * empty container and nothing else while hidden (A14).
   */
  private readonly faceGuides = new Container();
  /**
   * The wall grid's cut-out over faces whose guide is hidden
   * (`drawWallGridCutout`). Applied as the wall grid's mask only while some
   * face is cut; otherwise the mask is dropped and this is an empty Graphics.
   */
  private readonly wallGridCutout = new Graphics();
  private readonly providers: ProviderRegistry;
  private readonly onLayerFailed: (info: PlaceholderInfo, error: unknown) => void;

  private width: number;
  private height: number;
  private scene: Scene | null = null;
  private entries: IsolatedLayer<LayerView>[] = [];
  private mounts = new Map<string, Mounted>();
  private surfaces: SurfaceTree = [];
  private misses: RoleMiss[] = [];
  /**
   * B4. The scene's `sequence` groups, and which one each layer belongs to.
   * Derived at `setScene` so the per-frame question is a map lookup and one
   * `resolveAt` per sequence, not a search through the scene sixty times a
   * second. `parallel` groups are deliberately absent: they change nothing.
   */
  private sequences: Group[] = [];
  private sequenceOf = new Map<string, Group>();

  constructor(opts: CompositorOptions) {
    this.providers = opts.providers;
    this.onLayerFailed = opts.onLayerFailed ?? (() => {});
    this.width = opts.width;
    this.height = opts.height;
    this.surfaces = opts.surfaces ?? [];
    this.wallGrid.visible = false;
    this.faceGuides.visible = false;
    this.view.addChild(this.background, this.layerRoot, this.faceGuides, this.wallGrid, this.wallGridCutout);
  }

  /**
   * Show or hide the wall grid. Operator-paced; never per frame.
   *
   * The geometry is rebuilt on the way ON rather than kept up to date while
   * hidden, so a grid that is off costs one invisible empty `Graphics` and no
   * redraws at all (A14). See `render/wallGrid.ts` for why this exists and why
   * it is off by default at every launch.
   */
  setWallGrid(on: boolean): void {
    // VISIBLE FIRST, THEN DRAW. The order is the fix, and it is not cosmetic.
    //
    // PixiJS v8 drops a geometry update made to an invisible view:
    // `RenderGroup.updateRenderable` returns early when
    // `globalDisplayStatus < 7` and does NOT clear `didViewUpdate` on the way
    // out, while `ViewContainer.onViewUpdate` early-returns for as long as that
    // latch is set. So drawing into a hidden `Graphics` can queue an update that
    // is discarded, leaving the GPU holding the geometry from before.
    //
    // Written the other way round, this worked the first time — the draw
    // happened before the view had ever been skipped — and then failed after an
    // off/on cycle, which is exactly how it was reported from the projector.
    // Making it visible first means every draw happens to a view the render
    // group will actually process, so there is no state in which the grid is
    // on and the geometry is stale.
    this.wallGrid.visible = on;
    if (on) drawWallGrid(this.wallGrid, this.width, this.height);
    // The face guides follow, under the same visible-then-draw rule.
    this.faceGuides.visible = on;
    if (on) this.refreshGuides();
  }

  /**
   * W1 fix. Redraw the face guides for the current room and scene, while they
   * are showing. A face shows its guide if its own `guide` flag says so, else
   * while NOTHING fills it — the moment a fill instance lands on a face, its
   * grid goes, unless the builder switched it on. Called wherever either input
   * changes: the toggle, a room write, a scene apply, a resize. Never per frame.
   */
  private refreshGuides(): void {
    if (!this.faceGuides.visible) return;
    const filled = new Set<string>();
    for (const mount of this.mounts.values()) {
      if (!mount.isFill) continue;
      for (const instance of mount.fills) filled.add(instance.surface.id);
    }
    const show = (s: Surface): boolean => s.guide ?? !filled.has(s.id);
    drawFaceGuides(this.faceGuides, this.surfaces, this.width, this.height, show);
    // And the wall grid stays out of every face whose guide is hidden — "grid
    // off" on a face is no grid line at all across it, the wall's included.
    const hidden = this.surfaces.filter((s) => !show(s)).map((s) => s.path);
    const cut = drawWallGridCutout(this.wallGridCutout, hidden, this.width, this.height);
    this.wallGrid.mask = cut ? this.wallGridCutout : null;
  }

  /** Whether the grid is currently on the projection. For the log and the HUD. */
  wallGridOn(): boolean {
    return this.wallGrid.visible;
  }

  /**
   * Re-mark the room (I-15). **Two paths, and which one runs is decided by the
   * room's SHAPE, never by how the call arrived.**
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS IS NOT ONE REBUILD.
   *
   * B2 shipped this as an unconditional `setScene`, which tears down and
   * rebuilds every layer in the stack. That was right for the call B2 could
   * make — marking a face is operator-paced — and it is wrong for the call B3
   * makes, which is *every pointer-move of a point drag*. A rebuild per pointer
   * sample destroys and re-creates every provider view in the scene sixty times
   * a second: for a video layer that is a decoder torn down and rebuilt per
   * frame, which is the failure `PreviewCanvas`'s pointer-up comment describes
   * for scene edits and refuses to make.
   *
   * The alternative — debouncing the drag — was rejected: it makes the wall lag
   * behind the finger, and the whole point of writing the room on every change
   * is that a builder standing at the projector gets an answer while the point
   * is still under their hand.
   *
   * So: when the room's shape is unchanged and only its GEOMETRY moved, each
   * live fill instance is reshaped in place — mask redrawn, box recomputed,
   * provider resized. That is exactly what `resize()` already does to the same
   * instances when the output resolution changes, and it is literally the same
   * function (`reshapeFill`), so the two cannot drift apart.
   *
   * WHAT COUNTS AS A SHAPE CHANGE (`surfacesShapeKey`): a face added, removed,
   * reordered, re-roled, or crossing the maskability threshold. Every one of
   * those changes WHICH instances exist or which layer owns them, and none of
   * them can be expressed by moving a mask — so they take the rebuild, which is
   * also what makes SPRINT.md's beat 7 work: a face marked later gains the role
   * at that moment and lights itself.
   *
   * The `misses` list is rebuilt on that path too, and only on that path. That
   * is not a shortcut: every reason a fill can miss — no surface with the role,
   * or a surface too small to enclose an area — is in the shape key, so a
   * geometric edit cannot make the flags stale.
   * ───────────────────────────────────────────────────────────────────────────
   */
  setSurfaces(tree: SurfaceTree): void {
    const previous = this.surfaces;
    this.surfaces = tree;
    if (!this.scene) {
      this.refreshGuides();
      return;
    }
    if (surfacesShapeKey(previous) !== surfacesShapeKey(tree)) {
      // `setScene` refreshes the guides itself, after the fills are rebuilt.
      this.setScene(this.scene);
      return;
    }
    for (const entry of this.entries) {
      const mount = this.mounts.get(entry.layer.id);
      if (!mount) continue;
      // B5. A point of the ROUTE dragged: the traveller follows the new path on
      // the next frame, with no rebuild — the same identity test the masks use.
      if (mount.routeSurfaceId !== null) {
        const surface = tree.find((s) => s.id === mount.routeSurfaceId);
        if (surface && surface.path !== mount.route) mount.route = surface.path;
      }
      if (!mount.isFill) continue;
      for (const instance of mount.fills) {
        const surface = tree.find((s) => s.id === instance.surface.id);
        // Identity, not deep equality: `reconcileSurfaces` hands back the SAME
        // surface object for a face nothing touched, so a drag on one face of
        // five reshapes one mask and leaves four alone.
        if (!surface || surface.path === instance.surface.path) continue;
        this.reshapeFill(instance, entry.layer, surface);
      }
    }
    // W1 fix. Guides are redrawn AFTER the fills are reshaped, so a face that
    // just gained or lost a fill shows or hides its grid on the same write.
    this.refreshGuides();
  }

  /**
   * One fill instance re-cut to a face's current geometry.
   *
   * Shared by `resize()` and `setSurfaces()` because the two are the same
   * operation seen from opposite sides — the frame changed size under a fixed
   * path, or the path moved inside a fixed frame — and both end with the same
   * four writes. Writing them twice is how the mask and the box would come to
   * disagree about which pixels are the face.
   *
   * The mask geometry is REBUILT from the normalized path rather than scaled or
   * translated (I-1): a mask is pixels and nothing else, and a mask that
   * remembered where it used to be would put the clip half a face out.
   */
  private reshapeFill(instance: FillInstance, layer: Layer, surface: Surface): void {
    instance.surface = surface;
    instance.box = pathPixelBounds(surface.path, this.width, this.height);
    drawMask(instance.mask, surface.path, this.width, this.height);
    // Rebased against IDENTITY, exactly as a fresh instance is. The next frame's
    // `writeFillModulation` re-derives the live modulation from the new box, so
    // seeding it any other way would be a second definition of where an
    // unmodulated fill sits.
    instance.applied = this.appliedForBox(instance.box, layer, IDENTITY_MODULATION);
    this.placeFill(instance);
    instance.view.resize(
      Math.max(1, Math.round(instance.box.width)),
      Math.max(1, Math.round(instance.box.height)),
    );
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
    this.misses = [];
    this.drawBackground();
    this.sequences = scene.groups.filter((g) => g.mode === 'sequence');
    this.sequenceOf = new Map();
    for (const g of this.sequences) for (const c of g.children) this.sequenceOf.set(c.id, g);

    const ordered = layersInDrawOrder(scene);
    this.entries = isolateCreate<LayerView>(
      ordered,
      (layer) => this.createView(scene, layer),
      (info) => this.createPlaceholder(info),
      this.onLayerFailed,
    );

    for (const entry of this.entries) this.mount(entry);
    // W1 fix. Which faces are filled is known only now.
    this.refreshGuides();
  }

  private createView(scene: Scene, layer: Layer): LayerView {
    const provider = this.providers.get(layer.providerId);
    if (!provider) {
      // A missing provider is an I-13 placeholder, not a crash: a scene saved
      // against a build that had a provider must still open on one that does not.
      throw new Error(`no provider registered for "${layer.providerId}"`);
    }
    if (layer.fillRole !== undefined) return this.createFillView(scene, layer, provider);
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
   * SPRINT.md R2 — one layer, one instance per surface carrying its role.
   *
   * Every failure mode here is I-13's flag path rather than a throw, with one
   * exception that is deliberately NOT caught: a provider that throws. That is
   * the layer failing, and `resilience.ts` already knows what to do with it.
   */
  private createFillView(scene: Scene, layer: Layer, provider: ContentProvider): FillStack {
    const role = layer.fillRole as string;
    const resolution = resolveRole(role, this.surfaces);
    // Deduped by role in `roles.ts`, so an operator dragging a point does not
    // get one line per rebuild for one typo.
    logRoleMiss(resolution);
    const stack = new FillStack(role);
    if (resolution.unmatched) {
      this.misses.push({
        layerId: layer.id,
        layerName: layer.name,
        role,
        reason: resolution.message,
      });
      // Renders nowhere, substitutes nothing. The flag above is the whole
      // response, and the rest of the frame is untouched.
      return stack;
    }

    try {
      for (const surface of resolution.surfaces) {
        if (!isMaskable(surface.path)) {
          // A face still being marked has one or two points. Real, not corrupt
          // — so it is flagged and skipped, and its siblings still light.
          this.misses.push({
            layerId: layer.id,
            layerName: layer.name,
            role,
            reason:
              `surface ${surface.id} ("${surface.name}") has ${surface.path.points.length} ` +
              'point(s) and cannot enclose an area — nothing clipped, nothing drawn',
          });
          continue;
        }
        stack.instances.push(this.createFillInstance(scene, layer, provider, surface));
        stack.view.addChild(stack.instances[stack.instances.length - 1]!.container);
      }
    } catch (e) {
      // The instances built before the throw are already holding GPU geometry.
      // Dropping the stack on the floor would leak them past a failure the
      // soak check is watching for, so it is torn down before the throw is
      // handed to `isolateCreate`.
      stack.destroy();
      throw e;
    }
    return stack;
  }

  /**
   * One face's worth of this layer.
   *
   * I-3, at its narrowest: the provider is handed the surface's pixel bounding
   * box as a width and a height and is told nothing about where that box is or
   * what shape is cut out of it. The mask does the shape and the compositor
   * does the placement, so a provider that can only draw into a rectangle fills
   * a six-point L correctly and cannot store a normalized anything.
   */
  private createFillInstance(
    scene: Scene,
    layer: Layer,
    provider: ContentProvider,
    surface: Surface,
  ): FillInstance {
    const box = pathPixelBounds(surface.path, this.width, this.height);
    const view = provider.create({
      layer,
      content: layer.content,
      // The layer's stream, not a per-surface one: this is ONE layer shown on
      // several faces, and a seed that varied per face would make the same
      // layer a different picture on each — a decision this block has no
      // mandate to make and P6 can make with a wall in front of it.
      rng: (label?: string) => layerRng(scene.seed, layer.seed, label ?? ''),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height)),
    });

    const container = new Container();
    const content = new Container();
    const mask = buildMask(surface.path, this.width, this.height);
    content.addChild(view.view);
    container.addChild(content, mask);
    // A `Graphics` — so v8 takes the stencil path and allocates no render
    // target. See `render/mask.ts`; the HUD's rt row is what proves it.
    container.mask = mask;

    const instance: FillInstance = {
      surface,
      container,
      content,
      mask,
      view,
      box,
      applied: this.appliedForBox(box, layer, IDENTITY_MODULATION),
    };
    this.placeFill(instance);
    view.resize(Math.max(1, Math.round(box.width)), Math.max(1, Math.round(box.height)));
    return instance;
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
    const stack = entry.view instanceof FillStack ? entry.view : null;
    if (stack) this.applyFillHolder(holder, entry.layer);
    else this.applyTransform(holder, entry.layer);
    this.layerRoot.addChild(holder);
    const mounted: Mounted = {
      holder,
      // Seeded with exactly what `applyTransform` just wrote, so an unmodulated
      // scene writes nothing on its first frame and the blessed golden frames
      // are unchanged by the force bus existing (§8.1).
      applied: this.appliedFor(entry.layer, IDENTITY_MODULATION),
      fills: stack ? stack.instances : [],
      isFill: stack !== null,
      ...this.resolveTravel(entry.layer, stack !== null),
      // Every layer starts ACTIVE and the first `update` decides otherwise, so
      // a sequence child that is not showing is hidden on the frame it is
      // judged, and a layer in no sequence is never touched at all.
      active: true,
    };
    this.mounts.set(entry.layer.id, mounted);
    this.syncVisibility(mounted, entry.layer);
    if (stack) return;
    const box = this.pixelBox(entry.layer);
    entry.view.resize(box.w, box.h);
  }

  /**
   * B5 / I-18 / D21. Which path this layer travels, decided at mount.
   *
   * By ROLE (I-15): `resolveRole(travelRole, room)`, and the FIRST surface in
   * marking order carrying it is the route — one traveller, one path; a role
   * on several surfaces is not an error, the first was marked first. A fill
   * layer never travels: it is placed by its face, and a route under it would
   * drag the content out of the mask.
   *
   * Every failure is I-13's flag path: no route (`''`) is not flagged at all,
   * because a default cannot be a defect; a role matching nothing, or matching
   * a path too short to travel, is recorded in `misses` and the layer draws at
   * its base transform, motionless. A flagged entity is still an entity.
   */
  private resolveTravel(
    layer: Layer,
    isFill: boolean,
  ): { route: Path | null; routeSurfaceId: string | null } {
    const none = { route: null, routeSurfaceId: null };
    const role = layer.motion?.travelRole ?? '';
    if (role === '' || isFill) return none;
    const resolution = resolveRole(role, this.surfaces);
    logRoleMiss(resolution);
    if (resolution.unmatched) {
      this.misses.push({ layerId: layer.id, layerName: layer.name, role, reason: resolution.message });
      return none;
    }
    const surface = resolution.surfaces[0] as Surface;
    if (!isRouteTraversable(surface.path)) {
      this.misses.push({
        layerId: layer.id,
        layerName: layer.name,
        role,
        reason:
          `route ${surface.id} ("${surface.name}") has ${surface.path.points.length} point(s) ` +
          'and cannot be travelled — the entity holds at its base transform',
      });
      return none;
    }
    return { route: surface.path, routeSurfaceId: surface.id };
  }

  /**
   * Motion, resolved INTO THE AXIS VOCABULARY and nowhere else (B5's rule).
   *
   * The route point minus the stored centre is a contribution to `offsetX` /
   * `offsetY`, so the entity lands on the route and the forces still sum on
   * top — a wind leans a travelling object. With `orient` on, the heading is
   * an OVERRIDE of `rotate`: it replaces the authored rotation and the forces
   * still sum on top of it (`composeAxes`). With `orient` off, motion
   * contributes nothing to rotation, written as a zero contribution so the
   * stage always says what it did.
   *
   * Nothing here writes `layer.transform`. A modulated position is a fact
   * about this frame, never an edit to the scene (I-12), and a stored transform
   * that motion overwrote would be a scene that could not be reloaded.
   */
  private travelWrites(layer: Layer, route: Path, motion: RouteMotion, timeSeconds: number): AxisWrite[] {
    const progress = progressAt(timeSeconds, motion);
    const p = pointAtProgress(route, progress);
    return [
      { axis: 'offsetX', value: p.x - layer.transform.x, mode: 'contribute' },
      { axis: 'offsetY', value: p.y - layer.transform.y, mode: 'contribute' },
      motion.orient
        ? { axis: 'rotate', value: headingAtProgress(route, progress), mode: 'override' }
        : { axis: 'rotate', value: 0, mode: 'contribute' },
    ];
  }

  /**
   * I-1 and I-4 meeting. The stored transform is normalized and the modulation
   * is normalized; both become pixels here and nowhere else, and neither is
   * ever written back into the layer — a modulated position is a fact about
   * this frame, not an edit to the scene.
   *
   * `rotateOverride` (B5) is in TURNS and replaces the stored rotation as the
   * base the modulation's `rotate` is added to. `null` — every layer before
   * B5, and every layer with `orient` off — is the stored rotation.
   */
  private appliedFor(layer: Layer, m: Modulation, rotateOverride: number | null = null): AppliedModulation {
    const rect = toPixelRect(layer.transform, this.width, this.height);
    return {
      x: rect.cx + m.offsetX * this.width,
      y: rect.cy + m.offsetY * this.height,
      rotation: (rotateOverride === null ? rect.rotation : rotateOverride * TAU) + m.rotate * TAU,
      scale: m.scale,
      alpha: layer.opacity * m.opacity,
      tint: tintFromAxes(m),
    };
  }

  /**
   * The same arithmetic against a FACE's box instead of the layer's transform.
   *
   * The only difference is the rotation term: a surface carries no stored
   * rotation — its shape is already drawn in the room's coordinates — so a
   * modulated fill turns about the centre of the face it is on, from zero.
   */
  private appliedForBox(box: PixelBox, layer: Layer, m: Modulation): AppliedModulation {
    return {
      x: box.x + box.width / 2 + m.offsetX * this.width,
      y: box.y + box.height / 2 + m.offsetY * this.height,
      rotation: m.rotate * TAU,
      scale: m.scale,
      alpha: layer.opacity * m.opacity,
      tint: tintFromAxes(m),
    };
  }

  /**
   * Put one instance's content where its face is, inside the mask.
   *
   * The pivot is the box's centre for the same reason the layer path pivots on
   * its own: resizing must not move it, and a rotation must turn about the
   * middle of the face rather than about the frame's origin.
   */
  private placeFill(instance: FillInstance): void {
    const w = Math.max(1, Math.round(instance.box.width));
    const h = Math.max(1, Math.round(instance.box.height));
    instance.content.pivot.set(w / 2, h / 2);
    instance.content.position.set(instance.applied.x, instance.applied.y);
    instance.content.rotation = instance.applied.rotation;
    instance.content.scale.set(instance.applied.scale);
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

  /**
   * The same write, split across the mask boundary.
   *
   * Alpha and tint go on the holder — one write for N faces, and neither one
   * moves anything. The GEOMETRY goes on each instance's content container,
   * INSIDE its mask, so a force moves the light within the face and never drags
   * the clip off the box with it. That split is the reason a fill has an inner
   * container at all.
   *
   * Change detection is per instance, so an unmodulated scene still writes
   * nothing (A14) no matter how many faces are lit.
   */
  private writeFillModulation(mount: Mounted, layer: Layer, m: Modulation): void {
    const prev = mount.applied;
    const holder = mount.holder;
    const alpha = layer.opacity * m.opacity;
    const tint = tintFromAxes(m);
    if (alpha !== prev.alpha) holder.alpha = alpha;
    if (tint !== prev.tint) holder.tint = tint;
    mount.applied = { ...prev, alpha, tint };

    for (const instance of mount.fills) {
      const next = this.appliedForBox(instance.box, layer, m);
      const was = instance.applied;
      if (next.x !== was.x || next.y !== was.y) instance.content.position.set(next.x, next.y);
      if (next.rotation !== was.rotation) instance.content.rotation = next.rotation;
      if (next.scale !== was.scale) instance.content.scale.set(next.scale);
      instance.applied = next;
    }
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
    // `visible` is NOT written here — see `syncVisibility`. A sequence can hide
    // a layer the scene says is visible, and the two rulings meet in one place.
  }

  /**
   * The one place a holder's `visible` is written (B4).
   *
   * Two things decide it: the layer's own flag, and whether its `sequence`
   * block is the active one. Before B4 this was one write in `applyTransform`;
   * now that a second ruling exists, they meet here so that a resize, a
   * placeholder swap and a block change cannot disagree about what is showing.
   *
   * SHOW-THEN-DRAW, and it matters: the per-frame caller sets visibility
   * BEFORE the provider's `update`, because PixiJS v8 drops a geometry update
   * made to an invisible view — the `setWallGrid` fault, documented there. A
   * child becoming active must be visible before it draws its first frame, or
   * the GPU shows whatever it held when it was last seen.
   */
  private syncVisibility(mount: Mounted, layer: Layer): void {
    const visible = layer.visible && mount.active;
    if (mount.holder.visible !== visible) mount.holder.visible = visible;
  }

  /**
   * A fill layer's holder: identity, plus the three things that are still the
   * LAYER's and not the face's.
   *
   * Identity is what makes each mask's pixel coordinates the frame's, so a mask
   * built from a normalized path lands where the path says it does. The blend
   * mode is on the holder rather than inside the mask deliberately — I-6 says
   * every layer declares one, and `add` on dark is what the reel is shot with,
   * so it has to reach the masked instance rather than stopping at it.
   */
  private applyFillHolder(holder: Container, layer: Layer): void {
    holder.pivot.set(0, 0);
    holder.position.set(0, 0);
    holder.rotation = 0;
    holder.alpha = layer.opacity;
    holder.blendMode = toPixiBlendMode(layer.blendMode);
    // Not `visible` — `syncVisibility` owns it, as for `applyTransform`.
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
    // Rebuilt from normalized positions at the new size (I-1), not scaled — the
    // same ruling the masks take four lines down, for the same reason.
    if (this.wallGrid.visible) drawWallGrid(this.wallGrid, this.width, this.height);
    this.refreshGuides();
    for (const entry of this.entries) {
      const mount = this.mounts.get(entry.layer.id);
      if (mount?.isFill) {
        // A mask is pixels and nothing else, so a resize rebuilds its geometry
        // from the normalized path rather than scaling what is there. Scaling
        // it would put the clip half a face out at the new resolution, which is
        // the one thing on this path that I-1 exists to prevent.
        this.applyFillHolder(mount.holder, entry.layer);
        this.syncVisibility(mount, entry.layer);
        mount.applied = this.appliedFor(entry.layer, IDENTITY_MODULATION);
        for (const instance of mount.fills) {
          this.reshapeFill(instance, entry.layer, instance.surface);
        }
        continue;
      }
      if (mount) {
        this.applyTransform(mount.holder, entry.layer);
        this.syncVisibility(mount, entry.layer);
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
    // I-16 / B4. Which block of each `sequence` is showing at THIS frame's
    // time — derived from the clock through `resolveAt`, once per sequence,
    // never remembered from the previous frame. A layer in no sequence is not
    // visited: the loop is over the sequences' children, so a scene with no
    // groups pays nothing here and renders exactly as before (§8.1's
    // byte-identical goldens).
    //
    // Visibility is written BEFORE the provider updates below, and a hidden
    // child is not updated at all — see `syncVisibility` for why the order is
    // load-bearing and not a tidy-up. "Hidden, not dismounted": the view, its
    // textures and its decoder stay resident; only its holder is off.
    for (const group of this.sequences) {
      const position = resolveAt(group, frame.timeSeconds);
      for (const child of group.children) {
        const mount = this.mounts.get(child.id);
        if (!mount) continue;
        const active = position !== null && position.child.id === child.id;
        if (mount.active === active) continue;
        mount.active = active;
        const entry = this.entries.find((e) => e.layer.id === child.id);
        if (entry) this.syncVisibility(mount, entry.layer);
      }
    }

    const changed = isolateUpdate<LayerView>(
      this.entries,
      (entry) => {
        // An inactive sequence child is resident but not drawn into: its
        // geometry update would be dropped by an invisible view anyway, and a
        // decoder or a Lottie player that must be told about time is told the
        // frame it comes back — `update` runs before `render`, so the block
        // that becomes active draws its first frame at the right time.
        if (this.mounts.get(entry.layer.id)?.active === false) return;
        entry.view.update(frame);
      },
      (info) => this.createPlaceholder(info),
      this.onLayerFailed,
    );
    for (const entry of changed) {
      const mount = this.mounts.get(entry.layer.id);
      if (!mount) continue;
      mount.holder.removeChildren();
      if (mount.isFill) {
        // A fill instance threw, so the LAYER is now a placeholder — and a
        // placeholder is drawn at the layer's own transform, which a fill
        // holder was holding at identity. Restore it, or the magenta box lands
        // in the frame's corner at the size of a face.
        //
        // The instances are destroyed here rather than merely detached:
        // `isolateUpdate` has already replaced the view, so this is the last
        // reference to N containers and N masks and nothing else will free them.
        for (const instance of mount.fills) {
          try {
            instance.view.destroy();
          } catch {
            // As in `teardownLayers`: one bad teardown must not strand the rest.
          }
          instance.container.destroy({ children: true });
        }
        mount.fills = [];
        mount.isFill = false;
        this.applyTransform(mount.holder, entry.layer);
        mount.applied = this.appliedFor(entry.layer, IDENTITY_MODULATION);
      }
      mount.holder.addChild(entry.view.view);
      this.syncVisibility(mount, entry.layer);
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
      const forces = frame.forces.modulationFor(entry.layer);
      if (mount.isFill) {
        this.writeFillModulation(mount, entry.layer, forces);
        continue;
      }
      // B5 / I-18. `base → motion → forces`: the route's contribution goes in
      // under the forces, and the heading (if `orient`) replaces the base
      // rotation. A layer with no route takes exactly the pre-B5 path.
      if (mount.route !== null && entry.layer.motion !== undefined) {
        const composed = composeAxes(
          forces,
          this.travelWrites(entry.layer, mount.route, entry.layer.motion, frame.timeSeconds),
        );
        this.writeModulation(
          mount,
          this.appliedFor(entry.layer, composed.modulation, composed.rotateOverride),
        );
        continue;
      }
      this.writeModulation(mount, this.appliedFor(entry.layer, forces));
    }
  }

  /**
   * I-13's OTHER flag: fills that landed nowhere.
   *
   * Deliberately not folded into `failures()`. A failure draws a magenta
   * placeholder; a role miss draws nothing at all, on purpose, and reporting
   * the two through one channel would eventually put a magenta box on a wall
   * for a mistyped role.
   */
  roleMisses(): RoleMiss[] {
    return [...this.misses];
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
