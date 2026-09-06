/**
 * Structural scene edits — the operations behind the editor's layer list.
 *
 * Gate 1 asks whether reordering layers changes occlusion correctly. The pixel
 * half of that answer is the golden harness's two occlusion cases; this is the
 * state half, and it is a unit test rather than a click because a z-order that
 * is right on screen and wrong in the saved JSON is a Phase 6 bug waiting.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLayer, isNormalizedTransform } from '../core/layer';
import { createScene, deserializeScene, layersInDrawOrder, serializeScene } from '../core/scene';
import {
  MIN_LAYER_EXTENT,
  SceneEditError,
  addLayer,
  moveLayer,
  removeLayer,
  reorderLayer,
  setLayerRect,
} from '../core/sceneEdit';
import { ParameterRegistry, defineLayerParameters } from '../core/parameters';

const base = () =>
  createScene({
    id: 's',
    layers: [
      createLayer({ id: 'a', providerId: 'procedural', zOrder: 0 }),
      createLayer({ id: 'b', providerId: 'procedural', zOrder: 1 }),
      createLayer({ id: 'c', providerId: 'procedural', zOrder: 2 }),
    ],
  });

const order = (s: ReturnType<typeof base>) => layersInDrawOrder(s).map((l) => l.id);

describe('addLayer', () => {
  it('appends at the front of the draw order', () => {
    const s = addLayer(base(), { idPrefix: 'glow', providerId: 'procedural', content: {} });
    expect(order(s)).toEqual(['a', 'b', 'c', 'glow-1']);
  });

  it('generates a unique id — I-8 keys must not collide, and duplicates are refused', () => {
    let s = base();
    for (let i = 0; i < 3; i++) {
      s = addLayer(s, { idPrefix: 'glow', providerId: 'procedural', content: {} });
    }
    expect(order(s)).toEqual(['a', 'b', 'c', 'glow-1', 'glow-2', 'glow-3']);
    // And the scene still deserializes, which is where a duplicate id throws.
    expect(() => deserializeScene(serializeScene(s))).not.toThrow();
  });

  it('reuses a freed id only when it is genuinely free', () => {
    let s = addLayer(base(), { idPrefix: 'glow', providerId: 'procedural', content: {} });
    s = addLayer(s, { idPrefix: 'glow', providerId: 'procedural', content: {} });
    s = removeLayer(s, 'glow-1');
    s = addLayer(s, { idPrefix: 'glow', providerId: 'procedural', content: {} });
    expect(order(s)).toEqual(['a', 'b', 'c', 'glow-2', 'glow-1']);
  });

  it('a new layer is placed and sized in normalized space, never pixels (I-1)', () => {
    const s = addLayer(base(), { idPrefix: 'glow', providerId: 'procedural', content: {} });
    const added = s.layers.find((l) => l.id === 'glow-1')!;
    expect(isNormalizedTransform(added.transform)).toBe(true);
    expect(added.transform.width).toBe(0.5);
    expect(added.transform.height).toBe(0.5);
  });

  it('two added layers are distinguishable — z-order cannot be demonstrated otherwise', () => {
    // This is the defect that made reordering look broken on the wall: every
    // added layer landed on the same box with the same default colour, so two
    // of them were pixel-identical and swapping them changed nothing. The
    // engine was right and the scene could not show it.
    let s = base();
    for (let i = 0; i < 4; i++) {
      s = addLayer(s, { idPrefix: 'rect', providerId: 'procedural', content: { kind: 'rect' } });
    }
    const added = s.layers.filter((l) => l.id.startsWith('rect-'));
    const boxes = new Set(added.map((l) => `${l.transform.x},${l.transform.y}`));
    const tints = new Set(added.map((l) => String(l.content['tint'])));
    expect(boxes.size).toBe(added.length);
    expect(tints.size).toBe(added.length);
  });

  it('a caller-supplied tint always wins', () => {
    const s = addLayer(base(), {
      idPrefix: 'rect',
      providerId: 'procedural',
      content: { kind: 'rect', tint: 0x123456 },
    });
    expect(s.layers.find((l) => l.id === 'rect-1')!.content['tint']).toBe(0x123456);
  });

  it('added layers stay reproducible from the JSON alone (I-12)', () => {
    const build = () =>
      addLayer(addLayer(base(), { idPrefix: 'rect', providerId: 'p', content: {} }), {
        idPrefix: 'rect',
        providerId: 'p',
        content: {},
      });
    expect(build()).toEqual(build());
  });
});

describe('removeLayer', () => {
  it('removes the layer and closes the z-order gap', () => {
    const s = removeLayer(base(), 'b');
    expect(order(s)).toEqual(['a', 'c']);
    expect(s.layers.map((l) => l.zOrder)).toEqual([0, 1]);
  });

  it('removing an unknown id is a no-op, not a throw', () => {
    expect(order(removeLayer(base(), 'nope'))).toEqual(['a', 'b', 'c']);
  });

  it('frees the layer parameter keys so the same id can be added again (I-8)', () => {
    const registry = new ParameterRegistry();
    const scene = base();
    for (const l of scene.layers) {
      registry.registerAll(defineLayerParameters(l.id, () => l, () => {}));
    }
    const after = removeLayer(scene, 'b');
    for (const key of registry.keys('entity')) {
      const id = key.split('.')[1]!;
      if (!after.layers.some((l) => l.id === id)) registry.unregisterPrefix(`entity.${id}`);
    }
    expect(registry.keys('entity.b')).toEqual([]);
    const readded = after.layers[0]!;
    expect(() =>
      registry.registerAll(defineLayerParameters('b', () => readded, () => {})),
    ).not.toThrow();
  });
});

describe('moveLayer — Gate 1: reordering changes occlusion correctly', () => {
  it('moves one place towards the front', () => {
    expect(order(moveLayer(base(), 'a', 1))).toEqual(['b', 'a', 'c']);
  });

  it('moves one place towards the back', () => {
    expect(order(moveLayer(base(), 'c', -1))).toEqual(['a', 'c', 'b']);
  });

  it('does not wrap at either end — a live session should not be surprised', () => {
    expect(order(moveLayer(base(), 'a', -1))).toEqual(['a', 'b', 'c']);
    expect(order(moveLayer(base(), 'c', 1))).toEqual(['a', 'b', 'c']);
  });

  it('an unknown id is a no-op', () => {
    expect(order(moveLayer(base(), 'nope', 1))).toEqual(['a', 'b', 'c']);
  });

  it('leaves zOrder and array position agreeing, so nothing needs reconciling later', () => {
    const s = moveLayer(moveLayer(base(), 'a', 1), 'c', -1);
    expect(s.layers.map((l) => [l.id, l.zOrder])).toEqual(
      layersInDrawOrder(s).map((l, i) => [l.id, i]),
    );
  });

  it('a reorder survives the round-trip (I-12)', () => {
    const s = moveLayer(base(), 'a', 1);
    expect(deserializeScene(serializeScene(s))).toEqual(s);
    expect(order(deserializeScene(serializeScene(s)))).toEqual(['b', 'a', 'c']);
  });
});

describe('reorderLayer — drag and drop', () => {
  it('drops a layer at an absolute position', () => {
    expect(order(reorderLayer(base(), 'a', 2))).toEqual(['b', 'c', 'a']);
    expect(order(reorderLayer(base(), 'c', 0))).toEqual(['c', 'a', 'b']);
    expect(order(reorderLayer(base(), 'b', 2))).toEqual(['a', 'c', 'b']);
  });

  it('clamps past either end, unlike the buttons — a drag past the end means "put it at the end"', () => {
    expect(order(reorderLayer(base(), 'a', 99))).toEqual(['b', 'c', 'a']);
    expect(order(reorderLayer(base(), 'c', -99))).toEqual(['c', 'a', 'b']);
    // The button affordance stays strict: a press past the end does nothing.
    expect(order(moveLayer(base(), 'c', 1))).toEqual(['a', 'b', 'c']);
  });

  it('dropping a layer on itself changes nothing', () => {
    const s = base();
    expect(reorderLayer(s, 'b', 1)).toBe(s);
  });

  it('an unknown id is a no-op', () => {
    const s = base();
    expect(reorderLayer(s, 'nope', 0)).toBe(s);
  });

  it('leaves zOrder and array position agreeing', () => {
    const s = reorderLayer(base(), 'a', 2);
    expect(s.layers.map((l) => [l.id, l.zOrder])).toEqual(
      layersInDrawOrder(s).map((l, i) => [l.id, i]),
    );
  });

  it('reaches every permutation the buttons can, so the two affordances agree', () => {
    // Dragging `a` to the front must equal pressing up twice.
    expect(order(reorderLayer(base(), 'a', 2))).toEqual(
      order(moveLayer(moveLayer(base(), 'a', 1), 'a', 1)),
    );
  });

  it('a drag survives the round-trip (I-12)', () => {
    const s = reorderLayer(base(), 'a', 2);
    expect(deserializeScene(serializeScene(s))).toEqual(s);
  });
});

// ── P5-B ─────────────────────────────────────────────────────────────────────

describe('setLayerRect — the one mutation behind move and scale', () => {
  const t = (s: ReturnType<typeof base>, id: string) => s.layers.find((l) => l.id === id)!.transform;

  it('writes a normalized box and leaves every other field alone', () => {
    const before = base();
    const s = setLayerRect(before, 'b', { x: 0.25, y: 0.75, width: 0.4, height: 0.1 });
    expect(t(s, 'b')).toEqual({ x: 0.25, y: 0.75, width: 0.4, height: 0.1, rotation: 0 });
    // The layer is otherwise the layer it was: opacity, blend, seed, z-order.
    const wasB = before.layers.find((l) => l.id === 'b')!;
    expect({ ...s.layers.find((l) => l.id === 'b')!, transform: wasB.transform }).toEqual(wasB);
    // ...and the layers that were not addressed are the SAME objects, not
    // rebuilt copies — a resize must not invalidate the rest of the stack.
    expect(s.layers.find((l) => l.id === 'a')).toBe(before.layers.find((l) => l.id === 'a'));
    expect(s.layers.find((l) => l.id === 'c')).toBe(before.layers.find((l) => l.id === 'c'));
  });

  it('a partial write moves without resizing — which is what a drag is', () => {
    const s = setLayerRect(base(), 'b', { x: 0.2, y: 0.2 });
    expect(t(s, 'b').width).toBe(t(base(), 'b').width);
    expect(t(s, 'b').height).toBe(t(base(), 'b').height);
  });

  it('NEVER writes rotation — the field exists, in turns, and this block has no handle', () => {
    const rotated = createScene({
      id: 's',
      layers: [createLayer({ id: 'r', providerId: 'procedural', transform: { rotation: 0.375 } })],
    });
    // Including when a caller passes one. The type forbids it; the runtime must
    // not honour it either, or a rotate handle exists with no handle.
    const s = setLayerRect(rotated, 'r', { x: 0.1, rotation: 0.5 } as never);
    expect(s.layers[0]!.transform.rotation).toBe(0.375);
  });

  it('clamps a coordinate that drifted out of range (I-1)', () => {
    const s = setLayerRect(base(), 'b', { x: 1.4, y: -0.2, width: 3, height: 0.5 });
    expect(t(s, 'b')).toMatchObject({ x: 1, y: 0, width: 1, height: 0.5 });
    expect(isNormalizedTransform(t(s, 'b'))).toBe(true);
  });

  it('clamps the extents up to MIN_LAYER_EXTENT — a zero-width region is unrecoverable', () => {
    // Reachable in one gesture (drag a corner onto its anchor) and leavable in
    // none: the region would be invisible AND unhittable.
    const s = setLayerRect(base(), 'b', { width: 0, height: -1 });
    expect(t(s, 'b').width).toBe(MIN_LAYER_EXTENT);
    expect(t(s, 'b').height).toBe(MIN_LAYER_EXTENT);
  });

  it('refuses a non-finite value, naming the layer, the field and the value', () => {
    // Not a number out of range — arithmetic that went wrong upstream. Clamped,
    // it would put the region silently in the top-left corner.
    expect(() => setLayerRect(base(), 'b', { x: Number.NaN })).toThrow(SceneEditError);
    expect(() => setLayerRect(base(), 'b', { x: Number.NaN })).toThrow(/layer "b": x .* got null/);
    expect(() => setLayerRect(base(), 'b', { height: Number.POSITIVE_INFINITY })).toThrow(
      /layer "b": height/,
    );
    expect(() => setLayerRect(base(), 'b', { width: '0.5' as never })).toThrow(/layer "b": width/);
  });

  it('an unknown id is a no-op, like every other structural edit here', () => {
    const s = base();
    expect(setLayerRect(s, 'nope', { x: 0.1 })).toBe(s);
  });

  it('survives the round-trip (I-12)', () => {
    const s = setLayerRect(base(), 'c', { x: 0.31, y: 0.62, width: 0.25, height: 0.44 });
    expect(deserializeScene(serializeScene(s))).toEqual(s);
  });
});

describe('addLayer with a drawn rect — P5-B places regions with the mouse', () => {
  it('a supplied rect wins over the staggered default', () => {
    const s = addLayer(base(), {
      idPrefix: 'rect',
      providerId: 'procedural',
      content: {},
      rect: { x: 0.2, y: 0.8, width: 0.15, height: 0.25 },
    });
    const added = s.layers.find((l) => l.id === 'rect-1')!;
    expect(added.transform).toEqual({ x: 0.2, y: 0.8, width: 0.15, height: 0.25, rotation: 0 });
    expect(isNormalizedTransform(added.transform)).toBe(true);
  });

  it('the buttons still stagger — a button names no place, a gesture does', () => {
    const s = addLayer(base(), { idPrefix: 'rect', providerId: 'procedural', content: {} });
    expect(s.layers.find((l) => l.id === 'rect-1')!.transform.width).toBe(0.5);
  });

  it('a drawn rect is clamped and refused on the same rules as a resize', () => {
    const s = addLayer(base(), {
      idPrefix: 'rect',
      providerId: 'procedural',
      content: {},
      rect: { x: 1.9, y: 0.5, width: 0, height: 0.3 },
    });
    expect(s.layers.find((l) => l.id === 'rect-1')!.transform).toMatchObject({
      x: 1,
      width: MIN_LAYER_EXTENT,
    });
    expect(() =>
      addLayer(base(), {
        idPrefix: 'rect',
        providerId: 'procedural',
        content: {},
        rect: { x: Number.NaN, y: 0.5, width: 0.2, height: 0.2 },
      }),
    ).toThrow(SceneEditError);
  });

  it('a placed layer round-trips (I-12)', () => {
    const s = addLayer(base(), {
      idPrefix: 'rect',
      providerId: 'procedural',
      content: {},
      rect: { x: 0.2, y: 0.8, width: 0.15, height: 0.25 },
    });
    expect(deserializeScene(serializeScene(s))).toEqual(s);
  });
});

/**
 * Deleting a layer must release its texture, and the CLASS of that fault is
 * "some removal path does not dispose" — the Phase 3 lesson, where the identical
 * fault twelve lines below the fixed one survived two more phases.
 *
 * So the check is not "removeLayer disposes". It is that there is exactly one
 * removal path, and that the single place every scene reaches the renderer
 * disposes unconditionally before rebuilding. A test that read the pixel count
 * would need a GPU; this reads the mechanism, which is what actually has to
 * hold. The HUD texture count before and after a delete is the operator's half.
 */
