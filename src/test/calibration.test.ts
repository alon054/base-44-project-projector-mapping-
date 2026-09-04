/**
 * I-5 — warp calibration. Pure geometry and persistence shape, no GPU (§8.1).
 */
import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_VERSION,
  CORNER_LABELS,
  calibrationFor,
  canonicalizeCalibrationFile,
  createCalibration,
  createCalibrationFile,
  describeCalibration,
  identityCorners,
  isIdentityCorners,
  isUsableQuad,
  quadArea,
  quadFault,
  resetCorners,
  toPixelCorners,
  withCorner,
  withEnabled,
  withViewportCalibration,
  type CalibrationCorners,
} from '../render/calibration';

const corners = (...pts: [number, number][]): CalibrationCorners =>
  [
    { x: pts[0]![0], y: pts[0]![1] },
    { x: pts[1]![0], y: pts[1]![1] },
    { x: pts[2]![0], y: pts[2]![1] },
    { x: pts[3]![0], y: pts[3]![1] },
  ] as CalibrationCorners;

describe('identity', () => {
  it('is the full output rect, clockwise from top-left', () => {
    expect(identityCorners()).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(quadArea(identityCorners())).toBeCloseTo(1, 12);
    expect(isIdentityCorners(identityCorners())).toBe(true);
    expect(isUsableQuad(identityCorners())).toBe(true);
  });

  it('starts disabled, so a first run projects exactly what Phase 1 projected', () => {
    expect(createCalibration('main').enabled).toBe(false);
  });

  /** I-1 as a total check: no field of a calibration may leave [0, 1]. */
  it('stores no pixel value', () => {
    for (const p of createCalibration('main').corners) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('quad health', () => {
  it('accepts an ordinary keystone', () => {
    // Top edge pulled in: the shape a projector angled below the surface makes.
    expect(quadFault(corners([0.1, 0], [0.9, 0], [1, 1], [0, 1]))).toBeNull();
  });

  it('refuses a quad whose corners have crossed', () => {
    // TL dragged past TR. Self-intersecting: the homography is not invertible.
    expect(quadFault(corners([1, 0], [0, 0], [1, 1], [0, 1]))).toBe('inverted');
  });

  it('refuses a reflex vertex', () => {
    expect(quadFault(corners([0, 0], [1, 0], [0.4, 0.4], [0, 1]))).toBe('inverted');
  });

  it('refuses a collinear (zero-area) quad rather than emitting NaN vertices', () => {
    expect(quadFault(corners([0, 0], [1, 0], [1, 0], [0, 0]))).not.toBeNull();
  });

  it('refuses a needle', () => {
    expect(quadFault(corners([0, 0], [1, 0], [1, 0.005], [0, 0.005]))).toBe('edge-too-short');
  });

  it('names non-finite and out-of-range faults distinctly', () => {
    expect(quadFault(corners([Number.NaN, 0], [1, 0], [1, 1], [0, 1]))).toBe('not-finite');
    expect(quadFault(corners([-0.5, 0], [1, 0], [1, 1], [0, 1]))).toBe('out-of-range');
  });
});

describe('withCorner', () => {
  it('moves one corner and leaves the others alone', () => {
    const moved = withCorner(createCalibration('main'), 0, { x: 0.2, y: 0.1 });
    expect(moved.corners[0]).toEqual({ x: 0.2, y: 0.1 });
    expect(moved.corners[1]).toEqual({ x: 1, y: 0 });
  });

  it('clamps a drag past the output edge instead of storing a pixel-ish value', () => {
    const moved = withCorner(createCalibration('main'), 0, { x: -3, y: 0.2 });
    expect(moved.corners[0]).toEqual({ x: 0, y: 0.2 });
  });

  /**
   * The clamp runs first and the quad check second, and the order is load-
   * bearing: clamping TL to (0, 1) puts it exactly on BL, which is degenerate.
   * So a wild drag is not clamped into a broken quad — it is refused outright.
   */
  it('refuses a drag whose clamped position would still be degenerate', () => {
    const cal = createCalibration('main');
    expect(withCorner(cal, 0, { x: -3, y: 42 })).toBe(cal);
  });

  it('refuses a move that would destroy the quad, returning the last good state', () => {
    const cal = createCalibration('main');
    // Dragging TL beyond TR would self-intersect. The drag stops; it does not tear.
    const same = withCorner(cal, 0, { x: 1, y: 0.5 });
    expect(same.corners).toEqual(cal.corners);
    expect(same).toBe(cal);
  });

  it('does not mutate its input', () => {
    const cal = createCalibration('main');
    const before = JSON.stringify(cal);
    withCorner(cal, 2, { x: 0.8, y: 0.9 });
    expect(JSON.stringify(cal)).toBe(before);
  });

  it('resets to identity', () => {
    const warped = withCorner(createCalibration('main'), 0, { x: 0.15, y: 0.05 });
    expect(isIdentityCorners(warped.corners)).toBe(false);
    expect(isIdentityCorners(resetCorners(warped).corners)).toBe(true);
  });

  it('toggling enabled leaves the corners untouched', () => {
    const warped = withCorner(createCalibration('main'), 0, { x: 0.15, y: 0.05 });
    expect(withEnabled(warped, true).corners).toEqual(warped.corners);
    expect(withEnabled(withEnabled(warped, true), false).corners).toEqual(warped.corners);
  });
});

describe('persistence', () => {
  const warped = withEnabled(withCorner(createCalibration('main'), 0, { x: 0.12, y: 0.04 }), true);

  it('round-trips deep-equal through JSON', () => {
    const file = withViewportCalibration(createCalibrationFile(), warped);
    const back = canonicalizeCalibrationFile(JSON.parse(JSON.stringify(file)));
    expect(back).toEqual(file);
    expect(JSON.stringify(canonicalizeCalibrationFile(JSON.parse(JSON.stringify(back))))).toBe(
      JSON.stringify(back),
    );
  });

  it('never throws on junk — a bad file must not stop the session (I-13)', () => {
    for (const junk of [null, 3, 'x', [], {}, { version: 1 }, { version: 1, viewports: 7 }]) {
      expect(() => canonicalizeCalibrationFile(junk)).not.toThrow();
      expect(canonicalizeCalibrationFile(junk).viewports).toEqual([]);
    }
  });

  it('refuses a future version whole rather than half-interpreting it', () => {
    const future = { version: CALIBRATION_VERSION + 1, viewports: [warped] };
    expect(canonicalizeCalibrationFile(future).viewports).toEqual([]);
  });

  it('loads a degenerate stored quad as identity instead of failing to open', () => {
    const bad = {
      version: CALIBRATION_VERSION,
      viewports: [{ viewportId: 'main', enabled: true, corners: identityCorners().slice().reverse() }],
    };
    const loaded = canonicalizeCalibrationFile(bad).viewports[0]!;
    expect(isIdentityCorners(loaded.corners)).toBe(true);
    expect(loaded.enabled).toBe(true);
  });

  it('drops entries with no id or a malformed corner list', () => {
    const raw = {
      version: CALIBRATION_VERSION,
      viewports: [
        { enabled: true, corners: identityCorners() },
        { viewportId: 'a', enabled: true, corners: [{ x: 0, y: 0 }] },
        { viewportId: 'b', enabled: true, corners: identityCorners() },
      ],
    };
    expect(canonicalizeCalibrationFile(raw).viewports.map((v) => v.viewportId)).toEqual(['b']);
  });

  it('keeps the first of duplicate viewport ids', () => {
    const raw = {
      version: CALIBRATION_VERSION,
      viewports: [
        { viewportId: 'main', enabled: true, corners: identityCorners() },
        { viewportId: 'main', enabled: false, corners: identityCorners() },
      ],
    };
    const out = canonicalizeCalibrationFile(raw).viewports;
    expect(out).toHaveLength(1);
    expect(out[0]!.enabled).toBe(true);
  });

  it('gives an unknown viewport a fresh identity calibration (I-9: keyed, not singleton)', () => {
    const file = withViewportCalibration(createCalibrationFile(), warped);
    expect(calibrationFor(file, 'main')).toEqual(warped);
    const second = calibrationFor(file, 'second');
    expect(second.enabled).toBe(false);
    expect(isIdentityCorners(second.corners)).toBe(true);
  });

  it('replaces rather than appends when the viewport is already present', () => {
    const file = withViewportCalibration(createCalibrationFile(), warped);
    const again = withViewportCalibration(file, withEnabled(warped, false));
    expect(again.viewports).toHaveLength(1);
    expect(again.viewports[0]!.enabled).toBe(false);
  });
});

describe('draw time', () => {
  it('derives pixels from normalized corners at whatever resolution is live (I-1)', () => {
    const c = corners([0.1, 0], [0.9, 0], [1, 1], [0, 1]);
    expect(toPixelCorners(c, 1280, 720)).toEqual([128, 0, 1152, 0, 1280, 720, 0, 720]);
    expect(toPixelCorners(c, 1920, 1080)).toEqual([192, 0, 1728, 0, 1920, 1080, 0, 1080]);
  });

  it('identity corners map to the exact output rect', () => {
    expect(toPixelCorners(identityCorners(), 1280, 720)).toEqual([0, 0, 1280, 0, 1280, 720, 0, 720]);
  });
});

describe('the [warp] log line', () => {
  it('states on/off and every corner, so warp state is readable from a wall', () => {
    const line = describeCalibration(createCalibration('main'));
    expect(line.startsWith('[warp] main: OFF')).toBe(true);
    expect(line).toContain('identity');
    for (const label of CORNER_LABELS) expect(line).toContain(label);
  });

  it('reports the area once the quad is no longer the identity', () => {
    const warped = withEnabled(withCorner(createCalibration('main'), 0, { x: 0.2, y: 0.1 }), true);
    const line = describeCalibration(warped);
    expect(line).toContain('ON');
    expect(line).toContain('area=');
    expect(line).toContain('TL(0.2000,0.1000)');
  });
});
