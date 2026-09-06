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
  /**
   * **Live** managed texture sources — null slots excluded.
   *
   * Phase 3 changed what this had to mean. PixiJS nulls an entry in
   * `managedTextures` when a source is destroyed and never compacts the array,
   * so `managedTextures.length` counts tombstones as well as textures. Phase 1
   * had no textures and Phase 2 had one composite render texture that was
   * never destroyed, so `length` and "live count" were the same number and the
   * difference could not show.
   *
   * Phase 3 creates and destroys a texture per video and per Lottie on every
   * scene rebuild. The 20-minute soak rebuilt 604 times and this counter read
   * **23 rising to 1221** — a reported 5209% drift, `flat: false`, and a
   * failed rolling check. Nothing had leaked: `textureBytesEstimate` was
   * pinned at 12,861,448 the whole time, buffers 4 → 4, geometries 2 → 2. The
   * instrument was counting graves.
   *
   * A9 names this exactly: "an instrument that emits a plausible wrong number
   * is worse than one that fails loudly." A false leak is worse than a missing
   * number, because it sends somebody hunting a leak that is not there — and
   * because the next real one is now easier to disbelieve.
   */
  textureCount: number;
  /**
   * `managedTextures.length`, tombstones included. Reported as INFORMATION.
   *
   * Not a defect of ours and not a gate number, but worth having visible: the
   * array itself grows without bound across a long session, at roughly one
   * slot per destroyed texture. It is a few tens of kilobytes over an evening,
   * and it is the reason `textureCount` above had to stop being `length`.
   */
  textureSlots: number;
  /**
   * Estimated bytes behind those textures, at 4 bytes per pixel and ignoring
   * mipmaps and compressed formats. **An estimate, labelled as one**, and the
   * reason `textureCount` is reported beside it as a fact.
   */
  textureBytesEstimate: number;
  /**
   * **Live** GPU buffers Pixi is managing — vertex, index and uniform,
   * tombstones excluded.
   *
   * This counter was counting graves too, for exactly the reason `textureCount`
   * above was, and the fix arrived four phases later because nobody read what
   * produces it. `buffer._managedBuffers` is not an array and is not a `Pool`:
   * in PixiJS 8.20.1 it is a **`GCManagedHash`**, and its `remove()` does
   *
   *     this.items[item.uid] = null;
   *
   * — a tombstone, not a delete, the same shape as `managedTextures`' null
   * slots. `Object.keys(items).length` therefore counts every uid ever managed,
   * live or destroyed, and **cannot go down**. A quantity that cannot go down
   * cannot be flat, so `flat: false` on a `Graphics`-heavy scene was not a leak
   * report and was not a property of the renderer either: it was this function
   * counting the wrong set.
   *
   * The correction is the one the texture path already made twelve lines above,
   * applied to the sibling quantity for consistency rather than as a new idea.
   */
  bufferCount: number;
  /**
   * `Object.keys(_managedBuffers.items).length`, tombstones included. INFORMATION.
   *
   * Kept and reported for the same reason `textureSlots` is: the difference
   * between this and `bufferCount` is the tombstone count, and a reader who
   * cannot see both has to take the live number on trust. It is also the number
   * every soak before this commit was judged on, so keeping it visible is what
   * makes those runs re-readable rather than merely superseded.
   */
  bufferSlots: number;
  /**
   * **Live** geometries Pixi is managing, tombstones excluded. `Graphics`
   * allocates one per distinct shape.
   *
   * Same mechanism as `bufferCount`: `geometry._managedGeometries` is also a
   * `GCManagedHash` (`GlGeometrySystem.mjs:31`), also tombstoning on remove.
   */
  geometryCount: number;
  /** `Object.keys(_managedGeometries.items).length`, tombstones included. INFORMATION. */
  geometrySlots: number;
  /**
   * SPRINT.md §3 R3's counter. **Reported, never gated** — like every other
   * number in this file.
   *
   * Carried as its own census with its own `valid` flag rather than as three
   * more fields beside the textures. That is the A14 lesson stated as
   * structure: a NEW counter that cannot find its subsystem must report itself
   * INVALID and must not be able to drag the four counters beside it — which
   * have four phases of history — into INVALID with it. The census that judges
   * a soak and the census that judges a mask fail independently or they are one
   * instrument pretending to be two.
   */
  renderTargets: RenderTargetCensus;
}

