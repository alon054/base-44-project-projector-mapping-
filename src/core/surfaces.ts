/**
 * I-15 — the surface tree. The half that describes the room.
 *
 * A marked face is a `Surface`: an id, an operator-editable name, a **role**
 * and a path (I-17). Nothing here knows what will be drawn on it, and nothing
 * in the content tree knows this file exists — that is the whole of I-15, and
 * `src/test/surfaces.test.ts` checks it by reading the import graph rather than
 * by trusting this comment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR THINGS THIS FILE IS DELIBERATELY.
 *
 * **Deliberately flat.** SPEC.md calls this a tree and P6-A will make it one.
 * The sprint's version is an ordered list, because the only structure the reel
 * needs is *marking order* and a nesting model invented under a three-day
 * deadline is a nesting model somebody has to migrate. `SurfaceTree` is the
 * name so the later shape arrives as a change to this alias.
 *
 * **Deliberately ordered.** The array order is the order the faces were marked,
 * and `resolveRole` preserves it (see `roles.ts`). On camera that is the order
 * faces light in, so it is load-bearing rather than incidental: a reorder is a
 * different shot.
 *
 * **Deliberately tolerant about `role`.** `role` is a free string, defaulting to
 * `'panel'`, and an unmatched role takes the I-13 flag path rather than a
 * refusal — see `roles.ts` for the reasoning and SPRINT.md §3 R2 for the
 * decision. This is the one stated exception to "refuse what is wrong", and it
 * exists because a typo must not stop a session in a dark room.
 *
 * **Deliberately not a file reader.** The version envelope, the tolerant read
 * and the write live in `render/calibration.ts` alongside warp.json's, and
 * they are literally the same function (`readSurfaces`, `writeSurfaces`). This
 * file supplies the entry shape and nothing else. That direction is forced:
 * nothing under `core/` may import the calibration module (I-5, checked in
 * warp.test.ts), so the loader takes `canonicalizeSurface` as an argument.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The only import is `./paths`. That is I-17 working as intended — a surface's
 * shape and a movement route are the same object, implemented once — and it is
 * not a leak from the content tree, because the primitive belongs to neither.
 */
import { PathFormatError, canonicalizePath, createPath, type Path } from './paths';

/** SPRINT.md §3 R2. A new face is a `panel` until somebody renames it. */
export const DEFAULT_SURFACE_ROLE = 'panel';

/** SPRINT.md §3 R1, exactly. No mask field and no surface mapping — those are P6-A's. */
export interface Surface {
  /** Stable and generated. Content never binds to it (I-15) — roles do that. */
  id: string;
  /** Operator-editable. Defaults to `face N`. Never an identifier. */
  name: string;
  /** Free string, defaults to `'panel'`. Not an enum, on purpose. */
  role: string;
  /** I-17, normalized (I-1). Open or closed; `closed` is a value, not a kind. */
  path: Path;
}

/**
 * The surface tree, in **marking order**. Flat for the sprint; the alias is the
 * seam P6-A widens.
 */
export type SurfaceTree = readonly Surface[];

const ID_PREFIX = 'surface-';

/**
 * The next free id, derived from the highest numeric suffix already in use
 * rather than from the length — so deleting the second of three faces and
 * marking a fourth cannot hand out an id a scene's log already names.
 *
 * Deterministic, and free of `Math.random` (I-12, CLAUDE.md rule 3): the same
 * tree always yields the same next id, which is what makes a re-take of the
 * marking sequence reproduce the same file.
 */
