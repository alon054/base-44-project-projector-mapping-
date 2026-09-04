/**
 * GPU resource census, for §8.2's "texture memory flat over a 5-minute soak
 * with motion" — the rolling check that activates at Gate 1.
 *
 * **This measures GPU resources, not texture bytes, and the name matters.**
 * Phase 1 has no textures at all: every layer is vector `Graphics`. A literal
 * texture-byte readout would report zero here, pass trivially, and prove
 * nothing. What Phase 1 actually allocates and frees is geometry and buffers,
 * and it does so on a path this phase introduced — the compositor tears down
 * and rebuilds the entire layer stack on every scene edit, which is now a
 * drag-and-drop gesture the operator makes constantly.
 *
 * A9 binds here as much as anywhere: `managedTextures` is public API, but the
 * geometry and buffer hashes are Pixi internals. If their shape changes under
 * a version bump, this reports INVALID rather than a plausible zero. An
 * instrument that silently reports "no leak" because it lost its way into the
 * renderer is worse than one that fails.
 */
import type { TextureSource } from 'pixi.js';

export interface GpuResourceReport {
  /** A9: false when any counter could not be read. No number is then usable. */
  valid: boolean;
  /** Why it is invalid; empty when valid. */
  invalidReason: string;
  /** Managed texture sources. Zero in Phase 1 — everything is Graphics. */
  textureCount: number;
  /**
   * Estimated bytes behind those textures, at 4 bytes per pixel and ignoring
   * mipmaps and compressed formats. **An estimate, labelled as one**, and the
   * reason `textureCount` is reported beside it as a fact.
   */
  textureBytesEstimate: number;
  /** GPU buffers Pixi is managing — vertex, index and uniform. */
  bufferCount: number;
  /** Geometries Pixi is managing. Graphics allocates one per distinct shape. */
  geometryCount: number;
}

export const INVALID_GPU_REPORT: GpuResourceReport = {
  valid: false,
  invalidReason: 'not sampled',
  textureCount: 0,
  textureBytesEstimate: 0,
  bufferCount: 0,
  geometryCount: 0,
};

function subsystem(renderer: unknown, name: string): unknown {
  if (renderer === null || typeof renderer !== 'object') return null;
  return (renderer as Record<string, unknown>)[name] ?? null;
}

/** Counts the keys of a Pixi `GCManagedHash.items`, or null if it is not one. */
function countManaged(system: unknown, field: string): number | null {
  if (system === null || typeof system !== 'object') return null;
  const hash = (system as Record<string, unknown>)[field];
  if (hash === null || typeof hash !== 'object') return null;
  const items = (hash as Record<string, unknown>)['items'];
  if (items === null || typeof items !== 'object') return null;
  return Object.keys(items as object).length;
}

/**
 * Sample the renderer's managed resources.
 *
 * Called on the metrics tick (4 Hz), never per frame: it walks small
 * collections, and A14's clause says the instrument reports its own cost rather
 * than hiding in the budget it measures.
 */
export function readGpuResources(renderer: unknown): GpuResourceReport {
  const missing: string[] = [];

  let textureCount = 0;
  let textureBytesEstimate = 0;
  // `Renderer` is a union of the WebGL, WebGPU and Canvas renderers and only
  // one of them declares these systems, so every lookup here is a probe rather
  // than a property access. That is the honest shape anyway: two of the three
  // are internals, and a missing one must report INVALID, not zero.
  const textures = (
    subsystem(renderer, 'texture') as { managedTextures?: readonly TextureSource[] } | null
  )?.managedTextures;
  if (Array.isArray(textures)) {
    textureCount = textures.length;
    for (const t of textures) {
      // `managedTextures` can hold a null slot: PixiJS nulls an entry when a
      // texture source is destroyed rather than compacting the array, so
      // `typeof t.pixelWidth` throws on the very run this census exists to
      // watch. Observed as an uncaught "Cannot read properties of null
      // (reading 'pixelWidth')" at teardown in BOTH p1-soak and p2-warp-off —
      // it has been there since the census was written and was never recorded.
      //
      // It mattered little in Phase 1, which had no textures at all. From
      // Phase 2 there is a composite render texture, so this is now on the
      // path of the soak check itself.
      if (!t) continue;
      const w = typeof t.pixelWidth === 'number' ? t.pixelWidth : 0;
      const h = typeof t.pixelHeight === 'number' ? t.pixelHeight : 0;
      textureBytesEstimate += w * h * 4;
    }
  } else {
    missing.push('texture.managedTextures');
  }

  const bufferCount = countManaged(subsystem(renderer, 'buffer'), '_managedBuffers');
  if (bufferCount === null) missing.push('buffer._managedBuffers');

  const geometryCount = countManaged(subsystem(renderer, 'geometry'), '_managedGeometries');
  if (geometryCount === null) missing.push('geometry._managedGeometries');

  return {
    valid: missing.length === 0,
    invalidReason:
      missing.length === 0
        ? ''
        : `renderer internals not found: ${missing.join(', ')} (PixiJS version change?)`,
    textureCount,
    textureBytesEstimate,
    bufferCount: bufferCount ?? 0,
    geometryCount: geometryCount ?? 0,
  };
}