/**
 * How many render targets the renderer is holding (SPRINT.md §3 R3).
 *
 * The question it answers is exactly one: **does putting content on a face
 * allocate a target?** A stencil mask does not; a sprite/alpha mask does, once
 * per masked container, and on a wall the two look identical. So this is the
 * only instrument that can tell them apart, and the golden runner reads it
 * either side of a fill.
 *
 * Two numbers, for the reason `textureCount` and `textureSlots` are two
 * numbers. They come from different structures with different removal
 * semantics, and reporting one would repeat Phase 3's tombstone fault in a
 * fresh counter:
 *
 *   - `count` is `_renderSurfaceToRenderTargetHash.size`. That is a real `Map`
 *     and `destroyRenderTarget` calls `.delete` on it
 *     (`RenderTargetSystem.mjs`), so it has no graves and it is the live
 *     number.
 *   - `gpuSlots` / `gpuLive` come from `_gpuRenderTargetHash`, a null-prototype
 *     object whose destroy path assigns `null` rather than deleting the key —
 *     the SAME tombstone shape as `managedTextures`, twelve lines from a
 *     comment about it. Both are reported so the difference is visible instead
 *     of inferred.
 *
 * A14: read on the existing 250 ms metrics tick, inside the timing that already
 * produces the `instrument` HUD row. It allocates nothing per frame, touches no
 * frame path, and does no I/O.
 */
export interface RenderTargetCensus {
  /** False when the renderer internals moved. Then no number here means anything. */
  valid: boolean;
  invalidReason: string;
  /** **Live** render targets: `_renderSurfaceToRenderTargetHash.size`. The number R3 is about. */
  count: number;
  /** Keys in `_gpuRenderTargetHash`, tombstones included. INFORMATION. */
  gpuSlots: number;
  /** Non-null values in `_gpuRenderTargetHash`. INFORMATION. */
  gpuLive: number;
}

export const INVALID_RENDER_TARGETS: RenderTargetCensus = {
  valid: false,
  invalidReason: 'not sampled',
  count: 0,
  gpuSlots: 0,
  gpuLive: 0,
};

export const INVALID_GPU_REPORT: GpuResourceReport = {
  valid: false,
  invalidReason: 'not sampled',
  textureCount: 0,
  textureSlots: 0,
  textureBytesEstimate: 0,
  bufferCount: 0,
  bufferSlots: 0,
  geometryCount: 0,
  geometrySlots: 0,
  renderTargets: INVALID_RENDER_TARGETS,
};

function subsystem(renderer: unknown, name: string): unknown {
  if (renderer === null || typeof renderer !== 'object') return null;
  return (renderer as Record<string, unknown>)[name] ?? null;
}

/**
 * Counts a Pixi `GCManagedHash.items` BOTH ways, or null if it is not one.
 *
 * `slots` is every key — every uid ever added. `live` is the non-null values.
 * The difference is the tombstone count, because `GCManagedHash.remove()`
 * assigns `null` rather than deleting the key:
 *
 *     remove(item) { ...; this.items[item.uid] = null; }
 *
 * Returning one number here was the defect. Returning both is not defensive
 * coding; it is the only way the caller can tell a pool that filled up from a
 * hash that is accumulating graves, and those two have opposite meanings for
 * the rolling check.
 */
function countManagedHash(
  system: unknown,
  field: string,
): { slots: number; live: number } | null {
  if (system === null || typeof system !== 'object') return null;
  const hash = (system as Record<string, unknown>)[field];
  if (hash === null || typeof hash !== 'object') return null;
  const items = (hash as Record<string, unknown>)['items'];
  if (items === null || typeof items !== 'object') return null;
  const values = Object.values(items as Record<string, unknown>);
  let live = 0;
  for (const v of values) if (v) live++;
  return { slots: values.length, live };
}

/**
 * SPRINT.md §3 R3 — the live render-target count.
 *
 * Its own function with its own validity, deliberately: see
 * `RenderTargetCensus`. A new counter that could not find its subsystem must
 * say so about ITSELF and leave the census beside it alone.
 *
 * Both structures are renderer internals with a leading underscore, so every
 * lookup is a probe. That is not defensive style — it is the honest shape of
 * reading a private field, and the alternative is a confident zero, which is
 * the failure A14 lists first.
 */
