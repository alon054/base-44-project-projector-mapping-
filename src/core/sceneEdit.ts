/**
 * Structural scene edits: which layers exist, and in what order.
 *
 * These are separate from the I-8 registry on purpose. A parameter is a value
 * on a layer that exists; adding and deleting layers is a change to the set the
 * registry indexes, so it cannot be one of the things the registry addresses.
 *
 * Pure functions rather than methods on a component, because Gate 1 asks
 * whether reordering changes occlusion correctly, and that should be answerable
 * by a unit test rather than only by clicking. Phase 6's history (D12) snapshots
 * the results of these.
 */
import {
  clamp01,
  createLayer,
  type BlendMode,
  type JsonObject,
  type Layer,
  type NormalizedTransform,
} from './layer';
import { layersInDrawOrder, reindexZOrder, type Scene } from './scene';
import {
  DEFAULT_CHILD_DURATION_SECONDS,
  groupOfLayer,
  type Group,
  type GroupChild,
  type GroupMode,
} from './groups';
import { PROCEDURAL_PROVIDER_ID } from '../providers/procedural/ProceduralProvider';

/**
 * The smallest a region may be made, in normalized units (I-1).
 *
 * A clamp rather than a refusal, and load-bearing rather than cosmetic: a
 * region dragged to zero width is invisible, unhittable and therefore
 * unrecoverable without editing the JSON by hand — a state the editor can
 * reach in one gesture and cannot leave in any. Same reasoning as `clamp01`:
 * the value drifted somewhere useless, so it is pulled back rather than
 * rejected.
 */
export const MIN_LAYER_EXTENT = 0.02;

/** A normalized box: centre plus extents, exactly `NormalizedTransform` minus rotation (I-1). */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A structural edit was asked for with a value that is not a number at all.
 *
 * The clamp-versus-refuse rule Block A settled (`core/paths.ts`): a coordinate
 * outside `[0, 1]` is float drift and is clamped, while a non-finite one is not
 * an out-of-range number — it is the arithmetic having gone wrong upstream, and
 * `clamp01(NaN)` would silently teleport a region to the top-left corner. That
 * is the plausible-wrong-answer failure A9 names, so it is refused with the
 * layer, the field and the offending value in the message.
 */
export class SceneEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneEditError';
  }
}

export interface AddLayerSpec {
  providerId: string;
  content: JsonObject;
  /** Prefix for the generated id. The suffix makes it unique in the scene. */
  idPrefix: string;
  name?: string;
  blendMode?: BlendMode;
  /**
   * Where the layer goes, normalized (I-1). Absent means the staggered default
   * below — which is what the layer-list buttons want, since they name no
   * place. A region drawn on the preview names one, and it wins.
   */
  rect?: NormalizedRect;
  /**
   * I-15 / SPRINT.md §3 R2. Bind the layer to a ROLE rather than to a place: it
   * renders once into every surface carrying this role, clipped to each.
   *
   * A free string, and one this file has no opinion about — the surface tree is
   * the other half of I-15 and `core/` is forbidden from importing it. A role
   * naming nothing is I-13's flag path, not an error.
   */
  fillRole?: string;
}

/**
 * Distinct, deterministic tints for added layers. Not decoration: two layers
 * that look identical cannot demonstrate z-order, and Gate 1 asks whether
 * reordering changes occlusion *correctly* — a question that needs the answer
 * to be visible. Fixed rather than random so a scene built by clicking is still
 * reproducible from its JSON (I-12).
 */
const ADDED_TINTS = [0xd02020, 0x2040d0, 0x20c060, 0xd0a020, 0xa040d0, 0x20c0d0] as const;

/**
 * Appends a layer at the top of the draw order with a unique id.
 *
 * The id has to be unique for two independent reasons, and either alone would
 * be enough: `entity.<id>.*` keys must not collide (I-8), and the scene format
 * refuses a duplicate layer id outright.
 */
