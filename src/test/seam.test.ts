/**
 * D5 — loop-seam handling and sprite-sheet frame selection, as pure arithmetic
 * (§8.1: unit tests need no GPU).
 *
 * The crossfade's whole claim is that **each copy's weight is exactly zero at
 * its own seam**, so the discontinuity is multiplied by nothing. That is a
 * property, not a look, and it is checkable — which is why it is worth having
 * chosen a weighting that can be checked rather than one that is tuned by eye.
 */
import { describe, expect, it } from 'vitest';
import {
  SEAM_MODES,
  crossfadeSeam,
  defaultSeamMode,
  frameAt,
  frameCell,
  isSeamMode,
  noSeam,
  seamWeights,
} from '../providers/bundled/seam';

describe('crossfade weights (D5)', () => {
  it('gives the primary copy zero weight at its own seam', () => {
    // Phase 0 and phase 1 are the same instant and are where copy A jumps.
    expect(crossfadeSeam(0).weightA).toBeCloseTo(0, 12);
    expect(crossfadeSeam(1).weightA).toBeCloseTo(0, 12);
    expect(crossfadeSeam(0.999999).weightA).toBeLessThan(0.0001);
  });

  it('gives the secondary copy zero weight at ITS seam, half a period away', () => {
    expect(crossfadeSeam(0.5).weightB).toBeCloseTo(0, 12);
    expect(crossfadeSeam(0.5).weightA).toBeCloseTo(1, 12);
  });

  it('always sums to exactly 1, so the layer never pulses', () => {
    // Un-normalized, sin+|cos| peaks at sqrt(2) at the quarter points and sits
    // at 1 at the seams — the layer would brighten by 41% twice per loop,
    // which is a different artefact in place of the one being removed.
    for (let i = 0; i <= 200; i++) {
      const w = crossfadeSeam(i / 200);
      expect(w.weightA + w.weightB).toBeCloseTo(1, 12);
      expect(w.weightA).toBeGreaterThanOrEqual(0);
      expect(w.weightB).toBeGreaterThanOrEqual(0);
    }
  });

  it('is continuous across the seam — no step in either weight', () => {
    // The point of the whole design. Sample either side of phase 0 and require
    // the weights to meet.
    const before = crossfadeSeam(1 - 1e-6);
    const after = crossfadeSeam(1e-6);
    expect(Math.abs(before.weightA - after.weightA)).toBeLessThan(1e-4);
    expect(Math.abs(before.weightB - after.weightB)).toBeLessThan(1e-4);
  });

  it('places the second copy exactly half a period ahead', () => {
    for (const p of [0, 0.1, 0.49, 0.5, 0.51, 0.99]) {
      const w = crossfadeSeam(p);
      expect(w.phaseB).toBeCloseTo((p + 0.5) % 1, 12);
    }
  });

  it('wraps a phase outside [0,1) rather than producing nonsense', () => {
    expect(crossfadeSeam(1.25).phaseA).toBeCloseTo(0.25, 12);
    expect(crossfadeSeam(-0.25).phaseA).toBeCloseTo(0.75, 12);
    expect(crossfadeSeam(Number.NaN).weightA).toBe(1);
  });

  it('none mode is one copy at full weight', () => {
    const w = noSeam(0.3);
    expect(w).toEqual({ phaseA: 0.3, phaseB: 0.3, weightA: 1, weightB: 0 });
    expect(seamWeights('none', 0.3)).toEqual(w);
    expect(seamWeights('crossfade', 0.3)).toEqual(crossfadeSeam(0.3));
  });
});