export function readRenderTargets(renderer: unknown): RenderTargetCensus {
  const system = subsystem(renderer, 'renderTarget');
  if (system === null || typeof system !== 'object') {
    return {
      ...INVALID_RENDER_TARGETS,
      invalidReason: 'renderer internals not found: renderTarget (PixiJS version change?)',
    };
  }
  const missing: string[] = [];

  // A real `Map`, and `destroyRenderTarget` deletes from it — no tombstones,
  // so `.size` is the live count rather than a high-water mark.
  const live = (system as Record<string, unknown>)['_renderSurfaceToRenderTargetHash'];
  const isMap = live instanceof Map;
  if (!isMap) missing.push('renderTarget._renderSurfaceToRenderTargetHash');

  // A null-prototype object whose destroy path assigns null. Counted BOTH ways
  // for the reason `textureSlots` exists twelve lines above the fault it names.
  let gpuSlots = 0;
  let gpuLive = 0;
  const gpuHash = (system as Record<string, unknown>)['_gpuRenderTargetHash'];
  if (gpuHash !== null && typeof gpuHash === 'object') {
    const values = Object.values(gpuHash as Record<string, unknown>);
    gpuSlots = values.length;
    for (const v of values) if (v) gpuLive++;
  } else {
    missing.push('renderTarget._gpuRenderTargetHash');
  }

  return {
    valid: missing.length === 0,
    invalidReason:
      missing.length === 0
        ? ''
        : `renderer internals not found: ${missing.join(', ')} (PixiJS version change?)`,
    count: isMap ? (live as Map<unknown, unknown>).size : 0,
    gpuSlots,
    gpuLive,
  };
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
  let textureSlots = 0;
  let textureBytesEstimate = 0;
  // `Renderer` is a union of the WebGL, WebGPU and Canvas renderers and only
  // one of them declares these systems, so every lookup here is a probe rather
  // than a property access. That is the honest shape anyway: two of the three
  // are internals, and a missing one must report INVALID, not zero.
  const textures = (
    subsystem(renderer, 'texture') as { managedTextures?: readonly TextureSource[] } | null
  )?.managedTextures;
  if (Array.isArray(textures)) {
    textureSlots = textures.length;
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
      // Counted HERE, past the null guard, so the count and the byte estimate
      // describe the same set of objects. They did not before: the count was
      // the array's length and the bytes were the sum over its live entries,
      // which is how a flat 12.8 MB could sit beside a count of 1221.
      textureCount++;
      const w = typeof t.pixelWidth === 'number' ? t.pixelWidth : 0;
      const h = typeof t.pixelHeight === 'number' ? t.pixelHeight : 0;
      textureBytesEstimate += w * h * 4;
    }
  } else {
    missing.push('texture.managedTextures');
  }

  const buffers = countManagedHash(subsystem(renderer, 'buffer'), '_managedBuffers');
  if (buffers === null) missing.push('buffer._managedBuffers');

  const geometries = countManagedHash(subsystem(renderer, 'geometry'), '_managedGeometries');
  if (geometries === null) missing.push('geometry._managedGeometries');

  return {
    valid: missing.length === 0,
    invalidReason:
      missing.length === 0
        ? ''
        : `renderer internals not found: ${missing.join(', ')} (PixiJS version change?)`,
    textureCount,
    textureSlots,
    textureBytesEstimate,
    bufferCount: buffers?.live ?? 0,
    bufferSlots: buffers?.slots ?? 0,
    geometryCount: geometries?.live ?? 0,
    geometrySlots: geometries?.slots ?? 0,
    // Sampled here so the whole census is one call on one tick, but judged on
    // its own `valid` — the four counters above cannot be invalidated by it.
    renderTargets: readRenderTargets(renderer),
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
  /** Fractional change from first to last sample, per counter. LIVE counts. */
  driftTextureCount: number;
  driftBufferCount: number;
  driftGeometryCount: number;
  /**
   * The same drifts over SLOT counts — tombstones included.
   *
   * Reported, never gated. A slot count is monotone non-decreasing by
   * construction (`GCManagedHash.remove()` writes a tombstone), so gating on it
   * would be asking a flatness question of a quantity that cannot be flat. It
   * is here so that the number every soak before this commit was judged on
   * stays visible beside the one that replaced it.
   */
  driftTextureSlots: number;
  driftBufferSlots: number;
  driftGeometrySlots: number;
  /**
   * §8.2's condition, and Gate 9's: flat within ±5% across the WHOLE window.
   *
   * The conjunction of the three below. Kept as one field so nothing silently
   * loosens, but **it is no longer the thing to read** — a single boolean over
   * three subsystems answers a question nobody asked, which is what §10 row 13
   * is about.
   */
  flat: boolean;
  /** Split verdicts, on LIVE counts. Read these; `flat` is their AND. */
  flatTextures: boolean;
  flatBuffers: boolean;
  flatGeometries: boolean;
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
  /**
   * The K actually used: rebuilds that must pass with no increase before the
   * series is called settled. Reported so a verdict carries its own threshold.
   */
  settleRebuilds: number;
  /**
   * Did the series accumulate K quiet rebuilds AND then drift by zero?
   *
   * This is §10 row 13's proposed criterion. It is deliberately two clauses:
   * reaching K without a subsequent increase is what "settled" means, and zero
   * post-settle drift is what makes it a pool rather than a slow leak.
   */
  settled: boolean;
  /** Why not, when `settled` is false. Empty otherwise. A9: state the reason. */
  notSettledBecause: string;
}