export function addLayer(scene: Scene, spec: AddLayerSpec): Scene {
  let n = 1;
  while (scene.layers.some((l) => l.id === `${spec.idPrefix}-${n}`)) n++;
  const id = `${spec.idPrefix}-${n}`;
  const nth = scene.layers.length;
  return reindexZOrder({
    ...scene,
    layers: [
      ...scene.layers,
      createLayer({
        id,
        name: spec.name ?? `${spec.idPrefix} ${n}`,
        providerId: spec.providerId,
        // A caller-supplied tint always wins; this only fills the gap so that
        // two layers of the same kind are not the same colour.
        content:
          spec.content['tint'] === undefined
            ? { ...spec.content, tint: ADDED_TINTS[nth % ADDED_TINTS.length] as number }
            : spec.content,
        zOrder: scene.layers.length,
        // A drawn rect wins. Without one: half-frame, and STAGGERED rather than
        // centred. Every added layer used to land on exactly the same box with
        // the same default colour, so two of them were pixel-identical and
        // reordering them changed nothing on screen — the engine was right and
        // the scene could not show it. That stagger is still what the layer-list
        // buttons need, because a button names no place; P5-B's gesture does,
        // which is the case the branch above exists for.
        transform: spec.rect
          ? { ...normalizeRectFields(spec.rect, id), rotation: 0 }
          : {
              x: 0.5 + (((nth % 3) - 1) * 0.12),
              y: 0.5 + (((Math.floor(nth / 3) % 3) - 1) * 0.12),
              width: 0.5,
              height: 0.5,
              rotation: 0,
            },
        ...(spec.blendMode ? { blendMode: spec.blendMode } : {}),
        // Spread, not assigned, for `createLayer`'s reason: absent must stay
        // absent or the deep-equal round-trip fails on a key that serializes
        // to nothing.
        ...(spec.fillRole === undefined ? {} : { fillRole: spec.fillRole }),
      }),
    ],
  });
}

/**
 * SPRINT.md's opening beat, as one call: a flat white layer bound to a role.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the calibration aid and the reel's first shot at the same time, which
 * is why it is a preset rather than six fields the builder fills in with a
 * projector running: mark a face, it lights white, drag its points until the
 * white sits exactly on the face. Every later beat is that one with the fill
 * swapped.
 *
 * `rect`, not `tint`, is the reason this is a function rather than a comment.
 * `addLayer` assigns a staggered colour to any layer whose content omits
 * `tint`, so a "white" preset that forgot to name white would come out one of
 * six pastels — and on a dark box, judged by eye at three metres, a pale green
 * fill reads as white until the moment it does not.
 *
 * The transform is half-frame and centred even though **a fill layer's own
 * transform is inert** — the face places it. It exists for the state where the
 * role is cleared: the layer becomes an ordinary rect, and a FULL-frame white
 * one would flood the projector white in a dark room with somebody looking at
 * it. Half-frame is visible, obviously wrong, and harmless.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function addWhiteFill(scene: Scene, role: string): Scene {
  return addLayer(scene, {
    idPrefix: 'whitefill',
    name: `white fill (${role})`,
    providerId: PROCEDURAL_PROVIDER_ID,
    content: { kind: 'rect', tint: 0xffffff },
    rect: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    fillRole: role,
  });
}

/**
 * The one structural removal in the engine, and therefore the one place a
 * layer's GPU resources can be orphaned.
 *
 * **Disposal is not this function's job and must not become it.** Every scene
 * this returns reaches the renderer through `RenderHost.setScene`, and
 * `Compositor.setScene` opens by tearing the whole stack down — every provider
 * view destroyed, every holder destroyed — before rebuilding from the new
 * state. So a layer that leaves the scene here has its texture released by the
 * next `setScene`, with no call for a caller to remember and no second removal
 * path to keep in step. That is the mechanism; a `dispose()` call added here
 * would be a guard beside it, and a second one to forget.
 *
 * `sceneEdit.test.ts` asserts the teardown-first ordering in the compositor, so
 * the claim above fails a test rather than a soak if someone reorders it.
 */
export function removeLayer(scene: Scene, id: string): Scene {
  return reindexZOrder({
    ...scene,
    layers: scene.layers.filter((l) => l.id !== id),
    // A group naming a layer the scene no longer has is refused at the scene
    // boundary (I-16), so the layer leaves its group in the same edit that
    // removes it — one removal, both trees of the scene consistent after it.
    groups: withoutChild(scene.groups, id),
  });
}

/* ───────────────────────────── groups (B4) ───────────────────────────── */

/** `groups` with `layerId` removed from whichever group held it. Identity when none did. */
function withoutChild(groups: readonly Group[], layerId: string): Group[] {
  if (!groups.some((g) => g.children.some((c) => c.id === layerId))) return groups as Group[];
  return groups.map((g) =>
    g.children.some((c) => c.id === layerId)
      ? { ...g, children: g.children.filter((c) => c.id !== layerId) }
      : g,
  );
}

/**
 * Appends an empty group with a unique id. The id is unique for I-8's reason:
 * `group.<id>.mode` must not collide, and the scene format refuses a duplicate.
 */
export function addGroup(scene: Scene, mode: GroupMode = 'sequence'): Scene {
  let n = 1;
  while (scene.groups.some((g) => g.id === `group-${n}`)) n++;
  return { ...scene, groups: [...scene.groups, { id: `group-${n}`, mode, children: [] }] };
}

