/**
 * I-15 — content binds to a surface **by role, never by surface id**.
 *
 * One function does the binding: `resolveRole` takes a role and the surface
 * tree and returns every surface carrying that role, in marking order. A role
 * may match many surfaces, one, or none, and all three are ordinary answers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A MISS IS FLAGGED AND NOT REFUSED.
 *
 * CLAUDE.md's rule is "clamp what drifts, refuse what is wrong", and an unknown
 * enum value is refused everywhere else in this project. `role` is the one
 * stated exception (SPRINT.md §3 R2), and the reason is operational rather than
 * architectural: the role is typed by a person standing in a dark room with the
 * projector on. A typo that refuses a scene load ends the session; a typo that
 * lights nothing is visible in one glance and fixed in one keystroke.
 *
 * So a miss returns an **empty list plus a flag** — never a substituted
 * surface, never a throw (I-13). "Nothing lit" is a fact the caller reports; it
 * is not this function's job to guess which face was meant, and a guess here
 * would be A9's plausible wrong answer painted onto a wall.
 *
 * WHY LOGGING IS A SEPARATE, DEDUPING CALL.
 *
 * `resolveRole` is called per fill per frame. A `console.warn` inside it would
 * be sixty log lines a second for one typo, which is its own way of ending a
 * session — the same failure `resilience.ts` avoids by never calling a provider
 * that threw a second time. `logRoleMiss` therefore reports each distinct role
 * once and is a no-op afterwards, and the flag on the result is what the caller
 * reads every frame.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Surface, SurfaceTree } from './surfaces';

/**
 * The roles a surface carries: its `role` string split on whitespace.
 *
 * B4 added this so one face can be in two bindings at once, which the reel's
 * beat 6 needs: every face carries `panel` so the parallel fill lights them all
 * (and a fifth face marked later lights itself — beat 7), AND each carries its
 * own tag (`f1` … `f5`) so a sequence of five layers, one per tag, lights them
 * in turn. `Surface.role` stays a single free string (SPRINT.md §3 R1, R2) —
 * nothing is renamed and the file format is unchanged; a role with a space in
 * it simply matches each of its words. A face with one word behaves exactly as
 * before.
 *
 * A layer's `fillRole` is one token, never split: it names one role, and a
 * layer that wanted two roles would draw twice on a face carrying both.
 */
export function roleTokens(role: string): string[] {
  return role.split(/\s+/).filter((t) => t !== '');
}

export interface RoleResolution {
  /** The role asked for, verbatim — including the typo, so the log can name it. */
  role: string;
  /** Every surface carrying it, in marking order. Empty when nothing matches. */
  surfaces: Surface[];
  /** I-13's flag. `true` exactly when `surfaces` is empty. */
  unmatched: boolean;
  /** What to log when unmatched, with the offending value and the legal set. Empty otherwise. */
  message: string;
}

/**
 * Every surface carrying `role`, in **marking order**.
 *
 * The order is the array's order, preserved by `filter` and asserted in the
 * tests, because it is the order faces light in on camera and a shot that
 * cannot be re-taken identically is not a shot.
 */
export function resolveRole(role: string, tree: SurfaceTree): RoleResolution {
  const surfaces = tree.filter((s) => roleTokens(s.role).includes(role));
  if (surfaces.length > 0) return { role, surfaces, unmatched: false, message: '' };
  return {
    role,
    surfaces: [],
    unmatched: true,
    // A9: state the value AND what exists, so the fix is readable off the line
    // without opening the file in the dark.
    message:
      `[roles] no surface carries role ${JSON.stringify(role)} — nothing lit. ` +
      `Roles in the room: ${describeKnownRoles(tree)}`,
  };
}

/** The distinct role TOKENS present, in first-marked order. For the miss message and the HUD. */
export function knownRoles(tree: SurfaceTree): string[] {
  const out: string[] = [];
  for (const s of tree) for (const t of roleTokens(s.role)) if (!out.includes(t)) out.push(t);
  return out;
}

function describeKnownRoles(tree: SurfaceTree): string {
  const roles = knownRoles(tree);
  return roles.length === 0 ? '(none — no faces marked)' : roles.map((r) => JSON.stringify(r)).join(', ');
}

const reported = new Set<string>();

/**
 * Report a miss **once per role**, then stay quiet. Returns whether it logged,
 * so the deduping is testable rather than merely intended.
 *
 * A matched resolution logs nothing, so a caller may pass every resolution
 * through this without deciding anything itself.
 */
export function logRoleMiss(
  resolution: RoleResolution,
  log: (message: string) => void = console.warn,
): boolean {
  if (!resolution.unmatched || reported.has(resolution.role)) return false;
  reported.add(resolution.role);
  log(resolution.message);
  return true;
}

/**
 * Forget what has been reported. For tests, and for the moment the room is
 * re-marked — a role that was a typo before the tree changed deserves to be
 * reported again against the new room.
 */
export function resetRoleLog(): void {
  reported.clear();
}
