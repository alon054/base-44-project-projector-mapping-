/**
 * Structural scene edits: which layers exist, and in what order.
 *
 * These are separate from the I-8 registry on purpose. A parameter is a value
 * on a layer that exists; adding and deleting layers is a change to the set the
 * registry indexes, so it cannot be one of the things the registry addresses.
 *
 * Pure functions rather than methods on a component, because Gate 1 asks
 * whether reordering changes occlusion correctly, and that should be answerable
 * by a unit test rather than only by clicking. Phase 6's history (D12) snapshots
 * the results of these.
 */
import {
  clamp01,
  createLayer,
  type BlendMode,
  type JsonObject,
  type Layer,
  type NormalizedTransform,
} from './layer';
import { layersInDrawOrder, reindexZOrder, type Scene } from './scene';

/**
 * The smallest a region may be made, in normalized units (I-1).
 *
 * A clamp rather than a refusal, and load-bearing rather than cosmetic: a
 * region dragged to zero width is invisible, unhittable and therefore
 * unrecoverable without editing the JSON by hand — a state the editor can
 * reach in one gesture and cannot leave in any. Same reasoning as `clamp01`:
 * the value drifted somewhere useless, so it is pulled back rather than
 * rejected.
 */
export const MIN_LAYER_EXTENT = 0.02;

/** A normalized box: centre plus extents, exactly `NormalizedTransform` minus rotation (I-1). */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A structural edit was asked for with a value that is not a number at all.
 *
 * The clamp-versus-refuse rule Block A settled (`core/paths.ts`): a coordinate
 * outside `[0, 1]` is float drift and is clamped, while a non-finite one is not
 * an out-of-range number — it is the arithmetic having gone wrong upstream, and
 * `clamp01(NaN)` would silently teleport a region to the top-left corner. That
 * is the plausible-wrong-answer failure A9 names, so it is refused with the
 * layer, the field and the offending value in the message.
 */
export class SceneEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneEditError';
  }
}

export interface AddLayerSpec {
  providerId: string;
  content: JsonObject;
  /** Prefix for the generated id. The suffix makes it unique in the scene. */
  idPrefix: string;
  name?: string;
  blendMode?: BlendMode;
  /**
   * Where the layer goes, normalized (I-1). Absent means the staggered default
   * below — which is what the layer-list buttons want, since they name no
   * place. A region drawn on the preview names one, and it wins.
   */
  rect?: NormalizedRect;
}

/**
 * Distinct, deterministic tints for added layers. Not decoration: two layers
 * that look identical cannot demonstrate z-order, and Gate 1 asks whether
 * reordering changes occlusion *correctly* — a question that needs the answer
 * to be visible. Fixed rather than random so a scene built by clicking is still
 * reproducible from its JSON (I-12).
 */
const ADDED_TINTS = [0xd02020, 0x2040d0, 0x20c060, 0xd0a020, 0xa040d0, 0x20c0d0] as const;

/**
 * Appends a layer at the top of the draw order with a unique id.
 *
 * The id has to be unique for two independent reasons, and either alone would
 * be enough: `entity.<id>.*` keys must not collide (I-8), and the scene format
 * refuses a duplicate layer id outright.
 */
export function addLayer(scene: Scene, spec: AddLayerSpec): Scene {
  let n = 1;
  while (scene.layers.some((l) => l.id === `${spec.idPrefix}-${n}`)) n++;
  const id = `${spec.idPrefix}-${n}`;
  const nth = scene.layers.length;
  return reindexZOrder({
    ...scene,
    layers: [
      ...scene.layers,
      createLayer({
        id,
        name: spec.name ?? `${spec.idPrefix} ${n}`,
        providerId: spec.providerId,
        // A caller-supplied tint always wins; this only fills the gap so that
        // two layers of the same kind are not the same colour.
        content:
          spec.content['tint'] === undefined
            ? { ...spec.content, tint: ADDED_TINTS[nth % ADDED_TINTS.length] as number }
            : spec.content,
        zOrder: scene.layers.length,
        // A drawn rect wins. Without one: half-frame, and STAGGERED rather than
        // centred. Every added layer used to land on exactly the same box with
        // the same default colour, so two of them were pixel-identical and
        // reordering them changed nothing on screen — the engine was right and
        // the scene could not show it. That stagger is still what the layer-list
        // buttons need, because a button names no place; P5-B's gesture does,
        // which is the case the branch above exists for.
        transform: spec.rect
          ? { ...normalizeRectFields(spec.rect, id), rotation: 0 }
          : {
              x: 0.5 + (((nth % 3) - 1) * 0.12),
              y: 0.5 + (((Math.floor(nth / 3) % 3) - 1) * 0.12),
              width: 0.5,
              height: 0.5,
              rotation: 0,
            },
        ...(spec.blendMode ? { blendMode: spec.blendMode } : {}),
      }),
    ],
  });
}

