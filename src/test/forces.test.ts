/**
 * I-4 and I-14 — the force bus.
 *
 * The tests that matter most here are not the arithmetic ones. Phase 4's named
 * failure mode is a force bus that is provably correct and whose effect nobody
 * can see, and no unit test can catch that — the gate's wall session and the
 * `[force]` log line are what cover it. What a unit test CAN cover, and what
 * would be expensive to discover late, is the mechanism's shape: that
 * susceptibility scales correctly for both kinds of axis, that a force's
 * evaluation is a pure function of clock time so a scrub is exact, and above
 * all that **adding a force is data**. The last of those is Gate 4's I-14
 * condition, and it is tested three ways below: by adding one, by proving the
 * bus does not name any, and by proving the registry grows without an edit.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARALLAX,
  DEPTH_GAIN_FAR,
  DEPTH_GAIN_NEAR,
  EMPTY_FORCE_FIELD,
  FORCE_AXES,
  FORCE_AXIS_SPECS,
  PARALLAX_RANGE,
  clampSusceptibility,
  defaultForceValues,
  depthGain,
  evaluateForces,
  identityModulation,
  isIdentityModulation,
  valueNoise,
  type ForceDefinition,
  type ForceSubject,
} from '../core/forces';
import { FOG, FORCE_DEFINITIONS, RAIN, TIME_OF_DAY, WIND, forceById } from '../core/forceDefs';
import { createLayer } from '../core/layer';
import { createPhase4ReferenceScene } from '../core/defaultScene';

/** A plain subject. `Layer` satisfies this structurally; the bus needs no scene. */
function subject(over: Partial<ForceSubject> = {}): ForceSubject {
  return { id: 'e1', depth: 0.5, seed: 7, susceptibility: {}, ...over };
}

function field(
  definitions: readonly ForceDefinition[],
  values: Record<string, Record<string, number>> = {},
  over: { timeSeconds?: number; seed?: number; parallax?: { x: number; y: number } } = {},
) {
  return evaluateForces({
    definitions,
    values,
    timeSeconds: over.timeSeconds ?? 0,
    seed: over.seed ?? 0x4f0,
    parallax: over.parallax ?? DEFAULT_PARALLAX,
  });
}

/* -------------------------------------------------------------------------- */

describe('the axis vocabulary', () => {
  it('every axis has a spec, and identity matches its combine rule', () => {
    for (const axis of FORCE_AXES) {
      const spec = FORCE_AXIS_SPECS[axis];
      expect(spec.id).toBe(axis);
      // A summed axis must have identity 0 and a multiplied one identity 1, or
      // `identityModulation` is not the identity of the accumulator and a scene
      // with no forces would not be a scene with no modulation.
      expect(spec.identity).toBe(spec.combine === 'sum' ? 0 : 1);
      expect(spec.min).toBeLessThanOrEqual(spec.identity);
      expect(spec.max).toBeGreaterThanOrEqual(spec.identity);
    }
  });

  it('the identity modulation is the identity', () => {
    expect(isIdentityModulation(identityModulation())).toBe(true);
  });

  it('the tint axes cannot brighten — PixiJS tint is multiply-only', () => {
    for (const axis of ['tintR', 'tintG', 'tintB'] as const) {
      expect(FORCE_AXIS_SPECS[axis].max).toBe(1);
    }
    // A force that tries to brighten is clamped, not honoured. Brightening is a
    // grade operation (Phase 9) or an `add` layer, never a tint.
    const bright: ForceDefinition = {
      id: 'bright',
      label: 'Bright',
      axes: ['tintR'],
      defaultSusceptibility: 1,
      params: [],
      evaluate: () => ({ tintR: 4 }),
    };
    expect(field([bright]).modulationFor(subject()).tintR).toBe(1);
  });
});

