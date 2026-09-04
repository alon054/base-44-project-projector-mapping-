/**
 * The `[force]` line and the coalescer under it.
 *
 * These are tested for the same reason the `[clock]` line was: eleven of this
 * project's thirteen defects across three phases were found by reading log
 * lines, and a log line that is wrong is worse than one that is missing —
 * Phase 3 spent a session on an instrument that lied in six different ways.
 *
 * The line's exact text is asserted, not paraphrased. What the operator reads
 * off a run log is the thing under test.
 */
import { describe, expect, it, vi } from 'vitest';
import { LineCoalescer } from '../debug/coalesce';
import { attachForceLog, describeForces } from '../debug/forceLog';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import { createPhase4Scene } from '../core/defaultScene';
import { createLayer } from '../core/layer';
import { createScene } from '../core/scene';

function lines(scene = createPhase4Scene()): string[] {
  return describeForces(scene, FORCE_DEFINITIONS).map((l) => l.line);
}

describe('the [force] line', () => {
  it('states the id, every value, and how many entities it reached', () => {
    const wind = lines().find((l) => l.startsWith('[force] wind'))!;
    expect(wind).toBe(
      '[force] wind strength=0.450 direction=0.000 gustiness=0.500 -> 6/11 entities',
    );
  });

  it('counts reach by the same rule the bus uses, defaults included', () => {
    const scene = createPhase4Scene();
    // FIVE layers state `wind: 0`: the four full-frame ones (sky, hills, water,
    // rain), which are pinned because I-1 gives them no bleed to parallax into,
    // and `sus-000`, which is the susceptibility experiment's control and is
    // meant not to move. 11 layers, 5 opted out, 6 reached. Every one of the 11
    // states a number or takes wind's default of 0.5; none is accidental.
    const reached = scene.layers.filter((l) => (l.susceptibility['wind'] ?? 0.5) > 0).length;
    expect(lines(scene).find((l) => l.startsWith('[force] wind'))).toContain(
      `-> ${reached}/${scene.layers.length} entities`,
    );
  });

  it('emits one line per force, plus parallax', () => {
    const out = lines();
    expect(out.length).toBe(FORCE_DEFINITIONS.length + 1);
    for (const def of FORCE_DEFINITIONS) {
      expect(out.some((l) => l.startsWith(`[force] ${def.id} `))).toBe(true);
    }
    expect(out.at(-1)).toBe('[force] parallax x=0.500 y=0.500 (11 entities, by depth)');
  });

  it('shouts when a force the operator has moved reaches nothing', () => {
    // Phase 4's named failure mode: a bus that is provably correct and whose
    // effect nobody can see. This is the one case the log refuses to coalesce.
    const scene = createScene({
      id: 'deaf',
      forces: { wind: { strength: 0.9 } },
      layers: [createLayer({ id: 'a', providerId: 'procedural', susceptibility: { wind: 0 } })],
    });
    const wind = describeForces(scene, FORCE_DEFINITIONS).find((l) => l.key === 'wind')!;
    expect(wind.line).toContain('-> 0/1 entities  ** REACHES NOTHING **');
    expect(wind.immediate).toBe(true);
  });

  it('does not shout for a force sitting at its own defaults', () => {
    // A force nobody has touched reaching nothing is not a defect.
    const scene = createScene({
      id: 'quiet',
      layers: [createLayer({ id: 'a', providerId: 'procedural', susceptibility: { wind: 0 } })],
    });
    const wind = describeForces(scene, FORCE_DEFINITIONS).find((l) => l.key === 'wind')!;
    expect(wind.line).not.toContain('REACHES NOTHING');
    expect(wind.immediate).toBe(false);
  });

  it('a fifth force gets a line without the logger being told about it', () => {
    const FOG = {
      id: 'fog',
      label: 'Fog',
      axes: ['opacity'] as const,
      defaultSusceptibility: 1,
      params: [{ key: 'density', label: 'Density', min: 0, max: 1, default: 0, step: 0.01 }],
      evaluate: () => ({}),
    };
    const out = describeForces(createPhase4Scene(), [...FORCE_DEFINITIONS, FOG]);
    expect(out.some((l) => l.line.startsWith('[force] fog density=0.000'))).toBe(true);
  });
});

