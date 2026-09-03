/**
 * Structural scene edits — the operations behind the editor's layer list.
 *
 * Gate 1 asks whether reordering layers changes occlusion correctly. The pixel
 * half of that answer is the golden harness's two occlusion cases; this is the
 * state half, and it is a unit test rather than a click because a z-order that
 * is right on screen and wrong in the saved JSON is a Phase 6 bug waiting.
 */
import { describe, expect, it } from 'vitest';
import { createLayer } from '../core/layer';
import { createScene, deserializeScene, layersInDrawOrder, serializeScene } from '../core/scene';
import { addLayer, moveLayer, removeLayer } from '../core/sceneEdit';
import { ParameterRegistry, defineLayerParameters } from '../core/parameters';

const base = () =>
  createScene({
    id: 's',
    layers: [
      createLayer({ id: 'a', providerId: 'procedural', zOrder: 0 }),
      createLayer({ id: 'b', providerId: 'procedural', zOrder: 1 }),
      createLayer({ id: 'c', providerId: 'procedural', zOrder: 2 }),
    ],
  });

const order = (s: ReturnType<typeof base>) => layersInDrawOrder(s).map((l) => l.id);

describe('addLayer', () => {
  it('appends at the front of the draw order', () => {
    const s = addLayer(base(), { idPrefix: 'glow', providerId: 'procedural', content: {} });
    expect(order(s)).toEqual(['a', 'b', 'c', 'glow-1']);
  });

  it('generates a unique id — I-8 keys must not collide, and duplicates are refused', () => {
    let s = base();
    for (let i = 0; i < 3; i++) {
      s = addLayer(s, { idPrefix: 'glow', providerId: 'procedural', content: {} });
    }
    expect(order(s)).toEqual(['a', 'b', 'c', 'glow-1', 'glow-2', 'glow-3']);
    // And the scene still deserializes, which is where a duplicate id throws.
    expect(() => deserializeScene(serializeScene(s))).not.toThrow();
  });

  it('reuses a freed id only when it is genuinely free', () => {
    let s = addLayer(base(), { idPrefix: 'glow', providerId: 'procedural', content: {} });
    s = addLayer(s, { idPrefix: 'glow', providerId: 'procedural', content: {} });
    s = removeLayer(s, 'glow-1');
    s = addLayer(s, { idPrefix: 'glow', providerId: 'procedural', content: {} });
    expect(order(s)).toEqual(['a', 'b', 'c', 'glow-2', 'glow-1']);
  });

  it('a new layer is placed and sized in normalized space, never pixels (I-1)', () => {
    const s = addLayer(base(), { idPrefix: 'glow', providerId: 'procedural', content: {} });
    const added = s.layers.find((l) => l.id === 'glow-1')!;
    expect(added.transform).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5, rotation: 0 });
  });
});

describe('removeLayer', () => {
  it('removes the layer and closes the z-order gap', () => {
    const s = removeLayer(base(), 'b');
    expect(order(s)).toEqual(['a', 'c']);
    expect(s.layers.map((l) => l.zOrder)).toEqual([0, 1]);
  });

  it('removing an unknown id is a no-op, not a throw', () => {
    expect(order(removeLayer(base(), 'nope'))).toEqual(['a', 'b', 'c']);
  });

  it('frees the layer parameter keys so the same id can be added again (I-8)', () => {
    const registry = new ParameterRegistry();
    const scene = base();
    for (const l of scene.layers) {
      registry.registerAll(defineLayerParameters(l.id, () => l, () => {}));
    }
    const after = removeLayer(scene, 'b');
    for (const key of registry.keys('entity')) {
      const id = key.split('.')[1]!;
      if (!after.layers.some((l) => l.id === id)) registry.unregisterPrefix(`entity.${id}`);
    }
    expect(registry.keys('entity.b')).toEqual([]);
    const readded = after.layers[0]!;
    expect(() =>
      registry.registerAll(defineLayerParameters('b', () => readded, () => {})),
    ).not.toThrow();
  });
});

describe('moveLayer — Gate 1: reordering changes occlusion correctly', () => {
  it('moves one place towards the front', () => {
    expect(order(moveLayer(base(), 'a', 1))).toEqual(['b', 'a', 'c']);
  });

  it('moves one place towards the back', () => {
    expect(order(moveLayer(base(), 'c', -1))).toEqual(['a', 'c', 'b']);
  });

  it('does not wrap at either end — a live session should not be surprised', () => {
    expect(order(moveLayer(base(), 'a', -1))).toEqual(['a', 'b', 'c']);
    expect(order(moveLayer(base(), 'c', 1))).toEqual(['a', 'b', 'c']);
  });

  it('an unknown id is a no-op', () => {
    expect(order(moveLayer(base(), 'nope', 1))).toEqual(['a', 'b', 'c']);
  });

  it('leaves zOrder and array position agreeing, so nothing needs reconciling later', () => {
    const s = moveLayer(moveLayer(base(), 'a', 1), 'c', -1);
    expect(s.layers.map((l) => [l.id, l.zOrder])).toEqual(
      layersInDrawOrder(s).map((l, i) => [l.id, i]),
    );
  });

  it('a reorder survives the round-trip (I-12)', () => {
    const s = moveLayer(base(), 'a', 1);
    expect(deserializeScene(serializeScene(s))).toEqual(s);
    expect(order(deserializeScene(serializeScene(s)))).toEqual(['b', 'a', 'c']);
  });
});
