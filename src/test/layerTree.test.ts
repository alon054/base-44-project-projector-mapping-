/**
 * The layer tree's pure half — `editor/layerTree.ts`. Photoshop's one list
 * over the scene's two orders, and a drop as one structural edit.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScene, layersInDrawOrder } from '../core/scene';
import { addGroup, addLayer, renameLayer, reorderChild, setLayerGroup } from '../core/sceneEdit';
import { PROCEDURAL_PROVIDER_ID } from '../providers/procedural/ProceduralProvider';
import {
  applyChoiceToFolder,
  buildLayerTree,
  dropLayer,
  flattenTree,
  folderLabel,
} from '../editor/layerTreeModel';
import type { ContentChoice } from '../editor/controls';

// `addLayer` numbers ids itself: prefix `a` → id `a-1`.
const layer = (s: ReturnType<typeof createScene>, id: string) =>
  addLayer(s, { idPrefix: id.replace(/-1$/, ''), providerId: PROCEDURAL_PROVIDER_ID, content: { kind: 'rect' } });

/** Four layers a, b, c, d back to front; c and d in an in-turn folder. */
const scene = () => {
  let s = createScene({ id: 't' });
  for (const id of ['a-1', 'b-1', 'c-1', 'd-1']) s = layer(s, id);
  s = addGroup(s, 'sequence'); // group-1
  s = setLayerGroup(s, 'c-1', 'group-1');
  s = setLayerGroup(s, 'd-1', 'group-1');
  return s;
};
const ids = (rows: ReturnType<typeof flattenTree>) =>
  rows.map((r) => (r.kind === 'folder' ? `[${r.group.id}]` : r.layer.id));
const draw = (s: ReturnType<typeof scene>) => layersInDrawOrder(s).map((l) => l.id);

describe('the tree', () => {
  it('lists front first; a folder sits where its frontmost child sits; an in-turn folder lists block order', () => {
    const rows = flattenTree(buildLayerTree(scene()));
    expect(ids(rows)).toEqual(['[group-1]', 'c-1', 'd-1', 'b-1', 'a-1']);
    const c = rows[1]!;
    expect(c.kind === 'layer' ? c.blockIndex : 'not a layer').toBe(0);
    const b = rows[3]!;
    expect(b.kind === 'layer' ? b.group : 'not a layer').toBeNull();
  });

  it('a together folder lists its children in draw order, front first, with no block numbers', () => {
    let s = scene();
    s = { ...s, groups: s.groups.map((g) => ({ ...g, mode: 'parallel' as const })) };
    s = reorderChild(s, 'group-1', 'd-1', 0); // block order d, c — must NOT show for a together folder
    const rows = flattenTree(buildLayerTree(s));
    expect(ids(rows)).toEqual(['[group-1]', 'd-1', 'c-1', 'b-1', 'a-1']);
    const d = rows[1]!;
    expect(d.kind === 'layer' ? d.blockIndex : 'not a layer').toBeNull();
  });

  it('an empty folder sits at the bottom; the label reads Folder N', () => {
    const s = addGroup(scene(), 'parallel');
    expect(ids(flattenTree(buildLayerTree(s))).at(-1)).toBe('[group-2]');
    expect(folderLabel({ id: 'group-2' })).toBe('Folder 2');
    expect(folderLabel({ id: 'custom' })).toBe('custom');
  });
});

