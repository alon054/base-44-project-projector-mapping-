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
 *
 * **The binding itself lives in `sceneRegistry.ts`, which has no React in it.**
 * P5-F's gate condition is that a scene edited only through the panel
 * round-trips deep-equal, and that cannot be checked while the only path to the
 * panel's writes runs through a hook. This file is the shell: refs, effects,
 * and the one thing the pure module refuses to import — the provider registry.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ParameterRegistry, defineTestPatternSpeed } from '../core/parameters';
import { ProviderRegistry } from '../providers/ContentProvider';
import { ProceduralProvider } from '../providers/procedural/ProceduralProvider';
import { BundledProvider } from '../providers/bundled/BundledProvider';
import { editorLibrary } from './assets';
import type { Scene } from '../core/scene';
import { layerSignature, registerGlobalParameters, syncEntityParameters } from './sceneRegistry';

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
  new BundledProvider({ library: editorLibrary, decodeVideo: false, lottieResolution: 1 }),
);

export function useSceneRegistry(
  scene: Scene,
  setScene: (update: (prev: Scene) => Scene) => void,
): ParameterRegistry {
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const read = useRef(() => sceneRef.current).current;

  const registry = useMemo(() => {
    const r = new ParameterRegistry();
    // Rule 9 / I-8: the Phase 0 debug knob lives here too, not in a special case.
    r.register(defineTestPatternSpeed());
    return r;
  }, []);

  // I-8 / I-14 / Gate 4: "every force is enumerable from the parameter registry
  // by hierarchical key". Registered once, from `FORCE_DEFINITIONS`, outside
  // the per-layer effect — a fifth force appears by existing.
  useEffect(() => {
    registerGlobalParameters(registry, read, setScene);
  }, [registry, read, setScene]);

  // Keyed on the layers' identity and structure, not the whole scene:
  // re-running this on every opacity change would churn the registry sixty
  // times a drag for no change in its key set. A provider or a structural
  // content key changing DOES change the key set, which is why the signature
  // carries them — see `layerSignature`.
  const signature = layerSignature(scene);

  useEffect(() => {
    syncEntityParameters(registry, read, setScene, (layer) =>
      providers.get(layer.providerId)?.contentParameters?.(layer.content) ?? [],
    );
    // `signature` is the dependency; `scene` deliberately is not.
  }, [signature, registry, read, setScene]);

  return registry;
}
