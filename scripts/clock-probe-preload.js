/**
 * Preload for the 1.6 clock probe. Unsandboxed, exactly like the OUTPUT
 * window's preload after `SPEC.md` §10 row 11 shipped, so `process.hrtime`
 * is real here.
 *
 * Exposes three things:
 *  - `calibrateHere(kind)`  — runs the shared calibrator on a clock defined in
 *    THIS scope. No bridge crossing is involved in the timed loop.
 *  - `nowMs()`              — byte-for-byte the wrapper `electron/preload.ts`
 *    ships. Calling it from the renderer DOES cross the bridge, which is the
 *    in-app path `src/debug/clock-source.ts` measures.
 *  - `calibrateSrc`         — the shared algorithm as text, so the renderer
 *    times `nowMs` with the identical code.
 */
'use strict';
const { contextBridge } = require('electron');
const { CALIBRATE_SRC, makeCalibrate } = require('./clock-probe-calibrate.js');

const calibrate = makeCalibrate();

/** The shipping wrapper, copied from `electron/preload.ts`. */
function nowMs() {
  const hr = process.hrtime;
  if (typeof hr?.bigint !== 'function') return null;
  try {
    return Number(hr.bigint()) / 1e6;
  } catch {
    return null;
  }
}

const CLOCKS = {
  // The raw counter, in milliseconds, WITHOUT the guard and the try/catch the
  // shipping wrapper carries. Isolates the counter itself.
  'bigint-bare': () => Number(process.hrtime.bigint()) / 1e6,
  // The shipping wrapper's whole body, still with no bridge crossing. The
  // difference between this row and the one above is the guard + try/catch.
  'nowMs-in-preload': nowMs,
  // `performance.now()` as the preload sees it, for the coarse comparison.
  'performance-in-preload': () => performance.now(),
};

contextBridge.exposeInMainWorld('probe', {
  calibrateSrc: CALIBRATE_SRC,
  kinds: Object.keys(CLOCKS),
  hasHrtime: typeof process.hrtime?.bigint === 'function',
  calibrateHere(kind) {
    const now = CLOCKS[kind];
    if (typeof now !== 'function') return null;
    return calibrate(now);
  },
  /**
   * Reads the counter N times in the preload and returns every raw nanosecond
   * value, so the renderer can compute the HARDWARE quantum as the smallest
   * non-zero gap between consecutive reads. That is a property of the counter,
   * not of any calibration loop, and it is what tells us whether an observed
   * "resolution" is the clock's own tick or a multiple of it forced by the
   * cost of reading it.
   */
  rawTicks(n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = process.hrtime.bigint();
    return out.map((v) => Number(v));
  },
  nowMs,
});
