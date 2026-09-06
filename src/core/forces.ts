/**
 * I-4 and I-14 — the force bus.
 *
 * I-4: "*Entities* are things you see. *Forces* are global modifiers that
 * affect many entities at once. They are modeled separately. Forces are
 * broadcast; entities subscribe with a per-force susceptibility."
 *
 * I-14: "A force is a **definition** (`id`, parameter list with ranges and
 * defaults, susceptibility axes) registered into the registry, not a branch
 * inside `forces.ts`. The four v1 forces are the first four instances of the
 * mechanism, not the mechanism itself."
 *
 * **Nothing in this file knows what wind is.** That is the test. `forceDefs.ts`
 * holds the four v1 forces as data, and Gate 4 asks for a fifth added in under
 * 30 minutes touching no code here.
 *
 * Three design decisions carry the invariant:
 *
 * **The axis vocabulary is fixed; the forces are data.** A force does not
 * invent a way to affect a layer — it maps its parameters onto axes that
 * already exist (`offsetX`, `rotate`, `tintR`, …). An axis is a *rendering
 * capability*, and adding one is renderer work; a force is *data*, and adding
 * one is not. I-14's "fog, current, or crowd is data plus a susceptibility
 * mapping" is exactly a mapping onto this vocabulary. If a future force
 * genuinely needs a capability the renderer does not have, that is an honest
 * renderer change and should be logged as one rather than smuggled in as a
 * force.
 *
 * **Susceptibility is a lerp toward the axis identity, not a multiply.** For a
 * summed axis identity is 0 and the lerp degenerates to `value * s`; for a
 * multiplied axis identity is 1 and it becomes `1 + (value - 1) * s`. One rule
 * covers both, so scaling a force per entity needs no knowledge of which kind
 * of axis it is driving — which is what keeps the per-entity step free of
 * per-force branching.
 *
 * **Evaluation is pure and derived from clock time, never accumulated (I-2).**
 * A force samples `timeSeconds`; it does not integrate. Gate 3 established that
 * an accumulated phase cannot survive a scrub, and a gust that had integrated
 * its own history would put the whole scene somewhere different after one.
 * Every random quantity comes from `scene.seed` through `valueNoise` (I-12), so
 * the same state implies the same intended look. There is no `Math.random()`
 * here and none in `forceDefs.ts`.
 */
import { mixSeed, hashString } from './rng';

/* -------------------------------------------------------------------------- */
/* The axis vocabulary                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Every way a force is allowed to affect an entity. Ordered, so enumeration is
 * stable for the UI and for tests.
 */
export const FORCE_AXES = [
  'offsetX',
  'offsetY',
  'rotate',
  'scale',
  'opacity',
  'tintR',
  'tintG',
  'tintB',
] as const;

export type ForceAxis = (typeof FORCE_AXES)[number];

export function isForceAxis(v: unknown): v is ForceAxis {
  return typeof v === 'string' && (FORCE_AXES as readonly string[]).includes(v);
}

/**
 * How one axis behaves. `identity` is the value that means "this force did
 * nothing", which is both the starting accumulator and the target a
 * susceptibility of 0 lerps back to.
 *
 * The clamp lives here rather than at the point of use so that a badly-written
 * force definition — including the fifth one added at the gate — cannot push a
 * nonsense value into the renderer. Data cannot corrupt the pipeline.
 */
export interface ForceAxisSpec {
  id: ForceAxis;
  label: string;
  identity: number;
  combine: 'sum' | 'product';
  min: number;
  max: number;
}

/**
 * **Why the tint axes are capped at 1.** `Container.tint` in PixiJS v8 is a
 * multiply against the drawn colour: `tint = 0xffffff` is a no-op and there is
 * no value that brightens. A force can therefore darken and colour-shift, and
 * cannot raise light past the authored look. That is not a workaround, it is
 * the correct model for a projector — less light at night is less light — and
 * *brightening* is a grade operation (`grade.*`, Phase 9) or an `add` layer,
 * not a tint. `timeOfDay` is authored around it: noon is `(1, 1, 1)` and every
 * other hour is a reduction, so the sweep runs downward from full output.
 */
