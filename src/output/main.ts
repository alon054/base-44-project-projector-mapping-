/**
 * Output window: the authoritative renderer (I-7). Full DEV_RESOLUTION, HUD
 * available but off by default (C4), cursor hidden by CSS.
 */
import {
  DEV_RESOLUTION,
  PARAM_TEST_PATTERN_SPEED,
  TARGET_RESOLUTION,
  canonicalizeOutputKeyPress,
  outputShortcutFor,
  type KReport,
  type OutputConfig,
  type OutputShortcutAction,
  type ProvocationSpec,
  type ProvocationVerdict,
} from '@shared/ipc';
import { WARMUP_MS, WINDOW_MS, Hud, formatReport, passesHeadroom, passesPresentation } from '../debug/hud';
import { createRenderHost } from '../render/host';
import { canonicalizeClockTransport } from '../core/clock';
import { attachClockLog } from '../debug/clockLog';
import { CLOCK_CALL_BUDGET_MS } from '../debug/clock-source';
import { attachForceLog } from '../debug/forceLog';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import {
  canonicalizeCalibration,
  calibrationFor,
  canonicalizeCalibrationFile,
  createCalibration,
  type ViewportCalibration,
} from '../render/calibration';
import { createOutputs, primaryViewport } from '../render/outputs';
import { canonicalizeScene, deepEqual, layersInDrawOrder, type Scene } from '../core/scene';
import { sceneById } from '../core/defaultScene';
import { capBreachMessage, sceneCapBreaches } from '../core/library';
import { createBundledLibrary } from '../providers/bundled/manifest';
import { describeSoak, judgeSoak, type GpuSample } from '../debug/gpu';

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
  sceneId: '',
  transportExercise: false,
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
/** The scene currently on the wall, for the identical-apply check below. */
let appliedScene: Scene | null = null;
/** I-4's `[force]` line. Null until the host exists — see `attachForceLog`. */
let forceLog: ReturnType<typeof attachForceLog> | null = null;
/** For the §10 caps check: which kind each layer's asset is. */
const bundledLibrary = createBundledLibrary();
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
  // An IDENTICAL scene is not applied twice (I-12: deep-equal state IS the
  // same state). At launch the output applies the run's named scene from its
  // config and the editor then sends the same scene a moment later; each
  // `setScene` rebuilds the whole layer stack, which for a video layer means
  // destroying and re-creating a decoder. The run log showed the second
  // rebuild as a duplicate `[video] backdrop: poster` line.
  //
  // This is NOT an optimisation of the rebuild path — that path is measured
  // (184 rebuilds, texture bytes flat at +0.00%) and deliberately left alone.
  // It is declining to rebuild for a scene that did not change.
  if (appliedScene && deepEqual(appliedScene, scene)) return;
  appliedScene = scene;
  host.setScene(scene);
  reportFailures();
  // Operator-paced, not per-frame, so it costs nothing on the render thread.
  // Without it, "the editor changed something and the wall did not" is
  // unanswerable from the wall — exactly the class of question A12 and A3
  // exist to make answerable rather than arguable.
  // §10 row 2. A cap nobody can see breached is a cap nobody will notice
  // breaching — the same reasoning behind `[scene]`, `[warp]` and `[clock]`,
  // which between them found eleven of this project's thirteen defects.
  //
  // The OPERATOR-facing half of this landed in P5-F: the editor's layer panel
  // shows the same breaches, from the same function and the same sentence, so
  // the wall's log and the operator's warning cannot come to differ about what
  // a breach is or what it costs. Both are a warning and neither is a refusal
  // — see `core/library.ts` for the measurement that decided that.
  for (const b of sceneCapBreaches(scene.layers, bundledLibrary)) {
    console.warn(`[caps] ${capBreachMessage(b)}`);
  }

  console.log(
    `[scene] applied "${scene.id}" draw order: ` +
      layersInDrawOrder(scene)
        .map((l) => `${l.id}(z${l.zOrder}${l.visible ? '' : ',hidden'})`)
        .join(' -> '),
  );
  // I-4. Emitted after `[scene]`, so a run log reads "this scene, then these
  // forces on it" in the order an operator would ask the two questions.
  forceLog?.note(scene);
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
  // §4: a run happens "at the phase's stated layer load". An unattended run
  // names the scene; the editor opens on the same one, so the two windows agree
  // without this window learning to ignore scene messages.
  if (c.sceneId !== '') {
    const named = sceneById(c.sceneId);
    if (named) applyScene(named);
    // I-13: an unknown id keeps the current scene and says so, rather than
    // opening black. A measurement on a black screen is the kind of number
    // that looks excellent and means nothing.
    else console.warn(`[output] unknown PROJENGINE_SCENE "${c.sceneId}" — keeping current scene`);
  }
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
/** Whether the output window had focus the instant §4's window opened. */
let focusHeldAtWindowOpen = false;
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
  // §5 / A2: the OUTPUT window is the only thing that decodes video. The
  // preview shows posters — see `VideoView.ts`.
  decodeVideo: true,
  // Full size here; the preview caps its own (§5, "Lottie runs in the preview,
  // at reduced size, capped").
  lottieResolution: 512,
  // I-13 made readable. `[scene] applied` and `[warp]` between them found four
  // Phase 2 defects that no unit test caught; a video's fallback chain is
  // exactly the kind of thing that is invisible until it is printed, because
  // "poster" and "playing" look similar for the first frame and identical in a
  // screenshot of a still moment.
  onVideoStage: (layerId, stage, detail) => {
    console.log(`[video] ${layerId}: ${stage} — ${detail}`);
  },
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
// I-4 made readable, and built before it was needed rather than at the gate —
// see `debug/forceLog.ts` on why Phase 4's named failure mode is a force whose
// effect nobody can see. Force values live in scene state, so this is fed from
// `applyScene` like `[scene]` itself and never touches the render path (A14).
forceLog = attachForceLog(FORCE_DEFINITIONS);
if (appliedScene) forceLog.note(appliedScene);
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

