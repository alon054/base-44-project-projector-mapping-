/**
 * I-2 — the single global clock, and the properties Gate 3 judges it on.
 *
 * These are pure tests with no renderer and no timers, which is only possible
 * because `Clock.advance(dtMs)` is driven from outside. That was the point of
 * the signature: a clock that read `performance.now()` internally could only be
 * tested against a tolerance, and "time is approximately right" is precisely
 * what Gate 3 exists to rule out.
 *
 * Phase 2's lesson is in here too, though a unit test cannot discharge it: the
 * risk for Phase 3 is "a clock that is provably correct in tests and whose
 * pause and scrub cannot be felt". Everything below is necessary and none of it
 * is sufficient — the `[clock]` line and the transport control are the other
 * half, and the gate is judged on a wall.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CLOCK_MAX_MS,
  CLOCK_RATE_MAX,
  Clock,
  GLOBAL_LOOP_SECONDS,
  canonicalizeClockState,
  createClockState,
  phaseAt,
} from '../core/clock';
import { attachClockLog, describeClock } from '../debug/clockLog';

/** Drives a clock with `n` frames of `dtMs`, the way the render loop does. */
function run(clock: Clock, n: number, dtMs = 1000 / 60): void {
  for (let i = 0; i < n; i++) clock.advance(dtMs);
}

