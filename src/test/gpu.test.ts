/**
 * §8.2's soak check: "texture memory flat over a 5-minute soak with motion".
 *
 * The census itself needs a GPU, so what is tested here is the part that can be
 * wrong silently — the probing and the judgement. A9's rule governs both: an
 * instrument that reports a plausible "no leak" because it lost its way into
 * the renderer is worse than one that fails loudly.
 */
import { describe, expect, it } from 'vitest';
import {
  INVALID_RENDER_TARGETS,
  describeSoak,
  judgeSoak,
  readGpuResources,
  readRenderTargets,
  type GpuSample,
} from '../debug/gpu';

const census = (
  buffers: number,
  geometries: number,
  textures = 0,
  slots = textures,
  bufferSlots = buffers,
  geometrySlots = geometries,
) => ({
  valid: true,
  invalidReason: '',
  textureCount: textures,
  // Defaults to the live count. A test that wants the tombstone case — the
  // Phase 3 defect where `length` grew while nothing leaked — passes both.
  textureSlots: slots,
  textureBytesEstimate: textures * 1024,
  bufferCount: buffers,
  bufferSlots,
  geometryCount: geometries,
  geometrySlots,
  // B2's counter is never part of the soak judgement, so every sample here
  // carries the not-sampled census verbatim. If `judgeSoak` ever starts reading
  // it, these fixtures say so by being obviously irrelevant.
  renderTargets: INVALID_RENDER_TARGETS,
});

const series = (...c: ReturnType<typeof census>[]): GpuSample[] =>
  c.map((gpu, i) => ({ atSeconds: i * 30, gpu }));

describe('A9 — the census fails loudly rather than reporting zero', () => {
  it('reports INVALID when the renderer is not a renderer', () => {
    for (const bad of [null, undefined, 42, 'renderer', {}]) {
      const r = readGpuResources(bad);
      expect(r.valid).toBe(false);
      expect(r.invalidReason).toMatch(/not found/);
    }
  });

  it('names every subsystem it could not find, so a version bump is diagnosable', () => {
    const r = readGpuResources({});
    expect(r.invalidReason).toContain('texture.managedTextures');
    expect(r.invalidReason).toContain('buffer._managedBuffers');
    expect(r.invalidReason).toContain('geometry._managedGeometries');
    expect(r.invalidReason).toMatch(/PixiJS version change/);
  });

  it('reads a renderer shaped like PixiJS v8', () => {
    const r = readGpuResources({
      texture: { managedTextures: [{ pixelWidth: 256, pixelHeight: 128 }] },
      buffer: { _managedBuffers: { items: { 1: {}, 2: {}, 3: {} } } },
      geometry: { _managedGeometries: { items: { 7: {} } } },
    });
    expect(r.valid).toBe(true);
    expect(r.textureCount).toBe(1);
    expect(r.textureBytesEstimate).toBe(256 * 128 * 4);
    expect(r.bufferCount).toBe(3);
    expect(r.geometryCount).toBe(1);
  });

  it('is invalid if only part of the renderer is recognisable', () => {
    const r = readGpuResources({ texture: { managedTextures: [] } });
    expect(r.valid).toBe(false);
    expect(r.bufferCount).toBe(0);
    // The zero above is exactly why `valid` has to be consulted first.
    expect(r.invalidReason).toContain('buffer._managedBuffers');
  });
});

