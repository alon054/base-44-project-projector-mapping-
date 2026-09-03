/**
 * A8 — the golden-frame resolution guard.
 *
 * SPEC.md §8.1: "Golden frames are rendered at one fixed resolution, stated in
 * the test itself, decided in Phase 1's setup and independent of DEV_RESOLUTION
 * and TARGET_RESOLUTION. If the golden resolution tracks whichever resolution
 * the app happens to run at, the first 1080p run re-blesses every golden at
 * once and the regression net is gone — silently, and in a commit that looks
 * routine."
 *
 * The decided resolution is 1280×720, which **currently equals**
 * DEV_RESOLUTION. That coincidence is the whole hazard: the two numbers look
 * identical, so "tidying" the literal into an import would look like a cleanup
 * and would silently remove the net. These tests are the tripwire on that edit.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const HARNESS = new URL('../golden/main.ts', import.meta.url).pathname;
const RUNNER = new URL('../../scripts/golden.mjs', import.meta.url).pathname;
const GOLDENS = new URL('../../test/golden/frames.json', import.meta.url).pathname;

const harness = (): string => readFileSync(HARNESS, 'utf8');

/** The decided value, restated here so a change has to be made twice. */
const DECIDED = { width: 1280, height: 720 };

describe('A8 golden resolution is fixed in the harness', () => {
  it('is a literal in the harness, not derived from anything', () => {
    const m = harness().match(
      /const GOLDEN_RESOLUTION\s*=\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}\s*as const;/,
    );
    expect(m, 'GOLDEN_RESOLUTION must be a plain object literal').not.toBeNull();
    expect(Number(m![1])).toBe(DECIDED.width);
    expect(Number(m![2])).toBe(DECIDED.height);
  });

  it('the harness imports neither DEV_RESOLUTION nor TARGET_RESOLUTION', () => {
    const code = harness()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/DEV_RESOLUTION/);
    expect(code).not.toMatch(/TARGET_RESOLUTION/);
    expect(code).not.toMatch(/@shared\/ipc/);
  });

  it('the harness never reads a resolution from a display, window or env', () => {
    const code = harness()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of [
      /window\s*\.\s*inner(Width|Height)/,
      /screen\s*\./,
      /devicePixelRatio/,
      /process\s*\.\s*env/,
      /displayFrequency/,
    ]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it('every committed golden was rendered at a resolution the harness states', () => {
    const goldens = JSON.parse(readFileSync(GOLDENS, 'utf8')) as Record<
      string,
      { width: number; height: number }
    >;
    expect(Object.keys(goldens).length).toBeGreaterThan(0);
    for (const [name, g] of Object.entries(goldens)) {
      // Either the fixed golden resolution, or an explicitly-sized I-1 case
      // whose size is spelled into its own name.
      const named = name.match(/@(\d+)x(\d+)$/);
      if (named) {
        expect([g.width, g.height], name).toEqual([Number(named[1]), Number(named[2])]);
      } else {
        expect([g.width, g.height], name).toEqual([DECIDED.width, DECIDED.height]);
      }
    }
  });
});

describe('I-1 layout check has a working negative control', () => {
  const goldens = (): Record<
    string,
    { layoutDelta: { maxCell: number } | null; expectLayoutMismatch: boolean }
  > => JSON.parse(readFileSync(GOLDENS, 'utf8'));

  it('the committed threshold sits between the measured pass and the measured control', () => {
    const limit = Number(readFileSync(RUNNER, 'utf8').match(/MAX_LAYOUT_DELTA\s*=\s*([\d.]+)/)![1]);
    const entries = Object.values(goldens()).filter((g) => g.layoutDelta !== null);
    const passes = entries.filter((g) => !g.expectLayoutMismatch).map((g) => g.layoutDelta!.maxCell);
    const controls = entries.filter((g) => g.expectLayoutMismatch).map((g) => g.layoutDelta!.maxCell);

    expect(passes.length, 'no I-1 comparison case is committed').toBeGreaterThan(0);
    expect(controls.length, 'no negative control is committed').toBeGreaterThan(0);
    // A threshold above every control would pass a moved layer; one below a
    // legitimate pass would fail on rasterization. It has to sit between them.
    expect(Math.max(...passes)).toBeLessThan(limit);
    expect(Math.min(...controls)).toBeGreaterThan(limit);
  });
});
