/**
 * A keyed, rate-limited log emitter with a trailing emit.
 *
 * **Why this file exists now and not earlier.** `render/warp.ts` (Phase 2) and
 * `debug/clockLog.ts` (Phase 3) each carry their own copy of this logic, and
 * `clockLog.ts` says so in its header: "This file is the second instance; a
 * third would justify the extraction." Phase 4's `[force]` line is the third.
 *
 * It is a NEW module rather than a refactor of the two existing ones, and that
 * is deliberate. Both of those sit behind passed gates, and CLAUDE.md is
 * explicit that "a passed gate is a frozen surface" — reaching into Phase 2's
 * warp to serve Phase 4's convenience would be exactly the rework the rule
 * forbids, and the warp's coalescer is covered by tests that describe the warp.
 * The extraction is available to either of them the next time their surface is
 * legitimately open. Until then there are three implementations of one idea and
 * that is the honest state, recorded rather than hidden.
 *
 * **Why coalesce at all.** One corner drag emitted ~300 `[warp]` lines and
 * buried a projector hot-plug in the same log. Every control that is a pointer
 * drag does this — a scrub, a corner, and now a wind slider. A log that scrolls
 * its own evidence off the screen is worse than no log, and eleven of the
 * thirteen defects found across Phases 1-3 were found by reading these lines.
 *
 * **Why per-key and not global.** The clock has one subject; the force bus has
 * five and counting. A global window would let a wind-slider drag suppress the
 * one `[force] rain …` line that explained what the operator was actually
 * looking at. Each key gets its own window and its own trailing emit.
 */

export const DEFAULT_COALESCE_MS = 250;

export interface CoalescerOptions {
  /** Defaults to `console.log`. Injected so the unit suite reads the lines. */
  log?: (line: string) => void;
  /** Defaults to `Date.now`. Injected so the window is testable. */
  now?: () => number;
  /** Defaults to `DEFAULT_COALESCE_MS` — ~4 Hz, matching `[warp]` and `[clock]`. */
  intervalMs?: number;
}

interface KeyState {
  lastLine: string;
  lastAt: number;
  pending: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class LineCoalescer {
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly keys = new Map<string, KeyState>();

  constructor(opts: CoalescerOptions = {}) {
    this.log = opts.log ?? ((line: string) => console.log(line));
    this.now = opts.now ?? (() => Date.now());
    this.intervalMs = opts.intervalMs ?? DEFAULT_COALESCE_MS;
  }

  /**
   * Offer a line for `key`.
   *
   * A line identical to the last one emitted for that key is dropped — the
   * point of the log is change, and a repeated line is not one.
   *
   * `immediate` bypasses the window, for state changes an operator must see the
   * instant they happen. `clockLog` treats play/pause/rate that way; the force
   * log uses it for a force's reach dropping to zero, which is the one thing
   * here that means "what you are doing is having no effect".
   */
  emit(key: string, line: string, immediate = false): void {
    // `-Infinity` and not 0: a key that has never emitted must emit NOW. With
    // 0, a coalescer constructed at `now() === 0` — every fake-timer test, and
    // any real clock near its own epoch — would hold the very first line of a
    // run for a quarter second, and a run log whose opening state arrives late
    // is the class of instrument defect Phase 3 spent a session on.
    const state = this.keys.get(key) ?? {
      lastLine: '',
      lastAt: Number.NEGATIVE_INFINITY,
      pending: null,
      timer: null,
    };
    this.keys.set(key, state);
    if (line === state.lastLine) return;

    const t = this.now();
    if (immediate || t - state.lastAt >= this.intervalMs) {
      this.clearTimer(state);
      state.pending = null;
      state.lastLine = line;
      state.lastAt = t;
      this.log(line);
      return;
    }

    // A drag must not end on a stale line: the LAST value is the one the
    // operator reads off the log afterwards, so the held line is emitted at the
    // end of the window rather than dropped.
    state.pending = line;
    if (state.timer === null) {
      state.timer = setTimeout(
        () => {
          state.timer = null;
          const held = state.pending;
          state.pending = null;
          if (held !== null) this.emit(key, held, true);
        },
        Math.max(0, this.intervalMs - (t - state.lastAt)),
      );
    }
  }

  /** Emit every held line now. For shutdown, and for tests. */
  flush(): void {
    for (const [key, state] of this.keys) {
      this.clearTimer(state);
      const held = state.pending;
      state.pending = null;
      if (held !== null) this.emit(key, held, true);
    }
  }

  /** Drops held lines and cancels timers. Does NOT emit — see `flush`. */
  dispose(): void {
    for (const state of this.keys.values()) {
      this.clearTimer(state);
      state.pending = null;
    }
    this.keys.clear();
  }

  private clearTimer(state: KeyState): void {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }
}
