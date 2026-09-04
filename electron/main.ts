/**
 * Lifecycle: creates the editor and output windows, owns display selection,
 * relays typed JSON IPC between them (I-7). No rendering happens here.
 */
import {
  BrowserWindow,
  app,
  ipcMain,
  powerSaveBlocker,
  screen,
  type IpcMainEvent,
} from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  CH,
  DEV_RESOLUTION,
  assertJsonOnly,
  type DisplayInfo,
  type MetricsReport,
  type OutputConfig,
  type ParamAck,
  type ParamSet,
  type ProvocationKind,
  type ProvocationSpec,
  type RunConditions,
  type SceneFailure,
  type CalibrationSet,
  type SceneSet,
} from './ipc';
import { fingerprint, loadSettings, pickOutputDisplay, saveSettings } from './config';
import { calibrationFilePath, loadCalibrationRaw, saveCalibrationRaw } from './calibration';

const DEV_URL = process.env['VITE_DEV_SERVER_URL'];

/**
 * Unattended measurement run (SPEC.md §4). Set `PROJENGINE_MEASURE=<label>` to
 * make the app run one full protocol window by itself and quit. This exists
 * because a run driven by a human pressing keys cannot be repeated identically,
 * and because a run disturbed halfway must be discarded rather than reported
 * with a caveat — which requires the app to notice the disturbance itself.
 */
const MEASURE_LABEL = process.env['PROJENGINE_MEASURE'] ?? '';
/**
 * §8.2's "texture memory flat over a 5-minute soak with motion".
 * `PROJENGINE_SOAK=<minutes>` extends the measurement window; unset or 0 leaves
 * §4's protocol window exactly as it was.
 */
const MEASURE_SOAK_MINUTES = Math.max(0, Number(process.env['PROJENGINE_SOAK'] ?? '0') || 0);
const MEASURE_CUES = (process.env['PROJENGINE_CUES'] ?? '')
  .split(',')
  .map((x) => Number(x.trim()))
  .filter((x) => Number.isFinite(x) && x > 0);

const PROVOCATION_KINDS: readonly ProvocationKind[] = [
  'hide',
  'apphide',
  'mc',
  'mcvisible',
  'hidethrottled',
  'mcthrottled',
];

/**
 * Unattended provocations, `kind@postWarmupSeconds`, comma separated. An
 * attribution run drives real OS events from the harness so that neither the
 * timing nor the observation depends on a human — run5-mc failed as an
 * experiment on exactly those two counts.
 */
const MEASURE_PROVOKE: ProvocationSpec[] = (process.env['PROJENGINE_PROVOKE'] ?? '')
  .split(',')
  .map((tok) => tok.trim())
  .filter((tok) => tok !== '')
  .map((tok) => {
    const [kind, at] = tok.split('@');
    return { kind: kind as ProvocationKind, atSeconds: Number(at) };
  })
  .filter(
    (p) =>
      PROVOCATION_KINDS.includes(p.kind) && Number.isFinite(p.atSeconds) && p.atSeconds > 0,
  );

/** How long each provocation holds the machine in the provoked state. */
const PROVOKE_HOLD_MS = 2000;

// ---------------------------------------------------------------------------
// ADD-2: uncapped measurement mode. Chromium switches must be appended before
// the app is ready, so this is decided from persisted settings (or an env
// override) at process start and changing it requires a relaunch.
// Whether these switches still do anything in Electron 44 is verified
// empirically at runtime by comparing observed fps against displayFrequency.
// ---------------------------------------------------------------------------
const uncappedRequested =
  process.env['PROJENGINE_UNCAPPED'] === '1' || readMeasurementModeFromDisk();

if (uncappedRequested) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}

function readMeasurementModeFromDisk(): boolean {
  // loadSettings() needs `app`, which is available for paths before ready.
  try {
    return loadSettings().measurementMode;
  } catch {
    return false;
  }
}

let editorWin: BrowserWindow | null = null;
let outputWin: BrowserWindow | null = null;
let blockerId: number | null = null;
/**
 * Signature of the display the output window is currently built for. Reopening
 * the window itself provokes `display-metrics-changed`, so without this the
 * handler re-enters and tears down a live output for no reason.
 */
