/**
 * B4 — `parallel` and `sequence`, minimal (I-2, I-16, D18, SPRINT.md §3 R4).
 *
 * Four claims, tested separately because they fail differently:
 *
 *  1. **The arithmetic.** `groupDuration` is the sum; `resolveAt` is
 *     `(t mod groupDuration)` against block boundaries, a pure function of
 *     clock time built on `phaseAt`. Checked against numbers computed by hand.
 *  2. **The absence of a trigger mechanism.** A grep over `groups.ts` with
 *     comments stripped, verified to fail when a `setTimeout` is planted.
 *  3. **The scene boundary and the edits.** Groups round-trip deep-equal, a
 *     pre-groups scene migrates into the implicit root, a bad group is refused
 *     naming the value, and the structural edits keep a layer in one place.
 *  4. **The renderer.** On a real `Compositor` with a recording provider: a
 *     sequence shows exactly its active child, hides the others WITHOUT
 *     destroying them, makes a child visible BEFORE it draws, and a defaulted
 *     `parallel` group touches nothing at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Container, Graphics } from 'pixi.js';
import {
  CHILD_DURATION_MAX_SECONDS,
  CHILD_DURATION_MIN_SECONDS,
  DEFAULT_CHILD_DURATION_SECONDS,
  GROUP_MODES,
  GroupFormatError,
  ROOT_GROUP_ID,
  canonicalizeGroup,
  createGroup,
  groupDuration,
  groupOfLayer,
  isChildActive,
  layerActiveAt,
  resolveAt,
  rootGroup,
  type Group,
} from '../core/groups';
import { GLOBAL_LOOP_SECONDS, phaseAt } from '../core/clock';
import { createLayer } from '../core/layer';
import {
  SceneFormatError,
  canonicalizeScene,
  createScene,
  deserializeScene,
  serializeScene,
  type Scene,
} from '../core/scene';
import {
  SceneEditError,
  addGroup,
  addLayer,
  moveChild,
  removeGroup,
  removeLayer,
  setChildDuration,
  setGroupMode,
  setLayerGroup,
} from '../core/sceneEdit';
import { ParameterRegistry, defineChildParameters, defineGroupParameters } from '../core/parameters';
import { groupSignature, syncGroupParameters } from '../editor/sceneRegistry';
import { createRng } from '../core/rng';
import { Compositor } from '../render/compositor';
import { EMPTY_FORCE_FIELD } from '../core/forces';
import {
  ProviderRegistry,
  type ContentProvider,
  type LayerFrame,
  type LayerView,
  type ProviderContext,
} from '../providers/ContentProvider';

const PROVIDER = 'procedural';

/** The SPEC.md Gate 7 sequence: 5 s + 3 s + 2 s. */
const FIVE_THREE_TWO: Group = {
  id: 'seq',
  mode: 'sequence',
  children: [
    { id: 'a', duration: 5 },
    { id: 'b', duration: 3 },
    { id: 'c', duration: 2 },
  ],
};

function frame(timeSeconds: number): LayerFrame {
  return { timeSeconds, phase: phaseAt(timeSeconds * 1000, GLOBAL_LOOP_SECONDS), playing: true, rate: 1, scrubSeq: 0, forces: EMPTY_FORCE_FIELD };
}

function threeLayers(): Scene {
  return createScene({
    id: 'g',
    seed: 1,
    layers: ['a', 'b', 'c'].map((id, i) =>
      createLayer({
        id,
        providerId: PROVIDER,
        content: { kind: 'rect' },
        transform: { x: 0.5, y: 0.5, width: 0.5, height: 0.5, rotation: 0 },
        zOrder: i,
      }),
    ),
  });
}

/* -------------------------------------------------------------------------- */
/* 1. The arithmetic                                                          */
/* -------------------------------------------------------------------------- */