/**
 * How long a measurement run settles before the COLD probe (A1/A8, Phase 3).
 *
 * 20 seconds, which is twice §4's discarded warmup and not a coincidence: the
 * probe has to see the scene the §4 window will see, and Phase 3's scene takes
 * real time to become itself — a video decoder starting, two sprite sheets
 * decoding, a Lottie player arriving on its own chunk. Probing before that
 * measured a lighter composite and reported it as a 50% thermal derate.
 *
 * It is deliberately NOT `WARMUP_MS`: that constant is §4's, it belongs to the
 * measurement window, and reusing it here would make a later change to one
 * silently change the other.
 */
const SETTLE_MS = 20_000;

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
  // A1's thermal derate. Filled in by the cold probe below, before the §4
  // window opens; read by the summary at the end of the run.
  let coldK: KReport | null = null;
  let coldProbeAt = 0;

  const soakMs = config.soakMinutes > 0 ? config.soakMinutes * 60_000 : 0;
  const windowMs = soakMs > 0 ? soakMs : WINDOW_MS;
  const totalMs = WARMUP_MS + windowMs;

  const gpuSamples: GpuSample[] = [];
  let rebuilds = 0;
  /** Set when soaking; called once the §4 window actually opens. */
  let startSoakTimers: (() => void) | null = null;
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
    // Started when the WINDOW opens, not at t=0 — otherwise the settling
    // period and the cold probe would each eat rebuilds that the soak's own
    // count then claims happened inside the measured window.
    let rebuild = 0;
    let sample = 0;
    startSoakTimers = (): void => {
      rebuild = window.setInterval(() => {
        host?.reapplyScene();
        rebuilds++;
      }, 2000);
      sample = window.setInterval(() => {
        if (!host) return;
        gpuSamples.push({ atSeconds: host.metrics.elapsedSeconds, gpu: host.gpuResources() });
      }, 30_000);
      window.setTimeout(() => {
        // One sample the instant the window opens, so drift is measured from
        // the first POST-WARMUP state and not from a renderer still warming.
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
    };
  }
  console.log(
    `[run] START label=${label} warmupMs=${WARMUP_MS} windowMs=${windowMs} ` +
      `cues=[${cues.join(',')}] — settling, then cold probe, then the window`,
  );

  // ---------------------------------------------------------------------------
  // A1's thermal derate: k at ~minute 1 and again ~20 minutes later, in ONE
  // CONTINUOUS RUN. Shape: settle -> COLD PROBE -> §4 window -> WARM PROBE.
  //
  // **The cold probe runs AFTER a settling period, not at t=0.** The first
  // version probed immediately and reported k_dev roughly TWICE the warm
  // figure on three consecutive runs — 107.6/73.8, 68.9/56.8, 143.9/70.4. No
  // thermal effect halves a fanless M4's throughput in 71 seconds at a
  // measured render cost of 0.06 ms/frame. What it was actually measuring is
  // that at t=0 the scene is not there yet: the video is still on its poster,
  // the sprite sheets and the Lottie player are still loading, and the probe
  // was timing a lighter composite than the one the warm probe would see. A
  // "derate" of 50% was the scene finishing loading.
  //
  // That is exactly the hazard §4's warmup exists for, and the fix is to put
  // the probe on the far side of it.
  //
  // The window then restarts after the probe, which §4 already sanctions —
  // `host.probe()` calls `metrics.reset()` because the probe saturates the GPU
  // by design, and a gate window must not carry the hitch its own instrument
  // caused. The RUN stays continuous, which is what A1 asks for.
  // ---------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // THE TRANSPORT EXERCISE. `PROJENGINE_TRANSPORT=1`.
  //
  // Runs inside the settle period, before the cold probe and long before §4's
  // window, so it perturbs no gate number. It exists because re-reading a stale
  // checklist note turned up something worse than the note: **the clock had
  // never been paused in any run this project has ever taken.** Every log in
  // `measurements/` held exactly one `[clock]` line — `PLAYING`, at startup.
  //
  // So `VideoView`'s `el.pause()` branch had never executed in a live process.
  // The unit suite covers the clock thoroughly and the goldens render with
  // `playing: false`, but the goldens also run with `decodeVideo: false`, so
  // between them nothing had ever checked that a decoder obeys the clock. That
  // is Phase 1's "a scene that could not demonstrate the invariant" and Phase
  // 2's "a control that could not be operated", arriving a third time.
  //
  // This does NOT replace the wall observation — a person still has to see the
  // freeze. What it does is make the code path run, and leave `[clock]` and
  // `[video]` lines saying what happened, so a failure is findable from a log
  // rather than only from someone's memory of a projection.
  // -------------------------------------------------------------------------
  if (config.transportExercise && host) {
    const h = host;
    const step = (atMs: number, what: string, act: () => void): void => {
      window.setTimeout(() => {
        console.log(`[transport] ${what}`);
        act();
      }, atMs);
    };
    step(1500, 'PAUSE — every clock-driven layer must freeze, decoder included', () =>
      h.clock.pause(),
    );
    step(4000, 'SCRUB to 7.300s while paused — loops must land where the arithmetic says', () =>
      h.clock.scrubToSeconds(7.3),
    );
    step(6000, 'RESUME', () => h.clock.play());
    step(8000, 'RATE 0 — a held frame without leaving the playing state', () => h.clock.setRate(0));
    step(10_000, 'RATE 1 — back to normal', () => h.clock.setRate(1));
    step(12_000, 'SCRUB to 0 while playing — video must re-sync at its NEXT boundary', () =>
      h.clock.scrubToSeconds(0),
    );
    step(15_000, 'transport exercise complete; settling before the cold probe', () => {});
  }

  // Focus is asked for HERE, at the start of the settle, not at window open.
  // Asking at window open and reading the answer in the same tick reads the
  // state before the request has taken effect; asking 20+ seconds early means
  // the answer at window open is settled fact. It is asked for again at window
  // open, so a lapse in between is corrected rather than merely noticed.
  window.engine.focusOutput();

  host?.metrics.reset();
  window.setTimeout(() => {
    if (host) {
      coldProbeAt = Date.now();
      coldK = host.probe('dev-first');
      console.log(
        `[run] PROBE cold (post-settle) ` +
          `k_dev=${coldK.dev.toFixed(2)} (${coldK.devMin.toFixed(2)}-${coldK.devMax.toFixed(2)}, ` +
          `spread ${(coldK.devSpread * 100).toFixed(1)}%) ` +
          `k_target=${coldK.target.toFixed(2)} (${coldK.targetMin.toFixed(2)}-${coldK.targetMax.toFixed(2)}) ` +
          `ratio=${coldK.ratio.toFixed(4)} subject=${coldK.subject} ` +
          `repeats=${coldK.repeats} discarded=${coldK.discarded}`,
      );
    }
    // The window opens here, with its own §4 warmup ahead of it, so the
    // probe's hitch is discarded rather than measured.
    host?.metrics.reset();
    console.log(`[run] WINDOW open — ends in ${(totalMs / 1000).toFixed(0)}s`);
    scheduleWindow();
  }, SETTLE_MS);

  function scheduleWindow(): void {
  startSoakTimers?.();

  // -------------------------------------------------------------------------
  // ASSERT focus for the measured window rather than observing it.
  //
  // Carried out of Gate 2. `disturbed` was computed only from `focus LOST`
  // events, so a run that STARTED without focus and gained it partway through
  // recorded `focus gained` (not disturbing) and reported `disturbed=false` —
  // a run measured half in the background, presented as clean. Two runs were
  // lost to that before it was understood.
  //
  // Focus is taken here and its state at window-open is recorded. The verdict
  // below is "was focus held for the whole window", which is the question, and
  // it is false for the gained case as well as the lost one.
  // -------------------------------------------------------------------------
  // Main raises the window; a renderer's own `window.focus()` does not.
  window.engine.focusOutput();
  // `document.hasFocus()` rather than the `focusIsLost` flag: the flag is
  // maintained by events, and at this instant the request above may not have
  // produced one yet. This is the live answer.
  //
  // Recorded as INFORMATION, not as a verdict. See the disturbance rule in the
  // summary below for why possession of DOM focus is the wrong question in a
  // two-window app.
  focusHeldAtWindowOpen = document.hasFocus();
  if (!focusHeldAtWindowOpen) {
    console.log(
      '[run] window opened without DOM focus (the editor window likely holds it). ' +
        'Not a disturbance on its own — the presentation rate below is what decides.',
    );
  }

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
    // The warm probe. Order ALTERNATED against the cold one, so the derate is
    // not a comparison between a dev-first number and a dev-first number that
    // happened to share the same first-mover advantage.
    const k = host.probe('target-first');
    console.log(
      `[run] PROBE warm +${((Date.now() - coldProbeAt) / 1000).toFixed(0)}s ` +
        `k_dev=${k.dev.toFixed(2)} (${k.devMin.toFixed(2)}-${k.devMax.toFixed(2)}, ` +
        `spread ${(k.devSpread * 100).toFixed(1)}%) ` +
        `k_target=${k.target.toFixed(2)} (${k.targetMin.toFixed(2)}-${k.targetMax.toFixed(2)}) ` +
        `ratio=${k.ratio.toFixed(4)} subject=${k.subject} repeats=${k.repeats}`,
    );
    const disturbing = runEvents.filter((e) => e.disturbing && e.t >= 0);
    // ---------------------------------------------------------------------
    // WHAT COUNTS AS A DISTURBANCE — corrected, with the evidence.
    //
    // Gate 2 carried forward a real defect: `disturbed` watched only for focus
    // being LOST, so a run that started in the background and GAINED focus
    // mid-window reported clean. The fix for that was to require focus to be
    // HELD for the whole window — and that over-corrected into a different
    // wrong answer.
    //
    // This app has two windows. The OUTPUT window is frameless and fullscreen
    // on the projector; the EDITOR is where a person types. Only one can hold
    // DOM focus, and it is normally the editor — during a show, and during
    // every measurement run where the editor happens to be frontmost. Under
    // the over-corrected rule the output window could essentially never
    // produce a gate run, which is not a stricter gate, it is a broken one.
    //
    // Two runs made the case unarguable: both reported `focusAtWindowOpen:
    // false` with ZERO focus events in the window, and both presented at
    // 60.0005 / 59.9995 fps across 3601 samples with 0.0000% late. Chromium
    // throttles a genuinely backgrounded window to about 1 Hz. These windows
    // were not backgrounded; they simply did not hold the keyboard.
    //
    // So the question is STABILITY and THROUGHPUT, not possession:
    //   - any focus change inside the window (either direction) — the state
    //     was not stable, which is the Gate 2 defect properly stated;
    //   - visibility going hidden — the real backgrounding signal;
    //   - the presentation rate departing from the display's nominal — the
    //     PHYSICAL test, which no focus bookkeeping can fool.
    // ---------------------------------------------------------------------
    const focusChangedInWindow = runEvents.some(
      (e) => e.t >= 0 && (e.what === 'focus LOST' || e.what === 'focus gained'),
    );
    // A throttled window cannot hit its display's rate. 5% is far wider than
    // any scheduling jitter and far narrower than throttling, which is orders
    // of magnitude.
    const nominalFps = r.nominalMs > 0 ? 1000 / r.nominalMs : 0;
    const throttled =
      r.valid && nominalFps > 0 && Math.abs(r.fps - nominalFps) / nominalFps > 0.05;
    const focusHeld = focusHeldAtWindowOpen && !focusChangedInWindow;
    const summary = {
      label,
      disturbed: disturbing.length > 0 || focusChangedInWindow || throttled,
      /**
       * Reported separately, and NOT part of the verdict — see the rule above.
       * `focusHeld` false with no focus events and a nominal frame rate means
       * the editor window held the keyboard, which is the ordinary case.
       */
      focusHeld,
      focusAtWindowOpen: focusHeldAtWindowOpen,
      focusChangedInWindow,
      /** The physical backgrounding test: did it present at the display's rate? */
      throttled,
      nominalFps,
      nominalMs: r.nominalMs,
      valid: r.valid,
      samples: r.samples,
      fps: r.fps,
      m1Pass: passesPresentation(r),
      lateFraction: r.lateFraction,
      worstLateRun: r.worstLateRun,
      worstIntervalMs: r.worstIntervalMs,
      // How much of the run the windowed figures above describe. On a soak
      // that is 60 seconds out of 1200, and saying so is the difference
      // between a summary and a misleading one.
      coveredSeconds: r.coveredSeconds,
      clause3: r.magnitudeEvents,
      clause3Total: r.magnitudeEventsLifetime,
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
      /**
       * A1's thermal derate. Null when only one probe ran (a run shorter than
       * the window the derate is defined over).
       *
       * `meaningful` is the part that stops this being a number that looks
       * like a measurement. The derate is a DELTA between two draws from a
       * distribution whose own width the probe now reports, so a delta smaller
       * than that width is noise wearing a decimal point. §4's own reasoning
       * for narrowing A1 to Phases 3 and 9 was exactly this.
       */
      derate: coldK
        ? {
            coldK,
            warmK: k,
            // Real seconds BETWEEN the two probes, which is what A1's
            // "minute 1 to minute 20" actually measures. Reported rather than
            // assumed, so a run that was cut short cannot be read as 20 minutes.
            secondsBetweenProbes: (Date.now() - coldProbeAt) / 1000,
            devDelta: k.dev - coldK.dev,
            devDeltaFraction: coldK.dev > 0 ? (k.dev - coldK.dev) / coldK.dev : 0,
            targetDelta: k.target - coldK.target,
            targetDeltaFraction: coldK.target > 0 ? (k.target - coldK.target) / coldK.target : 0,
            probeSpread: Math.max(coldK.devSpread, k.devSpread),
            meaningful:
              coldK.dev > 0 &&
              Math.abs((k.dev - coldK.dev) / coldK.dev) > Math.max(coldK.devSpread, k.devSpread),
          }
        : null,
      soak: soakMs > 0 ? judgeSoak(gpuSamples, rebuilds) : null,
      events: runEvents,
      // The conditions the run actually ran in, so no later reader has to
      // reconstruct them with `defaults read` after the fact.
      conditions: config.conditions,
      provocations: provocationVerdicts,
    };
    console.log('[run] SUMMARY ' + JSON.stringify(summary));
    // §10 row 13: the soak's numbers in the log, in words, with both terms of
    // every pair. The SUMMARY JSON has carried them all along, and for four
    // gates nobody read them out of it — which is how a `flat: false` over a
    // miscounted quantity survived that long. A verdict that has to be
    // extracted with a JSON parser is a verdict nobody checks.
    if (summary.soak !== null) console.log(describeSoak(summary.soak));
    console.log(`[run] END label=${label} disturbed=${summary.disturbed}`);
    window.engine.measureDone();
  }, totalMs + 500);
  }
}

