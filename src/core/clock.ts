/**
 * I-2 — the single global clock.
 *
 * "There is exactly one authoritative time source. Every animated layer, force,
 * and transition samples *it*. No layer counts its own wall-clock time."
 *
 * Three decisions here are what make that invariant mechanical rather than a
 * thing to be careful about:
 *
 * **The clock does not read a wall clock.** `advance(dtMs)` is driven from
 * outside, by whoever owns the frame loop. The clock is therefore a pure
 * function of the deltas it was fed, which is what lets the I-2 determinism
 * test be a pure test with no renderer, no timers and no tolerance window. A
 * clock that called `performance.now()` internally could only ever be tested
 * approximately, and "approximately correct time" is exactly the failure Gate 3
 * asks us to rule out.
 *
 * **Phase is DERIVED, never accumulated.** `phaseFor(period)` computes
 * `(time / period) mod 1` from the authoritative time every time it is asked.
 * Phase 0's throwaway ticker did the opposite — it accumulated
 * `phase += dt / LOOP_SECONDS` — and an accumulated phase cannot survive a
 * scrub: two loops of different lengths would each have integrated their own
 * history and would land wherever that history put them. Deriving makes Gate
 * 3's "two loops of different lengths stay phase-consistent after a scrub" true
 * by construction, for any number of loops, at any period, after any scrub.
 * There is no per-layer state that a scrub could fail to update, because there
 * is no per-layer state.
 *
 * **Rate scales the advance, not the read.** `time` is always real elapsed
 * scene time. Scaling at read would make every derived phase jump the instant
 * the operator moved the rate control, because the whole of history would be
 * re-scaled retroactively.
 */

/** The clock's serializable state (I-7, I-12). JSON only — it crosses IPC. */
export interface ClockState {
  /** Scene time in **milliseconds**. Always >= 0. */
  timeMs: number;
  playing: boolean;
  /** Multiplier applied to real time while playing. 0 is a held frame. */
  rate: number;
}

/**
 * Clock state on the wire, plus the one field that makes it unambiguous.
 *
 * **Why `scrubSeq` exists.** `timeMs` in a transport message means two
 * different things depending on what the operator did: after a scrub it means
 * "go to this time"; after a pause or a rate change it means nothing at all,
 * because the sender's copy of the time is however stale it happens to be. The
 * first version of this protocol did not distinguish them and the `[clock]` log
 * line caught it on the first launch — the output window's clock was pulled
 * back to `t=0` by an editor message that was only trying to say "playing".
 * Live, that is a show that jumps to the start when the operator nudges the
 * rate.
 *
 * `scrubSeq` increments only when the operator actually moves time, starting
 * from 0 and never returning to it. A receiver applies `timeMs` when the
 * sequence is new to it and ignores it otherwise; `playing` and `rate` always
 * apply. Sequence 0 therefore means "no operator has ever moved time", and no
 * receiver ever acts on the `timeMs` in such a message.
 *
 * The message stays WHOLE STATE rather than becoming a command stream:
 * re-applying the same message changes nothing, a dropped message is corrected
 * by the next one, and a window that opens late (main replays the last state to
 * an output window reopened on a display re-select, I-13) comes up at the last
 * time the operator actually asserted rather than at zero.
 */
export interface ClockTransport extends ClockState {
  /** Increments on operator time moves only. Never on play, pause or rate. */
  scrubSeq: number;
}

export function createClockTransport(state: ClockState, scrubSeq: number): ClockTransport {
  return { ...state, scrubSeq: Number.isFinite(scrubSeq) ? Math.trunc(scrubSeq) : 0 };
}

export function canonicalizeClockTransport(raw: unknown): ClockTransport {
  const state = canonicalizeClockState(raw);
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const seq = o['scrubSeq'];
  return createClockTransport(state, typeof seq === 'number' ? seq : 0);
}

export const CLOCK_RATE_MIN = 0;
export const CLOCK_RATE_MAX = 4;

/**
 * The engine's default loop length, in seconds.
 *
 * Inherited from Phase 0's `LOOP_SECONDS`, deliberately: the 19 blessed golden
 * frames are byte-compared, and a provider whose global phase changed meaning
 * would re-bless all of them for no reason anyone could state later.
 */