export const FORCE_AXIS_SPECS: Readonly<Record<ForceAxis, ForceAxisSpec>> = {
  // Normalized [0,1] screen space (I-1) — a delta, so it is signed and its
  // range is [-1, 1]. Becomes pixels only at the final draw.
  offsetX: { id: 'offsetX', label: 'Offset X', identity: 0, combine: 'sum', min: -1, max: 1 },
  offsetY: { id: 'offsetY', label: 'Offset Y', identity: 0, combine: 'sum', min: -1, max: 1 },
  // Turns, matching `NormalizedTransform.rotation`. Signed, so half a turn
  // either way is the limit.
  rotate: { id: 'rotate', label: 'Rotate', identity: 0, combine: 'sum', min: -0.5, max: 0.5 },
  scale: { id: 'scale', label: 'Scale', identity: 1, combine: 'product', min: 0.1, max: 4 },
  opacity: { id: 'opacity', label: 'Opacity', identity: 1, combine: 'product', min: 0, max: 1 },
  tintR: { id: 'tintR', label: 'Tint R', identity: 1, combine: 'product', min: 0, max: 1 },
  tintG: { id: 'tintG', label: 'Tint G', identity: 1, combine: 'product', min: 0, max: 1 },
  tintB: { id: 'tintB', label: 'Tint B', identity: 1, combine: 'product', min: 0, max: 1 },
};

/** One entity's combined response to every force. Derived per frame, never stored. */
export type Modulation = Record<ForceAxis, number>;

export function identityModulation(): Modulation {
  const m = {} as Modulation;
  for (const axis of FORCE_AXES) m[axis] = FORCE_AXIS_SPECS[axis].identity;
  return m;
}

/** True when a modulation would change nothing — used to skip work and to test. */
export function isIdentityModulation(m: Modulation): boolean {
  return FORCE_AXES.every((axis) => m[axis] === FORCE_AXIS_SPECS[axis].identity);
}

/* -------------------------------------------------------------------------- */
/* Writing into the axis vocabulary from outside the bus (B5, D21)            */
/* -------------------------------------------------------------------------- */

/**
 * The axes that accept an OVERRIDE — a value that replaces the entity's base
 * rather than combining with it.
 *
 * Only `rotate`, and the reason is arithmetic rather than taste: an axis that
 * SUMS cannot overwrite. Route motion with `orient` on wants the content to
 * face its heading — not its authored rotation plus its heading — and the only
 * way to say that through an axis that adds is to give the axis a second
 * input. Position needs no override: motion's offset is `route point − base`,
 * a genuine contribution that lands on the route by construction.
 */
export const OVERRIDABLE_AXES = ['rotate'] as const satisfies readonly ForceAxis[];
export type OverridableAxis = (typeof OVERRIDABLE_AXES)[number];

/** One stage's write into one axis. */
export interface AxisWrite {
  axis: ForceAxis;
  /** In the axis's units — normalized offset, turns, a factor. */
  value: number;
  /** `contribute` combines by the axis rule; `override` replaces the base (rotate only). */
  mode: 'contribute' | 'override';
}

/** What the renderer applies: the combined axes, plus the one base replacement. */
export interface ComposedAxes {
  modulation: Modulation;
  /** Turns. `null` when nothing overrode the base rotation. */
  rotateOverride: number | null;
}

