/**
 * Safe IPC bridge. Deliberately tiny: scene state only, JSON only (I-7).
 * contextIsolation + sandbox are on, so this is the entire renderer-visible
 * surface of the main process.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CH, assertJsonOnly } from './ipc';
import type {
  CalibrationSet,
  ClockSet,
  DisplayInfo,
  MetricsReport,
  OutputConfig,
  ParamAck,
  ParamRecv,
  ParamSet,
  OutputKeyPress,
  ProvocationKind,
  SceneFailure,
  SceneSet,
} from './ipc';

export interface WarningMessage {
  level: 'info' | 'warn' | 'error';
  text: string;
}

const api = {
  // editor -> output
  setParam(p: ParamSet): void {
    ipcRenderer.send(CH.paramSet, assertJsonOnly(p));
  },
  // output -> editor, the instant the value arrives — no frame wait (A11)
  recvParam(p: ParamRecv): void {
    ipcRenderer.send(CH.paramRecv, assertJsonOnly(p));
  },
  // output -> editor, once the change has actually been presented
  ackParam(p: ParamAck): void {
    ipcRenderer.send(CH.paramAck, assertJsonOnly(p));
  },
  // editor -> output: whole scene, JSON only (I-7)
  setScene(s: SceneSet): void {
    ipcRenderer.send(CH.sceneSet, assertJsonOnly(s));
  },
  onScene(cb: (s: SceneSet) => void): () => void {
    const h = (_e: unknown, s: SceneSet) => cb(s);
    ipcRenderer.on(CH.sceneSet, h);
    return () => ipcRenderer.off(CH.sceneSet, h);
  },
  /**
   * A monotonic clock in **milliseconds, with nanosecond resolution** — WHEN
   * THIS PRELOAD CAN OFFER ONE. It usually cannot; see below.
   *
   * `performance.now()` in a renderer is deliberately coarsened to 100 us by
   * Chromium (a Spectre mitigation). §4's metric 2 is "PixiJS CPU render
   * duration, p99 <= 60% of N", and at Phase 3's layer load that duration is
   * about 47 us — HALF a tick of the only clock the renderer had. The result
   * is that metric 2 reported the identical value, 0.200 ms = 1.200% of N, at
   * Gate 0, Gate 1, Gate 2 and Gate 3, and across load steps from 1 video to
   * 6. It was not stable; it was quantised, and the quantum was larger than
   * the thing being measured.
   *
   * §4 does not name a clock — it names a quantity. `process.hrtime.bigint()`
   * is available here in the preload, is not coarsened, and needs no IPC round
   * trip. Its own call cost is measured rather than assumed, and reported: see
   * `debug/hud.ts` and the `[timer]` line at startup. A14 is explicit that the
   * measurement apparatus is subject to the budget it measures.
   *
   * **This preload is sandboxed** (`sandbox: true` in `main.ts`), and a
   * sandboxed preload gets a stripped `process` polyfill with no `hrtime`. The
   * first version of this function assumed otherwise and threw
   * `Cannot read properties of undefined (reading 'bigint')` straight through
   * render-host creation — the output window died before it drew a frame. The
   * fix is not to reach for `hrtime` unguarded, and not to hand the renderer a
   * function that throws when called.
   *
   * `null` is returned rather than a guess when no fine clock exists, so the
   * caller falls back loudly instead of timing frames with a broken stopwatch
   * (A9: an instrument that emits a plausible wrong number is worse than one
   * that fails loudly).
   *
   * Returns milliseconds as a float so it is a drop-in for `performance.now()`.
   */
  nowMs(): number | null {
    const hr = (process as { hrtime?: { bigint?: () => bigint } }).hrtime;
    if (typeof hr?.bigint !== 'function') return null;
    try {
      return Number(hr.bigint()) / 1e6;
    } catch {
      return null;
    }
  },
  /** §4: ask main to focus the output window as the measured window opens. */
  focusOutput(): void {
    ipcRenderer.send(CH.focusOutput);
  },
  // I-2 / I-7: editor -> main -> output. Whole clock state, JSON only.
  setClock(c: ClockSet): void {
    ipcRenderer.send(CH.clockSet, assertJsonOnly(c));
  },
  onClock(cb: (c: ClockSet) => void): () => void {
    const h = (_e: unknown, c: ClockSet) => cb(c);
    ipcRenderer.on(CH.clockSet, h);
    return () => ipcRenderer.off(CH.clockSet, h);
  },
  /**
   * P5-E. editor -> main -> output: one shortcut, by key identity (I-7).
   *
   * Additive. The output window keeps its own `keydown` listener and both ends
   * dispatch through the same `OUTPUT_SHORTCUTS` table, so this is a second way
   * to press the key, not a second definition of what it means.
   */
  sendOutputKey(k: OutputKeyPress): void {
    ipcRenderer.send(CH.outputKey, assertJsonOnly(k));
  },
  onOutputKey(cb: (k: OutputKeyPress) => void): () => void {
    const h = (_e: unknown, k: OutputKeyPress) => cb(k);
    ipcRenderer.on(CH.outputKey, h);
    return () => ipcRenderer.off(CH.outputKey, h);
  },
  // I-5: editor -> main -> output. Main persists it on the way through.
  setCalibration(c: CalibrationSet): void {
    ipcRenderer.send(CH.calibrationSet, assertJsonOnly(c));
  },
  onCalibration(cb: (c: CalibrationSet) => void): () => void {
    const h = (_e: unknown, c: CalibrationSet) => cb(c);
    ipcRenderer.on(CH.calibrationSet, h);
    return () => ipcRenderer.off(CH.calibrationSet, h);
  },
  /** The stored calibration file as raw JSON, or null. Canonicalized by the caller. */
  getCalibration(): Promise<unknown> {
    return ipcRenderer.invoke(CH.calibrationGet) as Promise<unknown>;
  },
  // output -> editor: I-13 flags for the layer list
  reportSceneFailures(f: SceneFailure[]): void {
    ipcRenderer.send(CH.sceneFailures, assertJsonOnly(f));
  },
  onSceneFailures(cb: (f: SceneFailure[]) => void): () => void {
    const h = (_e: unknown, f: SceneFailure[]) => cb(f);
    ipcRenderer.on(CH.sceneFailures, h);
    return () => ipcRenderer.off(CH.sceneFailures, h);
  },
  reportMetrics(m: MetricsReport): void {
    ipcRenderer.send(CH.metrics, assertJsonOnly(m));
  },
  onParam(cb: (p: ParamSet) => void): () => void {
    const h = (_e: unknown, p: ParamSet) => cb(p);
    ipcRenderer.on(CH.paramSet, h);
    return () => ipcRenderer.off(CH.paramSet, h);
  },
  onParamRecv(cb: (p: ParamRecv) => void): () => void {
    const h = (_e: unknown, p: ParamRecv) => cb(p);
    ipcRenderer.on(CH.paramRecv, h);
    return () => ipcRenderer.off(CH.paramRecv, h);
  },
  onParamAck(cb: (p: ParamAck) => void): () => void {
    const h = (_e: unknown, p: ParamAck) => cb(p);
    ipcRenderer.on(CH.paramAck, h);
    return () => ipcRenderer.off(CH.paramAck, h);
  },
  onMetrics(cb: (m: MetricsReport) => void): () => void {
    const h = (_e: unknown, m: MetricsReport) => cb(m);
    ipcRenderer.on(CH.metrics, h);
    return () => ipcRenderer.off(CH.metrics, h);
  },
  onOutputConfig(cb: (c: OutputConfig) => void): () => void {
    const h = (_e: unknown, c: OutputConfig) => cb(c);
    ipcRenderer.on(CH.outputConfig, h);
    return () => ipcRenderer.off(CH.outputConfig, h);
  },
  onWarning(cb: (w: WarningMessage) => void): () => void {
    const h = (_e: unknown, w: WarningMessage) => cb(w);
    ipcRenderer.on(CH.warning, h);
    return () => ipcRenderer.off(CH.warning, h);
  },
  measureDone(): void {
    ipcRenderer.send(CH.measureDone);
  },
  /** Attribution runs only: ask main to drive one real OS provocation. */
  provoke(kind: ProvocationKind): Promise<string> {
    return ipcRenderer.invoke(CH.provoke, assertJsonOnly(kind)) as Promise<string>;
  },
  setHudState(visible: boolean): void {
    ipcRenderer.send(CH.hudState, assertJsonOnly(visible));
  },
  getOutputConfig(): Promise<OutputConfig | null> {
    return ipcRenderer.invoke(CH.outputConfigRequest) as Promise<OutputConfig | null>;
  },
  listDisplays(): Promise<DisplayInfo[]> {
    return ipcRenderer.invoke(CH.displaysList) as Promise<DisplayInfo[]>;
  },
  selectDisplay(id: number): Promise<boolean> {
    return ipcRenderer.invoke(CH.displaysSelect, assertJsonOnly(id)) as Promise<boolean>;
  },
  setMeasurementMode(on: boolean): Promise<boolean> {
    return ipcRenderer.invoke(CH.measurementMode, assertJsonOnly(on)) as Promise<boolean>;
  },
};

export type EngineApi = typeof api;

contextBridge.exposeInMainWorld('engine', api);