let outputSignature: string | null = null;
/** The display the output window is currently on, so a renderer can pull config. */
let currentDisplay: Electron.Display | null = null;
let displayDebounce: NodeJS.Timeout | null = null;
/** Captured once per output-window open, reported in the run summary. */
let currentConditions: RunConditions | null = null;

/**
 * macOS `Displays have separate Spaces`. The checkbox writes
 * `com.apple.spaces spans-displays`; an absent key means the setting has never
 * been touched and the macOS default (separate Spaces ON) applies. Read once,
 * in main, at window open — synchronous, but nowhere near the render thread,
 * and it is exactly the fact run5-mc's null result turned on.
 */
function readSpansDisplays(): string {
  if (process.platform !== 'darwin') return 'n/a';
  try {
    return execFileSync('defaults', ['read', 'com.apple.spaces', 'spans-displays'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // `defaults read` exits non-zero when the key does not exist.
    return 'absent';
  }
}

function signatureOf(d: Electron.Display, fullscreen: boolean): string {
  return [
    d.id,
    d.label,
    d.size.width,
    d.size.height,
    d.scaleFactor,
    d.displayFrequency,
    d.bounds.x,
    d.bounds.y,
    fullscreen,
  ].join('|');
}

// ---------------------------------------------------------------------------
// ADD-1: a screensaver mid-installation is a failure. Held for exactly as long
// as an output window exists.
// ---------------------------------------------------------------------------
function holdPowerSaveBlocker(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return;
  blockerId = powerSaveBlocker.start('prevent-display-sleep');
  console.log('[power] display sleep blocked, id', blockerId);
}

function releasePowerSaveBlocker(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
    console.log('[power] display sleep block released');
  }
  blockerId = null;
}

function rendererUrl(entry: 'editor' | 'output'): string {
  return DEV_URL
    ? `${DEV_URL}/${entry}/index.html`
    : `file://${join(app.getAppPath(), 'dist', entry, 'index.html')}`;
}

function outputConfigFor(display: Electron.Display, role: 'output' | 'preview'): OutputConfig {
  return {
    width: DEV_RESOLUTION.width,
    height: DEV_RESOLUTION.height,
    displayFrequency: display.displayFrequency,
    scaleFactor: display.scaleFactor,
    uncapped: uncappedRequested,
    role,
    // §4 requires the HUD enabled for a measurement run.
    hudVisible: MEASURE_LABEL !== '' ? true : loadSettings().hudVisible,
    measureLabel: MEASURE_LABEL,
    soakMinutes: MEASURE_SOAK_MINUTES,
    measureCues: role === 'output' ? MEASURE_CUES : [],
    provocations: role === 'output' ? MEASURE_PROVOKE : [],
    conditions: role === 'output' ? currentConditions : null,
  };
}

/**
 * I-13: a renderer that fails must say so somewhere a human will see it. Without
 * this, a broken preload looks identical to a quiet app.
 */
function forwardConsole(win: BrowserWindow, tag: string): void {
  win.webContents.on('console-message', (e) => {
    const level = e.level === 'error' || e.level === 'warning' ? e.level : 'log';
    console.log(`[${tag}:${level}] ${e.message}${e.lineNumber ? ` (${e.sourceId}:${e.lineNumber})` : ''}`);
  });
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[${tag}] PRELOAD FAILED ${preloadPath}:`, error);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[${tag}] render process gone:`, details.reason);
  });
}

