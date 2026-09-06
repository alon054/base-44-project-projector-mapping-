/**
 * I-8 — the parameter registry (SPEC.md §8.1: "every registered parameter has a
 * unique hierarchical key; a colliding key throws; every key resolves back to
 * its value").
 */
import { describe, expect, it } from 'vitest';
import { PARAM_TEST_PATTERN_SPEED } from '@shared/ipc';
import {
  ParameterCollisionError,
  ParameterKeyError,
  ParameterRegistry,
  assertValidKey,
  cellParameter,
  defineContentParameters,
  defineForceParameters,
  defineLayerParameters,
  defineParallaxParameters,
  defineSusceptibilityParameters,
  defineTestPatternSpeed,
} from '../core/parameters';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import type { ForceDefinition, ParallaxState } from '../core/forces';
import { createPhase4Scene } from '../core/defaultScene';
import type { Scene } from '../core/scene';
import {
  PROCEDURAL_KINDS,
  ProceduralProvider,
} from '../providers/procedural/ProceduralProvider';
import { applyLayerPatch, createLayer, type Layer } from '../core/layer';
import { createDefaultScene } from '../core/defaultScene';

const num = (key: string, def = 0) =>
  cellParameter({ key, label: key, kind: 'number', default: def, min: 0, max: 1, step: 0.01 });

describe('I-8 key shape', () => {
  it('accepts hierarchical keys', () => {
    for (const k of ['force.wind.strength', 'entity.layer-1.opacity', 'grade.tint', 'a.b']) {
      expect(() => assertValidKey(k)).not.toThrow();
    }
  });

  it('rejects a flat key — the collision I-8 exists to prevent', () => {
    expect(() => assertValidKey('speed')).toThrow(ParameterKeyError);
  });

  it('rejects empty and malformed segments', () => {
    for (const k of ['', 'a.', '.b', 'a..b', 'a.b c', 'a.b/c']) {
      expect(() => assertValidKey(k)).toThrow(ParameterKeyError);
    }
  });
});

describe('I-8 registry', () => {
  it('a colliding key throws', () => {
    const r = new ParameterRegistry();
    r.register(num('force.wind.strength'));
    expect(() => r.register(num('force.wind.strength'))).toThrow(ParameterCollisionError);
    expect(r.size).toBe(1);
  });

  it('every key resolves back to its value', () => {
    const r = new ParameterRegistry();
    r.register(num('force.wind.strength', 0.25));
    r.register(num('grade.tint', 0.5));
    expect(r.read('force.wind.strength')).toBe(0.25);
    expect(r.read('grade.tint')).toBe(0.5);
    expect(r.snapshot()).toEqual({ 'force.wind.strength': 0.25, 'grade.tint': 0.5 });
  });

  it('an unknown key throws rather than returning undefined', () => {
    const r = new ParameterRegistry();
    expect(() => r.read('force.wind.strength')).toThrow(ParameterKeyError);
    expect(() => r.write('force.wind.strength', 1)).toThrow(ParameterKeyError);
  });

  it('enumerates by hierarchical prefix, sorted', () => {
    const r = new ParameterRegistry();
    r.register(num('force.wind.strength'));
    r.register(num('force.wind.direction'));
    r.register(num('force.rain.amount'));
    r.register(num('grade.tint'));
    expect(r.keys('force.wind')).toEqual(['force.wind.direction', 'force.wind.strength']);
    expect(r.keys()).toEqual([
      'force.rain.amount',
      'force.wind.direction',
      'force.wind.strength',
      'grade.tint',
    ]);
  });

  it('clamps a number to its declared range instead of refusing the write', () => {
    const r = new ParameterRegistry();
    r.register(num('force.wind.strength'));
    expect(r.write('force.wind.strength', 5)).toBe(1);
    expect(r.write('force.wind.strength', -5)).toBe(0);
    expect(r.read('force.wind.strength')).toBe(0);
  });

  it('rejects a value of the wrong kind', () => {
    const r = new ParameterRegistry();
    r.register(num('force.wind.strength'));
    expect(() => r.write('force.wind.strength', true)).toThrow(ParameterKeyError);
    expect(() => r.write('force.wind.strength', Number.NaN)).toThrow(ParameterKeyError);
  });

  it('rejects an enum value outside its options', () => {
    const r = new ParameterRegistry();
    r.register(
      cellParameter({
        key: 'entity.a.blendMode',
        label: 'Blend',
        kind: 'enum',
        default: 'normal',
        options: ['normal', 'add'],
      }),
    );
    expect(r.write('entity.a.blendMode', 'add')).toBe('add');
    expect(() => r.write('entity.a.blendMode', 'overlay')).toThrow(ParameterKeyError);
  });

  it('unregisters a prefix, so a deleted layer can be re-added under the same id', () => {
    const r = new ParameterRegistry();
    r.registerAll([num('entity.a.opacity'), num('entity.a.depth'), num('entity.b.opacity')]);
    expect(r.unregisterPrefix('entity.a')).toBe(2);
    expect(r.keys()).toEqual(['entity.b.opacity']);
    expect(() => r.register(num('entity.a.opacity'))).not.toThrow();
  });

  it('notifies on write through a cell parameter', () => {
    const seen: number[] = [];
    const r = new ParameterRegistry();
    r.register(
      cellParameter(
        { key: 'debug.a.b', label: 'x', kind: 'number', default: 0, min: 0, max: 1, step: 0.1 },
        (v) => seen.push(v),
      ),
    );
    r.write('debug.a.b', 0.5);
    r.write('debug.a.b', 9);
    expect(seen).toEqual([0.5, 1]);
  });
});

