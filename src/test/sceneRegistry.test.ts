/**
 * The control panel's writes, as the panel makes them (P5-F).
 *
 * P5-F's gate condition is "every control writes through the registry · a scene
 * edited only through the panel round-trips deep-equal". Both halves are about
 * the binding between the registry and scene state, and neither can be checked
 * through a React hook in a node environment — which is why `sceneRegistry.ts`
 * has no React in it. What is exercised here is the code the panel runs, not a
 * re-implementation of it: `registerGlobalParameters` and `syncEntityParameters`
 * are the same two functions `useSceneRegistry` calls, and every write below
 * goes through `registry.write(key, value)` exactly as `<ParamControl>` does.
 *
 * The provider is injected rather than imported (SPEC.md §8.1: no DOM), so the
 * content specs here are `ProceduralProvider`'s own — the real ones, from the
 * real provider, without dragging `lottie-web` into a unit test.
 */
import { describe, expect, it } from 'vitest';
import { ParameterRegistry } from '../core/parameters';
import { createLayer, type Layer } from '../core/layer';
import {
  createScene,
  deepEqual,
  deserializeScene,
  serializeScene,
  type Scene,
} from '../core/scene';
import { DEFAULT_ROUTE_MOTION } from '../core/motion';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import { removeLayer } from '../core/sceneEdit';
import {
  layerSignature,
  registerGlobalParameters,
  syncEntityParameters,
} from '../editor/sceneRegistry';
import {
  applyContentChoice,
  contentChoices,
  contentKeysOf,
  entityParamGroups,
} from '../editor/controls';
import { ProceduralProvider } from '../providers/procedural/ProceduralProvider';

const provider = new ProceduralProvider();
const specsFor = (layer: Layer) => provider.contentParameters(layer.content);

/**
 * A scene plus the registry bound to it, wired the way the editor wires them.
 *
 * `sync()` is the effect: the editor re-runs `syncEntityParameters` when
 * `layerSignature` changes, and so does every structural edit below.
 */
function bind(initial: Scene) {
  let scene = initial;
  const read = () => scene;
  const setScene = (update: (prev: Scene) => Scene): void => {
    scene = update(scene);
  };
  const registry = new ParameterRegistry();
  registerGlobalParameters(registry, read, setScene);
  const sync = () => syncEntityParameters(registry, read, setScene, specsFor);
  sync();
  return { registry, read, setScene, sync };
}

const waterScene = (): Scene =>
  createScene({
    id: 'panel',
    layers: [
      createLayer({ id: 'sea', providerId: 'procedural', content: { kind: 'water', tint: 0x2040d0 } }),
      createLayer({ id: 'lamp', providerId: 'procedural', content: { kind: 'glow' }, zOrder: 1 }),
    ],
  });

describe('the registry is bound to every parameter the panel draws', () => {
  it('registers the layer, content, motion and susceptibility families per layer', () => {
    const { registry } = bind(waterScene());
    const groups = entityParamGroups(registry, 'sea');
    expect(groups.layer.sort()).toEqual([
      'entity.sea.blendMode',
      'entity.sea.depth',
      // B3. Grouped with the LAYER family, not with content — `contentKeysOf`
      // is what decides whether a layer's subtree needs rebuilding, and a
      // `fillRole` counted as content would never match any provider's spec
      // list, so every layer would be torn down and rebuilt on every sync.
      'entity.sea.fillRole',
      'entity.sea.opacity',
      'entity.sea.visible',
    ]);
    // Whatever the provider declared for `water`, and only that (rule 9).
    expect(contentKeysOf(registry, 'sea').sort()).toEqual(['bands', 'bodyAlpha', 'tint']);
    expect(groups.motion).toEqual([
      'entity.sea.motion.endBehavior',
      'entity.sea.motion.orient',
      'entity.sea.motion.periodSeconds',
      'entity.sea.motion.phaseOffset',
    ]);
    expect(groups.susceptibility).toHaveLength(FORCE_DEFINITIONS.length);
  });

  it('every key the panel would draw resolves to a definition it can render', () => {
    // The panel renders a control per key and reads `min`/`max`/`options` off
    // the definition. A key with no definition is a control that writes
    // nowhere, which is the whole failure I-8 exists to prevent.
    const { registry } = bind(waterScene());
    for (const id of ['sea', 'lamp']) {
      const g = entityParamGroups(registry, id);
      for (const key of [...g.layer, ...g.content, ...g.motion, ...g.susceptibility]) {
        expect(registry.definition(key), key).toBeDefined();
      }
    }
  });

  it('gives a deleted layer its keys back, so re-adding the id does not collide', () => {
    const { registry, setScene, sync } = bind(waterScene());
    expect(registry.keys('entity.lamp').length).toBeGreaterThan(0);
    setScene((prev) => removeLayer(prev, 'lamp'));
    sync();
    expect(registry.keys('entity.lamp')).toEqual([]);
  });
});

