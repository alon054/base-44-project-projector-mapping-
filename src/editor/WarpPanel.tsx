/**
 * I-5 — the warp editor: a toggle and four draggable corners.
 *
 * **This is not the preview, and that is deliberate.** D11 makes the preview
 * the *placement* space — "a scene-space grid overlay, not a photo of the wall"
 * — so warping it would put the operator's objects on a distorted canvas and
 * teach exactly the mental model D11 says to avoid. What this widget shows is
 * the *shape of the correction*, in normalized space. The corrected image is
 * judged where Gate 2 says to judge it: on the surface.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE THINGS HERE ARE FIXES FOR A CONTROL THAT COULD NOT BE USED, and they
 * are called out because the first wall session found all three at once.
 *
 * The session log shows TL never leaving (0.1200, 0.0000) and BR/BL never
 * leaving their corners across two full drag attempts. Only TR ever moved by
 * hand. The model underneath was fine — 28 unit tests, clamping and quad
 * refusal all correct — and the control on top of it was close to unusable.
 * That is Phase 1's lesson arriving again, one phase later.
 *
 *  1. **The handles were clipped.** Corners map to normalized [0,1], so at
 *     identity a handle sits exactly ON the SVG boundary and an `<svg>` clips
 *     to its viewport. Three quarters of every handle was outside the element,
 *     leaving a ~6 px quadrant to hit — in the state every new calibration
 *     starts in. `PAD` insets the unit square so a handle is fully drawn and
 *     fully hittable at any legal corner position.
 *  2. **The corner teleported to the pointer.** The drag read the pointer's
 *     absolute position, so grabbing the visible sliver of a clipped handle
 *     instantly displaced the corner by however far off-centre the grab was.
 *     The log shows it: TR's y jumps 0.0000 → 0.0209 on the first move, which
 *     is exactly the offset of a grab on the lower half of a clipped handle.
 *     The grab offset is now held and applied.
 *  3. **A 6 px circle was the whole hit target.** There is now an invisible
 *     28 px one behind it, and a corner can be picked from a row of buttons
 *     without being grabbed at all — which is what makes the arrow keys usable
 *     for the single-pixel end of the job, rather than a nicety beside a drag.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CORNER_LABELS,
  isIdentityCorners,
  quadFault,
  resetCorners,
  withCorner,
  withEnabled,
  type CalibrationCorners,
  type CornerIndex,
  type ViewportCalibration,
} from '../render/calibration';

export const W = 480;
export const H = 270;
/**
 * Inset of the unit square inside the SVG, in px. Must exceed the handle radius
 * plus its stroke, or a corner at 0 or 1 is clipped by the viewport again.
 */
export const PAD = 20;
const SPAN_X = W - PAD * 2;
const SPAN_Y = H - PAD * 2;

/** ~1 px at 1280x720. Shift multiplies by 10. */
const NUDGE = 0.001;

/** Visible handle. The hit target is deliberately much larger — see HIT_R. */
export const HANDLE_R = 6;
export const HIT_R = 14;

export const toSvgX = (x: number): number => PAD + x * SPAN_X;
export const toSvgY = (y: number): number => PAD + y * SPAN_Y;

