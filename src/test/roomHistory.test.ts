/**
 * S3 — room history: a backup for calibration, not undo for content.
 * One rule (`roomHistory.ts`), used by the editor's ring and by main's
 * rotating snapshots. The B3 failure it exists for: a room destroyed by one
 * press at the wall, with `git checkout` restoring the morning's file rather
 * than the room before the gesture.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GESTURE_QUIET_MS,
  ROOM_HISTORY_DEPTH,
  createRoomHistory,
  recordWrite,
  redo,
  startsGesture,
  undo,
} from '../../electron/roomHistory';
import { createPath } from '../core/paths';
import { createSurface, reconcileSurfaces, removeSurface, type SurfaceTree } from '../core/surfaces';

const ROOT = join(new URL('../../', import.meta.url).pathname);

function quad(id: string, x = 0.1, y = 0.2) {
  return createPath({
    id,
    closed: true,
    points: [{ x, y }, { x: x + 0.3, y }, { x: x + 0.3, y: y + 0.3 }, { x, y: y + 0.3 }],
  });
}
function room(n: number): SurfaceTree {
  return Array.from({ length: n }, (_, i) =>
    createSurface({ id: `surface-${i + 1}`, name: `face ${i + 1}`, path: quad(`path-${i + 1}`, 0.1 * i, 0.1) }),
  );
}

/** A drag: `samples` writes, `gapMs` apart, each moving one point a little. */
function drag(h: ReturnType<typeof createRoomHistory<SurfaceTree>>, tree: SurfaceTree, t0: number, samples: number, gapMs = 16) {
  let current = tree;
  let history = h;
  for (let i = 0; i < samples; i++) {
    const next = reconcileSurfaces(current, [
      quad('path-1', 0.1 + 0.001 * (i + 1), 0.2),
      ...current.slice(1).map((s) => s.path),
    ]);
    history = recordWrite(history, current, t0 + i * gapMs);
    current = next;
  }
  return { history, tree: current, endedAt: t0 + (samples - 1) * gapMs };
}

describe('S3 — the rule: a write after a quiet period starts a gesture', () => {
  it('the constants the block names', () => {
    expect(ROOM_HISTORY_DEPTH).toBe(20);
    expect(GESTURE_QUIET_MS).toBe(1000);
  });

  it('the first write ever starts a gesture; the next sample inside the quiet period does not', () => {
    const h = createRoomHistory<SurfaceTree>();
    expect(startsGesture(h, 0)).toBe(true);
    const h1 = recordWrite(h, room(1), 1000);
    expect(startsGesture(h1, 1000 + GESTURE_QUIET_MS)).toBe(false);
    expect(startsGesture(h1, 1000 + GESTURE_QUIET_MS + 1)).toBe(true);
  });

  it('a 200-sample drag is ONE entry, and the entry is the room before the drag', () => {
    const before = room(2);
    const { history, tree } = drag(createRoomHistory<SurfaceTree>(), before, 5000, 200);
    expect(history.past.length).toBe(1);
    expect(history.past[0]).toEqual(before);
    expect(tree).not.toEqual(before);
  });

  it('two drags a second apart are two entries', () => {
    const a = drag(createRoomHistory<SurfaceTree>(), room(2), 5000, 50);
    const b = drag(a.history, a.tree, a.endedAt + GESTURE_QUIET_MS + 1, 50);
    expect(b.history.past.length).toBe(2);
    expect(b.history.past[1]).toEqual(a.tree);
  });

  it('holds twenty gestures and drops the oldest', () => {
    let h = createRoomHistory<SurfaceTree>();
    let t = 0;
    for (let i = 0; i < ROOM_HISTORY_DEPTH + 5; i++) {
      h = recordWrite(h, room(i), t);
      t += GESTURE_QUIET_MS + 1;
    }
    expect(h.past.length).toBe(ROOM_HISTORY_DEPTH);
    expect(h.past[0]!.length).toBe(5);
    expect(h.past[ROOM_HISTORY_DEPTH - 1]!.length).toBe(ROOM_HISTORY_DEPTH + 4);
  });
});

