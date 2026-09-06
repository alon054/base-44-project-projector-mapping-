/**
 * I-16 — grouping is hierarchical; sequencing is DERIVED, never accumulated.
 *
 * Sprint block B4: SPRINT.md §3 R4, exactly and nothing more. A `Group` is a
 * node with an id, a mode and an ordered list of children; `parallel` is what
 * the engine does today, named; `sequence` gives each child a duration and
 * derives the active one from the clock.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE IS NO TRIGGER MECHANISM HERE AND THERE MUST NOT BE ONE.
 *
 * No completion event, no per-child playhead, no accumulated position, no
 * timer. `resolveAt(group, t)` is a pure function of clock time: the same `t`
 * always gives the same child at the same local time, which is what lets a
 * re-take start at the same frame and what stops "in turn" drifting out of
 * phase with "together" over a forty-second shot. Pause freezes a sequence in
 * the same frame as everything else because there is nothing in it that could
 * keep running; a scrub lands it exactly because there is no history to
 * integrate. A grep test asserts the absence of every one of those mechanisms
 * with comments stripped, the way `motion.ts`'s asserts it has no phase
 * arithmetic of its own.
 *
 * THE ONE FUNCTION THAT TURNS TIME INTO POSITION IS `phaseAt` (I-2).
 *
 * `resolveAt` asks it for the normalized position in a loop of the group's
 * total duration and walks the block boundaries from there. There is no `%`
 * and no `Math.floor` in this file, so a curve mode, a rate change or a scrub
 * behaves identically for a sequence and for a sprite sheet: both derive from
 * the same arithmetic in the same place.
 *
 * WHAT IS DELIBERATELY NOT HERE (P7-A / P7-C / P7-E, resumed later).
 *
 * Nesting, `durationOverride`, group motion, group bindings, `within`, the
 * block strip. Children are LAYER ids. A group is implicitly a child of the
 * scene's root; a layer in no group is in that root. There is no `loop` field:
 * a sequence always loops, and the word `loop` is already spent on
 * `RouteMotion.endBehavior`, which this sprint renames nothing to make room for.
 *
 * WHY THE ROOT IS IMPLICIT.
 *
 * `Scene.groups` lists only the groups an operator made. A scene written before
 * groups existed therefore loads with `groups: []`, every layer in the implicit
 * `parallel` root, and renders byte-identical to what it rendered before — the
 * migration is the absence of a field, which cannot be got wrong. `rootGroup`
 * hands the root back as an ordinary `Group` for anything that wants a node.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { GLOBAL_LOOP_SECONDS, phaseAt } from './clock';
import { isKeySegment } from './layer';
import type { Scene } from './scene';

export const GROUP_MODES = ['parallel', 'sequence'] as const;
export type GroupMode = (typeof GROUP_MODES)[number];

export function isGroupMode(v: unknown): v is GroupMode {
  return typeof v === 'string' && (GROUP_MODES as readonly string[]).includes(v);
}

/** The implicit root's id. Never stored; `rootGroup` synthesises it. */
export const ROOT_GROUP_ID = 'root';

/**
 * A child's block length when it states none, in seconds.
 *
 * `GLOBAL_LOOP_SECONDS` rather than a second literal: it is the period a
 * provider with no loop of its own already runs at, so a child that says
 * nothing about its duration runs for exactly one default loop.
 */
export const DEFAULT_CHILD_DURATION_SECONDS = GLOBAL_LOOP_SECONDS;

/**
 * The CONTROL range for a child's duration — the registry's slider stops, not
 * the legality boundary. A stored duration is legal if it is finite and
 * positive; these are what a fader can reach.
 */
export const CHILD_DURATION_MIN_SECONDS = 0.1;
export const CHILD_DURATION_MAX_SECONDS = 600;

export interface GroupChild {
  /** A layer id. Nesting is cut, so a child is never a group (SPRINT.md §3 R4). */
  id: string;
  /**
   * Block length in seconds. Meaningful in a `sequence`, inert in a `parallel`
   * group — and KEPT there, so toggling a group's mode back and forth does not
   * destroy the durations the operator typed.
   */
  duration?: number;
}

/** SPRINT.md §3 R4, exactly. No `loop` field. */
export interface Group {
  id: string;
  mode: GroupMode;
  children: GroupChild[];
}

export class GroupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupFormatError';
  }
}

/** A child's block length, with the default applied. */
export function childDuration(child: GroupChild): number {
  return child.duration ?? DEFAULT_CHILD_DURATION_SECONDS;
}