describe('rule 9 — Phase 0 parameters land in the registry in Phase 1', () => {
  it('registers debug.testPattern.speed under its Phase 0 key', () => {
    const r = new ParameterRegistry();
    const def = r.register(defineTestPatternSpeed());
    expect(def.key).toBe(PARAM_TEST_PATTERN_SPEED);
    expect(def.key).toBe('debug.testPattern.speed');
    expect(r.read(PARAM_TEST_PATTERN_SPEED)).toBe(1);
    expect(r.write(PARAM_TEST_PATTERN_SPEED, 2.5)).toBe(2.5);
    // Matches the editor's existing slider rather than inventing a new range.
    expect([def.min, def.max, def.step]).toEqual([0, 4, 0.01]);
  });
});

describe('layer parameters are an index onto scene state, not a copy', () => {
  it('reads and writes through to the layer', () => {
    let layer: Layer = createLayer({ id: 'l1', providerId: 'procedural' });
    const r = new ParameterRegistry();
    r.registerAll(
      defineLayerParameters(
        'l1',
        () => layer,
        // `applyLayerPatch`, not a spread — B3. A `fillRole` cleared to
        // `undefined` must REMOVE the key, and a spread leaves it present
        // holding undefined, which is a layer that serializes the same and is
        // not deep-equal. The editor's writer goes through the same function.
        (patch) => {
          layer = applyLayerPatch(layer, patch);
        },
      ),
    );

    expect(r.read('entity.l1.opacity')).toBe(1);
    r.write('entity.l1.opacity', 0.4);
    expect(layer.opacity).toBe(0.4);
    expect(r.read('entity.l1.opacity')).toBe(0.4);

    r.write('entity.l1.blendMode', 'add');
    expect(layer.blendMode).toBe('add');

    r.write('entity.l1.visible', false);
    expect(layer.visible).toBe(false);
  });

  it('a change made directly to the scene is visible through the registry', () => {
    let layer: Layer = createLayer({ id: 'l1', providerId: 'procedural' });
    const r = new ParameterRegistry();
    r.registerAll(defineLayerParameters('l1', () => layer, () => {}));
    // The scene is the truth; nothing told the registry about this.
    layer = { ...layer, opacity: 0.125 };
    expect(r.read('entity.l1.opacity')).toBe(0.125);
  });

  it('two layers do not collide', () => {
    const a = createLayer({ id: 'a', providerId: 'p' });
    const b = createLayer({ id: 'b', providerId: 'p' });
    const r = new ParameterRegistry();
    r.registerAll(defineLayerParameters('a', () => a, () => {}));
    expect(() => r.registerAll(defineLayerParameters('b', () => b, () => {}))).not.toThrow();
    // Five layer-level keys since B3 registered `fillRole` (I-8, CLAUDE.md
    // rule 5: a new parameter is in the registry in the commit that adds it).
    expect(r.keys('entity.a')).toHaveLength(5);
    expect(r.keys('entity.b')).toHaveLength(5);
  });
});

/**
 * CLAUDE.md rule 9, mechanised for providers.
 *
 * "Every new parameter goes in the registry under a hierarchical key (I-8), in
 * the same commit that introduces it, from Phase 1 onward."
 *
 * This was missed once already: `tint`, `bands`, `rings`, `cells` and
 * `bodyAlpha` were introduced across Phase 1 as provider content and none of
 * them reached the registry, because nothing checked and "content" felt like a
 * different category from "parameter". It is not — MIDI mapping in Phase 11
 * would have found half the instrument unaddressable. The rule is a grep now
 * rather than a habit.
 */
