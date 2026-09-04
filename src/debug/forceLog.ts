/**
 * The `[force]` log line.
 *
 * This file exists **before** anything needed debugging, for the reason three
 * consecutive retrospectives give. Phase 1 lost five of seven defects to the
 * operator rather than to a test; Phase 2 four of four; Phase 3 eleven of
 * thirteen. The lines the app already emits — `[scene]`, `[warp]`, `[clock]`,
 * `[video]`, `[caps]` — found most of them.
 *
 * Phase 4's analogous failure is named in advance: **a force bus that is
 * provably correct and whose effect nobody can see.** Wind that moves
 * everything by two pixels; a susceptibility that changes a number no one can
 * perceive; a force whose value the operator is dragging that reaches no
 * entity at all. A unit test cannot tell any of those from working code,
 * because in every one of them the arithmetic is right.
 *
 * So the line reports the three things that distinguish them:
 *
 *   `[force] wind strength=0.42 direction=0.00 gustiness=0.40 -> 5/7 entities`
 *
 * the force's **id**, its **values**, and **how many entities it reached** —
 * and it says so loudly when that count is zero while the force is doing
 * something:
 *
 *   `[force] wind strength=0.42 ... -> 0/7 entities  ** REACHES NOTHING **`
 *
 * Reach is computed through `ForceField.susceptibility`, the same call the
 * compositor makes, rather than by re-deriving it here. An instrument that
 * computes its own answer a second way is an instrument that can disagree with
 * the thing it is measuring, which is exactly what Phase 3 spent a session
 * fixing in six places.
 *
 * COALESCED at 4 Hz with a trailing emit, per force id. A wind slider drag is a
 * pointer drag exactly like a warp corner or a scrub, and would otherwise emit
 * hundreds of lines and bury everything else. See `debug/coalesce.ts`.
 */
import { evaluateForces, type ForceDefinition } from '../core/forces';
import type { Scene } from '../core/scene';
import { LineCoalescer, type CoalescerOptions } from './coalesce';

/** `strength=0.42`. Fixed at three decimals — a force value is a fader, not a clock. */
function formatParams(params: Readonly<Record<string, number>>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${v.toFixed(3)}`)
    .join(' ');
}

export interface ForceLine {
  /** Coalescing key: the force id, or `parallax`. */
  key: string;
  line: string;
  /** True when the operator must see it now — see `LineCoalescer.emit`. */
  immediate: boolean;
}

/**
 * The lines one scene state produces. Pure, so the unit suite reads the exact
 * text the operator will read rather than a paraphrase of it.
 */
export function describeForces(
  scene: Scene,
  definitions: readonly ForceDefinition[],
): ForceLine[] {
  // `timeSeconds` is irrelevant to reach and to the parameter values, and using
  // 0 keeps this off the render path entirely (A14) — nothing here is called
  // per frame.
  const field = evaluateForces({
    definitions,
    values: scene.forces,
    timeSeconds: 0,
    seed: scene.seed,
    parallax: scene.parallax,
  });

  const total = scene.layers.length;
  const out: ForceLine[] = [];

  for (const def of definitions) {
    const params = field.params(def.id);
    const reached = scene.layers.filter((l) => field.susceptibility(l, def.id) > 0).length;

    // "Doing something" means at least one parameter is away from its default.
    // A force sitting at its defaults reaching nothing is not a defect; a force
    // the operator has moved reaching nothing is the Phase 4 failure mode.
    const active = def.params.some((p) => params[p.key] !== p.default);
    const dead = active && reached === 0;

    out.push({
      key: def.id,
      line:
        `[force] ${def.id} ${formatParams(params)} -> ${reached}/${total} entities` +
        (dead ? '  ** REACHES NOTHING **' : ''),
      immediate: dead,
    });
  }

  // Parallax is not a force (see `defineParallaxParameters`) but it is the
  // other thing in Phase 4 that moves entities, and an operator watching a wall
  // needs one place that says why something moved.
  const p = scene.parallax;
  out.push({
    key: 'parallax',
    line: `[force] parallax x=${p.x.toFixed(3)} y=${p.y.toFixed(3)} (${total} entities, by depth)`,
    immediate: false,
  });

  return out;
}

export interface ForceLogger {
  /**
   * Offer the current scene. Called wherever a scene is APPLIED — never per
   * frame. Force values live in scene state, so a slider move arrives here as
   * an ordinary scene update and nothing extra has to be plumbed.
   */
  note(scene: Scene): void;
  flush(): void;
  detach(): void;
}

export function attachForceLog(
  definitions: readonly ForceDefinition[],
  opts: CoalescerOptions = {},
): ForceLogger {
  const coalescer = new LineCoalescer(opts);
  return {
    note(scene) {
      for (const { key, line, immediate } of describeForces(scene, definitions)) {
        coalescer.emit(key, line, immediate);
      }
    },
    flush: () => coalescer.flush(),
    detach: () => coalescer.dispose(),
  };
}