describe('phaseAt — the whole of I-2 arithmetic', () => {
  it('derives position from time and period, never from history', () => {
    expect(phaseAt(0, 4)).toBe(0);
    expect(phaseAt(1000, 4)).toBeCloseTo(0.25, 12);
    expect(phaseAt(2000, 4)).toBeCloseTo(0.5, 12);
    expect(phaseAt(4000, 4)).toBeCloseTo(0, 12);
    // Many loops later, still exact — an accumulator would have drifted.
    expect(phaseAt(4000 * 1000 + 1000, 4)).toBeCloseTo(0.25, 12);
  });

  it('always returns [0, 1)', () => {
    for (const t of [0, 1, 999, 1000, 123456.789, 3_599_999]) {
      for (const p of [0.1, 1, 4, 7.3, 60]) {
        const v = phaseAt(t, p);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('holds still rather than returning NaN for a nonsense period (I-13)', () => {
    // A layer that holds still is a defect an operator can see and report.
    // A NaN phase is a layer that vanishes for reasons nobody can see.
    expect(phaseAt(1000, 0)).toBe(0);
    expect(phaseAt(1000, -4)).toBe(0);
    expect(phaseAt(1000, Number.NaN)).toBe(0);
    expect(phaseAt(Number.NaN, 4)).toBe(0);
    expect(phaseAt(1000, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('Clock — determinism (I-2)', () => {
  it('is a pure function of the deltas it was fed', () => {
    const a = new Clock();
    const b = new Clock();
    const deltas = [16.7, 16.6, 33.4, 8.2, 16.7, 100, 16.7];
    for (const d of deltas) a.advance(d);
    for (const d of deltas) b.advance(d);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('two clocks fed the same deltas agree on every derived phase', () => {
    const a = new Clock();
    const b = new Clock();
    run(a, 601);
    run(b, 601);
    for (const period of [0.5, 1, 2.5, 4, GLOBAL_LOOP_SECONDS, 11.37]) {
      expect(a.phaseFor(period)).toBe(b.phaseFor(period));
    }
  });

  it('reads no wall clock of its own — an undriven clock does not move', () => {
    const clock = new Clock();
    const before = clock.snapshot();
    // If the clock consulted `performance.now()` anywhere, a real pause here
    // would move it. Nothing drives it, so nothing may change.
    for (let i = 0; i < 1e5; i++) void i;
    expect(clock.snapshot()).toEqual(before);
  });

  it('ignores a non-finite or backwards delta rather than counting it', () => {
    const clock = new Clock();
    clock.advance(1000);
    clock.advance(-500);
    clock.advance(Number.NaN);
    clock.advance(Number.POSITIVE_INFINITY);
    // A dropped frame, or a clock stepping backwards across a display change,
    // must not rewind the scene in front of an audience.
    expect(clock.timeMs).toBe(1000);
  });
});

describe('Clock — pause freezes every clock-driven layer simultaneously (Gate 3)', () => {
  it('holds time across any number of frames while paused', () => {
    const clock = new Clock();
    run(clock, 60);
    const frozen = clock.timeMs;
    clock.pause();
    run(clock, 600);
    expect(clock.timeMs).toBe(frozen);
  });

  it('freezes EVERY period at once, because they all read one number', () => {
    const clock = new Clock();
    run(clock, 137);
    clock.pause();
    // This is the mechanical form of "simultaneously": there is no per-layer
    // state to freeze, so no layer can be missed.
    const periods = [0.4, 1, 2.5, 4, 9.6];
    const before = periods.map((p) => clock.phaseFor(p));
    run(clock, 500);
    expect(periods.map((p) => clock.phaseFor(p))).toEqual(before);
  });

  it('resumes from where it stopped, not from where wall time reached', () => {
    const clock = new Clock();
    run(clock, 60);
    const frozen = clock.timeMs;
    clock.pause();
    run(clock, 600);
    clock.play();
    clock.advance(16);
    expect(clock.timeMs).toBeCloseTo(frozen + 16, 9);
  });

  it('rate 0 holds the frame without leaving the playing state', () => {
    const clock = new Clock();
    clock.setRate(0);
    run(clock, 100);
    expect(clock.timeMs).toBe(0);
    expect(clock.playing).toBe(true);
  });
});

describe('Clock — two loops of different lengths after a scrub (Gate 3, I-2)', () => {
  it('lands both loops exactly where the new time says, not where history left them', () => {
    const clock = new Clock();
    run(clock, 373);
    clock.scrubToSeconds(12);

    // 3-second and 5-second loops. 12 s is 4.0 loops of the first and 2.4 of
    // the second, so the answers are 0 and 0.4 — computable by hand, which is
    // the point. An engine that accumulated per-layer phase would give two
    // numbers that depend on the 373 frames before the scrub.
    expect(clock.phaseFor(3)).toBeCloseTo(0, 12);
    expect(clock.phaseFor(5)).toBeCloseTo(0.4, 12);
  });

  it('is history-independent: any path to the same time gives the same phases', () => {
    const viaPlayback = new Clock();
    run(viaPlayback, 600, 20); // 12 s of playback in 20 ms frames
    const viaScrub = new Clock();
    viaScrub.scrubToSeconds(12);
    const viaMessyPath = new Clock();
    run(viaMessyPath, 100, 7.3);
    viaMessyPath.pause();
    run(viaMessyPath, 50);
    viaMessyPath.play();
    viaMessyPath.setRate(2.5);
    run(viaMessyPath, 40, 11);
    viaMessyPath.scrubToSeconds(12);

    for (const period of [0.5, 3, 5, 7]) {
      expect(viaScrub.phaseFor(period)).toBeCloseTo(viaPlayback.phaseFor(period), 9);
      expect(viaMessyPath.phaseFor(period)).toBe(viaScrub.phaseFor(period));
    }
  });

  it('keeps two loops phase-consistent relative to each other across a scrub', () => {
    const clock = new Clock();
    // At t, a 2 s loop and a 4 s loop are related by phase2 = (2 * phase4) mod 1
    // for all t. The relationship is what "phase-consistent" means, and it must
    // survive any scrub because both sides derive from the same number.
    for (const t of [0.001, 1.7, 12, 137.42, 3599]) {
      clock.scrubToSeconds(t);
      const p4 = clock.phaseFor(4);
      const p2 = clock.phaseFor(2);
      expect(p2).toBeCloseTo((2 * p4) % 1, 9);
    }
  });

  it('a scrub does not change the play state (D5)', () => {
    const clock = new Clock();
    clock.pause();
    clock.scrubToSeconds(9);
    expect(clock.playing).toBe(false);
    expect(clock.timeMs).toBe(9000);
  });
});

describe('Clock — rate', () => {
  it('scales the advance, not the read', () => {
    const clock = new Clock();
    clock.advance(1000);
    clock.setRate(2);
    clock.advance(1000);
    // The first second was taken at 1x and stays taken at 1x. Scaling at read
    // would have retroactively re-scaled the whole of history and jumped every
    // derived phase the instant the operator touched the control.
    expect(clock.timeMs).toBe(3000);
  });

  it('clamps to its declared range rather than refusing the write', () => {
    const clock = new Clock();
    clock.setRate(99);
    expect(clock.rate).toBe(CLOCK_RATE_MAX);
    clock.setRate(-3);
    expect(clock.rate).toBe(0);
    clock.setRate(Number.NaN);
    expect(clock.rate).toBe(1);
  });

  it('tracks real time separately from scene time, for the HUD', () => {
    const clock = new Clock();
    clock.setRate(2);
    run(clock, 60, 10);
    clock.pause();
    run(clock, 60, 10);
    expect(clock.timeSeconds).toBeCloseTo(1.2, 9);
    expect(clock.realSeconds).toBeCloseTo(1.2, 9);
    clock.play();
    clock.setRate(1);
    run(clock, 60, 10);
    // Real time counted all 180 frames; scene time counted 120 of them, at
    // two different rates. Conflating the two is how a soak run reports the
    // wrong elapsed figure.
    expect(clock.realSeconds).toBeCloseTo(1.8, 9);
    expect(clock.timeSeconds).toBeCloseTo(1.8, 9);
  });
});

describe('Clock — bounds and state hygiene', () => {
  it('clamps scrub into [0, CLOCK_MAX_MS]', () => {
    const clock = new Clock();
    clock.scrubToMs(-1);
    expect(clock.timeMs).toBe(0);
    clock.scrubToMs(CLOCK_MAX_MS * 10);
    expect(clock.timeMs).toBe(CLOCK_MAX_MS);
  });

  it('holds at the ceiling rather than wrapping', () => {
    const clock = new Clock();
    clock.scrubToMs(CLOCK_MAX_MS - 5);
    run(clock, 100);
    // Wrapping would make every derived phase jump at an arbitrary moment an
    // hour into a show.
    expect(clock.timeMs).toBe(CLOCK_MAX_MS);
  });

  it('snapshot is a copy — a caller cannot mutate the clock through it', () => {
    const clock = new Clock();
    const snap = clock.snapshot();
    snap.timeMs = 999_999;
    snap.playing = false;
    expect(clock.timeMs).toBe(0);
    expect(clock.playing).toBe(true);
  });

  it('canonicalizes junk state instead of adopting it (I-7 boundary)', () => {
    expect(canonicalizeClockState(null)).toEqual(createClockState());
    expect(canonicalizeClockState('nope')).toEqual(createClockState());
    expect(canonicalizeClockState([1, 2])).toEqual(createClockState());
    expect(canonicalizeClockState({ timeMs: -5, playing: 'yes', rate: 1e9 })).toEqual({
      timeMs: 0,
      playing: true,
      rate: CLOCK_RATE_MAX,
    });
  });

  it('state is plain JSON, so it may cross IPC (I-7)', () => {
    const clock = new Clock();
    run(clock, 42);
    clock.setRate(1.5);
    clock.pause();
    const snap = clock.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it('round-trips deep-equal through apply (I-12)', () => {
    const source = new Clock();
    run(source, 137, 13.7);
    source.setRate(2.25);
    source.pause();
    const sink = new Clock();
    sink.apply(source.snapshot());
    expect(sink.snapshot()).toEqual(source.snapshot());
  });
});

describe('Clock — change notification', () => {
  it('does not notify per frame, so the instrument stays off the render path (A14)', () => {
    const clock = new Clock();
    const seen: string[] = [];
    clock.subscribe((_s, change) => seen.push(change));
    run(clock, 600);
    // 600 frames, zero listener calls. A notification on `advance` would put a
    // log line and an IPC send on the render path 60 times a second.
    expect(seen).toEqual([]);
  });

  it('notifies on operator actions, named by what actually changed', () => {
    const clock = new Clock();
    const seen: string[] = [];
    clock.subscribe((_s, change) => seen.push(change));
    clock.pause();
    clock.scrubToSeconds(5);
    clock.setRate(2);
    clock.play();
    clock.reset();
    expect(seen).toEqual(['pause', 'scrub', 'rate', 'play', 'reset']);
  });

  it('does not notify when a setter changes nothing', () => {
    const clock = new Clock();
    const seen: string[] = [];
    clock.subscribe((_s, change) => seen.push(change));
    clock.play(); // already playing
    clock.setRate(1); // already 1
    clock.reset(); // already 0
    clock.scrubToMs(0); // already 0
    expect(seen).toEqual([]);
  });

  it('names a combined apply by its most operator-visible difference', () => {
    const clock = new Clock();
    const seen: string[] = [];
    clock.subscribe((_s, change) => seen.push(change));
    // The payload carries a time AND a pause. The operator hit pause; the line
    // must say so rather than reporting the scrub that rode along with it.
    clock.apply({ timeMs: 4000, playing: false, rate: 1 });
    expect(seen).toEqual(['pause']);
  });

  it('unsubscribes', () => {
    const clock = new Clock();
    const seen: string[] = [];
    const off = clock.subscribe((_s, change) => seen.push(change));
    clock.pause();
    off();
    clock.play();
    expect(seen).toEqual(['pause']);
  });
});

describe('the [clock] log line', () => {
  it('states time, run state and rate, to milliseconds', () => {
    expect(describeClock({ timeMs: 12480, playing: true, rate: 1 }, 'scrub')).toBe(
      '[clock] t=12.480s PLAYING rate=1.00x (scrub)',
    );
    expect(describeClock({ timeMs: 0, playing: false, rate: 2.5 }, 'pause')).toBe(
      '[clock] t=0.000s PAUSED rate=2.50x (pause)',
    );
  });

  it('emits the starting state at attach, so a run log never has to infer it', () => {
    const lines: string[] = [];
    const clock = new Clock();
    attachClockLog(clock, { log: (l) => lines.push(l), now: () => 0 });
    expect(lines).toEqual(['[clock] t=0.000s PLAYING rate=1.00x (none)']);
  });

  it('logs a pause immediately, without waiting for the coalescing window', () => {
    const lines: string[] = [];
    let t = 0;
    const clock = new Clock();
    attachClockLog(clock, { log: (l) => lines.push(l), now: () => t });
    lines.length = 0;
    t = 10; // well inside the 250 ms window
    clock.pause();
    expect(lines).toEqual(['[clock] t=0.000s PAUSED rate=1.00x (pause)']);
  });

  it('coalesces a scrub drag instead of one line per pointer move', () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      let t = 1000;
      const clock = new Clock();
      attachClockLog(clock, { log: (l) => lines.push(l), now: () => t });
      lines.length = 0;

      // ~960 ms of dragging at pointer-move rate. The warp's equivalent
      // emitted ~300 lines from one drag and buried a projector hot-plug.
      for (let i = 0; i < 60; i++) {
        t += 16;
        clock.scrubToMs(i * 100);
      }
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThan(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a drag never ends on a stale value — the trailing emit delivers the last one', () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      let t = 1000;
      const clock = new Clock();
      attachClockLog(clock, { log: (l) => lines.push(l), now: () => t });
      lines.length = 0;

      for (let i = 0; i < 5; i++) {
        t += 16;
        clock.scrubToMs(1000 + i * 100);
      }
      // The drag stops here, mid-window. The LAST position is the one the
      // operator reads off the log afterwards, so it must arrive.
      t += 300;
      vi.advanceTimersByTime(300);
      expect(lines[lines.length - 1]).toBe('[clock] t=1.400s PLAYING rate=1.00x (scrub)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('detaching stops the lines and cancels a pending trailing emit', () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      let t = 1000;
      const clock = new Clock();
      const detach = attachClockLog(clock, { log: (l) => lines.push(l), now: () => t });
      lines.length = 0;
      t += 16;
      clock.scrubToMs(500);
      detach();
      vi.advanceTimersByTime(1000);
      clock.pause();
      expect(lines).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * I-2 + I-7 — the clock crosses on its own channel, as whole state.
 *
 * Separate from `scene:set` for the reason `calibration:set` is separate:
 * loading a different scene must not stop the show's time, and pausing must not
 * have to carry a scene payload. Whole state and not a command, so a dropped or
 * replayed message cannot leave the two windows disagreeing about the time.
 */
describe('the clock:set channel', () => {
  it('is a distinct channel from the scene and the calibration', async () => {
    const { CH } = await import('@shared/ipc');
    expect(CH.clockSet).not.toBe(CH.sceneSet);
    expect(CH.clockSet).not.toBe(CH.calibrationSet);
    const values = Object.values(CH);
    expect(new Set(values).size).toBe(values.length);
  });

  it('a clock payload is plain JSON and passes the I-7 guard', async () => {
    const { assertJsonOnly } = await import('@shared/ipc');
    const payload = new Clock().snapshot();
    expect(assertJsonOnly(payload)).toBe(payload);
  });

  it('carries no pixel data — a smuggled buffer is refused (I-7)', async () => {
    const { assertJsonOnly } = await import('@shared/ipc');
    expect(() =>
      assertJsonOnly({ timeMs: 0, playing: true, rate: 1, frame: new Float32Array(4) }),
    ).toThrow();
  });
});

/**
 * I-8 / CLAUDE.md rule 9 — the `clock.*` keys, registered in the same commit
 * that introduces the clock.
 */
describe('clock parameters (I-8)', () => {
  it('registers three hierarchical keys', async () => {
    const { ParameterRegistry, defineClockParameters } = await import('../core/parameters');
    const clock = new Clock();
    const registry = new ParameterRegistry();
    registry.registerAll(defineClockParameters(clock));
    expect(registry.keys('clock')).toEqual(['clock.playing', 'clock.rate', 'clock.time']);
  });

  it('every key resolves back to the clock, not to a copy of it', async () => {
    const { ParameterRegistry, defineClockParameters } = await import('../core/parameters');
    const clock = new Clock();
    const registry = new ParameterRegistry();
    registry.registerAll(defineClockParameters(clock));

    // Written through the registry, read off the clock.
    registry.write('clock.playing', false);
    expect(clock.playing).toBe(false);
    registry.write('clock.rate', 2.5);
    expect(clock.rate).toBe(2.5);
    registry.write('clock.time', 7.5);
    expect(clock.timeMs).toBe(7500);

    // Changed on the clock, read through the registry. The registry is an
    // index onto state, never a second store (I-12).
    clock.play();
    clock.scrubToSeconds(3);
    expect(registry.read('clock.playing')).toBe(true);
    expect(registry.read('clock.time')).toBe(3);
  });

  it('clock.time is in SECONDS, so a mapped fader has usable resolution', async () => {
    const { ParameterRegistry, defineClockParameters } = await import('../core/parameters');
    const registry = new ParameterRegistry();
    registry.registerAll(defineClockParameters(new Clock()));
    const def = registry.definition('clock.time');
    expect(def?.kind).toBe('number');
    // Not CLOCK_MAX_MS. A 0-3,600,000 range on a 128-step MIDI control has no
    // resolution anywhere, which is the failure this exists to avoid.
    expect(def).toMatchObject({ min: 0, max: CLOCK_MAX_MS / 1000 });
  });

  it('clamps rather than refusing, so a mapped control is never dead at the top', async () => {
    const { ParameterRegistry, defineClockParameters } = await import('../core/parameters');
    const clock = new Clock();
    const registry = new ParameterRegistry();
    registry.registerAll(defineClockParameters(clock));
    registry.write('clock.rate', 99);
    expect(clock.rate).toBe(CLOCK_RATE_MAX);
  });
});

/**
 * `applyTransport` — the scrubSeq protocol.
 *
 * This exists because of a defect found on the first launch after the `[clock]`
 * log line was written, not because of a design review. The output window's
 * running clock was pulled back to `t=0` by an editor message that meant only
 * "playing": `timeMs` was applied unconditionally, and the sender's copy of the
 * time was stale by construction because the editor holds intent and not a
 * clock.
 *
 * The lesson from Phases 1 and 2 is that the run log finds what the unit suite
 * does not. That held again here — nothing above this block would have caught
 * it, because every test above drives one clock in isolation and the defect
 * lives in the seam between two.
 */
describe('Clock.applyTransport — whole state, unambiguous time (I-7)', () => {
  it('does NOT rewind time for a message that only changes the run state', () => {
    const clock = new Clock();
    run(clock, 600); // 10 s into the show
    const showTime = clock.timeMs;

    // The editor pauses. Its held `timeMs` is 0 and always has been.
    clock.applyTransport({ timeMs: 0, playing: false, rate: 1, scrubSeq: 0 });

    expect(clock.playing).toBe(false);
    expect(clock.timeMs).toBe(showTime);
  });

  it('does NOT rewind time for a rate change either', () => {
    const clock = new Clock();
    run(clock, 600);
    const showTime = clock.timeMs;
    clock.applyTransport({ timeMs: 0, playing: true, rate: 2, scrubSeq: 0 });
    expect(clock.rate).toBe(2);
    expect(clock.timeMs).toBe(showTime);
  });

  it('DOES move time when the sequence is new — an actual scrub', () => {
    const clock = new Clock();
    run(clock, 600);
    // Sequence 0 is "no operator has ever moved time". It must not be acted on.
    clock.applyTransport({ timeMs: 0, playing: true, rate: 1, scrubSeq: 0 });
    expect(clock.timeMs).toBeGreaterThan(0);
    clock.applyTransport({ timeMs: 4000, playing: true, rate: 1, scrubSeq: 1 });
    expect(clock.timeMs).toBe(4000);
  });

  it('is idempotent — re-applying the same message changes nothing', () => {
    const clock = new Clock();
    clock.applyTransport({ timeMs: 4000, playing: true, rate: 1, scrubSeq: 1 });
    run(clock, 60);
    const after = clock.timeMs;
    clock.applyTransport({ timeMs: 4000, playing: true, rate: 1, scrubSeq: 1 });
    // A replayed message must not yank the show back to the scrub position.
    expect(clock.timeMs).toBe(after);
  });

  it('a window opening mid-show comes up at the last time the operator asserted', () => {
    // Main replays the last clock state to an output window that reopens after
    // a display re-select (I-13). A replayed message carrying a real scrub
    // sequence is authoritative for that window, so the projector comes back at
    // the operator's last scrub rather than at zero.
    const reopened = new Clock();
    reopened.applyTransport({ timeMs: 12_000, playing: true, rate: 1, scrubSeq: 7 });
    expect(reopened.timeMs).toBe(12_000);
  });

  it('a window opening under an editor that never scrubbed is not reset to 0', () => {
    const reopened = new Clock();
    run(reopened, 300);
    const own = reopened.timeMs;
    // Sequence 0: the editor holds intent, not a clock, and has no time to
    // give. Its `timeMs` of 0 describes nothing and must not be applied.
    reopened.applyTransport({ timeMs: 0, playing: true, rate: 1, scrubSeq: 0 });
    expect(reopened.timeMs).toBe(own);
  });

  it('play state and rate always apply, even on a repeated sequence', () => {
    const clock = new Clock();
    clock.applyTransport({ timeMs: 1000, playing: true, rate: 1, scrubSeq: 3 });
    clock.applyTransport({ timeMs: 1000, playing: false, rate: 0.5, scrubSeq: 3 });
    expect(clock.playing).toBe(false);
    expect(clock.rate).toBe(0.5);
  });

  it('canonicalizes a transport message with a missing or junk sequence', async () => {
    const { canonicalizeClockTransport } = await import('../core/clock');
    expect(canonicalizeClockTransport({ timeMs: 5, playing: true, rate: 1 })).toEqual({
      timeMs: 5,
      playing: true,
      rate: 1,
      scrubSeq: 0,
    });
    expect(canonicalizeClockTransport(null)).toEqual({
      timeMs: 0,
      playing: true,
      rate: 1,
      scrubSeq: 0,
    });
  });

  it('a transport payload is plain JSON and passes the I-7 guard', async () => {
    const { assertJsonOnly } = await import('@shared/ipc');
    const payload = { timeMs: 1234, playing: false, rate: 1.5, scrubSeq: 9 };
    expect(assertJsonOnly(payload)).toBe(payload);
  });
});