describe('attachForceLog', () => {
  it('emits every line on the first scene and nothing on an identical one', () => {
    const log = vi.fn();
    let now = 1000;
    const logger = attachForceLog(FORCE_DEFINITIONS, { log, now: () => now });
    logger.note(createPhase4Scene());
    expect(log).toHaveBeenCalledTimes(FORCE_DEFINITIONS.length + 1);

    log.mockClear();
    now += 5000;
    // A repeated line is not a change, and the point of the log is change.
    logger.note(createPhase4Scene());
    expect(log).not.toHaveBeenCalled();
    logger.detach();
  });

  it('reports only the force that moved', () => {
    const log = vi.fn();
    let now = 1000;
    const logger = attachForceLog(FORCE_DEFINITIONS, { log, now: () => now });
    logger.note(createPhase4Scene());
    log.mockClear();

    now += 5000;
    const base = createPhase4Scene();
    logger.note({ ...base, forces: { ...base.forces, rain: { intensity: 0.8, wetness: 0.6 } } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain('[force] rain intensity=0.800');
    logger.detach();
  });
});

describe('LineCoalescer', () => {
  it('holds a burst and emits the LAST value at the end of the window', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let now = 0;
    const c = new LineCoalescer({ log, now: () => now, intervalMs: 250 });

    c.emit('wind', 'a');
    expect(log).toHaveBeenCalledTimes(1);

    // A slider drag: 100 updates inside one window.
    for (let i = 0; i < 100; i++) {
      now += 2;
      c.emit('wind', `v${i}`);
    }
    expect(log).toHaveBeenCalledTimes(1);

    // The drag must not end on a stale line — the LAST value is the one the
    // operator reads off the log afterwards.
    vi.advanceTimersByTime(300);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]![0]).toBe('v99');
    c.dispose();
    vi.useRealTimers();
  });

  it('gives each key its own window', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let now = 0;
    const c = new LineCoalescer({ log, now: () => now, intervalMs: 250 });
    // A wind drag must not suppress the one rain line that explains what the
    // operator is looking at. This is why the coalescer is keyed at all.
    c.emit('wind', 'w1');
    c.emit('rain', 'r1');
    expect(log).toHaveBeenCalledTimes(2);
    now += 10;
    c.emit('wind', 'w2');
    c.emit('rain', 'r2');
    expect(log).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300);
    expect(log).toHaveBeenCalledTimes(4);
    c.dispose();
    vi.useRealTimers();
  });

  it('drops a line identical to the last one emitted for that key', () => {
    const log = vi.fn();
    let now = 0;
    const c = new LineCoalescer({ log, now: () => now, intervalMs: 250 });
    c.emit('k', 'same');
    now += 1000;
    c.emit('k', 'same');
    expect(log).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('immediate bypasses the window', () => {
    const log = vi.fn();
    let now = 0;
    const c = new LineCoalescer({ log, now: () => now, intervalMs: 250 });
    c.emit('k', 'a');
    now += 5;
    c.emit('k', 'b', true);
    expect(log).toHaveBeenCalledTimes(2);
    c.dispose();
  });

  it('flush emits held lines; dispose drops them', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let now = 0;
    const c = new LineCoalescer({ log, now: () => now, intervalMs: 250 });
    c.emit('k', 'a');
    now += 5;
    c.emit('k', 'held');
    c.flush();
    expect(log).toHaveBeenLastCalledWith('held');

    const log2 = vi.fn();
    const d = new LineCoalescer({ log: log2, now: () => now, intervalMs: 250 });
    d.emit('k', 'a');
    now += 5;
    d.emit('k', 'dropped');
    d.dispose();
    vi.advanceTimersByTime(1000);
    expect(log2).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
