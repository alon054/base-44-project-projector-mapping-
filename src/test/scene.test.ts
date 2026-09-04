/**
 * I-1 (normalized coordinates) and I-12 (state is the unit of truth).
 *
 * SPEC.md §8.1 asks for two things by name: "a normalized region maps to the
 * correct pixel rect at several resolutions; no pixel value ever appears in
 * stored state", and "deserialize(serialize(scene)) is deep-equal to scene for
 * a battery of scenes".
 */
import { describe, expect, it } from 'vitest';
import { DEV_RESOLUTION, TARGET_RESOLUTION } from '@shared/ipc';
import {
  BLEND_MODES,
  createLayer,
  isNormalizedTransform,
  normalizeTransform,
  toPixelRect,
  wrapTurn,
  type Layer,
} from '../core/layer';
import {
  SCENE_FORMAT_VERSION,
  SceneFormatError,
  canonicalizeScene,
  createScene,
  deepEqual,
  deserializeScene,
  layersInDrawOrder,
  reindexZOrder,
  serializeScene,
  type Scene,
} from '../core/scene';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import { createPhase4Scene } from '../core/defaultScene';

const RESOLUTIONS = [
  DEV_RESOLUTION,
  TARGET_RESOLUTION,
  { width: 640, height: 360 },
  { width: 3840, height: 2160 },
  // Deliberately not 16:9 — a warped surface is not obliged to be.
  { width: 1024, height: 1024 },
];

describe('I-1 normalized -> pixel', () => {
  it('a centred full-frame layer fills the frame at every resolution', () => {
    for (const r of RESOLUTIONS) {
      const p = toPixelRect({ x: 0.5, y: 0.5, width: 1, height: 1, rotation: 0 }, r.width, r.height);
      expect(p.cx).toBe(r.width / 2);
      expect(p.cy).toBe(r.height / 2);
      expect(p.width).toBe(r.width);
      expect(p.height).toBe(r.height);
    }
  });

  it('the same stored transform lands in the same relative place at every resolution', () => {
    const t = { x: 0.25, y: 0.75, width: 0.5, height: 0.2, rotation: 0.125 };
    for (const r of RESOLUTIONS) {
      const p = toPixelRect(t, r.width, r.height);
      expect(p.cx / r.width).toBeCloseTo(0.25, 12);
      expect(p.cy / r.height).toBeCloseTo(0.75, 12);
      expect(p.width / r.width).toBeCloseTo(0.5, 12);
      expect(p.height / r.height).toBeCloseTo(0.2, 12);
      // Rotation is resolution-independent by construction.
      expect(p.rotation).toBeCloseTo(Math.PI / 4, 12);
    }
  });

  it('Gate 1: two output resolutions need no repositioning', () => {
    const t = { x: 0.1, y: 0.9, width: 0.3, height: 0.4, rotation: 0.5 };
    const dev = toPixelRect(t, DEV_RESOLUTION.width, DEV_RESOLUTION.height);
    const target = toPixelRect(t, TARGET_RESOLUTION.width, TARGET_RESOLUTION.height);
    const scale = TARGET_RESOLUTION.width / DEV_RESOLUTION.width;
    expect(target.cx).toBeCloseTo(dev.cx * scale, 9);
    expect(target.width).toBeCloseTo(dev.width * scale, 9);
    expect(target.rotation).toBe(dev.rotation);
  });

  it('rotation is stored in turns, so every transform field is inside [0, 1]', () => {
    expect(wrapTurn(1.25)).toBeCloseTo(0.25, 12);
    expect(wrapTurn(-0.25)).toBeCloseTo(0.75, 12);
    expect(wrapTurn(Number.NaN)).toBe(0);
    expect(isNormalizedTransform(normalizeTransform({ rotation: 3.14159 }))).toBe(true);
  });

  it('a pixel value in a stored transform is clamped, and detectable', () => {
    // 640 is what a pixel value looks like if one ever leaks into state.
    const leaked = { x: 640, y: 360, width: 1280, height: 720, rotation: 0 };
    expect(isNormalizedTransform(leaked)).toBe(false);
    expect(isNormalizedTransform(normalizeTransform(leaked))).toBe(true);
  });

  it('no stored layer field is ever a pixel value', () => {
    const scene = battery().find((s) => s.layers.length > 0)!;
    for (const l of scene.layers) {
      expect(isNormalizedTransform(l.transform)).toBe(true);
      expect(l.opacity).toBeGreaterThanOrEqual(0);
      expect(l.opacity).toBeLessThanOrEqual(1);
      expect(l.depth).toBeGreaterThanOrEqual(0);
      expect(l.depth).toBeLessThanOrEqual(1);
    }
  });
});

