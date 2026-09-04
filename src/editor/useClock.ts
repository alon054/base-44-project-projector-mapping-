/**
 * The editor's transport state, and the `clock.*` registry keys (I-8, rule 9).
 *
 * **This is not a third clock, and the distinction matters for I-2.** What is
 * held here is *operator intent* — `{timeMs, playing, rate, scrubSeq}` — and it
 * never advances on its own. There is no ticker in this file. Intent is applied
 * to the one `Clock` inside each render host (the preview's and, over IPC, the
 * output's), and those are the only things in the engine that count time.
 *
 * Why intent is held separately from either clock: the editor and the output
 * are separate processes and only JSON crosses (I-7). A transport that read the
 * output's clock to decide what to send would be a control whose position
 * depended on a round trip, which is the thing that makes a pause feel late.
 * The operator's action lands in the preview instantly and is sent onward in
 * the same tick.
 *
 * **Intent does not hold the show's time, and that was a real defect.** The
 * first version sent `timeMs` on every change, so a pause or a rate nudge
 * carried whatever stale time this hook happened to hold and rewound the output
 * window to it. The first launch after writing the `[clock]` log line showed it
 * as `[clock] t=0.000s PLAYING rate=1.00x (scrub)` arriving on a running
 * output. `scrubSeq` is the fix: `timeMs` is authoritative only when the
 * operator actually moved time, and a relative nudge steps from the LIVE clock
 * rather than from this hook's copy.
 *
 * Between operator actions the preview's clock and the output's clock advance
 * independently and will disagree by scheduling jitter. That is I-7's stated
 * position — the preview is an approximation of the output, not a mirror — and
 * it is not a defect the preview can fix. Exact verification happens on the
 * output window, which is where Gate 3 is judged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLOCK_MAX_MS,
  canonicalizeClockState,
  createClockState,
  type ClockTransport,
} from '../core/clock';
import { defineClockParameters, type ParameterRegistry } from '../core/parameters';

export interface Transport {
  state: ClockTransport;
  setPlaying(v: boolean): void;
  togglePlaying(): void;
  setRate(v: number): void;
  /** Absolute. Bumps `scrubSeq` — this is the operator asserting a time. */
  scrubToMs(ms: number): void;
  /** Relative, from the LIVE clock rather than from held intent. */
  nudgeMs(deltaMs: number): void;
  reset(): void;
}

/**
 * Holds transport state, sends it on `clock:set`, and registers `clock.*`.
 *
 * `readLiveMs` returns the preview clock's current time, or null before the
 * preview host exists. It is what makes "step one frame" step from where the
 * show is rather than from where the last scrub left this hook.
 */
export function useClock(
  registry: ParameterRegistry,
  readLiveMs: () => number | null,
): Transport {
  const [state, setState] = useState<ClockTransport>(() => ({
    ...createClockState(),
    scrubSeq: 0,
  }));

  // The registry's accessors are created once and must not capture a stale
  // state object — the same ref discipline `useSceneRegistry` uses, for the
  // same reason: React state is immutable and a captured value goes stale on
  // the first write.
  const stateRef = useRef(state);
  stateRef.current = state;
  const readLiveRef = useRef(readLiveMs);
  readLiveRef.current = readLiveMs;

  /** Play, pause, rate. Never asserts a time — `scrubSeq` is left alone. */
  const patch = useCallback((next: Partial<ClockTransport>) => {
    setState((prev) => ({
      ...canonicalizeClockState({ ...prev, ...next }),
      scrubSeq: prev.scrubSeq,
    }));
  }, []);

  /** The operator moving time. This is the only thing that bumps `scrubSeq`. */
  const scrub = useCallback((timeMs: number) => {
    setState((prev) => ({
      ...canonicalizeClockState({ ...prev, timeMs }),
      scrubSeq: prev.scrubSeq + 1,
    }));
  }, []);

  const transport = useMemo(
    () => ({
      setPlaying: (v: boolean) => patch({ playing: v }),
      togglePlaying: () => patch({ playing: !stateRef.current.playing }),
      setRate: (v: number) => patch({ rate: v }),
      scrubToMs: (ms: number) => scrub(ms),
      nudgeMs: (deltaMs: number) => {
        // From the live clock, so "◀ frame" on a running show steps back one
        // frame from NOW rather than jumping to an old scrub position.
        const base = readLiveRef.current() ?? stateRef.current.timeMs;
        scrub(base + deltaMs);
      },
      reset: () => scrub(0),
    }),
    [patch, scrub],
  );

  // Rule 9 / I-8, in the same commit that introduces the clock.
  useEffect(() => {
    if (registry.has('clock.playing')) return;
    registry.registerAll(
      defineClockParameters({
        get playing() {
          return stateRef.current.playing;
        },
        get rate() {
          return stateRef.current.rate;
        },
        get timeSeconds() {
          // The LIVE time, so a mapped control reads the show's position
          // rather than the last value written through this hook.
          return (readLiveRef.current() ?? stateRef.current.timeMs) / 1000;
        },
        setPlaying: (v: boolean) => patch({ playing: v }),
        setRate: (v: number) => patch({ rate: v }),
        scrubToSeconds: (v: number) => scrub(v * 1000),
      }),
    );
  }, [registry, patch, scrub]);

  // I-7: whole state, JSON only, on its own channel. Operator-paced — this
  // effect fires on an action, never on a frame.
  useEffect(() => {
    window.engine.setClock(state);
  }, [state]);

  return { ...transport, state };
}

/** For the scrub control: the widest time the operator can drag to, in seconds. */
export const SCRUB_MAX_SECONDS = CLOCK_MAX_MS / 1000;