describe('P5-B — layer removal disposes, as a mechanism rather than a call site', () => {
  const SRC = join(import.meta.dirname, '..');
  const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

  it('there is exactly one structural removal in the engine', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === 'test') continue;
          walk(full);
        } else if (/\.tsx?$/.test(name) && /layers\s*\.\s*filter/.test(readFileSync(full, 'utf8'))) {
          offenders.push(full.slice(SRC.length + 1));
        }
      }
    };
    walk(SRC);
    // `forceLog.ts`, `ForcePanel.tsx` and `FillPanel.tsx` filter to READ — to
    // count, or to list the layers a panel draws a row for — and never to
    // produce a scene. They are named here rather than excluded by a loose
    // pattern, because the moment the pattern is loosened this test stops being
    // able to see the thing it exists for.
    //
    // The claim is unchanged: `core/sceneEdit.ts` is the only place a scene is
    // produced by removing a layer, so there is one removal path and it is the
    // one that disposes.
    expect(offenders.sort()).toEqual([
      'core/sceneEdit.ts',
      'debug/forceLog.ts',
      'editor/FillPanel.tsx',
      'editor/ForcePanel.tsx',
    ]);
  });

  it('Compositor.setScene tears the stack down BEFORE it rebuilds', () => {
    const body = read('render', 'compositor.ts').match(/setScene\(scene: Scene\): void \{([^}]*)/s)![1]!;
    const teardown = body.indexOf('this.teardownLayers()');
    const rebuild = body.indexOf('this.scene = scene');
    expect(teardown, 'setScene stopped tearing down — a deleted layer now leaks').toBeGreaterThanOrEqual(0);
    expect(teardown).toBeLessThan(rebuild);
  });

  it('teardown destroys the provider view AND the holder — the counter beside the counter', () => {
    const body = read('render', 'compositor.ts').match(/private teardownLayers\(\): void \{(.*?)\n  \}/s)![1]!;
    expect(body).toMatch(/entry\.view\.destroy\(\)/);
    expect(body).toMatch(/mount\.holder\.destroy\(\{ children: true \}\)/);
  });
});

