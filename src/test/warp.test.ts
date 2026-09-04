/**
 * I-5 — the warp is the final, isolated stage.
 *
 * "Scene logic never touches warp; warp never touches scene logic" is a claim
 * about *dependencies*, and a dependency claim is checkable by reading imports
 * rather than by reviewing behaviour. Gate 2's second condition — "no scene
 * code reads warp state" — is exactly this test in one direction.
 *
 * The warp's rendered behaviour is not here. §8.1 says the unit suite is pure
 * logic with no GPU and no DOM; what the mesh actually puts on the panel is the
 * golden harness's job, under the renderer that ships.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createAltScene, createDefaultScene } from '../core/defaultScene';

const SRC = join(import.meta.dirname, '..');

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

describe('I-5 — warp never touches scene logic', () => {
  it('render/warp.ts imports nothing from core/ or providers/', () => {
    const bad = importsOf(join(SRC, 'render', 'warp.ts')).filter(
      (i) => /(^|\/)core\//.test(i) || /(^|\/)providers\//.test(i),
    );
    expect(
      bad,
      'the warp stage reached into scene logic. It takes a Container and a ' +
        'Renderer and must know nothing else (I-5).',
    ).toEqual([]);
  });

  it('render/calibration.ts imports nothing at all', () => {
    // Pure geometry and persistence shape. If this ever needs a scene type,
    // calibration has stopped being independent of the scene (I-5) and the
    // "calibration survives a scene change" property has become a coincidence.
    expect(importsOf(join(SRC, 'render', 'calibration.ts'))).toEqual([]);
  });
});

describe('I-5 — scene logic never reads warp state (Gate 2)', () => {
  const forbidden = /render\/(warp|calibration)/;

  it('nothing under core/ imports the warp or its calibration', () => {
    const offenders = sourcesUnder(join(SRC, 'core')).filter((f) =>
      importsOf(f).some((i) => forbidden.test(i)),
    );
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('nothing under providers/ imports the warp or its calibration', () => {
    const offenders = sourcesUnder(join(SRC, 'providers')).filter((f) =>
      importsOf(f).some((i) => forbidden.test(i)),
    );
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('the compositor does not know it is being warped', () => {
    // The composite is handed to the warp stage, never the other way round. If
    // the compositor ever imports calibration, some layer is about to be
    // positioned "allowing for the warp" and I-1 stops being sufficient.
    expect(importsOf(join(SRC, 'render', 'compositor.ts')).filter((i) => forbidden.test(i))).toEqual(
      [],
    );
  });

  it('no scene JSON field mentions warp or calibration', () => {
    // I-5: calibration is persisted separately from scenes, never inside one.
    const scene = readFileSync(join(SRC, 'core', 'scene.ts'), 'utf8');
    const layer = readFileSync(join(SRC, 'core', 'layer.ts'), 'utf8');
    expect(/warp|calibrat/i.test(scene)).toBe(false);
    expect(/warp|calibrat/i.test(layer)).toBe(false);
  });
});

/**
 * A 2×2 quad is two triangles with linear UV interpolation. It CANNOT represent
 * a keystone: the projective map is not affine, so the image bends across the
 * shared diagonal — visibly, on a wall, while every golden hash stays green
 * because the hash only says "the same as last time".
 *
 * `PerspectiveMesh` fixes this by pushing vertex positions through the exact
 * homography on a subdivided plane, so the subdivision count is load-bearing
 * and not a tuning knob. This test exists because dropping it back to 2 looks
 * like a simplification and re-blessing the goldens afterwards looks routine.
 */
