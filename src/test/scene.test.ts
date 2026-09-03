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
