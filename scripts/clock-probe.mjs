/**
 * Part 1.6 — reconcile the instrument clock's call cost: 12 ns or 188 ns?
 *
 * Two figures are on the record for the same clock, fifteen-fold apart:
 *
 *   - session 5's standalone row-11 experiment: resolution 41 ns, cost 12 ns
 *   - session 6's shipping output window, in-app:   resolution 84 ns, cost 188 ns
 *
 * The decision does not turn on it — 188 ns against a 100 us subject is still
 * three orders of magnitude, and `selectClockSource` re-measures against
 * `CLOCK_CALL_BUDGET_MS` at every startup in any case. But M2's call cost sits
 * INSIDE what M2 measures, which is A14's exact territory, and two numbers with
 * no explanation between them are what A9 exists to refuse.
 *
 * So this probe measures every candidate explanation in ONE process, with ONE
 * shared calibration algorithm (`clock-probe-calibrate.js`), differing only in
 * which clock is being read and from which side of the context bridge:
 *
 *   bigint-bare              raw counter, preload scope, no bridge
 *   nowMs-in-preload         the shipping wrapper's body, preload scope, no bridge
 *   performance-in-preload   the coarse clock, preload scope
 *   nowMs-over-bridge        the shipping wrapper called from the renderer — the
 *                            path `src/debug/clock-source.ts` actually times
 *
 * plus the counter's HARDWARE quantum, read as raw nanosecond ticks in the
 * preload with no calibration loop around it at all.
 *
 * Run:  npx electron scripts/clock-probe.mjs
 */
import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPEATS = 5;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 360,
    webPreferences: {
      preload: join(HERE, 'clock-probe-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The condition under test: this is what the OUTPUT window now sets.
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  await win.loadURL('data:text/html,<!doctype html><title>clock probe</title>');

  const result = await win.webContents.executeJavaScript(
    `(() => {
      const calibrate = new Function('now', window.probe.calibrateSrc);
      const rows = {};
      const REPEATS = ${REPEATS};

      // Every candidate that never crosses the bridge, measured in the preload.
      for (const kind of window.probe.kinds) {
        rows[kind] = [];
        for (let r = 0; r < REPEATS; r++) rows[kind].push(window.probe.calibrateHere(kind));
      }

      // The in-app path: the SAME wrapper, called from the main world, so every
      // read crosses the context bridge. This is what the shipping instrument
      // does 60 times a second.
      rows['nowMs-over-bridge'] = [];
      for (let r = 0; r < REPEATS; r++) rows['nowMs-over-bridge'].push(calibrate(window.probe.nowMs));

      // performance.now() in the RENDERER, which is the coarsened one and the
      // clock every M2 figure before row 11 was taken with.
      rows['performance-in-renderer'] = [];
      for (let r = 0; r < REPEATS; r++) rows['performance-in-renderer'].push(calibrate(() => performance.now()));

      // The counter's own tick, with no calibration loop around it: the
      // smallest non-zero gap between consecutive raw reads.
      const ticks = window.probe.rawTicks(200000);
      let quantumNs = Infinity;
      let zeroGaps = 0;
      for (let i = 1; i < ticks.length; i++) {
        const d = ticks[i] - ticks[i - 1];
        if (d === 0) zeroGaps++;
        else if (d > 0 && d < quantumNs) quantumNs = d;
      }
      const spanNs = ticks[ticks.length - 1] - ticks[0];

      return {
        hasHrtime: window.probe.hasHrtime,
        rows,
        raw: {
          reads: ticks.length,
          quantumNs: Number.isFinite(quantumNs) ? quantumNs : null,
          zeroGaps,
          spanNs,
          nsPerRead: spanNs / (ticks.length - 1),
        },
      };
    })()`,
  );

  const med = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const fmtNs = (ms) => (ms * 1e6).toFixed(1);

  const lines = [];
  lines.push(`[clock-probe] ${new Date().toISOString()}`);
  lines.push(`[clock-probe] ${os.type()} ${os.release()}  electron=${process.versions.electron}  chrome=${process.versions.chrome}  node=${process.versions.node}`);
  lines.push(`[clock-probe] sandbox=false  contextIsolation=true  hrtime available in preload: ${result.hasHrtime}`);
  lines.push('');
  lines.push(`[clock-probe] counter's own tick, ${result.raw.reads} consecutive raw reads, no calibration loop:`);
  lines.push(`  hardware quantum      ${result.raw.quantumNs} ns`);
  lines.push(`  consecutive reads returning the SAME value  ${result.raw.zeroGaps} of ${result.raw.reads - 1}`);
  lines.push(`  wall time per raw read (span/reads)  ${result.raw.nsPerRead.toFixed(1)} ns`);
  lines.push('');
  lines.push(`[clock-probe] shared calibrator, median of ${REPEATS} runs each:`);
  lines.push('');
  lines.push('  clock                      crosses bridge   resolution      call cost');
  lines.push('  ------------------------------------------------------------------------');
  const order = [
    ['bigint-bare', 'no'],
    ['nowMs-in-preload', 'no'],
    ['nowMs-over-bridge', 'YES'],
    ['performance-in-preload', 'no'],
    ['performance-in-renderer', 'no'],
  ];
  const table = {};
  for (const [kind, bridge] of order) {
    const runs = result.rows[kind];
    if (!runs) continue;
    const res = med(runs.map((r) => r.resolutionMs));
    const cost = med(runs.map((r) => r.callCostMs));
    table[kind] = { resolutionMs: res, callCostMs: cost, runs };
    lines.push(
      `  ${kind.padEnd(26)} ${bridge.padEnd(16)} ${(fmtNs(res) + ' ns').padStart(12)}   ${(fmtNs(cost) + ' ns').padStart(12)}`,
    );
  }
  lines.push('');
  const bare = table['bigint-bare'];
  const bridged = table['nowMs-over-bridge'];
  if (bare && bridged) {
    const deltaNs = (bridged.callCostMs - bare.callCostMs) * 1e6;
    lines.push(
      `[clock-probe] bridge crossing costs ${deltaNs.toFixed(1)} ns per call ` +
        `(${(bridged.callCostMs / bare.callCostMs).toFixed(1)}x the bare counter).`,
    );
  }
  lines.push('');
  lines.push('[clock-probe] per-run spread, so a median is not read as a measurement:');
  for (const [kind] of order) {
    const t = table[kind];
    if (!t) continue;
    lines.push(
      `  ${kind.padEnd(26)} cost ${t.runs.map((r) => fmtNs(r.callCostMs)).join(' / ')} ns` +
        `   res ${t.runs.map((r) => fmtNs(r.resolutionMs)).join(' / ')} ns`,
    );
  }

  const text = lines.join('\n');
  console.log(text);
  const out = join(HERE, '..', 'measurements', 'p5-clock-probe.txt');
  writeFileSync(out, text + '\n');
  console.log(`\n[clock-probe] written to ${out}`);
  app.exit(0);
});
