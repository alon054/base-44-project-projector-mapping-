/**
 * Editor control panel. Phase 0 scope: display picker, one parameter, the
 * always-on metrics text mirror (C4), and the instrumented round-trip readout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEV_RESOLUTION,
  PARAM_TEST_PATTERN_SPEED,
  TARGET_RESOLUTION,
  type DisplayInfo,
  type MetricsReport,
} from '@shared/ipc';
import {
  MAX_RENDER_FRACTION,
  formatReport,
  passesHeadroom,
  passesPresentation,
  percentile,
} from '../debug/hud';
import { PreviewCanvas } from './PreviewCanvas';

/** Gate 0: editor -> output round-trip p95 must be at or under this. */
const LATENCY_GATE_MS = 33;

export function App(): React.JSX.Element {
  const [speed, setSpeed] = useState(1);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [metrics, setMetrics] = useState<MetricsReport | null>(null);
  const [uncapped, setUncapped] = useState(false);
  const [nominalMs, setNominalMs] = useState(0);
  const [warning, setWarning] = useState<string>('');
  const [latencies, setLatencies] = useState<number[]>([]);
  const token = useRef(0);

  const refreshDisplays = useCallback(() => {
    void window.engine.listDisplays().then(setDisplays);
  }, []);

  useEffect(() => {
    refreshDisplays();
    // Pull, because the push races React's mount the same way it raced the
    // output window's Pixi init.
    void window.engine.getOutputConfig().then((c) => {
      if (!c) return;
      setUncapped(c.uncapped);
      if (c.displayFrequency > 0) setNominalMs(1000 / c.displayFrequency);
    });
    const offMetrics = window.engine.onMetrics(setMetrics);
    const offConfig = window.engine.onOutputConfig((c) => {
      setUncapped(c.uncapped);
      if (c.displayFrequency > 0) setNominalMs(1000 / c.displayFrequency);
      refreshDisplays();
    });
    const offWarn = window.engine.onWarning((w) => setWarning(w.level === 'info' ? '' : w.text));
    const offAck = window.engine.onParamAck(({ t0 }) => {
      const rtt = performance.now() - t0;
      setLatencies((prev) => [...prev.slice(-299), rtt]);
    });
    return () => {
      offMetrics();
      offConfig();
      offWarn();
      offAck();
    };
  }, [refreshDisplays]);

  const push = useCallback((value: number) => {
    setSpeed(value);
    token.current += 1;
    window.engine.setParam({
      key: PARAM_TEST_PATTERN_SPEED,
      value,
      token: token.current,
      t0: performance.now(),
    });
  }, []);

  const latency = useMemo(() => {
    if (latencies.length === 0) return null;
    const sorted = [...latencies].sort((a, b) => a - b);
    return {
      n: latencies.length,
      median: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
    };
  }, [latencies]);

  return (
    <div style={{ display: 'flex', gap: 20, padding: 20, alignItems: 'flex-start' }}>
      <div style={{ width: 380, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header>
          <h1 style={{ font: '600 15px/1.3 inherit', margin: '0 0 4px' }}>
            Projection Engine — Phase 0
          </h1>
          <p style={{ margin: 0, color: '#8b939b' }}>
            Scaffold &amp; dual-screen output. DEV {DEV_RESOLUTION.width}×{DEV_RESOLUTION.height}
            {' · target '}
            {TARGET_RESOLUTION.width}×{TARGET_RESOLUTION.height}
          </p>
        </header>

        {warning ? (
          <div
            style={{
              background: '#6b1b1b',
              padding: '8px 10px',
              borderRadius: 4,
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 12,
            }}
          >
            {warning}
          </div>
        ) : null}

        <Panel title="Output display">
          {displays.length === 0 ? (
            <p style={{ margin: 0, color: '#8b939b' }}>Enumerating…</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {displays.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void window.engine.selectDisplay(d.id).then(refreshDisplays);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '7px 9px',
                      borderRadius: 4,
                      border: `1px solid ${d.isSelected ? '#40e0ff' : '#2b2f34'}`,
                      background: d.isSelected ? '#16323a' : '#191c1f',
                      color: 'inherit',
                      font: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    <strong>{d.label || `Display ${d.id}`}</strong>
                    {d.internal ? ' · internal' : ''}
                    {d.isPrimary ? ' · primary' : ''}
                    <br />
                    <span style={{ color: '#8b939b', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                      {d.size.width}×{d.size.height} @ {d.displayFrequency}Hz · scale{' '}
                      {d.scaleFactor}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={refreshDisplays} style={buttonStyle}>
            Re-enumerate
          </button>
        </Panel>

        <Panel title={PARAM_TEST_PATTERN_SPEED}>
          <input
            type="range"
            min={0}
            max={4}
            step={0.01}
            value={speed}
            onChange={(e) => push(Number(e.currentTarget.value))}
            style={{ width: '100%' }}
          />
          <code style={{ color: '#8b939b' }}>{speed.toFixed(2)}×</code>
          <p style={{ margin: '6px 0 0', color: '#6f767d', fontSize: 12 }}>
            Hierarchical key from Phase 0; registered in <code>parameters.ts</code> in the first
            Phase 1 commit (I-8, SPEC.md §0.2).
          </p>
        </Panel>

        <Panel title="Editor → output round-trip">
          {latency ? (
            <pre style={preStyle}>
              {`median ${latency.median.toFixed(1)} ms
p95    ${latency.p95.toFixed(1)} ms  ${latency.p95 <= LATENCY_GATE_MS ? 'PASS' : 'FAIL'} (<=${LATENCY_GATE_MS} ms)
n      ${latency.n}`}
            </pre>
          ) : (
            <p style={{ margin: 0, color: '#8b939b' }}>Move the slider to sample.</p>
          )}
          <p style={{ margin: '6px 0 0', color: '#6f767d', fontSize: 12 }}>
            Measured in-process; does not include projector panel latency, which is measured
            separately and is informational.
          </p>
        </Panel>

        <Panel title="Measurement mode (ADD-2)">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={uncapped}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                void window.engine.setMeasurementMode(on).then((applied) => {
                  if (!applied) setWarning('Measurement mode saved — relaunch to apply.');
                });
              }}
            />
            Disable frame-rate cap
          </label>
          <p style={{ margin: '6px 0 0', color: '#6f767d', fontSize: 12 }}>
            Needs a relaunch: the Chromium switches must be set before app ready.
          </p>
        </Panel>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Panel title="Preview (I-7: approximation, not a mirror)">
          <PreviewCanvas speed={speed} nominalMs={nominalMs} />
        </Panel>

        <Panel title="Output metrics — SPEC.md §4 (always-on mirror)">
          {metrics ? (
            <>
              <pre style={preStyle}>{formatReport(metrics, uncapped)}</pre>
              <p style={{ margin: 0, fontSize: 12, color: '#8b939b' }}>
                Gate needs <strong>both</strong>: M1{' '}
                {passesPresentation(metrics) ? '✓' : '✗'} · M2{' '}
                {passesHeadroom(metrics) ? '✓' : '✗'} (p95 ≤{' '}
                {(MAX_RENDER_FRACTION * 100).toFixed(0)}% of N)
              </p>
            </>
          ) : (
            <p style={{ margin: 0, color: '#8b939b' }}>Waiting for the output window…</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  marginTop: 8,
  padding: '6px 10px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#191c1f',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

const preStyle: React.CSSProperties = {
  margin: 0,
  font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#7CFFB2',
  whiteSpace: 'pre',
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: '1px solid #2b2f34',
        borderRadius: 6,
        padding: 12,
        background: '#15181b',
      }}
    >
      <h2
        style={{
          font: '600 11px/1.4 ui-monospace, Menlo, monospace',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          color: '#8b939b',
          margin: '0 0 8px',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
