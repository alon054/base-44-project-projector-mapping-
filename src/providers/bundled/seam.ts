/**
 * D5 — loop-seam handling, as pure arithmetic.
 *
 * "Independent loops drift; non-seamless loops pop. … Seams handled by a short
 * cross-fade or by filtering to seamless assets."
 *
 * Pure and PixiJS-free so §8.1 can test it without a GPU — the thing worth
 * testing is the weighting, and a test that needed a renderer to check a
 * crossfade would be checking the renderer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CROSSFADE, AND WHY THIS ONE.
 *
 * The obvious crossfade — "over the last `s` seconds, fade the tail into a
 * second copy started from zero" — shortens the effective loop to
 * `period - s`. That is fatal here for a reason that has nothing to do with
 * looks: Gate 3 judges that "two loops of different lengths stay phase-
 * consistent relative to the clock after a scrub", and a seam treatment that
 * silently changed a layer's period would make the layer's phase disagree with
 * `phaseAt(t, period)` — the invariant would be broken by the fix for the
 * cosmetic problem.
 *
 * So instead: draw the SAME animation twice, half a period apart, and weight
 * each copy so that **each copy's weight is exactly zero at its own seam**.
 *
 *   wA(p) = sin(pi * p)                 zero at p = 0 and p = 1  (A's seam)
 *   wB(p) = |cos(pi * p)| = sin(pi * (p + 1/2 mod 1))
 *                                       zero at p = 1/2          (B's seam)
 *
 * Copy A is at phase `p`, copy B at `(p + 0.5) mod 1`. At A's discontinuity A
 * is invisible and B is mid-animation and continuous; half a period later the
 * roles swap. Both weights are continuous everywhere, they are normalized to
 * sum to 1, and **the period is untouched** — `phaseFor(period)` still
 * describes the layer exactly.
 *
 * The cost is drawing the layer twice. For a sprite sheet or a Lottie texture
 * that is one extra quad. For VIDEO it is a second decoder, which §5 says to
 * cap hard — so video defaults to `none` and relies on D5's other sanctioned
 * route, "filtering to seamless assets".
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Per-layer, and stored in scene state (I-12), so these are the only values. */
export const SEAM_MODES = ['none', 'crossfade'] as const;
export type SeamMode = (typeof SEAM_MODES)[number];

export function isSeamMode(v: unknown): v is SeamMode {
  return typeof v === 'string' && (SEAM_MODES as readonly string[]).includes(v);
}

export interface SeamWeights {
  /** Phase of the primary copy, in [0, 1). */
  phaseA: number;
  /** Phase of the secondary copy, half a period ahead. */
  phaseB: number;
  /** Opacity of the primary copy, in [0, 1]. */
  weightA: number;
  /** Opacity of the secondary copy. `weightA + weightB === 1`. */
  weightB: number;
}

/** `none`: one copy at full weight, the second unused. */
export function noSeam(phase: number): SeamWeights {
  return { phaseA: phase, phaseB: phase, weightA: 1, weightB: 0 };
}

/**
 * The two-copy crossfade described in this file's header.
 *
 * Normalized so the pair always sums to 1: without that the layer would dim to
 * `sin(pi/4) + cos(pi/4) = 1.414` of nominal at the quarter points and to 1.0
 * at the seams, i.e. it would visibly pulse at twice the loop rate — a
 * different artefact in place of the one being removed.
 */
export function crossfadeSeam(phase: number): SeamWeights {
  // Guarded on the INPUT, not on the sum. `wrap01(NaN)` is 0, and phase 0 is a
  // perfectly real phase whose weights are `weightA: 0, weightB: 1` — correct
  // at the seam and useless as a fallback, because it would silently hand a
  // layer with a broken period the mid-animation copy at full weight and look
  // like it was working.
  if (!Number.isFinite(phase)) return noSeam(0);
  const p = wrap01(phase);
  const phaseB = wrap01(p + 0.5);
  const a = Math.sin(Math.PI * p);
  const b = Math.abs(Math.cos(Math.PI * p));
  const sum = a + b;
  // Bounded below by 1 (at p = 0, 0.5 and 1) and above by sqrt(2), so it can
  // never be 0 for a finite `p`. Kept as a total function anyway.
  if (sum <= 0) return noSeam(p);
  return { phaseA: p, phaseB, weightA: a / sum, weightB: b / sum };
}

export function seamWeights(mode: SeamMode, phase: number): SeamWeights {
  return mode === 'crossfade' ? crossfadeSeam(phase) : noSeam(phase);
}

/**
 * The default seam mode for an asset.
 *
 * An asset that declares itself seamless gets `none`, because a crossfade on a
 * seamless loop costs a second draw and removes nothing. D5's two routes are
 * "a short cross-fade **or** filtering to seamless assets", and this is where
 * the choice between them is made from the asset's own metadata rather than
 * from an operator remembering.
 */
export function defaultSeamMode(seamless: boolean, kind: string): SeamMode {
  if (seamless) return 'none';
  // §5: "each `<video>` runs its own decoder … use sparingly, cap hard." A
  // crossfade on video is a second decoder, so it is never the default even
  // for a non-seamless clip — the operator turns it on knowing the cost.
  if (kind === 'video') return 'none';
  return 'crossfade';
}

function wrap01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const p = v % 1;
  return p < 0 ? p + 1 : p;
}

/**
 * Frame index for a sprite sheet at a given phase.
 *
 * Floor, not round: `round` would show frame 0 for the first and last half-
 * frame of the loop, making frame 0 twice as long as every other frame and
 * putting a visible hitch at the seam of an otherwise even animation.
 */
export function frameAt(phase: number, frames: number): number {
  if (!Number.isFinite(frames) || frames < 1) return 0;
  const n = Math.floor(frames);
  const i = Math.floor(wrap01(phase) * n);
  // `wrap01` can return a value whose product with `n` floors to `n` at the
  // very top of the range through floating point alone.
  return i >= n ? n - 1 : i < 0 ? 0 : i;
}

/** Column/row of a frame in a `columns x rows` grid, row-major. */
export function frameCell(index: number, columns: number): { col: number; row: number } {
  const c = Math.max(1, Math.floor(columns));
  const i = Math.max(0, Math.floor(index));
  return { col: i % c, row: Math.floor(i / c) };
}
