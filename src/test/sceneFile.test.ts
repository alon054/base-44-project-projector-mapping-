/**
 * S1 — scene persistence, minimal. `scenes/<name>.json` round-trips deep-equal
 * (I-12), carries no surface geometry in either direction (I-15), and refuses
 * what it does not understand by naming it (the P5-A pattern). A missing
 * library asset is a flagged layer, not a refused file (I-13).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENE_NAME_PATTERN, isSceneName } from '../../electron/ipc';
import { SCENE_FORMAT_VERSION, canonicalizeScene, deepEqual, type Scene } from '../core/scene';
import { readSceneFile, readSceneFileText, sceneFileBytes } from '../core/sceneFile';
import {
  createAltScene,
  createDefaultScene,
  createPhase3Scene,
  createPhase4Scene,
} from '../core/defaultScene';
import { addGroup, addLayer, setChildDuration, setGroupMode, setLayerGroup } from '../core/sceneEdit';
import { createRouteMotion } from '../core/motion';
import { BUNDLED_PROVIDER_ID } from '../providers/bundled/id';
import { PROCEDURAL_PROVIDER_ID } from '../providers/procedural/ProceduralProvider';

const SRC = join(new URL('../', import.meta.url).pathname);

/** The battery the block asks for, plus the four shipped scenes. */
function battery(): Array<[string, Scene]> {
  let grouped = createDefaultScene();
  grouped = addGroup(grouped, 'parallel');
  const groupId = grouped.groups[0]!.id;
  grouped = setLayerGroup(grouped, grouped.layers[0]!.id, groupId);
  grouped = setLayerGroup(grouped, grouped.layers[1]!.id, groupId);

  let sequenced = addGroup(createDefaultScene(), 'sequence');
  const seqId = sequenced.groups[0]!.id;
  for (const l of sequenced.layers) sequenced = setLayerGroup(sequenced, l.id, seqId);
  sequenced = setGroupMode(sequenced, seqId, 'sequence');
  sequenced = setChildDuration(sequenced, sequenced.layers[0]!.id, 5);
  sequenced = setChildDuration(sequenced, sequenced.layers[1]!.id, 3);
  sequenced = setChildDuration(sequenced, sequenced.layers[2]!.id, 2);

  let roled = addLayer(createDefaultScene(), {
    providerId: PROCEDURAL_PROVIDER_ID,
    content: { kind: 'rect', tint: 0xffffff },
    idPrefix: 'fill',
    fillRole: 'panel',
  });
  const last = roled.layers[roled.layers.length - 1]!;
  roled = {
    ...roled,
    layers: roled.layers.map((l) =>
      l.id === last.id
        ? {
            ...l,
            motion: createRouteMotion({ periodSeconds: 7.5, orient: true, travelRole: 'route', endBehavior: 'pingpong' }),
          }
        : l,
    ),
  };
  // Through the boundary once, so the entry is canonical in key order as well
  // as value — the same shape a scene built by the editor's own writes has.
  roled = canonicalizeScene(roled);

  const missingAsset = addLayer(createDefaultScene(), {
    providerId: BUNDLED_PROVIDER_ID,
    content: { assetId: 'library-clip-that-was-deleted' },
    idPrefix: 'clip',
    fillRole: 'panel',
  });

  return [
    ['default', createDefaultScene()],
    ['alt', createAltScene()],
    ['phase3', createPhase3Scene()],
    ['phase4', createPhase4Scene()],
    ['groups', grouped],
    ['sequence with per-child durations', sequenced],
    ['fillRole + motion.travelRole', roled],
    ['missing library asset', missingAsset],
  ];
}