describe('susceptibility (I-4)', () => {
  const push: ForceDefinition = {
    id: 'push',
    label: 'Push',
    axes: ['offsetX', 'opacity'],
    defaultSusceptibility: 1,
    params: [],
    evaluate: () => ({ offsetX: 0.2, opacity: 0.5 }),
  };

  it('0 leaves an entity at identity on every axis', () => {
    const m = field([push]).modulationFor(subject({ susceptibility: { push: 0 } }));
    expect(m.offsetX).toBe(0);
    expect(m.opacity).toBe(1);
  });

  it('1 applies the force in full', () => {
    // depth 1 so the depth gain on the offset axes is exactly 1 and the number
    // under test is the susceptibility rather than a product of the two.
    const m = field([push]).modulationFor(subject({ depth: 1, susceptibility: { push: 1 } }));
    expect(m.offsetX).toBeCloseTo(0.2, 10);
    expect(m.opacity).toBeCloseTo(0.5, 10);
  });

  it('lerps toward the identity, which is halfway for BOTH kinds of axis', () => {
    const m = field([push]).modulationFor(subject({ depth: 1, susceptibility: { push: 0.5 } }));
    // Summed axis: identity 0, so half of 0.2.
    expect(m.offsetX).toBeCloseTo(0.1, 10);
    // Multiplied axis: identity 1, so halfway from 1 to 0.5.
    expect(m.opacity).toBeCloseTo(0.75, 10);
  });

  it('falls back to the definition default when the entity states nothing', () => {
    const half: ForceDefinition = { ...push, defaultSusceptibility: 0.5 };
    const f = field([half]);
    expect(f.susceptibility(subject(), 'push')).toBe(0.5);
    // Stating it wins, including stating zero.
    expect(f.susceptibility(subject({ susceptibility: { push: 0 } }), 'push')).toBe(0);
  });

  it('is clamped to [0, 1] — an entity may not over-respond', () => {
    expect(clampSusceptibility(2)).toBe(1);
    expect(clampSusceptibility(-1)).toBe(0);
    expect(clampSusceptibility(Number.NaN)).toBe(0);
  });
});

describe('combining forces', () => {
  const a: ForceDefinition = {
    id: 'a',
    label: 'A',
    axes: ['offsetX', 'opacity'],
    defaultSusceptibility: 1,
    params: [],
    evaluate: () => ({ offsetX: 0.1, opacity: 0.5 }),
  };
  const b: ForceDefinition = { ...a, id: 'b', label: 'B' };

  it('sums the summed axes and multiplies the multiplied ones', () => {
    const m = field([a, b]).modulationFor(subject({ depth: 1 }));
    expect(m.offsetX).toBeCloseTo(0.2, 10);
    expect(m.opacity).toBeCloseTo(0.25, 10);
  });

  it('drops an axis the definition did not declare', () => {
    // The `axes` list is a contract, not a comment: data added in under 30
    // minutes at a gate is exactly the code most likely to be wrong, and a
    // force that quietly acquired a new capability would be an axis nobody
    // reviewed reaching the renderer.
    const sneaky: ForceDefinition = {
      id: 'sneaky',
      label: 'Sneaky',
      axes: ['offsetX'],
      defaultSusceptibility: 1,
      params: [],
      evaluate: () => ({ offsetX: 0.1, scale: 3 }),
    };
    expect(field([sneaky]).modulationFor(subject()).scale).toBe(1);
  });

  it('a force that throws costs its own contribution, not the frame (I-13)', () => {
    const bad: ForceDefinition = {
      id: 'bad',
      label: 'Bad',
      axes: ['offsetX'],
      defaultSusceptibility: 1,
      params: [],
      evaluate: () => {
        throw new Error('a fifth force with a bug in it');
      },
    };
    const m = field([bad, a]).modulationFor(subject({ depth: 1 }));
    expect(m.offsetX).toBeCloseTo(0.1, 10);
    expect(m.opacity).toBeCloseTo(0.5, 10);
  });

  it('an unsubscribed force costs nothing and contributes nothing', () => {
    const m = field([a]).modulationFor(subject({ susceptibility: { a: 0 } }));
    expect(isIdentityModulation(m)).toBe(true);
  });
});

