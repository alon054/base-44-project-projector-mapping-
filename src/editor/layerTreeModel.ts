/**
 * The layer tree as Photoshop shows it — the PURE half of `LayerTree.tsx`
 * (named `layerTreeModel` because a case-insensitive disk cannot hold both
 * `layerTree.ts` and `LayerTree.tsx`).
 * Operator, 2026-09-07: *"a big preview screen and on the right all the
 * layers; I can move layers' order, put folders, and pick an animation for
 * each folder or layer."* `UI_PLAN.md` §2–§3, the part that needs no new
 * field on `Group` (SPRINT.md §3 R4 pins the shape until the sprint closes).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO ORDERS, ONE LIST.
 *
 * The scene has a flat draw order (`zOrder`, back to front) and, per
 * `sequence` group, a block order (`children`, first to last). Photoshop has
 * one list, front on top. The tree shows:
 *
 *  - root layers and `parallel` folders' children **in draw order, front
 *    first** — what covers what, top to bottom, as in Photoshop;
 *  - a `sequence` folder's children **in block order** with their numbers,
 *    because "this, then that" is what an in-turn folder IS, and a builder
 *    timing beat 6 reads that order and no other.
 *
 * A folder sits where its frontmost child sits. Dragging a row "before"
 * another (above it) writes the order that row's list is in: z for a root
 * or together row, block order for an in-turn row — and joins that row's
 * folder. Dropping ON a folder joins it at the end. Dropping in the root
 * zone leaves every folder and goes to the back.
 *
 * A folder has no name field (R4). It is shown as "Folder N" from its id.
 * Picking an animation FOR a folder applies the choice to each of its
 * children — a batch of the one structural edit, not inheritance, which is
 * U-B's and waits for the sprint to close. SHORTCUT, logged.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Group } from '../core/groups';
import { groupOfLayer } from '../core/groups';
import type { Layer } from '../core/layer';
import { layersInDrawOrder, type Scene } from '../core/scene';
import { reorderChild, reorderLayer, setLayerGroup } from '../core/sceneEdit';
import { applyContentChoice, type ContentChoice } from './controls';

export type TreeRow =
  | { kind: 'layer'; layer: Layer; group: Group | null; blockIndex: number | null }
  | { kind: 'folder'; group: Group; children: Layer[] };

/** The operator-facing name of a folder. `group-3` → `Folder 3`. */
export function folderLabel(group: Pick<Group, 'id'>): string {
  const m = /^group-(\d+)$/.exec(group.id);
  return m ? `Folder ${m[1]}` : group.id;
}

/** The tree, top to bottom, as the panel draws it. Pure: no DOM, no state. */
export function buildLayerTree(scene: Scene): TreeRow[] {
  const frontFirst = layersInDrawOrder(scene).slice().reverse();
  const byId = new Map(scene.layers.map((l) => [l.id, l] as const));
  const rows: TreeRow[] = [];
  const placed = new Set<string>();
  for (const layer of frontFirst) {
    const group = groupOfLayer(scene, layer.id) ?? null;
    if (group === null) {
      rows.push({ kind: 'layer', layer, group: null, blockIndex: null });
      continue;
    }
    if (placed.has(group.id)) continue;
    placed.add(group.id);
    const members =
      group.mode === 'sequence'
        ? group.children.flatMap((c) => (byId.has(c.id) ? [byId.get(c.id) as Layer] : []))
        : frontFirst.flatMap((l) => (group.children.some((c) => c.id === l.id) ? [l] : []));
    rows.push({ kind: 'folder', group, children: members });
  }
  // A folder with no layers yet — it was just made — sits at the bottom.
  for (const group of scene.groups) {
    if (!placed.has(group.id)) rows.push({ kind: 'folder', group, children: [] });
  }
  return rows;
}

/** The flat list of rows as drawn, with a layer's parent and block number resolved. */
export function flattenTree(rows: readonly TreeRow[]): TreeRow[] {
  const out: TreeRow[] = [];
  for (const row of rows) {
    out.push(row);
    if (row.kind === 'folder') {
      row.children.forEach((layer, i) => {
        out.push({
          kind: 'layer',
          layer,
          group: row.group,
          blockIndex: row.group.mode === 'sequence' ? i : null,
        });
      });
    }
  }
  return out;
}

export type DropTarget =
  | { kind: 'before'; layerId: string }
  | { kind: 'into'; groupId: string }
  | { kind: 'root-end' };

/**
 * The drop, as one scene edit. Every path is a sanctioned structural edit
 * (`setLayerGroup`, `reorderLayer`, `reorderChild`); nothing here touches a
 * parameter. Unknown ids and a drop onto itself return the scene unchanged.
 */
export function dropLayer(scene: Scene, dragId: string, target: DropTarget): Scene {
  if (!scene.layers.some((l) => l.id === dragId)) return scene;
  if (target.kind === 'into') {
    return setLayerGroup(scene, dragId, target.groupId);
  }
  if (target.kind === 'root-end') {
    return reorderLayer(setLayerGroup(scene, dragId, null), dragId, 0);
  }
  if (target.layerId === dragId) return scene;
  const over = scene.layers.find((l) => l.id === target.layerId);
  if (!over) return scene;
  const group = groupOfLayer(scene, over.id) ?? null;
  const joined = setLayerGroup(scene, dragId, group?.id ?? null);
  if (group && group.mode === 'sequence') {
    // Block order: land at the target's index, so the dragged block plays
    // just before it. `setLayerGroup` appended it, so the index is stable.
    const g = joined.groups.find((x) => x.id === group.id) as Group;
    const overIndex = g.children.findIndex((c) => c.id === over.id);
    return reorderChild(joined, group.id, dragId, overIndex);
  }
  // Draw order: directly in front of the target. `reorderLayer` removes then
  // inserts, so a layer coming from behind the target lands at the target's
  // index and one coming from in front lands one past it — both "just in
  // front", both reading as "above" in a front-first list.
  const order = layersInDrawOrder(joined);
  const from = order.findIndex((l) => l.id === dragId);
  const t = order.findIndex((l) => l.id === over.id);
  return reorderLayer(joined, dragId, from < t ? t : t + 1);
}

/** One picker for a folder: every child takes the choice. A batch, not inheritance (see header). */
export function applyChoiceToFolder(scene: Scene, groupId: string, choice: ContentChoice): Scene {
  const group = scene.groups.find((g) => g.id === groupId);
  if (!group) return scene;
  return group.children.reduce(
    (s, c) => (s.layers.some((l) => l.id === c.id) ? applyContentChoice(s, c.id, choice) : s),
    scene,
  );
}