describe('draw order', () => {
  const mk = (id: string, zOrder: number): Layer =>
    createLayer({ id, providerId: 'procedural', zOrder });

  it('sorts by zOrder ascending', () => {
    const s = createScene({ id: 's', layers: [mk('c', 2), mk('a', 0), mk('b', 1)] });
    expect(layersInDrawOrder(s).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by position in scene.layers, stated rather than inherited from sort', () => {
    const s = createScene({ id: 's', layers: [mk('first', 0), mk('second', 0), mk('third', 0)] });
    expect(layersInDrawOrder(s).map((l) => l.id)).toEqual(['first', 'second', 'third']);
  });

  it('reindexes to a dense 0..n-1 after a reorder', () => {
    const s = createScene({ id: 's', layers: [mk('c', 40), mk('a', -3), mk('b', 7)] });
    const r = reindexZOrder(s);
    expect(layersInDrawOrder(r).map((l) => [l.id, l.zOrder])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });
});

/** The battery §8.1 asks for: empty, many layers, every blend mode. */
function battery(): Scene[] {
  const empty = createScene({ id: 'empty' });
  const everyBlend = createScene({
    id: 'blends',
    seed: 9,
    layers: BLEND_MODES.map((blendMode, i) =>
      createLayer({
        id: `l${i}`,
        name: `layer ${blendMode}`,
        providerId: 'procedural',
        blendMode,
        zOrder: i,
        opacity: (i + 1) / (BLEND_MODES.length + 1),
        depth: i / BLEND_MODES.length,
        transform: { x: 0.1 * i, y: 0.2, width: 0.5, height: 0.25, rotation: 0.125 * i },
        content: { kind: 'glow', radius: 0.2, tint: '#ff8800', nested: { on: true, list: [1, 2] } },
      }),
    ),
  });
  const many = createScene({
    id: 'many',
    seed: 0xdeadbeef,
    background: 0x001122,
    layers: Array.from({ length: 64 }, (_, i) =>
      createLayer({ id: `m${i}`, providerId: 'procedural', zOrder: i, visible: i % 3 !== 0 }),
    ),
  });
  return [empty, everyBlend, many];
}

describe('I-12 serialization round-trip', () => {
  it('deserialize(serialize(scene)) is deep-equal to scene', () => {
    for (const scene of battery()) {
      const back = deserializeScene(serializeScene(scene));
      expect(back).toEqual(scene);
      expect(deepEqual(back, scene)).toBe(true);
    }
  });

  it('round-trips twice to the same bytes', () => {
    for (const scene of battery()) {
      const once = serializeScene(scene);
      expect(serializeScene(deserializeScene(once))).toBe(once);
    }
  });

  it('deepEqual catches a single changed leaf', () => {
    const [, blends] = battery();
    const mutated = deserializeScene(serializeScene(blends!));
    mutated.layers[0]!.opacity += 1e-9;
    expect(deepEqual(mutated, blends)).toBe(false);
  });

  it('deepEqual distinguishes a missing key from an extra one', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it('carries the format version', () => {
    expect(createScene({ id: 's' }).version).toBe(SCENE_FORMAT_VERSION);
  });
});

describe('I-13 / I-12 — bad scene data fails loudly, never silently', () => {
  it('refuses a scene from a newer format version rather than guessing', () => {
    const raw = { ...createScene({ id: 's' }), version: SCENE_FORMAT_VERSION + 1 };
    expect(() => canonicalizeScene(raw)).toThrow(SceneFormatError);
  });

  it('refuses duplicate layer ids — entity.<id>.* keys must stay unique (I-8)', () => {
    const dup = {
      id: 's',
      layers: [
        { id: 'a', providerId: 'p' },
        { id: 'a', providerId: 'p' },
      ],
    };
    expect(() => canonicalizeScene(dup)).toThrow(/duplicate layer id/);
  });

  it('refuses a layer with no provider', () => {
    expect(() => canonicalizeScene({ id: 's', layers: [{ id: 'a' }] })).toThrow(SceneFormatError);
  });

  it('refuses non-JSON content before it can reach the IPC guard (I-7)', () => {
    expect(() =>
      canonicalizeScene({ id: 's', layers: [{ id: 'a', providerId: 'p', content: { n: NaN } }] }),
    ).toThrow(SceneFormatError);
    expect(() => deserializeScene('{ not json')).toThrow(SceneFormatError);
  });

  it('falls back to a normal blend mode rather than throwing on an unknown one', () => {
    const s = canonicalizeScene({
      id: 's',
      layers: [{ id: 'a', providerId: 'p', blendMode: 'overlay' }],
    });
    expect(s.layers[0]!.blendMode).toBe('normal');
  });

  it('clamps out-of-range stored values instead of rendering them', () => {
    const s = canonicalizeScene({
      id: 's',
      layers: [{ id: 'a', providerId: 'p', opacity: 9, depth: -4, transform: { x: 42 } }],
    });
    expect(s.layers[0]!.opacity).toBe(1);
    expect(s.layers[0]!.depth).toBe(0);
    expect(s.layers[0]!.transform.x).toBe(1);
  });
});

describe('I-12 seeds live in scene state', () => {
  it('a layer created without an explicit seed is still reproducible from its id', () => {
    expect(createLayer({ id: 'tree', providerId: 'p' }).seed).toBe(
      createLayer({ id: 'tree', providerId: 'p' }).seed,
    );
    expect(createLayer({ id: 'tree', providerId: 'p' }).seed).not.toBe(
      createLayer({ id: 'water', providerId: 'p' }).seed,
    );
  });

  it('an explicit seed survives the round-trip', () => {
    const s = createScene({
      id: 's',
      seed: 777,
      layers: [createLayer({ id: 'a', providerId: 'p', seed: 4242 })],
    });
    const back = deserializeScene(serializeScene(s));
    expect(back.seed).toBe(777);
    expect(back.layers[0]!.seed).toBe(4242);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 4 — forces, susceptibility and parallax in scene state               */
/* -------------------------------------------------------------------------- */

describe('I-4 / I-12 — force state round-trips deep-equal', () => {
  const phase4 = (): Scene =>
    createScene({
      id: 'p4',
      seed: 0x4f0,
      forces: { wind: { strength: 0.45, direction: 0.125, gustiness: 0.5 } },
      parallax: { x: 0.7, y: 0.35 },
      layers: [
        createLayer({
          id: 'a',
          providerId: 'procedural',
          depth: 0.9,
          susceptibility: { wind: 1, timeOfDay: 0.25 },
        }),
        createLayer({ id: 'b', providerId: 'procedural', depth: 0.1 }),
      ],
    });

  it('survives serialize -> deserialize exactly', () => {
    const scene = phase4();
    expect(deepEqual(deserializeScene(serializeScene(scene)), scene)).toBe(true);
  });

  it('round-trips twice to the same bytes', () => {
    const once = serializeScene(phase4());
    expect(serializeScene(deserializeScene(once))).toBe(once);
  });

  it('an absent susceptibility map is {} and NOT filled with every force', () => {
    // Sparse on purpose (see `Susceptibility`): filling it would make adding a
    // fifth force a migration of every stored scene, which is the rewrite I-14
    // exists to prevent.
    expect(phase4().layers[1]!.susceptibility).toEqual({});
  });

  it('an absent forces block is filled from the shipped definitions', () => {
    // Dense on purpose, the other way round: the stored JSON should STATE the
    // forces rather than defer to whatever the code's defaults are next year.
    const scene = createScene({ id: 'bare' });
    for (const def of FORCE_DEFINITIONS) {
      for (const p of def.params) expect(scene.forces[def.id]?.[p.key]).toBe(p.default);
    }
  });

  it('keeps force values for ids this build does not know', () => {
    // Opening a scene on a build without its fifth force and saving it again
    // must not silently destroy the operator's settings (I-13's principle).
    const raw = JSON.parse(serializeScene(createScene({ id: 'x' })));
    raw.forces.fog = { density: 0.8 };
    const back = canonicalizeScene(raw);
    expect(back.forces['fog']).toEqual({ density: 0.8 });
    expect(deepEqual(deserializeScene(serializeScene(back)), back)).toBe(true);
  });

  it('clamps susceptibility into [0, 1] and drops nonsense', () => {
    const l = createLayer({
      id: 'l',
      providerId: 'procedural',
      susceptibility: { wind: 5, rain: -2, bad: Number.NaN } as Record<string, number>,
    });
    expect(l.susceptibility).toEqual({ wind: 1, rain: 0 });
  });

  it('refuses a force id or key that could not be a registry segment (I-8)', () => {
    // These become `force.<id>.<key>`; a dot in either would produce a key that
    // cannot be addressed, so it is refused where it is STORED.
    expect(() => canonicalizeScene({ id: 's', forces: { 'wi.nd': { a: 1 } } })).toThrow(
      SceneFormatError,
    );
    expect(() => canonicalizeScene({ id: 's', forces: { wind: { 'a b': 1 } } })).toThrow(
      SceneFormatError,
    );
  });

  it('refuses a non-numeric force value rather than reading it as a default', () => {
    // Silently defaulting would put the operator in front of a wall wondering
    // why the wind control does nothing.
    expect(() =>
      canonicalizeScene({ id: 's', forces: { wind: { strength: '0.5' } } }),
    ).toThrow(SceneFormatError);
  });

  it('parallax is normalized like every other spatial value (I-1)', () => {
    expect(createScene({ id: 's', parallax: { x: 4, y: -4 } }).parallax).toEqual({ x: 1, y: 0 });
    expect(createScene({ id: 's' }).parallax).toEqual({ x: 0.5, y: 0.5 });
    expect(canonicalizeScene({ id: 's', parallax: 'nope' }).parallax).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('the Phase 4 gate scene is built to be judged', () => {
  it('isolates susceptibility at one depth and depth at one susceptibility', () => {
    const scene = createPhase4Scene();
    const bars = ['sus-000', 'sus-050', 'sus-100'].map(
      (id) => scene.layers.find((l) => l.id === id)!,
    );
    // Everything held equal except `susceptibility.wind` — otherwise the
    // operator cannot attribute what they see to the variable under test.
    expect(new Set(bars.map((b) => b.depth)).size).toBe(1);
    expect(new Set(bars.map((b) => b.transform.height)).size).toBe(1);
    expect(new Set(bars.map((b) => b.transform.width)).size).toBe(1);
    expect(bars.map((b) => b.susceptibility['wind'])).toEqual([0, 0.5, 1]);

    const trees = ['depth-far', 'depth-mid', 'depth-near'].map(
      (id) => scene.layers.find((l) => l.id === id)!,
    );
    expect(new Set(trees.map((t) => t.susceptibility['wind'])).size).toBe(1);
    expect(trees.map((t) => t.depth)).toEqual([0.15, 0.5, 0.95]);
  });

  it('opens with the wind already blowing, so there is something to judge', () => {
    // A gate scene that opens looking like nothing is happening is a gate scene
    // that has to be explained before it can be judged.
    expect(createPhase4Scene().forces['wind']?.['strength']).toBeGreaterThan(0.2);
  });

  it('holds the rain sheet still — a translated full-frame layer shows its edges', () => {
    expect(createPhase4Scene().layers.find((l) => l.id === 'rain')!.susceptibility['wind']).toBe(0);
  });

  it('round-trips deep-equal like any other scene', () => {
    const scene = createPhase4Scene();
    expect(deepEqual(deserializeScene(serializeScene(scene)), scene)).toBe(true);
  });
});
