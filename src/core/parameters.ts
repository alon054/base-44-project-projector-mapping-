/**
 * I-8 — the hierarchical parameter registry.
 *
 * Every addressable value in the engine — force parameters, per-entity
 * parameters, grade settings, debug knobs — is registered here under a
 * hierarchical string key (`force.wind.strength`, `entity.<id>.opacity`,
 * `grade.tint`). Phase 11's MIDI and audio mapping is then a lookup rather than
 * a rewrite, which is the entire reason this exists in Phase 1 (SPEC.md I-8).
 *
 * **The registry does not own values.** A definition carries `get`/`set`
 * accessors onto wherever the value actually lives — scene state for anything
 * belonging to a layer, a local cell for a debug knob. This is deliberate: if
 * the registry stored a copy of `entity.<id>.opacity`, the scene JSON and the
 * registry would be two sources of truth for one number, and I-12 says there is
 * exactly one. The registry is an *index* onto state, not a second store.
 */
import { PARAM_TEST_PATTERN_SPEED } from '@shared/ipc';
import { BLEND_MODES, isBlendMode, type JsonValue, type Layer, type Susceptibility } from './layer';
import { CLOCK_MAX_MS, CLOCK_RATE_MAX, CLOCK_RATE_MIN } from './clock';
import { clampSusceptibility, type ForceDefinition, type ParallaxState } from './forces';
import type { ContentParamSpec } from '../providers/ContentProvider';

export type ParameterValue = number | boolean | string;

interface ParameterDefBase<T extends ParameterValue> {
  /** Hierarchical, dot-separated, at least two segments. */
  key: string;
  /** Operator-facing. Never an identifier. */
  label: string;
  default: T;
  get(): T;
  set(v: T): void;
}

export interface NumberParameterDef extends ParameterDefBase<number> {
  kind: 'number';
  min: number;
  max: number;
  /** UI step hint only. Values are not quantized to it. */
  step: number;
}

export interface BooleanParameterDef extends ParameterDefBase<boolean> {
  kind: 'boolean';
}

export interface EnumParameterDef extends ParameterDefBase<string> {
  kind: 'enum';
  options: readonly string[];
}

export type ParameterDef = NumberParameterDef | BooleanParameterDef | EnumParameterDef;

export class ParameterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParameterKeyError';
  }
}

export class ParameterCollisionError extends Error {
  constructor(readonly key: string) {
    super(`parameter key already registered: ${key} (I-8: keys are unique)`);
    this.name = 'ParameterCollisionError';
  }
}

const SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * A key must have at least two segments. A bare `speed` is exactly the name
 * collision across entities that I-8 exists to prevent, so it is rejected at
 * registration rather than discovered when a second entity wants the same word.
 */
export function assertValidKey(key: string): void {
  if (typeof key !== 'string' || key === '') {
    throw new ParameterKeyError('parameter key must be a non-empty string');
  }
  const segments = key.split('.');
  if (segments.length < 2) {
    throw new ParameterKeyError(`parameter key must be hierarchical (a.b), got "${key}"`);
  }
  for (const s of segments) {
    if (!SEGMENT.test(s)) {
      throw new ParameterKeyError(`invalid segment "${s}" in parameter key "${key}"`);
    }
  }
}

export class ParameterRegistry {
  private readonly defs = new Map<string, ParameterDef>();

  /** Throws `ParameterCollisionError` if the key is taken (I-8, §8.1). */
  register<D extends ParameterDef>(def: D): D {
    assertValidKey(def.key);
    if (this.defs.has(def.key)) throw new ParameterCollisionError(def.key);
    this.defs.set(def.key, def);
    return def;
  }

  registerAll(defs: readonly ParameterDef[]): void {
    for (const d of defs) this.register(d);
  }

  /**
   * Removes a key. Needed from Phase 1 because deleting a layer must remove its
   * `entity.<id>.*` keys — otherwise re-adding a layer with the same id
   * collides, and the operator sees a crash on an ordinary edit.
   */
  unregister(key: string): boolean {
    return this.defs.delete(key);
  }

