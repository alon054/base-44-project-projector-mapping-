/**
 * Output window: the authoritative renderer (I-7). Full DEV_RESOLUTION, HUD
 * available but off by default (C4), cursor hidden by CSS.
 */
import { DEV_RESOLUTION, PARAM_TEST_PATTERN_SPEED, type OutputConfig } from '@shared/ipc';
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
  const r = host.metrics.report();
  window.engine.reportMetrics(r);
  hud.update(formatReport(r, config.uncapped));
}, 250);

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
});