describe('the warp mesh is subdivided, not a bare quad', () => {
  const declaredVertices = (): number => {
    const src = readFileSync(join(SRC, 'render', 'warp.ts'), 'utf8');
    const n = Number(/const VERTICES = (\d+)/.exec(src)?.[1]);
    expect(Number.isFinite(n)).toBe(true);
    return n;
  };

  it('declares a subdivision well above 2', () => {
    expect(declaredVertices()).toBeGreaterThan(8);
  });

  it('uses PixiJS’s projective mesh rather than a plain textured quad', () => {
    const src = readFileSync(join(SRC, 'render', 'warp.ts'), 'utf8');
    expect(src).toContain('PerspectiveMesh');
    expect(src).not.toContain('MeshSimple');
  });

  /**
   * The subdivision is a measurement, not a preference, so it is re-measured
   * here rather than asserted as a magic number.
   *
   * The homography below is solved independently of PixiJS's — the point is to
   * check the tessellation choice against the exact projective map, and using
   * Pixi's own implementation to grade Pixi's own output would check nothing.
   *
   * Reported in output pixels at 1280x720. The interesting row is the first:
   * a literal 2x2 quad is off by ~92 px on the very keystone Gate 2 uses. That
   * is the affine bend, it is visible from across a room, and NO golden hash
   * would ever report it — a hash only says "the same as last time".
   */
  const homography = (q: number[]) => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = q as number[] & { length: 8 };
    const dx1 = x1! - x2!, dx2 = x3! - x2!, sx = x0! - x1! + x2! - x3!;
    const dy1 = y1! - y2!, dy2 = y3! - y2!, sy = y0! - y1! + y2! - y3!;
    if (sx === 0 && sy === 0) {
      return { a: x1! - x0!, b: x3! - x0!, c: x0!, d: y1! - y0!, e: y3! - y0!, f: y0!, g: 0, h: 0 };
    }
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (sx * dy2 - dx2 * sy) / den;
    const h = (dx1 * sy - sx * dy1) / den;
    return {
      a: x1! - x0! + g * x1!, b: x3! - x0! + h * x3!, c: x0!,
      d: y1! - y0! + g * y1!, e: y3! - y0! + h * y3!, f: y0!,
      g, h,
    };
  };

  type H = ReturnType<typeof homography>;
  const project = (m: H, u: number, v: number): [number, number] => {
    const w = m.g * u + m.h * v + 1;
    return [(m.a * u + m.b * v + m.c) / w, (m.d * u + m.e * v + m.f) / w];
  };

  /** Worst gap between the rendered (per-triangle affine) and exact positions. */
  const maxDeviationPx = (quad: number[], n: number, samples = 300): number => {
    const m = homography(quad);
    const grid: [number, number][][] = [];
    for (let j = 0; j < n; j++) {
      const row: [number, number][] = [];
      for (let i = 0; i < n; i++) row.push(project(m, i / (n - 1), j / (n - 1)));
      grid.push(row);
    }
    let max = 0;
    for (let s = 0; s <= samples; s++) {
      for (let t = 0; t <= samples; t++) {
        const u = s / samples;
        const v = t / samples;
        const ci = Math.min(n - 2, Math.floor(u * (n - 1)));
        const cj = Math.min(n - 2, Math.floor(v * (n - 1)));
        const lu = u * (n - 1) - ci;
        const lv = v * (n - 1) - cj;
        const p00 = grid[cj]![ci]!, p10 = grid[cj]![ci + 1]!;
        const p11 = grid[cj + 1]![ci + 1]!, p01 = grid[cj + 1]![ci]!;
        // PlaneGeometry splits each cell into (00,10,11) and (00,11,01).
        const [w0, w1, w2, q1, q2] =
          lu >= lv
            ? ([1 - lu, lu - lv, lv, p10, p11] as const)
            : ([1 - lv, lv - lu, lu, p01, p11] as const);
        const px = w0 * p00[0] + w1 * q1[0] + w2 * q2[0];
        const py = w0 * p00[1] + w1 * q1[1] + w2 * q2[1];
        const [ex, ey] = project(m, u, v);
        const d = Math.hypot(px - ex, py - ey);
        if (d > max) max = d;
      }
    }
    return max;
  };

  const W = 1280;
  const HH = 720;
  // The same keystone the golden `warp-keystone` case uses.
  const gateKeystone = [0.12 * W, 0, 0.88 * W, 0, W, HH, 0, HH];
  // Harsher and off-axis: nothing about the choice should depend on symmetry.
  const harsh = [0.3 * W, 0.05 * HH, 0.95 * W, 0, W, HH, 0.02 * W, 0.9 * HH];

  it('a bare 2x2 quad is off by tens of pixels — the reason this is not one', () => {
    expect(maxDeviationPx(gateKeystone, 2)).toBeGreaterThan(50);
    expect(maxDeviationPx(harsh, 2)).toBeGreaterThan(50);
  });

  it('the declared subdivision holds the warp under half a pixel', () => {
    const n = declaredVertices();
    const gate = maxDeviationPx(gateKeystone, n);
    const hard = maxDeviationPx(harsh, n);
    expect(gate).toBeLessThan(0.5);
    expect(hard).toBeLessThan(0.5);
  });
});

/**
 * Gate 2: "loading a different scene keeps the same calibration."
 *
 * The scene bank is Phase 6, so the honest test is a second CONSTRUCTED scene
 * through the editor's existing path. Two things have to hold for that to mean
 * anything, and only one of them is about the warp.
 */
describe('Gate 2 — the second scene is a real second scene', () => {
  it('is not the default scene with a different id', () => {
    const a = createDefaultScene();
    const b = createAltScene();
    expect(b.id).not.toBe(a.id);
    // Phase 1 shipped two added layers that were pixel-identical and it cost
    // three rounds of clicking at a wall. A scene switch the operator cannot
    // SEE proves nothing about whether the calibration survived it.
    expect(b.layers.map((l) => l.id)).not.toEqual(a.layers.map((l) => l.id));
    expect(b.layers.length).toBeGreaterThan(2);
    const tints = new Set(b.layers.map((l) => JSON.stringify(l.content)));
    expect(tints.size).toBeGreaterThan(1);
  });

  it('carries no calibration of its own — the warp is not scene state (I-5)', () => {
    for (const scene of [createDefaultScene(), createAltScene()]) {
      expect(/warp|calibrat|corner/i.test(JSON.stringify(scene))).toBe(false);
    }
  });
});
