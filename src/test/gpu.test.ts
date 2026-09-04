/**
 * §8.2's soak check: "texture memory flat over a 5-minute soak with motion".
 *
 * The census itself needs a GPU, so what is tested here is the part that can be
 * wrong silently — the probing and the judgement. A9's rule governs both: an
 * instrument that reports a plausible "no leak" because it lost its way into
 * the renderer is worse than one that fails loudly.
 */
import { describe, expect, it } from 'vitest';
import { judgeSoak, readGpuResources, type GpuSample } from '../debug/gpu';

const census = (buffers: number, geometries: number, textures = 0) => ({
  valid: true,
  invalidReason: '',
  textureCount: textures,
  textureBytesEstimate: textures * 1024,
  bufferCount: buffers,
  geometryCount: geometries,
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
        textureBytesEstimate: 8,
        bufferCount: g * 2,
        geometryCount: g,
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
        textureBytesEstimate: 0,
        bufferCount: g,
        geometryCount: g,
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
    expect(report.textureCount).toBe(2);
    expect(report.textureBytesEstimate).toBe(1280 * 720 * 4);
    expect(report.valid).toBe(true);
  });
});