/** Every key anywhere in a JSON value. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysDeep(x, out);
  else if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
}

describe('S1 — scenes/<name>.json round-trips deep-equal (I-12)', () => {
  it('bytes → read → same scene, for the whole battery', () => {
    for (const [label, scene] of battery()) {
      const read = readSceneFileText(sceneFileBytes(scene));
      expect(read.ok, label).toBe(true);
      if (!read.ok) continue;
      expect(read.scene, label).toEqual(scene);
      expect(deepEqual(read.scene, scene), label).toBe(true);
    }
  });

  it('writes the same bytes twice', () => {
    for (const [label, scene] of battery()) {
      const once = sceneFileBytes(scene);
      const read = readSceneFileText(once);
      expect(read.ok, label).toBe(true);
      if (read.ok) expect(sceneFileBytes(read.scene), label).toBe(once);
    }
  });

  it('the battery actually covers what the block names', () => {
    const by = new Map(battery());
    expect(by.get('groups')!.groups.length).toBe(1);
    const seq = by.get('sequence with per-child durations')!.groups[0]!;
    expect(seq.mode).toBe('sequence');
    expect(seq.children.slice(0, 3).map((c) => c.duration)).toEqual([5, 3, 2]);
    const roled = by.get('fillRole + motion.travelRole')!;
    const l = roled.layers.find((x) => x.fillRole === 'panel')!;
    expect(l.motion?.travelRole).toBe('route');
    expect(l.motion?.endBehavior).toBe('pingpong');
  });

  it('a pretty-printed file, one line per leaf, so a committed reel.json diffs', () => {
    const bytes = sceneFileBytes(createDefaultScene());
    expect(bytes.endsWith('\n')).toBe(true);
    expect(bytes.split('\n').length).toBeGreaterThan(20);
    expect(JSON.parse(bytes)).toEqual(createDefaultScene());
  });

  it('carries its version, and that is the scene format version — no second envelope', () => {
    const raw = JSON.parse(sceneFileBytes(createDefaultScene())) as Record<string, unknown>;
    expect(raw['version']).toBe(SCENE_FORMAT_VERSION);
    expect(Object.keys(raw)).not.toContain('scenes');
  });
});

describe('S1 — a scene stores NO surface geometry (I-15), both directions', () => {
  it('outbound: no key in any scene file names a surface or a surface id', () => {
    for (const [label, scene] of battery()) {
      const keys = keysDeep(JSON.parse(sceneFileBytes(scene)));
      for (const k of ['surfaces', 'surface', 'surfaceId', 'surfaceIds', 'room', 'path', 'points']) {
        expect(keys.has(k), `${label}: key "${k}"`).toBe(false);
      }
    }
  });

  it('outbound: roles are strings, not surface ids — the one bridge is a token', () => {
    const [, roled] = battery().find(([l]) => l.startsWith('fillRole'))!;
    const raw = JSON.parse(sceneFileBytes(roled)) as { layers: Array<Record<string, unknown>> };
    const l = raw.layers.find((x) => x['fillRole'] !== undefined)!;
    expect(l['fillRole']).toBe('panel');
    expect((l['motion'] as Record<string, unknown>)['travelRole']).toBe('route');
  });

  it('inbound: a file carrying `surfaces` is refused whole, naming I-15', () => {
    const raw = { ...(JSON.parse(sceneFileBytes(createDefaultScene())) as object), surfaces: [] };
    const read = readSceneFile(raw);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toMatch(/surfaces.*I-15/);
    expect(() => canonicalizeScene(raw)).toThrow(/I-15/);
  });

  it('inbound: even an empty-object `surfaces` is refused — presence is the fault, not content', () => {
    const raw = { ...(JSON.parse(sceneFileBytes(createDefaultScene())) as object), surfaces: {} };
    expect(readSceneFile(raw).ok).toBe(false);
  });

  it('the file module imports only the scene, never the surface tree', () => {
    const src = readFileSync(join(SRC, 'core', 'sceneFile.ts'), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    expect(imports).toEqual(['./scene']);
  });
});

describe('S1 — refuse what is wrong, by name; keep the session', () => {
  it('never throws: invalid JSON is a reason', () => {
    const read = readSceneFileText('{ not json');
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toMatch(/not valid JSON/);
  });

  it('a future format version is refused and the version is named', () => {
    const raw = { ...(JSON.parse(sceneFileBytes(createDefaultScene())) as object), version: SCENE_FORMAT_VERSION + 1 };
    const read = readSceneFile(raw);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain(`v${SCENE_FORMAT_VERSION + 1}`);
  });

  it('not an object, an array, null: refused, not thrown', () => {
    for (const bad of [null, 3, 'reel', [], undefined]) {
      expect(readSceneFile(bad).ok).toBe(false);
    }
  });

  it('a bad layer names its index and the offending value', () => {
    const raw = JSON.parse(sceneFileBytes(createDefaultScene())) as { layers: Array<Record<string, unknown>> };
    raw.layers[1]!['fillRole'] = 42;
    const read = readSceneFile(raw);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toMatch(/layers\[1\]\.fillRole.*42/);
  });

  it('I-13: a layer naming a library asset that does not exist loads — the flag is the renderer\'s, not the file\'s', () => {
    const [, missing] = battery().find(([l]) => l === 'missing library asset')!;
    const read = readSceneFileText(sceneFileBytes(missing));
    expect(read.ok).toBe(true);
    if (read.ok) {
      const l = read.scene.layers.find((x) => x.providerId === BUNDLED_PROVIDER_ID)!;
      expect(l.content['assetId']).toBe('library-clip-that-was-deleted');
    }
  });
});

describe('S1 — the scene file name is judged, never rewritten', () => {
  it('accepts the sprint\'s and the ordinary', () => {
    for (const ok of ['reel', 'reel-2', 'take_3', 'a', '0', 'x'.repeat(64)]) {
      expect(isSceneName(ok), ok).toBe(true);
    }
  });

  it('refuses anything that could leave scenes/ or is not a name', () => {
    for (const bad of ['', '../reel', 'a/b', 'a\\b', 'reel.json', 'Reel', 'reel ', ' reel', '-reel', 'x'.repeat(65), 'reel\n', 42, null, undefined]) {
      expect(isSceneName(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('is one pattern, shared by both ends', () => {
    expect(SCENE_NAME_PATTERN.source).toBe('^[a-z0-9][a-z0-9_-]{0,63}$');
  });
});