/**
 * Composition order `base → motion → forces`, as one function.
 *
 * `motion` writes go in first and `forces` — already evaluated by the bus,
 * susceptibility and depth applied — combine on top, each axis by its own
 * rule. For the summed axes the order is arithmetically moot; it is stated
 * anyway because the OVERRIDE is not: an override replaces the BASE and the
 * forces still sum on top of it, so with `orient` on and a wind blowing the
 * drawn rotation is `heading + wind`, never `base + heading + wind`. That is
 * the case that passes a naive test and fails the first time an entity has a
 * non-zero authored rotation.
 *
 * Every axis is clamped to its spec on the way out, exactly as the bus clamps
 * its own result — data written from outside the bus cannot push a nonsense
 * value into the renderer either.
 *
 * An override on an axis that does not accept one is a programming error, not
 * data, and throws.
 */
export function composeAxes(forces: Modulation, motion: readonly AxisWrite[]): ComposedAxes {
  const acc = identityModulation();
  let rotateOverride: number | null = null;
  for (const w of motion) {
    if (!Number.isFinite(w.value)) continue;
    if (w.mode === 'override') {
      if (!(OVERRIDABLE_AXES as readonly string[]).includes(w.axis)) {
        throw new Error(`axis "${w.axis}" does not accept an override (only ${OVERRIDABLE_AXES.join(', ')})`);
      }
      rotateOverride = w.value;
      continue;
    }
    acc[w.axis] = combine(w.axis, acc[w.axis], w.value);
  }
  for (const axis of FORCE_AXES) acc[axis] = clampAxis(axis, combine(axis, acc[axis], forces[axis]));
  return { modulation: acc, rotateOverride };
}

/* -------------------------------------------------------------------------- */
/* The force definition                                                       */
/* -------------------------------------------------------------------------- */

/** One knob on a force. Ranges and defaults are part of the definition (I-14). */
export interface ForceParamSpec {
  /** Suffix under `force.<id>.`, e.g. `strength`. */
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  /** UI step hint only. Values are not quantized to it. */
  step: number;
  /**
   * Human-readable unit, for the operator-facing label. Purely cosmetic — the
   * value is always a plain number, because a MIDI knob maps to a number.
   */
  unit?: string;
}

/**
 * What `evaluate` is given. Everything here is derived: the clock's time (I-2),
 * the scene's seed (I-12), and the entity being asked about.
 */
export interface ForceEvalContext {
  /** Authoritative scene time. The force samples it; it does not count its own. */
  readonly timeSeconds: number;
  /** This force's parameter values, defaults already filled in. */
  param(key: string): number;
  /**
   * Deterministic value noise in [-1, 1], seeded from the scene and this
   * force's id. `label` keeps independent streams from consuming each other.
   */
  noise(label: string, t: number): number;
  /**
   * A stable [0, 1) offset unique to the entity being evaluated, derived from
   * its seed. A force uses it to keep entities from moving in lockstep, which
   * is the difference between wind and a conveyor belt.
   */
  readonly entityPhase: number;
  /** The entity's `depth` (D3). 0 is the far plane, 1 nearest the viewer. */
  readonly depth: number;
}

/**
 * A force. **Data.** Adding one is writing one of these and putting it in the
 * list in `forceDefs.ts`; nothing in this file changes.
 */
export interface ForceDefinition {
  /** One key segment — it becomes `force.<id>.*` (I-8). */
  readonly id: string;
  readonly label: string;
  readonly params: readonly ForceParamSpec[];
  /**
   * The axes this force is declared to drive. I-14 names this the
   * "susceptibility axes" of the definition. It is enforced: an axis returned
   * by `evaluate` that is not declared here is dropped, so the declaration is a
   * contract and not a comment.
   */
  readonly axes: readonly ForceAxis[];
  /**
   * What an entity that has not stated a susceptibility responds with.
   *
   * Not always 0. A force that describes the *light in the room* — `timeOfDay`,
   * `temperature` — applies to everything by default, because a layer that
   * ignored the time of day would be the visible seam Gate 4 asks about. A
   * force that describes *motion* defaults lower, so that adding a layer to a
   * windy scene does not make it thrash.
   */
  readonly defaultSusceptibility: number;
  /** Pure. Unstated axes are left at identity. Must not read a wall clock. */
  evaluate(ctx: ForceEvalContext): Partial<Modulation>;
}

