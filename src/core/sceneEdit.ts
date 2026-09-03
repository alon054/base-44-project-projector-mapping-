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
import { createLayer, type BlendMode, type JsonObject, type Layer } from './layer';
import { layersInDrawOrder, reindexZOrder, type Scene } from './scene';

export interface AddLayerSpec {
  providerId: string;
  content: JsonObject;
  /** Prefix for the generated id. The suffix makes it unique in the scene. */
  idPrefix: string;
  name?: string;
  blendMode?: BlendMode;
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
        // Half-frame, and STAGGERED rather than centred. Every added layer used
        // to land on exactly the same box with the same default colour, so two
        // of them were pixel-identical and reordering them changed nothing on
        // screen — the engine was right and the scene could not show it.
        // Region placement is Phase 5; until then a new layer has to be
        // distinguishable from the last one without a gesture.
        transform: {
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

export function removeLayer(scene: Scene, id: string): Scene {
  return reindexZOrder({ ...scene, layers: scene.layers.filter((l) => l.id !== id) });
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
