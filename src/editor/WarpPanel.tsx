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
 * The handles are dragged with a pointer and nudged with the arrow keys,
 * because squaring an image by eye ends in single-pixel decisions and a mouse
 * cannot make those. Fine nudge is 0.001 of the output — about one pixel at
 * 1280x720, which is the unit the operator is actually working in by then.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CORNER_LABELS,
  isIdentityCorners,
  quadFault,
  resetCorners,
  withCorner,
  withEnabled,
  type CornerIndex,
  type ViewportCalibration,
} from '../render/calibration';

const W = 480;
const H = 270;
/** ~1 px at 1280x720. Shift multiplies by 10. */
const NUDGE = 0.001;

interface Props {
  calibration: ViewportCalibration;
  onChange: (next: ViewportCalibration) => void;
  /** Output size, so the numeric readout can be stated in real pixels too. */
  output: { width: number; height: number };
}

export function WarpPanel({ calibration, onChange, output }: Props): React.JSX.Element {
  const svg = useRef<SVGSVGElement | null>(null);
  const [selected, setSelected] = useState<CornerIndex>(0);
  const [dragging, setDragging] = useState<CornerIndex | null>(null);
  /** Set when a drag is refused, so a rejected move says why instead of sticking. */
  const [refused, setRefused] = useState<string>('');

  const move = useCallback(
    (index: CornerIndex, x: number, y: number) => {
      const next = withCorner(calibration, index, { x, y });
      if (next === calibration) {
        const fault = quadFault(
          calibration.corners.map((p, i) => (i === index ? { x, y } : p)) as never,
        );
        setRefused(fault ?? 'refused');
        return;
      }
      setRefused('');
      onChange(next);
    },
    [calibration, onChange],
  );

  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent): void => {
      const el = svg.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      move(dragging, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    const onUp = (): void => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, move]);

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
    const p = calibration.corners[selected]!;
    move(selected, p.x + delta[0], p.y + delta[1]);
  };

  const pts = calibration.corners.map((p) => `${p.x * W},${p.y * H}`).join(' ');
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
          x={0.5}
          y={0.5}
          width={W - 1}
          height={H - 1}
          fill="none"
          stroke="#2b2f34"
          strokeDasharray="4 4"
        />
        <polygon points={pts} fill="rgba(96,208,255,0.08)" stroke="#60d0ff" strokeWidth={1.5} />
        {calibration.corners.map((p, i) => {
          const index = i as CornerIndex;
          const active = selected === index;
          return (
            <g key={CORNER_LABELS[i]}>
              <circle
                cx={p.x * W}
                cy={p.y * H}
                r={active ? 8 : 6}
                fill={active ? '#60d0ff' : '#15181b'}
                stroke="#60d0ff"
                strokeWidth={1.5}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setSelected(index);
                  setDragging(index);
                  svg.current?.focus();
                }}
              />
              <text
                x={p.x * W + (p.x > 0.5 ? -14 : 14)}
                y={p.y * H + (p.y > 0.5 ? -12 : 18)}
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
        Drag a corner, or select one and nudge with the arrow keys (shift = ×10).
        {refused ? (
          <strong style={{ color: '#ffb040' }}> · refused: {refused}</strong>
        ) : null}
      </p>

      <pre style={readout}>
        {calibration.corners
          .map(
            (p, i) =>
              `${CORNER_LABELS[i]}  ${p.x.toFixed(4)}, ${p.y.toFixed(4)}` +
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
