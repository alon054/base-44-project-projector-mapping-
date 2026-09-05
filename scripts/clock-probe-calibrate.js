/**
 * The calibration algorithm, as ONE piece of source text, so that every figure
 * this probe reports is produced by the identical code.
 *
 * 1.6 asks which of two reported call costs is right — 12 ns or 188 ns. An
 * answer of the form "they were measured differently" is only worth having if
 * the difference is the ONE thing that differs. So the algorithm is shared as
 * text and rebuilt with `new Function` on both sides of the context bridge:
 * the preload requires this file, the renderer receives the same string across
 * the bridge and constructs the same function from it. What differs between
 * the figures is then the clock alone, which is the whole point.
 *
 * The body is copied verbatim from `src/debug/clock-source.ts`'s `calibrate`,
 * constants included (2000 calls, 32 resolution attempts, 200-call JIT warm).
 * A probe that measured with a different algorithm than the app would answer a
 * question nobody asked (A14).
 */
'use strict';

const CALIBRATE_SRC = `
  for (let i = 0; i < 200; i++) now();

  const t0 = now();
  for (let i = 0; i < 2000; i++) now();
  const t1 = now();
  const callCostMs = (t1 - t0) / 2000;

  let resolutionMs = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 32; attempt++) {
    const a = now();
    let b = a;
    for (let guard = 0; guard < 1000000 && b === a; guard++) b = now();
    const step = b - a;
    if (step > 0 && step < resolutionMs) resolutionMs = step;
  }
  return {
    resolutionMs: Number.isFinite(resolutionMs) ? resolutionMs : 0,
    callCostMs: callCostMs > 0 ? callCostMs : 0,
  };
`;

/** Build the calibrator from the shared source. `now` is its only free name. */
function makeCalibrate() {
  // eslint-disable-next-line no-new-func
  return new Function('now', CALIBRATE_SRC);
}

module.exports = { CALIBRATE_SRC, makeCalibrate };
