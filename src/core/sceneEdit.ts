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
  return reindexZOrder({
    ...scene,
    layers: [
      ...scene.layers,
      createLayer({
        id,
        name: spec.name ?? `${spec.idPrefix} ${n}`,
        providerId: spec.providerId,
        content: spec.content,
        zOrder: scene.layers.length,
        // Half-frame and centred, so a new layer is visible without a placement
        // gesture. Region placement is Phase 5.
        transform: { x: 0.5, y: 0.5, width: 0.5, height: 0.5, rotation: 0 },
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