describe('a drop is one structural edit', () => {
  it('"before" a root row puts the layer directly in front of it in draw order, and leaves any folder', () => {
    const s = dropLayer(scene(), 'c-1', { kind: 'before', layerId: 'a-1' });
    expect(draw(s)).toEqual(['a-1', 'c-1', 'b-1', 'd-1']);
    expect(s.groups[0]!.children.map((x) => x.id)).toEqual(['d-1']);
  });

  it('coming from behind lands the same place as coming from in front — "just above" reads once', () => {
    const fromBehind = dropLayer(scene(), 'a-1', { kind: 'before', layerId: 'b-1' });
    expect(draw(fromBehind)).toEqual(['b-1', 'a-1', 'c-1', 'd-1']);
    const fromFront = dropLayer(fromBehind, 'd-1', { kind: 'before', layerId: 'b-1' });
    expect(draw(fromFront)).toEqual(['b-1', 'd-1', 'a-1', 'c-1']);
  });

  it('"before" an in-turn child joins the folder and lands at that block', () => {
    const s = dropLayer(scene(), 'a-1', { kind: 'before', layerId: 'd-1' });
    expect(s.groups[0]!.children.map((x) => x.id)).toEqual(['c-1', 'a-1', 'd-1']);
    // Every block states a duration once it is in a sequence.
    expect(s.groups[0]!.children.every((c) => typeof c.duration === 'number')).toBe(true);
  });

  it('"into" appends to the folder; "root-end" leaves it and goes to the back', () => {
    const into = dropLayer(scene(), 'b-1', { kind: 'into', groupId: 'group-1' });
    expect(into.groups[0]!.children.map((x) => x.id)).toEqual(['c-1', 'd-1', 'b-1']);
    const out = dropLayer(into, 'd-1', { kind: 'root-end' });
    expect(out.groups[0]!.children.map((x) => x.id)).toEqual(['c-1', 'b-1']);
    expect(draw(out)[0]).toBe('d-1');
  });

  it('onto itself, or an unknown id, is identity', () => {
    const s = scene();
    expect(dropLayer(s, 'a-1', { kind: 'before', layerId: 'a-1' })).toBe(s);
    expect(dropLayer(s, 'zz', { kind: 'root-end' })).toBe(s);
    expect(dropLayer(s, 'a-1', { kind: 'before', layerId: 'zz' })).toBe(s);
  });
});

describe('a folder picker is a batch of the one content edit', () => {
  const glow: ContentChoice = { id: 'procedural:glow', providerId: PROCEDURAL_PROVIDER_ID, label: 'glow', group: 'Procedural', content: { kind: 'glow' } };

  it('every child takes the choice; the root layers do not', () => {
    const s = applyChoiceToFolder(scene(), 'group-1', glow);
    const kind = (id: string) => s.layers.find((l) => l.id === id)!.content['kind'];
    expect([kind('c-1'), kind('d-1')]).toEqual(['glow', 'glow']);
    expect([kind('a-1'), kind('b-1')]).toEqual(['rect', 'rect']);
    expect(applyChoiceToFolder(s, 'nope', glow)).toBe(s);
  });
});

describe('rename and reorderChild (sceneEdit)', () => {
  it('rename trims, falls back to the id when empty, and is identity when unchanged', () => {
    const s = scene();
    expect(renameLayer(s, 'a-1', '  Fire  ').layers[0]!.name).toBe('Fire');
    expect(renameLayer(s, 'a-1', '   ').layers[0]!.name).toBe('a-1');
    const same = renameLayer(s, 'a-1', s.layers[0]!.name);
    expect(same).toBe(s);
  });

  it('reorderChild clamps and is identity at the same index', () => {
    const s = scene();
    expect(reorderChild(s, 'group-1', 'd-1', 0).groups[0]!.children.map((c) => c.id)).toEqual(['d-1', 'c-1']);
    expect(reorderChild(s, 'group-1', 'c-1', 99).groups[0]!.children.map((c) => c.id)).toEqual(['d-1', 'c-1']);
    expect(reorderChild(s, 'group-1', 'c-1', 0)).toBe(s);
  });
});

describe('where it lives', () => {
  const SRC = join(import.meta.dirname, '..');
  it('layerTreeModel.ts and LayerTree.tsx write no parameter and import no renderer', () => {
    for (const f of ['layerTreeModel.ts', 'LayerTree.tsx']) {
      const src = readFileSync(join(SRC, 'editor', f), 'utf8');
      expect(src.includes('registry.write('), f).toBe(false);
      expect(/from ['"][^'"]*render\//.test(src), f).toBe(false);
      expect(src.includes('pixi.js'), f).toBe(false);
    }
  });
});