/**
 * K — quiet rebuilds required before a series counts as settled.
 *
 * **Justified from the mechanism and from measurement, before being run.**
 *
 * The mechanism (`GCManagedHash`, read at PixiJS 8.20.1): `add()` is a no-op
 * for a uid already present, so the live count grows only when the renderer
 * needs an object it has never needed before. Growth is therefore bounded by
 * the peak concurrent demand of the scene, and a scene rebuilt over and over
 * reaches that peak early and then stops. That is a settling curve, not a leak,
 * and the two are distinguished by whether growth resumes.
 *
 * The measurement (`p4-soak`, `p4-soak-p1`, both `disturbed=false`): counter
 * increases land at 20.3 s, 50.3 s, 80.3 s and 110.3 s and then never again, in
 * both runs, on two different scenes. At the soaks' 0.503 rebuilds/s that is a
 * warm-up of **≈55 rebuilds with no quiet interval inside it at all**, followed
 * by a quiet tail of **548 rebuilds** (`p4-soak`) and **188** (`p4-soak-p1`).
 *
 * So K must sit above the warm-up and below the shorter tail: 55 < K < 188.
 * **K = 64** — above the whole warm-up, so settling cannot be declared while
 * warm-up is still running; roughly a third of the shorter observed tail, so a
 * genuinely settled run clears it with margin.
 *
 * **Choosing K wrong causes a failure, never a false pass**, which is the
 * asymmetry A9 asks for:
 *
 *  - K too small — settling is declared early, the increases that follow land
 *    inside the post-settle window, post-settle drift is non-zero, FAIL.
 *  - K too large — the run never accumulates K quiet rebuilds, NOT SETTLED,
 *    FAIL.
 *
 * **Stated limit of the evidence.** The soak samples every 30 s while rebuilds
 * run at ~0.5/s, so the instrument cannot resolve the true gap between two
 * increases — it can only say that each of the first four 30 s windows
 * contained one. K is expressed in rebuilds but evaluated at sample
 * granularity, giving it an effective resolution of ~15 rebuilds. That is a
 * property of the sampling rate, not of K, and it is recorded rather than
 * smoothed over.
 */
