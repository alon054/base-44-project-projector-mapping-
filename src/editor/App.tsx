/**
 * Editor control panel. Phase 0's display picker, parameter slider, always-on
 * metrics mirror (C4) and round-trip readout, plus Phase 1's layer list.
 *
 * The scene lives here and crosses to the output as JSON (I-7). The preview
 * renders the same scene at reduced resolution — an approximation, not a
 * mirror: each window loads its own content and runs its own loop.
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
  type SceneFailure,
} from '@shared/ipc';
import {
  MAX_RENDER_FRACTION,
  formatReport,
  passesHeadroom,
  passesPresentation,
  percentile,
} from '../debug/hud';
import { PreviewCanvas } from './PreviewCanvas';
import { LayerPanel } from './LayerPanel';
import { useSceneRegistry } from './useSceneRegistry';
import { useClock } from './useClock';
import { TransportPanel } from './TransportPanel';
import { WarpPanel } from './WarpPanel';
import type { Clock } from '../core/clock';
import {
  createAltScene,
  createDefaultScene,
  createPhase3Scene,
  createResilienceVideoScene,
  sceneById,
  createPhase4Scene,
  createPhase4ReferenceScene,
} from '../core/defaultScene';
import type { Scene } from '../core/scene';
import { ForcePanel } from './ForcePanel';
import {
  calibrationFor,
  canonicalizeCalibration,
  canonicalizeCalibrationFile,
  createCalibration,
  type ViewportCalibration,
} from '../render/calibration';


export function App(): React.JSX.Element {
  const [speed, setSpeed] = useState(1);
  const [scene, setScene] = useState<Scene>(createDefaultScene);
  const [failures, setFailures] = useState<SceneFailure[]>([]);
  const registry = useSceneRegistry(scene, setScene);
  // I-2. Operator intent, registered under `clock.*` and sent on `clock:set`.
  // The preview's live clock, for the transport's readout and loop ruler. A
  // ruler driven by intent would animate smoothly even if the render host had
  // stopped sampling the clock, which is the defect it exists to catch.
  const [previewClock, setPreviewClock] = useState<Clock | null>(null);
  const previewClockRef = useRef<Clock | null>(null);
  previewClockRef.current = previewClock;
  const clockTransport = useClock(
    registry,
    // Read through a ref: the hook is created before the preview host exists,
    // and a relative nudge must step from the show's time once it does.
    useCallback(() => previewClockRef.current?.timeMs ?? null, []),
  );
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [metrics, setMetrics] = useState<MetricsReport | null>(null);
  const [uncapped, setUncapped] = useState(false);
  const [nominalMs, setNominalMs] = useState(0);
  const [warning, setWarning] = useState<string>('');
  // A11: two figures, never conflated. Transport is what moves under load.
  const [transport, setTransport] = useState<number[]>([]);
  const [presented, setPresented] = useState<number[]>([]);
  /**
   * presented - transport for the SAME token: the frame-cadence component,
   * isolated. Structurally this must land between 1xN and 2xN — one deliberate
   * ack frame plus a 0-1 frame wait for the output's next rAF — so a shift
   * inside that band is vsync phase, and a shift outside it is a regression.
   * Without this, telling those apart needed an argument instead of a number.
   */
  const [frameWait, setFrameWait] = useState<number[]>([]);
  const transportByToken = useRef(new Map<number, number>());
  const transportRef = useRef<number[]>([]);
  const presentedRef = useRef<number[]>([]);
  const frameWaitRef = useRef<number[]>([]);
  const [measureLabel, setMeasureLabel] = useState('');
  const token = useRef(0);
  /**
   * I-5. Held here, sent on its OWN channel, and never folded into the scene —
   * which is what makes "loading a different scene keeps the same calibration"
   * a property of the design rather than of message ordering.
   */
  const [calibration, setCalibration] = useState<ViewportCalibration>(() =>
    createCalibration(CALIBRATION_VIEWPORT),
  );

  /**
   * True once the config has been consulted, so the FIRST scene this editor
   * sends is the one the run asked for.
   *
   * Without this the mount effect below fires immediately with the built-in
   * default, the config arrives a moment later, and the output window records
   *   [scene] applied "phase3-load"
   *   [scene] applied "phase1-default"
   *   [scene] applied "phase3-load"
   * — which is what the run log showed on the first Phase 3 launch. Harmless to
   * look at and not harmless to measure: a flap inside §4's warmup rebuilds
   * every layer and re-decodes the video, and a shorter warmup would have put
   * that inside the gate window with nothing in the summary to say so.
   */
  const configSeen = useRef(false);

  // The whole scene, on every edit. Small, operator-paced, and JSON only (I-7).
  useEffect(() => {
    if (!configSeen.current) return;
    window.engine.setScene({ scene });
  }, [scene]);

  /** Applied once. A later config push must not yank an edited scene back. */
  const namedSceneApplied = useRef(false);
  const applyNamedScene = useCallback((id: string) => {
    const first = !configSeen.current;
    configSeen.current = true;
    if (id !== '' && !namedSceneApplied.current) {
      const named = sceneById(id);
      if (named) {
        namedSceneApplied.current = true;
        setScene(named);
        return;
      }
    }
    // No named scene, or one we do not know. The editor still owes the output
    // its current scene — it just owes it once the config has been seen.
    if (first) setScene((prev) => ({ ...prev }));
  }, []);

  useEffect(() => window.engine.onSceneFailures(setFailures), []);

  // I-5: read the stored calibration once at launch. A read that fails leaves
  // the identity calibration in place — unwarped is visible and correctable.
  useEffect(() => {
    void window.engine
      .getCalibration()
      .then((raw) => {
        if (!raw || typeof raw !== 'object') return;
        setCalibration(
          'viewports' in (raw as object)
            ? calibrationFor(canonicalizeCalibrationFile(raw), CALIBRATION_VIEWPORT)
            : canonicalizeCalibration(raw, CALIBRATION_VIEWPORT),
        );
      })
      .catch((err: unknown) => {
        console.error(`[warp] could not read stored calibration: ${String(err)}`);
      });
  }, []);

  const applyCalibration = useCallback((next: ViewportCalibration) => {
    setCalibration(next);
    // Plain JSON across the boundary (I-7); normalized corners only (I-1).
    window.engine.setCalibration({
      viewportId: next.viewportId,
      enabled: next.enabled,
      corners: next.corners.map((p) => ({ x: p.x, y: p.y })),
    });
  }, []);

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
      setMeasureLabel(c.measureLabel);
      if (c.displayFrequency > 0) setNominalMs(1000 / c.displayFrequency);
      // §4: an unattended run names the scene, and the EDITOR opens on it too.
      // Otherwise the editor's mount would push Phase 1's default over the top
      // of the run's scene a moment after it loaded, and the summary would
      // describe a layer load nobody asked for.
      applyNamedScene(c.sceneId);
    });
    const offMetrics = window.engine.onMetrics(setMetrics);
    const offConfig = window.engine.onOutputConfig((c) => {
      setUncapped(c.uncapped);
      setMeasureLabel(c.measureLabel);
      if (c.displayFrequency > 0) setNominalMs(1000 / c.displayFrequency);
      // §4: an unattended run names the scene, and the EDITOR opens on it too.
      // Otherwise the editor's mount would push Phase 1's default over the top
      // of the run's scene a moment after it loaded, and the summary would
      // describe a layer load nobody asked for.
      applyNamedScene(c.sceneId);
      refreshDisplays();
    });
    const offWarn = window.engine.onWarning((w) => setWarning(w.level === 'info' ? '' : w.text));
    const offRecv = window.engine.onParamRecv(({ token, t0 }) => {
      const rtt = performance.now() - t0;
      setTransport((prev) => [...prev.slice(-299), rtt]);
      transportRef.current.push(rtt);
      const m = transportByToken.current;
      m.set(token, rtt);
      // Not every token gets an ack — a drag supersedes pending values — so the
      // map is bounded rather than trusted to drain.
      if (m.size > 512) for (const k of m.keys()) { m.delete(k); if (m.size <= 256) break; }
    });
    const offAck = window.engine.onParamAck(({ token, t0 }) => {
      const rtt = performance.now() - t0;
      setPresented((prev) => [...prev.slice(-299), rtt]);
      presentedRef.current.push(rtt);
      const t = transportByToken.current.get(token);
      if (t !== undefined) {
        transportByToken.current.delete(token);
        setFrameWait((prev) => [...prev.slice(-299), rtt - t]);
        frameWaitRef.current.push(rtt - t);
      }
    });
    return () => {
      offMetrics();
      offConfig();
      offWarn();
      offRecv();
      offAck();
    };
  }, [refreshDisplays]);

  /**
   * A11 latency bench. A gate run must not carry a slider drag — the IPC and
   * React work would land inside the measurement window — so the latency
   * figures are taken in their own short run instead. Sweeps the parameter at
   * frame cadence, then reports transport, presented, and the frame-cadence
   * component isolated by pairing them on the token.
   */
  const benchRan = useRef(false);
  useEffect(() => {
    if (benchRan.current || measureLabel !== 'latency' || nominalMs <= 0) return;
    benchRan.current = true;
    let i = 0;
    const SAMPLES = 240;
    const id = window.setInterval(() => {
      if (i >= SAMPLES) {
        window.clearInterval(id);
        window.setTimeout(() => {
          const fmt = (xs: readonly number[]) => {
            if (xs.length === 0) return 'none';
            const s2 = [...xs].sort((a, b) => a - b);
            return `median ${percentile(s2, 0.5).toFixed(2)} p95 ${percentile(s2, 0.95).toFixed(2)} n=${s2.length}`;
          };
          console.log(`[latency] transport ${fmt(transportRef.current)}`);
          console.log(`[latency] presented ${fmt(presentedRef.current)}`);
          console.log(`[latency] frameWait ${fmt(frameWaitRef.current)}  N=${nominalMs.toFixed(4)}ms`);
          const fw = [...frameWaitRef.current].sort((a, b) => a - b);
          const med = fw.length ? percentile(fw, 0.5) : 0;
          console.log(
            `[latency] frameWait median = ${(med / nominalMs).toFixed(3)}x N  ` +
              `${med >= nominalMs && med <= nominalMs * 2 ? 'IN BAND (1-2x N)' : 'OUT OF BAND'}`,
          );
          window.engine.measureDone();
        }, 1500);
        return;
      }
      i++;
      token.current += 1;
      window.engine.setParam({
        key: PARAM_TEST_PATTERN_SPEED,
        value: 1 + Math.sin(i / 10) * 0.5,
        token: token.current,
        t0: performance.now(),
      });
    }, 16);
    return () => window.clearInterval(id);
  }, [measureLabel, nominalMs]);

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
  const wStat = useMemo(() => stat(frameWait), [frameWait]);

  return (
    <div style={{ display: 'flex', gap: 20, padding: 20, alignItems: 'flex-start' }}>
      <div style={{ width: 380, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header>
          <h1 style={{ font: '600 15px/1.3 inherit', margin: '0 0 4px' }}>
            Projection Engine — Phase 1
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
              } ms${nominalMs > 0 ? ` = ${((pStat.median - nominalMs) / nominalMs).toFixed(2)}× N` : ''}
frame wait median ${wStat ? wStat.median.toFixed(1) : '—'} ms${
                wStat && nominalMs > 0
                  ? ` = ${(wStat.median / nominalMs).toFixed(2)}× N  ${
                      wStat.median >= nominalMs && wStat.median <= nominalMs * 2
                        ? '(in the structural 1–2× N band)'
                        : 'OUT OF BAND — investigate'
                    }`
                  : ''
              }`}
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
          <PreviewCanvas
            speed={speed}
            nominalMs={nominalMs}
            scene={scene}
            clockState={clockTransport.state}
            onClockReady={setPreviewClock}
          />
        </Panel>

        <Panel title="Transport — I-2, one clock for everything">
          <TransportPanel transport={clockTransport} clock={previewClock} />
        </Panel>

        <Panel title="Warp — I-5 final stage, calibration/ not scenes">
          <WarpPanel
            calibration={calibration}
            onChange={applyCalibration}
            output={DEV_RESOLUTION}
          />
          <div style={{ marginTop: 10, borderTop: '1px solid #2b2f34', paddingTop: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...buttonStyle, marginTop: 0 }}
                onClick={() => setScene(createDefaultScene())}
              >
                Scene A
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, marginTop: 0 }}
                onClick={() => setScene(createAltScene())}
              >
                Scene B
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, marginTop: 0 }}
                onClick={() => setScene(createPhase3Scene())}
              >
                Phase 3 load
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, marginTop: 0 }}
                onClick={() => setScene(createResilienceVideoScene())}
              >
                I-13 video
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, marginTop: 0 }}
                onClick={() => setScene(createPhase4Scene())}
              >
                Phase 4 forces
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, marginTop: 0 }}
                onClick={() => setScene(createPhase4ReferenceScene())}
                title="Diagnostic: the grey patch must never change, whatever you drag"
              >
                Reference patch
              </button>
              <span style={{ fontSize: 12, color: '#8b939b' }}>current: {scene.id}</span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#8b939b' }}>
              Gate 2: switching these must leave the corners above untouched. Two
              constructed scenes through the existing editor path — the scene bank,
              save/load and undo are all Phase 6 and are not built here.
            </p>
          </div>
        </Panel>

        <Panel title="Forces & parallax — I-4, I-8, I-14, D3">
          <ForcePanel scene={scene} registry={registry} />
        </Panel>

        <Panel title="Layers — z-order, opacity, blend (I-1, I-6, I-8)">
          <LayerPanel
            scene={scene}
            setScene={setScene}
            registry={registry}
            failures={failures}
          />
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

/** I-9: the single viewport v1 drives. Calibration is keyed by it. */
const CALIBRATION_VIEWPORT = 'main';

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
