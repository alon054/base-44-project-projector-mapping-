/**
 * Output window: the authoritative renderer (I-7). Full DEV_RESOLUTION, HUD
 * available but off by default (C4), cursor hidden by CSS.
 */
import {
  DEV_RESOLUTION,
  PARAM_TEST_PATTERN_SPEED,
  TARGET_RESOLUTION,
  type OutputConfig,
  type ProvocationSpec,
  type ProvocationVerdict,
} from '@shared/ipc';
import { WARMUP_MS, WINDOW_MS, Hud, formatReport, passesHeadroom, passesPresentation } from '../debug/hud';
import { createRenderHost } from '../render/host';
import { canonicalizeScene, type Scene } from '../core/scene';

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
  measureLabel: '',
  measureCues: [],
  provocations: [],
  conditions: null,
};

const hud = new Hud(document.body);

// Listeners are registered BEFORE the async Pixi init, and pending values are
// buffered. Registering after the `await` loses any message the main process
// pushed on `did-finish-load`.
let host: Awaited<ReturnType<typeof createRenderHost>> | null = null;
// Held in a box: a bare `let` assigned only inside a callback gets narrowed to
// `never` by control-flow analysis at the top-level read below.
const pendingSpeed: { v: { value: number; token: number; t0: number } | null } = { v: null };
/** Same race as the speed above: a scene can arrive before Pixi has finished init. */
const pendingScene: { v: Scene | null } = { v: null };

/**
 * I-13, mirrored back to the editor's layer list. Sent only when the set
 * changes, not every frame — a live session should see a layer go red once,
 * not sixty times a second.
 */
let lastFailureKey = '';
function reportFailures(): void {
  if (!host) return;
  const failures = host.failures();
  const key = JSON.stringify(failures);
  if (key === lastFailureKey) return;
  lastFailureKey = key;
  window.engine.reportSceneFailures(failures);
}

function applyScene(raw: unknown): void {
  let scene: Scene;
  try {
    // The validation boundary (I-12). A malformed scene is refused here, with a
    // reason, rather than half-applied — and refusing it leaves the output
    // showing the scene it already had, which is what a live session needs.
    scene = canonicalizeScene(raw);
  } catch (e) {
    console.error(`[output] refused scene: ${(e as Error).message}`);
    return;
  }
  if (!host) {
    pendingScene.v = scene;
    return;
  }
  host.setScene(scene);
  reportFailures();
}

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

window.engine.onScene((s) => applyScene(s.scene));

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

if (pendingScene.v) {
  host.setScene(pendingScene.v);
  pendingScene.v = null;
}
reportFailures();

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

/**
 * A12 attribution support. The output renderer had no way to tell whether a
 * stall coincided with the window losing focus or being occluded, so every
 * such hypothesis had to be argued rather than checked. These are event-driven,
 * not per-frame, so they cost nothing against A14's clause.
 *
 * `backgroundThrottling: false` stops timer throttling but does NOT make
 * Chromium run rAF for a surface it considers not visible — so occlusion
 * remains a live candidate for a multi-frame stall, and this is how we see it.
 */
interface RunEvent {
  t: number;
  what: string;
  disturbing: boolean;
}
const runEvents: RunEvent[] = [];

/**
 * The output window has no cursor and draws black, so "does this window have
 * keyboard focus?" is otherwise unanswerable by looking at the wall. Shown only
 * when focus is LOST, so a clean run draws nothing extra.
 */
const focusBadge = document.createElement('div');
focusBadge.style.cssText = [
  'position:fixed',
  'left:0',
  'right:0',
  'bottom:0',
  'padding:10px 14px',
  'font:600 16px/1.3 ui-monospace,Menlo,monospace',
  'color:#111',
  'background:#ffcc00',
  'text-align:center',
  'z-index:20',
  'display:none',
].join(';');
focusBadge.textContent =
  'OUTPUT WINDOW NOT FOCUSED — click anywhere on this display; h / r / k need focus';
document.body.appendChild(focusBadge);

{
  const logEvent = (what: string, disturbing: boolean): void => {
    const t = host ? host.metrics.elapsedSeconds : 0;
    runEvents.push({ t, what, disturbing });
    console.log(`[event] t=${t.toFixed(2)}s ${what}${disturbing ? '  [DISTURBING]' : ''}`);
  };
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState !== 'visible';
    logEvent(`visibility=${document.visibilityState}`, hidden);
  });
  window.addEventListener('focus', () => {
    focusBadge.style.display = 'none';
    logEvent('focus gained', false);
  });
  window.addEventListener('blur', () => {
    focusBadge.style.display = 'block';
    logEvent('focus LOST', true);
  });
  if (!document.hasFocus()) focusBadge.style.display = 'block';
}

