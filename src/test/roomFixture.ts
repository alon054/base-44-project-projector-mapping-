/**
 * The two-face room the suite reasons about — a FROZEN COPY, not the live file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS.
 *
 * `calibration/surfaces.json` used to be two things at once: the room the app
 * writes when a builder marks a face, and the fixture several tests asserted
 * exact coordinates against. Those two jobs are incompatible, and the moment
 * anyone used the app for its actual purpose the suite went red — four tests
 * failing on numbers that had changed *because the tool worked*.
 *
 * At a wall that is worse than an inconvenience. `npm test` is how this project
 * decides whether it is safe to shoot, and a red suite that means "you marked
 * your room" is a red suite nobody will read carefully at 1am.
 *
 * The golden harness already settled this and these tests simply had not
 * followed it: `src/golden/main.ts` holds `GOLDEN_FACE_QUAD` and `GOLDEN_FACE_L`
 * as literals *deliberately*, "so re-marking at the wall cannot re-bless
 * goldens". This is the same ruling applied to the unit suite.
 *
 * WHAT IS STILL ASSERTED AGAINST THE LIVE FILE, AND WHY.
 *
 * Everything that is true of ANY room, and nothing that is true of one:
 *
 *  - it parses, and its version is one this build reads
 *  - every stored point is normalized (I-1)
 *  - no scene or content field has leaked into it (I-5, I-15)
 *  - ids are unique, so two faces cannot be one face
 *
 * Those are properties of the FORMAT, so they hold after a marking session and
 * they are exactly what a corrupted write would break. The coordinates of a
 * particular six-point L are properties of one afternoon's fixture, and they
 * belong here.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not a `.test.ts` file, so vitest treats it as a helper rather than a suite —
 * the same arrangement `electron-stub.ts` uses.
 */
import { createPath } from '../core/paths';
import { createSurface, type Surface } from '../core/surfaces';

/** A plain quad. Four points, closed. */
export const FIXTURE_QUAD: Surface = createSurface({
  id: 'surface-1',
  name: 'face 1',
  role: 'panel',
  path: createPath({
    id: 'surface-1-path',
    closed: true,
    points: [
      { x: 0.08, y: 0.18 },
      { x: 0.44, y: 0.12 },
      { x: 0.44, y: 0.74 },
      { x: 0.08, y: 0.82 },
    ],
  }),
});

/**
 * A six-point L with a reflex corner.
 *
 * The reflex corner is the load-bearing part: four points could still be a
 * trapezoid, which a rectangle can be transformed into, so it would prove
 * nothing about clipping. A reflex corner cannot be a rectangle under any
 * transform, which is what makes a mask *visible* rather than merely present.
 */
export const FIXTURE_L: Surface = createSurface({
  id: 'surface-2',
  name: 'face 2',
  role: 'panel',
  path: createPath({
    id: 'surface-2-path',
    closed: true,
    points: [
      { x: 0.56, y: 0.16 },
      { x: 0.92, y: 0.22 },
      { x: 0.92, y: 0.52 },
      { x: 0.74, y: 0.5 },
      { x: 0.74, y: 0.78 },
      { x: 0.56, y: 0.8 },
    ],
  }),
});

/** The fixture room, in marking order. */
export function fixtureRoom(): Surface[] {
  return [FIXTURE_QUAD, FIXTURE_L];
}