export const GLOBAL_LOOP_SECONDS = 4;

/** The furthest the clock can be scrubbed. One hour is past any plausible cue. */
export const CLOCK_MAX_MS = 3_600_000;

function sanitizeMs(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > CLOCK_MAX_MS ? CLOCK_MAX_MS : v;
}

function sanitizeRate(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return v < CLOCK_RATE_MIN ? CLOCK_RATE_MIN : v > CLOCK_RATE_MAX ? CLOCK_RATE_MAX : v;
}

export function createClockState(init?: Partial<ClockState>): ClockState {
  return {
    timeMs: sanitizeMs(init?.timeMs ?? 0),
    playing: init?.playing ?? true,
    rate: sanitizeRate(init?.rate ?? 1),
  };
}

/** Accepts anything shaped roughly like clock state and returns canonical state. */
export function canonicalizeClockState(raw: unknown): ClockState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return createClockState();
  const o = raw as Record<string, unknown>;
  return createClockState({
    timeMs: sanitizeMs(o['timeMs']),
    playing: typeof o['playing'] === 'boolean' ? o['playing'] : true,
    rate: sanitizeRate(o['rate']),
  });
}

/**
 * Normalized position in a loop of `periodSeconds`, in [0, 1).
 *
 * Pure and exported on its own so that a provider, a test, or a future force
 * can ask the question without holding a `Clock`. This is the whole of I-2's
 * arithmetic; everything else in this file is bookkeeping around it.
 *
 * A non-finite or non-positive period yields 0 rather than NaN — a layer with a
 * nonsense loop length holds still, which is a visible defect an operator can
 * report, where a NaN phase is a layer that vanishes for reasons nobody can see
 * (I-13's principle: degrade visibly).
 */
export function phaseAt(timeMs: number, periodSeconds: number): number {
  if (!Number.isFinite(timeMs) || !Number.isFinite(periodSeconds) || periodSeconds <= 0) return 0;
  const p = (timeMs / 1000 / periodSeconds) % 1;
  return p < 0 ? p + 1 : p;
}

/** What changed on the last mutation, for logging and for the transport UI. */
export type ClockChange = 'play' | 'pause' | 'scrub' | 'rate' | 'reset' | 'none';

export interface ClockListener {
  (state: ClockState, change: ClockChange): void;
}

/**
 * The one authoritative time source (I-2).
 *
 * Exactly one of these exists per render host. It is not a singleton in code —
 * the editor preview and the output window are separate processes with separate
 * hosts (I-7) — but within one host there is one, and every animated layer
 * samples it through `LayerFrame`.
 */
export class Clock {
  private state: ClockState;
  private readonly listeners = new Set<ClockListener>();
  /** Real milliseconds fed in, ignoring rate and pause. For the HUD only. */
  private realMs = 0;
  /**
   * The last scrub sequence this clock has applied.
   *
   * Starts at 0 — the sequence a sender that has never scrubbed is still on —
   * so an editor's very first message does NOT assert a time. The alternative,
   * treating the first message as authoritative, was tried and is wrong in both
   * directions: it rewinds an output window that started before the editor's
   * first message (which is what the smoke launch showed), and it would restart
   * a reopened output window at 0 rather than at the show's position, because
   * `timeMs` is 0 in a message from a sender that holds intent and not a clock.
   *
   * The rule that falls out is the honest one: the editor never knows the
   * show's time, so it never asserts one it did not get from an operator.
   */
  private lastScrubSeq = 0;

  constructor(init?: Partial<ClockState>) {
    this.state = createClockState(init);
  }

  /** Scene time in milliseconds. The authoritative number. */
  get timeMs(): number {
    return this.state.timeMs;
  }

  get timeSeconds(): number {
    return this.state.timeMs / 1000;
  }

  get playing(): boolean {
    return this.state.playing;
  }

  get rate(): number {
    return this.state.rate;
  }

  /** Real time the clock has been driven for, regardless of pause or rate. */
  get realSeconds(): number {
    return this.realMs / 1000;
  }

  /** A copy, never the live object — callers must not mutate the clock's state. */
  snapshot(): ClockState {
    return { ...this.state };
  }