/**
 * The on-wall cue for the operator-driven disturbance run. Large, centred, and
 * only ever built when cues are configured — an interactive or gate run never
 * constructs it, so it cannot cost anything it is not asked to cost.
 */
function showCue(text: string, holdMs: number): void {
  let el = document.querySelector<HTMLDivElement>('#cue');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cue';
    el.style.cssText = [
      'position:fixed',
      'inset:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font:700 92px/1 ui-monospace,Menlo,monospace',
      'color:#ff3b30',
      'pointer-events:none',
      'z-index:30',
    ].join(';');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = 'flex';
  const target = el;
  window.setTimeout(() => {
    target.style.display = 'none';
  }, holdMs);
}

/**
 * Intervals captured across one provocation: a couple before it lands, the
 * suspend gap itself, and the frames after the resume.
 */
const PROVOKE_TRACE_FRAMES = 24;
/** Time allowed after the provoked state is released for frames to resume. */
const PROVOKE_SETTLE_MS = 1200;

const provocationVerdicts: ProvocationVerdict[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Drive one provocation and let the machine decide what it did.
 *
 * The whole point is that nothing here needs a human: the harness causes the
 * OS event, `visibilitychange` says whether the surface genuinely suspended,
 * and the interval trace says whether the resume cost anything beyond the gap
 * we deliberately asked for. A suspend of D ms produces one interval of ~D by
 * construction — that attributes nothing on its own — so the frames *after*
 * the longest interval are the evidence.
 */
async function runProvocation(spec: ProvocationSpec): Promise<void> {
  if (!host) return;
  const firstEvent = runEvents.length;
  const tStart = host.metrics.elapsedSeconds;
  console.log(`[provoke] t=${tStart.toFixed(2)}s ${spec.kind} START`);

  // Armed BEFORE the event, so the trace contains the approach, the gap, and
  // the recovery rather than starting after the interesting part.
  host.metrics.armCapture(PROVOKE_TRACE_FRAMES);
  let note = '';
  try {
    note = await window.engine.provoke(spec.kind);
  } catch (err) {
    note = `provoke failed: ${String(err)}`;
  }
  await delay(PROVOKE_SETTLE_MS);

  const tEnd = host.metrics.elapsedSeconds;
  const trace = host.metrics.takeCapture();
  const range = host.metrics.intervalsInElapsedRange(tStart - 0.5, tEnd + 0.5);
  const seen = runEvents.slice(firstEvent);

  // The gap is the longest interval in the trace; everything after it is the
  // resume cost, which is the number that can attribute a stall.
  let peak = -1;
  let peakIdx = -1;
  trace.forEach((ms, i) => {
    if (ms > peak) {
      peak = ms;
      peakIdx = i;
    }
  });
  const after = peakIdx >= 0 ? trace.slice(peakIdx + 1) : [];

  const verdict: ProvocationVerdict = {
    kind: spec.kind,
    requestedAtSeconds: spec.atSeconds,
    visibilityHidden: seen.some((e) => e.what.startsWith('visibility=') && e.what !== 'visibility=visible'),
    focusLost: seen.some((e) => e.what === 'focus LOST'),
    maxIntervalMs: range.maxIntervalMs,
    clause3InWindow: range.clause3,
    intervalsAfterResume: after,
    note,
  };
  provocationVerdicts.push(verdict);
  console.log(
    `[provoke] t=${tEnd.toFixed(2)}s ${spec.kind} END  ` +
      `surfaceSuspended=${String(verdict.visibilityHidden)}  focusLost=${String(verdict.focusLost)}  ` +
      `maxInterval=${range.maxIntervalMs.toFixed(1)}ms  clause3=${range.clause3}  ` +
      `afterResume=[${after.map((x) => x.toFixed(1)).join(' ')}]  ${note}`,
  );
}

/**
 * One full §4 protocol window, unattended: reset, wait out warmup + window
 * untouched, emit a structured summary, probe k, quit. Emits a machine-readable
 * JSON block so the report is assembled from the app's own numbers rather than
 * from anything retyped.
 */
function startMeasurementRun(
  label: string,
  cues: readonly number[],
  provocations: readonly ProvocationSpec[],
): void {
  const totalMs = WARMUP_MS + WINDOW_MS;
  console.log(
    `[run] START label=${label} warmupMs=${WARMUP_MS} windowMs=${WINDOW_MS} ` +
      `cues=[${cues.join(',')}] — measurement ends in ${(totalMs / 1000).toFixed(0)}s`,
  );
  host?.metrics.reset();

  for (const cue of cues) {
    // Countdown on the wall so the operator acts on a signal, not a stopwatch.
    for (let k = 5; k >= 1; k--) {
      window.setTimeout(
        () => showCue(String(k), 900),
        WARMUP_MS + (cue - k) * 1000,
      );
    }
    window.setTimeout(() => {
      showCue('SWITCH NOW', 1500);
      console.log(`[run] CUE at t=${cue}s — operator action due now`);
    }, WARMUP_MS + cue * 1000);
  }

  // Unattended provocations. No countdown and no cue overlay — nothing here is
  // for a human to see or act on.
  for (const spec of provocations) {
    window.setTimeout(() => {
      void runProvocation(spec);
    }, WARMUP_MS + spec.atSeconds * 1000);
  }

  window.setTimeout(() => {
    if (!host) return;
    const r = host.metrics.report();
    const k = host.probe(); // resets the window; the report above is already taken
    const disturbing = runEvents.filter((e) => e.disturbing && e.t >= 0);
    const summary = {
      label,
      disturbed: disturbing.length > 0,
      nominalMs: r.nominalMs,
      valid: r.valid,
      samples: r.samples,
      fps: r.fps,
      m1Pass: passesPresentation(r),
      lateFraction: r.lateFraction,
      worstLateRun: r.worstLateRun,
      worstIntervalMs: r.worstIntervalMs,
      clause3: r.magnitudeEvents,
      m2Pass: passesHeadroom(r),
      renderP99Ms: r.renderP99Ms,
      renderP99OfNominal: r.renderP99OfNominal,
      renderP95Ms: r.renderP95Ms,
      instrument: r.instrument,
      scale: r.scale,
      k,
      events: runEvents,
      // The conditions the run actually ran in, so no later reader has to
      // reconstruct them with `defaults read` after the fact.
      conditions: config.conditions,
      provocations: provocationVerdicts,
    };
    console.log('[run] SUMMARY ' + JSON.stringify(summary));
    console.log(`[run] END label=${label} disturbed=${summary.disturbed}`);
    window.engine.measureDone();
  }, totalMs + 500);
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

// A8 diagnostic: the probe reported k_target CHEAPER than k_dev, which is
// physically impossible for real fill work. Alternating the order isolates
// warm-up bias (first-measured pays for framebuffer/pipeline creation) from a
// genuine result. Not a gate path — a bench for the instrument itself.
if (config.measureLabel === 'probe-only') {
  const orders = ['dev-first', 'target-first', 'dev-first', 'target-first'] as const;
  for (const o of orders) {
    const k = host.probe(o);
    console.log(
      `[probe] order=${o} k_dev=${k.dev.toFixed(1)}x (${k.devMs.toFixed(4)}ms) ` +
        `k_target=${k.target.toFixed(1)}x (${k.targetMs.toFixed(4)}ms) ratio=${k.ratio.toFixed(3)}`,
    );
  }
  window.engine.measureDone();
}

// Kick off the unattended run last, so every listener, the HUD and the focus
// trail are already live when the window opens (SPEC.md §4).
if (config.measureLabel !== '' && config.measureLabel !== 'probe-only' && config.measureLabel !== 'latency') {
  if (config.conditions) {
    const c = config.conditions;
    console.log(
      `[conditions] separateSpaces=${String(c.separateSpaces)} (spans-displays=${c.spansDisplaysRaw})  ` +
        `hiddenInMissionControl=${String(c.hiddenInMissionControl)}  displays=${c.displayCount}  ` +
        `output="${c.outputDisplay?.label ?? '?'}" fullscreen=${String(c.outputFullscreen)}  pin=${c.pin}`,
    );
  } else {
    console.warn('[conditions] NOT CAPTURED — this run cannot say what it ran under');
  }
  startMeasurementRun(config.measureLabel, config.measureCues, config.provocations);
}