describe('parameters', () => {
  it('reads scene values, and falls back to the definition default', () => {
    const f = field(FORCE_DEFINITIONS, { wind: { strength: 0.8 } });
    expect(f.param('wind', 'strength')).toBe(0.8);
    expect(f.param('wind', 'gustiness')).toBe(0.4);
  });

  it('clamps a stored value to the definition range', () => {
    expect(field(FORCE_DEFINITIONS, { wind: { strength: 9 } }).param('wind', 'strength')).toBe(1);
    expect(field(FORCE_DEFINITIONS, { wind: { strength: -9 } }).param('wind', 'strength')).toBe(0);
  });

  it('an unknown force or key reads 0 rather than throwing', () => {
    const f = field(FORCE_DEFINITIONS);
    expect(f.param('nosuchforce', 'x')).toBe(0);
    expect(f.param('wind', 'nosuchkey')).toBe(0);
  });

  it('defaultForceValues states every parameter of every force', () => {
    const values = defaultForceValues(FORCE_DEFINITIONS);
    for (const def of FORCE_DEFINITIONS) {
      for (const p of def.params) expect(values[def.id]?.[p.key]).toBe(p.default);
    }
  });
});

describe('depth and parallax (D3)', () => {
  it('near layers respond more than far ones', () => {
    expect(depthGain(0)).toBe(DEPTH_GAIN_FAR);
    expect(depthGain(1)).toBe(DEPTH_GAIN_NEAR);
    expect(depthGain(0.5)).toBeGreaterThan(depthGain(0.2));
    expect(DEPTH_GAIN_NEAR).toBeGreaterThan(DEPTH_GAIN_FAR);
  });

  it('centred parallax moves nothing', () => {
    const m = field([], {}, { parallax: { x: 0.5, y: 0.5 } }).modulationFor(subject());
    expect(m.offsetX).toBe(0);
    expect(m.offsetY).toBe(0);
  });

  it('a swept viewpoint moves a near layer further than a far one', () => {
    const f = field([], {}, { parallax: { x: 1, y: 0.5 } });
    const near = f.modulationFor(subject({ depth: 1 })).offsetX;
    const far = f.modulationFor(subject({ depth: 0 })).offsetX;
    expect(near).toBeCloseTo(PARALLAX_RANGE * DEPTH_GAIN_NEAR, 10);
    expect(far).toBeCloseTo(PARALLAX_RANGE * DEPTH_GAIN_FAR, 10);
    // Gate 4's third condition, as a number.
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far));
  });

  it('depth scales a FORCE offset too, so wind alone demonstrates D3', () => {
    const f = field(FORCE_DEFINITIONS, { wind: { strength: 1 } }, { timeSeconds: 3 });
    const near = Math.abs(f.modulationFor(subject({ depth: 1, susceptibility: { wind: 1 } })).offsetX);
    const far = Math.abs(f.modulationFor(subject({ depth: 0, susceptibility: { wind: 1 } })).offsetX);
    expect(near).toBeGreaterThan(far);
  });

  it('offsets stay inside the axis range at maximum everything', () => {
    const f = field(
      FORCE_DEFINITIONS,
      { wind: { strength: 1, gustiness: 1 } },
      { timeSeconds: 12.3, parallax: { x: 1, y: 0 } },
    );
    for (const depth of [0, 0.5, 1]) {
      const m = f.modulationFor(subject({ depth, susceptibility: { wind: 1 } }));
      expect(m.offsetX).toBeGreaterThanOrEqual(FORCE_AXIS_SPECS.offsetX.min);
      expect(m.offsetX).toBeLessThanOrEqual(FORCE_AXIS_SPECS.offsetX.max);
      expect(Math.abs(m.rotate)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('determinism (I-2, I-12)', () => {
  it('the same arguments give the same modulation, every time', () => {
    const s = subject({ depth: 0.4, seed: 99, susceptibility: { wind: 0.8 } });
    const once = field(FORCE_DEFINITIONS, { wind: { strength: 0.6 } }, { timeSeconds: 7.25 });
    const twice = field(FORCE_DEFINITIONS, { wind: { strength: 0.6 } }, { timeSeconds: 7.25 });
    expect(once.modulationFor(s)).toEqual(twice.modulationFor(s));
  });

  it('is a pure function of clock time, so a scrub lands exactly (I-2)', () => {
    const s = subject({ susceptibility: { wind: 1 } });
    const at = (t: number) =>
      field(FORCE_DEFINITIONS, { wind: { strength: 0.7 } }, { timeSeconds: t }).modulationFor(s);
    // Visit 9.5 s the long way and the short way. Nothing accumulates, so the
    // two must agree exactly — the property Gate 3 established for loops and
    // that a gust would break if it integrated its own history.
    const walked = [0, 1.5, 3, 4.5, 6, 7.5, 9.5].map(at).at(-1);
    expect(walked).toEqual(at(9.5));
  });

  it('a different scene seed gives a different gust (I-12)', () => {
    const s = subject({ susceptibility: { wind: 1 } });
    const a = field(FORCE_DEFINITIONS, { wind: { strength: 1 } }, { timeSeconds: 5, seed: 1 });
    const b = field(FORCE_DEFINITIONS, { wind: { strength: 1 } }, { timeSeconds: 5, seed: 2 });
    expect(a.modulationFor(s).offsetX).not.toBe(b.modulationFor(s).offsetX);
  });

  it('entities do not move in lockstep — wind, not a conveyor belt', () => {
    const f = field(FORCE_DEFINITIONS, { wind: { strength: 1 } }, { timeSeconds: 4 });
    const one = f.modulationFor(subject({ id: 'a', seed: 11, susceptibility: { wind: 1 } }));
    const two = f.modulationFor(subject({ id: 'b', seed: 22, susceptibility: { wind: 1 } }));
    expect(one.offsetX).not.toBe(two.offsetX);
  });

  describe('valueNoise', () => {
    it('stays in [-1, 1] and is reproducible', () => {
      for (let i = 0; i < 200; i++) {
        const t = i * 0.37;
        const v = valueNoise(1234, t);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
        expect(valueNoise(1234, t)).toBe(v);
      }
    });

    it('is continuous — no corner for a gust to glitch on', () => {
      let prev = valueNoise(99, 0);
      for (let t = 0.01; t < 20; t += 0.01) {
        const v = valueNoise(99, t);
        // A lattice step is at most 2 wide; 0.01 of a step cannot jump far.
        expect(Math.abs(v - prev)).toBeLessThan(0.1);
        prev = v;
      }
    });

    it('handles negative time without wrapping into a different stream', () => {
      expect(valueNoise(5, -3.5)).toBe(valueNoise(5, -3.5));
      expect(Number.isFinite(valueNoise(5, -3.5))).toBe(true);
    });
  });
});

describe('the empty field is the identity of the whole system', () => {
  it('modulates nothing, for any subject', () => {
    for (const depth of [0, 0.33, 1]) {
      expect(isIdentityModulation(EMPTY_FORCE_FIELD.modulationFor(subject({ depth })))).toBe(true);
    }
    expect(EMPTY_FORCE_FIELD.ids()).toEqual([]);
    expect(EMPTY_FORCE_FIELD.param('wind', 'strength')).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* I-14 — Gate 4's condition, tested three ways                               */
/* -------------------------------------------------------------------------- */

describe('I-14 — a force is data, not a branch in the bus', () => {
  /**
   * A force that is NOT shipped, added the way Gate 4 requires: as a
   * definition, with no edit anywhere else. If this needed a change in
   * `forces.ts`, the compositor, the registry or the log to work, the test
   * would not compile or would fail.
   *
   * `current` and not `fog`: `fog` is now a shipped force (it WAS this test's
   * synthetic, and adding it for real was Gate 4's timed exercise), and a
   * synthetic that collides with a shipped id tests the registry's collision
   * detection instead of the mechanism. `current` is I-14's own second example.
   */
  const CURRENT: ForceDefinition = {
    id: 'current',
    label: 'Current',
    axes: ['tintR', 'tintG', 'tintB', 'opacity'],
    defaultSusceptibility: 1,
    params: [{ key: 'density', label: 'Density', min: 0, max: 1, default: 0, step: 0.01 }],
    evaluate: (ctx) => {
      const d = ctx.param('density');
      // Distance haze: the far plane fogs out first. `ctx.depth` is why a force
      // gets the subject's depth at all.
      const k = d * (1 - ctx.depth);
      return { tintR: 1 - 0.1 * k, tintG: 1 - 0.05 * k, tintB: 1, opacity: 1 - 0.6 * k };
    },
  };

  it('a force this build does not ship modulates with no change to the bus', () => {
    const withCurrent = [...FORCE_DEFINITIONS, CURRENT];
    const f = field(withCurrent, { current: { density: 1 } });
    const far = f.modulationFor(subject({ depth: 0 }));
    const near = f.modulationFor(subject({ depth: 1 }));
    expect(far.opacity).toBeCloseTo(0.4, 10);
    expect(near.opacity).toBeCloseTo(1, 10);
    expect(far.tintB).toBe(1);
    expect(far.tintR).toBeLessThan(1);
  });

  it('and it composes with the forces already there', () => {
    const f = field([...FORCE_DEFINITIONS, CURRENT], {
      current: { density: 1 },
      timeOfDay: { hour: 0 },
    });
    const m = f.modulationFor(subject({ depth: 0 }));
    // Both the night ramp and the haze have pulled red down; the axes multiplied.
    expect(m.tintR).toBeLessThan(0.3);
  });

  it('the bus names no force, in code', () => {
    // Prose in this project deliberately discusses wind and fog by name — the
    // I-5 registry grep already has a documented false-positive mode of exactly
    // this kind (BUILD_LOG.md). So comments are stripped and the grep runs over
    // code only.
    const code = (path: string): string =>
      readFileSync(new URL(path, import.meta.url).pathname, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

    for (const path of ['../core/forces.ts', '../render/compositor.ts', '../core/parameters.ts']) {
      const src = code(path);
      for (const def of FORCE_DEFINITIONS) {
        expect(
          src,
          `${path} names the force "${def.id}" in code. I-14: a force is a ` +
            'definition registered into the registry, not a branch inside the bus.',
        ).not.toContain(def.id);
      }
    }
  });

  it('no Math.random in the force system (rule 6 / I-12)', () => {
    for (const path of ['../core/forces.ts', '../core/forceDefs.ts']) {
      const src = readFileSync(new URL(path, import.meta.url).pathname, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, path).not.toMatch(/Math\s*\.\s*random\s*\(/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The four v1 forces                                                         */
/* -------------------------------------------------------------------------- */

describe('the four v1 forces', () => {
  it('ships the four SPEC.md v1 names plus the Gate 4 fifth, each unique', () => {
    // SPEC.md I-14 names four v1 forces and says they are "the first four
    // instances of the mechanism, not the mechanism itself". `fog` is the fifth,
    // added at Gate 4 as the timed I-14 exercise and kept — it is I-14's own
    // first example of what adding one should cost.
    expect(FORCE_DEFINITIONS.map((d) => d.id)).toEqual([
      'wind',
      'rain',
      'timeOfDay',
      'temperature',
      'fog',
    ]);
    expect(new Set(FORCE_DEFINITIONS.map((d) => d.id)).size).toBe(FORCE_DEFINITIONS.length);
    expect(forceById('wind')).toBe(WIND);
    expect(forceById('nope')).toBeUndefined();
  });

  it('every parameter has a usable range with its default inside it', () => {
    for (const def of FORCE_DEFINITIONS) {
      expect(def.params.length, def.id).toBeGreaterThan(0);
      for (const p of def.params) {
        expect(p.min, `${def.id}.${p.key}`).toBeLessThan(p.max);
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
        expect(p.step).toBeGreaterThan(0);
      }
      expect(def.axes.length, def.id).toBeGreaterThan(0);
    }
  });

  it('every force is inert at its own defaults', () => {
    // A scene that has never been touched must look like a scene with no
    // forces, or "turn the wind up" has no baseline to be judged against.
    const f = field(FORCE_DEFINITIONS, defaultForceValues(FORCE_DEFINITIONS));
    expect(isIdentityModulation(f.modulationFor(subject()))).toBe(true);
  });

  describe('wind', () => {
    it('is inert at strength 0 and moves at strength 1', () => {
      const s = subject({ depth: 1, susceptibility: { wind: 1 } });
      expect(field([WIND], { wind: { strength: 0 } }, { timeSeconds: 2 }).modulationFor(s).offsetX)
        .toBe(0);
      expect(
        Math.abs(field([WIND], { wind: { strength: 1 } }, { timeSeconds: 2 }).modulationFor(s).offsetX),
      ).toBeGreaterThan(0.01);
    });

    it('moves by a visible amount — not two pixels', () => {
      // Phase 4's named failure mode, as a number. At DEV_RESOLUTION 0.03 of
      // the width is 38 px, which is unmistakable across a room. Sampled over
      // time because the displacement oscillates.
      const s = subject({ depth: 1, susceptibility: { wind: 1 } });
      let peak = 0;
      for (let t = 0; t < 12; t += 0.05) {
        const m = field([WIND], { wind: { strength: 1 } }, { timeSeconds: t }).modulationFor(s);
        peak = Math.max(peak, Math.abs(m.offsetX));
      }
      expect(peak).toBeGreaterThan(0.03);
    });

    it('blows along its direction', () => {
      const s = subject({ depth: 1, susceptibility: { wind: 1 } });
      // A quarter turn puts the steady push on Y instead of X.
      const across = field(
        [WIND],
        { wind: { strength: 1, direction: 0.25, gustiness: 0 } },
        { timeSeconds: 1 },
      ).modulationFor(s);
      expect(Math.abs(across.offsetX)).toBeLessThan(1e-12);
      expect(Math.abs(across.offsetY)).toBeGreaterThan(0);
    });

    it('leans downwind rather than spinning', () => {
      const s = subject({ depth: 1, susceptibility: { wind: 1 } });
      const m = field([WIND], { wind: { strength: 1, gustiness: 0 } }, { timeSeconds: 0.5 })
        .modulationFor(s);
      // Same sign as the push: a tree leans the way the wind goes.
      expect(Math.sign(m.rotate)).toBe(Math.sign(m.offsetX));
    });
  });

  describe('timeOfDay', () => {
    it('is exactly neutral at noon and dark and blue at midnight', () => {
      const noon = field([TIME_OF_DAY], { timeOfDay: { hour: 12 } }).modulationFor(subject());
      expect(noon.tintR).toBeCloseTo(1, 6);
      expect(noon.tintG).toBeCloseTo(1, 6);
      expect(noon.tintB).toBeCloseTo(1, 6);

      const night = field([TIME_OF_DAY], { timeOfDay: { hour: 0 } }).modulationFor(subject());
      expect(night.tintR).toBeLessThan(0.4);
      expect(night.tintB).toBeGreaterThan(night.tintR);
    });

    it('sweeps smoothly — no step anywhere across the day (Gate 4)', () => {
      let prev = field([TIME_OF_DAY], { timeOfDay: { hour: 0 } }).modulationFor(subject());
      for (let h = 0.02; h <= 24; h += 0.02) {
        const m = field([TIME_OF_DAY], { timeOfDay: { hour: h } }).modulationFor(subject());
        for (const axis of ['tintR', 'tintG', 'tintB'] as const) {
          expect(Math.abs(m[axis] - prev[axis]), `step at hour ${h} on ${axis}`).toBeLessThan(0.01);
        }
        prev = m;
      }
    });

    it('is periodic in 24 h, so the sweep has no seam at either end', () => {
      const at0 = field([TIME_OF_DAY], { timeOfDay: { hour: 0 } }).modulationFor(subject());
      const at24 = field([TIME_OF_DAY], { timeOfDay: { hour: 24 } }).modulationFor(subject());
      expect(at24.tintR).toBeCloseTo(at0.tintR, 10);
      expect(at24.tintB).toBeCloseTo(at0.tintB, 10);
    });

    it('reaches every entity by default — the no-per-layer-seams condition', () => {
      expect(TIME_OF_DAY.defaultSusceptibility).toBe(1);
      const f = field(FORCE_DEFINITIONS, { timeOfDay: { hour: 3 } });
      const a = f.modulationFor(subject({ id: 'a', seed: 1 }));
      const b = f.modulationFor(subject({ id: 'b', seed: 2, depth: 1 }));
      // Two layers that state nothing get the SAME light. Different depths do
      // not change tint — only the offset axes are depth-scaled.
      expect(a.tintR).toBeCloseTo(b.tintR, 12);
      expect(a.tintG).toBeCloseTo(b.tintG, 12);
      expect(a.tintB).toBeCloseTo(b.tintB, 12);
    });
  });

  describe('rain', () => {
    it('contributes only a tint — drops are content, not an axis', () => {
      expect(RAIN.axes).toEqual(['tintR', 'tintG', 'tintB']);
      const m = field([RAIN], { rain: { intensity: 1, wetness: 1 } }).modulationFor(subject());
      expect(m.offsetX).toBe(0);
      expect(m.opacity).toBe(1);
      // Wet reads darker and cooler: blue survives more than red.
      expect(m.tintR).toBeLessThan(m.tintB);
      expect(m.tintR).toBeLessThan(1);
    });

    it('is inert at intensity 0 whatever the wetness', () => {
      const m = field([RAIN], { rain: { intensity: 0, wetness: 1 } }).modulationFor(subject());
      expect(isIdentityModulation(m)).toBe(true);
    });
  });

  describe('temperature', () => {
    it('is neutral at 0.5, warm above it and cool below it', () => {
      const t = (warmth: number) =>
        field(FORCE_DEFINITIONS, { temperature: { warmth } }).modulationFor(subject());
      expect(isIdentityModulation(t(0.5))).toBe(true);
      // Warm: blue drops away. Cool: red drops away.
      expect(t(1).tintB).toBeLessThan(t(1).tintR);
      expect(t(0).tintR).toBeLessThan(t(0).tintB);
    });
  });
});

describe('fog — the fifth force, shipped (Gate 4, I-14)', () => {
  it('hazes the far plane and leaves the near plane alone', () => {
    const f = field(FORCE_DEFINITIONS, { fog: { density: 1 } });
    const far = f.modulationFor(subject({ depth: 0 }));
    const near = f.modulationFor(subject({ depth: 1 }));
    expect(far.opacity).toBeCloseTo(0.35, 10);
    expect(near.opacity).toBeCloseTo(1, 10);
    // Blue survives further than red — haze is cool, not merely dim.
    expect(far.tintB).toBeGreaterThan(far.tintR);
  });

  it('never fades a layer to nothing — on black, gone is not misty', () => {
    for (let d = 0; d <= 1; d += 0.05) {
      const m = field(FORCE_DEFINITIONS, { fog: { density: 1 } })
        .modulationFor(subject({ depth: d }));
      expect(m.opacity).toBeGreaterThanOrEqual(0.35);
    }
  });

  it('is the first force to use ctx.depth, which is why it is a real test', () => {
    const f = field(FORCE_DEFINITIONS, { fog: { density: 0.7 } });
    const a = f.modulationFor(subject({ depth: 0.2 }));
    const b = f.modulationFor(subject({ depth: 0.8 }));
    expect(a.opacity).toBeLessThan(b.opacity);
  });

  it('is inert at its default, like every other force', () => {
    expect(FOG.params.find((p) => p.key === 'density')!.default).toBe(0);
    expect(isIdentityModulation(field([FOG]).modulationFor(subject()))).toBe(true);
  });
});

/**
 * The engine's half of the operator's colour-shift report (see
 * `createPhase4ReferenceScene`). If the reference patch is provably immune to
 * every force at every value, then a patch that DOES shift on the wall is
 * evidence about the projector rather than about this code — which is the only
 * way to tell the two apart, since both look like "the colours moved a bit".
 */
describe('the reference patch cannot be modulated (colour-shift diagnosis)', () => {
  const scene = createPhase4ReferenceScene();
  const patch = scene.layers.find((l) => l.id === 'reference')!;

  it('states an explicit zero for every shipped force', () => {
    // Explicit, not omitted: an omitted force takes its definition's default,
    // and `timeOfDay` defaults to 1. Omission would make the patch the most
    // tint-susceptible thing on the wall rather than the least.
    for (const def of FORCE_DEFINITIONS) {
      expect(patch.susceptibility[def.id], def.id).toBe(0);
    }
    expect(patch.depth, 'depth 0 so parallax cannot move it either').toBe(0);
  });

  it('is the identity under every force at full travel, at any time', () => {
    const extremes: Record<string, Record<string, number>> = {
      wind: { strength: 1, direction: 0.37, gustiness: 1 },
      rain: { intensity: 1, wetness: 1 },
      timeOfDay: { hour: 0 },
      temperature: { warmth: 1 },
      fog: { density: 1 },
    };
    for (let t = 0; t < 30; t += 0.37) {
      const f = evaluateForces({
        definitions: FORCE_DEFINITIONS,
        values: extremes,
        timeSeconds: t,
        seed: scene.seed,
        // Parallax swept to the corner as well — `depth 0` is what stops it.
        parallax: { x: 1, y: 0 },
      });
      expect(isIdentityModulation(f.modulationFor(patch)), `t=${t.toFixed(2)}`).toBe(true);
    }
  });

  it('and the witnesses DO move, so a frozen patch is not a frozen scene', () => {
    const f = evaluateForces({
      definitions: FORCE_DEFINITIONS,
      values: { wind: { strength: 1 }, timeOfDay: { hour: 0 } },
      timeSeconds: 3,
      seed: scene.seed,
    });
    const wind = scene.layers.find((l) => l.id === 'witness-wind')!;
    const tint = scene.layers.find((l) => l.id === 'witness-tint')!;
    expect(f.modulationFor(wind).offsetX).not.toBe(0);
    expect(f.modulationFor(tint).tintR).toBeLessThan(1);
    // ...and each witness moves on ONLY its own axis, so the operator can
    // attribute what they see to the control they touched.
    expect(f.modulationFor(wind).tintR).toBe(1);
    expect(f.modulationFor(tint).offsetX).toBe(0);
  });
});

describe('a Layer is a ForceSubject without adapting it', () => {
  it('the bus takes a layer directly', () => {
    const layer = createLayer({
      id: 'tree',
      providerId: 'procedural',
      depth: 1,
      susceptibility: { wind: 1 },
    });
    const m = field(FORCE_DEFINITIONS, { wind: { strength: 1 } }, { timeSeconds: 3 })
      .modulationFor(layer);
    expect(Number.isFinite(m.offsetX)).toBe(true);
    expect(m.offsetX).not.toBe(0);
  });
});