/**
 * Removes a group. Its layers are NOT removed — they fall back into the
 * implicit root, which is where a layer with no group lives (I-16). Deleting
 * a "this, then that" must not delete the this and the that.
 */
export function removeGroup(scene: Scene, groupId: string): Scene {
  if (!scene.groups.some((g) => g.id === groupId)) return scene;
  return { ...scene, groups: scene.groups.filter((g) => g.id !== groupId) };
}

/**
 * Puts a layer in a group, or back in the implicit root (`null`).
 *
 * A layer has one place: it is taken out of whichever group held it first,
 * then appended to the target — at the END, because in a `sequence` the
 * children's order is the block order and a layer that joins goes after the
 * blocks already there. A duration it had in its old group travels with it;
 * one it never had is filled with the default when the target is a sequence,
 * so the stored JSON states every block length (`canonicalizeChild`'s rule).
 *
 * Unknown layer or group ids return the scene unchanged — a panel firing at a
 * layer deleted a moment ago is a race, not a corrupt request.
 */
export function setLayerGroup(scene: Scene, layerId: string, groupId: string | null): Scene {
  if (!scene.layers.some((l) => l.id === layerId)) return scene;
  const current = groupOfLayer(scene, layerId);
  if ((current?.id ?? null) === groupId) return scene;
  if (groupId !== null && !scene.groups.some((g) => g.id === groupId)) return scene;
  const previous = current?.children.find((c) => c.id === layerId);
  const stripped = withoutChild(scene.groups, layerId);
  if (groupId === null) return { ...scene, groups: stripped };
  return {
    ...scene,
    groups: stripped.map((g) => {
      if (g.id !== groupId) return g;
      const child: GroupChild =
        previous?.duration !== undefined
          ? { id: layerId, duration: previous.duration }
          : g.mode === 'sequence'
            ? { id: layerId, duration: DEFAULT_CHILD_DURATION_SECONDS }
            : { id: layerId };
      return { ...g, children: [...g.children, child] };
    }),
  };
}

/**
 * Moves a child through its group's order. `delta` is +1 towards the end.
 * In a `sequence` this is the block order — "this, then that" — and it is
 * independent of z-order on purpose: which block plays when and which layer
 * draws over which are two different questions.
 *
 * Returns the scene unchanged at either end rather than wrapping, for
 * `moveLayer`'s reason.
 */
export function moveChild(scene: Scene, groupId: string, layerId: string, delta: number): Scene {
  const group = scene.groups.find((g) => g.id === groupId);
  if (!group) return scene;
  const i = group.children.findIndex((c) => c.id === layerId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= group.children.length) return scene;
  const children = [...group.children];
  const a = children[i] as GroupChild;
  children[i] = children[j] as GroupChild;
  children[j] = a;
  return { ...scene, groups: scene.groups.map((g) => (g.id === groupId ? { ...g, children } : g)) };
}

/**
 * Sets a group's mode — the registry's `group.<id>.mode` write lands here.
 *
 * Switching TO `sequence` fills any child that never stated a duration with
 * the default, for the same reason the canonicalizer does; switching away
 * keeps every duration, so the round trip is lossless.
 */
export function setGroupMode(scene: Scene, groupId: string, mode: GroupMode): Scene {
  const group = scene.groups.find((g) => g.id === groupId);
  if (!group || group.mode === mode) return scene;
  const children =
    mode === 'sequence'
      ? group.children.map((c) =>
          c.duration === undefined ? { id: c.id, duration: DEFAULT_CHILD_DURATION_SECONDS } : c,
        )
      : group.children;
  return {
    ...scene,
    groups: scene.groups.map((g) => (g.id === groupId ? { ...g, mode, children } : g)),
  };
}

/**
 * Sets one child's block length — the registry's `child.<id>.duration` write.
 * Refuses a non-finite or non-positive value with the ids in the message: a
 * zero-length block is a sequence that skips a child nobody deleted, which is
 * the plausible wrong answer, not drift.
 */
export function setChildDuration(scene: Scene, layerId: string, duration: number): Scene {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    throw new SceneEditError(
      `child "${layerId}": duration must be a finite number > 0 seconds, got ${JSON.stringify(duration)}`,
    );
  }
  const group = groupOfLayer(scene, layerId);
  if (!group) return scene;
  return {
    ...scene,
    groups: scene.groups.map((g) =>
      g.id === group.id
        ? { ...g, children: g.children.map((c) => (c.id === layerId ? { ...c, duration } : c)) }
        : g,
    ),
  };
}

