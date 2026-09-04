/**
 * The four v1 forces — `wind`, `rain`, `timeOfDay`, `temperature`.
 *
 * I-14: these are "the first four instances of the mechanism, not the mechanism
 * itself". Everything in this file is **data plus a pure evaluate function**.
 * There is no import from the compositor, the renderer or the clock; there is
 * no branch anywhere in `forces.ts` that names any of them; and a fifth force
 * is another entry in `FORCE_DEFINITIONS` below and nothing else. Gate 4 tests
 * exactly that.
 *
 * **What a force can and cannot do.** A force maps its parameters onto the axis
 * vocabulary in `forces.ts` — it moves, turns, scales, fades and tints. It
 * cannot create geometry. `rain`'s falling drops are therefore *content* (a
 * provider that reads `force.rain.intensity` off the frame's force field), and
 * `rain`'s force definition contributes only the wetness tint. That split is
 * the honest one: a force is a global modifier (I-4), and a thing you see is an
 * entity.
 *
 * No `Math.random()` here or anywhere downstream of it. Every varying quantity
 * comes from `ctx.noise`, which is seeded from `scene.seed` (I-12), or from
 * `ctx.timeSeconds`, which is the one clock (I-2).
 *
 * **Every force's defaults are the identity, and that is a hard rule on any
 * force added later.** `createScene` fills `scene.forces` from these defaults,
 * so a force whose default did something would change the look of every scene
 * in the project the moment it was added — including the passed-gate scenes
 * from Phases 1 to 3. Wind's `strength` therefore defaults to 0 and the Phase 4
 * gate scene states 0.45 explicitly. This was not designed in; a unit test
 * ("every force is inert at its own defaults") caught it, and the failure it
 * would have caused is exactly the "adding a force is free" claim of I-14 being
 * false in the one direction nobody would have looked.
 */
import type { ForceDefinition, Modulation } from './forces';

/* -------------------------------------------------------------------------- */
/* Small shared shapes. Local to the definitions — not bus code.              */
/* -------------------------------------------------------------------------- */

const TAU = Math.PI * 2;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

type Rgb = readonly [number, number, number];

/**
 * A colour ramp over anchor stops, smoothstep-interpolated so the sweep has no
 * corner in it. Gate 4 asks that `timeOfDay` sweeps "smoothly"; a linear ramp
 * between anchors is continuous but its derivative is not, and a kink in the
 * light is visible on a wall as a moment where the change seems to stall.
 */
function ramp(stops: readonly (readonly [number, Rgb])[], t: number): Rgb {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return [1, 1, 1];
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (!a || !b) break;
    if (t >= a[0] && t <= b[0]) {
      const span = b[0] - a[0];
      const k = span === 0 ? 0 : smoothstep((t - a[0]) / span);
      return [
        a[1][0] + (b[1][0] - a[1][0]) * k,
        a[1][1] + (b[1][1] - a[1][1]) * k,
        a[1][2] + (b[1][2] - a[1][2]) * k,
      ];
    }
  }
  return last[1];
}

function tintOf(rgb: Rgb): Partial<Modulation> {
  return { tintR: rgb[0], tintG: rgb[1], tintB: rgb[2] };
}

/* -------------------------------------------------------------------------- */
/* wind                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Steady push, as a fraction of the output, at full strength and no gust.
 * Together with the sway below this is ~0.079 normalized at maximum, which is
 * ~101 px at DEV_RESOLUTION before depth gain — chosen to be unmistakable from
 * across a room rather than technically correct and invisible, which is the
 * Phase 4 failure mode the retrospective names.
 */
const WIND_STEADY_MAX = 0.035;
/** Oscillating component. Wind that only pushed would read as a slow slide. */
const WIND_SWAY_MAX = 0.03;
/** Sway period ≈ 4.8 s. Slow enough to read as air, not as a vibration. */
const WIND_SWAY_HZ = 0.21;
/** How fast gusts arrive. */
const WIND_GUST_HZ = 0.34;
/** Wind lifts less than it pushes. */
const WIND_VERTICAL = 0.35;
/** Turns of lean per unit of displacement. 0.079 × 0.55 ≈ 15.7° at maximum. */
const WIND_TILT_GAIN = 0.55;