export const SETTLE_REBUILDS = 64;

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
export function judgeSoak(
  samples: GpuSample[],
  rebuilds: number,
  settleRebuilds: number = SETTLE_REBUILDS,
): SoakVerdict {
  const base: Omit<SoakVerdict, 'valid' | 'invalidReason'> = {
    samples,
    driftTextureCount: 0,
    driftBufferCount: 0,
    driftGeometryCount: 0,
    driftTextureSlots: 0,
    driftBufferSlots: 0,
    driftGeometrySlots: 0,
    flat: false,
    flatTextures: false,
    flatBuffers: false,
    flatGeometries: false,
    settledAtSeconds: 0,
    steadySeconds: 0,
    steadyDriftBufferCount: 0,
    steadyDriftGeometryCount: 0,
    rebuildsAfterSettled: 0,
    rebuilds,
    settleRebuilds,
    settled: false,
    notSettledBecause: 'not judged',
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

  const steadyDriftBufferCount = drift(steadyFirst.bufferCount, steadyLast.bufferCount);
  const steadyDriftGeometryCount = drift(steadyFirst.geometryCount, steadyLast.geometryCount);

  // §10 row 13's criterion. Two clauses, and the reason is stated when it
  // fails: a verdict that cannot say why is the same defect as one that
  // prints no value (A9).
  const postSettleDrift =
    Math.abs(steadyDriftBufferCount) + Math.abs(steadyDriftGeometryCount);
  let notSettledBecause = '';
  if (rebuildsAfterSettled < settleRebuilds) {
    notSettledBecause =
      `only ${rebuildsAfterSettled} rebuilds passed after the last increase at ` +
      `${settledAtSeconds.toFixed(1)}s, under K=${settleRebuilds}`;
  } else if (postSettleDrift > 0) {
    notSettledBecause =
      `post-settle drift is not zero: buffers ${steadyDriftBufferCount}, ` +
      `geometries ${steadyDriftGeometryCount}`;
  }

  const flatTextures = Math.abs(driftTextureCount) <= FLAT_TOLERANCE;
  const flatBuffers = Math.abs(driftBufferCount) <= FLAT_TOLERANCE;
  const flatGeometries = Math.abs(driftGeometryCount) <= FLAT_TOLERANCE;

  return {
    valid: true,
    invalidReason: '',
    samples,
    driftTextureCount,
    driftBufferCount,
    driftGeometryCount,
    driftTextureSlots: drift(first.textureSlots, last.textureSlots),
    driftBufferSlots: drift(first.bufferSlots, last.bufferSlots),
    driftGeometrySlots: drift(first.geometrySlots, last.geometrySlots),
    settledAtSeconds,
    steadySeconds,
    steadyDriftBufferCount,
    steadyDriftGeometryCount,
    rebuildsAfterSettled,
    flatTextures,
    flatBuffers,
    flatGeometries,
    flat: flatTextures && flatBuffers && flatGeometries,
    rebuilds,
    settleRebuilds,
    settled: notSettledBecause === '',
    notSettledBecause,
  };
}

/**
 * One line describing a soak, with **numerator and denominator, never a ratio**.
 *
 * §10 row 13's second condition, and it is not a formatting preference. The
 * "buffers-per-geometry anomaly" that prompted it — 1.20 on one scene against
 * exactly 2.00 on another — does not exist: every soak on record reads exactly
 * 2.0000 at both ends, on every scene. **1.20 was 274/227: one scene's buffer
 * count over another scene's geometry count.** A ratio hides its sample size
 * and, as it turned out, hides which sample it came from at all. Printing both
 * terms makes that mistake unwriteable.
 */
export function describeSoak(v: SoakVerdict): string {
  if (!v.valid) return `[soak] INVALID: ${v.invalidReason}`;
  const first = v.samples[0]!.gpu;
  const last = v.samples[v.samples.length - 1]!.gpu;
  const pair = (a: number, b: number): string => `${a}->${b}`;
  return (
    `[soak] live  textures ${pair(first.textureCount, last.textureCount)}  ` +
    `buffers ${pair(first.bufferCount, last.bufferCount)}  ` +
    `geometries ${pair(first.geometryCount, last.geometryCount)}\n` +
    `[soak] slots textures ${pair(first.textureSlots, last.textureSlots)}  ` +
    `buffers ${pair(first.bufferSlots, last.bufferSlots)}  ` +
    `geometries ${pair(first.geometrySlots, last.geometrySlots)}  ` +
    `(tombstones included; monotone by construction, never gated)\n` +
    `[soak] buffers per geometry, both terms: ` +
    `first ${first.bufferCount}/${first.geometryCount}  ` +
    `last ${last.bufferCount}/${last.geometryCount}\n` +
    `[soak] flat textures=${v.flatTextures} buffers=${v.flatBuffers} ` +
    `geometries=${v.flatGeometries} (AND=${v.flat})\n` +
    `[soak] settled=${v.settled} K=${v.settleRebuilds} ` +
    `lastIncrease=${v.settledAtSeconds.toFixed(1)}s ` +
    `quietRebuilds=${v.rebuildsAfterSettled} ` +
    `postSettleDrift buffers=${v.steadyDriftBufferCount} ` +
    `geometries=${v.steadyDriftGeometryCount}` +
    (v.settled ? '' : `  — NOT SETTLED: ${v.notSettledBecause}`)
  );
}
