/**
 * S3 — the room's history, as one rule in one place.
 *
 * The room (`calibration/surfaces.json`) writes on EVERY pointer sample and has
 * no save button (SPRINT.md §3 R1), so it can be destroyed by one press at the
 * wall with nothing earlier to load — B3 recorded that twice in a session. This
 * module is the rule that turns a stream of per-sample writes into entries
 * worth restoring, and it is dependency-free so both ends use the same one:
 * the editor's in-memory ring (`Cmd+Z`) and main's rotating snapshot files.
 *
 * The rule: a write arriving more than `GESTURE_QUIET_MS` after the previous
 * write begins a new gesture, and the entry recorded is the room AS IT WAS
 * before that write. Samples inside a gesture record nothing. Twenty entries.
 *
 * This is a backup for calibration, not undo for content (SPEC.md §12; see the
 * `SPEC-CHANGE-PROPOSED` entry in BUILD_LOG.md). Nothing here knows what a
 * scene is, and the generic `T` is the room's tree or its raw file — the
 * module does not care which.
 */

export const ROOM_HISTORY_DEPTH = 20;
export const GESTURE_QUIET_MS = 1000;

export interface RoomHistory<T> {
  /** Oldest first. Each is the room before a gesture began. */
  readonly past: readonly T[];
  /** Undone entries, most recently undone last. Cleared by any new write. */
  readonly future: readonly T[];
  /** Wall-clock of the last write recorded, or -Infinity before any. */
  readonly lastWriteAt: number;
}

export function createRoomHistory<T>(): RoomHistory<T> {
  return { past: [], future: [], lastWriteAt: Number.NEGATIVE_INFINITY };
}

/** True when a write at `now` starts a new gesture under the quiet rule. */
export function startsGesture<T>(h: RoomHistory<T>, now: number): boolean {
  return now - h.lastWriteAt > GESTURE_QUIET_MS;
}

/**
 * A write is about to replace `previous`. Records `previous` if this write
 * starts a gesture; always stamps the time and clears the redo stack.
 */
export function recordWrite<T>(h: RoomHistory<T>, previous: T, now: number): RoomHistory<T> {
  const past = startsGesture(h, now) ? [...h.past, previous].slice(-ROOM_HISTORY_DEPTH) : h.past;
  return { past, future: [], lastWriteAt: now };
}

/** Step back. `current` goes onto the redo stack. Null when there is nothing to undo. */
export function undo<T>(h: RoomHistory<T>, current: T): { history: RoomHistory<T>; tree: T } | null {
  const tree = h.past[h.past.length - 1];
  if (tree === undefined) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, current], lastWriteAt: h.lastWriteAt },
    tree,
  };
}

/** Step forward again. `current` goes back onto the past. Null when there is nothing to redo. */
export function redo<T>(h: RoomHistory<T>, current: T): { history: RoomHistory<T>; tree: T } | null {
  const tree = h.future[h.future.length - 1];
  if (tree === undefined) return null;
  return {
    history: {
      past: [...h.past, current].slice(-ROOM_HISTORY_DEPTH),
      future: h.future.slice(0, -1),
      lastWriteAt: h.lastWriteAt,
    },
    tree,
  };
}
