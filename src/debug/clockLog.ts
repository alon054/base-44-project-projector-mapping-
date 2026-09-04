/**
 * The `[clock]` log line.
 *
 * Phase 2's retrospective is the whole reason this file exists before any
 * animated layer does. Four of Phase 2's four defects were found without a unit
 * test — two of them by reading the `[scene] applied` and `[warp]` lines the
 * app already emits. The warp had 28 passing unit tests while three of its four
 * corner handles could not be caught by a human. A clock that is provably
 * correct in tests and whose pause cannot be *felt* is the same defect wearing
 * Phase 3's clothes, so the line that makes clock state readable is written
 * first, not at the gate.
 *
 * COALESCED at ~4 Hz with a trailing emit, for the reason recorded in
 * `src/render/warp.ts`: one corner drag emitted ~300 `[warp]` lines and buried a projector
 * hot-plug in the same log. A scrub control is a pointer drag exactly like a
 * corner handle, and would do the same thing. Play, pause and rate are state
 * changes and are never coalesced — an operator needs to see a pause the
 * instant it happens.
 *
 * The duplication with `WarpStage.emit` is deliberate. `src/render/warp.ts` is a
 * passed-gate surface (CLAUDE.md: "a passed gate is a frozen surface"), and
 * extracting a shared coalescer out of it would be a refactor of Phase 2's code
 * to serve Phase 3's convenience. This file is the second instance; a third
 * would justify the extraction.
 */
import type { Clock, ClockChange, ClockState } from '../core/clock';

const LOG_INTERVAL_MS = 250;

/** Changes an operator must see immediately, never held for the coalescing window. */
const IMMEDIATE: ReadonlySet<ClockChange> = new Set<ClockChange>([
  'play',
  'pause',
  'rate',
  'reset',
]);

/**
 * `[clock] t=12.480s PLAYING rate=1.00x (scrub)`
 *
 * Time to milliseconds, because Gate 3 asks whether video "pauses at frame
 * granularity" and a frame at 60 Hz is 16.7 ms — a line rounded to the tenth of
 * a second could not answer the question it exists to answer.
 */
export function describeClock(state: ClockState, change: ClockChange): string {
  const t = (state.timeMs / 1000).toFixed(3);
  const run = state.playing ? 'PLAYING' : 'PAUSED';
  const rate = `rate=${state.rate.toFixed(2)}x`;
  return `[clock] t=${t}s ${run} ${rate} (${change})`;
}

export interface ClockLoggerOptions {
  /** Defaults to `console.log`. Injected so the unit suite reads the lines. */
  log?: (line: string) => void;
  /** Defaults to `Date.now`. Injected so the coalescing window is testable. */
  now?: () => number;
}

/**
 * Attaches the `[clock]` line to a clock. Returns a detach function.
 *
 * Nothing here runs per frame: `Clock.advance` deliberately does not notify, so
 * a playing clock emits no lines at all until somebody changes something. That
 * is what keeps this instrument off the render path (A14) and out of A15's
 * per-frame budget.
 */
export function attachClockLog(clock: Clock, opts: ClockLoggerOptions = {}): () => void {
  const log = opts.log ?? ((line: string) => console.log(line));
  const now = opts.now ?? (() => Date.now());

  let lastLogged = '';
  let lastLogAt = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let pending: { state: ClockState; change: ClockChange } | null = null;

  const emit = (state: ClockState, change: ClockChange, immediate: boolean): void => {
    const line = describeClock(state, change);
    if (line === lastLogged) return;

    const t = now();
    if (immediate || t - lastLogAt >= LOG_INTERVAL_MS) {
      if (trailing !== null) {
        clearTimeout(trailing);
        trailing = null;
      }
      pending = null;
      lastLogged = line;
      lastLogAt = t;
      log(line);
      return;
    }
    // A scrub must not end on a stale line. The LAST position is the one the
    // operator will read off the log afterwards, so the held value is kept and
    // emitted at the end of the window rather than dropped.
    pending = { state, change };
    if (trailing === null) {
      trailing = setTimeout(
        () => {
          trailing = null;
          const p = pending;
          pending = null;
          if (p) emit(p.state, p.change, true);
        },
        Math.max(0, LOG_INTERVAL_MS - (t - lastLogAt)),
      );
    }
  };

  const unsubscribe = clock.subscribe((state, change) => {
    emit(state, change, IMMEDIATE.has(change));
  });

  // The first line is emitted at attach, so every run log states the clock's
  // starting state rather than leaving it to be inferred from the first change.
  emit(clock.snapshot(), 'none', true);

  return () => {
    unsubscribe();
    if (trailing !== null) {
      clearTimeout(trailing);
      trailing = null;
    }
    pending = null;
  };
}