describe('soak judgement', () => {
  it('flat when nothing grows', () => {
    const v = judgeSoak(series(census(40, 12), census(40, 12), census(40, 12)), 150);
    expect(v.valid).toBe(true);
    expect(v.flat).toBe(true);
    expect(v.driftBufferCount).toBe(0);
    expect(v.rebuilds).toBe(150);
  });

  it('not flat when a counter climbs past 5%', () => {
    const v = judgeSoak(series(census(40, 12), census(60, 12)), 150);
    expect(v.flat).toBe(false);
    expect(v.driftBufferCount).toBeCloseTo(0.5, 9);
  });

  it('tolerates a small wobble inside 5%', () => {
    const v = judgeSoak(series(census(40, 100), census(41, 103)), 150);
    expect(v.flat).toBe(true);
  });

  it('catches a leak in geometries even when buffers are flat', () => {
    // The Phase 1 shape: the compositor rebuilds the layer stack on every edit,
    // so a Graphics that is not released shows up here first.
    const v = judgeSoak(series(census(40, 12), census(40, 400)), 150);
    expect(v.flat).toBe(false);
    expect(v.driftGeometryCount).toBeGreaterThan(5);
  });

  it('growth from zero counts as a leak, not as no change', () => {
    const v = judgeSoak(series(census(0, 0), census(0, 9)), 10);
    expect(v.flat).toBe(false);
    expect(v.driftGeometryCount).toBe(1);
  });

  it('refuses to judge fewer than two samples', () => {
    const v = judgeSoak(series(census(40, 12)), 0);
    expect(v.valid).toBe(false);
    expect(v.flat).toBe(false);
  });

  it('refuses to judge a series containing an invalid census', () => {
    const samples = series(census(40, 12), census(40, 12));
    samples[1]!.gpu = { ...samples[1]!.gpu, valid: false, invalidReason: 'renderer gone' };
    const v = judgeSoak(samples, 10);
    expect(v.valid).toBe(false);
    expect(v.invalidReason).toBe('renderer gone');
    // And it must not claim flatness on the strength of numbers it distrusts.
    expect(v.flat).toBe(false);
  });
});

describe('steady state is reported alongside the verdict, never instead of it', () => {
  // The measured Phase 1 shape: growth through warm-up, then a plateau that
  // absorbs further rebuilds without moving.
  const warmThenFlat = (): GpuSample[] =>
    [19, 46, 91, 133, 136, 136, 136, 136, 136].map((g, i) => ({
      atSeconds: i * 30,
      gpu: {
        valid: true,
        invalidReason: '',
        textureCount: 2,
        textureSlots: 2,
        textureBytesEstimate: 8,
        bufferCount: g * 2,
        bufferSlots: g * 2,
        geometryCount: g,
        geometrySlots: g,
        renderTargets: INVALID_RENDER_TARGETS,
      },
    }));

  it('still reports the full window as not flat', () => {
    const v = judgeSoak(warmThenFlat(), 244);
    // `flat` must keep judging the whole window. A steady-state number that
    // quietly replaced it would be a gate condition rewritten to pass.
    expect(v.flat).toBe(false);
    expect(v.driftGeometryCount).toBeGreaterThan(5);
  });

  it('finds where the counters settled, and measures the steady window', () => {
    const v = judgeSoak(warmThenFlat(), 244);
    expect(v.settledAtSeconds).toBe(120);
    expect(v.steadySeconds).toBe(120);
    expect(v.steadyDriftBufferCount).toBe(0);
    expect(v.steadyDriftGeometryCount).toBe(0);
  });

  it('counts the rebuilds absorbed after settling — a leak cannot absorb any', () => {
    const v = judgeSoak(warmThenFlat(), 240);
    expect(v.rebuildsAfterSettled).toBeGreaterThan(0);
  });

  it('a genuine leak never settles, so the steady window stays empty', () => {
    const leak = [10, 20, 30, 40, 50].map((g, i) => ({
      atSeconds: i * 30,
      gpu: {
        valid: true,
        invalidReason: '',
        textureCount: 0,
        textureSlots: 0,
        textureBytesEstimate: 0,
        bufferCount: g,
        bufferSlots: g,
        geometryCount: g,
        geometrySlots: g,
        renderTargets: INVALID_RENDER_TARGETS,
      },
    }));
    const v = judgeSoak(leak, 100);
    expect(v.flat).toBe(false);
    expect(v.settledAtSeconds).toBe(120);
    expect(v.steadySeconds).toBe(0);
    expect(v.rebuildsAfterSettled).toBe(0);
  });
});

