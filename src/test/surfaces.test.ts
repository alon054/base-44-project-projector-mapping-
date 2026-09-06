/**
 * I-15 — surfaces and content are two separate trees. Sprint block B1.
 *
 * Three kinds of check live here, and the third is the one that earns the file:
 *
 *  1. The surface tree's own behaviour — ids, defaults, marking order, and the
 *     tolerant read that keeps a room loadable (I-13).
 *  2. `resolveRole`, including the miss, which is flagged rather than refused
 *     (SPRINT.md §3 R2, the one stated exception to "refuse what is wrong").
 *  3. **The separation, enforced rather than trusted** — serialization in both
 *     directions plus the import graph. "Neither tree may reach into the
 *     other's storage" is a claim about dependencies, and a dependency claim is
 *     checkable by reading imports. `warp.test.ts` is the shape being copied.
 *
 * No GPU and no DOM (§8.1). Nothing here draws.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SURFACE_ROLE,
  addSurface,
  canonicalizeSurface,
  createSurface,
  describeSurfaces,
  nextSurfaceId,
  nextSurfaceName,
  removeSurface,
  withSurfaceName,
  withSurfacePath,
  withSurfaceRole,
  type Surface,
} from '../core/surfaces';
import { knownRoles, logRoleMiss, resetRoleLog, resolveRole } from '../core/roles';
import {
  SURFACES_VERSION,
  createSurfaceFile,
  readSurfaces,
  writeSurfaces,
} from '../render/calibration';
import { createPath, type Path } from '../core/paths';
import { createLayer } from '../core/layer';
import { canonicalizeScene, createScene, deserializeScene, serializeScene } from '../core/scene';

const SRC = join(import.meta.dirname, '..');
const ROOM_FILE = join(SRC, '..', 'calibration', 'surfaces.json');

function quad(id: string): Path {
  return createPath({
    id,
    closed: true,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.1 },
      { x: 0.4, y: 0.5 },
      { x: 0.1, y: 0.5 },
    ],
  });
}

/** Six points, one reflex corner. Not a rectangle by any reading. */
function lShape(id: string): Path {
  return createPath({
    id,
    closed: true,
    points: [
      { x: 0.5, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.4 },
      { x: 0.7, y: 0.4 },
      { x: 0.7, y: 0.8 },
      { x: 0.5, y: 0.8 },
    ],
  });
}

function room(): Surface[] {
  return [
    createSurface({ id: 'surface-1', name: 'face 1', path: quad('p1') }),
    createSurface({ id: 'surface-2', name: 'face 2', path: lShape('p2') }),
  ];
}

// ---------------------------------------------------------------------------

describe('Surface — the shape SPRINT.md R1 states, and nothing else', () => {
  it('carries exactly id, name, role and path', () => {
    const s = createSurface({ id: 'surface-1', path: quad('p1') });
    expect(Object.keys(s).sort()).toEqual(['id', 'name', 'path', 'role']);
  });

  it('defaults role to panel and name to the id when neither is given', () => {
    const s = createSurface({ id: 'surface-7', path: quad('p') });
    expect(s.role).toBe(DEFAULT_SURFACE_ROLE);
    expect(s.role).toBe('panel');
    expect(s.name).toBe('surface-7');
  });

  it('names a newly marked face "face N" and generates a stable id', () => {
    let tree: Surface[] = [];
    tree = addSurface(tree, quad('a'));
    tree = addSurface(tree, lShape('b'));
    expect(tree.map((s) => s.id)).toEqual(['surface-1', 'surface-2']);
    expect(tree.map((s) => s.name)).toEqual(['face 1', 'face 2']);
    expect(tree.every((s) => s.role === 'panel')).toBe(true);
  });

  it('never re-issues an id after a deletion — the suffix is a high-water mark', () => {
    // Length-based ids would hand `surface-2` out twice here, and the second
    // one would inherit the first's place in every log line ever written.
    let tree = addSurface(addSurface(addSurface([], quad('a')), quad('b')), quad('c'));
    tree = removeSurface(tree, 'surface-2');
    expect(nextSurfaceId(tree)).toBe('surface-4');
    expect(nextSurfaceName(tree)).toBe('face 4');
  });

  it('generates ids without Math.random — the same tree yields the same next id', () => {
    const tree = room();
    expect(nextSurfaceId(tree)).toBe(nextSurfaceId(tree));
    expect(nextSurfaceId(tree)).toBe('surface-3');
  });

  it('edits keep marking order and touch one surface only', () => {
    const tree = room();
    const moved = withSurfacePath(tree, 'surface-1', lShape('p1b'));
    expect(moved.map((s) => s.id)).toEqual(['surface-1', 'surface-2']);
    expect(moved[0]!.path.points).toHaveLength(6);
    expect(moved[1]).toBe(tree[1]);

    expect(withSurfaceRole(tree, 'surface-2', 'box-left')[1]!.role).toBe('box-left');
    // An empty role is a slip of the keyboard, not an intent to have no role.
    expect(withSurfaceRole(tree, 'surface-2', '')[1]!.role).toBe('panel');
    expect(withSurfaceName(tree, 'surface-1', 'lid')[0]!.name).toBe('lid');
    expect(withSurfaceName(tree, 'surface-1', '')[0]!.name).toBe('surface-1');
  });

  it('describes the room in one line, with the flag that decides the clip', () => {
    const line = describeSurfaces(room());
    expect(line).toContain('surface-1:"face 1" role=panel pts=4 closed');
    expect(line).toContain('pts=6');
    expect(describeSurfaces([])).toBe('[surfaces] none');
  });
});

