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
import { canonicalizeClockTransport } from '../core/clock';
import { attachClockLog } from '../debug/clockLog';
import {
  canonicalizeCalibration,
  calibrationFor,
  canonicalizeCalibrationFile,
  createCalibration,
  type ViewportCalibration,
} from '../render/calibration';
import { createOutputs, primaryViewport } from '../render/outputs';
import { canonicalizeScene, layersInDrawOrder, type Scene } from '../core/scene';
import { judgeSoak, type GpuSample } from '../debug/gpu';

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
  soakMinutes: 0,
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
/**
 * I-2. A clock state that arrived before the host existed — main replays the
 * last one at `did-finish-load`, which is reliably earlier than
 * `await createRenderHost`. Without this the first thing a reopened output
 * window does is silently ignore the show's time.
 */
const pendingClock: { v: ReturnType<typeof canonicalizeClockTransport> | null } = { v: null };
/** Same race as the speed above: a scene can arrive before Pixi has finished init. */
const pendingScene: { v: Scene | null } = { v: null };
/**
 * I-5, and the same race again. The stored calibration is fetched in parallel
 * with Pixi init, and an editor edit can land before either finishes.
 */
const pendingCalibration: { v: ViewportCalibration | null } = { v: null };

/**
 * I-9: the one place v1 is allowed to assume a single output. Calibration is
 * keyed by this, so a second projector in Phase 11 is another entry in the
 * file rather than a migration of it.
 */
const VIEWPORT_ID = primaryViewport(createOutputs(DEV_RESOLUTION.width, DEV_RESOLUTION.height)).id;

function applyCalibration(cal: ViewportCalibration): void {
  if (!host) {
    pendingCalibration.v = cal;
    return;
  }
  // The `[warp]` line is emitted from inside the stage, on change only, and
  // states the toggle and all four corners. Phase 1's `[scene] applied` is what
  // made three editor bugs findable; warp state is strictly harder to read off
  // a projection than draw order is, so it gets the same treatment.
  host.setCalibration(cal);
}

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
  // Operator-paced, not per-frame, so it costs nothing on the render thread.
  // Without it, "the editor changed something and the wall did not" is
  // unanswerable from the wall — exactly the class of question A12 and A3
  // exist to make answerable rather than arguable.
  console.log(
    `[scene] applied "${scene.id}" draw order: ` +
      layersInDrawOrder(scene)
        .map((l) => `${l.id}(z${l.zOrder}${l.visible ? '' : ',hidden'})`)
        .join(' -> '),
  );
}

