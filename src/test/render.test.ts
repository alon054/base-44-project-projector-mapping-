/**
 * I-6 (blend modes) and I-9 (output is a list). Pure logic — the mapping table
 * and the output shape, not the GPU. The rendered result is checked by the
 * golden-frame smoke test and, for I-6, by a human on a wall (Gate 1).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BLEND_MODES } from '../core/layer';
import { NATIVE_PIXI_BLEND_MODES, fromPixiBlendMode, toPixiBlendMode } from '../render/blend';
import { createOutputs, primaryViewport, resizeOutput } from '../render/outputs';

describe('I-6 blend modes', () => {
  it('declares exactly the four modes SPEC.md I-6 names', () => {
    expect([...BLEND_MODES]).toEqual(['normal', 'add', 'multiply', 'screen']);
  });

  it('every engine mode maps to a mode PixiJS handles natively', () => {
    // If a future mode needs `pixi.js/advanced-blend-modes`, it costs a filter
    // pass per use. This test is where that becomes a decision instead of a
    // surprise in a frame-time graph.
    for (const mode of BLEND_MODES) {
      expect(NATIVE_PIXI_BLEND_MODES).toContain(toPixiBlendMode(mode));
    }
  });

  it('round-trips back to the engine vocabulary', () => {
    for (const mode of BLEND_MODES) {
      expect(fromPixiBlendMode(toPixiBlendMode(mode))).toBe(mode);
    }
    expect(fromPixiBlendMode('color-dodge')).toBeNull();
  });
});

describe('I-9 output is a list, not a singleton', () => {
  it('v1 builds an array of length 1', () => {
    const outputs = createOutputs(1280, 720);
    expect(Array.isArray(outputs.viewports)).toBe(true);
    expect(outputs.viewports).toHaveLength(1);
    expect(primaryViewport(outputs)).toEqual({ id: 'main', width: 1280, height: 720 });
  });

  it('resizes by id, leaving the shape alone', () => {
    const outputs = resizeOutput(createOutputs(1280, 720), 'main', 1920, 1080);
    expect(primaryViewport(outputs)).toEqual({ id: 'main', width: 1920, height: 1080 });
  });

  it('an empty viewport list fails loudly rather than rendering nowhere', () => {
    expect(() => primaryViewport({ viewports: [] })).toThrow(/I-9/);
  });
});

describe('CLAUDE.md rule 6 / I-12 — no Math.random in providers', () => {
  it('src/providers contains no call to Math.random', () => {
    const root = new URL('../providers/', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.ts')) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // The rule is about the call, not the word. Comments here name
      // `Math.random()` in order to forbid it, so prose is stripped first and
      // the grep runs over code only.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/Math\s*\.\s*random\s*\(/);
    }
  });
});
