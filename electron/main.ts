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
} from './ipc';
import { fingerprint, loadSettings, pickOutputDisplay, saveSettings } from './config';

const DEV_URL = process.env['VITE_DEV_SERVER_URL'];

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
    hudVisible: loadSettings().hudVisible,
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

function openOutputWindow(): void {
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

  const win = outputWin;
  win.webContents.once('did-finish-load', () => {
    send(win, CH.outputConfig, outputConfigFor(d, 'output'));
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
  holdPowerSaveBlocker();
  void win.loadURL(rendererUrl('output'));

  // A13: "via pinned" vs "via heuristic" is the line that distinguishes a real
  // persistence test from an exercise of the auto-picker. Do not merge them.
  const how = pick.pinned
    ? `PINNED (${pick.reason})`
    : pick.stalePin
      ? `HEURISTIC after STALE PIN (${pick.reason})`
      : `HEURISTIC, no pin stored (${pick.reason})`;
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
      openOutputWindow();
    }, 250);
  };
  screen.on('display-added', reconcile('display-added'));
  screen.on('display-removed', reconcile('display-removed'));
  screen.on('display-metrics-changed', reconcile('display-metrics-changed'));
}

// ---------------------------------------------------------------------------
// IPC relay. Every payload passes the I-7 guard on the way through.
// ---------------------------------------------------------------------------
function wireIpc(): void {
  ipcMain.on(CH.paramSet, (_e: IpcMainEvent, payload: ParamSet) => {
    send(outputWin, CH.paramSet, assertJsonOnly(payload));
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
    saveSettings({ hudVisible: assertJsonOnly(visible) });
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
    saveSettings({ outputDisplay: fingerprint(d) });
    openOutputWindow();
    return true;
  });

  ipcMain.handle(CH.measurementMode, (_e, on: boolean): boolean => {
    saveSettings({ measurementMode: on });
    return on === uncappedRequested; // false => a relaunch is needed
  });
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
  openOutputWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createEditorWindow();
      openOutputWindow();
    }
  });
});

app.on('window-all-closed', () => {
  releasePowerSaveBlocker();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', releasePowerSaveBlocker);