/* -------------------------------------------------------------------------- */
/* Deterministic noise (I-12)                                                 */
/* -------------------------------------------------------------------------- */

/** A hash to [0, 1). Deterministic across platforms — integer ops only. */
function hashUnit(seed: number, n: number): number {
  return mixSeed(seed, n >>> 0) / 4294967296;
}

/** Hermite smoothstep. Continuous first derivative, so a gust has no corner. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 1-D value noise in [-1, 1], continuous in `t`.
 *
 * A gust must be smooth (a corner reads as a glitch on a wall), reproducible
 * from scene state (I-12), and a pure function of clock time so that a scrub
 * lands exactly where the same time landed before (I-2). Value noise over an
 * integer lattice is all three, and is short enough to be obviously correct.
 */
export function valueNoise(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hashUnit(seed, i);
  const b = hashUnit(seed, i + 1);
  return (a + (b - a) * smoothstep(f)) * 2 - 1;
}

/* -------------------------------------------------------------------------- */
/* Parallax (D3)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The scene's viewpoint. `0.5, 0.5` is centred; the operator sweeps it and near
 * layers slide across far ones (D3 — "depth is what converts decoration into
 * space"). Stored in [0, 1] like every other spatial value (I-1).
 */
export interface ParallaxState {
  x: number;
  y: number;
}

export const DEFAULT_PARALLAX: ParallaxState = { x: 0.5, y: 0.5 };

/**
 * How far a full sweep of the parallax control moves a layer at gain 1, as a
 * fraction of the output. 0.12 is ±154 px at DEV_RESOLUTION — large enough to
 * read across a room, small enough that a near layer does not leave the frame.
 */
export const PARALLAX_RANGE = 0.12;

/**
 * Depth response at the far plane: **zero**. A layer at `depth 0` does not
 * parallax and does not drift in the wind, at all.
 *
 * This started at 0.15 and was changed on the evidence of a golden preview,
 * which is the fourth time in this project that looking at a picture caught
 * something a passing test could not. At 0.15 the Phase 4 scene's sky (authored
 * at `depth 0.02`) slid 23 px under a full parallax sweep and exposed a black
 * band down one edge of the frame — on a wall, a black stripe beside the image.
 *
 * There is no way to author around it. **I-1 caps a layer's `width` at 1**, so
 * a full-frame layer cannot be over-sized to give itself bleed the way a
 * conventional parallax backdrop would be. The invariant is not negotiable and
 * is not the thing to change here; the far plane simply does not move, which is
 * also what "far plane" means.
 *
 * The authoring rule that follows is worth stating plainly, because it will
 * catch the next person: **a layer that spans the frame is authored at
 * `depth 0`.** Anything with a visible edge inside the frame may sit anywhere.
 */
export const DEPTH_GAIN_FAR = 0;
/** Depth response at the near plane. */
export const DEPTH_GAIN_NEAR = 1;

/**
 * D3, in one place. Every screen-space offset — parallax AND every force's
 * `offsetX`/`offsetY` — is scaled by this before it is applied.
 *
 * That wind is depth-scaled too is deliberate and is not scope creep: a near
 * tree swaying further than a far one is the same phenomenon as parallax, and
 * putting the two through one function is what makes Gate 4's "near layers
 * shift more than far layers" true of the whole instrument rather than of one
 * control. It also means the wind slider alone demonstrates D3, which matters
 * because Phase 1's lesson was a scene that could not demonstrate its invariant.
 */
export function depthGain(depth: number): number {
  const d = depth < 0 ? 0 : depth > 1 ? 1 : depth;
  return DEPTH_GAIN_FAR + (DEPTH_GAIN_NEAR - DEPTH_GAIN_FAR) * d;
}