function applyConfig(c: OutputConfig): void {
  config = c;
  // The measure-run flag arrives here, so the badge's visibility is re-decided.
  syncFocusBadge();
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

// ---------------------------------------------------------------------------
// A12 attribution and the focus badge are declared HERE, above the first IPC
// listener, and not further down where they read more naturally.
//
// `applyConfig` calls `syncFocusBadge`, and main pushes the config while this
// module is still evaluating — during the `await createRenderHost` below,
// which takes real time for Pixi init. Declared after that await, the binding
// is still uninitialised when the push lands, and the output window dies on
// "is not a function" before it draws a frame. Nothing about the badge is
// order-sensitive; the listener that reaches it is.
// ---------------------------------------------------------------------------
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
 *
 * **Restricted to measurement runs from Phase 1.** It was unconditional, which
 * was harmless while the editor had one slider and nobody clicked it — and
 * wrong the moment there was an editor worth using. Every click on the control
 * panel takes focus off the output window by definition, so the badge painted a
 * yellow bar across the projected image during ordinary editing. On a live
 * instrument, burning a warning onto the wall for the operator doing their job
 * is a defect, not a diagnostic.
 *
 * The *logging* below stays unconditional — A12 attribution needs focus and
 * visibility events on every run, and those cost nothing on the wall. Only the
 * visible badge is gated, so nothing about attribution changes.
 */
let focusIsLost = false;
let syncFocusBadge: () => void = () => {};
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
  // Read at the moment of blur, not captured: `config.measureLabel` is still
  // the default when this module evaluates and is filled in by `applyConfig`.
  const badgeWanted = (): boolean => config.measureLabel !== '';
  syncFocusBadge = (): void => {
    focusBadge.style.display = focusIsLost && badgeWanted() ? 'block' : 'none';
  };
  window.addEventListener('focus', () => {
    focusIsLost = false;
    syncFocusBadge();
    logEvent('focus gained', false);
  });
  window.addEventListener('blur', () => {
    focusIsLost = true;
    syncFocusBadge();
    logEvent('focus LOST', true);
  });
  focusIsLost = !document.hasFocus();
  syncFocusBadge();
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

window.engine.onClock((c) => {
  const state = canonicalizeClockTransport(c);
  if (!host) {
    pendingClock.v = state;
    return;
  }
  host.setClock(state);
});

window.engine.onCalibration((c) => applyCalibration(canonicalizeCalibration(c, VIEWPORT_ID)));

window.engine.onWarning((w) => {
  banner.textContent = w.text;
  banner.style.display = w.level === 'info' ? 'none' : 'block';
});

// Fetched before the await below so the stored calibration and Pixi init
// overlap rather than queue. I-13: a rejected read is not fatal — the session
// opens unwarped, which is a visible, correctable state.
const storedCalibration: Promise<ViewportCalibration> = window.engine
  .getCalibration()
  .then((raw) => {
    // A single viewport entry (what the live relay sends) or a whole file
    // (what disk holds) are both accepted; the file is the general case.
    const single = canonicalizeCalibration(raw, VIEWPORT_ID);
    const fromFile = calibrationFor(canonicalizeCalibrationFile(raw), VIEWPORT_ID);
    return raw && typeof raw === 'object' && 'viewports' in (raw as object) ? fromFile : single;
  })
  .catch((err: unknown) => {
    console.error(`[warp] could not read stored calibration: ${String(err)}`);
    return createCalibration(VIEWPORT_ID);
  });

host = await createRenderHost({
  parent: stage,
  width: config.width,
  height: config.height,
  nominalMs: 0,
  onPresented: (token, t0) => window.engine.ackParam({ token, t0 }),
  // I-5. Only the output window warps. The editor preview deliberately does
  // not — D11 makes the preview the placement space, and placing objects on a
  // distorted canvas teaches the wrong mental model from the start.
  warp: true,
  onWarpFallback: (reason) => {
    // I-13: the warp is gone, the session is not. Say so where it can be seen.
    banner.textContent = `warp disabled: ${reason}`;
    banner.style.display = 'block';
  },
});

if (pendingScene.v) {
  host.setScene(pendingScene.v);
  pendingScene.v = null;
}

// A live edit that landed during init wins over the stored file — it is newer.
void storedCalibration.then((stored) => {
  applyCalibration(pendingCalibration.v ?? stored);
  pendingCalibration.v = null;
});
reportFailures();

if (pendingSpeed.v) {
  host.setSpeed(pendingSpeed.v.value);
  host.markPending(pendingSpeed.v.token, pendingSpeed.v.t0);
  pendingSpeed.v = null;
}

// The `[clock]` line, attached before the pending state is applied so the run
// log records the state the window came up in AND the state it was moved to.
// `[scene] applied` and `[warp]` between them found four Phase 2 defects that
// no unit test caught; this is the third line of that kind.
attachClockLog(host.clock);
if (pendingClock.v) {
  host.setClock(pendingClock.v);
  pendingClock.v = null;
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
  // §8.2: the GPU census rides the existing 250 ms tick rather than the frame
  // loop. A14's clause means the cost of asking lands inside the instrument's
  // own reported tick time below, not hidden in the render budget.
  host.metrics.setGpu(host.gpuResources());
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
  // §8.2's soak. `PROJENGINE_SOAK=<minutes>` extends the measurement window;
  // 0 means the ordinary §4 protocol window, untouched, so a gate run and a
  // soak run cannot be confused for one another.
  const soakMs = config.soakMinutes > 0 ? config.soakMinutes * 60_000 : 0;
  const windowMs = soakMs > 0 ? soakMs : WINDOW_MS;
  const totalMs = WARMUP_MS + windowMs;

  const gpuSamples: GpuSample[] = [];
  let rebuilds = 0;
  if (soakMs > 0) {
    console.log(
      `[soak] ${config.soakMinutes} minute(s), sampling GPU resources every 30s ` +
        'and re-applying the scene every 2s',
    );
    // "With motion" is satisfied by the water layer, which redraws every frame.
    // The rebuilds are the point of THIS soak: Phase 1's compositor tears down
    // and re-creates every layer on each scene edit, and the operator now
    // triggers that with a drag. A soak that only watched a static scene
    // animate would miss the one path this phase actually introduced.
    const rebuild = window.setInterval(() => {
      host?.reapplyScene();
      rebuilds++;
    }, 2000);
    const sample = window.setInterval(() => {
      if (!host) return;
      gpuSamples.push({ atSeconds: host.metrics.elapsedSeconds, gpu: host.gpuResources() });
    }, 30_000);
    window.setTimeout(() => {
      // One sample the instant the window opens, so drift is measured from the
      // first POST-WARMUP state and not from a renderer that is still warming.
      if (host) {
        gpuSamples.push({ atSeconds: host.metrics.elapsedSeconds, gpu: host.gpuResources() });
      }
    }, WARMUP_MS + 50);
    window.setTimeout(() => {
      window.clearInterval(rebuild);
      window.clearInterval(sample);
      if (host) {
        gpuSamples.push({ atSeconds: host.metrics.elapsedSeconds, gpu: host.gpuResources() });
      }
    }, totalMs - 200);
  }
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
      // Informational, never a gate (A10 stands: M2 reads p99). Both
      // percentiles sit pinned at exactly two 0.1 ms timer quanta on a light
      // scene, so they cannot resolve a sub-quantum change — which is what
      // Gate 2's "frame-time cost of the warp stage" asks for.
      renderMeanMs: r.renderMeanMs,
      renderMeanOfNominal: r.renderMeanOfNominal,
      instrument: r.instrument,
      scale: r.scale,
      k,
      soak: soakMs > 0 ? judgeSoak(gpuSamples, rebuilds) : null,
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