  /**
   * Advance by `dtMs` of real time. Called once per frame by the frame loop,
   * which is the ONLY caller that should exist: two callers would be two time
   * sources, which is the thing I-2 forbids.
   *
   * A non-finite or negative delta is ignored rather than clamped to 0 and
   * counted, so a dropped frame or a clock stepping backwards across a display
   * change cannot rewind the scene.
   */
  advance(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.realMs += dtMs;
    if (!this.state.playing) return;
    const next = this.state.timeMs + dtMs * this.state.rate;
    // Advancing past the end holds rather than wrapping. Wrapping would make
    // every derived phase jump at an arbitrary moment an hour into a show.
    this.state.timeMs = next > CLOCK_MAX_MS ? CLOCK_MAX_MS : next;
    // Deliberately NOT notified. `advance` runs 60 times a second; a listener
    // on it would put the log line and the IPC send on the render path, which
    // is what A14 measures and A15 rules on. Listeners fire on operator
    // actions, which is what an operator can actually correlate with.
  }

  /** Normalized [0, 1) position in a loop of `periodSeconds`. Derived (see header). */
  phaseFor(periodSeconds: number): number {
    return phaseAt(this.state.timeMs, periodSeconds);
  }

  /** The engine-wide default loop, for providers with no period of their own. */
  get globalPhase(): number {
    return phaseAt(this.state.timeMs, GLOBAL_LOOP_SECONDS);
  }

  play(): void {
    if (this.state.playing) return;
    this.state.playing = true;
    this.notify('play');
  }

  pause(): void {
    if (!this.state.playing) return;
    this.state.playing = false;
    this.notify('pause');
  }

  setPlaying(v: boolean): void {
    if (v) this.play();
    else this.pause();
  }

  /** Absolute scrub, in milliseconds. Does not change play state (D5). */
  scrubToMs(ms: number): void {
    const next = sanitizeMs(ms);
    if (next === this.state.timeMs) return;
    this.state.timeMs = next;
    this.notify('scrub');
  }

  scrubToSeconds(s: number): void {
    this.scrubToMs(s * 1000);
  }

  /** Relative scrub. Negative goes back. */
  nudgeMs(deltaMs: number): void {
    if (!Number.isFinite(deltaMs)) return;
    this.scrubToMs(this.state.timeMs + deltaMs);
  }

  setRate(rate: number): void {
    const next = sanitizeRate(rate);
    if (next === this.state.rate) return;
    this.state.rate = next;
    this.notify('rate');
  }

  /** Back to t=0, play state and rate untouched. */
  reset(): void {
    if (this.state.timeMs === 0) return;
    this.state.timeMs = 0;
    this.notify('reset');
  }

  /** Replace the whole state at once — the IPC path from the editor (I-7). */
  apply(state: ClockState): void {
    const next = canonicalizeClockState(state);
    const prev = this.state;
    if (
      next.timeMs === prev.timeMs &&
      next.playing === prev.playing &&
      next.rate === prev.rate
    ) {
      return;
    }
    this.state = next;
    // Named by what actually differs, most operator-visible first, so the log
    // line says "pause" for a pause even when the payload also carried a time.
    const change: ClockChange =
      next.playing !== prev.playing
        ? next.playing
          ? 'play'
          : 'pause'
        : next.timeMs !== prev.timeMs
          ? 'scrub'
          : 'rate';
    this.notify(change);
  }

  /**
   * Apply a transport message from another process (I-7).
   *
   * `playing` and `rate` always apply. `timeMs` applies only when the message
   * carries a scrub sequence this clock has not seen — see `ClockTransport`
   * for why the distinction is not optional.
   */
  applyTransport(msg: ClockTransport): void {
    const next = canonicalizeClockTransport(msg);
    const isNewScrub = next.scrubSeq !== this.lastScrubSeq;
    this.lastScrubSeq = next.scrubSeq;
    this.apply({
      timeMs: isNewScrub ? next.timeMs : this.state.timeMs,
      playing: next.playing,
      rate: next.rate,
    });
  }

  /** Returns an unsubscribe function. */
  subscribe(fn: ClockListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(change: ClockChange): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap, change);
  }
}