  /** Removes every key under a prefix. Returns how many were removed. */
  unregisterPrefix(prefix: string): number {
    let n = 0;
    for (const key of [...this.defs.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}.`)) {
        this.defs.delete(key);
        n++;
      }
    }
    return n;
  }

  has(key: string): boolean {
    return this.defs.has(key);
  }

  definition(key: string): ParameterDef | undefined {
    return this.defs.get(key);
  }

  /** Sorted, so enumeration is stable for the UI and for tests. */
  keys(prefix?: string): string[] {
    const all = [...this.defs.keys()].sort();
    if (prefix === undefined) return all;
    return all.filter((k) => k === prefix || k.startsWith(`${prefix}.`));
  }

  get size(): number {
    return this.defs.size;
  }

  /** §8.1: every key resolves back to its value. */
  read(key: string): ParameterValue {
    const def = this.mustGet(key);
    return def.get();
  }

  /**
   * Validates against the definition before writing. A number outside its range
   * is clamped rather than rejected — a MIDI knob or an audio envelope will
   * routinely overshoot, and refusing the write would leave a mapped control
   * silently dead at the top of its travel.
   */
  write(key: string, value: ParameterValue): ParameterValue {
    const def = this.mustGet(key);
    const coerced = coerce(def, value);
    def.set(coerced as never);
    return coerced;
  }

  /** Every current value, for the UI and for debugging. Not scene state. */
  snapshot(prefix?: string): Record<string, ParameterValue> {
    const out: Record<string, ParameterValue> = {};
    for (const key of this.keys(prefix)) out[key] = this.read(key);
    return out;
  }

  private mustGet(key: string): ParameterDef {
    const def = this.defs.get(key);
    if (!def) throw new ParameterKeyError(`unknown parameter key: ${key}`);
    return def;
  }
}

function coerce(def: ParameterDef, value: ParameterValue): ParameterValue {
  switch (def.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ParameterKeyError(`${def.key} expects a finite number, got ${String(value)}`);
      }
      return Math.min(def.max, Math.max(def.min, value));
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new ParameterKeyError(`${def.key} expects a boolean, got ${String(value)}`);
      }
      return value;
    }
    case 'enum': {
      if (typeof value !== 'string' || !def.options.includes(value)) {
        throw new ParameterKeyError(
          `${def.key} expects one of [${def.options.join(', ')}], got ${String(value)}`,
        );
      }
      return value;
    }
  }
}

/**
 * A definition whose value lives in a cell the registry hands back. For knobs
 * with no home in scene state — debug parameters, mostly. Anything belonging to
 * a layer must instead be bound to the scene with explicit accessors, so that
 * the scene stays the single source of truth (I-12).
 */
export function cellParameter(
  spec: Omit<NumberParameterDef, 'get' | 'set'>,
  onChange?: (v: number) => void,
): NumberParameterDef;
export function cellParameter(
  spec: Omit<BooleanParameterDef, 'get' | 'set'>,
  onChange?: (v: boolean) => void,
): BooleanParameterDef;
export function cellParameter(
  spec: Omit<EnumParameterDef, 'get' | 'set'>,
  onChange?: (v: string) => void,
): EnumParameterDef;
export function cellParameter(
  spec:
    | Omit<NumberParameterDef, 'get' | 'set'>
    | Omit<BooleanParameterDef, 'get' | 'set'>
    | Omit<EnumParameterDef, 'get' | 'set'>,
  onChange?: (v: never) => void,
): ParameterDef {
  let value: ParameterValue = spec.default;
  const notify = onChange as ((v: ParameterValue) => void) | undefined;
  return {
    ...spec,
    get: () => value,
    set: (v: ParameterValue) => {
      value = v;
      notify?.(v);
    },
  } as ParameterDef;
}

/**
 * `debug.testPattern.speed` — I-8's first registered key.
 *
 * Phase 0 introduced it as a bare constant in `electron/ipc.ts` because the
 * registry did not exist yet; SPEC.md §0.2 permits a parameter to carry its
 * eventual hierarchical key before Phase 1, and CLAUDE.md rule 9 requires it to
 * land here in Phase 1's first commit. The range matches the editor's existing
 * slider (0–4, step 0.01, default 1×) rather than inventing a new one, so the
 * registry describes the control that exists.
 */
export function defineTestPatternSpeed(onChange?: (v: number) => void): NumberParameterDef {
  return cellParameter(
    {
      key: PARAM_TEST_PATTERN_SPEED,
      label: 'Test pattern speed',
      kind: 'number',
      default: 1,
      min: 0,
      max: 4,
      step: 0.01,
    },
    onChange,
  );
}

/**
 * The `entity.<id>.*` keys a layer owns. Bound to scene state through
 * accessors, never copied — see this file's header.
 *
 * `read` returns the layer as it currently is; the compositor owns the scene
 * and hands this a live accessor, so the registry can never go stale against an
 * undo or a scene switch.
 */
export function defineLayerParameters(
  layerId: string,
  read: () => Layer,
  write: (patch: Partial<Layer>) => void,
): ParameterDef[] {
  return [
    {
      key: `entity.${layerId}.opacity`,
      label: 'Opacity',
      kind: 'number',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      get: () => read().opacity,
      set: (v: number) => write({ opacity: v }),
    },
    {
      key: `entity.${layerId}.depth`,
      label: 'Depth',
      kind: 'number',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      get: () => read().depth,
      set: (v: number) => write({ depth: v }),
    },
    {
      key: `entity.${layerId}.visible`,
      label: 'Visible',
      kind: 'boolean',
      default: true,
      get: () => read().visible,
      set: (v: boolean) => write({ visible: v }),
    },
    {
      key: `entity.${layerId}.blendMode`,
      label: 'Blend mode',
      kind: 'enum',
      options: BLEND_MODES,
      default: 'normal',
      get: () => read().blendMode,
      set: (v: string) => {
        if (isBlendMode(v)) write({ blendMode: v });
      },
    },
  ];
}

/**
 * I-8 / rule 9: register a provider's content values under `entity.<id>.<key>`.
 *
 * Bound to `layer.content` through accessors, exactly like the layer-level
 * parameters above — the scene stays the one source of truth (I-12) and the
 * registry stays an index onto it. A provider declares WHICH keys it exposes
 * (`ContentProvider.contentParameters`), because content is opaque to the
 * compositor by design (I-3) and only the provider knows what its blob means.
 */
export function defineContentParameters(
  layerId: string,
  specs: readonly ContentParamSpec[],
  read: () => Layer,
  write: (content: Record<string, JsonValue>) => void,
): ParameterDef[] {
  return specs.map((spec) => {
    const get = (): ParameterValue => {
      const v = read().content[spec.key];
      // The stored blob may legitimately omit a key; the spec's default is then
      // what the provider will actually use, so it is what the registry reports.
      return typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string'
        ? v
        : spec.default;
    };
    const set = (v: ParameterValue): void => {
      write({ ...read().content, [spec.key]: v });
    };
    const base = { key: `entity.${layerId}.${spec.key}`, label: spec.label, get, set };
    switch (spec.kind) {
      case 'number':
        return {
          ...base,
          kind: 'number',
          default: typeof spec.default === 'number' ? spec.default : 0,
          min: spec.min ?? 0,
          max: spec.max ?? 1,
          step: spec.step ?? 0.01,
        } as NumberParameterDef;
      case 'boolean':
        return {
          ...base,
          kind: 'boolean',
          default: spec.default === true,
        } as BooleanParameterDef;
      case 'enum':
        return {
          ...base,
          kind: 'enum',
          default: typeof spec.default === 'string' ? spec.default : '',
          options: spec.options ?? [],
        } as EnumParameterDef;
    }
  });
}

/**
 * The `clock.*` keys (I-8, CLAUDE.md rule 9). Registered in the same commit
 * that introduces the clock.
 *
 * These are registered where the warp's corners deliberately were not. The
 * distinction is not "global vs. per-layer": calibration is I-5 state, which
 * describes the room and belongs in `calibration/`, and a MIDI knob mapped to a
 * keystone corner would be a way to bend the projection mid-show by accident.
 * The clock is the opposite case — a play/pause footswitch and a rate knob are
 * among the most obvious things Phase 11 will want to map, and I-2 makes the
 * clock the one place either could be wired to.
 *
 * `clock.time` is a parameter and not merely a control because a scrub is
 * exactly the kind of thing a mapped fader does. Its range is the clock's own
 * ceiling in SECONDS, not milliseconds, because a range of 0-3,600,000 on a
 * fader has no usable resolution anywhere.
 */
export function defineClockParameters(clock: {
  readonly playing: boolean;
  readonly rate: number;
  readonly timeSeconds: number;
  setPlaying(v: boolean): void;
  setRate(v: number): void;
  scrubToSeconds(v: number): void;
}): ParameterDef[] {
  return [
    {
      key: 'clock.playing',
      label: 'Playing',
      kind: 'boolean',
      default: true,
      get: () => clock.playing,
      set: (v: boolean) => clock.setPlaying(v),
    },
    {
      key: 'clock.rate',
      label: 'Rate',
      kind: 'number',
      default: 1,
      min: CLOCK_RATE_MIN,
      max: CLOCK_RATE_MAX,
      step: 0.01,
      get: () => clock.rate,
      set: (v: number) => clock.setRate(v),
    },
    {
      key: 'clock.time',
      label: 'Time (s)',
      kind: 'number',
      default: 0,
      min: 0,
      max: CLOCK_MAX_MS / 1000,
      step: 0.001,
      get: () => clock.timeSeconds,
      set: (v: number) => clock.scrubToSeconds(v),
    },
  ];
}

/**
 * The `force.<id>.<param>` keys (I-8, I-14, CLAUDE.md rule 9).
 *
 * Derived from the force DEFINITIONS, not written out by hand. That is the
 * whole of Gate 4's "every force is enumerable from the parameter registry by
 * hierarchical key", and it is also what makes the fifth force free: a
 * definition added to `FORCE_DEFINITIONS` appears in the registry, in the
 * editor panel and in the `[force]` log without anyone registering anything.
 *
 * Bound to `scene.forces` through accessors, exactly like every other key here
 * — the scene stays the single source of truth (I-12) and the registry stays an
 * index onto it, never a second copy.
 */
export function defineForceParameters(
  definitions: readonly ForceDefinition[],
  read: () => Record<string, Record<string, number>>,
  write: (forceId: string, key: string, value: number) => void,
): ParameterDef[] {
  const defs: ParameterDef[] = [];
  for (const force of definitions) {
    for (const param of force.params) {
      defs.push({
        key: `force.${force.id}.${param.key}`,
        label: `${force.label} — ${param.label}`,
        kind: 'number',
        default: param.default,
        min: param.min,
        max: param.max,
        step: param.step,
        get: () => {
          const v = read()[force.id]?.[param.key];
          return typeof v === 'number' && Number.isFinite(v) ? v : param.default;
        },
        set: (v: number) => write(force.id, param.key, v),
      });
    }
  }
  return defs;
}

/**
 * The `entity.<id>.susceptibility.<forceId>` keys (I-4, I-8).
 *
 * Four segments rather than three, and deliberately so: `entity.tree.wind`
 * would collide with a provider that ever exposed a content key called `wind`,
 * and I-8 exists precisely so that names cannot collide across the instrument.
 *
 * The registry's `default` is the FORCE's `defaultSusceptibility`, so reading a
 * key on a layer that has not stated one reports what the layer will actually
 * do rather than 0. A registry that answered 0 for a layer visibly moving in
 * the wind would be an instrument that lies, which is the Phase 3 lesson.
 */
export function defineSusceptibilityParameters(
  layerId: string,
  definitions: readonly ForceDefinition[],
  read: () => Layer,
  write: (susceptibility: Susceptibility) => void,
): ParameterDef[] {
  return definitions.map((force) => ({
    key: `entity.${layerId}.susceptibility.${force.id}`,
    label: `Susceptibility — ${force.label}`,
    kind: 'number' as const,
    default: force.defaultSusceptibility,
    min: 0,
    max: 1,
    step: 0.01,
    get: () => {
      const v = read().susceptibility[force.id];
      return typeof v === 'number' && Number.isFinite(v) ? v : force.defaultSusceptibility;
    },
    set: (v: number) => {
      write({ ...read().susceptibility, [force.id]: clampSusceptibility(v) });
    },
  }));
}

/**
 * The `parallax.*` keys (D3, I-8).
 *
 * Parallax is NOT a force and is not registered under `force.*`. A force is a
 * global modifier that entities subscribe to with a susceptibility (I-4);
 * parallax is the viewpoint, and what scales it per entity is `depth`, which
 * every layer already has. Filing it under `force.` would make Gate 4's "every
 * force is enumerable from the registry" answer with something that is not one.
 */
export function defineParallaxParameters(
  read: () => ParallaxState,
  write: (parallax: ParallaxState) => void,
): ParameterDef[] {
  const axis = (key: 'x' | 'y', label: string): NumberParameterDef => ({
    key: `parallax.${key}`,
    label,
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.005,
    get: () => read()[key],
    set: (v: number) => write({ ...read(), [key]: v }),
  });
  return [axis('x', 'Parallax X'), axis('y', 'Parallax Y')];
}