/**
 * P5-E. What each shortcut DOES, once — and the only place it is written.
 *
 * Typed as `Record<OutputShortcutAction, ...>`, so adding a row to
 * `OUTPUT_SHORTCUTS` in `electron/ipc.ts` fails to compile here until this
 * object grows a handler for it. That is what makes "a key added in one path
 * cannot be missing from the other" a property of the build rather than of
 * someone remembering.
 *
 * Both entry points below funnel through `runShortcut`: the window's own
 * keydown, and the editor's forwarded key press. They cannot drift because
 * there is nothing for them to drift between — the dispatch is shared and only
 * the arrival differs.
 */
const SHORTCUT_HANDLERS: Record<OutputShortcutAction, () => void> = {
  // I-11: the HUD stays available. It starts hidden so it is never burned into
  // a live projection.
  hud: () => {
    const v = hud.toggle();
    window.engine.setHudState(v);
    console.log(`[hud] ${v ? 'shown' : 'hidden'}`);
  },
  resetMetrics: () => {
    host?.metrics.reset();
    console.log('[hud] metrics window reset — warmup restarts');
  },
  // A8: k_dev / k_target. On demand only — the probe saturates the GPU and
  // would corrupt the gate window it sits beside, so it resets that window.
  probeK: () => {
    if (!host) return;
    const k = host.probe();
    console.log(
      `[k] k_dev=${k.dev.toFixed(2)}x (${k.devMs.toFixed(3)} ms/render @${DEV_RESOLUTION.width}x${DEV_RESOLUTION.height})  ` +
        `k_target=${k.target.toFixed(2)}x (${k.targetMs.toFixed(3)} ms/render @${TARGET_RESOLUTION.width}x${TARGET_RESOLUTION.height})  ` +
        `fill-rate coefficient=${k.ratio.toFixed(3)}  iterations=${k.iterations}  ` +
        '(metrics window reset — probe hitch excluded)',
    );
  },
};