/**
 * The one structural removal in the engine, and therefore the one place a
 * layer's GPU resources can be orphaned.
 *
 * **Disposal is not this function's job and must not become it.** Every scene
 * this returns reaches the renderer through `RenderHost.setScene`, and
 * `Compositor.setScene` opens by tearing the whole stack down — every provider
 * view destroyed, every holder destroyed — before rebuilding from the new
 * state. So a layer that leaves the scene here has its texture released by the
 * next `setScene`, with no call for a caller to remember and no second removal
 * path to keep in step. That is the mechanism; a `dispose()` call added here
 * would be a guard beside it, and a second one to forget.
 *
 * `sceneEdit.test.ts` asserts the teardown-first ordering in the compositor, so
 * the claim above fails a test rather than a soak if someone reorders it.
 */
export function removeLayer(scene: Scene, id: string): Scene {
  return reindexZOrder({ ...scene, layers: scene.layers.filter((l) => l.id !== id) });
}

/**
 * Sets a layer's normalized box — the mutation behind both dragging a region
 * and dragging its corner handle.
 *
 * One function for move and scale rather than two, because a corner drag is
 * *both*: the opposite corner stays put, so the centre moves as the size
 * changes. Two functions would mean two writes per gesture and an intermediate
 * state where the region has its new size at its old centre.
 *
 * **`rotation` is not a field here.** It exists on the stored transform, in
 * turns, and this block ships no gesture that writes it (CHECKLIST P5-B). A
 * partial write that carried rotation would be a rotate handle with no handle.
 *
 * Absent fields are left alone; present ones are clamped into `[0, 1]` and the
 * extents to at least `MIN_LAYER_EXTENT`; non-numbers are refused. Unknown ids
 * return the scene unchanged, which is what `moveLayer` and `reorderLayer`
 * already do — a pointer gesture against a layer that has since been deleted is
 * a race, not a corrupt request.
 */
export function setLayerRect(scene: Scene, id: string, rect: Partial<NormalizedRect>): Scene {
  if (!scene.layers.some((l) => l.id === id)) return scene;
  return {
    ...scene,
    layers: scene.layers.map((l) =>
      l.id === id ? { ...l, transform: applyRect(l.transform, rect, id) } : l,
    ),
  };
}

function applyRect(
  t: NormalizedTransform,
  rect: Partial<NormalizedRect>,
  layerId: string,
): NormalizedTransform {
  const next: NormalizedTransform = { ...t };
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const v = rect[field];
    if (v === undefined) continue;
    next[field] = checkedCoordinate(v, field, layerId);
  }
  // The extents only. A centre AT the frame edge is a region half off-screen,
  // which is a legitimate thing to want on a wall; a zero-width region is not.
  next.width = Math.max(MIN_LAYER_EXTENT, next.width);
  next.height = Math.max(MIN_LAYER_EXTENT, next.height);
  return next;
}

/** Every normalized field entering stored state from a gesture passes here. */
function checkedCoordinate(v: number, field: string, layerId: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SceneEditError(
      `layer "${layerId}": ${field} must be a finite number, got ${JSON.stringify(v)}`,
    );
  }
  return clamp01(v);
}

function normalizeRectFields(rect: NormalizedRect, layerId: string): NormalizedRect {
  return {
    x: checkedCoordinate(rect.x, 'x', layerId),
    y: checkedCoordinate(rect.y, 'y', layerId),
    width: Math.max(MIN_LAYER_EXTENT, checkedCoordinate(rect.width, 'width', layerId)),
    height: Math.max(MIN_LAYER_EXTENT, checkedCoordinate(rect.height, 'height', layerId)),
  };
}

/**
 * Moves a layer through the draw order. `delta` is +1 towards the front.
 *
 * Returns the scene unchanged at either end rather than wrapping — a layer that
 * jumped from the back to the front because the operator pressed the button
 * once too often is a surprise in a live session.
 */
/**
 * Moves a layer to an absolute position in the draw order. Backs drag-and-drop,
 * where the operator names a destination rather than a direction.
 *
 * Out-of-range destinations are **clamped**, unlike `moveLayer`, which returns
 * the scene unchanged. The difference is deliberate and follows the gesture:
 * a button press past the end is a mistake and should do nothing, while a drag
 * past the end is an unambiguous request for "put it at the end".
 */
export function reorderLayer(scene: Scene, id: string, toIndex: number): Scene {
  const order = layersInDrawOrder(scene);
  const from = order.findIndex((l) => l.id === id);
  if (from < 0) return scene;
  const to = Math.max(0, Math.min(order.length - 1, Math.floor(toIndex)));
  if (to === from) return scene;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as Layer);
  // Same rule as `moveLayer`: zOrder comes from the new ARRAY position, never
  // from `reindexZOrder`, which would re-sort by the values being changed.
  return { ...scene, layers: next.map((l, k) => ({ ...l, zOrder: k })) };
}

export function moveLayer(scene: Scene, id: string, delta: number): Scene {
  const order = layersInDrawOrder(scene);
  const i = order.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return scene;
  const swapped = [...order];
  const a = swapped[i] as Layer;
  const b = swapped[j] as Layer;
  swapped[i] = b;
  swapped[j] = a;
  // `zOrder` is assigned from the new ARRAY position, not re-derived by
  // `reindexZOrder`. That function re-indexes by current draw order, which for
  // a swap means sorting by the very `zOrder` values the swap was meant to
  // exchange — it puts the layers straight back where they were. Correct for
  // add and remove, silently a no-op here.
  return { ...scene, layers: swapped.map((l, k) => ({ ...l, zOrder: k })) };
}