export function createGroup(init: {
  id: string;
  mode?: GroupMode;
  children?: readonly GroupChild[];
}): Group {
  const mode = init.mode ?? 'parallel';
  return {
    id: init.id,
    mode,
    children: (init.children ?? []).map((c) => canonicalizeChild(c, mode, init.id)),
  };
}

/**
 * Accepts anything shaped roughly like a group and returns a canonical one, or
 * throws naming the group, the field and the offending value.
 *
 * Refusals, not clamps, throughout: a group is authored, not dragged, so a
 * value that is wrong here came from a file this build does not understand,
 * and reading an unknown mode as `parallel` would be a sequence silently
 * playing everything at once — a plausible wrong answer on a wall.
 *
 * The one fill: a `sequence` child with no `duration` gets the default, so
 * the stored JSON states the block lengths rather than deferring to whatever
 * the code's default is next year (the ruling `Scene.forces` already made).
 */
export function canonicalizeGroup(raw: unknown): Group {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new GroupFormatError('group must be an object');
  }
  const o = raw as Record<string, unknown>;
  if (!isKeySegment(o['id'])) {
    throw new GroupFormatError(
      `group.id must be a usable key segment (I-8), got ${JSON.stringify(o['id'])}`,
    );
  }
  const id = o['id'];
  const mode = o['mode'] === undefined ? 'parallel' : o['mode'];
  if (!isGroupMode(mode)) {
    throw new GroupFormatError(
      `group "${id}": mode must be one of [${GROUP_MODES.join(', ')}], got ${JSON.stringify(mode)}`,
    );
  }
  const rawChildren = o['children'] === undefined ? [] : o['children'];
  if (!Array.isArray(rawChildren)) {
    throw new GroupFormatError(`group "${id}": children must be an array`);
  }
  const children = rawChildren.map((c, i) => canonicalizeChild(c, mode, id, i));
  const seen = new Set<string>();
  for (const c of children) {
    if (seen.has(c.id)) {
      throw new GroupFormatError(`group "${id}": child "${c.id}" appears twice`);
    }
    seen.add(c.id);
  }
  return { id, mode, children };
}