/* -------------------------------------------------------------------------- */
/* The bus                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the bus needs to know about an entity. `Layer` satisfies this
 * structurally; the bus does not import it, so the whole force system is
 * testable with plain objects and no scene, no compositor and no GPU (§8.1).
 */
export interface ForceSubject {
  readonly id: string;
  readonly depth: number;
  readonly seed: number;
  readonly susceptibility: Readonly<Record<string, number>>;
}

/** Force parameter values as they live in scene state: `{ wind: { strength: 0.4 } }`. */
export type ForceValues = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * One frame's evaluation of every force. Frozen for the frame: the compositor
 * applies the axes, a provider that needs a raw parameter (rain's drop count
 * responds to `rain.intensity`) reads it, and the `[force]` log line describes
 * it. All three see the same numbers.
 */
export interface ForceField {
  /** Definition ids, in definition order. */
  ids(): readonly string[];
  definition(forceId: string): ForceDefinition | undefined;
  /** A parameter's current value, with the definition's default filled in. */
  param(forceId: string, key: string): number;
  /** Every parameter of one force. For the log line and the UI. */
  params(forceId: string): Readonly<Record<string, number>>;
  /** What susceptibility this subject has to this force, default filled in. */
  susceptibility(subject: ForceSubject, forceId: string): number;
  /** The combined, susceptibility-scaled, depth-scaled response of one entity. */
  modulationFor(subject: ForceSubject): Modulation;
  /** The scene's viewpoint, for anything that wants it directly. */
  readonly parallax: ParallaxState;
  readonly timeSeconds: number;
}

export interface EvaluateForcesOptions {
  definitions: readonly ForceDefinition[];
  /** From scene state. Missing forces and missing keys fall back to defaults. */
  values?: ForceValues;
  /** I-2. The one clock's time. */
  timeSeconds: number;
  /** I-12. The scene's seed, so noise is reproducible from the JSON alone. */
  seed: number;
  parallax?: ParallaxState;
}

function clampAxis(axis: ForceAxis, v: number): number {
  const spec = FORCE_AXIS_SPECS[axis];
  if (!Number.isFinite(v)) return spec.identity;
  return v < spec.min ? spec.min : v > spec.max ? spec.max : v;
}

/** Susceptibility as a lerp toward identity — see this file's header. */
function applySusceptibility(axis: ForceAxis, value: number, s: number): number {
  const identity = FORCE_AXIS_SPECS[axis].identity;
  return identity + (value - identity) * s;
}

function combine(axis: ForceAxis, acc: number, next: number): number {
  return FORCE_AXIS_SPECS[axis].combine === 'sum' ? acc + next : acc * next;
}

/**
 * Susceptibility is clamped to [0, 1]. An entity may ignore a force entirely
 * and may respond fully; it may not respond *more* than the force is doing,
 * because a per-entity gain above 1 would make the force's own range a lie and
 * Phase 11 would be mapping a knob whose top is not its top.
 */
