/**
 * The `[warp]` log line, and the coalescing that keeps it readable.
 *
 * §8.1 says the unit suite is pure logic with no GPU. Nothing here renders: a
 * `Container` and a stub renderer are enough, because what is under test is
 * when a line is emitted, not what reaches a panel. The mesh and the pixels are
 * the golden harness's job.
 *
 * This has a test at all because of how the need was found. The first Phase 2
 * measurement run recorded roughly three hundred `[warp]` lines from a single
 * corner drag, and they buried `[scene] applied` and every display event in the
 * same log — including a projector hot-plug. A line nobody can find is not
 * instrumentation, and Phase 1's whole lesson is that these lines are what make
 * a bug findable from a wall.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { WarpStage } from '../render/warp';
import { createCalibration, withCorner, withEnabled } from '../render/calibration';

function makeStage() {
  const lines: string[] = [];
  const stage = new Container();
  const source = new Container();
  const warp = new WarpStage({
    // Never called: nothing in these tests turns the warp on, so `prepare()`
    // short-circuits and the renderer is only held, never used.
    renderer: {} as never,
    stage,
    source,
    width: 1280,
    height: 720,
    log: (l) => lines.push(l),
  });
  return { warp, lines, stage, source };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the [warp] line', () => {
  it('states the toggle, the shape and every corner', () => {
    const { warp, lines } = makeStage();
    warp.setCalibration(createCalibration('main'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[warp] main: OFF');
    expect(lines[0]).toContain('identity');
    expect(lines[0]).toContain('bypassed');
  });

  it('does not repeat an unchanged calibration', () => {
    const { warp, lines } = makeStage();
    const cal = createCalibration('main');
    warp.setCalibration(cal);
    warp.setCalibration(cal);
    warp.setCalibration({ ...cal });
    expect(lines).toHaveLength(1);
  });

  it('coalesces a drag instead of one line per pointer move', () => {
    const { warp, lines } = makeStage();
    let cal = createCalibration('main');
    warp.setCalibration(cal);
    expect(lines).toHaveLength(1);

    // 60 moves in the space of one drag, as the run log actually recorded.
    for (let i = 1; i <= 60; i++) {
      cal = withCorner(cal, 0, { x: i * 0.002, y: i * 0.001 });
      warp.setCalibration(cal);
      vi.advanceTimersByTime(16);
    }
    // ~960 ms of dragging at 250 ms coalescing: a handful of lines, not sixty.
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThan(10);
  });

  it('never ends a drag on a stale position', () => {
    const { warp, lines } = makeStage();
    let cal = createCalibration('main');
    warp.setCalibration(cal);
    for (let i = 1; i <= 5; i++) {
      cal = withCorner(cal, 0, { x: i * 0.01, y: 0 });
      warp.setCalibration(cal);
      vi.advanceTimersByTime(16);
    }
    // The drag stops here. The trailing emit must still deliver the LAST
    // position — that is the one an operator reads off the log afterwards.
    vi.advanceTimersByTime(500);
    expect(lines[lines.length - 1]).toContain('TL(0.0500,0.0000)');
  });

  it('logs a toggle immediately, without waiting for the coalescing window', () => {
    const { warp, lines } = makeStage();
    let cal = createCalibration('main');
    warp.setCalibration(cal);
    cal = withCorner(cal, 0, { x: 0.05, y: 0 });
    warp.setCalibration(cal);
    const beforeToggle = lines.length;
    // Off -> on is a state change an operator needs to see the instant it
    // happens, not up to 250 ms later.
    warp.setCalibration(withEnabled(cal, true));
    expect(lines.length).toBe(beforeToggle + 1);
    expect(lines[lines.length - 1]).toContain('ON');
  });
});

describe('warp off is a bypass, not an identity transform', () => {
  it('parents the composite directly and allocates nothing', () => {
    const { warp, stage, source } = makeStage();
    warp.setCalibration(createCalibration('main'));
    expect(source.parent).toBe(stage);
    expect(warp.active).toBe(false);
    expect(warp.degraded).toBe(false);
  });

  it('prepare() is a no-op while disabled, so a disabled warp costs nothing', () => {
    const { warp } = makeStage();
    warp.setCalibration(createCalibration('main'));
    // The stub renderer would throw if `prepare` touched it.
    expect(() => warp.prepare()).not.toThrow();
  });
});
