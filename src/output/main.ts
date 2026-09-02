/**
 * Output window: the authoritative renderer (I-7). Full DEV_RESOLUTION, HUD
 * available but off by default (C4), cursor hidden by CSS.
 */
import {
  DEV_RESOLUTION,
  PARAM_TEST_PATTERN_SPEED,
  TARGET_RESOLUTION,
  type OutputConfig,
} from '@shared/ipc';
import { Hud, formatReport } from '../debug/hud';
import { createRenderHost } from '../render/host';

const stage = document.querySelector<HTMLDivElement>('#stage')!;
const banner = document.querySelector<HTMLDivElement>('#banner')!;

let config: OutputConfig = {
  width: DEV_RESOLUTION.width,
  height: DEV_RESOLUTION.height,
  // Placeholder only until the main process reports the real mode. Never used
  // for a gate number — SPEC.md §4 forbids assuming 60.
  displayFrequency: 0,
  scaleFactor: 1,
  uncapped: false,
  role: 'output',
  hudVisible: false,
};

const hud = new Hud(document.body);

// Listeners are registered BEFORE the async Pixi init, and pending values are
// buffered. Registering after the `await` loses any message the main process
// pushed on `did-finish-load`.
let host: Awaited<ReturnType<typeof createRenderHost>> | null = null;
// Held in a box: a bare `let` assigned only inside a callback gets narrowed to
// `never` by control-flow analysis at the top-level read below.
const pendingSpeed: { v: { value: number; token: number; t0: number } | null } = { v: null };

function applyConfig(c: OutputConfig): void {
  config = c;
  if (c.displayFrequency > 0) host?.setNominalMs(1000 / c.displayFrequency);
  host?.resize(c.width, c.height);
  // Restored from config/ (SPEC.md §7); still off by default (C4).
  hud.setVisible(c.hudVisible);
  console.log(
    `[output] mode: ${c.width}x${c.height}, displayFrequency=${c.displayFrequency}Hz, ` +
      `N=${c.displayFrequency > 0 ? (1000 / c.displayFrequency).toFixed(4) : 'unknown'}ms, ` +
      `scaleFactor=${c.scaleFactor}, uncapped=${c.uncapped}`,
  );
}

window.engine.onOutputConfig(applyConfig);

window.engine.onParam((p) => {
  if (p.key !== PARAM_TEST_PATTERN_SPEED) return;
  // A11: transport ack FIRST, before any frame wait. This is the figure that
  // moves under load; the presented ack below is conservative by one frame by
  // construction and would hide a transport regression behind the cadence.
  window.engine.recvParam({ token: p.token, t0: p.t0 });
  if (!host) {
    pendingSpeed.v = { value: p.value, token: p.token, t0: p.t0 };
    return;
  }
  host.setSpeed(p.value);
  host.markPending(p.token, p.t0);
});

window.engine.onWarning((w) => {
  banner.textContent = w.text;
  banner.style.display = w.level === 'info' ? 'none' : 'block';
});

host = await createRenderHost({
  parent: stage,
  width: config.width,
  height: config.height,
  nominalMs: 0,
  onPresented: (token, t0) => window.engine.ackParam({ token, t0 }),
});

if (pendingSpeed.v) {
  host.setSpeed(pendingSpeed.v.value);
  host.markPending(pendingSpeed.v.token, pendingSpeed.v.t0);
  pendingSpeed.v = null;
}

// Pull the config, in case the push arrived before this module was ready.
const pulled = await window.engine.getOutputConfig();
if (pulled) applyConfig(pulled);
else console.warn('[output] no config available from main yet');

// The editor's text mirror is always on (C4), so metrics are reported whether
// or not the overlay is drawn here.
setInterval(() => {
  if (!host) return;
  // A14: the tick times itself, so the instrument's cost is a reported number.
  const t0 = performance.now();
  host.metrics.setScale(host.scaleReport());
  const r = host.metrics.report();
  window.engine.reportMetrics(r);
  hud.update(formatReport(r, config.uncapped));
  host.metrics.noteInstrumentTick(performance.now() - t0);
}, 250);

// A3: say it once, loudly, at startup. A scaler between our backing store and
// the panel is the condition DEV_RESOLUTION exists to eliminate, and it is
// invisible unless something checks.
{
  const sc = host.scaleReport();
  console.log(
    `[scale] buffer ${sc.bufferWidth}x${sc.bufferHeight}  css ${sc.cssWidth}x${sc.cssHeight}  ` +
      `dpr ${sc.dpr}  displayScaleFactor ${config.scaleFactor}  ` +
      (sc.oneToOne ? '1:1 to panel' : 'NOT 1:1 — a scaler is in the path'),
  );
  if (!sc.oneToOne) {
    banner.textContent =
      `Output is NOT 1:1 to the panel: ${sc.bufferWidth}x${sc.bufferHeight} backing store ` +
      `into a ${sc.cssWidth}x${sc.cssHeight} CSS box at dpr ${sc.dpr}. ` +
      'Gate numbers measured this way describe a scaled path (SPEC.md §4, A3).';
    banner.style.display = 'block';
  }
}

// I-11: the HUD stays available. `h` toggles it; it starts hidden so it is never
// burned into a live projection.
window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') {
    const v = hud.toggle();
    window.engine.setHudState(v);
    console.log(`[hud] ${v ? 'shown' : 'hidden'}`);
  }
  if (e.key === 'r' || e.key === 'R') {
    host?.metrics.reset();
    console.log('[hud] metrics window reset — warmup restarts');
  }
  // A8: k_dev / k_target. On demand only — the probe saturates the GPU and
  // would corrupt the gate window it sits beside, so it resets that window.
  if (e.key === 'k' || e.key === 'K') {
    if (!host) return;
    const k = host.probe();
    console.log(
      `[k] k_dev=${k.dev.toFixed(2)}x (${k.devMs.toFixed(3)} ms/render @${DEV_RESOLUTION.width}x${DEV_RESOLUTION.height})  ` +
        `k_target=${k.target.toFixed(2)}x (${k.targetMs.toFixed(3)} ms/render @${TARGET_RESOLUTION.width}x${TARGET_RESOLUTION.height})  ` +
        `fill-rate coefficient=${k.ratio.toFixed(3)}  iterations=${k.iterations}  ` +
        '(metrics window reset — probe hitch excluded)',
    );
  }
});