describe('I-16 — groupDuration is the sum for a sequence', () => {
  it('5 + 3 + 2 reports 10', () => {
    expect(groupDuration(FIVE_THREE_TWO)).toBe(10);
  });

  it('a parallel group has no duration of its own', () => {
    expect(groupDuration({ ...FIVE_THREE_TWO, mode: 'parallel' })).toBe(0);
  });

  it('a child that states nothing runs for the default loop', () => {
    const g = createGroup({ id: 'g', mode: 'sequence', children: [{ id: 'x' }, { id: 'y', duration: 1 }] });
    expect(groupDuration(g)).toBe(DEFAULT_CHILD_DURATION_SECONDS + 1);
    expect(DEFAULT_CHILD_DURATION_SECONDS).toBe(GLOBAL_LOOP_SECONDS);
  });
});

describe('I-16 — resolveAt is (t mod groupDuration) against block boundaries', () => {
  it('at t = 6 the second child is active at local 1', () => {
    const p = resolveAt(FIVE_THREE_TWO, 6);
    expect(p?.child.id).toBe('b');
    expect(p?.index).toBe(1);
    expect(p?.localSeconds).toBeCloseTo(1, 9);
    expect(p?.blockStartSeconds).toBe(5);
  });

  it('walks every boundary exactly', () => {
    expect(resolveAt(FIVE_THREE_TWO, 0)?.child.id).toBe('a');
    expect(resolveAt(FIVE_THREE_TWO, 4.999)?.child.id).toBe('a');
    expect(resolveAt(FIVE_THREE_TWO, 5)?.child.id).toBe('b');
    expect(resolveAt(FIVE_THREE_TWO, 5)?.localSeconds).toBeCloseTo(0, 9);
    expect(resolveAt(FIVE_THREE_TWO, 8)?.child.id).toBe('c');
    expect(resolveAt(FIVE_THREE_TWO, 9.5)?.child.id).toBe('c');
    expect(resolveAt(FIVE_THREE_TWO, 9.5)?.localSeconds).toBeCloseTo(1.5, 9);
  });

  it('loops — a sequence has no end, so t = 16 is t = 6', () => {
    const a = resolveAt(FIVE_THREE_TWO, 6);
    const b = resolveAt(FIVE_THREE_TWO, 16);
    const c = resolveAt(FIVE_THREE_TWO, 1006);
    expect(b?.child.id).toBe('b');
    expect(c?.child.id).toBe('b');
    expect(b?.localSeconds).toBeCloseTo(a!.localSeconds, 6);
    expect(c?.localSeconds).toBeCloseTo(a!.localSeconds, 6);
  });

  it('is built on phaseAt: the local position agrees with I-2\'s one function', () => {
    for (let t = 0; t < 30; t += 0.37) {
      const p = resolveAt(FIVE_THREE_TWO, t)!;
      const inLoop = phaseAt(t * 1000, 10) * 10;
      expect(p.blockStartSeconds + p.localSeconds).toBeCloseTo(inLoop, 9);
    }
  });

  it('the same t always gives the same answer — 1000 shuffled times', () => {
    const times: number[] = [];
    for (let i = 0; i < 1000; i++) times.push(i * 0.0731);
    const inOrder = times.map((t) => resolveAt(FIVE_THREE_TWO, t));
    // Fisher-Yates with the engine's own seeded stream (I-12: no Math.random).
    const rng = createRng(0x5eed);
    const shuffled = [...times.keys()];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const tmp = shuffled[i] as number;
      shuffled[i] = shuffled[j] as number;
      shuffled[j] = tmp;
    }
    for (const k of shuffled) {
      const again = resolveAt(FIVE_THREE_TWO, times[k] as number);
      expect(again).toEqual(inOrder[k]);
    }
    // And the order in which the answers were produced changed nothing
    // about them, which is the whole of "derived, never accumulated".
    expect(times.map((t) => resolveAt(FIVE_THREE_TWO, t))).toEqual(inOrder);
  });

  it('a parallel group and an empty sequence resolve to nothing', () => {
    expect(resolveAt({ ...FIVE_THREE_TWO, mode: 'parallel' }, 6)).toBeNull();
    expect(resolveAt({ id: 'e', mode: 'sequence', children: [] }, 6)).toBeNull();
  });

  it('isChildActive: parallel shows all, sequence shows one, a stranger none', () => {
    expect(isChildActive({ ...FIVE_THREE_TWO, mode: 'parallel' }, 'a', 6)).toBe(true);
    expect(isChildActive({ ...FIVE_THREE_TWO, mode: 'parallel' }, 'c', 6)).toBe(true);
    expect(isChildActive(FIVE_THREE_TWO, 'a', 6)).toBe(false);
    expect(isChildActive(FIVE_THREE_TWO, 'b', 6)).toBe(true);
    expect(isChildActive(FIVE_THREE_TWO, 'c', 6)).toBe(false);
    expect(isChildActive(FIVE_THREE_TWO, 'nobody', 6)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The grep                                                                */
/* -------------------------------------------------------------------------- */

describe('I-16 — there is no trigger mechanism and there must not be one', () => {
  const code = readFileSync(new URL('../core/groups.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('no timer, no frame callback, no wall clock', () => {
    for (const forbidden of [
      /setTimeout/,
      /setInterval/,
      /requestAnimationFrame/,
      /performance\s*\.\s*now/,
      /Date\s*\.\s*now/,
    ]) {
      expect(code, `groups.ts contains ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('no completion callback, no event, no listener', () => {
    for (const forbidden of [/callback/i, /onComplete/, /onEnd/, /emit\s*\(/, /addEventListener/, /subscribe/]) {
      expect(code, `groups.ts contains ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('no accumulated position and no phase arithmetic of its own (I-2)', () => {
    // `+=` is how a position accumulates; `%` and `Math.floor` are how a phase
    // is reimplemented. `motion.ts` carries the same two greps.
    expect(code).not.toMatch(/\+=/);
    expect(code).not.toMatch(/%/);
    expect(code).not.toMatch(/Math\s*\.\s*floor/);
    expect(code).toMatch(/phaseAt\(/);
  });

  it('the shape is exactly R4 — id, mode, children — and there is no `loop` field', () => {
    // `endBehavior: 'loop'` already owns that word in this codebase. Two
    // identically spelled fields in one JSON document is the hazard SPEC.md
    // guards against for the word "block".
    expect(code).not.toMatch(/\bloop\s*[:?]/);
    const g = createGroup({ id: 'g', mode: 'sequence', children: [{ id: 'a' }] });
    expect(Object.keys(g).sort()).toEqual(['children', 'id', 'mode']);
    expect(GROUP_MODES).toEqual(['parallel', 'sequence']);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. The scene boundary and the edits                                        */
/* -------------------------------------------------------------------------- */

describe('I-12 — groups round-trip deep-equal through the scene', () => {
  const grouped = (): Scene => ({
    ...threeLayers(),
    groups: [
      { id: 'seq', mode: 'sequence', children: [{ id: 'a', duration: 5 }, { id: 'b', duration: 3 }] },
      { id: 'par', mode: 'parallel', children: [{ id: 'c' }] },
    ],
  });

  it('deserialize(serialize(scene)) is deep-equal with groups in it', () => {
    const s = grouped();
    const back = deserializeScene(serializeScene(s));
    expect(back).toEqual(s);
    expect(serializeScene(back)).toBe(serializeScene(s));
  });

  it('a scene written before groups existed loads with every layer in the implicit root', () => {
    const raw = JSON.parse(serializeScene(threeLayers())) as Record<string, unknown>;
    delete raw['groups'];
    const s = canonicalizeScene(raw);
    expect(s.groups).toEqual([]);
    const root = rootGroup(s);
    expect(root.id).toBe(ROOT_GROUP_ID);
    expect(root.mode).toBe('parallel');
    expect(root.children.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c']) expect(layerActiveAt(s, id, 123.4)).toBe(true);
  });

  it('the root is the layers no group claims, in scene order', () => {
    const root = rootGroup(grouped());
    expect(root.children).toEqual([]);
    const half = setLayerGroup(grouped(), 'c', null);
    expect(rootGroup(half).children.map((c) => c.id)).toEqual(['c']);
  });

  it('a sequence child with no duration is filled with the default, a parallel one is left alone', () => {
    const s = canonicalizeScene({
      ...JSON.parse(serializeScene(threeLayers())),
      groups: [
        { id: 'seq', mode: 'sequence', children: [{ id: 'a' }] },
        { id: 'par', mode: 'parallel', children: [{ id: 'b' }] },
      ],
    });
    expect(s.groups[0]?.children[0]).toEqual({ id: 'a', duration: DEFAULT_CHILD_DURATION_SECONDS });
    expect(s.groups[1]?.children[0]).toEqual({ id: 'b' });
    expect(Object.keys(s.groups[1]!.children[0]!)).toEqual(['id']);
  });

  it('a group with no mode is parallel — the default is what the engine did before', () => {
    expect(canonicalizeGroup({ id: 'g' })).toEqual({ id: 'g', mode: 'parallel', children: [] });
  });
});

describe('I-13 / I-12 — a bad group is refused naming the value, never guessed at', () => {
  const withGroups = (groups: unknown): unknown => ({ ...JSON.parse(serializeScene(threeLayers())), groups });

  it('an unknown mode', () => {
    expect(() => canonicalizeGroup({ id: 'g', mode: 'cycle' })).toThrow(/mode.*"cycle"/);
    expect(() => canonicalizeScene(withGroups([{ id: 'g', mode: 'cycle' }]))).toThrow(SceneFormatError);
  });

  it('a duration that is zero, negative, infinite or a string', () => {
    for (const duration of [0, -1, Infinity, NaN, '3']) {
      expect(() => canonicalizeGroup({ id: 'g', mode: 'sequence', children: [{ id: 'a', duration }] })).toThrow(
        GroupFormatError,
      );
    }
  });

  it('a child naming a layer the scene does not have', () => {
    expect(() => canonicalizeScene(withGroups([{ id: 'g', children: [{ id: 'ghost' }] }]))).toThrow(
      /"ghost".*not in the scene/,
    );
  });

  it('a layer in two groups', () => {
    expect(() =>
      canonicalizeScene(withGroups([{ id: 'g1', children: [{ id: 'a' }] }, { id: 'g2', children: [{ id: 'a' }] }])),
    ).toThrow(/"a" is in two groups/);
  });

  it('a duplicate group id, and the reserved root id', () => {
    expect(() => canonicalizeScene(withGroups([{ id: 'g' }, { id: 'g' }]))).toThrow(/duplicate group id/);
    expect(() => canonicalizeScene(withGroups([{ id: ROOT_GROUP_ID }]))).toThrow(/reserved/);
  });

  it('an id that could not be a registry segment (I-8)', () => {
    expect(() => canonicalizeGroup({ id: 'a.b' })).toThrow(/key segment/);
    expect(() => canonicalizeGroup({ id: 'g', children: [{ id: 'x y' }] })).toThrow(/key segment/);
  });

  it('`groups` that is not an array', () => {
    expect(() => canonicalizeScene(withGroups({}))).toThrow(/must be an array/);
  });
});

describe('sceneEdit — a layer has one place', () => {
  it('addGroup hands out unique ids and an empty child list', () => {
    let s = addGroup(threeLayers());
    s = addGroup(s, 'parallel');
    expect(s.groups.map((g) => g.id)).toEqual(['group-1', 'group-2']);
    expect(s.groups.map((g) => g.mode)).toEqual(['sequence', 'parallel']);
    expect(s.groups.every((g) => g.children.length === 0)).toBe(true);
  });

  it('setLayerGroup moves a layer in, appends at the END, and out again', () => {
    let s = addGroup(threeLayers());
    s = setLayerGroup(s, 'b', 'group-1');
    s = setLayerGroup(s, 'a', 'group-1');
    expect(s.groups[0]?.children.map((c) => c.id)).toEqual(['b', 'a']);
    expect(groupOfLayer(s, 'a')?.id).toBe('group-1');
    s = setLayerGroup(s, 'b', null);
    expect(s.groups[0]?.children.map((c) => c.id)).toEqual(['a']);
    expect(groupOfLayer(s, 'b')).toBeUndefined();
  });

  it('a layer joining a sequence gets the default duration; joining a parallel group gets none', () => {
    let s = addGroup(addGroup(threeLayers(), 'sequence'), 'parallel');
    s = setLayerGroup(s, 'a', 'group-1');
    s = setLayerGroup(s, 'b', 'group-2');
    expect(s.groups[0]?.children[0]).toEqual({ id: 'a', duration: DEFAULT_CHILD_DURATION_SECONDS });
    expect(s.groups[1]?.children[0]).toEqual({ id: 'b' });
  });

  it('a duration travels with the layer between groups (I-8: the key does not change either)', () => {
    let s = addGroup(addGroup(threeLayers(), 'sequence'), 'sequence');
    s = setLayerGroup(s, 'a', 'group-1');
    s = setChildDuration(s, 'a', 7.5);
    s = setLayerGroup(s, 'a', 'group-2');
    expect(s.groups[0]?.children).toEqual([]);
    expect(s.groups[1]?.children).toEqual([{ id: 'a', duration: 7.5 }]);
  });

  it('moving a layer into a second group takes it out of the first — never two places', () => {
    let s = addGroup(addGroup(threeLayers()), 'parallel');
    s = setLayerGroup(s, 'a', 'group-1');
    s = setLayerGroup(s, 'a', 'group-2');
    expect(s.groups.filter((g) => g.children.some((c) => c.id === 'a')).map((g) => g.id)).toEqual(['group-2']);
    // And the result is a scene the boundary accepts.
    expect(() => canonicalizeScene(JSON.parse(serializeScene(s)))).not.toThrow();
  });

  it('removeLayer takes the layer out of its group in the same edit', () => {
    let s = addGroup(threeLayers());
    s = setLayerGroup(s, 'a', 'group-1');
    s = setLayerGroup(s, 'b', 'group-1');
    s = removeLayer(s, 'a');
    expect(s.layers.map((l) => l.id)).toEqual(['b', 'c']);
    expect(s.groups[0]?.children.map((c) => c.id)).toEqual(['b']);
    expect(() => canonicalizeScene(JSON.parse(serializeScene(s)))).not.toThrow();
  });

  it('removeGroup keeps the layers — they fall back to the root', () => {
    let s = addGroup(threeLayers());
    s = setLayerGroup(s, 'a', 'group-1');
    s = removeGroup(s, 'group-1');
    expect(s.groups).toEqual([]);
    expect(s.layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(rootGroup(s).children.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('moveChild reorders the blocks and stops at either end', () => {
    let s = addGroup(threeLayers());
    for (const id of ['a', 'b', 'c']) s = setLayerGroup(s, id, 'group-1');
    s = moveChild(s, 'group-1', 'c', -1);
    expect(s.groups[0]?.children.map((c) => c.id)).toEqual(['a', 'c', 'b']);
    const pinned = moveChild(s, 'group-1', 'a', -1);
    expect(pinned).toBe(s);
    // The block order is not the draw order: z is untouched.
    expect(s.layers.map((l) => l.zOrder)).toEqual([0, 1, 2]);
  });

  it('setGroupMode to sequence fills durations; back to parallel keeps them', () => {
    let s = addGroup(threeLayers(), 'parallel');
    s = setLayerGroup(s, 'a', 'group-1');
    expect(s.groups[0]?.children[0]).toEqual({ id: 'a' });
    s = setGroupMode(s, 'group-1', 'sequence');
    expect(s.groups[0]?.children[0]).toEqual({ id: 'a', duration: DEFAULT_CHILD_DURATION_SECONDS });
    s = setChildDuration(s, 'a', 2);
    s = setGroupMode(s, 'group-1', 'parallel');
    expect(s.groups[0]?.children[0]).toEqual({ id: 'a', duration: 2 });
  });

  it('setChildDuration refuses a zero, a negative and a non-number, naming the child', () => {
    let s = addGroup(threeLayers());
    s = setLayerGroup(s, 'a', 'group-1');
    for (const bad of [0, -2, NaN, Infinity]) {
      expect(() => setChildDuration(s, 'a', bad)).toThrow(SceneEditError);
      expect(() => setChildDuration(s, 'a', bad)).toThrow(/child "a"/);
    }
  });

  it('unknown ids leave the scene unchanged, by identity', () => {
    const s = addGroup(threeLayers());
    expect(setLayerGroup(s, 'ghost', 'group-1')).toBe(s);
    expect(setLayerGroup(s, 'a', 'no-such-group')).toBe(s);
    expect(removeGroup(s, 'no-such-group')).toBe(s);
    expect(moveChild(s, 'no-such-group', 'a', 1)).toBe(s);
    expect(setGroupMode(s, 'no-such-group', 'sequence')).toBe(s);
    expect(setChildDuration(s, 'a', 3)).toBe(s);
  });

  it('a layer added after the group exists lands in the root, not in the group', () => {
    let s = addGroup(threeLayers());
    s = setLayerGroup(s, 'a', 'group-1');
    s = addLayer(s, { idPrefix: 'rect', providerId: PROVIDER, content: { kind: 'rect' } });
    expect(groupOfLayer(s, 'rect-1')).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The registry keys (I-8, rule 5)                                            */
/* -------------------------------------------------------------------------- */

describe('I-8 — group.<id>.mode and child.<id>.duration, id-based', () => {
  it('the definitions carry the keys the checklist names', () => {
    let g: Group = { id: 'g1', mode: 'parallel', children: [{ id: 'a' }] };
    const defs = [
      ...defineGroupParameters('g1', () => g, (mode) => (g = { ...g, mode })),
      ...defineChildParameters('a', () => g.children[0]!, (d) => (g = { ...g, children: [{ id: 'a', duration: d }] })),
    ];
    const r = new ParameterRegistry();
    r.registerAll(defs);
    expect(r.keys()).toEqual(['child.a.duration', 'group.g1.mode']);
    expect(r.read('group.g1.mode')).toBe('parallel');
    r.write('group.g1.mode', 'sequence');
    expect(g.mode).toBe('sequence');
    expect(() => r.write('group.g1.mode', 'cycle')).toThrow(/expects one of/);
    // The read reports the EFFECTIVE duration — the default when none is stated.
    expect(r.read('child.a.duration')).toBe(DEFAULT_CHILD_DURATION_SECONDS);
    r.write('child.a.duration', 2.5);
    expect(g.children[0]?.duration).toBe(2.5);
    // Clamped to the control range, like every number key.
    expect(r.write('child.a.duration', 10_000)).toBe(CHILD_DURATION_MAX_SECONDS);
    expect(r.write('child.a.duration', 0)).toBe(CHILD_DURATION_MIN_SECONDS);
  });

  it('syncGroupParameters registers live groups and children and gives dead keys back', () => {
    let scene = addGroup(threeLayers());
    scene = setLayerGroup(scene, 'a', 'group-1');
    scene = setLayerGroup(scene, 'b', 'group-1');
    const read = (): Scene => scene;
    const setScene = (u: (prev: Scene) => Scene): void => {
      scene = u(scene);
    };
    const r = new ParameterRegistry();
    syncGroupParameters(r, read, setScene);
    expect(r.keys()).toEqual(['child.a.duration', 'child.b.duration', 'group.group-1.mode']);

    // Idempotent — the second call must not collide (React runs effects twice).
    expect(() => syncGroupParameters(r, read, setScene)).not.toThrow();

    // A write goes through sceneEdit, so the same rules apply as to the buttons.
    r.write('child.a.duration', 1.5);
    expect(scene.groups[0]?.children[0]?.duration).toBe(1.5);
    r.write('group.group-1.mode', 'parallel');
    expect(scene.groups[0]?.mode).toBe('parallel');
    expect(scene.groups[0]?.children[0]?.duration).toBe(1.5);

    // Moving a layer between groups does not change its key (Gate 7).
    scene = addGroup(scene, 'sequence');
    scene = setLayerGroup(scene, 'a', 'group-2');
    syncGroupParameters(r, read, setScene);
    expect(r.keys('child.a')).toEqual(['child.a.duration']);
    expect(r.read('child.a.duration')).toBe(1.5);

    // A layer leaving every group gives its key back; a deleted group too.
    scene = setLayerGroup(scene, 'b', null);
    scene = removeGroup(scene, 'group-2');
    syncGroupParameters(r, read, setScene);
    expect(r.keys()).toEqual(['group.group-1.mode']);
  });

  it('the group signature changes on membership and not on a value', () => {
    let s = addGroup(threeLayers());
    const before = groupSignature(s);
    s = setChildDuration(setLayerGroup(s, 'a', 'group-1'), 'a', 9);
    const joined = groupSignature(s);
    expect(joined).not.toBe(before);
    expect(groupSignature(setChildDuration(s, 'a', 3))).toBe(joined);
    expect(groupSignature(setGroupMode(s, 'group-1', 'parallel'))).toBe(joined);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. The renderer                                                            */
/* -------------------------------------------------------------------------- */

interface Seen {
  layerId: string;
  /** Whether the holder above the view was visible when `update` ran. */
  visibleAtUpdate: boolean;
}

class RecordingProvider implements ContentProvider {
  readonly id = PROVIDER;
  readonly updates: Seen[] = [];
  readonly destroyed: string[] = [];
  readonly views = new Map<string, Container>();

  create(ctx: ProviderContext): LayerView {
    const view = new Container();
    view.addChild(new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: 0x808080 }));
    this.views.set(ctx.layer.id, view);
    return {
      view,
      update: () => {
        this.updates.push({ layerId: ctx.layer.id, visibleAtUpdate: view.parent?.visible ?? false });
      },
      resize: () => {},
      destroy: () => {
        this.destroyed.push(ctx.layer.id);
      },
    };
  }
}

function compositorFor(scene: Scene): { compositor: Compositor; provider: RecordingProvider } {
  const provider = new RecordingProvider();
  const providers = new ProviderRegistry();
  providers.register(provider);
  const compositor = new Compositor({ providers, width: 1280, height: 720 });
  compositor.setScene(scene);
  return { compositor, provider };
}

const holderOf = (provider: RecordingProvider, id: string): Container => provider.views.get(id)!.parent!;

describe('the compositor — a sequence shows its active child and hides the rest', () => {
  const sequenced = (): Scene => ({ ...threeLayers(), groups: [FIVE_THREE_TWO] });

  it('at t = 6 only b is visible; at t = 9.5 only c; at t = 12 only a', () => {
    const { compositor, provider } = compositorFor(sequenced());
    compositor.update(frame(6));
    expect(['a', 'b', 'c'].map((id) => holderOf(provider, id).visible)).toEqual([false, true, false]);
    compositor.update(frame(9.5));
    expect(['a', 'b', 'c'].map((id) => holderOf(provider, id).visible)).toEqual([false, false, true]);
    compositor.update(frame(12));
    expect(['a', 'b', 'c'].map((id) => holderOf(provider, id).visible)).toEqual([true, false, false]);
  });

  it('hidden, not dismounted — no view is destroyed by a block change', () => {
    const { compositor, provider } = compositorFor(sequenced());
    for (const t of [0, 6, 9.5, 12, 6]) compositor.update(frame(t));
    expect(provider.destroyed).toEqual([]);
    expect(provider.views.size).toBe(3);
    for (const id of ['a', 'b', 'c']) expect(holderOf(provider, id).parent).not.toBeNull();
  });

  it('an inactive child is not updated; the active one is', () => {
    const { compositor, provider } = compositorFor(sequenced());
    compositor.update(frame(6));
    expect(provider.updates.map((u) => u.layerId)).toEqual(['b']);
  });

  it('a child is made VISIBLE before it draws — show-then-draw, the wall-grid rule', () => {
    const { compositor, provider } = compositorFor(sequenced());
    compositor.update(frame(6));
    compositor.update(frame(9.5));
    compositor.update(frame(12));
    for (const u of provider.updates) expect(u.visibleAtUpdate, `${u.layerId} drew while hidden`).toBe(true);
    expect(provider.updates.map((u) => u.layerId)).toEqual(['b', 'c', 'a']);
  });

  it('pause and scrub need no group-specific code: the same t gives the same frame', () => {
    const { compositor, provider } = compositorFor(sequenced());
    const snapshot = (): boolean[] => ['a', 'b', 'c'].map((id) => holderOf(provider, id).visible);
    compositor.update(frame(6));
    const at6 = snapshot();
    compositor.update(frame(9.5));
    compositor.update(frame(0.2));
    compositor.update(frame(6));
    expect(snapshot()).toEqual(at6);
    // A paused clock hands the same t again and again; nothing changes.
    compositor.update({ ...frame(6), playing: false });
    compositor.update({ ...frame(6), playing: false });
    expect(snapshot()).toEqual(at6);
  });

  it('a layer the scene hides stays hidden when its block is active', () => {
    const scene = sequenced();
    scene.layers[1] = { ...scene.layers[1]!, visible: false };
    const { compositor, provider } = compositorFor(scene);
    compositor.update(frame(6));
    expect(holderOf(provider, 'b').visible).toBe(false);
    compositor.update(frame(1));
    expect(holderOf(provider, 'a').visible).toBe(true);
  });

  it('a resize does not un-hide an inactive child', () => {
    const { compositor, provider } = compositorFor(sequenced());
    compositor.update(frame(6));
    compositor.resize(640, 360);
    expect(['a', 'b', 'c'].map((id) => holderOf(provider, id).visible)).toEqual([false, true, false]);
  });
});

describe('the compositor — a defaulted parallel group changes nothing', () => {
  it('every holder stays visible and every child is updated, exactly as with no group', () => {
    const plain = compositorFor(threeLayers());
    const grouped = compositorFor({
      ...threeLayers(),
      groups: [{ id: 'g', mode: 'parallel', children: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }],
    });
    for (const t of [0, 6, 9.5]) {
      plain.compositor.update(frame(t));
      grouped.compositor.update(frame(t));
    }
    const vis = (p: RecordingProvider): boolean[] => ['a', 'b', 'c'].map((id) => holderOf(p, id).visible);
    expect(vis(grouped.provider)).toEqual(vis(plain.provider));
    expect(vis(grouped.provider)).toEqual([true, true, true]);
    expect(grouped.provider.updates.map((u) => u.layerId)).toEqual(plain.provider.updates.map((u) => u.layerId));
  });

  it('a fill layer in a sequence is hidden and shown like any other', () => {
    const scene: Scene = {
      ...threeLayers(),
      layers: threeLayers().layers.map((l) => (l.id === 'a' ? { ...l, fillRole: 'panel' } : l)),
      groups: [FIVE_THREE_TWO],
    };
    const provider = new RecordingProvider();
    const providers = new ProviderRegistry();
    providers.register(provider);
    const compositor = new Compositor({
      providers,
      width: 1280,
      height: 720,
      surfaces: [
        {
          id: 'surface-1',
          name: 'face 1',
          role: 'panel',
          path: {
            id: 'p',
            closed: true,
            interpolation: 'linear',
            points: [
              { x: 0.1, y: 0.1 },
              { x: 0.5, y: 0.1 },
              { x: 0.5, y: 0.5 },
              { x: 0.1, y: 0.5 },
            ],
          },
        },
      ],
    });
    compositor.setScene(scene);
    // A fill's holder is two levels above its view: holder > stack.view > container > content > view.
    const fillHolder = (): Container => {
      let c: Container = provider.views.get('a')!;
      while (c.parent && c.parent.parent && c.parent.parent.parent !== null) c = c.parent;
      return c;
    };
    compositor.update(frame(1));
    expect(fillHolder().visible).toBe(true);
    compositor.update(frame(6));
    expect(fillHolder().visible).toBe(false);
    compositor.update(frame(1));
    expect(fillHolder().visible).toBe(true);
  });
});
