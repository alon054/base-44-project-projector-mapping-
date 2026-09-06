/**
 * The `Layer` model (I-1, I-6). Serializable, normalized, no pixels.
 *
 * Every spatial field here is in [0, 1]. That is not a style choice: it is what
 * makes I-1 mechanically checkable rather than a thing to be careful about.
 * `assertNormalized` below is used by the unit suite to assert that a stored
 * transform contains no pixel value, and it can only do that because there is
 * no field in the transform whose legal range extends past 1.
 */
import { hashString } from './rng';
// TYPE-ONLY, and it has to be. `motion.ts` imports `clamp01`/`wrapTurn` from
// this file, so a value import back would be a runtime cycle; a type import is
// erased. The consequence is that `createLayer` cannot canonicalize a motion
// record — the scene boundary does that (`canonicalizeScene`), which is where
// every other untrusted field is judged anyway.
import type { RouteMotion } from './motion';

/** I-6. The four modes the engine is designed around. Light is additive. */
export const BLEND_MODES = ['normal', 'add', 'multiply', 'screen'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export function isBlendMode(v: unknown): v is BlendMode {
  return typeof v === 'string' && (BLEND_MODES as readonly string[]).includes(v);
}

/**
 * I-1. Position is the layer's **centre**, not its top-left, so rotation has an
 * unambiguous pivot and a layer stays put when it is resized.
 *
 * `rotation` is in **turns**, not radians or degrees. One turn = 2π rad. This
 * keeps every field of a stored transform inside [0, 1], which is what lets
 * `assertNormalized` be a total check instead of a per-field special case.
 * Radians would put a legal 3.14 in stored state and there would be no way to
 * tell it from a pixel value by inspection.
 */
export interface NormalizedTransform {
  /** Centre X in [0, 1] of the output width. */
  x: number;
  /** Centre Y in [0, 1] of the output height. */
  y: number;
  /** Width as a fraction of the output width, in [0, 1]. */
  width: number;
  /** Height as a fraction of the output height, in [0, 1]. */
  height: number;
  /** Clockwise rotation about the centre, in turns, in [0, 1). */
  rotation: number;
}

/** Provider-specific configuration. JSON only — it crosses IPC (I-7). */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

export interface Layer {
  /** Stable within a scene. Used for parameter keys (`entity.<id>.*`, I-8). */
  id: string;
  /** Operator-facing. Never an identifier. */
  name: string;
  /** Which `ContentProvider` fills this layer (I-3). */
  providerId: string;
  /** What that provider should draw. Opaque to the compositor. */
  content: JsonObject;
  transform: NormalizedTransform;
  /** Draw order, ascending. Ties break by position in `scene.layers`. */
  zOrder: number;
  /** [0, 1]. */
  opacity: number;
  /** I-6. */
  blendMode: BlendMode;
  /**
   * [0, 1]. 0 is the far plane, 1 is nearest the viewer. Drives parallax in
   * Phase 4 (D3); stored from Phase 1 so scenes authored now do not need
   * migrating then.
   */
  depth: number;
  visible: boolean;
  /**
   * I-12. The layer's own RNG seed, in scene state so the look is reproducible
   * from the JSON alone. Combined with the scene seed by `layerRng`.
   */
  seed: number;
  /**
   * I-4. Per-force susceptibility, sparse — see `Susceptibility`. Phase 4.
   *
   * This is the entity half of "forces are broadcast; entities subscribe with a
   * per-force susceptibility". It is scene state and nothing else: the force
   * bus reads it, never writes it.
   */
  susceptibility: Susceptibility;
  /**
   * I-18. How this entity travels a route, when it travels one. Phase 5.
   *
   * **Optional, and absent is a stated meaning rather than a gap**: no record
   * means "no motion declared", which `canonicalizeRouteMotion` already reads
   * as `DEFAULT_ROUTE_MOTION`. Storing the defaults on every layer instead
   * would put four fields into every scene ever authored to say what the build
   * would have done anyway, and would make P5-C's "a layer with no motion" case
   * unrepresentable.
   *
   * On the ENTITY, never on the path (I-18, D21) — the route is a shape and
   * knows nothing about who walks it, which is why two entities can share one
   * path and differ only by `phaseOffset`.
   */
  motion?: RouteMotion;
  /**
   * I-15. Which **role** this entity fills. Sprint block B1.
   *
   * A role, never an id: the entity says what kind of place it belongs on, and
   * the room says which places are of that kind. One layer with a role matching
   * four marked shapes draws four times, once into each. A shape marked later
   * and given the same role is filled on the next frame with no edit here.
   *
   * **Optional, and absent is a stated meaning rather than a gap**: no field
   * means "fills nothing" — the layer draws as it always has. Defaulting it to
   * `'panel'` would silently re-target every scene ever authored the moment a
   * room is described.
   *
   * A free string on purpose (SPRINT.md §3 R2), and a value matching nothing is
   * flagged and logged, never substituted — see `core/roles.ts`.
   */
  fillRole?: string;
}

export const DEFAULT_TRANSFORM: NormalizedTransform = {
  x: 0.5,
  y: 0.5,
  width: 1,
  height: 1,
  rotation: 0,
};

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Wraps into [0, 1) rather than clamping — a turn past 1 is a turn, not an error. */
export function wrapTurn(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const t = v % 1;
  return t < 0 ? t + 1 : t;
}

/**
 * A key segment: what may appear between the dots of a hierarchical parameter
 * key (I-8). Lives here because it constrains *stored state* — a force id in a
 * layer's susceptibility map becomes `entity.<id>.susceptibility.<forceId>`, so
 * a scene carrying a force id with a dot in it would produce a key that cannot
 * be addressed. Rejected where it is stored rather than where it is registered.
 */
const KEY_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function isKeySegment(v: unknown): v is string {
  return typeof v === 'string' && KEY_SEGMENT.test(v);
}

/**
 * I-4. How strongly this layer responds to each force, by force id, in [0, 1].
 *
 * A **sparse** map on purpose: an absent force id means "whatever this force's
 * definition says entities do by default", not zero. That is what lets
 * `timeOfDay` reach every layer in a scene authored before it existed — the
 * alternative, filling every layer with every force id at creation, would make
 * adding a fifth force a migration of every stored scene, which is precisely
 * the rewrite I-14 exists to avoid.
 */
export type Susceptibility = Record<string, number>;

export function canonicalizeSusceptibility(raw: unknown): Susceptibility {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Susceptibility = {};
  for (const [forceId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKeySegment(forceId)) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[forceId] = clamp01(v);
  }
  return out;
}

/**
 * A pixel rect, derived at draw time and never stored (I-1). This is the only
 * place in the engine where a normalized value becomes a pixel value.
 */
export interface PixelRect {
  /** Centre, device pixels. */
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Radians, for the renderer. */
  rotation: number;
}

/**
 * I-1's central function: the same stored transform must land in the same
 * relative place at any output resolution. Unit-tested at several resolutions
 * (§8.1).
 */
export function toPixelRect(
  t: NormalizedTransform,
  outputWidth: number,
  outputHeight: number,
): PixelRect {
  return {
    cx: t.x * outputWidth,
    cy: t.y * outputHeight,
    width: t.width * outputWidth,
    height: t.height * outputHeight,
    rotation: t.rotation * Math.PI * 2,
  };
}

/**
 * True when every field of a transform is in its normalized range. The unit
 * suite uses this to assert I-1 over a whole scene: if a pixel value ever
 * reaches stored state, some field lands outside [0, 1] and this returns false.
 */
export function isNormalizedTransform(t: NormalizedTransform): boolean {
  const inUnit = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1;
  return (
    inUnit(t.x) && inUnit(t.y) && inUnit(t.width) && inUnit(t.height) && inUnit(t.rotation)
  );
}

export function normalizeTransform(t: Partial<NormalizedTransform> | undefined): NormalizedTransform {
  return {
    x: clamp01(t?.x ?? DEFAULT_TRANSFORM.x),
    y: clamp01(t?.y ?? DEFAULT_TRANSFORM.y),
    width: clamp01(t?.width ?? DEFAULT_TRANSFORM.width),
    height: clamp01(t?.height ?? DEFAULT_TRANSFORM.height),
    rotation: wrapTurn(t?.rotation ?? DEFAULT_TRANSFORM.rotation),
  };
}

export interface LayerInit {
  id: string;
  name?: string;
  providerId: string;
  content?: JsonObject;
  transform?: Partial<NormalizedTransform>;
  zOrder?: number;
  opacity?: number;
  blendMode?: BlendMode;
  depth?: number;
  visible?: boolean;
  seed?: number;
  susceptibility?: Susceptibility;
  motion?: RouteMotion;
  fillRole?: string;
}

export function createLayer(init: LayerInit): Layer {
  return {
    id: init.id,
    name: init.name ?? init.id,
    providerId: init.providerId,
    content: init.content ?? {},
    transform: normalizeTransform(init.transform),
    zOrder: Number.isFinite(init.zOrder) ? (init.zOrder as number) : 0,
    opacity: clamp01(init.opacity ?? 1),
    blendMode: init.blendMode ?? 'normal',
    depth: clamp01(init.depth ?? 0.5),
    visible: init.visible ?? true,
    // Deterministic from the id, so a layer created without an explicit seed is
    // still reproducible across sessions (I-12). A caller may override it.
    seed: Number.isFinite(init.seed) ? (init.seed as number) >>> 0 : hashString(init.id),
    susceptibility: canonicalizeSusceptibility(init.susceptibility),
    // Spread rather than assigned, so a layer with no motion has no `motion`
    // KEY — `{ motion: undefined }` and `{}` serialize the same but are not
    // deep-equal, and the round-trip check is on deep equality.
    ...(init.motion === undefined ? {} : { motion: init.motion }),
    // Spread for the same reason `motion` is: absent must stay absent, or the
    // deep-equal round-trip fails on a key that serializes to nothing.
    ...(init.fillRole === undefined ? {} : { fillRole: init.fillRole }),
  };
}