describe('the default seam mode comes from the asset, not from memory', () => {
  it('leaves a seamless asset alone', () => {
    // A crossfade on a seamless loop costs a second draw and removes nothing.
    expect(defaultSeamMode(true, 'spritesheet')).toBe('none');
    expect(defaultSeamMode(true, 'lottie')).toBe('none');
  });

  it('crossfades a non-seamless sheet or Lottie', () => {
    expect(defaultSeamMode(false, 'spritesheet')).toBe('crossfade');
    expect(defaultSeamMode(false, 'lottie')).toBe('crossfade');
  });

  it('never defaults VIDEO to crossfade, even when non-seamless', () => {
    // §5: "each `<video>` runs its own decoder ... use sparingly, cap hard."
    // A crossfade is a second decoder, so the operator turns it on knowing the
    // cost rather than inheriting it from an asset's metadata.
    expect(defaultSeamMode(false, 'video')).toBe('none');
    expect(defaultSeamMode(true, 'video')).toBe('none');
  });

  it('validates the stored mode', () => {
    expect(SEAM_MODES).toEqual(['none', 'crossfade']);
    expect(isSeamMode('none')).toBe(true);
    expect(isSeamMode('crossfade')).toBe(true);
    expect(isSeamMode('fade')).toBe(false);
    expect(isSeamMode(3)).toBe(false);
  });
});

describe('sprite-sheet frame selection', () => {
  it('divides the loop into equal frames', () => {
    // Floor, not round. `round` would show frame 0 for the first and last half
    // frame, making frame 0 twice as long as every other frame — a visible
    // hitch at the seam of an otherwise even animation.
    expect(frameAt(0, 4)).toBe(0);
    expect(frameAt(0.24, 4)).toBe(0);
    expect(frameAt(0.25, 4)).toBe(1);
    expect(frameAt(0.75, 4)).toBe(3);
    expect(frameAt(0.999, 4)).toBe(3);
  });

  it('never returns an index past the end, even at the top of the range', () => {
    for (const frames of [1, 2, 9, 25, 60]) {
      for (const p of [0.9999999999, 1 - Number.EPSILON, 1, 1 - 1e-17]) {
        const i = frameAt(p, frames);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(frames);
      }
    }
  });

  it('matches the frames Gate 3’s scene will actually show', () => {
    // The golden `bundled-spritesheets` case renders at t = 1 s. A 2.5 s sheet
    // of 25 frames is then at frame 10, and a 1.8 s sheet of 9 at frame 5 —
    // two different frames from ONE clock, computed by hand here so the golden
    // is checked against arithmetic rather than against itself.
    expect(frameAt((1 / 2.5) % 1, 25)).toBe(10);
    expect(frameAt((1 / 1.8) % 1, 9)).toBe(5);
  });

  it('holds still for a nonsense frame count rather than throwing', () => {
    expect(frameAt(0.5, 0)).toBe(0);
    expect(frameAt(0.5, -3)).toBe(0);
    expect(frameAt(0.5, Number.NaN)).toBe(0);
  });

  it('maps a frame index to a row-major cell', () => {
    expect(frameCell(0, 5)).toEqual({ col: 0, row: 0 });
    expect(frameCell(4, 5)).toEqual({ col: 4, row: 0 });
    expect(frameCell(5, 5)).toEqual({ col: 0, row: 1 });
    expect(frameCell(24, 5)).toEqual({ col: 4, row: 4 });
    expect(frameCell(8, 3)).toEqual({ col: 2, row: 2 });
  });

  it('every frame of the shipped sheets lands in a distinct cell', async () => {
    const { createBundledLibrary } = await import('../providers/bundled/manifest');
    for (const s of createBundledLibrary().ofKind('spritesheet')) {
      if (s.kind !== 'spritesheet') continue;
      const seen = new Set<string>();
      for (let i = 0; i < s.frames; i++) {
        const { col, row } = frameCell(i, s.columns);
        expect(col).toBeLessThan(s.columns);
        expect(row).toBeLessThan(s.rows);
        seen.add(`${col},${row}`);
      }
      // Two frames sharing a cell means the animation silently repeats one.
      expect(seen.size).toBe(s.frames);
    }
  });
});
