/**
 * A face IS a layer — the bridge that lets the Layers column show one row
 * per traced face, with its own animation, while the two trees stay two
 * trees on disk (I-15). Operator, 2026-09-07: *"I don't understand why there
 * is Layers and Room now. I want Photoshop: if a layer covers a layer you
 * don't see the layer below."*
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, IN TWO HALVES.
 *
 * Room half — `withFaceRoles`: a face that carries the default role (or
 * none) gets its own token, its id (`ownFill.ts`). Applied inside the one
 * room writer (`App.applySurfaces`), so a face traced in the preview is on
 * its own token before anything reads it. A role typed by hand — `panel f1`,
 * or anything else — is left alone: the builder said something, and the
 * Advanced fold still lets them.
 *
 * Scene half — `syncFaceLayers`: every face on its own token has exactly one
 * fill layer bound to it (`ensureOwnFillLayer`: white, named after the face,
 * identity if present), and a layer bound to a face token whose face is gone
 * leaves. So tracing a face makes a row that lights white at once (beat 3),
 * picking on the row changes only that face, and deleting the row — the
 * face — takes its layer with it. Draw order is the rows' order, top in
 * front, normal blend by default: the one on top covers the one below.
 *
 * THE PRUNE WAITS FOR THE ROOM.
 *
 * At launch the scene file and the room file arrive on two promises. If the
 * scene lands first, every face layer in it names a face the (empty) room
 * does not have yet, and pruning then would throw away the animations the
 * builder picked. So `syncFaceLayers` removes nothing until `roomLoaded` —
 * set once the room read has answered, empty or not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Layer } from '../core/layer';
import type { Scene } from '../core/scene';
import { DEFAULT_SURFACE_ROLE, type Surface, type SurfaceTree } from '../core/surfaces';
import { ensureOwnFillLayer, hasOwnFill, withOwnFillRole, withoutOwnFillLayers } from './ownFill';

/** The shape of a face's own token. A layer bound to one is a face's row. */
const FACE_TOKEN = /^surface-\d+$/;

/** Room half: default-role faces onto their own tokens. Identity when nothing changes. */
export function withFaceRoles(tree: SurfaceTree): SurfaceTree {
  let out = tree;
  for (const s of tree) {
    const role = s.role.trim();
    if (role === DEFAULT_SURFACE_ROLE || role === '') out = withOwnFillRole(out, s.id);
  }
  return out;
}

/** The face a layer is the row of, or `undefined` for a layer that is not a face's. */
export function faceOfLayer(layer: Pick<Layer, 'fillRole'>, tree: SurfaceTree): Surface | undefined {
  if (!layer.fillRole) return undefined;
  const s = tree.find((x) => x.id === layer.fillRole);
  return s && hasOwnFill(s) ? s : undefined;
}

/** Scene half: one layer per own-token face; layers of vanished faces leave once the room is known. */
export function syncFaceLayers(scene: Scene, tree: SurfaceTree, roomLoaded: boolean): Scene {
  let out = scene;
  for (const s of tree) if (hasOwnFill(s)) out = ensureOwnFillLayer(out, s);
  if (!roomLoaded) return out;
  const present = new Set(tree.map((s) => s.id));
  for (const l of scene.layers) {
    if (l.fillRole && FACE_TOKEN.test(l.fillRole) && !present.has(l.fillRole)) {
      out = withoutOwnFillLayers(out, { id: l.fillRole });
    }
  }
  return out;
}