/** One sample in a soak series. */
export interface GpuSample {
  /** Seconds since the measurement window opened. */
  atSeconds: number;
  gpu: GpuResourceReport;
}

export interface SoakVerdict {
  valid: boolean;
  invalidReason: string;
  samples: GpuSample[];
  /** Fractional change from first to last sample, per counter. */
  driftTextureCount: number;
  driftBufferCount: number;
  driftGeometryCount: number;
  /** §8.2's condition, and Gate 9's: flat within ±5%, across the WHOLE window. */
  flat: boolean;
  /**
   * Seconds at which the last counter change occurred. Everything after this is
   * steady state. Reported as a NUMBER rather than assumed, because the whole
   * question of whether early growth is warm-up or leakage turns on it.
   */
  settledAtSeconds: number;
  /** Seconds of measured steady state after `settledAtSeconds`. */
  steadySeconds: number;
  /** Drift across the steady-state window only. */
  steadyDriftBufferCount: number;
  steadyDriftGeometryCount: number;
  /**
   * Rebuilds driven AFTER the counters settled. This is the number that
   * separates a pool from a leak: a per-rebuild leak cannot absorb these
   * without growing.
   */
  rebuildsAfterSettled: number;
  /** How many scene rebuilds were driven during the soak. */
  rebuilds: number;
}

const FLAT_TOLERANCE = 0.05;

function drift(first: number, last: number): number {
  if (first === 0) return last === 0 ? 0 : 1;
  return (last - first) / first;
}

/**
 * Judge a soak series.
 *
 * "Flat" is measured from the FIRST POST-WARMUP sample, not from process
 * start: a renderer legitimately allocates while it warms up, and counting
 * that as a leak would make every soak fail for the wrong reason.
 */
export function judgeSoak(samples: GpuSample[], rebuilds: number): SoakVerdict {
  const base: Omit<SoakVerdict, 'valid' | 'invalidReason'> = {
    samples,
    driftTextureCount: 0,
    driftBufferCount: 0,
    driftGeometryCount: 0,
    flat: false,
    settledAtSeconds: 0,
    steadySeconds: 0,
    steadyDriftBufferCount: 0,
    steadyDriftGeometryCount: 0,
    rebuildsAfterSettled: 0,
    rebuilds,
  };
  if (samples.length < 2) {
    return { ...base, valid: false, invalidReason: 'need at least two samples' };
  }
  const bad = samples.find((s) => !s.gpu.valid);
  if (bad) {
    return { ...base, valid: false, invalidReason: bad.gpu.invalidReason };
  }
  const first = samples[0]!.gpu;
  const last = samples[samples.length - 1]!.gpu;
  const driftTextureCount = drift(first.textureCount, last.textureCount);
  const driftBufferCount = drift(first.bufferCount, last.bufferCount);
  const driftGeometryCount = drift(first.geometryCount, last.geometryCount);

  // Where the counters stopped moving. `flat` still judges the WHOLE window —
  // this is reported ALONGSIDE it, never instead of it. A steady-state figure
  // that quietly replaced the full-window one would be a gate condition
  // rewritten to pass, which is the one thing this project does not do.
  let settledAtSeconds = samples[0]!.atSeconds;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!.gpu;
    const b = samples[i]!.gpu;
    if (b.bufferCount !== a.bufferCount || b.geometryCount !== a.geometryCount) {
      settledAtSeconds = samples[i]!.atSeconds;
    }
  }
  const steady = samples.filter((s) => s.atSeconds >= settledAtSeconds);
  const steadyFirst = steady[0]!.gpu;
  const steadyLast = steady[steady.length - 1]!.gpu;
  const totalSeconds = last === first ? 0 : samples[samples.length - 1]!.atSeconds;
  const steadySeconds = steady[steady.length - 1]!.atSeconds - steady[0]!.atSeconds;
  const rebuildsAfterSettled =
    totalSeconds > 0 ? Math.round(rebuilds * (steadySeconds / totalSeconds)) : 0;

  return {
    valid: true,
    invalidReason: '',
    samples,
    driftTextureCount,
    driftBufferCount,
    driftGeometryCount,
    settledAtSeconds,
    steadySeconds,
    steadyDriftBufferCount: drift(steadyFirst.bufferCount, steadyLast.bufferCount),
    steadyDriftGeometryCount: drift(steadyFirst.geometryCount, steadyLast.geometryCount),
    rebuildsAfterSettled,
    flat:
      Math.abs(driftTextureCount) <= FLAT_TOLERANCE &&
      Math.abs(driftBufferCount) <= FLAT_TOLERANCE &&
      Math.abs(driftGeometryCount) <= FLAT_TOLERANCE,
    rebuilds,
  };
}
