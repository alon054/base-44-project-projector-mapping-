import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CH, PARAM_TEST_PATTERN_SPEED, assertJsonOnly } from '@shared/ipc';
import { createDefaultScene } from '../core/defaultScene';
import { SceneFormatError, canonicalizeScene, deserializeScene, serializeScene } from '../core/scene';
import { createSurface } from '../core/surfaces';
import { createPath } from '../core/paths';
import { writeSurfaces } from '../render/calibration';

describe('assertJsonOnly — I-7, no pixel buffers over IPC', () => {
  it('passes a realistic parameter payload', () => {
    const p = { key: PARAM_TEST_PATTERN_SPEED, value: 1.5, token: 7, t0: 1234.5 };
    expect(assertJsonOnly(p)).toBe(p);
  });

  it('passes nested plain structures', () => {
    expect(() =>
      assertJsonOnly({ a: [1, 'two', null, true, { b: [] }], c: {} }),
    ).not.toThrow();
  });

  it('rejects a typed array — the case the guard exists for', () => {
    expect(() => assertJsonOnly(new Float32Array(4))).toThrow(/I-7/);
    expect(() => assertJsonOnly(new Uint8ClampedArray(16))).toThrow(/I-7/);
  });

  it('rejects an ArrayBuffer', () => {
    expect(() => assertJsonOnly(new ArrayBuffer(8))).toThrow(/I-7/);
  });

  it('rejects a buffer smuggled inside a plain object', () => {
    expect(() => assertJsonOnly({ frame: { pixels: new Uint8Array(4) } })).toThrow(
      /payload\.frame\.pixels/,
    );
  });

  it('rejects a buffer smuggled inside an array', () => {
    expect(() => assertJsonOnly([{ ok: 1 }, new Uint16Array(2)])).toThrow(/payload\[1\]/);
  });

  it('rejects non-JSON scalars', () => {
    expect(() => assertJsonOnly(Number.NaN)).toThrow(/not JSON-representable/);
    expect(() => assertJsonOnly(Number.POSITIVE_INFINITY)).toThrow(/not JSON-representable/);
    expect(() => assertJsonOnly(undefined)).toThrow(/undefined is not JSON/);
    expect(() => assertJsonOnly(10n)).toThrow(/bigint/);
    expect(() => assertJsonOnly(Symbol('x'))).toThrow(/symbols/);
    expect(() => assertJsonOnly(() => 1)).toThrow(/functions/);
  });

  it('rejects class instances, including Date and Map', () => {
    expect(() => assertJsonOnly(new Date())).toThrow(/only plain objects/);
    expect(() => assertJsonOnly(new Map())).toThrow(/only plain objects/);
    expect(() => assertJsonOnly(new Set([1]))).toThrow(/only plain objects/);
  });

  it('rejects circular references instead of hanging', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => assertJsonOnly(a)).toThrow(/circular/);
  });

  it('accepts null and reuses object identity for repeat visits', () => {
    const shared = { v: 1 };
    expect(() => assertJsonOnly({ a: shared, b: shared, c: null })).not.toThrow();
  });
});

/**
 * I-7 re-verified for Phase 1's new scene-state channel. The rolling check
 * asks for this at every gate, not once — a channel added after Gate 0 is
 * exactly what the "at every gate" is for.
 */
describe('I-7 — the scene channel carries state, never pixels', () => {
  it('a real scene passes the guard', () => {
    const scene = createDefaultScene();
    expect(() => assertJsonOnly({ scene })).not.toThrow();
    // And survives the trip it is about to make.
    expect(deserializeScene(serializeScene(scene))).toEqual(scene);
  });

  it('a scene carrying a pixel buffer is refused at the send site', () => {
    const scene = createDefaultScene();
    const smuggled = {
      scene: {
        ...scene,
        layers: [{ ...scene.layers[0], content: { atlas: new Uint8ClampedArray(64) } }],
      },
    };
    expect(() => assertJsonOnly(smuggled)).toThrow(/I-7/);
  });

  it('and refused again by the scene format, before it reaches the guard', () => {
    expect(() =>
      canonicalizeScene({
        id: 's',
        layers: [{ id: 'a', providerId: 'p', content: { atlas: new Uint8ClampedArray(4) } }],
      }),
    ).toThrow(SceneFormatError);
  });
});