describe('every control writes through the registry, and lands in scene state', () => {
  it('a layer-level write reaches the layer', () => {
    const { registry, read } = bind(waterScene());
    registry.write('entity.sea.opacity', 0.25);
    registry.write('entity.sea.depth', 0.8);
    registry.write('entity.sea.visible', false);
    registry.write('entity.sea.blendMode', 'add');
    const layer = read().layers.find((l) => l.id === 'sea')!;
    expect(layer.opacity).toBe(0.25);
    expect(layer.depth).toBe(0.8);
    expect(layer.visible).toBe(false);
    expect(layer.blendMode).toBe('add');
  });

  it('a content write reaches the content blob and nothing else', () => {
    const { registry, read } = bind(waterScene());
    registry.write('entity.sea.bands', 30);
    const layer = read().layers.find((l) => l.id === 'sea')!;
    expect(layer.content['bands']).toBe(30);
    expect(layer.content['kind']).toBe('water');
  });

  it('a force write reaches scene.forces and a susceptibility write reaches the layer', () => {
    const { registry, read } = bind(waterScene());
    registry.write('force.wind.strength', 0.42);
    registry.write('entity.sea.susceptibility.wind', 0.3);
    expect(read().forces['wind']?.['strength']).toBe(0.42);
    expect(read().layers.find((l) => l.id === 'sea')!.susceptibility['wind']).toBe(0.3);
  });

  it('clamps a number outside its range rather than refusing it', () => {
    // The registry's own rule, exercised through the panel's path: a control
    // dragged to its stop, or a MIDI knob overshooting in Phase 11, must not
    // leave the value silently dead at the top of its travel.
    const { registry, read } = bind(waterScene());
    expect(registry.write('entity.sea.opacity', 4)).toBe(1);
    expect(read().layers.find((l) => l.id === 'sea')!.opacity).toBe(1);
  });
});

describe('the motion panel — I-18, the four fields P5-C registered', () => {
  it('reports the stated defaults for a layer that has declared no motion', () => {
    const { registry, read } = bind(waterScene());
    expect(read().layers.find((l) => l.id === 'sea')!.motion).toBeUndefined();
    expect(registry.read('entity.sea.motion.periodSeconds')).toBe(
      DEFAULT_ROUTE_MOTION.periodSeconds,
    );
    expect(registry.read('entity.sea.motion.orient')).toBe(DEFAULT_ROUTE_MOTION.orient);
    expect(registry.read('entity.sea.motion.endBehavior')).toBe(DEFAULT_ROUTE_MOTION.endBehavior);
    expect(registry.read('entity.sea.motion.phaseOffset')).toBe(DEFAULT_ROUTE_MOTION.phaseOffset);
  });

  it('the first write declares a whole record, not a fragment', () => {
    // A shallow patch would store `{ periodSeconds: 12 }` and leave the other
    // three fields to whatever a future build's defaults happen to be — which
    // is the "a scene must reproduce against more than the build that wrote
    // it" argument scene.forces is dense for.
    const { registry, read } = bind(waterScene());
    registry.write('entity.sea.motion.periodSeconds', 12);
    expect(read().layers.find((l) => l.id === 'sea')!.motion).toEqual({
      ...DEFAULT_ROUTE_MOTION,
      periodSeconds: 12,
    });
  });

  it('each of the four fields writes independently', () => {
    const { registry, read } = bind(waterScene());
    registry.write('entity.sea.motion.periodSeconds', 8);
    registry.write('entity.sea.motion.orient', true);
    registry.write('entity.sea.motion.endBehavior', 'pingpong');
    registry.write('entity.sea.motion.phaseOffset', 0.5);
    expect(read().layers.find((l) => l.id === 'sea')!.motion).toEqual({
      periodSeconds: 8,
      orient: true,
      endBehavior: 'pingpong',
      phaseOffset: 0.5,
    });
  });

  it('two entities on one route differ only by phase offset — Gate 5, from the panel', () => {
    const { registry, read } = bind(waterScene());
    for (const id of ['sea', 'lamp']) {
      registry.write(`entity.${id}.motion.periodSeconds`, 6);
      registry.write(`entity.${id}.motion.orient`, true);
    }
    registry.write('entity.lamp.motion.phaseOffset', 0.5);
    const [a, b] = read().layers.map((l) => l.motion!);
    expect({ ...a, phaseOffset: 0 }).toEqual({ ...b!, phaseOffset: 0 });
    expect(a!.phaseOffset).not.toBe(b!.phaseOffset);
  });

  it('refuses an end behaviour this build does not know, and keeps the old one', () => {
    const { registry, read } = bind(waterScene());
    registry.write('entity.sea.motion.endBehavior', 'hold');
    expect(() => registry.write('entity.sea.motion.endBehavior', 'boomerang')).toThrow(
      /boomerang/,
    );
    expect(read().layers.find((l) => l.id === 'sea')!.motion!.endBehavior).toBe('hold');
  });
});