function send(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, assertJsonOnly(payload));
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function createEditorWindow(): void {
  const saved = loadSettings().editorBounds;
  editorWin = new BrowserWindow({
    width: saved?.width ?? 1180,
    height: saved?.height ?? 820,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    title: 'Projection Engine — Editor',
    backgroundColor: '#111214',
    // Electron 44's own persistence is deliberately off; config/ is the single
    // source of truth for window state.
    windowStatePersistence: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  editorWin.on('close', () => {
    if (editorWin && !editorWin.isDestroyed()) {
      const b = editorWin.getBounds();
      saveSettings({ editorBounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
    }
  });
  editorWin.on('closed', () => {
    editorWin = null;
  });

  forwardConsole(editorWin, 'editor');
  void editorWin.loadURL(rendererUrl('editor'));
}

function openOutputWindow(why: string): void {
  console.log(`[trace] openOutputWindow(${why}) windows=${BrowserWindow.getAllWindows().length}`);
  if (outputWin && !outputWin.isDestroyed()) {
    outputWin.destroy();
    outputWin = null;
  }

  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const pick = pickOutputDisplay(displays, primaryId, loadSettings().outputDisplay);

  if (!pick.display) {
    send(editorWin, CH.warning, {
      level: 'error',
      text: 'No display available for output.',
    });
    return;
  }

  const d = pick.display;
  // C6 / Gate 0: never enter fullscreen on the primary or internal display
  // without explicit confirmation. A cursorless frameless fullscreen window on
  // the only monitor is how you lock up a machine, so the fallback is a FRAMED
  // window carrying a visible warning.
  const goFullscreen = !pick.needsConfirmation;

  // A13: "via pinned" vs "via heuristic" is the line that distinguishes a real
  // persistence test from an exercise of the auto-picker. Do not merge them.
  const how = pick.pinned
    ? `PINNED (${pick.reason})`
    : pick.stalePin
      ? `HEURISTIC after STALE PIN (${pick.reason})`
      : `HEURISTIC, no pin stored (${pick.reason})`;

  outputWin = new BrowserWindow({
    x: d.bounds.x + (goFullscreen ? 0 : 40),
    y: d.bounds.y + (goFullscreen ? 0 : 40),
    width: goFullscreen ? d.bounds.width : DEV_RESOLUTION.width,
    height: goFullscreen ? d.bounds.height : DEV_RESOLUTION.height,
    frame: !goFullscreen,
    title: 'Projection Engine — OUTPUT (not fullscreen: unconfirmed display)',
    backgroundColor: '#000000',
    hasShadow: false,
    // macOS: pre-Lion fullscreen. Native fullscreen moves the window to its own
    // Space, animates, and steals focus — all wrong for a projector.
    ...(process.platform === 'darwin' ? { simpleFullscreen: goFullscreen } : {}),
    fullscreen: process.platform === 'darwin' ? false : goFullscreen,
    hiddenInMissionControl: true,
    windowStatePersistence: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  if (goFullscreen && process.platform === 'darwin') {
    outputWin.setSimpleFullScreen(true);
  }

  // An unattended run must own the keyboard focus it is measuring under,
  // otherwise "was this run disturbed?" is unanswerable from the log.
  if (MEASURE_LABEL !== '') outputWin.focus();

  const win = outputWin;
  win.webContents.once('did-finish-load', () => {
    send(win, CH.outputConfig, outputConfigFor(d, 'output'));
    // The output window can open, close and reopen under the operator (a
    // display re-select, I-13's "reopens on the next available display"). It
    // must come back showing the scene the editor is holding, not the built-in
    // default, so main keeps the last scene and replays it here. Main does not
    // interpret the scene; it is an opaque JSON blob on this path.
    if (lastScene !== null) send(win, CH.sceneSet, lastScene);
    if (!goFullscreen) {
      send(win, CH.warning, {
        level: 'warn',
        text: pick.stalePin
          ? `PINNED DISPLAY NOT FOUND. Falling back to "${d.label}" FRAMED, not fullscreen ` +
            '(A13: a pin is never silently retargeted). Re-pick the projector in the editor.'
          : `Output is on ${d.internal ? 'the internal' : 'the primary'} display ` +
            `("${d.label}"). Not entering fullscreen without confirmation — ` +
            `pick the projector in the editor, or confirm this display.`,
      });
    }
    send(editorWin, CH.outputConfig, outputConfigFor(d, 'preview'));
    send(editorWin, CH.warning, {
      level: goFullscreen ? 'info' : 'warn',
      text: `Output on "${d.label}" (${d.size.width}x${d.size.height} @ ${d.displayFrequency}Hz, ` +
        `scale ${d.scaleFactor}) via ${how}${goFullscreen ? ', fullscreen' : ', FRAMED — unconfirmed'}.`,
    });
  });

  win.on('closed', () => {
    if (outputWin === win) {
      outputWin = null;
      outputSignature = null;
    }
    if (!outputWin) releasePowerSaveBlocker();
  });

  // A12 attribution: the main-process half of the same correlation trail. A
  // stall at t=131s is only attributable if something else is timestamped too.
  const logWinEvent = (ev: string): void => {
    console.log(`[event] output window ${ev} @ ${new Date().toISOString()}`);
  };
  win.on('focus', () => logWinEvent('focus'));
  win.on('blur', () => logWinEvent('blur'));
  win.on('show', () => logWinEvent('show'));
  win.on('hide', () => logWinEvent('hide'));
  win.on('minimize', () => logWinEvent('minimize'));
  win.on('restore', () => logWinEvent('restore'));

  forwardConsole(win, 'output');
  currentDisplay = d;
  outputSignature = signatureOf(d, goFullscreen);

  // Captured from the window itself rather than assumed, and before the config
  // is pushed, so the summary reports the conditions the run actually ran in.
  const spans = readSpansDisplays();
  currentConditions = {
    platform: process.platform,
    spansDisplaysRaw: spans,
    separateSpaces: process.platform === 'darwin' ? spans !== '1' : null,
    hiddenInMissionControl:
      process.platform === 'darwin' ? win.isHiddenInMissionControl() : null,
    displayCount: displays.length,
    outputDisplay: {
      id: d.id,
      label: d.label,
      width: d.size.width,
      height: d.size.height,
      scaleFactor: d.scaleFactor,
      displayFrequency: d.displayFrequency,
      internal: d.internal,
      isPrimary: d.id === primaryId,
    },
    outputFullscreen: goFullscreen,
    pin: how,
  };
  console.log(
    `[conditions] separateSpaces=${String(currentConditions.separateSpaces)} ` +
      `(spans-displays=${spans})  hiddenInMissionControl=` +
      `${String(currentConditions.hiddenInMissionControl)}  displays=${displays.length}  ` +
      `output="${d.label}" fullscreen=${goFullscreen} pin=${how}`,
  );

  holdPowerSaveBlocker();
  void win.loadURL(rendererUrl('output'));

  console.log(
    `[output] display "${d.label}" id=${d.id} ${d.size.width}x${d.size.height} ` +
      `@${d.displayFrequency}Hz scale=${d.scaleFactor} via ${how} ` +
      `fullscreen=${goFullscreen}`,
  );
}

// ---------------------------------------------------------------------------
// I-13: loss of the output display must not end the session.
// ---------------------------------------------------------------------------
function watchDisplays(): void {
  const reconcile = (why: string) => (): void => {
    if (displayDebounce) clearTimeout(displayDebounce);
    // Coalesce the burst that a single physical change produces.
    displayDebounce = setTimeout(() => {
      displayDebounce = null;
      const alive = outputWin !== null && !outputWin.isDestroyed();

      const pick = pickOutputDisplay(
        screen.getAllDisplays(),
        screen.getPrimaryDisplay().id,
        loadSettings().outputDisplay,
      );
      const next = pick.display
        ? signatureOf(pick.display, !pick.needsConfirmation)
        : null;

      if (alive && next !== null && next === outputSignature) {
        // Nothing that matters to the output changed. Leave the live window be.
        return;
      }
      console.log(`[display] ${why} — output display changed, reopening`);
      openOutputWindow(`display:${why}`);
    }, 250);
  };
  screen.on('display-added', reconcile('display-added'));
  screen.on('display-removed', reconcile('display-removed'));
  screen.on('display-metrics-changed', reconcile('display-metrics-changed'));
}

/**
 * The last scene the editor sent, replayed to an output window that opens
 * later. Held as the opaque JSON it arrived as — main is a relay on this path
 * and does not know what a Scene is (the validation boundary is the receiving
 * renderer's `canonicalizeScene`).
 */
let lastScene: SceneSet | null = null;
/**
 * I-5. Held so a reopened output window gets the live calibration rather than
 * whatever was last flushed to disk, and — the Gate 2 condition — so it
 * survives every scene change, because nothing on the scene path touches it.
 */
let lastCalibration: CalibrationSet | null = null;

// ---------------------------------------------------------------------------
// IPC relay. Every payload passes the I-7 guard on the way through.
// ---------------------------------------------------------------------------
function wireIpc(): void {
  ipcMain.on(CH.paramSet, (_e: IpcMainEvent, payload: ParamSet) => {
    send(outputWin, CH.paramSet, assertJsonOnly(payload));
  });

  ipcMain.on(CH.sceneSet, (_e: IpcMainEvent, payload: SceneSet) => {
    lastScene = assertJsonOnly(payload);
    send(outputWin, CH.sceneSet, lastScene);
  });

  /**
   * I-5. Persist first, then forward. If the write fails the operator still
   * sees the warp change on the wall — losing the *file* is recoverable, and
   * refusing to apply a calibration because a disk write failed would be the
   * wrong trade in front of an audience (I-13).
   *
   * Main does not validate the payload beyond the I-7 JSON guard. It does not
   * know what a corner is, and nothing here should teach it.
   */
  ipcMain.on(CH.calibrationSet, (_e: IpcMainEvent, payload: CalibrationSet) => {
    const cal = assertJsonOnly(payload);
    lastCalibration = cal;
    saveCalibrationRaw({ version: 1, viewports: [cal] });
    send(outputWin, CH.calibrationSet, cal);
  });

  ipcMain.handle(CH.calibrationGet, (): unknown => lastCalibration ?? loadCalibrationRaw());

  ipcMain.on(CH.sceneFailures, (_e: IpcMainEvent, payload: SceneFailure[]) => {
    send(editorWin, CH.sceneFailures, assertJsonOnly(payload));
  });

  // A11: the transport half, relayed with no frame wait anywhere in the path.
  ipcMain.on(CH.paramRecv, (_e: IpcMainEvent, payload: ParamAck) => {
    send(editorWin, CH.paramRecv, assertJsonOnly(payload));
  });

  ipcMain.on(CH.paramAck, (_e: IpcMainEvent, payload: ParamAck) => {
    send(editorWin, CH.paramAck, assertJsonOnly(payload));
  });

  ipcMain.on(CH.metrics, (_e: IpcMainEvent, payload: MetricsReport) => {
    send(editorWin, CH.metrics, assertJsonOnly(payload));
    logMetricsPeriodically(payload);
  });

  ipcMain.on(CH.hudState, (_e: IpcMainEvent, visible: boolean) => {
    // A measurement run forces the HUD on; that must not overwrite the
    // operator's stored preference for the next interactive launch.
    if (MEASURE_LABEL === '') saveSettings({ hudVisible: assertJsonOnly(visible) });
  });

  // ---------------------------------------------------------------------------
  // Unattended provocations (attribution runs only).
  //
  // Every prior attempt at cue 2 depended on a human pressing F3 at a cued
  // moment and reporting what the wall did. That made the experiment
  // unrepeatable and its null result uninterpretable. These drive the same OS
  // events from the harness, and the renderer's `visibilitychange` listener —
  // which demonstrably fires on a real surface hide — is the ground truth for
  // whether the surface actually suspended.
  // ---------------------------------------------------------------------------
  ipcMain.handle(CH.provoke, async (_e, kind: ProvocationKind): Promise<string> => {
    const note = await performProvocation(kind);
    console.log(`[provoke] ${kind}: ${note}`);
    return note;
  });

  ipcMain.on(CH.measureDone, () => {
    console.log('[run] renderer reported done; quitting');
    setTimeout(() => app.exit(0), 250);
  });

  ipcMain.handle(CH.outputConfigRequest, (e): OutputConfig | null => {
    if (!currentDisplay) return null;
    const isOutput = outputWin !== null && !outputWin.isDestroyed()
      && e.sender.id === outputWin.webContents.id;
    return assertJsonOnly(outputConfigFor(currentDisplay, isOutput ? 'output' : 'preview'));
  });

  ipcMain.handle(CH.displaysList, (): DisplayInfo[] => {
    const primaryId = screen.getPrimaryDisplay().id;
    const savedPrint = loadSettings().outputDisplay;
    const pick = pickOutputDisplay(screen.getAllDisplays(), primaryId, savedPrint);
    return assertJsonOnly(
      screen.getAllDisplays().map((d) => ({
        id: d.id,
        label: d.label,
        bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
        size: { width: d.size.width, height: d.size.height },
        scaleFactor: d.scaleFactor,
        displayFrequency: d.displayFrequency,
        internal: d.internal,
        detected: d.detected,
        isPrimary: d.id === primaryId,
        isSelected: pick.display?.id === d.id,
      })),
    );
  });

  ipcMain.handle(CH.displaysSelect, (_e, id: number): boolean => {
    const d = screen.getAllDisplays().find((x) => x.id === id);
    if (!d) return false;
    // The pin is always persisted — that is what the operator asked for.
    saveSettings({ outputDisplay: fingerprint(d) });

    // ...but re-picking the display the output is ALREADY on must not tear down
    // a live output window. Destroying and recreating it drops the frame, the
    // power-save blocker and the measurement window for no change at all. Same
    // class as the self-triggering reopen fixed in Phase 0: a live show does not
    // survive an output window that restarts whenever a control is touched.
    const alive = outputWin !== null && !outputWin.isDestroyed();
    if (alive && currentDisplay !== null && currentDisplay.id === d.id) {
      console.log(
        `[display] select "${d.label}" id=${d.id} — already the output display; ` +
          'pin persisted, live window left alone',
      );
      return true;
    }

    console.log(
      `[display] select "${d.label}" id=${d.id} — was ` +
        `${currentDisplay ? `id=${currentDisplay.id}` : 'none'}; reopening`,
    );
    openOutputWindow('displaysSelect');
    return true;
  });

  ipcMain.handle(CH.measurementMode, (_e, on: boolean): boolean => {
    saveSettings({ measurementMode: on });
    return on === uncappedRequested; // false => a relaunch is needed
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Toggle Mission Control without synthesising a keystroke. Launching
 * `Mission Control.app` is what F3 does and needs no Accessibility permission,
 * so an unattended run can drive it; launching it again dismisses it.
 */
function toggleMissionControl(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('open', ['-a', 'Mission Control'], { stdio: 'ignore' });
    child.on('error', (err) => resolve(`spawn failed: ${err.message}`));
    child.on('exit', (code) => resolve(`exit ${String(code)}`));
  });
}

/**
 * Perform one provocation and report what was done. Nothing here reopens the
 * output window: a teardown would restart the measurement, which is the defect
 * run 5 attempt 1 already found.
 */
async function performProvocation(kind: ProvocationKind): Promise<string> {
  const win = outputWin;
  if (!win || win.isDestroyed()) return 'no output window; nothing done';

  if (kind === 'hide') {
    const wasSimple = process.platform === 'darwin' ? win.isSimpleFullScreen() : false;
    win.hide();
    await delay(PROVOKE_HOLD_MS);
    win.show();
    // A hide/show that silently drops simpleFullscreen would be a live-show
    // hazard in its own right, and would also change what the intervals after
    // the resume mean. Checked, restored, and reported either way.
    if (wasSimple && !win.isSimpleFullScreen()) {
      win.setSimpleFullScreen(true);
      return `window hidden ${PROVOKE_HOLD_MS}ms; simpleFullScreen LOST across hide/show, restored`;
    }
    return `window hidden ${PROVOKE_HOLD_MS}ms; simpleFullScreen preserved (was ${String(wasSimple)})`;
  }

  // The control experiment. `backgroundThrottling: false` is set on this window
  // at creation and Electron documents that it also affects the Page Visibility
  // API, so it is the reason `hide` produced neither a `visibilitychange` nor a
  // gap. Re-enabling throttling for the duration is the only way to tell
  // "the surface cannot be suspended" apart from "we never suspended it".
  if (kind === 'hidethrottled' || kind === 'mcthrottled') {
    const wc = win.webContents;
    const restoreFlag = win.isHiddenInMissionControl();
    const wasSimple = process.platform === 'darwin' ? win.isSimpleFullScreen() : false;
    wc.setBackgroundThrottling(true);
    let what: string;
    if (kind === 'hidethrottled') {
      win.hide();
      await delay(PROVOKE_HOLD_MS);
      win.show();
      what = `window hidden ${PROVOKE_HOLD_MS}ms`;
    } else {
      // Maximally suspendable: throttling on AND the window not excluded from
      // Mission Control. If this does not suspend the surface, nothing will.
      win.setHiddenInMissionControl(false);
      const opened = await toggleMissionControl();
      await delay(PROVOKE_HOLD_MS);
      const dismissed = await toggleMissionControl();
      await delay(800);
      win.setHiddenInMissionControl(restoreFlag);
      what = `Mission Control toggled, hiddenInMissionControl=false (open ${opened}, dismiss ${dismissed})`;
    }
    wc.setBackgroundThrottling(false);
    let note = `backgroundThrottling re-enabled for the provocation; ${what}`;
    if (wasSimple && !win.isSimpleFullScreen()) {
      win.setSimpleFullScreen(true);
      note += '; simpleFullScreen LOST, restored';
    }
    return note;
  }

  if (kind === 'apphide') {
    app.hide();
    await delay(PROVOKE_HOLD_MS);
    app.show();
    return `app hidden ${PROVOKE_HOLD_MS}ms`;
  }

  // mc / mcvisible
  const restore = win.isHiddenInMissionControl();
  const clearFlag = kind === 'mcvisible';
  if (clearFlag) win.setHiddenInMissionControl(false);
  const opened = await toggleMissionControl();
  await delay(PROVOKE_HOLD_MS);
  const dismissed = await toggleMissionControl();
  // Let the dismiss animation finish before the flag goes back, so the window
  // is not mutated mid-transition.
  await delay(800);
  if (clearFlag) win.setHiddenInMissionControl(restore);
  return (
    `Mission Control toggled with hiddenInMissionControl=${String(clearFlag ? false : restore)} ` +
    `(open ${opened}, dismiss ${dismissed}); flag left at ${String(win.isHiddenInMissionControl())}`
  );
}

/**
 * Gate numbers have to reach `BUILD_LOG.md`, so they are logged to stdout on a
 * slow cadence rather than living only in the on-screen HUD.
 */
let lastMetricsLog = 0;
function logMetricsPeriodically(m: MetricsReport): void {
  const now = Date.now();
  if (now - lastMetricsLog < 10_000) return;
  lastMetricsLog = now;
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  // A9: an invalid N must never be logged as a percentage of anything.
  if (!m.valid) {
    console.log(`[metrics] INVALID — ${m.invalidReason}; no gate number can be recorded`);
    return;
  }
  console.log(
    `[metrics] ${m.warmedUp ? 'warm' : 'WARMUP'} n=${m.samples} ` +
      `fps=${m.fps.toFixed(2)} N=${m.nominalMs.toFixed(4)}ms | ` +
      `M1 late=${pct(m.lateFraction)} worstRun=${m.worstLateRun} | ` +
      `M2 renderP99=${m.renderP99Ms.toFixed(3)}ms (${pct(m.renderP99OfNominal)} of N) ` +
      `p95=${m.renderP95Ms.toFixed(3)}ms (info) | ` +
      `worstInterval=${m.worstIntervalMs.toFixed(2)}ms`,
  );
  // A12: magnitude is logged separately from rate, because it is a separate
  // fact and each event has to be attributed by hand in BUILD_LOG.md.
  for (const e of m.magnitudeEvents) {
    console.log(
      `[metrics] M1-clause-3 STALL n=${e.index} t=${e.atSeconds.toFixed(2)}s ` +
        `${e.intervalMs.toFixed(2)}ms (>${(m.nominalMs * 3).toFixed(1)}ms) — ATTRIBUTE: engine | OS | unknown`,
    );
  }
}

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  wireIpc();
  watchDisplays();
  createEditorWindow();
  openOutputWindow('whenReady');

  app.on('activate', () => {
    console.log(`[trace] activate windows=${BrowserWindow.getAllWindows().length}`);
    if (BrowserWindow.getAllWindows().length === 0) {
      createEditorWindow();
      openOutputWindow('activate');
    }
  });
});

app.on('window-all-closed', () => {
  releasePowerSaveBlocker();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', releasePowerSaveBlocker);