function runShortcut(action: OutputShortcutAction): void {
  SHORTCUT_HANDLERS[action]();
}

// The output window's own keys. Still here, unchanged in behaviour: P5-E's
// forwarding is ADDITIVE, and a focused projector display must keep working
// the way four gates of measurement runs have used it.
window.addEventListener('keydown', (e) => {
  const shortcut = outputShortcutFor(e.key);
  if (!shortcut) return;
  runShortcut(shortcut.action);
});

/**
 * P5-E. The same keys, pressed from the editor window.
 *
 * The operator never has to click the projector display, where `cursor: none`
 * makes the pointer invisible and a stray click can steal focus from the
 * window a measurement run is watching.
 *
 * An unrecognised key is refused and NAMED rather than ignored — see
 * `canonicalizeOutputKeyPress`. Ignoring it would leave an operator pressing a
 * key that this build cannot do anything with and no line anywhere saying so.
 */
window.engine.onOutputKey((payload) => {
  let press;
  try {
    press = canonicalizeOutputKeyPress(payload);
  } catch (err) {
    console.warn(`[key] refused a forwarded key press: ${(err as Error).message}`);
    return;
  }
  // Non-null by construction: canonicalize refuses anything not in the table.
  const shortcut = outputShortcutFor(press.key)!;
  console.log(`[key] '${press.key}' forwarded from the editor — ${shortcut.label}`);
  runShortcut(shortcut.action);
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

/**
 * 1.8 — a smoke run that verifies the instrument clock and does NOT care about
 * focus.
 *
 * Three runs have been discarded for lost focus in three sessions, and the last
 * one died at t = 58.87 s of 60 — 1.1 seconds from the end, having already
 * printed the only line it was taken for. That is a minute of the operator's
 * hands-off time spent to obtain a string that was available at startup.
 *
 * `[timer]` is emitted by `createRenderHost` before any measurement window
 * opens, and nothing about it depends on which window is frontmost: it is a
 * property of the preload the renderer was given. So a run that only needs to
 * confirm the clock has no reason to open a §4 window, and therefore has no
 * `disturbed` concept to fail on.
 *
 * **The real §4 runs are deliberately untouched.** There, discarding on focus
 * loss is correct and stays correct — last session's discarded run landed
 * within 0.4% of its clean re-take, and today's landed within 6.8%, which is
 * the argument FOR the rule rather than against it: a run that agrees with
 * expectation is exactly the one that gets waved through. This adds a path for
 * the question that never needed the window; it does not soften the one that
 * does.
 *
 * Reserved label, following `probe-only`'s precedent rather than adding a
 * second mechanism for reserved labels.
 */
if (config.measureLabel === 'clock-only') {
  const cs = host.clockSource;
  const budgetShare = cs.callCostMs / CLOCK_CALL_BUDGET_MS;
  // A9: print the values, and state the verdict as a consequence of them.
  console.log(
    `[clock] source=${cs.source}  resolution=${cs.resolutionMs.toFixed(6)}ms  ` +
      `callCost=${cs.callCostMs.toFixed(6)}ms  ` +
      `budget=${CLOCK_CALL_BUDGET_MS}ms (${(budgetShare * 100).toFixed(1)}% of it)  ` +
      `coarserThanSubject=${String(cs.coarserThanSubject)}` +
      (cs.rejectedBecause === '' ? '' : `  rejected=${cs.rejectedBecause}`),
  );
  const ok = cs.source === 'hrtime' && !cs.coarserThanSubject && budgetShare <= 1;
  console.log(
    `[clock] VERDICT ${ok ? 'PASS' : 'FAIL'} — focus-independent, no measurement window opened`,
  );
  window.engine.measureDone();
}

// Kick off the unattended run last, so every listener, the HUD and the focus
// trail are already live when the window opens (SPEC.md §4).
if (
  config.measureLabel !== '' &&
  config.measureLabel !== 'probe-only' &&
  config.measureLabel !== 'clock-only' &&
  config.measureLabel !== 'latency'
) {
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