describe('the content picker re-registers what the new content exposes', () => {
  const choices = contentChoices([]);
  const choice = (kind: string) => choices.find((c) => c.id === `procedural:${kind}`)!;

  it('drops the old kind’s keys and registers the new one’s', () => {
    // Keyed on the layer id alone, this is the failure: `bands` stays
    // registered against a layer that is now a glow, `rings` never appears,
    // and the panel shows a control that writes to a value nothing reads.
    const { registry, read, setScene, sync } = bind(waterScene());
    expect(contentKeysOf(registry, 'sea').sort()).toEqual(['bands', 'bodyAlpha', 'tint']);
    setScene((prev) => applyContentChoice(prev, 'sea', choice('glow')));
    sync();
    expect(contentKeysOf(registry, 'sea').sort()).toEqual(['rings', 'tint']);
    expect(read().layers.find((l) => l.id === 'sea')!.content['kind']).toBe('glow');
  });

  it('the new keys write, and the layer keeps its identity and its tint', () => {
    const { registry, read, setScene, sync } = bind(waterScene());
    setScene((prev) => applyContentChoice(prev, 'sea', choice('glow')));
    sync();
    registry.write('entity.sea.rings', 40);
    const layer = read().layers.find((l) => l.id === 'sea')!;
    expect(layer.content).toEqual({ kind: 'glow', tint: 0x2040d0, rings: 40 });
    expect(layer.id).toBe('sea');
  });

  it('leaves a layer alone when the key set does not change', () => {
    // `tree` and `rect` both expose exactly `tint`. Rebuilding the subtree
    // would be harmless but pointless, and the check that decides is asked of
    // the registry rather than of a signature kept beside it.
    const { registry, setScene, sync } = bind(waterScene());
    setScene((prev) => applyContentChoice(prev, 'sea', choice('tree')));
    sync();
    const before = registry.read('entity.sea.tint');
    setScene((prev) => applyContentChoice(prev, 'sea', choice('rect')));
    sync();
    expect(contentKeysOf(registry, 'sea')).toEqual(['tint']);
    expect(registry.read('entity.sea.tint')).toBe(before);
  });

  it('the signature the editor watches changes on a structural edit and not on a value one', () => {
    let scene = waterScene();
    const before = layerSignature(scene);
    scene = {
      ...scene,
      layers: scene.layers.map((l) => (l.id === 'sea' ? { ...l, opacity: 0.1 } : l)),
    };
    expect(layerSignature(scene)).toBe(before);
    scene = applyContentChoice(scene, 'sea', choice('glow'));
    expect(layerSignature(scene)).not.toBe(before);
  });
});

describe('a scene edited only through the panel round-trips deep-equal', () => {
  it('survives a full session of parameter writes and structural edits', () => {
    const { registry, read, setScene, sync } = bind(waterScene());
    const choices = contentChoices([]);

    // Everything the panel can do, in the order an operator might do it.
    registry.write('entity.sea.opacity', 0.37);
    registry.write('entity.sea.depth', 0.91);
    registry.write('entity.sea.blendMode', 'screen');
    registry.write('entity.sea.visible', false);
    registry.write('entity.sea.bands', 21);
    registry.write('entity.sea.bodyAlpha', 0.4);
    registry.write('entity.sea.susceptibility.wind', 0.65);
    registry.write('entity.sea.motion.periodSeconds', 9.5);
    registry.write('entity.sea.motion.orient', true);
    registry.write('entity.sea.motion.endBehavior', 'pingpong');
    registry.write('entity.sea.motion.phaseOffset', 0.25);
    registry.write('force.wind.strength', 0.55);
    registry.write('parallax.x', 0.7);
    setScene((prev) => applyContentChoice(prev, 'lamp', choices.find((c) => c.id === 'procedural:rain')!));
    sync();
    registry.write('entity.lamp.drops', 400);
    registry.write('entity.lamp.motion.phaseOffset', 0.5);

    const edited = read();
    const back = deserializeScene(serializeScene(edited));
    expect(deepEqual(back, edited)).toBe(true);
    // Named explicitly too, because `deepEqual` returning true on two scenes
    // that both lost the motion record would also be "deep-equal".
    expect(back.layers.find((l) => l.id === 'sea')!.motion).toEqual({
      periodSeconds: 9.5,
      orient: true,
      endBehavior: 'pingpong',
      phaseOffset: 0.25,
    });
    expect(back.layers.find((l) => l.id === 'lamp')!.content['drops']).toBe(400);
  });

  it('a layer that declared no motion round-trips without gaining one', () => {
    // `{ motion: undefined }` and no `motion` key serialize identically and are
    // not deep-equal, so an absent record has to stay absent rather than be
    // filled in with the defaults on the way through.
    const { read } = bind(waterScene());
    const back = deserializeScene(serializeScene(read()));
    expect('motion' in back.layers[0]!).toBe(false);
    expect(deepEqual(back, read())).toBe(true);
  });

  it('refuses a motion record this build does not understand, naming the layer and the value', () => {
    const scene = waterScene();
    const raw = JSON.parse(serializeScene(scene)) as { layers: Record<string, unknown>[] };
    raw.layers[0]!['motion'] = { periodSeconds: 0, endBehavior: 'loop' };
    expect(() => deserializeScene(JSON.stringify(raw))).toThrow(/layers\[0\]\.motion.*periodSeconds/s);
  });
});