export function nextSurfaceId(tree: SurfaceTree): string {
  let highest = 0;
  for (const s of tree) {
    const m = /^surface-(\d+)$/.exec(s.id);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `${ID_PREFIX}${highest + 1}`;
}

/** `face N`, N counted the same way, so the name and the id agree on a fresh tree. */
export function nextSurfaceName(tree: SurfaceTree): string {
  let highest = 0;
  for (const s of tree) {
    const m = /^face (\d+)$/.exec(s.name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `face ${highest + 1}`;
}

export function createSurface(init: {
  id: string;
  name?: string;
  role?: string;
  path: Path;
}): Surface {
  return {
    id: init.id,
    name: init.name === undefined || init.name === '' ? init.id : init.name,
    role: init.role === undefined || init.role === '' ? DEFAULT_SURFACE_ROLE : init.role,
    path: init.path,
  };
}

/**
 * Append a marked face. **Append, never insert** — marking order is the render
 * order and inserting into the middle of it would silently re-cut the shot.
 */
export function addSurface(
  tree: SurfaceTree,
  path: Path,
  init: { name?: string; role?: string } = {},
): Surface[] {
  return [
    ...tree,
    createSurface({
      id: nextSurfaceId(tree),
      name: init.name ?? nextSurfaceName(tree),
      role: init.role ?? DEFAULT_SURFACE_ROLE,
      path,
    }),
  ];
}

/**
 * Replace one surface's path, keeping its position in marking order.
 *
 * This is what a point drag calls (B3), which is why it copies the list and not
 * the paths: the wall has to answer while a finger is still down.
 */
export function withSurfacePath(tree: SurfaceTree, id: string, path: Path): Surface[] {
  return tree.map((s) => (s.id === id ? { ...s, path } : s));
}

/** Re-tag a face. An empty role falls back to the default rather than vanishing. */
export function withSurfaceRole(tree: SurfaceTree, id: string, role: string): Surface[] {
  const next = role === '' ? DEFAULT_SURFACE_ROLE : role;
  return tree.map((s) => (s.id === id ? { ...s, role: next } : s));
}

export function withSurfaceName(tree: SurfaceTree, id: string, name: string): Surface[] {
  return tree.map((s) => (s.id === id ? { ...s, name: name === '' ? s.id : name } : s));
}

export function removeSurface(tree: SurfaceTree, id: string): Surface[] {
  return tree.filter((s) => s.id !== id);
}

export function surfaceById(tree: SurfaceTree, id: string): Surface | undefined {
  return tree.find((s) => s.id === id);
}

/**
 * The validation boundary for a stored or transmitted surface.
 *
 * **Tolerant, and it never throws** — `readViewport`'s policy one file over, for
 * the same reason: a room description that fails to load costs an evening of
 * re-marking, and a session that will not start costs the session (I-13). An
 * entry this build cannot read is dropped and the rest of the room survives,
 * so the loader returns `null` here rather than raising.
 *
 * The three fields degrade differently, and on purpose:
 *
 * - `id` and `path` are **structural**. Without them there is no surface to
 *   have an opinion about, so a missing or malformed one drops the entry.
 * - `name` falls back to the id. A face with an unhelpful label is still a face.
 * - `role` falls back to `'panel'`. A role that is not a string never reached
 *   here from the editor, and defaulting it leaves a face that can be re-tagged
 *   in one click at the wall instead of one that is missing from the room.
 */
export function canonicalizeSurface(raw: unknown): Surface | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || o['id'] === '') return null;
  let path: Path;
  try {
    path = canonicalizePath(o['path']);
  } catch (e) {
    if (e instanceof PathFormatError) return null;
    throw e;
  }
  return createSurface({
    id: o['id'],
    name: typeof o['name'] === 'string' ? o['name'] : o['id'],
    role: typeof o['role'] === 'string' ? o['role'] : DEFAULT_SURFACE_ROLE,
    path,
  });
}

/** A surface with an empty path — the shape a fresh mark starts from. */
export function emptySurface(id: string, name?: string): Surface {
  return createSurface({
    id,
    ...(name === undefined ? {} : { name }),
    path: createPath({ id: `${id}-path`, closed: true }),
  });
}

/**
 * The `[surfaces]` log line, mirroring `[warp]` and `[scene] applied`.
 *
 * Those two lines are what made three editor faults findable in Phase 1 and the
 * warp's state readable in Phase 2. The equivalent for the room must exist
 * BEFORE anything is debugged in a dark room, not after.
 */
export function describeSurfaces(tree: SurfaceTree): string {
  if (tree.length === 0) return '[surfaces] none';
  const each = tree
    .map((s) => `${s.id}:"${s.name}" role=${s.role} pts=${s.path.points.length}${s.path.closed ? ' closed' : ' open'}`)
    .join(' | ');
  return `[surfaces] ${tree.length}: ${each}`;
}

/**
 * The surface tree brought into step with a list of paths — B3's single write.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONE FUNCTION THE WHOLE WALL LOOP GOES THROUGH.
 *
 * Banking a face, dragging one of its points, deleting a point, moving the
 * whole face and deleting the face are five gestures in `pathTool.ts` and they
 * all produce the same thing: a new list of paths. Rather than five call sites
 * each remembering to write `surfaces.json`, the editor hands the new list here
 * and the result IS the room — so "rewritten on every change" (SPRINT.md §3 R1)
 * is a property of having one path to the file rather than of five call sites
 * being careful. CLAUDE.md's "ship a fix as a mechanism, not as an edit".
 *
 * Matching is **by path id**, which is what carries a face's identity through a
 * drag. `role` and `name` are the operator's and survive every geometric edit:
 * dragging a point of a face tagged `box-left` must not silently retag it
 * `panel`, and this is where that is guaranteed rather than in each handler.
 *
 * A path the tree has never seen is a **bank** — a newly marked face, given the
 * next free id and `face N`. A surface whose path is gone has been deleted.
 * Order follows `paths`, which is marking order, because that is the order
 * faces light in (see this file's header).
 *
 * **Returns the tree unchanged, by identity, when nothing moved.** A pointer
 * that has not travelled far enough to move a clamped path produces the same
 * list, and the editor tests that identity to decide whether to write the file
 * and cross the process boundary at all. Without it, holding the mouse still
 * mid-drag would write `surfaces.json` sixty times a second.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function reconcileSurfaces(tree: SurfaceTree, paths: readonly Path[]): SurfaceTree {
  const byPath = new Map<string, Surface>();
  for (const s of tree) byPath.set(s.path.id, s);

  const out: Surface[] = [];
  let changed = paths.length !== tree.length;
  for (const path of paths) {
    const existing = byPath.get(path.id);
    if (existing) {
      // Same path object: this face was not touched, and keeping the SAME
      // surface object is what lets the compositor's reshape skip it.
      if (existing.path === path) {
        out.push(existing);
      } else {
        out.push({ ...existing, path });
        changed = true;
      }
      continue;
    }
    // A bank. Ids are allocated against the tree AND everything produced so
    // far, so marking two faces in one reconciliation cannot hand out one id
    // twice — and neither can a delete that freed a suffix earlier in the list.
    const known: Surface[] = [...tree, ...out];
    out.push(
      createSurface({
        id: nextSurfaceId(known),
        name: nextSurfaceName(known),
        role: DEFAULT_SURFACE_ROLE,
        path,
      }),
    );
    changed = true;
  }

  if (!changed && out.every((s, i) => s === tree[i])) return tree;
  return out;
}