/**
 * A null slot in `managedTextures`. PixiJS nulls the entry when a texture
 * source is destroyed rather than compacting the array, and the census read
 * `t.pixelWidth` straight off it — which throws.
 *
 * Recorded here rather than only fixed, because of how it was found: it was
 * an uncaught error at teardown in the p1-soak log AND the p2-warp-off log,
 * sitting in plain sight in both, and nothing was watching for it. Phase 1 had
 * no textures so it never fired mid-run; Phase 2's composite render texture
 * puts it on the path of the very check it would break.
 */
describe('the GPU census survives a destroyed texture', () => {
  it('skips null slots instead of throwing', () => {
    const renderer = {
      texture: { managedTextures: [{ pixelWidth: 1280, pixelHeight: 720 }, null] },
      buffer: { _managedBuffers: { items: {} } },
      geometry: { _managedGeometries: { items: {} } },
    };
    const report = readGpuResources(renderer);
    // ONE live texture and one grave. This assertion read `2` until Phase 3 —
    // it was asserting `managedTextures.length`, which is exactly the bug the
    // 20-minute soak surfaced as a 5209% false leak. The byte estimate beside
    // it always described one texture, and nobody noticed the two numbers
    // disagreeing because Phase 2 never destroyed one.
    expect(report.textureCount).toBe(1);
    expect(report.textureSlots).toBe(2);
    expect(report.textureBytesEstimate).toBe(1280 * 720 * 4);
    expect(report.valid).toBe(true);
  });
});

/**
 * The Phase 3 defect: `textureCount` was `managedTextures.length`, and PixiJS
 * nulls a destroyed entry rather than compacting the array.
 *
 * Phase 1 had no textures and Phase 2 had one composite render texture that
 * was never destroyed, so `length` and "live count" were the same number and
 * the difference could not show. Phase 3 creates and destroys a texture per
 * video and per Lottie on every scene rebuild, and the 20-minute soak read
 * 23 → 1221 across 604 rebuilds: a reported 5209% drift and a failed rolling
 * check, with `textureBytesEstimate` pinned flat at 12,861,448 the entire time.
 *
 * A9: "an instrument that emits a plausible wrong number is worse than one
 * that fails loudly." A FALSE leak is the worse kind, because it sends someone
 * hunting something that is not there and makes the next real one easier to
 * disbelieve.
 */
describe('the census counts live textures, not graves', () => {
  const withSlots = (live: (unknown | null)[]): unknown => ({
    texture: { managedTextures: live },
    // The shape PixiJS actually uses — a hash with an `items` map, not an
    // array. `countManaged` returns null for anything else and the census
    // then reports INVALID, which is A9 working.
    buffer: { _managedBuffers: { items: {} } },
    geometry: { _managedGeometries: { items: {} } },
  });
  const tex = (w: number, h: number) => ({ pixelWidth: w, pixelHeight: h });

  it('ignores null slots in the count', () => {
    const r = readGpuResources(withSlots([tex(2, 2), null, null, tex(4, 4)]));
    expect(r.valid).toBe(true);
    expect(r.textureCount).toBe(2);
    // The array's own length is reported too — as information, because it does
    // grow without bound and that is worth being able to see.
    expect(r.textureSlots).toBe(4);
  });

  it('the count and the byte estimate describe the SAME set', () => {
    // This is the property whose absence produced the false leak: a count of
    // 1221 sitting beside a flat 12.8 MB could only mean the two numbers were
    // measuring different things.
    const r = readGpuResources(withSlots([tex(10, 10), null, tex(10, 10)]));
    expect(r.textureCount).toBe(2);
    expect(r.textureBytesEstimate).toBe(2 * 10 * 10 * 4);
  });

  it('a soak that destroys and recreates textures is FLAT', () => {
    // 600 rebuilds, two textures destroyed and two created each time. Live
    // count and bytes never move; only the array's length does.
    const soak = series(
      census(4, 2, 3, 3),
      census(4, 2, 3, 603),
      census(4, 2, 3, 1203),
    );
    const v = judgeSoak(soak, 600);
    expect(v.valid).toBe(true);
    expect(v.driftTextureCount).toBe(0);
    expect(v.flat).toBe(true);
  });

  it('a REAL texture leak is still caught', () => {
    // The check must not have been softened into uselessness by the fix. Live
    // count rising is still a failure, however small the slope.
    const leaking = series(census(4, 2, 3, 3), census(4, 2, 9, 9), census(4, 2, 15, 15));
    const v = judgeSoak(leaking, 600);
    expect(v.driftTextureCount).toBeGreaterThan(0);
    expect(v.flat).toBe(false);
  });
});

