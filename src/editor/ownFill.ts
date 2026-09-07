/**
 * A face with its own animation — the operator's ask of 2026-09-07: *"pick
 * to each layer the animation and that it wouldn't change all of them
 * together."*
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHY IT LIVES IN `editor/`.
 *
 * Every marked face is tagged `panel` and one fill bound to `panel` lights
 * them all — that is beat 5 of the reel and it stays the default. To give one
 * face its own picture the model already has everything it needs: re-tag the
 * face with a token nobody else carries, and bind a fill to that token. The
 * builder can do that by hand today (`SurfacePanel`'s text field, then
 * "+ Add a fill"), and W1 showed that two panels and a typed token is the
 * tool-dropdown failure again. This file is that gesture as one button.
 *
 * It touches BOTH trees, so it cannot live in `core/`: `core/scene.ts` must
 * not learn what a `Surface` is (I-15, `surfaces.test.ts`), and the surface
 * tree must not learn what a show is. `editor/` is where the two meet —
 * `App.tsx` already holds both — and the two halves here are two pure
 * functions, one per tree, so each write goes down its own path: the room
 * through `applySurfaces` (disk, wall, room history) and the scene through
 * `setScene` (registry, output). Neither function sees the other's tree.
 *
 * THE TOKEN IS THE FACE'S ID.
 *
 * `surface-3` is stable, unique, has no whitespace (`roleTokens` splits on
 * it), and is not a surface id in the scene file in any sense I-15 forbids —
 * it is a role string like `panel`, and the room could rename its faces
 * tomorrow without the scene noticing anything but a dark rectangle. The
 * face's NAME is not used because it is operator-editable and may hold
 * spaces.
 *
 * "OWN" REPLACES THE ROLE; IT DOES NOT ADD TO IT.
 *
 * A face tagged `panel surface-3` would show the shared fill AND its own,
 * added together (I-6) — a muddle, not a choice. So "own" makes the role the
 * token alone, and "share" makes it `panel` again and removes the fill it
 * made. A builder who wants both — the shared fill under a sequence slot, the
 * `panel f1` arrangement — types it, as before.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Scene } from '../core/scene';
import { addWhiteFill, removeLayer } from '../core/sceneEdit';
import { DEFAULT_SURFACE_ROLE, withSurfaceRole, type Surface, type SurfaceTree } from '../core/surfaces';

/** The token a face's own fill binds to. */
export function ownFillRole(surface: Pick<Surface, 'id'>): string {
  return surface.id;
}

/** True when the face carries exactly its own token and nothing else. */
export function hasOwnFill(surface: Pick<Surface, 'id' | 'role'>): boolean {
  return surface.role.trim() === ownFillRole(surface);
}

/** Room half of "own": the face's role becomes its own token. Identity when it already is. */
export function withOwnFillRole(tree: SurfaceTree, surfaceId: string): SurfaceTree {
  const s = tree.find((x) => x.id === surfaceId);
  if (!s || hasOwnFill(s)) return tree;
  return withSurfaceRole(tree, surfaceId, ownFillRole(s));
}

/** Room half of "share": back to the default role every face starts with. Identity when it already is. */
export function withSharedFillRole(tree: SurfaceTree, surfaceId: string): SurfaceTree {
  const s = tree.find((x) => x.id === surfaceId);
  if (!s || s.role === DEFAULT_SURFACE_ROLE) return tree;
  return withSurfaceRole(tree, surfaceId, DEFAULT_SURFACE_ROLE);
}

/**
 * Scene half of "own": a fill bound to the face's token, named after the
 * face, starting white so the face lights the moment the button is pressed
 * (the B3 rule: the face places the fill; the picker is the next thing on
 * screen). Identity when one is already bound — a second press must not
 * stack a second white on the first.
 */
export function ensureOwnFillLayer(scene: Scene, surface: Pick<Surface, 'id' | 'name'>): Scene {
  const role = ownFillRole(surface);
  if (scene.layers.some((l) => l.fillRole === role)) return scene;
  return addWhiteFill(scene, role, `${surface.name} — own fill`);
}

/** Scene half of "share": every layer bound to the face's token leaves. Identity when none is. */
export function withoutOwnFillLayers(scene: Scene, surface: Pick<Surface, 'id'>): Scene {
  const role = ownFillRole(surface);
  // Through `removeLayer` — the one structural removal (P5-B) — never a
  // filter that produces a scene of its own.
  return scene.layers.reduce((s, l) => (l.fillRole === role ? removeLayer(s, l.id) : s), scene);
}
