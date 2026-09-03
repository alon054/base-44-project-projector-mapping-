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
  defineLayerParameters,
  defineTestPatternSpeed,
} from '../core/parameters';
import { createLayer, type Layer } from '../core/layer';

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