/**
 * Sets a layer's normalized box — the mutation behind both dragging a region
 * and dragging its corner handle.
 *
 * One function for move and scale rather than two, because a corner drag is
 * *both*: the opposite corner stays put, so the centre moves as the size
 * changes. Two functions would mean two writes per gesture and an intermediate
 * state where the region has its new size at its old centre.
 *
 * **`rotation` is not a field here.** It exists on the stored transform, in
 * turns, and this block ships no gesture that writes it (CHECKLIST P5-B). A
 * partial write that carried rotation would be a rotate handle with no handle.
 *
 * Absent fields are left alone; present ones are clamped into `[0, 1]` and the
 * extents to at least `MIN_LAYER_EXTENT`; non-numbers are refused. Unknown ids
 * return the scene unchanged, which is what `moveLayer` and `reorderLayer`
 * already do — a pointer gesture against a layer that has since been deleted is
 * a race, not a corrupt request.
 */
export function setLayerRect(scene: Scene, id: string, rect: Partial<NormalizedRect>): Scene {
  if (!scene.layers.some((l) => l.id === id)) return scene;
  return {
    ...scene,
    layers: scene.layers.map((l) =>
      l.id === id ? { ...l, transform: applyRect(l.transform, rect, id) } : l,
    ),
  };
}

function applyRect(
  t: NormalizedTransform,
  rect: Partial<NormalizedRect>,
  layerId: string,
): NormalizedTransform {
  const next: NormalizedTransform = { ...t };
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const v = rect[field];
    if (v === undefined) continue;
    next[field] = checkedCoordinate(v, field, layerId);
  }
  // The extents only. A centre AT the frame edge is a region half off-screen,
  // which is a legitimate thing to want on a wall; a zero-width region is not.
  next.width = Math.max(MIN_LAYER_EXTENT, next.width);
  next.height = Math.max(MIN_LAYER_EXTENT, next.height);
  return next;
}

/** Every normalized field entering stored state from a gesture passes here. */
function checkedCoordinate(v: number, field: string, layerId: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SceneEditError(
      `layer "${layerId}": ${field} must be a finite number, got ${JSON.stringify(v)}`,
    );
  }
  return clamp01(v);
}

function normalizeRectFields(rect: NormalizedRect, layerId: string): NormalizedRect {
  return {
    x: checkedCoordinate(rect.x, 'x', layerId),
    y: checkedCoordinate(rect.y, 'y', layerId),
    width: Math.max(MIN_LAYER_EXTENT, checkedCoordinate(rect.width, 'width', layerId)),
    height: Math.max(MIN_LAYER_EXTENT, checkedCoordinate(rect.height, 'height', layerId)),
  };
}

/**
 * Moves a layer through the draw order. `delta` is +1 towards the front.
 *
 * Returns the scene unchanged at either end rather than wrapping — a layer that
 * jumped from the back to the front because the operator pressed the button
 * once too often is a surprise in a live session.
 */
/**
 * Moves a layer to an absolute position in the draw order. Backs drag-and-drop,
 * where the operator names a destination rather than a direction.
 *
 * Out-of-range destinations are **clamped**, unlike `moveLayer`, which returns
 * the scene unchanged. The difference is deliberate and follows the gesture:
 * a button press past the end is a mistake and should do nothing, while a drag
 * past the end is an unambiguous request for "put it at the end".
 */
export function reorderLayer(scene: Scene, id: string, toIndex: number): Scene {
  const order = layersInDrawOrder(scene);
  const from = order.findIndex((l) => l.id === id);
  if (from < 0) return scene;
  const to = Math.max(0, Math.min(order.length - 1, Math.floor(toIndex)));
  if (to === from) return scene;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as Layer);
  // Same rule as `moveLayer`: zOrder comes from the new ARRAY position, never
  // from `reindexZOrder`, which would re-sort by the values being changed.
  return { ...scene, layers: next.map((l, k) => ({ ...l, zOrder: k })) };
}

export function moveLayer(scene: Scene, id: string, delta: number): Scene {
  const order = layersInDrawOrder(scene);
  const i = order.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return scene;
  const swapped = [...order];
  const a = swapped[i] as Layer;
  const b = swapped[j] as Layer;
  swapped[i] = b;
  swapped[j] = a;
  // `zOrder` is assigned from the new ARRAY position, not re-derived by
  // `reindexZOrder`. That function re-indexes by current draw order, which for
  // a swap means sorting by the very `zOrder` values the swap was meant to
  // exchange — it puts the layers straight back where they were. Correct for
  // add and remove, silently a no-op here.
  return { ...scene, layers: swapped.map((l, k) => ({ ...l, zOrder: k })) };
}