describe('S3 — THE CLAIM: the room destroyed by one press comes back as it was before the gesture', () => {
  it('delete every face, undo, and the room is the pre-gesture room — not the morning file', () => {
    // Morning: three faces, committed. Then a session of work: a fourth face
    // marked and dragged into place. Then the press.
    let h = createRoomHistory<SurfaceTree>();
    const morning = room(3);
    const marked = reconcileSurfaces(morning, [...morning.map((s) => s.path), quad('path-4', 0.5, 0.5)]);
    h = recordWrite(h, morning, 10_000);
    const placed = drag(h, marked, 12_000, 120);
    h = placed.history;
    let current = placed.tree;
    expect(current.length).toBe(4);

    // The press: everything gone, in three fast writes.
    let t = placed.endedAt + 3000;
    for (const id of ['surface-1', 'surface-2', 'surface-3', 'surface-4']) {
      const next = removeSurface(current, id);
      h = recordWrite(h, current, t);
      current = next;
      t += 30;
    }
    expect(current).toEqual([]);

    const r = undo(h, current);
    expect(r).not.toBeNull();
    expect(r!.tree).toEqual(placed.tree);
    expect(r!.tree).not.toEqual(morning);
    expect(r!.tree.length).toBe(4);
  });

  it('undo, undo, redo — and a new write clears what could be redone', () => {
    let h = createRoomHistory<SurfaceTree>();
    const a = room(1);
    const b = room(2);
    const c = room(3);
    h = recordWrite(h, a, 0);
    h = recordWrite(h, b, 5000);
    let current = c;
    const u1 = undo(h, current)!;
    expect(u1.tree).toEqual(b);
    current = u1.tree;
    const u2 = undo(u1.history, current)!;
    expect(u2.tree).toEqual(a);
    current = u2.tree;
    expect(undo(u2.history, current)).toBeNull();
    const r1 = redo(u2.history, current)!;
    expect(r1.tree).toEqual(b);
    expect(r1.history.future.length).toBe(1);
    // A new gesture after a redo: the redo stack is gone.
    const h2 = recordWrite(r1.history, r1.tree, 20_000);
    expect(h2.future).toEqual([]);
    expect(redo(h2, room(9))).toBeNull();
  });

  it('nothing to undo on a fresh history, and undo never invents a tree', () => {
    expect(undo(createRoomHistory<SurfaceTree>(), room(1))).toBeNull();
    expect(redo(createRoomHistory<SurfaceTree>(), room(1))).toBeNull();
  });
});

describe('S3 — one writer, two backings, nothing under scenes/', () => {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

  it('main snapshots in the same handler that writes surfaces.json, and nowhere else', () => {
    const main = read('electron/main.ts');
    const writes = [...main.matchAll(/saveSurfacesRaw\(/g)].length;
    const snaps = [...main.matchAll(/saveSurfacesSnapshotRaw\(/g)].length;
    expect(writes).toBe(1);
    expect(snaps).toBe(1);
    const handler = main.slice(main.indexOf('ipcMain.on(CH.surfacesSet'), main.indexOf('ipcMain.handle(CH.surfacesGet'));
    expect(handler.includes('saveSurfacesSnapshotRaw(')).toBe(true);
    expect(handler.includes('startsGesture(')).toBe(true);
    expect(handler.includes('saveSurfacesRaw(')).toBe(true);
  });

  it('the snapshot files live under calibration/, spelled by the calibration store', () => {
    const cal = read('electron/calibration.ts');
    expect(cal.includes("'surfaces.history'")).toBe(true);
    expect(/scenes/.test(read('electron/roomHistory.ts'))).toBe(false);
  });

  it('the rule is imported by both ends from one file', () => {
    expect(read('electron/main.ts').includes("from './roomHistory'")).toBe(true);
    expect(read('src/editor/App.tsx').includes("from '@shared/roomHistory'")).toBe(true);
  });

  it('the editor records in the one room writer and restores through a path that records nothing', () => {
    const app = read('src/editor/App.tsx');
    const apply = app.slice(app.indexOf('const applySurfaces = useCallback'), app.indexOf('const roomHistory = useRef'));
    expect(apply.includes('recordWrite(')).toBe(true);
    const restore = app.slice(app.indexOf('const restoreRoom = useCallback'), app.indexOf('const undoRoom = useCallback'));
    expect(restore.includes('recordWrite(')).toBe(false);
    expect(restore.includes('window.engine.setSurfaces(')).toBe(true);
  });

  it('the scene has no history: no scene file imports the rule, and Scene gains no field', () => {
    for (const f of ['src/core/scene.ts', 'src/core/sceneEdit.ts', 'src/core/sceneFile.ts', 'src/core/layer.ts']) {
      expect(/roomHistory/.test(read(f)), f).toBe(false);
    }
    // No field named history on the scene, whatever the comments say.
    expect(/^\s*history\??:/m.test(read('src/core/scene.ts'))).toBe(false);
  });

  it('the rule is dependency-free, so both processes can hold it', () => {
    expect(/^import /m.test(read('electron/roomHistory.ts'))).toBe(false);
  });
});