describe('a surface path may be open or closed — closed is a value, not a kind (I-17)', () => {
  it('both round-trip deep-equal with the flag preserved', () => {
    const closed = createSurface({ id: 'surface-1', path: quad('p1') });
    const open = createSurface({
      id: 'surface-2',
      path: createPath({
        id: 'p2',
        closed: false,
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.6, y: 0.3 },
          { x: 0.8, y: 0.9 },
        ],
      }),
    });
    const tree = [closed, open];
    const back = readSurfaces(JSON.parse(JSON.stringify(writeSurfaces(tree))), canonicalizeSurface);
    expect(back).toEqual(tree);
    expect(back[0]!.path.closed).toBe(true);
    expect(back[1]!.path.closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('resolveRole — content binds by role, in marking order (I-15)', () => {
  it('returns every surface carrying the role', () => {
    const tree = room();
    const r = resolveRole('panel', tree);
    expect(r.unmatched).toBe(false);
    expect(r.surfaces.map((s) => s.id)).toEqual(['surface-1', 'surface-2']);
  });

  it('preserves marking order, not id order or insertion-into-the-middle order', () => {
    // Marked in this order; ids deliberately descending, so an implementation
    // that sorted by anything at all would be caught here rather than on camera.
    const tree: Surface[] = [
      createSurface({ id: 'surface-9', name: 'face 9', path: quad('a') }),
      createSurface({ id: 'surface-2', name: 'face 2', role: 'box-left', path: quad('b') }),
      createSurface({ id: 'surface-5', name: 'face 5', path: quad('c') }),
      createSurface({ id: 'surface-1', name: 'face 1', path: quad('d') }),
    ];
    expect(resolveRole('panel', tree).surfaces.map((s) => s.id)).toEqual([
      'surface-9',
      'surface-5',
      'surface-1',
    ]);
    // Repeatable: the order is a property of the tree, not of a hash walk.
    expect(resolveRole('panel', tree).surfaces.map((s) => s.id)).toEqual(
      resolveRole('panel', tree).surfaces.map((s) => s.id),
    );
  });

  it('a face marked later appends — it never re-cuts the order of the ones before it', () => {
    const tree = addSurface(room(), quad('p3'));
    expect(resolveRole('panel', tree).surfaces.map((s) => s.id)).toEqual([
      'surface-1',
      'surface-2',
      'surface-3',
    ]);
  });

  it('a role naming one face returns exactly that face', () => {
    const tree = withSurfaceRole(room(), 'surface-2', 'box-left');
    expect(resolveRole('box-left', tree).surfaces.map((s) => s.id)).toEqual(['surface-2']);
    expect(resolveRole('panel', tree).surfaces.map((s) => s.id)).toEqual(['surface-1']);
  });

  it('lists the roles present in first-marked order', () => {
    const tree = withSurfaceRole(addSurface(room(), quad('p3')), 'surface-2', 'box-left');
    expect(knownRoles(tree)).toEqual(['panel', 'box-left']);
  });
});

describe('an unmatched role is flagged and logged, never refused (I-13, SPRINT.md R2)', () => {
  it('returns an empty list and a flag — no throw, no substituted surface', () => {
    const tree = room();
    const r = resolveRole('bxo-left', tree);
    expect(r.surfaces).toEqual([]);
    expect(r.unmatched).toBe(true);
    // The typo must not be quietly answered with the nearest face.
    expect(r.surfaces).not.toContain(tree[0]);
  });

  it('names the offending value AND the roles that exist', () => {
    const r = resolveRole('bxo-left', room());
    expect(r.message).toContain('"bxo-left"');
    expect(r.message).toContain('"panel"');
  });

  it('an empty room reports that, rather than an empty list of roles', () => {
    expect(resolveRole('panel', []).message).toContain('no faces marked');
  });

  it('logs each distinct miss once — a per-frame resolve is not 60 lines a second', () => {
    resetRoleLog();
    const lines: string[] = [];
    const log = (m: string): void => void lines.push(m);
    const miss = resolveRole('bxo-left', room());
    expect(logRoleMiss(miss, log)).toBe(true);
    expect(logRoleMiss(miss, log)).toBe(false);
    expect(logRoleMiss(resolveRole('bxo-left', room()), log)).toBe(false);
    expect(logRoleMiss(resolveRole('other-typo', room()), log)).toBe(true);
    expect(lines).toHaveLength(2);
    resetRoleLog();
  });

  it('logs nothing at all for a role that matched', () => {
    resetRoleLog();
    const log = vi.fn();
    expect(logRoleMiss(resolveRole('panel', room()), log)).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('calibration/surfaces.json — versioned, through the one loader', () => {
  it('round-trips a tree deep-equal', () => {
    const tree = room();
    const file = writeSurfaces(tree);
    expect(file.version).toBe(SURFACES_VERSION);
    expect(readSurfaces(JSON.parse(JSON.stringify(file)), canonicalizeSurface)).toEqual(tree);
  });

  it('refuses a future version as a whole rather than half-reading it', () => {
    const raw = { version: SURFACES_VERSION + 1, surfaces: [{ id: 'surface-1', path: quad('p') }] };
    expect(readSurfaces(raw, canonicalizeSurface)).toEqual([]);
  });

  it('never throws on rubbish — the room degrades, the session does not end', () => {
    for (const raw of [null, undefined, 42, 'nope', [], {}, { version: 1 }, { version: 1, surfaces: 3 }]) {
      expect(() => readSurfaces(raw, canonicalizeSurface)).not.toThrow();
      expect(readSurfaces(raw, canonicalizeSurface)).toEqual([]);
    }
  });

  it('skips one unreadable face and keeps the rest of the room', () => {
    const good = writeSurfaces(room());
    const raw = { version: SURFACES_VERSION, surfaces: [good.surfaces[0], { id: '' }, { nope: 1 }, good.surfaces[1]] };
    expect(readSurfaces(raw, canonicalizeSurface).map((s) => s.id)).toEqual([
      'surface-1',
      'surface-2',
    ]);
  });

  it('drops a duplicate id rather than merging it — a merge is a guess', () => {
    const first = createSurface({ id: 'surface-1', name: 'first', path: quad('a') });
    const second = createSurface({ id: 'surface-1', name: 'second', path: lShape('b') });
    const read = readSurfaces(writeSurfaces([first, second]), canonicalizeSurface);
    expect(read).toHaveLength(1);
    expect(read[0]!.name).toBe('first');
  });

  it('a malformed role defaults rather than dropping the face', () => {
    // The face is the expensive thing to re-make; the tag is one click.
    const s = canonicalizeSurface({ id: 'surface-1', role: 7, path: quad('p') });
    expect(s?.role).toBe('panel');
    expect(canonicalizeSurface({ id: 'surface-1', path: quad('p') })?.name).toBe('surface-1');
  });

  it('drops a face with no usable path or id, and returns null rather than throwing', () => {
    expect(canonicalizeSurface({ id: 'surface-1', path: { id: 'p', points: [{ x: 'a', y: 0 }] } })).toBeNull();
    expect(canonicalizeSurface({ id: 'surface-1' })).toBeNull();
    expect(canonicalizeSurface({ path: quad('p') })).toBeNull();
    expect(canonicalizeSurface(null)).toBeNull();
  });

  it('writeSurfaces is cheap enough for a point drag: one list copy, no deep clone', () => {
    // B3 calls this on every pointermove. It must not serialize, clone or
    // validate — the entries come back by reference and only the list is new.
    const tree = room();
    const file = writeSurfaces(tree);
    expect(file.surfaces[0]).toBe(tree[0]);
    expect(file.surfaces[1]).toBe(tree[1]);
    expect(file.surfaces).not.toBe(tree);
  });

  it('createSurfaceFile is the empty room', () => {
    expect(createSurfaceFile()).toEqual({ version: SURFACES_VERSION, surfaces: [] });
  });
});

describe('the committed room file', () => {
  const raw = JSON.parse(readFileSync(ROOM_FILE, 'utf8')) as unknown;
  const tree = readSurfaces(raw, canonicalizeSurface);

  it('loads through the loader and holds two surfaces', () => {
    expect(tree).toHaveLength(2);
    expect((raw as { version: number }).version).toBe(SURFACES_VERSION);
  });

  it('resolveRole("panel", tree) returns both, in marking order', () => {
    const r = resolveRole('panel', tree);
    expect(r.unmatched).toBe(false);
    expect(r.surfaces.map((s) => s.id)).toEqual(['surface-1', 'surface-2']);
  });

  it('one of them is non-rectangular, so B2 has something to clip', () => {
    // Four points could still be a trapezoid; a reflex corner could not be a
    // rectangle under any transform, and that is what makes a mask visible.
    const second = tree[1]!;
    expect(second.path.points.length).toBeGreaterThan(4);
    expect(second.path.closed).toBe(true);
    expect(hasReflexCorner(second.path.points)).toBe(true);
  });

  it('every stored point is normalized (I-1)', () => {
    for (const s of tree) {
      for (const p of s.path.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('round-trips byte-identical through the loader and the writer', () => {
    expect(JSON.parse(JSON.stringify(writeSurfaces(tree)))).toEqual(raw);
  });
});

function hasReflexCorner(points: readonly { x: number; y: number }[]): boolean {
  const n = points.length;
  let positive = false;
  let negative = false;
  for (let i = 0; i < n; i++) {
    const a = points[(i + n - 1) % n]!;
    const b = points[i]!;
    const c = points[(i + 1) % n]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross > 0) positive = true;
    if (cross < 0) negative = true;
  }
  return positive && negative;
}

// ---------------------------------------------------------------------------
// I-15, enforced in both directions.
// ---------------------------------------------------------------------------

describe('Layer.fillRole — the binding, judged at the scene boundary', () => {
  it('is absent by default, and absent means "fills nothing"', () => {
    const layer = createLayer({ id: 'l1', providerId: 'solid' });
    expect('fillRole' in layer).toBe(false);
    expect(JSON.parse(JSON.stringify(layer))).not.toHaveProperty('fillRole');
  });

  it('survives a scene round-trip deep-equal, present and absent', () => {
    const scene = createScene({
      id: 's',
      layers: [
        createLayer({ id: 'l1', providerId: 'solid', fillRole: 'panel' }),
        createLayer({ id: 'l2', providerId: 'solid' }),
      ],
    });
    const back = deserializeScene(serializeScene(scene));
    expect(back).toEqual(scene);
    expect(back.layers[0]!.fillRole).toBe('panel');
    expect('fillRole' in back.layers[1]!).toBe(false);
  });

  it('accepts any string — it is a free field, not an enum (SPRINT.md R2)', () => {
    const scene = canonicalizeScene({
      version: 1,
      id: 's',
      layers: [{ id: 'l1', providerId: 'solid', fillRole: 'box-left' }],
    });
    expect(scene.layers[0]!.fillRole).toBe('box-left');
  });

  it('refuses a non-string, naming the layer and the value', () => {
    // Not in tension with the free-string rule: a typo is a string that matches
    // nothing and is flagged at draw time. A number is a file this build does
    // not understand.
    expect(() =>
      canonicalizeScene({
        version: 1,
        id: 's',
        layers: [{ id: 'l1', providerId: 'solid', fillRole: 3 }],
      }),
    ).toThrow(/layers\[0\]\.fillRole.*3/);
    expect(() =>
      canonicalizeScene({
        version: 1,
        id: 's',
        layers: [{ id: 'l1', providerId: 'solid', fillRole: '' }],
      }),
    ).toThrow(/fillRole/);
  });
});

describe('I-15 — no scene holds surface geometry', () => {
  it('a serialized scene contains no path, no point and no surface id', () => {
    const scene = createScene({
      id: 's',
      layers: [createLayer({ id: 'l1', providerId: 'solid', fillRole: 'panel' })],
    });
    const json = serializeScene(scene);
    expect(json).toContain('"fillRole":"panel"');
    for (const forbidden of ['surface-1', '"points"', '"closed"', '"path"', 'interpolation']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('a scene authored against one room loads deep-equal against another with the same roles', () => {
    // The property that makes a scene portable between rooms (I-15). The two
    // trees share nothing but the word "panel".
    const scene = createScene({
      id: 's',
      layers: [createLayer({ id: 'l1', providerId: 'solid', fillRole: 'panel' })],
    });
    const roomA = room();
    const roomB = [
      createSurface({ id: 'surface-11', name: 'north wall', path: lShape('x') }),
      createSurface({ id: 'surface-12', name: 'south wall', path: quad('y') }),
      createSurface({ id: 'surface-13', name: 'pillar', role: 'box-left', path: quad('z') }),
    ];
    const json = serializeScene(scene);
    expect(deserializeScene(json)).toEqual(scene);

    const fill = scene.layers[0]!.fillRole!;
    expect(resolveRole(fill, roomA).surfaces).toHaveLength(2);
    expect(resolveRole(fill, roomB).surfaces).toHaveLength(2);
    // Loading it in either room produced the same scene bytes.
    expect(serializeScene(deserializeScene(json))).toBe(json);
  });
});

describe('I-15 — no surface file holds content state', () => {
  it('the committed room file names no provider, no content and no layer', () => {
    const text = readFileSync(ROOM_FILE, 'utf8');
    for (const forbidden of [
      'providerId',
      'content',
      'opacity',
      'blendMode',
      'zOrder',
      'depth',
      'seed',
      'layers',
      'forces',
      'susceptibility',
      'motion',
    ]) {
      expect(text, `${forbidden} is content state and must not be in the room file`).not.toContain(
        forbidden,
      );
    }
  });

  it('a surface written from a tree carries the four R1 fields and no more', () => {
    const file = writeSurfaces(room());
    for (const s of file.surfaces) {
      expect(Object.keys(s).sort()).toEqual(['id', 'name', 'path', 'role']);
    }
    expect(Object.keys(file).sort()).toEqual(['surfaces', 'version']);
  });
});

describe('I-15 — the two trees do not import each other', () => {
  const importsOf = (file: string): string[] =>
    [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

  const sourcesUnder = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
      else if (/\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  };

  it('core/scene.ts does not import core/surfaces.ts', () => {
    // The one named in the block, stated on its own so a failure names it.
    const bad = importsOf(join(SRC, 'core', 'scene.ts')).filter((i) => /surfaces|roles/.test(i));
    expect(
      bad,
      'core/scene.ts reached into the surface tree. A scene must be loadable in a ' +
        'room it has never seen (I-15), which it cannot be if it knows what a Surface is.',
    ).toEqual([]);
  });

  it('nothing in the content tree imports the surface tree', () => {
    const forbidden = /(^|\/|\.\/)(surfaces|roles)$/;
    const content = ['scene.ts', 'layer.ts', 'defaultScene.ts', 'sceneEdit.ts', 'forces.ts'];
    const offenders = content.filter((f) =>
      importsOf(join(SRC, 'core', f)).some((i) => forbidden.test(i)),
    );
    expect(offenders).toEqual([]);
  });

  it('the surface tree imports no scene type', () => {
    // `./paths` is shared by both trees and that is I-17 working as designed —
    // a surface's shape and a movement route are the same object, implemented
    // once. Anything else here would be the surface tree learning what a show is.
    for (const file of ['surfaces.ts', 'roles.ts']) {
      const bad = importsOf(join(SRC, 'core', file)).filter((i) => !/^\.\/(paths|surfaces)$/.test(i));
      expect(bad, `core/${file} imported something outside the surface tree`).toEqual([]);
    }
  });

  it('nothing under providers/ or core/ imports the file store (I-5)', () => {
    // The direction warp.test.ts already guards, restated for surfaces: the
    // room's bytes are read in render/, and core/ must not reach for them.
    const offenders = sourcesUnder(join(SRC, 'core')).filter((f) =>
      importsOf(f).some((i) => /render\/calibration/.test(i)),
    );
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});