describe('rule 9 — every content key a provider reads is registered', () => {
  it('ProceduralProvider declares every non-structural key it consumes', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../providers/procedural/ProceduralProvider.ts', import.meta.url).pathname,
      'utf8',
    );
    const consumed = new Set([...src.matchAll(/content\['([A-Za-z0-9_]+)'\]/g)].map((m) => m[1]!));
    expect(consumed.size).toBeGreaterThan(3);

    const structural = new Set(
      (src.match(/const STRUCTURAL_CONTENT_KEYS = \[([^\]]*)\]/)?.[1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean),
    );
    expect(structural.size).toBeGreaterThan(0);

    const provider = new ProceduralProvider();
    const declared = new Set<string>();
    for (const kind of PROCEDURAL_KINDS) {
      for (const spec of provider.contentParameters({ kind })) declared.add(spec.key);
    }

    for (const key of consumed) {
      if (structural.has(key)) continue;
      expect(
        declared.has(key),
        `content key "${key}" is read by the provider but not declared as a parameter (rule 9). ` +
          'Either register it, or add it to STRUCTURAL_CONTENT_KEYS with a reason.',
      ).toBe(true);
    }
  });

  it('BundledProvider declares every non-structural key it consumes', async () => {
    const fs = await import('node:fs/promises');
    // The provider reads content in two files — the class itself and, for the
    // views, whatever it passes down. Both are grepped, because a key read in a
    // view is just as unaddressable as one read in the provider.
    const dir = new URL('../providers/bundled/', import.meta.url).pathname;
    const files = (await fs.readdir(dir)).filter((f) => /\.ts$/.test(f));
    let src = '';
    for (const f of files) src += await fs.readFile(dir + f, 'utf8');

    const consumed = new Set([...src.matchAll(/content\['([A-Za-z0-9_]+)'\]/g)].map((m) => m[1]!));
    expect(consumed.size).toBeGreaterThan(1);

    const idSrc = await fs.readFile(dir + 'id.ts', 'utf8');
    const structural = new Set(
      (idSrc.match(/const STRUCTURAL_CONTENT_KEYS = \[([^\]]*)\]/)?.[1] ?? '')
        .split(',')
        .map((x) => x.trim().replace(/['"]/g, ''))
        .filter(Boolean),
    );
    expect(structural.size).toBeGreaterThan(0);

    const { BundledProvider } = await import('../providers/bundled/BundledProvider');
    const { createBundledLibrary } = await import('../providers/bundled/manifest');
    const library = createBundledLibrary();
    const provider = new BundledProvider({ library, decodeVideo: false, lottieResolution: 1 });

    // Asked once per SHIPPED asset, not once per kind: the declared set depends
    // on the asset (a still exposes no seam), so a key that only appears for
    // one kind would otherwise slip through.
    const declared = new Set<string>();
    for (const a of library.all()) {
      for (const spec of provider.contentParameters({ assetId: a.id })) declared.add(spec.key);
    }

    for (const key of consumed) {
      if (structural.has(key)) continue;
      expect(
        declared.has(key),
        `content key "${key}" is read by BundledProvider but not declared as a parameter ` +
          '(rule 9). Either register it, or add it to STRUCTURAL_CONTENT_KEYS with a reason.',
      ).toBe(true);
    }
  });

  it('registers content parameters under entity.<id>.*, bound to scene state', () => {
    let layer: Layer = createLayer({
      id: 'w1',
      providerId: 'procedural',
      content: { kind: 'water', bands: 16 },
    });
    const provider = new ProceduralProvider();
    const r = new ParameterRegistry();
    r.registerAll(
      defineContentParameters(
        'w1',
        provider.contentParameters(layer.content),
        () => layer,
        (content) => {
          layer = { ...layer, content };
        },
      ),
    );

    expect(r.keys('entity.w1')).toEqual([
      'entity.w1.bands',
      'entity.w1.bodyAlpha',
      'entity.w1.tint',
    ]);
    // Reads the stored value...
    expect(r.read('entity.w1.bands')).toBe(16);
    // ...and the provider's default where the blob omits the key, because that
    // is the value the provider will actually use.
    expect(r.read('entity.w1.bodyAlpha')).toBe(0.72);

    r.write('entity.w1.bodyAlpha', 0.3);
    expect(layer.content['bodyAlpha']).toBe(0.3);
    r.write('entity.w1.bands', 999);
    expect(layer.content['bands']).toBe(200);
  });

  it('a layer with content parameters still gives every key back on delete', () => {
    const layer = createLayer({
      id: 'g1',
      providerId: 'procedural',
      content: { kind: 'glow' },
    });
    const provider = new ProceduralProvider();
    const r = new ParameterRegistry();
    r.registerAll(defineLayerParameters('g1', () => layer, () => {}));
    r.registerAll(
      defineContentParameters('g1', provider.contentParameters(layer.content), () => layer, () => {}),
    );
    // Five layer-level + two content. `fillRole` is one of the five, and it
    // must come back on delete like every other key or re-adding a layer with
    // the same id collides (I-8).
    expect(r.keys('entity.g1')).toHaveLength(7);
    expect(r.unregisterPrefix('entity.g1')).toBe(7);
    expect(r.keys('entity.g1')).toEqual([]);
  });
});

