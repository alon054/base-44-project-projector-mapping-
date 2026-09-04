/**
 * The warp editor's handle geometry.
 *
 * This is a regression test for a control that could not be used. The first
 * wall session's log shows TL never leaving (0.1200, 0.0000) and BR/BL never
 * leaving their corners across two full drag attempts — only TR ever moved by
 * hand. The model underneath was fine: 28 unit tests, clamping and quad refusal
 * all correct. Nothing tested whether a person could reach the handles.
 *
 * The cause was geometry. Corners are normalized [0,1] and were drawn straight
 * onto an SVG whose viewport is exactly the same box, so a handle at 0 or 1 sat
 * ON the boundary — and an `<svg>` clips to its viewport, leaving roughly a
 * quarter of a 6 px circle to hit. That is the state EVERY new calibration
 * starts in, since identity puts all four corners on the boundary at once.
 *
 * Pure arithmetic, no DOM (§8.1).
 */
import { describe, expect, it } from 'vitest';
import { H, HANDLE_R, HIT_R, PAD, W, toSvgX, toSvgY } from '../editor/WarpPanel';
import { identityCorners } from '../render/calibration';

/** Every corner position an operator can legally reach, including the extremes. */
const EXTREMES = [0, 0.0001, 0.25, 0.5, 0.75, 0.9999, 1];

describe('warp handles are reachable at every legal corner position', () => {
  it('draws every handle fully inside the SVG viewport', () => {
    for (const x of EXTREMES) {
      for (const y of EXTREMES) {
        const cx = toSvgX(x);
        const cy = toSvgY(y);
        expect(cx - HANDLE_R).toBeGreaterThanOrEqual(0);
        expect(cx + HANDLE_R).toBeLessThanOrEqual(W);
        expect(cy - HANDLE_R).toBeGreaterThanOrEqual(0);
        expect(cy + HANDLE_R).toBeLessThanOrEqual(H);
      }
    }
  });

  it('keeps the whole hit target inside the viewport too', () => {
    // A hit target clipped by the viewport is a handle you cannot catch, which
    // is the actual defect — the visible circle being clipped only made it
    // look wrong.
    for (const x of [0, 1]) {
      for (const y of [0, 1]) {
        expect(toSvgX(x) - HIT_R).toBeGreaterThanOrEqual(0);
        expect(toSvgX(x) + HIT_R).toBeLessThanOrEqual(W);
        expect(toSvgY(y) - HIT_R).toBeGreaterThanOrEqual(0);
        expect(toSvgY(y) + HIT_R).toBeLessThanOrEqual(H);
      }
    }
  });

  it('gives the hit target real slack over the drawn handle', () => {
    // 6 px of circle is not a target anyone can hit repeatedly on a ladder.
    expect(HIT_R).toBeGreaterThan(HANDLE_R * 2);
    expect(PAD).toBeGreaterThanOrEqual(HIT_R);
  });

  it('maps the identity square to the inset rect, not to the element edge', () => {
    const c = identityCorners();
    expect(toSvgX(c[0].x)).toBe(PAD);
    expect(toSvgY(c[0].y)).toBe(PAD);
    expect(toSvgX(c[2].x)).toBe(W - PAD);
    expect(toSvgY(c[2].y)).toBe(H - PAD);
  });

  it('is monotonic and spans the full inset rect', () => {
    expect(toSvgX(0)).toBeLessThan(toSvgX(1));
    expect(toSvgY(0)).toBeLessThan(toSvgY(1));
    expect(toSvgX(0.5)).toBeCloseTo(W / 2, 9);
    expect(toSvgY(0.5)).toBeCloseTo(H / 2, 9);
  });
});
