/**
 * The transport — and the loop ruler, which is the point of this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 2'S LESSON, APPLIED FORWARD.
 *
 * Phase 1: 5 of 7 defects found by the operator using the thing, not by tests.
 * Phase 2: 4 of 4, none by a unit test. Phase 1's was a scene that could not
 * demonstrate the invariant; Phase 2's was a control that could not be operated
 * — the warp had 28 passing tests while three of its four corner handles could
 * not be caught by a human hand.
 *
 * The analogous Phase 3 risk is a clock that is provably correct in tests and
 * whose pause and scrub cannot be felt. `clock.test.ts` proves that two loops
 * of different lengths stay phase-consistent after a scrub. Nobody can see a
 * proof. So the LOOP RULER below draws several loops of different lengths as
 * markers derived live from the clock:
 *
 *   - Pause, and every marker stops in the same frame. That is Gate 3's
 *     "pausing the clock freezes every clock-driven layer simultaneously",
 *     visible rather than argued.
 *   - Scrub, and every marker jumps to where its own arithmetic puts it —
 *     not to where its history left it. That is Gate 3's phase-consistency
 *     condition, watchable at a glance.
 *
 * The ruler reads the PREVIEW HOST'S clock, not this component's transport
 * state, and that is deliberate. Transport state is intent; the preview's clock
 * is a clock that is actually running. A ruler driven by intent would show a
 * smooth animation even if the render host had stopped sampling the clock
 * entirely, which is exactly the defect it exists to catch.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useRef, useState } from 'react';
import { CLOCK_RATE_MAX, phaseAt, type Clock } from '../core/clock';
import type { Transport } from './useClock';

/** The widest the scrub slider reaches. The clock itself goes to an hour. */
export const SCRUB_WINDOW_SECONDS = 120;

/**
 * The loops the ruler draws. Deliberately mutually non-dividing (3 and 5 share
 * no factor; 4 is the engine default) so a wrong implementation cannot look
 * right by coincidence — two loops at 2 s and 4 s would agree at every seam and
 * an accumulator bug would hide there.
 */
const RULER_LOOPS: readonly { seconds: number; color: string }[] = [
  { seconds: 3, color: '#4ea1ff' },
  { seconds: 4, color: '#9ad14b' },
  { seconds: 5, color: '#ffb454' },
];

const ROW_H = 22;
const RULER_W = 380;

interface Props {
  transport: Transport;
  /** The preview's live clock. Null until the preview host has finished init. */
  clock: Clock | null;
}

/** `m:ss.mmm`. Milliseconds, because a frame at 60 Hz is 16.7 ms. */
export function formatTime(ms: number): string {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = Math.floor(total % 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function TransportPanel({ transport, clock }: Props): React.JSX.Element {
  const { state } = transport;

  /**
   * The live clock reading, sampled per animation frame. This is a DISPLAY
   * loop and it drives nothing — it never calls `clock.advance`, because the
   * render host's frame loop is the only caller I-2 permits.
   */
  const [live, setLive] = useState({ timeMs: 0, playing: true });
  const rafRef = useRef(0);
  useEffect(() => {
    if (!clock) return;
    const tick = (): void => {
      setLive({ timeMs: clock.timeMs, playing: clock.playing });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [clock]);

  const shownMs = clock ? live.timeMs : state.timeMs;

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid #2b2f34', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => transport.togglePlaying()}
          style={{
            width: 92,
            padding: '8px 0',
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 0.5,
            // The two states must not be distinguishable only by a glyph. An
            // operator glancing at this from a ladder reads colour first.
            background: state.playing ? '#1f6f3f' : '#8a2b2b',
            color: '#fff',
            border: '1px solid #2b2f34',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {state.playing ? '❚❚ PAUSE' : '▶ PLAY'}
        </button>
        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 18,
            fontVariantNumeric: 'tabular-nums',
            // The readout is the pause you can FEEL: the milliseconds column
            // stops dead. A readout to a tenth of a second could be mistaken
            // for a slow update.
            color: live.playing ? '#e6e6e6' : '#ff9a9a',
          }}
        >
          {formatTime(shownMs)}
        </div>
        <span style={{ fontSize: 11, color: '#8a9199' }}>
          {clock ? (live.playing ? 'preview clock running' : 'preview clock HELD') : 'no preview'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#8a9199', width: 38 }}>scrub</span>
        {/* Tracks the LIVE clock, not held intent. A scrubber that sat still
            while the show ran would be reporting the last drag rather than the
            position, and dragging it would then jump the show backwards. */}
        <input
          type="range"
          min={0}
          max={SCRUB_WINDOW_SECONDS}
          step={0.001}
          value={Math.min(SCRUB_WINDOW_SECONDS, shownMs / 1000)}
          onChange={(e) => transport.scrubToMs(Number(e.target.value) * 1000)}
          style={{ flex: 1 }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {/* One frame at 60 Hz. Gate 3 asks whether video pauses at frame
            granularity, and a step this size is how an operator checks. */}
        <button type="button" onClick={() => transport.nudgeMs(-1000 / 60)}>
          ◀ frame
        </button>
        <button type="button" onClick={() => transport.nudgeMs(1000 / 60)}>
          frame ▶
        </button>
        <button type="button" onClick={() => transport.nudgeMs(-1000)}>
          −1 s
        </button>
        <button type="button" onClick={() => transport.nudgeMs(1000)}>
          +1 s
        </button>
        <button type="button" onClick={() => transport.reset()}>
          ⏮ 0
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: '#8a9199', width: 38 }}>rate</span>
        <input
          type="range"
          min={0}
          max={CLOCK_RATE_MAX}
          step={0.01}
          value={state.rate}
          onChange={(e) => transport.setRate(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12,
            width: 48,
            textAlign: 'right',
          }}
        >
          {state.rate.toFixed(2)}×
        </span>
      </div>

      <LoopRuler timeMs={shownMs} />
    </div>
  );
}

/**
 * Several loops of different lengths, each drawn from the SAME clock time.
 *
 * Every marker's position is `phaseAt(timeMs, period)` — the same pure function
 * a provider uses. Nothing here accumulates, which is why a pause stops all
 * three markers in one frame and a scrub relocates all three exactly.
 */
export function LoopRuler({ timeMs }: { timeMs: number }): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#8a9199', marginBottom: 4 }}>
        loop phase (I-2) — one clock, three periods
      </div>
      <svg
        width={RULER_W}
        height={ROW_H * RULER_LOOPS.length + 6}
        role="img"
        aria-label="loop phase ruler"
      >
        {RULER_LOOPS.map((loop, row) => {
          const phase = phaseAt(timeMs, loop.seconds);
          const y = row * ROW_H + 12;
          const x = 34 + phase * (RULER_W - 44);
          return (
            <g key={loop.seconds}>
              <text x={0} y={y + 4} fill="#8a9199" fontSize={10}>
                {loop.seconds}s
              </text>
              <line x1={34} y1={y} x2={RULER_W - 10} y2={y} stroke="#2b2f34" strokeWidth={2} />
              {/* Loop start, so a marker crossing the seam is visible as a
                  wrap rather than as a jump of unknown cause. */}
              <line
                x1={34}
                y1={y - 6}
                x2={34}
                y2={y + 6}
                stroke="#3a4048"
                strokeWidth={1}
              />
              <circle cx={x} cy={y} r={5} fill={loop.color} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