interface Props {
  calibration: ViewportCalibration;
  onChange: (next: ViewportCalibration) => void;
  /** Output size, so the numeric readout can be stated in real pixels too. */
  output: { width: number; height: number };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function WarpPanel({ calibration, onChange, output }: Props): React.JSX.Element {
  const svg = useRef<SVGSVGElement | null>(null);
  const [selected, setSelected] = useState<CornerIndex>(0);
  const [dragging, setDragging] = useState<CornerIndex | null>(null);
  /**
   * Normalized offset from the pointer to the corner at the moment of the grab.
   * Without it the corner snaps to wherever the pointer happened to land, which
   * is a jump of several output pixels on every single grab.
   */
  const grabOffset = useRef({ dx: 0, dy: 0 });
  /** Set when a move is refused, so a rejected drag says why instead of sticking. */
  const [refused, setRefused] = useState<string>('');

  const move = useCallback(
    (index: CornerIndex, rawX: number, rawY: number) => {
      const x = clamp01(rawX);
      const y = clamp01(rawY);
      const next = withCorner(calibration, index, { x, y });
      if (next === calibration) {
        // Report the fault of the CLAMPED position, which is the one that was
        // actually refused. Reporting the raw one would say "out-of-range" for
        // a drag whose real problem is that it would inverted the quad.
        const attempted = calibration.corners.map((p, i) =>
          i === index ? { x, y } : p,
        ) as unknown as CalibrationCorners;
        setRefused(quadFault(attempted) ?? 'refused');
        return;
      }
      setRefused('');
      onChange(next);
    },
    [calibration, onChange],
  );

  /** Pointer position in normalized [0,1] warp space. */
  const pointerNorm = useCallback((clientX: number, clientY: number) => {
    const el = svg.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // The SVG may be laid out at a different CSS size than its viewport, so the
    // pointer is converted through the rect and then through the same PAD inset
    // the handles are drawn with. Reading raw client pixels here is what made
    // the drag disagree with the drawing.
    const sx = ((clientX - r.left) / r.width) * W;
    const sy = ((clientY - r.top) / r.height) * H;
    return { x: (sx - PAD) / SPAN_X, y: (sy - PAD) / SPAN_Y };
  }, []);

  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent): void => {
      const p = pointerNorm(e.clientX, e.clientY);
      if (!p) return;
      move(dragging, p.x + grabOffset.current.dx, p.y + grabOffset.current.dy);
    };
    const onUp = (): void => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, move, pointerNorm]);

  const beginDrag = (index: CornerIndex, e: React.PointerEvent): void => {
    e.preventDefault();
    const p = pointerNorm(e.clientX, e.clientY);
    const corner = calibration.corners[index]!;
    grabOffset.current = p ? { dx: corner.x - p.x, dy: corner.y - p.y } : { dx: 0, dy: 0 };
    setSelected(index);
    setDragging(index);
    svg.current?.focus();
  };

  const nudge = (dx: number, dy: number): void => {
    const p = calibration.corners[selected]!;
    move(selected, p.x + dx, p.y + dy);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = NUDGE * (e.shiftKey ? 10 : 1);
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = d[e.key];
    if (!delta) return;
    e.preventDefault();
    nudge(delta[0], delta[1]);
  };

  const pts = calibration.corners.map((p) => `${toSvgX(p.x)},${toSvgY(p.y)}`).join(' ');
  const identity = isIdentityCorners(calibration.corners);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={calibration.enabled}
            onChange={(e) => onChange(withEnabled(calibration, e.target.checked))}
          />
          Warp {calibration.enabled ? 'ON' : 'OFF'}
        </label>
        <button
          type="button"
          style={smallButton}
          onClick={() => onChange(resetCorners(calibration))}
          disabled={identity}
        >
          Reset corners
        </button>
        <span style={{ fontSize: 12, color: '#8b939b' }}>
          {identity ? 'identity — no correction' : 'keystoned'}
        </span>
      </div>

      {/*
        Selecting a corner without grabbing it. This is not a convenience: the
        arrow keys are how the last few pixels of a keystone get set, and before
        this the only way to choose which corner they moved was to successfully
        grab a handle first.
      */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#8b939b' }}>Corner</span>
        {CORNER_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={selected === i}
            onClick={() => {
              setSelected(i as CornerIndex);
              svg.current?.focus();
            }}
            style={{
              ...smallButton,
              borderColor: selected === i ? '#60d0ff' : '#2b2f34',
              color: selected === i ? '#60d0ff' : 'inherit',
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ fontSize: 12, color: '#8b939b' }}>then ← ↑ ↓ → (shift ×10)</span>
      </div>

      <svg
        ref={svg}
        width={W}
        height={H}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{
          background: '#0b0d0f',
          border: '1px solid #2b2f34',
          borderRadius: 4,
          touchAction: 'none',
          outline: 'none',
          opacity: calibration.enabled ? 1 : 0.45,
        }}
      >
        {/* The uncorrected output rect, for reference. */}
        <rect
          x={toSvgX(0)}
          y={toSvgY(0)}
          width={SPAN_X}
          height={SPAN_Y}
          fill="none"
          stroke="#2b2f34"
          strokeDasharray="4 4"
        />
        <polygon points={pts} fill="rgba(96,208,255,0.08)" stroke="#60d0ff" strokeWidth={1.5} />
        {calibration.corners.map((p, i) => {
          const index = i as CornerIndex;
          const active = selected === index;
          const cx = toSvgX(p.x);
          const cy = toSvgY(p.y);
          return (
            <g key={CORNER_LABELS[i]} onPointerDown={(e) => beginDrag(index, e)}>
              {/* Invisible, and the reason the handle can be caught at all. */}
              <circle cx={cx} cy={cy} r={HIT_R} fill="transparent" style={{ cursor: 'grab' }} />
              <circle
                cx={cx}
                cy={cy}
                r={active ? HANDLE_R + 2 : HANDLE_R}
                fill={active ? '#60d0ff' : '#15181b'}
                stroke="#60d0ff"
                strokeWidth={1.5}
                style={{ cursor: 'grab' }}
              />
              <text
                x={cx + (p.x > 0.5 ? -15 : 15)}
                y={cy + (p.y > 0.5 ? -13 : 19)}
                fill="#8b939b"
                style={{ font: '10px ui-monospace, Menlo, monospace' }}
                textAnchor="middle"
              >
                {CORNER_LABELS[i]}
              </text>
            </g>
          );
        })}
      </svg>

      <p style={{ margin: 0, fontSize: 12, color: '#8b939b' }}>
        Drag a corner, or pick one above and nudge with the arrow keys.
        {refused ? <strong style={{ color: '#ffb040' }}> · refused: {refused}</strong> : null}
      </p>

      <pre style={readout}>
        {calibration.corners
          .map(
            (p, i) =>
              `${CORNER_LABELS[i]}${i === selected ? ' ‹' : '  '} ${p.x.toFixed(4)}, ${p.y.toFixed(4)}` +
              `   (${Math.round(p.x * output.width)}, ${Math.round(p.y * output.height)} px)`,
          )
          .join('\n')}
      </pre>
      <p style={{ margin: 0, fontSize: 12, color: '#8b939b' }}>
        Stored normalized (I-1); the pixel column is derived at draw time and never saved.
        Calibration lives in <code>calibration/</code>, never in a scene (I-5).
      </p>
    </div>
  );
}

const smallButton: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#191c1f',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

const readout: React.CSSProperties = {
  margin: 0,
  font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#7CFFB2',
  whiteSpace: 'pre',
};