function canonicalizeChild(raw: unknown, mode: GroupMode, groupId: string, index = -1): GroupChild {
  const where = index < 0 ? `group "${groupId}" child` : `group "${groupId}" children[${index}]`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new GroupFormatError(`${where} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  if (!isKeySegment(o['id'])) {
    throw new GroupFormatError(
      `${where}: id must be a usable key segment (I-8), got ${JSON.stringify(o['id'])}`,
    );
  }
  const d = o['duration'];
  if (d !== undefined) {
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) {
      throw new GroupFormatError(
        `${where} ("${o['id']}"): duration must be a finite number > 0 seconds, got ${JSON.stringify(d)}`,
      );
    }
    return { id: o['id'], duration: d };
  }
  // Spread rather than assigned: `{ duration: undefined }` and `{}` serialize
  // the same but are not deep-equal, and the round-trip check is on deep
  // equality. A parallel child that states nothing stays stating nothing.
  return mode === 'sequence' ? { id: o['id'], duration: DEFAULT_CHILD_DURATION_SECONDS } : { id: o['id'] };
}

/**
 * The group's total length in seconds: the sum of its children's blocks for a
 * `sequence`; 0 for a `parallel` group, which has no length of its own (its
 * children each run at their own period — D18's "longest child" rule is
 * nesting, which is cut).
 */
export function groupDuration(group: Group): number {
  if (group.mode !== 'sequence') return 0;
  return group.children.reduce((sum, c) => sum + childDuration(c), 0);
}

/** Where a sequence is at one instant. Derived; never stored. */
export interface SequencePosition {
  /** Index into `group.children`. */
  index: number;
  child: GroupChild;
  /** Seconds into this child's block, in `[0, duration)`. */
  localSeconds: number;
  /** Where this block starts inside the group's loop, in seconds. */
  blockStartSeconds: number;
}

/**
 * The active child of a `sequence` at `timeSeconds`, and how far into it.
 *
 * `(t mod groupDuration)` against block boundaries, exactly as I-16 states it
 * — with the `mod` being `phaseAt`, the one function that turns clock time
 * into a normalized position (I-2), scaled back up by the group's length.
 *
 * `null` for a `parallel` group (every child is active and there is nothing
 * to resolve) and for a sequence with no children. A sequence of zero total
 * duration cannot exist: every child's duration is positive by construction.
 */
export function resolveAt(group: Group, timeSeconds: number): SequencePosition | null {
  if (group.mode !== 'sequence' || group.children.length === 0) return null;
  const total = groupDuration(group);
  const local = phaseAt(timeSeconds * 1000, total) * total;
  let start = 0;
  for (let i = 0; i < group.children.length; i++) {
    const child = group.children[i] as GroupChild;
    const end = start + childDuration(child);
    if (local < end) {
      return { index: i, child, localSeconds: local - start, blockStartSeconds: start };
    }
    start = end;
  }
  // Float drift at the very end of the loop: `phaseAt` is in [0, 1) so `local`
  // is below `total`, but the boundary sum can round a hair under it. That is
  // the last block's final instant, not an error.
  const index = group.children.length - 1;
  const child = group.children[index] as GroupChild;
  return {
    index,
    child,
    localSeconds: childDuration(child),
    blockStartSeconds: total - childDuration(child),
  };
}

/**
 * Whether one child of `group` is showing at `timeSeconds`.
 *
 * A `parallel` group's children are all active; a `sequence` shows exactly
 * one. A child id not in the group is not active — it is not the group's to
 * show.
 */
export function isChildActive(group: Group, childId: string, timeSeconds: number): boolean {
  if (!group.children.some((c) => c.id === childId)) return false;
  if (group.mode !== 'sequence') return true;
  return resolveAt(group, timeSeconds)?.child.id === childId;
}

/* ───────────────────────── scene-level questions ───────────────────────── */

/** The explicit group holding this layer, or `undefined` for the implicit root. */
export function groupOfLayer(scene: Pick<Scene, 'groups'>, layerId: string): Group | undefined {
  return scene.groups.find((g) => g.children.some((c) => c.id === layerId));
}

/**
 * Whether a layer is showing at `timeSeconds`, by its group's rule.
 *
 * A layer in no group is in the implicit `parallel` root and is always
 * active. That is the migration: a scene from before groups answers `true`
 * for every layer, which is what it did when the question did not exist.
 */
export function layerActiveAt(scene: Pick<Scene, 'groups'>, layerId: string, timeSeconds: number): boolean {
  const group = groupOfLayer(scene, layerId);
  return group === undefined ? true : isChildActive(group, layerId, timeSeconds);
}

/**
 * The implicit root as a node: `parallel`, holding every layer that is in no
 * explicit group, in draw order. Synthesised on request and never stored.
 */
export function rootGroup(scene: Pick<Scene, 'layers' | 'groups'>): Group {
  const grouped = new Set<string>();
  for (const g of scene.groups) for (const c of g.children) grouped.add(c.id);
  return {
    id: ROOT_GROUP_ID,
    mode: 'parallel',
    // `flatMap`, not a filter over the layers: `sceneEdit.test.ts` greps for
    // that spelling as the one structural removal in the engine, and this is a
    // read.
    children: scene.layers.flatMap((l) => (grouped.has(l.id) ? [] : [{ id: l.id }])),
  };
}

/**
 * Validate a scene's group list against its layers. Called by
 * `canonicalizeScene` after both are canonical, so the refusals here can name
 * things by id.
 *
 * Refused: a duplicate group id (its `group.<id>.*` keys would collide, I-8);
 * a child naming a layer the scene does not have (a file from a build that
 * moved layers somewhere this one does not know); a layer claimed by two
 * groups (its `child.<id>.duration` key would have two owners, and its
 * visibility two rulings).
 */
export function assertGroupsConsistent(
  groups: readonly Group[],
  layerIds: ReadonlySet<string>,
): void {
  const groupIds = new Set<string>();
  const owner = new Map<string, string>();
  for (const g of groups) {
    if (groupIds.has(g.id)) throw new GroupFormatError(`duplicate group id: ${g.id}`);
    groupIds.add(g.id);
    if (g.id === ROOT_GROUP_ID) {
      throw new GroupFormatError(
        `group id "${ROOT_GROUP_ID}" is reserved for the implicit root and cannot be stored`,
      );
    }
    for (const c of g.children) {
      if (!layerIds.has(c.id)) {
        throw new GroupFormatError(`group "${g.id}" names layer "${c.id}", which is not in the scene`);
      }
      const other = owner.get(c.id);
      if (other !== undefined) {
        throw new GroupFormatError(
          `layer "${c.id}" is in two groups ("${other}" and "${g.id}") — a layer has one place`,
        );
      }
      owner.set(c.id, g.id);
    }
  }
}
