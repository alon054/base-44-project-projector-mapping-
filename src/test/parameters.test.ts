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
  defineLayerParameters,
  defineTestPatternSpeed,
} from '../core/parameters';
import {
  PROCEDURAL_KINDS,
  ProceduralProvider,
} from '../providers/procedural/ProceduralProvider';
import { createLayer, type Layer } from '../core/layer';
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
        (patch) => {
          layer = { ...layer, ...patch };
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
    expect(r.keys('entity.a')).toHaveLength(4);
    expect(r.keys('entity.b')).toHaveLength(4);
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
    expect(r.keys('entity.g1')).toHaveLength(6);
    expect(r.unregisterPrefix('entity.g1')).toBe(6);
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
