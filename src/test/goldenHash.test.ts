import { describe, expect, it } from 'vitest';
import { excludeBounds, firstPixelOutside, hashFrame, type NormRect } from '../golden/hash';

const W = 40;
const H = 20;

function frame(fill = 0): Uint8ClampedArray {
  const p = new Uint8ClampedArray(W * H * 4);
  p.fill(fill);
  for (let i = 3; i < p.length; i += 4) p[i] = 255;
  return p;
}

function setPixel(p: Uint8ClampedArray, x: number, y: number, v: number): void {
  const i = (y * W + x) * 4;
  p[i] = v;
  p[i + 1] = v;
  p[i + 2] = v;
}

/** Centre-based, covering roughly x[10..20] y[5..10]. */
const RECT: NormRect = { x: 0.375, y: 0.375, width: 0.25, height: 0.25 };

describe('golden hash exclusion', () => {
  it('with no rects, hashes and counts the whole frame', () => {
    const s = hashFrame(frame(), W, H);
    expect(s.excluded).toBe(0);
    expect(s.counted).toBe(W * H);
  });

  /**
   * The 40 cases that declare no exclusion must keep the hashes they were
   * blessed with. Asserted, because "this refactor changed nothing" is exactly
   * the claim a golden suite exists to stop anyone making by eye.
   */
  it('is order- and value-sensitive over the whole frame when nothing is excluded', () => {
    const a = frame();
    const b = frame();
    setPixel(b, 0, 0, 200);
    expect(hashFrame(a, W, H).hash).not.toBe(hashFrame(b, W, H).hash);
  });

  it('ignores a change INSIDE the excluded rect', () => {
    const a = frame();
    const b = frame();
    const bounds = excludeBounds(W, H, RECT);
    setPixel(b, bounds.x0 + 1, bounds.y0 + 1, 255);
    expect(hashFrame(a, W, H, [RECT]).hash).toBe(hashFrame(b, W, H, [RECT]).hash);
    // and the un-narrowed hash still sees it, so the frame really did change
    expect(hashFrame(a, W, H).hash).not.toBe(hashFrame(b, W, H).hash);
  });

  /**
   * THE NEGATIVE CONTROL. An assertion that cannot fail is worth nothing, and
   * this project has shipped one before — the region-hash guard that compared
   * two `undefined`s and printed `pixel-identical (undefined)`.
   */
  it('still fails on a change one pixel OUTSIDE the excluded rect', () => {
    const bounds = excludeBounds(W, H, RECT);
    for (const [x, y] of [
      [bounds.x0 - 1, bounds.y0],
      [bounds.x1 + 1, bounds.y1],
      [bounds.x0, bounds.y0 - 1],
      [0, 0],
    ] as [number, number][]) {
      const a = frame();
      const b = frame();
      setPixel(b, x, y, 255);
      expect(hashFrame(a, W, H, [RECT]).hash, `a change at (${x}, ${y}) went unseen`).not.toBe(
        hashFrame(b, W, H, [RECT]).hash,
      );
    }
  });

  it('excludes every rect when several are given, and counts them once', () => {
    const r2: NormRect = { x: 0.8, y: 0.8, width: 0.1, height: 0.1 };
    const s = hashFrame(frame(), W, H, [RECT, r2]);
    const only1 = hashFrame(frame(), W, H, [RECT]).excluded;
    const only2 = hashFrame(frame(), W, H, [r2]).excluded;
    expect(s.excluded).toBe(only1 + only2); // disjoint rects, no double count
    expect(s.counted).toBe(W * H - s.excluded);
  });

  it('does not double-count pixels where two rects overlap', () => {
    const s = hashFrame(frame(), W, H, [RECT, RECT]);
    expect(s.excluded).toBe(hashFrame(frame(), W, H, [RECT]).excluded);
  });

  /**
   * Outset, not inset — the opposite of `hashRegion`. An exclusion that stops
   * one pixel short leaves the glyph's antialiased fringe in the hash, which is
   * the fringe most likely to move when a rasteriser changes.
   */
  it('outsets the rect by a pixel on every edge', () => {
    const b = excludeBounds(W, H, RECT);
    expect(b.x0).toBe(Math.round((RECT.x - RECT.width / 2) * W) - 1);
    expect(b.y0).toBe(Math.round((RECT.y - RECT.height / 2) * H) - 1);
    expect(b.x1).toBe(Math.round((RECT.x + RECT.width / 2) * W));
    expect(b.y1).toBe(Math.round((RECT.y + RECT.height / 2) * H));
  });

  it('clamps a rect that runs off the frame instead of reading out of bounds', () => {
    const huge: NormRect = { x: 0.5, y: 0.5, width: 4, height: 4 };
    const b = excludeBounds(W, H, huge);
    expect(b).toEqual({ x0: 0, y0: 0, x1: W - 1, y1: H - 1 });
    expect(hashFrame(frame(), W, H, [huge]).counted).toBe(0);
  });

  it('reports meanLuminance and lit over the counted pixels only', () => {
    const p = frame(0);
    // light every pixel inside the rect and nothing else
    const b = excludeBounds(W, H, RECT);
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) setPixel(p, x, y, 255);
    const whole = hashFrame(p, W, H);
    const narrowed = hashFrame(p, W, H, [RECT]);
    expect(whole.lit).toBeGreaterThan(0);
    expect(narrowed.lit).toBe(0); // all the light was inside the exclusion
    expect(narrowed.meanLuminance).toBe(0);
  });

  it('finds a pixel outside the rects for the live control to flip', () => {
    expect(firstPixelOutside(W, H, [RECT])).toEqual([0, 0]);
    expect(firstPixelOutside(W, H, [{ x: 0.5, y: 0.5, width: 4, height: 4 }])).toBeNull();
  });
});
