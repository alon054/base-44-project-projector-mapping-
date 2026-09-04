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
  defineContentParameters,
  defineLayerParameters,
  defineTestPatternSpeed,
} from '../core/parameters';
import { ProviderRegistry } from '../providers/ContentProvider';
import { ProceduralProvider } from '../providers/procedural/ProceduralProvider';
import { BundledProvider } from '../providers/bundled/BundledProvider';
import { createBundledLibrary } from '../providers/bundled/manifest';
import type { Scene } from '../core/scene';

/**
 * The editor's own provider registry. It exists only to ask providers which
 * content keys they expose (rule 9); the editor never renders through it —
 * that is the output window's and the preview's job (I-7).
 */
const providers = new ProviderRegistry();
providers.register(new ProceduralProvider());
// Rule 9: the bundled provider's content keys must be addressable too, or the
// per-layer seam control would be an editable value living outside the registry
// — the exact hole I-8 exists to prevent. Nothing here renders (the flags below
// are inert for `contentParameters`), it only answers "what keys do you expose".
providers.register(
  new BundledProvider({ library: createBundledLibrary(), decodeVideo: false, lottieResolution: 1 }),
);

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
      const readLayer = () => {
        const layer = sceneRef.current.layers.find((l) => l.id === id);
        if (!layer) throw new Error(`layer ${id} is gone`);
        return layer;
      };
      const patchLayer = (patch: Partial<Layer>): void => {
        setScene((prev) => ({
          ...prev,
          layers: prev.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        }));
      };
      registry.registerAll(defineLayerParameters(id, readLayer, patchLayer));

      // Rule 9: whatever the provider invented is addressable too, or half the
      // instrument is unreachable when Phase 11 goes looking for it.
      const layer = readLayer();
      const specs = providers.get(layer.providerId)?.contentParameters?.(layer.content) ?? [];
      registry.registerAll(
        defineContentParameters(id, specs, readLayer, (content) => patchLayer({ content })),
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
