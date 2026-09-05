/**
 * P5-E / D11. The preview's scene-space grid, as geometry.
 *
 * The claim the block's gate cares about — "visible in the preview and absent
 * from the output" — is not testable here and is not tested here: it is a
 * property of the import graph, and `sceneEdit.test.ts` already asserts that
 * neither the output window nor the golden harness can reach
 * `editor/PreviewCanvas.tsx`, which is the file the grid lives in.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GRID_DIVISIONS, gridLines } from '../editor/grid';

describe('the scene-space grid (D11)', () => {
  it('draws n-1 interior lines per axis', () => {
    const lines = gridLines(8);
    expect(lines.filter((l) => l.axis === 'x')).toHaveLength(7);
    expect(lines.filter((l) => l.axis === 'y')).toHaveLength(7);
  });

  it('is normalized, strictly inside the frame — no pixels anywhere (I-1)', () => {
    for (const l of gridLines(GRID_DIVISIONS)) {
      expect(l.at).toBeGreaterThan(0);
      expect(l.at).toBeLessThan(1);
    }
  });

  it('omits the frame edge — the border draws it, and a line at 0 would clip', () => {
    const at = gridLines(4).map((l) => l.at);
    expect(at).not.toContain(0);
    expect(at).not.toContain(1);
  });

  it('puts one line on the centre of each axis and calls it that', () => {
    const centres = gridLines(8).filter((l) => l.weight === 'centre');
    expect(centres).toHaveLength(2);
    expect(centres.map((l) => l.at)).toEqual([0.5, 0.5]);
    expect(centres.map((l) => l.axis)).toEqual(['x', 'y']);
  });

  it('emphasises the quarters, and only the quarters', () => {
    const major = gridLines(8)
      .filter((l) => l.axis === 'x' && l.weight === 'major')
      .map((l) => l.at);
    expect(major).toEqual([0.25, 0.75]);
  });

  /**
   * The emphasis must not depend on which division count the operator picked.
   * `m / 4m` is exact for every `m`, which is why `weightAt` can compare
   * exactly — see its comment, and the mutation that proved the tolerance it
   * used to carry was untestable.
   */
  it('finds the quarters at every division count that has them', () => {
    for (const n of [4, 8, 12, 20, 100]) {
      const major = gridLines(n)
        .filter((l) => l.axis === 'x' && l.weight === 'major')
        .map((l) => l.at);
      expect(major, `divisions=${n}`).toEqual([0.25, 0.75]);
      expect(gridLines(n).filter((l) => l.axis === 'x' && l.weight === 'centre')).toHaveLength(1);
    }
  });

  it('has no major or centre lines when the divisions do not land on a quarter', () => {
    const weights = gridLines(3).map((l) => l.weight);
    expect(new Set(weights)).toEqual(new Set(['minor']));
  });

  it('spaces the lines evenly', () => {
    const xs = gridLines(4)
      .filter((l) => l.axis === 'x')
      .map((l) => l.at);
    expect(xs).toEqual([0.25, 0.5, 0.75]);
  });

  it('refuses a division count it cannot draw, naming it', () => {
    expect(() => gridLines(1)).toThrow(/got 1/);
    expect(() => gridLines(0)).toThrow(RangeError);
    expect(() => gridLines(-4)).toThrow(/got -4/);
    expect(() => gridLines(2.5)).toThrow(/got 2.5/);
  });

  it('defaults to the constant, so the preview and a test cannot disagree', () => {
    expect(gridLines()).toEqual(gridLines(GRID_DIVISIONS));
  });
});

describe('the grid is drawn from the geometry, not redrawn beside it', () => {
  it('PreviewCanvas maps every grid coordinate through px/py', () => {
    const text = readFileSync(
      new URL('../editor/PreviewCanvas.tsx', import.meta.url).pathname,
      'utf8',
    );
    const grid = text.slice(text.indexOf('function SceneGrid'), text.indexOf('const GRID_STROKE'));
    expect(grid).toContain('gridLines()');
    // I-1: the preview's pixel size reaches the overlay only through px/py.
    expect(grid).not.toMatch(/PREVIEW_SIZE/);
  });
});
