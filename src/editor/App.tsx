/**
 * Editor control panel. Phase 0 scope: display picker, one parameter, the
 * always-on metrics text mirror (C4), and the instrumented round-trip readout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEV_RESOLUTION,
  PARAM_TEST_PATTERN_SPEED,
  PRESENTED_GATE_MS,
  TARGET_RESOLUTION,
  TRANSPORT_GATE_MS,
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


export function App(): React.JSX.Element {
  const [speed, setSpeed] = useState(1);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [metrics, setMetrics] = useState<MetricsReport | null>(null);
  const [uncapped, setUncapped] = useState(false);
  const [nominalMs, setNominalMs] = useState(0);
  const [warning, setWarning] = useState<string>('');
  // A11: two figures, never conflated. Transport is what moves under load.
  const [transport, setTransport] = useState<number[]>([]);
  const [presented, setPresented] = useState<number[]>([]);
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
    const offRecv = window.engine.onParamRecv(({ t0 }) => {
      const rtt = performance.now() - t0;
      setTransport((prev) => [...prev.slice(-299), rtt]);
    });
    const offAck = window.engine.onParamAck(({ t0 }) => {
      const rtt = performance.now() - t0;
      setPresented((prev) => [...prev.slice(-299), rtt]);
    });
    return () => {
      offMetrics();
      offConfig();
      offWarn();
      offRecv();
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

  const stat = (xs: readonly number[]) => {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    return { n: xs.length, median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
  };
  const tStat = useMemo(() => stat(transport), [transport]);
  const pStat = useMemo(() => stat(presented), [presented]);

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

        <Panel title="Editor → output latency (A11: two figures, never conflated)">
          {tStat && pStat ? (
            <pre style={preStyle}>
              {`transport  median ${tStat.median.toFixed(1)}  p95 ${tStat.p95.toFixed(1)} ms  ${
                tStat.p95 <= TRANSPORT_GATE_MS ? 'PASS' : 'FAIL'
              } (<=${TRANSPORT_GATE_MS} ms)  n=${tStat.n}
presented  median ${pStat.median.toFixed(1)}  p95 ${pStat.p95.toFixed(1)} ms  ${
                pStat.p95 <= PRESENTED_GATE_MS ? 'PASS' : 'FAIL'
              } (<=${PRESENTED_GATE_MS} ms)  n=${pStat.n}
implied one-way presented ≈ ${
                nominalMs > 0 ? (pStat.median - nominalMs).toFixed(1) : '—'
              } ms${nominalMs > 0 ? ` = ${((pStat.median - nominalMs) / nominalMs).toFixed(2)}× N` : ''}`}
            </pre>
          ) : (
            <p style={{ margin: 0, color: '#8b939b' }}>Move the slider to sample.</p>
          )}
          <p style={{ margin: '6px 0 0', color: '#6f767d', fontSize: 12 }}>
            <strong>Transport</strong> is editor event → output receipt, no frame wait — the figure
            that moves under load. <strong>Presented</strong> is acked from the frame after the one
            that rendered, so it is conservative by one frame by construction. Neither includes
            projector panel latency, which is informational and measured separately.
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
                {passesHeadroom(metrics) ? '✓' : '✗'} (p99 ≤{' '}
                {(MAX_RENDER_FRACTION * 100).toFixed(0)}% of N, A10)
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