/**
 * The guard is only worth having if it is on every send site. Checked
 * mechanically rather than by review, because "someone will remember" is how
 * the one unguarded channel gets added.
 */
describe('I-7 — every renderer send passes through the guard', () => {
  it('no ipcRenderer.send or invoke carries an unguarded payload', () => {
    const preload = readFileSync(
      new URL('../../electron/preload.ts', import.meta.url).pathname,
      'utf8',
    );
    const calls = preload.match(/ipcRenderer\.(send|invoke)\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(5);
    for (const call of calls) {
      // A send with no payload at all is fine; anything with one must be guarded.
      const args = call.slice(call.indexOf('(') + 1, -1).split(',');
      if (args.length < 2) continue;
      expect(call, `unguarded IPC send site: ${call}`).toContain('assertJsonOnly');
    }
  });
});

/**
 * I-5 + I-7 — the calibration channel.
 *
 * It is separate from `scene:set` on purpose. One shared channel would make
 * "loading a different scene keeps the same calibration" (Gate 2) a property of
 * message ordering rather than of the design, and I-5 says these are different
 * kinds of state that are persisted to different places.
 */
describe('I-5 — calibration crosses on its own channel', () => {
  it('is a distinct channel from the scene', () => {
    expect(CH.calibrationSet).not.toBe(CH.sceneSet);
    expect(CH.calibrationGet).not.toBe(CH.sceneSet);
    // Distinct values, so a typo cannot alias two channels onto one string.
    const values = Object.values(CH);
    expect(new Set(values).size).toBe(values.length);
  });

  it('a real calibration payload passes the guard', () => {
    const payload = {
      viewportId: 'main',
      enabled: true,
      corners: [
        { x: 0.12, y: 0 },
        { x: 0.88, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    };
    expect(assertJsonOnly(payload)).toBe(payload);
  });

  it('refuses a pixel buffer smuggled in as corners', () => {
    // The same I-7 hole `canonicalizeScene` had: a typed array is an object
    // with numeric keys, so anything that only checks "is it an object" lets a
    // frame buffer through on a channel that is supposed to carry eight floats.
    expect(() =>
      assertJsonOnly({ viewportId: 'main', enabled: true, corners: new Float32Array(8) }),
    ).toThrow();
  });
});

/**
 * I-15 / B3 — the ROOM crosses on its own channel, and it is a third one.
 *
 * The same argument that separated the warp from the scene, applied once more:
 * the room and the warp are edited by different gestures at different moments,
 * so sharing a channel would make "re-marking a face leaves the warp alone" a
 * property of message ordering. Both are calibration and both are persisted in
 * `calibration/` — I-5 says calibration is kept apart from scenes, not that it
 * is one file.
 *
 * This channel is also the only one in the app that carries a POINTER DRAG, so
 * the I-7 guard on it is load-bearing rather than ceremonial: it is exercised
 * sixty times a second while somebody's hand is on a face.
 */
describe('I-15 — the surface tree crosses on its own channel', () => {
  it('is distinct from both the scene and the warp', () => {
    expect(CH.surfacesSet).not.toBe(CH.sceneSet);
    expect(CH.surfacesSet).not.toBe(CH.calibrationSet);
    expect(CH.surfacesGet).not.toBe(CH.calibrationGet);
    const values = Object.values(CH);
    expect(new Set(values).size).toBe(values.length);
  });

  it('a real room payload passes the guard', () => {
    const payload = writeSurfaces([
      createSurface({
        id: 'surface-1',
        name: 'face 1',
        role: 'panel',
        path: createPath({
          id: 'path-1',
          closed: true,
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.4, y: 0.2 },
            { x: 0.4, y: 0.5 },
          ],
        }),
      }),
    ]);
    expect(assertJsonOnly(payload)).toBe(payload);
  });

  it('refuses a pixel buffer smuggled in as a path', () => {
    // I-1 says a stored point is normalized and I-7 says no pixels cross. A
    // typed array of coordinates would satisfy neither and is an object with
    // numeric keys, which is exactly what the guard exists to catch.
    expect(() =>
      assertJsonOnly({
        version: 1,
        surfaces: [{ id: 'surface-1', path: { id: 'p', points: new Float32Array(8) } }],
      }),
    ).toThrow();
  });
});