export const WIND: ForceDefinition = {
  id: 'wind',
  label: 'Wind',
  axes: ['offsetX', 'offsetY', 'rotate'],
  // Motion, not light: a layer added to a windy scene should not start thrashing
  // before the operator has said it should.
  defaultSusceptibility: 0.5,
  params: [
    { key: 'strength', label: 'Strength', min: 0, max: 1, default: 0, step: 0.01 },
    {
      key: 'direction',
      label: 'Direction',
      min: 0,
      max: 1,
      default: 0,
      step: 0.005,
      unit: 'turns',
    },
    { key: 'gustiness', label: 'Gustiness', min: 0, max: 1, default: 0.4, step: 0.01 },
  ],
  evaluate(ctx) {
    const strength = ctx.param('strength');
    if (strength <= 0) return {};

    const angle = ctx.param('direction') * TAU;
    const gustiness = ctx.param('gustiness');

    // `entityPhase` is what makes this wind and not a conveyor belt: every
    // entity is at a different point in the same gust, so the scene ripples
    // rather than sliding as one rigid object.
    const phase = ctx.entityPhase;
    const sway = Math.sin((ctx.timeSeconds * WIND_SWAY_HZ + phase) * TAU);
    const gust = ctx.noise('gust', ctx.timeSeconds * WIND_GUST_HZ + phase * 7.13);

    const steady = strength * (1 + gustiness * gust) * WIND_STEADY_MAX;
    const displacement = steady + strength * sway * WIND_SWAY_MAX;

    return {
      offsetX: Math.cos(angle) * displacement,
      offsetY: Math.sin(angle) * displacement * WIND_VERTICAL,
      // Leaning downwind. Rotation is clockwise in turns, so a push along +x
      // leans the top of the layer to the right, which is what a tree does.
      rotate: Math.cos(angle) * displacement * WIND_TILT_GAIN,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* rain                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The **wetness tint hook** the Phase 4 deliverable asks for. The drops
 * themselves are a provider — see this file's header for why.
 *
 * Wet surfaces read darker and cooler. All three coefficients are reductions,
 * because the tint axes are multiply-only (`forces.ts` explains why).
 */
export const RAIN: ForceDefinition = {
  id: 'rain',
  label: 'Rain',
  axes: ['tintR', 'tintG', 'tintB'],
  defaultSusceptibility: 0.7,
  params: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 1, default: 0, step: 0.01 },
    { key: 'wetness', label: 'Wetness', min: 0, max: 1, default: 0.6, step: 0.01 },
  ],
  evaluate(ctx) {
    const w = ctx.param('intensity') * ctx.param('wetness');
    if (w <= 0) return {};
    return tintOf([1 - 0.3 * w, 1 - 0.22 * w, 1 - 0.06 * w]);
  },
};

/* -------------------------------------------------------------------------- */
/* timeOfDay                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The day's light, as a colour ramp over the sun's height.
 *
 * Every stop is at or below `(1, 1, 1)` and noon is exactly `(1, 1, 1)`,
 * because the tint axes cannot brighten — the sweep runs *downward* from full
 * output rather than up from a dimmed one. See `forces.ts` on the tint cap.
 *
 * `hour` is 0–24 rather than a normalized 0–1 because this is the one force
 * whose parameter an operator will want to read as a real quantity while
 * standing in front of a wall, and "17.4" is a thing you can say out loud.
 */
const DAY_RAMP: readonly (readonly [number, Rgb])[] = [
  // Midnight: dim and blue. Not black — a projector showing nothing is
  // indistinguishable from a projector that has failed (I-13's premise).
  [0, [0.26, 0.34, 0.6]],
  [0.18, [0.55, 0.47, 0.62]],
  // Low sun: warm, with red held at full and the cool end pulled down.
  [0.35, [1, 0.74, 0.46]],
  [0.62, [1, 0.9, 0.76]],
  [1, [1, 1, 1]],
];

export const TIME_OF_DAY: ForceDefinition = {
  id: 'timeOfDay',
  label: 'Time of day',
  axes: ['tintR', 'tintG', 'tintB'],
  // 1, and the reason is Gate 4's "no per-layer seams": a layer that ignored
  // the time of day while its neighbours followed it would be exactly the seam
  // the condition is looking for. A layer can still opt out explicitly.
  defaultSusceptibility: 1,
  params: [{ key: 'hour', label: 'Hour', min: 0, max: 24, default: 12, step: 0.01, unit: 'h' }],
  evaluate(ctx) {
    const hour = ctx.param('hour');
    // Sun height, 0 at midnight and 1 at noon. Periodic in 24 h by
    // construction, so the sweep has no discontinuity at either end.
    const day = 0.5 - 0.5 * Math.cos((TAU * hour) / 24);
    return tintOf(ramp(DAY_RAMP, day));
  },
};

/* -------------------------------------------------------------------------- */
/* temperature                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Colour temperature of the room. Deliberately subtle — it is the force that
 * makes a scene feel like a season rather than the one that makes it change.
 * 0.5 is neutral and contributes nothing.
 */
export const TEMPERATURE: ForceDefinition = {
  id: 'temperature',
  label: 'Temperature',
  axes: ['tintR', 'tintG', 'tintB'],
  defaultSusceptibility: 1,
  params: [
    { key: 'warmth', label: 'Warmth (cold→hot)', min: 0, max: 1, default: 0.5, step: 0.01 },
  ],
  evaluate(ctx) {
    const w = (ctx.param('warmth') - 0.5) * 2;
    if (w === 0) return {};
    if (w > 0) return tintOf([1, 1 - 0.09 * w, 1 - 0.2 * w]);
    const c = -w;
    return tintOf([1 - 0.2 * c, 1 - 0.07 * c, 1]);
  },
};

/* -------------------------------------------------------------------------- */

/**
 * The forces this build ships. **Adding a force is adding an entry here.**
 *
 * Order is the enumeration order everywhere — the registry, the editor panel,
 * the `[force]` log line — so it is stable and deliberate rather than whatever
 * an object literal happened to produce.
 */
export const FORCE_DEFINITIONS: readonly ForceDefinition[] = [
  WIND,
  RAIN,
  TIME_OF_DAY,
  TEMPERATURE,
];

/** Lookup, for the editor and the tests. */
export function forceById(id: string): ForceDefinition | undefined {
  return FORCE_DEFINITIONS.find((d) => d.id === id);
}