export function clampSusceptibility(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Build one frame's force field. Pure: same arguments, same field.
 *
 * Cost is `forces × entities` cheap pure calls per frame — 4 × 8 at the Phase 4
 * load. Deliberately not memoized per force: several of the v1 forces vary per
 * entity (a gust reaches one tree before the next, which is the whole reason
 * `entityPhase` exists), and a cache keyed on "does this force vary per entity"
 * would be a branch on force identity in bus code, which is what I-14 forbids.
 * The per-frame cost is reported by A14's instrument like everything else
 * rather than assumed to be free.
 */
export function evaluateForces(opts: EvaluateForcesOptions): ForceField {
  const { definitions, timeSeconds, seed } = opts;
  const values = opts.values ?? {};
  const parallax = opts.parallax ?? DEFAULT_PARALLAX;
  const byId = new Map(definitions.map((d) => [d.id, d]));

  const paramOf = (forceId: string, key: string): number => {
    const def = byId.get(forceId);
    const spec = def?.params.find((p) => p.key === key);
    const raw = values[forceId]?.[key];
    if (typeof raw === 'number' && Number.isFinite(raw) && spec) {
      return raw < spec.min ? spec.min : raw > spec.max ? spec.max : raw;
    }
    return spec?.default ?? 0;
  };

  const susceptibilityOf = (subject: ForceSubject, forceId: string): number => {
    const stated = subject.susceptibility[forceId];
    if (typeof stated === 'number' && Number.isFinite(stated)) return clampSusceptibility(stated);
    return clampSusceptibility(byId.get(forceId)?.defaultSusceptibility ?? 0);
  };

  const field: ForceField = {
    ids: () => definitions.map((d) => d.id),
    definition: (forceId) => byId.get(forceId),
    param: paramOf,
    params(forceId) {
      const def = byId.get(forceId);
      const out: Record<string, number> = {};
      for (const p of def?.params ?? []) out[p.key] = paramOf(forceId, p.key);
      return out;
    },
    susceptibility: susceptibilityOf,
    parallax,
    timeSeconds,

    modulationFor(subject) {
      const acc = identityModulation();

      for (const def of definitions) {
        const s = susceptibilityOf(subject, def.id);
        // A force nothing subscribes to costs nothing. This is also what the
        // `[force]` line's "reached N entities" counts, so the log describes
        // work that actually happened rather than forces that merely exist.
        if (s === 0) continue;

        const ctx: ForceEvalContext = {
          timeSeconds,
          param: (key) => paramOf(def.id, key),
          noise: (label, t) => valueNoise(mixSeed(mixSeed(seed, hashString(def.id)), hashString(label)), t),
          entityPhase: mixSeed(seed, subject.seed >>> 0) / 4294967296,
          depth: subject.depth,
        };

        let out: Partial<Modulation>;
        try {
          out = def.evaluate(ctx);
        } catch {
          // I-13's principle at the force level: a force definition that throws
          // costs its own contribution, not the frame. Data added at a gate in
          // under 30 minutes is exactly the code most likely to have a bug in
          // it, and the instrument must not go dark for one.
          continue;
        }

        for (const axis of def.axes) {
          const raw = out[axis];
          if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
          acc[axis] = combine(axis, acc[axis], applySusceptibility(axis, raw, s));
        }
      }

      // D3. One gain for every screen-space offset — the forces' and the
      // parallax control's alike. See `depthGain`.
      const gain = depthGain(subject.depth);
      acc.offsetX = (acc.offsetX + (parallax.x - 0.5) * 2 * PARALLAX_RANGE) * gain;
      acc.offsetY = (acc.offsetY + (parallax.y - 0.5) * 2 * PARALLAX_RANGE) * gain;

      for (const axis of FORCE_AXES) acc[axis] = clampAxis(axis, acc[axis]);
      return acc;
    },
  };

  return field;
}

/**
 * A field with no forces in it. The identity of the whole system: every
 * modulation is identity, every parameter read is 0.
 *
 * The golden harness draws through this, so the 28 blessed frames are unchanged
 * by the existence of the force bus and stay byte-identical. A `LayerFrame` is
 * a frozen contract there (§8.1) and this is what keeps it one.
 */
export const EMPTY_FORCE_FIELD: ForceField = evaluateForces({
  definitions: [],
  timeSeconds: 0,
  seed: 0,
});

/**
 * Force values as they are stored in a scene, with every definition's defaults
 * filled in. Used to seed a new scene so that the stored JSON states its forces
 * explicitly rather than relying on code defaults — which is what makes an
 * archived scene reproduce years later (I-12).
 */
export function defaultForceValues(
  definitions: readonly ForceDefinition[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const def of definitions) {
    const params: Record<string, number> = {};
    for (const p of def.params) params[p.key] = p.default;
    out[def.id] = params;
  }
  return out;
}