/**
 * I-7 / P5-B: the selection outline is preview-only, and the guarantee is that
 * no code the output or the golden harness loads can reach it.
 */
describe('I-7 — the selection overlay cannot reach the output', () => {
  const SRC = join(import.meta.dirname, '..');

  const importsOf = (file: string): string[] =>
    [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

  const reachable = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) continue;
        for (const ext of ['.ts', '.tsx', '/index.ts']) {
          const resolved = join(dirname(file), spec + ext);
          if (existsSync(resolved)) {
            visit(resolved);
            break;
          }
        }
      }
    };
    visit(entry);
    return seen;
  };

  it('neither the output window nor the golden harness can load the preview or its interaction', () => {
    for (const entry of [join(SRC, 'output', 'main.ts'), join(SRC, 'golden', 'main.ts')]) {
      const graph = [...reachable(entry)].map((f) => f.slice(SRC.length + 1));
      expect(graph, `${entry} reached the preview`).not.toContain('editor/PreviewCanvas.tsx');
      expect(graph, `${entry} reached the interaction module`).not.toContain('editor/interaction.ts');
    }
  });

  it('interaction.ts imports no renderer — it is geometry and a mutation, nothing else', () => {
    const bad = importsOf(join(SRC, 'editor', 'interaction.ts')).filter((i) =>
      /(^|\/)render\//.test(i) || i === 'pixi.js' || i.startsWith('pixi.js/'),
    );
    expect(bad).toEqual([]);
  });

  it('Scene carries no selection field — selection cannot round-trip because there is nowhere for it', () => {
    const s = addLayer(base(), { idPrefix: 'rect', providerId: 'procedural', content: {} });
    const json = JSON.parse(serializeScene(s)) as Record<string, unknown>;
    expect(Object.keys(json)).not.toContain('selected');
    expect(Object.keys(json)).not.toContain('selectedId');
    for (const layer of json.layers as Record<string, unknown>[]) {
      expect(Object.keys(layer)).not.toContain('selected');
    }
    // And nothing in the scene model even mentions it, which is why the
    // guarantee is structural rather than a rule someone has to remember.
    expect(read(join(SRC, 'core', 'scene.ts'))).not.toMatch(/select/i);
    expect(read(join(SRC, 'core', 'layer.ts'))).not.toMatch(/select/i);
  });

  const read = (f: string): string => readFileSync(f, 'utf8');
});