/**
 * §10 row 13 — the tombstone fix, the split verdict, and K.
 *
 * The `flat: false` this project has carried since Phase 4 was not a leak and
 * was not a property of PixiJS's pooling either. `buffer._managedBuffers` is a
 * `GCManagedHash`, whose `remove()` writes `items[uid] = null` rather than
 * deleting the key, so counting keys counts graves — the identical defect the
 * texture path had already fixed twelve lines earlier in the same file.
 */
describe('row 13 — buffers and geometries stop counting graves', () => {
  it('counts LIVE entries, not keys, for buffers and geometries', () => {
    const r = readGpuResources({
      texture: { managedTextures: [] },
      // Three added, two since removed. `GCManagedHash.remove()` tombstones.
      buffer: { _managedBuffers: { items: { 1: {}, 2: null, 3: null } } },
      geometry: { _managedGeometries: { items: { 7: {}, 8: null } } },
    });
    expect(r.valid).toBe(true);
    expect(r.bufferCount).toBe(1);
    expect(r.geometryCount).toBe(1);
  });

  it('still reports the key count as slots, so the old number stays readable', () => {
    const r = readGpuResources({
      texture: { managedTextures: [] },
      buffer: { _managedBuffers: { items: { 1: {}, 2: null, 3: null } } },
      geometry: { _managedGeometries: { items: { 7: {}, 8: null } } },
    });
    expect(r.bufferSlots).toBe(3);
    expect(r.geometrySlots).toBe(2);
  });

  it('a hash that is only accumulating tombstones reads as flat on live counts', () => {
    // The exact shape row 13 is about: keys climb without bound, nothing leaks.
    const grave = (live: number, slots: number) => ({
      valid: true as const,
      invalidReason: '',
      textureCount: 2,
      textureSlots: 2,
      textureBytesEstimate: 8,
      bufferCount: live * 2,
      bufferSlots: slots * 2,
      geometryCount: live,
      geometrySlots: slots,
      renderTargets: INVALID_RENDER_TARGETS,
    });
    const v = judgeSoak(
      [grave(37, 37), grave(37, 120), grave(37, 227)].map((gpu, i) => ({
        atSeconds: i * 30,
        gpu,
      })),
      600,
    );
    expect(v.flatBuffers).toBe(true);
    expect(v.flatGeometries).toBe(true);
    expect(v.flat).toBe(true);
    // And the growth is still visible, as information, never gated.
    expect(v.driftGeometrySlots).toBeGreaterThan(5);
  });
});

describe('row 13 — the verdict is split, and the AND is preserved', () => {
  it('reports each subsystem separately', () => {
    // Textures flat, buffers and geometries growing.
    const v = judgeSoak(series(census(40, 12, 5), census(400, 120, 5)), 600);
    expect(v.flatTextures).toBe(true);
    expect(v.flatBuffers).toBe(false);
    expect(v.flatGeometries).toBe(false);
  });

  it('`flat` remains the AND, so nothing loosens by splitting it', () => {
    const v = judgeSoak(series(census(40, 12, 5), census(400, 120, 5)), 600);
    expect(v.flat).toBe(v.flatTextures && v.flatBuffers && v.flatGeometries);
    expect(v.flat).toBe(false);
  });
});

