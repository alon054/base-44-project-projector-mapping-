/**
 * Keeps an I-8 parameter registry bound to the editor's scene.
 *
 * This is what stops the registry from being decorative. Every per-layer
 * control in the editor writes through `registry.write('entity.<id>.opacity', v)`
 * rather than reaching into the layer directly, so I-8's "every parameter is
 * addressable" is exercised by the only code that edits parameters, from
 * Phase 1 — instead of being a table nothing reads until Phase 11 asks it to
 * carry MIDI.
 *
 * The accessors read through a ref rather than a captured value: React state is
 * immutable and a captured `scene` goes stale the moment anything writes, which
 * would make `registry.read` return the value from before the last edit.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Layer } from '../core/layer';
import {
  ParameterRegistry,
  defineLayerParameters,
  defineTestPatternSpeed,
} from '../core/parameters';
import type { Scene } from '../core/scene';

export function useSceneRegistry(
  scene: Scene,
  setScene: (update: (prev: Scene) => Scene) => void,
): ParameterRegistry {
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const registry = useMemo(() => {
    const r = new ParameterRegistry();
    // Rule 9 / I-8: the Phase 0 debug knob lives here too, not in a special case.
    r.register(defineTestPatternSpeed());
    return r;
  }, []);

  // Keyed on the layer ids, not the scene: re-registering on every opacity
  // change would churn the registry sixty times a drag for no change in its
  // key set.
  const layerIds = scene.layers.map((l) => l.id).join(' ');

  useEffect(() => {
    const ids = layerIds === '' ? [] : layerIds.split(' ');
    for (const id of ids) {
      if (registry.has(`entity.${id}.opacity`)) continue;
      registry.registerAll(
        defineLayerParameters(
          id,
          () => {
            const layer = sceneRef.current.layers.find((l) => l.id === id);
            if (!layer) throw new Error(`layer ${id} is gone`);
            return layer;
          },
          (patch: Partial<Layer>) => {
            setScene((prev) => ({
              ...prev,
              layers: prev.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
            }));
          },
        ),
      );
    }
    // A deleted layer must give its keys back, or re-adding a layer with the
    // same id collides and the operator sees a crash on an ordinary edit.
    const live = new Set(ids);
    for (const key of registry.keys('entity')) {
      const id = key.split('.')[1];
      if (id !== undefined && !live.has(id)) registry.unregisterPrefix(`entity.${id}`);
    }
  }, [layerIds, registry, setScene]);

  return registry;
}