/**
 * I-5 vs I-8 — warp calibration is deliberately NOT in the parameter registry,
 * and the absence is checked rather than merely intended.
 *
 * Ruled on at the start of Phase 2. I-8's subject is forces, per-entity
 * parameters and grade settings: things an operator modulates during a show.
 * Calibration is a description of a physical surface, and I-5 keeps it isolated
 * from scene logic in both directions. Registering the corners would make them
 * MIDI-mappable in Phase 11, where one knock of a knob destroys a calibration
 * that took a person on a ladder to make, with no undo on a wall.
 *
 * This is a grep because the failure mode is additive and quiet: someone adds a
 * `warp.corner.tl.x` in good faith and nothing complains until a show does.
 * Reversing the decision is fine — but it takes editing this test and saying
 * why in `BUILD_LOG.md`, which is exactly the amount of friction it deserves.
 */
describe('warp calibration stays out of the registry (I-5)', () => {
  it('no source file outside the tests registers a warp.* key', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const root = new URL('..', import.meta.url).pathname;

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'test') continue;
          out.push(...(await walk(full)));
        } else if (/\.tsx?$/.test(e.name)) {
          out.push(full);
        }
      }
      return out;
    };

    const files = await walk(root);
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const src = await fs.readFile(file, 'utf8');
      if (/['"`]warp\.[A-Za-z]/.test(src)) offenders.push(path.relative(root, file));
    }
    expect(
      offenders,
      'a warp.* parameter key was registered. Calibration is I-5 state, not an I-8 ' +
        'parameter — see the block comment above this test before changing it.',
    ).toEqual([]);
  });

  it('a registry built from a real scene exposes no warp keys', () => {
    const registry = new ParameterRegistry();
    const scene = createDefaultScene();
    for (const layer of scene.layers) {
      registry.registerAll(defineLayerParameters(layer.id, () => layer, () => {}));
    }
    expect(registry.keys('warp')).toEqual([]);
    expect(registry.has('warp.enabled')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 4 — I-8 x I-14                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Builds the registry the editor builds, from a real scene, so these tests
 * exercise the wiring rather than a construction made for them.
 */
function registryForScene(scene: Scene, definitions = FORCE_DEFINITIONS): ParameterRegistry {
  let state = scene;
  const r = new ParameterRegistry();
  r.registerAll(
    defineForceParameters(
      definitions,
      () => state.forces,
      (forceId, key, value) => {
        state = {
          ...state,
          forces: { ...state.forces, [forceId]: { ...state.forces[forceId], [key]: value } },
        };
      },
    ),
  );
  r.registerAll(
    defineParallaxParameters(
      () => state.parallax,
      (parallax: ParallaxState) => {
        state = { ...state, parallax };
      },
    ),
  );
  for (const layer of scene.layers) {
    const readLayer = () => state.layers.find((l) => l.id === layer.id)!;
    r.registerAll(
      defineSusceptibilityParameters(layer.id, definitions, readLayer, (susceptibility) => {
        state = {
          ...state,
          layers: state.layers.map((l) => (l.id === layer.id ? { ...l, susceptibility } : l)),
        };
      }),
    );
  }
  return r;
}

describe('Gate 4 — every force is enumerable from the registry by hierarchical key', () => {
  const scene = createPhase4Scene();

  it('every force, and every parameter of it, has a key', () => {
    const r = registryForScene(scene);
    for (const def of FORCE_DEFINITIONS) {
      for (const p of def.params) {
        const key = `force.${def.id}.${p.key}`;
        expect(r.has(key), key).toBe(true);
        expect(() => assertValidKey(key)).not.toThrow();
      }
    }
  });

  it('enumerating `force` finds them and nothing else', () => {
    const r = registryForScene(scene);
    const expected = FORCE_DEFINITIONS.flatMap((d) =>
      d.params.map((p) => `force.${d.id}.${p.key}`),
    ).sort();
    expect(r.keys('force')).toEqual(expected);
  });

  it('reads back the scene\u2019s stored values, not the code defaults', () => {
    const r = registryForScene(scene);
    expect(r.read('force.wind.strength')).toBe(scene.forces['wind']?.['strength']);
    expect(r.read('force.timeOfDay.hour')).toBe(15.5);
  });

  it('a write lands in scene state and reads back (I-12: one source of truth)', () => {
    const r = registryForScene(scene);
    r.write('force.wind.strength', 0.8);
    expect(r.read('force.wind.strength')).toBe(0.8);
    // Out of range is clamped, not refused — a mapped knob overshoots.
    expect(r.write('force.wind.strength', 99)).toBe(1);
  });

  it('I-14: a fifth force appears in the registry with no edit here', () => {
    // NOT `fog` — that is a shipped force now (Gate 4's timed exercise). A
    // synthetic colliding with a shipped id would test collision detection
    // rather than the mechanism. `current` is I-14's own second example.
    const CURRENT: ForceDefinition = {
      id: 'current',
      label: 'Current',
      axes: ['opacity'],
      defaultSusceptibility: 1,
      params: [{ key: 'density', label: 'Density', min: 0, max: 1, default: 0, step: 0.01 }],
      evaluate: () => ({}),
    };
    const r = registryForScene(scene, [...FORCE_DEFINITIONS, CURRENT]);
    expect(r.has('force.current.density')).toBe(true);
    expect(r.keys('force')).toContain('force.current.density');
    // And so does its per-entity subscription, for every layer.
    for (const l of scene.layers) {
      expect(r.has(`entity.${l.id}.susceptibility.current`)).toBe(true);
    }
  });
});

describe('I-4 — susceptibility is addressable per entity per force', () => {
  const scene = createPhase4Scene();

  it('uses four segments so a force id cannot collide with a content key', () => {
    // `entity.tree.wind` would collide with a provider that ever exposed a
    // content key called `wind`. I-8 exists precisely so names cannot collide.
    const r = registryForScene(scene);
    const key = 'entity.sus-100.susceptibility.wind';
    expect(r.has(key)).toBe(true);
    expect(key.split('.').length).toBe(4);
  });

  it('reports what the layer will actually do, not 0, when it states nothing', () => {
    // A registry that answered 0 for a layer visibly moving in the wind would
    // be an instrument that lies, which is the Phase 3 lesson.
    const r = registryForScene(scene);
    const lantern = scene.layers.find((l) => l.id === 'lantern')!;
    expect(lantern.susceptibility['timeOfDay']).toBeUndefined();
    expect(r.read('entity.lantern.susceptibility.timeOfDay')).toBe(
      FORCE_DEFINITIONS.find((d) => d.id === 'timeOfDay')!.defaultSusceptibility,
    );
  });

  it('a write is clamped into [0, 1] and reads back', () => {
    const r = registryForScene(scene);
    r.write('entity.sus-000.susceptibility.wind', 0.75);
    expect(r.read('entity.sus-000.susceptibility.wind')).toBe(0.75);
    expect(r.write('entity.sus-000.susceptibility.wind', 5)).toBe(1);
  });

  it('deleting a layer takes its susceptibility keys with it', () => {
    const r = registryForScene(scene);
    expect(r.keys('entity.lantern').length).toBeGreaterThan(0);
    r.unregisterPrefix('entity.lantern');
    expect(r.keys('entity.lantern')).toEqual([]);
  });
});

describe('D3 — parallax is addressable, and is NOT filed as a force', () => {
  it('registers under parallax.*, not force.*', () => {
    const r = registryForScene(createPhase4Scene());
    expect(r.has('parallax.x')).toBe(true);
    expect(r.has('parallax.y')).toBe(true);
    // Gate 4 asks that every force is enumerable from the registry. If parallax
    // were filed under `force.`, that enumeration would answer with something
    // that is not a force — it is the viewpoint, scaled by depth, not by a
    // per-entity susceptibility (I-4).
    expect(r.keys('force').some((k) => k.includes('parallax'))).toBe(false);
    expect(FORCE_DEFINITIONS.some((d) => d.id === 'parallax')).toBe(false);
  });

  it('round-trips a write through scene state', () => {
    const r = registryForScene(createPhase4Scene());
    r.write('parallax.x', 0.2);
    expect(r.read('parallax.x')).toBe(0.2);
    expect(r.read('parallax.y')).toBe(0.5);
  });
});
