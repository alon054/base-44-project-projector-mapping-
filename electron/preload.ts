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
    return ipcRenderer.invoke(CH.displaysSelect, id) as Promise<boolean>;
  },
  setMeasurementMode(on: boolean): Promise<boolean> {
    return ipcRenderer.invoke(CH.measurementMode, on) as Promise<boolean>;
  },
};

export type EngineApi = typeof api;

contextBridge.exposeInMainWorld('engine', api);
