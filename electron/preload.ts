/**
 * Safe IPC bridge. Deliberately tiny: scene state only, JSON only (I-7).
 * contextIsolation + sandbox are on, so this is the entire renderer-visible
 * surface of the main process.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CH, assertJsonOnly } from './ipc';
import type {
  DisplayInfo,
  MetricsReport,
  OutputConfig,
  ParamAck,
  ParamRecv,
  ParamSet,
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