describe('row 13 — K fails in both directions and passes in neither', () => {
  // Warm-up then a long plateau, matching the measured p4-soak shape.
  const settling = (quietSamples: number): GpuSample[] => {
    const g = [19, 46, 91, 133, ...Array(quietSamples).fill(133)];
    return g.map((n, i) => ({
      atSeconds: i * 30,
      gpu: {
        valid: true as const,
        invalidReason: '',
        textureCount: 2,
        textureSlots: 2,
        textureBytesEstimate: 8,
        bufferCount: n * 2,
        bufferSlots: n * 2,
        geometryCount: n,
        geometrySlots: n,
        renderTargets: INVALID_RENDER_TARGETS,
      },
    }));
  };

  it('settles when K quiet rebuilds pass with zero post-settle drift', () => {
    // 40 samples of plateau at ~0.5 rebuilds/s over 30 s each = ~600 rebuilds.
    const v = judgeSoak(settling(40), 660, 64);
    expect(v.settled).toBe(true);
    expect(v.notSettledBecause).toBe('');
    expect(v.rebuildsAfterSettled).toBeGreaterThanOrEqual(64);
    expect(v.steadyDriftBufferCount).toBe(0);
  });

  it('K too large — never reaches the threshold, so it FAILS, not passes', () => {
    const v = judgeSoak(settling(40), 660, 100_000);
    expect(v.settled).toBe(false);
    expect(v.notSettledBecause).toMatch(/under K=100000/);
  });

  it('K too small — settles early, later growth lands post-settle, so it FAILS', () => {
    // Growth resumes after a quiet stretch: a slow leak wearing a plateau.
    const resumes: GpuSample[] = [19, 46, 91, 133, 133, 133, 180, 240].map((n, i) => ({
      atSeconds: i * 30,
      gpu: {
        valid: true as const,
        invalidReason: '',
        textureCount: 2,
        textureSlots: 2,
        textureBytesEstimate: 8,
        bufferCount: n * 2,
        bufferSlots: n * 2,
        geometryCount: n,
        geometrySlots: n,
        renderTargets: INVALID_RENDER_TARGETS,
      },
    }));
    const v = judgeSoak(resumes, 240, 1);
    expect(v.settled).toBe(false);
  });

  it('carries its own K, so a verdict can be read without knowing the default', () => {
    expect(judgeSoak(settling(40), 660, 64).settleRebuilds).toBe(64);
  });
});

describe('row 13 — the description prints both terms, never a bare ratio', () => {
  it('prints buffers and geometries as a pair at each end', () => {
    const line = describeSoak(judgeSoak(series(census(74, 37), census(454, 227)), 604));
    // The measured relation is exactly 2.00 on every scene on record; the
    // "1.20 anomaly" was 274/227 — one scene's buffers over another's
    // geometries. Both terms make that unwriteable.
    expect(line).toContain('first 74/37');
    expect(line).toContain('last 454/227');
  });

  it('never prints a lone buffers-per-geometry number', () => {
    const line = describeSoak(judgeSoak(series(census(74, 37), census(454, 227)), 604));
    expect(line).not.toMatch(/per geometry[^\n]*\b2\.00\b/);
  });

  it('states why it did not settle rather than only that it did not', () => {
    const line = describeSoak(judgeSoak(series(census(40, 12), census(400, 120)), 600));
    expect(line).toMatch(/NOT SETTLED: /);
  });

  it('reports slots beside live, labelled as never gated', () => {
    const line = describeSoak(judgeSoak(series(census(74, 37), census(454, 227)), 604));
    expect(line).toContain('never gated');
  });
});
