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
  isSceneName,
} from '@shared/ipc';
import {
  MAX_RENDER_FRACTION,
  formatReport,
  passesHeadroom,
  passesPresentation,
  percentile,
} from '../debug/hud';
import { PREVIEW_SIZE, PreviewCanvas } from './PreviewCanvas';
import { forwardedShortcut, shortcutFor } from './outputKeys';
import { LayerPanel } from './LayerPanel';
import { EntityPanel } from './EntityPanel';
import { createPanelUi, selectedLayerId, type PanelUi } from './controls';
import { useSceneRegistry } from './useSceneRegistry';
import { useClock } from './useClock';
import { TransportPanel } from './TransportPanel';
import { WarpPanel } from './WarpPanel';
import type { Clock } from '../core/clock';
import {
  createAltScene,
  createBlankScene,
  createDefaultScene,
  createPhase3Scene,
  createResilienceVideoScene,
  sceneById,
  createPhase4Scene,
  createPhase4ReferenceScene,
} from '../core/defaultScene';
import type { Scene } from '../core/scene';
import { readSceneFile } from '../core/sceneFile';
import { createRoomHistory, recordWrite, redo as redoRoomHistory, undo as undoRoomHistory, type RoomHistory } from '@shared/roomHistory';
import { isTypingTarget } from './outputKeys';
import { ForcePanel } from './ForcePanel';
import {
  calibrationFor,
  canonicalizeCalibration,
  canonicalizeCalibrationFile,
  createCalibration,
  readSurfaces,
  writeSurfaces,
  type ViewportCalibration,
} from '../render/calibration';
import { canonicalizeSurface, describeSurfaces, type SurfaceTree } from '../core/surfaces';
import { SurfacePanel } from './SurfacePanel';
import { FillPanel } from './FillPanel';
import { ensureOwnFillLayer, withOwnFillRole, withSharedFillRole, withoutOwnFillLayers } from './ownFill';
import { GroupPanel } from './GroupPanel';
import { LayerTree } from './LayerTree';
import { syncFaceLayers, withFaceRoles } from './faceLayers';
import { ParamControl } from './ParamControl';
import { LibraryDrawer } from './LibraryDrawer';
import { libraryVersion as readLibraryVersion, onLibraryChange, registerLibraryEntries } from './assets';


export function App(): React.JSX.Element {
  const [speed, setSpeed] = useState(1);
  // W1 fix: a blank page, not the Phase-1 scene. A stored scene (S1) replaces it at launch.
  const [scene, setScene] = useState<Scene>(createBlankScene);
  const [failures, setFailures] = useState<SceneFailure[]>([]);
  /**
   * P5-F. The control panel's own state — which layer is selected, which
   * sections are open. **Held here and nowhere near the scene**: it is not
   * content, it must not reach a saved file, and there is no function that
   * copies one into the other (`controls.ts`). The selection is resolved
   * against the scene on every render rather than stored resolved, so deleting
   * the selected layer cannot leave the panel pointing at a layer that is gone.
   */
  const [panelUi, setPanelUi] = useState<PanelUi>(createPanelUi);
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
   * I-15, B3. The room, held beside the warp and never inside the scene.
   *
   * Both halves of `calibration/` live here for the same reason and take the
   * same route out: their own channel, persisted by main on the way through,
   * untouched by every scene switch. That is what makes "re-marking a face
   * leaves the warp alone, and loading a different scene leaves both alone" a
   * property of the design rather than of message ordering.
   */
  const [surfaces, setSurfaces] = useState<SurfaceTree>([]);
  /**
   * Wall mode — the editor with everything that is not the loop taken away.
   *
   * **Defaults ON, and that is the point.** The first attempt to use B3 at a
   * projector failed on "couldn't find the controls": twelve panels, and the one
   * that mattered was a tool dropdown the size of a word. The loop worked and was
   * unreachable, which from the wall is the same thing as broken. So the editor
   * now opens on the four things the loop needs and everything else is one click
   * away, rather than the other way round.
   *
   * `useState` here, like the panel's own UI state: it is not content, it must
   * not reach a saved file, and there is nothing that copies it into one.
   */
  const [wallMode, setWallMode] = useState(true);

  /**
   * The Photoshop layout (UI_PLAN.md §3, the part R4 allows): the stage fills
   * its column and the right column holds Layers and Room as tabs. The
   * preview's backing store follows the column's width — measured, not
   * assumed, and rounded to 16 px so a window drag does not rebuild every
   * mask at every pixel. Selection of a folder is panel state like a layer's.
   */
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  /** True once the stored room has been read, empty or not — `faceLayers.ts`'s prune waits for it. */
  const [roomLoaded, setRoomLoaded] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState<number>(WALL_PREVIEW_SIZE.width);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      // The Panel around the canvas is 12 px padding + 1 px border a side,
      // and 16 px more is left for the scrollbar a tall column brings, so the
      // stage never pushes the column off the window when one appears.
      const w = (entries[0]?.contentRect.width ?? 0) - 26 - 16;
      const snapped = Math.max(480, Math.floor(w / 16) * 16);
      setStageWidth((prev) => (prev === snapped ? prev : snapped));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [wallMode]);
  const stageSize = useMemo(
    () => ({ width: stageWidth, height: Math.round((stageWidth * 9) / 16) }),
    [stageWidth],
  );
  /**
   * The downloaded library's version — a memo dependency for the pickers, not
   * a copy of the library. Pulled at startup (`library:list`), then advanced
   * by every `library:added` and by the catalog panel's own adds.
   */
  const [libraryVersion, setLibraryVersion] = useState(readLibraryVersion);
  useEffect(() => {
    const off = onLibraryChange(setLibraryVersion);
    void window.engine
      .listLibrary()
      .then((entries) => registerLibraryEntries(entries))
      .catch((err: unknown) => console.warn(`[library] could not list: ${String(err)}`));
    const offAdded = window.engine.onLibraryAdded((entry) => registerLibraryEntries([entry]));
    return () => {
      off();
      offAdded();
    };
  }, []);
  /** The Library drawer (find + download). Closed, it takes no space. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  /** The four-step card in wall mode, folded once it has been read. */
  const [showSteps, setShowSteps] = useState(false);

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

  /**
   * S1. The scene on disk — `scenes/<sceneFile>.json`. One name, one Save,
   * one Load; the picker, the bank and the cross-fade stay P8-C and P8-E.
   *
   * `sceneNote` is what the last save or load said, shown beside the buttons,
   * because a refusal that goes only to the console is a refusal the operator
   * discovers at the wall.
   */
  const [sceneFile, setSceneFile] = useState('reel');
  const [sceneNote, setSceneNote] = useState('');
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const saveScene = useCallback(() => {
    if (!isSceneName(sceneFile)) {
      setSceneNote(`refused: "${sceneFile}" is not a scene name (a-z, 0-9, - and _)`);
      return;
    }
    void window.engine
      .saveScene({ name: sceneFile, scene: sceneRef.current })
      .then((r) => setSceneNote(r.ok ? `saved ${sceneFile}.json` : `refused: ${r.reason}`))
      .catch((err: unknown) => setSceneNote(`save failed: ${String(err)}`));
  }, [sceneFile]);

  const loadScene = useCallback(() => {
    if (!isSceneName(sceneFile)) {
      setSceneNote(`refused: "${sceneFile}" is not a scene name (a-z, 0-9, - and _)`);
      return;
    }
    void window.engine
      .loadScene({ name: sceneFile })
      .then((stored) => {
        if (stored === null) {
          setSceneNote(`no scenes/${sceneFile}.json`);
          return;
        }
        const read = readSceneFile(stored.scene);
        if (!read.ok) {
          // The scene on screen is left exactly as it was (I-13).
          setSceneNote(`refused ${sceneFile}.json: ${read.reason}`);
          return;
        }
        setScene(read.scene);
        setSceneNote(`loaded ${sceneFile}.json`);
      })
      .catch((err: unknown) => setSceneNote(`load failed: ${String(err)}`));
  }, [sceneFile]);

  // S1. The last scene, once at launch — the same shape as the room's read
  // below. A `PROJENGINE_SCENE` measurement run keeps its named scene: the
  // stored one applies only if no named scene has, and a named scene arriving
  // later still wins (it always sets). A file that fails to read leaves the
  // built-in default on screen, with the reason beside the Save button.
  useEffect(() => {
    void window.engine
      .storedScene()
      .then((stored) => {
        if (stored === null) return;
        setSceneFile(stored.name);
        const read = readSceneFile(stored.scene);
        if (!read.ok) {
          setSceneNote(`refused ${stored.name}.json at launch: ${read.reason}`);
          return;
        }
        if (namedSceneApplied.current) return;
        setScene(read.scene);
        setSceneNote(`opened ${stored.name}.json`);
      })
      .catch((err: unknown) => {
        console.error(`[scenes] could not read the stored scene: ${String(err)}`);
      });
  }, []);

  /**
   * P5-E. The output window's shortcuts, pressed from here.
   *
   * The projector display runs `cursor: none` and is not normally focused, so
   * reaching `h` on it meant clicking a display where the pointer is invisible
   * — and a click there steals focus from the window a measurement run is
   * watching, which is how three runs were lost in three sessions.
   *
   * Which keys these are is not decided here: `forwardedShortcut` asks
   * `OUTPUT_SHORTCUTS`, and the output dispatches from the same table. Only the
   * key identity crosses (I-7) — this window does not know what `h` means and
   * has no reason to.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const shortcut = forwardedShortcut({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        target: e.target as { tagName?: string; isContentEditable?: boolean } | null,
      });
      if (!shortcut) return;
      window.engine.sendOutputKey({ key: shortcut.key });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // I-15: read the stored room once at launch, exactly as the warp is read
  // above. A read that fails leaves an empty room — visible as nothing lit, and
  // correctable by marking a face, which beats an editor that will not start
  // (I-13).
  useEffect(() => {
    void window.engine
      .getSurfaces()
      .then((raw) => {
        // Every face on its own token (`faceLayers.ts`): a room from before
        // that rule reads in as it was and is normalised on its next write.
        const tree = withFaceRoles(readSurfaces(raw, canonicalizeSurface));
        if (tree.length > 0) {
          surfacesRef.current = tree;
          setSurfaces(tree);
        }
        setRoomLoaded(true);
        console.log(describeSurfaces(tree));
      })
      .catch((err: unknown) => {
        console.error(`[surfaces] could not read the stored room: ${String(err)}`);
      });
  }, []);

  /**
   * **The one place the room is written.** Every edit — a point dragged in the
   * preview, a role typed in the list, a face deleted — arrives here, and here
   * is where it becomes a file and a message.
   *
   * Not on a save button, and not debounced (SPRINT.md §3 R1). The builder is
   * standing at the wall with a point under their finger and needs the
   * projection to answer; a debounce would put the wall behind the hand, which
   * is worse than the write it saves. Main persists before it forwards, so a
   * failed disk write still moves the face on the wall (I-13).
   *
   * `writeSurfaces` builds the same envelope that lands on disk, so what
   * crosses the boundary and what is stored are the same bytes rather than two
   * shapes to keep in step. Normalized points only — no pixels cross (I-1, I-7).
   */
  const applySurfaces = useCallback((edited: SurfaceTree) => {
    // A face is a layer: a traced face leaves the default role for its own
    // token here, in the one room writer, so nothing downstream ever sees a
    // face without one (`faceLayers.ts`).
    const next = withFaceRoles(edited);
    // S3. The room before this write goes into the ring if the write starts
    // a gesture (`roomHistory.ts`, the one rule; main applies the same one to
    // the snapshot files). Every sample of a drag still writes; only the
    // first records.
    roomHistory.current = recordWrite(roomHistory.current, surfacesRef.current, Date.now());
    surfacesRef.current = next;
    setSurfaces(next);
    window.engine.setSurfaces(writeSurfaces(next));
  }, []);

  /**
   * S3. Room history — a backup for calibration, NOT undo for content
   * (SPEC.md §12 stands for the scene; the `SPEC-CHANGE-PROPOSED` entry in the
   * log states the distinction). Twenty gestures, in memory, room only.
   * `Cmd+Z` / `Cmd+Shift+Z`, and two buttons beside the face list. A restore
   * is a write like any other — it goes to disk and to the wall through the
   * same path — but it records nothing, or undo would push what it just
   * popped.
   */
  const roomHistory = useRef<RoomHistory<SurfaceTree>>(createRoomHistory<SurfaceTree>());
  const surfacesRef = useRef<SurfaceTree>(surfaces);
  const [roomHistoryDepth, setRoomHistoryDepth] = useState<[number, number]>([0, 0]);
  const restoreRoom = useCallback((next: SurfaceTree, history: RoomHistory<SurfaceTree>) => {
    roomHistory.current = history;
    surfacesRef.current = next;
    setSurfaces(next);
    setRoomHistoryDepth([history.past.length, history.future.length]);
    window.engine.setSurfaces(writeSurfaces(next));
  }, []);
  const undoRoom = useCallback(() => {
    const r = undoRoomHistory(roomHistory.current, surfacesRef.current);
    if (r) restoreRoom(r.tree, r.history);
  }, [restoreRoom]);
  const redoRoom = useCallback(() => {
    const r = redoRoomHistory(roomHistory.current, surfacesRef.current);
    if (r) restoreRoom(r.tree, r.history);
  }, [restoreRoom]);
  useEffect(() => {
    setRoomHistoryDepth([roomHistory.current.past.length, roomHistory.current.future.length]);
  }, [surfaces]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key !== 'z' && e.key !== 'Z') return;
      // A field keeps its own undo; this one is the room's.
      if (isTypingTarget(e.target as { tagName?: string; isContentEditable?: boolean } | null)) return;
      e.preventDefault();
      if (e.shiftKey) redoRoom();
      else undoRoom();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoRoom, redoRoom]);

  /**
   * Which roles the scene is actually filling, for the surface list's "is this
   * face lit" column. Derived from the scene on every change rather than
   * tracked, because a `fillRole` edited in the layer panel must move this
   * column with it and a second copy would be a second thing to update.
   */
  /**
   * A face is a layer (`faceLayers.ts`): one white fill per face on its own
   * token, made the moment the face exists — so a traced face lights at once
   * and has a row — and removed when the face goes, once the room is known.
   * Identity when nothing is owed, so React bails and this cannot loop.
   */
  useEffect(() => {
    setScene((prev) => syncFaceLayers(prev, surfaces, roomLoaded));
  }, [surfaces, roomLoaded, scene]);

  const filledRoles = useMemo(
    () => [...new Set(scene.layers.flatMap((l) => (l.fillRole ? [l.fillRole] : [])))],
    [scene],
  );

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

  const selectedDisplay = displays.find((d) => d.isSelected);

  /** Whether a layer already fills the default role — the white-fill button is then done. */
  const panelFilled = scene.layers.some((l) => l.fillRole === WHITE_FILL_ROLE);

  const roomPanel = (
    <Panel title="Room — the faces you marked (calibration/surfaces.json)">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        {/*
          W1 fix. The white-fill button is gone at the builder's
          request: the face guides on the projection (grid on from launch) are
          the placement aid now, and a face goes straight from marked to an
          animation on its role. `addWhiteFill` stays in `core/sceneEdit.ts`
          — B3's tests and the reel's beat 3 still use it.
        */}
        <span style={{ fontSize: 12, color: '#8b939b' }}>
          {filledRoles.length === 0
            ? 'no layer fills a role yet — nothing will land on a face'
            : `filled roles: ${filledRoles.join(', ')}`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <button
          type="button"
          onClick={undoRoom}
          disabled={roomHistoryDepth[0] === 0}
          style={{ ...buttonStyle, marginTop: 0 }}
          title="Undo the last gesture on the room — a drag, a delete, a mark. ⌘Z. The scene is untouched."
        >
          ↶ Undo room{roomHistoryDepth[0] > 0 ? ` (${roomHistoryDepth[0]})` : ''}
        </button>
        <button
          type="button"
          onClick={redoRoom}
          disabled={roomHistoryDepth[1] === 0}
          style={{ ...buttonStyle, marginTop: 0 }}
          title="Redo. ⇧⌘Z"
        >
          ↷ Redo{roomHistoryDepth[1] > 0 ? ` (${roomHistoryDepth[1]})` : ''}
        </button>
      </div>
      <SurfacePanel
        surfaces={surfaces}
        onSurfaces={applySurfaces}
        filledRoles={filledRoles}
        // One press, two trees, one write each (`ownFill.ts`): the room through
        // the same path a typed role takes, the scene through the same updater
        // every panel uses. Neither half sees the other's tree.
        onOwnFill={(id) => {
          const face = surfacesRef.current.find((s) => s.id === id);
          if (!face) return;
          applySurfaces(withOwnFillRole(surfacesRef.current, id));
          setScene((prev) => ensureOwnFillLayer(prev, face));
        }}
        onShareFill={(id) => {
          const face = surfacesRef.current.find((s) => s.id === id);
          if (!face) return;
          applySurfaces(withSharedFillRole(surfacesRef.current, id));
          setScene((prev) => withoutOwnFillLayers(prev, face));
        }}
      />
      <p style={{ margin: '8px 0 0', fontSize: 11, color: '#6f767d' }}>
        A role can be several words: <code>panel f1</code> is in the shared fill AND its own
        slot, which is how a sequence lights faces one at a time.
      </p>
    </Panel>
  );

  const fillPanel = (
    <Panel title="Fill — what the faces show">
      <FillPanel scene={scene} setScene={setScene} surfaces={surfaces} libraryVersion={libraryVersion} />
    </Panel>
  );

  const groupsPanel = (
    <Panel title="Groups — together, or one after another">
      <GroupPanel scene={scene} setScene={setScene} registry={registry} />
    </Panel>
  );

  const warpBody = (
    <>
      <WarpPanel calibration={calibration} onChange={applyCalibration} output={DEV_RESOLUTION} />
      {!wallMode && (
        <div style={{ marginTop: 10, borderTop: '1px solid #2b2f34', paddingTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={{ ...buttonStyle, marginTop: 0 }} onClick={() => setScene(createDefaultScene())}>
              Scene A
            </button>
            <button type="button" style={{ ...buttonStyle, marginTop: 0 }} onClick={() => setScene(createAltScene())}>
              Scene B
            </button>
            <button type="button" style={{ ...buttonStyle, marginTop: 0 }} onClick={() => setScene(createPhase3Scene())}>
              Phase 3 load
            </button>
            <button type="button" style={{ ...buttonStyle, marginTop: 0 }} onClick={() => setScene(createResilienceVideoScene())}>
              I-13 video
            </button>
            <button type="button" style={{ ...buttonStyle, marginTop: 0 }} onClick={() => setScene(createPhase4Scene())}>
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
            Gate 2: switching these must leave the corners above untouched. Two constructed scenes
            through the existing editor path — the scene bank, save/load and undo are all Phase 6
            and are not built here.
          </p>
        </div>
      )}
    </>
  );

  const previewPanel = (
    <Panel title="Preview — scene space, not a photo of the wall (I-7)">
      {/* P5-B: `setScene` is the same setter the layer list writes
          through, so a pointer edit and a button edit are one code path to
          the output. Selection is NOT passed — it is the preview's own UI
          state and has no business up here (I-7). */}
      <PreviewCanvas
        speed={speed}
        nominalMs={nominalMs}
        scene={scene}
        clockState={clockTransport.state}
        onClockReady={setPreviewClock}
        setScene={setScene}
        surfaces={surfaces}
        onSurfaces={applySurfaces}
        size={wallMode ? stageSize : PREVIEW_SIZE}
        wallMode={wallMode}
      />
    </Panel>
  );

  return (
    <div style={wallMode ? { padding: 10, height: '100vh', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' } : { padding: 20 }}>
      {/*
        The mode switch, first and unmissable. Everything hidden below is one
        click away, and the line beside it says what the output is doing, so
        "which display, and is the warp on" is answerable without leaving wall
        mode to go and look.
      */}
      <div style={wallBarStyle}>
        <div style={segmentStyle} role="group" aria-label="editor mode">
          <button
            type="button"
            aria-pressed={wallMode}
            onClick={() => setWallMode(true)}
            style={{ ...segmentButton, ...(wallMode ? segmentOn : {}) }}
            title="Only what the wall loop needs: preview, faces, fill, groups"
          >
            Wall mode
          </button>
          <button
            type="button"
            aria-pressed={!wallMode}
            onClick={() => setWallMode(false)}
            style={{ ...segmentButton, ...(!wallMode ? segmentOn : {}) }}
            title="Every panel: displays, transport, forces, layers, entity, metrics"
          >
            Everything
          </button>
        </div>
        {/*
          The wall reference grid, toggled from here because the projector
          display runs `cursor: none` and is usually not focused — the same
          reason P5-E built key forwarding at all. It sends the KEY the table
          names for the action, so the button, `g` at the editor and `g` at the
          output window all reach one handler.

          The editor cannot show whether the grid is currently on: the output
          window owns that state and does not report it. Deliberate for now —
          the grid is a grid, it is unmissable on the wall, and the output logs
          `[grid] ON` so a run record can answer it. Noted rather than plumbed.
        */}
        <button
          type="button"
          onClick={() => window.engine.sendOutputKey({ key: shortcutFor('wallGrid').key })}
          style={{ ...buttonStyle, marginTop: 0 }}
          title="The white grid and face guides ON THE PROJECTOR. Toggle — press again to clear it. Same as g on the output. Off before a take."
        >
          Projector grid ⇄
        </button>
        {/* S1. The show on disk. One name, Save, Load — nothing more before P8-C. */}
        <input
          type="text"
          value={sceneFile}
          aria-label="scene file name"
          spellCheck={false}
          maxLength={64}
          onChange={(e) => setSceneFile(e.currentTarget.value)}
          title="scenes/<name>.json — a-z, 0-9, - and _"
          style={{
            width: 72,
            background: '#0d1013',
            color: '#c7ced4',
            border: '1px solid #2a3138',
            borderRadius: 3,
            padding: '2px 5px',
            font: 'inherit',
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={saveScene}
          style={{ ...buttonStyle, marginTop: 0 }}
          title="Write the layers, groups, roles and durations to scenes/<name>.json. The room is not in it (I-15)."
        >
          Save scene
        </button>
        <button
          type="button"
          onClick={loadScene}
          style={{ ...buttonStyle, marginTop: 0 }}
          title="Replace the scene on screen with scenes/<name>.json. The room is untouched."
        >
          Load
        </button>
        {sceneNote !== '' && (
          <span style={{ fontSize: 12, color: sceneNote.startsWith('refused') || sceneNote.includes('failed') ? '#d8b45a' : '#8b939b' }}>
            {sceneNote}
          </span>
        )}
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          style={{ ...buttonStyle, marginTop: 0 }}
          title="Find loops on the Internet Archive and download them into the library"
        >
          Library — find &amp; download…
        </button>
        <span style={{ fontSize: 12, color: '#8b939b' }}>
          {selectedDisplay
            ? `output → ${selectedDisplay.label} ${selectedDisplay.size.width}×${selectedDisplay.size.height}`
            : 'output → no display picked'}
          {' · warp '}
          {calibration.enabled ? 'ON' : 'off'}
          {' · '}
          {surfaces.length} face{surfaces.length === 1 ? '' : 's'}
        </span>
      </div>

      {/*
        Hoisted out of the left column, because a warning about the projector
        display is exactly what a builder in wall mode needs to see and the left
        column is the thing wall mode hides.
      */}
      {warning ? (
        <div
          style={{
            background: '#6b1b1b',
            padding: '8px 10px',
            borderRadius: 4,
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {warning}
        </div>
      ) : null}

      <LibraryDrawer
        open={libraryOpen}
        onClose={closeLibrary}
        scene={scene}
        setScene={setScene}
        libraryVersion={libraryVersion}
      />

      {wallMode ? (
        /*
          The stage and the column. The preview takes the width it is given
          (measured above); the column on the right is Layers — folders, rows,
          drag, an eye and a picker per row — or Room, the faces. The four
          steps fold under the stage, shut by default, one click away.
        */
        <div style={stageLayout}>
          <div ref={stageRef} style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, overflowY: 'auto', display: 'grid', gap: 10, alignContent: 'start' }}>
            {previewPanel}
            <details open={showSteps} onToggle={(e) => setShowSteps(e.currentTarget.open)} style={stepsCard}>
              <summary style={summaryStyle}>How to mark a face — four steps</summary>
              <ol style={stepsStyle}>
                <li>
                  Pick <strong>Rect</strong>, <strong>Triangle</strong> or <strong>Ellipse</strong>{' '}
                  under the preview, then <strong>press and drag</strong> on empty space to size a
                  face. Release and it is banked as <strong>face 1</strong>, role <code>panel</code>.{' '}
                  <strong>Pen</strong> instead clicks corner by corner — <kbd style={kbdStyle}>Enter</kbd>,
                  or click the first point, to close it.
                </li>
                <li>
                  On the projector every marked face shows a white guide grid (the grid is on from
                  launch; <kbd style={kbdStyle}>g</kbd> toggles it — <strong>off before a take</strong>).
                  Pick an animation for a layer under <strong>Layers</strong> and every face tagged{' '}
                  <code>panel</code> shows it, including ones you mark later.
                </li>
                <li>
                  Click a face to select it, then drag its points until the white sits on the real
                  box. <strong>Click one of its edges to add a point there</strong> when a quad will
                  not fit. <kbd style={kbdStyle}>Delete</kbd> over a point trims that corner; away from
                  a point it removes the face.
                </li>
                <li>
                  Give a face its own animation with <strong>own</strong> under <strong>Room</strong>;
                  fetch new loops with <strong>Library</strong> (top bar). <strong>Wall grid</strong>{' '}
                  helps you place things and <strong>must be off for a take</strong>.
                </li>
              </ol>
            </details>
          </div>
          {/*
            The column scrolls on its own, inside a page that never does —
            so the stage stays put and a long Properties panel cannot push
            the row buttons off the window (a page scrollbar took the width
            the column had been measured with).
          */}
          <div style={{ flex: '0 0 420px', width: 420, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 2 }}>
            <Panel title="Layers — top covers what is below">
              <LayerTree
                scene={scene}
                setScene={setScene}
                registry={registry}
                surfaces={surfaces}
                onSurfaces={applySurfaces}
                failures={failures}
                selectedLayerId={selectedLayerId(panelUi, scene)}
                selectedGroupId={selectedGroupId}
                onSelectLayer={(id) => {
                  setSelectedGroupId(null);
                  setPanelUi({ ...panelUi, selectedLayerId: id });
                }}
                onSelectGroup={setSelectedGroupId}
                libraryVersion={libraryVersion}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={undoRoom}
                  disabled={roomHistoryDepth[0] === 0}
                  style={{ ...buttonStyle, marginTop: 0 }}
                  title="Undo the last change to a face — a drag, a delete, a trace. ⌘Z"
                >
                  ↶ Undo{roomHistoryDepth[0] > 0 ? ` (${roomHistoryDepth[0]})` : ''}
                </button>
                <button
                  type="button"
                  onClick={redoRoom}
                  disabled={roomHistoryDepth[1] === 0}
                  style={{ ...buttonStyle, marginTop: 0 }}
                  title="Redo. ⇧⌘Z"
                >
                  ↷ Redo{roomHistoryDepth[1] > 0 ? ` (${roomHistoryDepth[1]})` : ''}
                </button>
              </div>
            </Panel>
            {selectedGroupId === null && selectedLayerId(panelUi, scene) !== null && (
              <Panel title="Properties — the selected layer">
                <EntityPanel
                  scene={scene}
                  setScene={setScene}
                  registry={registry}
                  layerId={selectedLayerId(panelUi, scene)}
                  ui={panelUi}
                  setUi={setPanelUi}
                  libraryVersion={libraryVersion}
                />
              </Panel>
            )}
            {selectedGroupId !== null && scene.groups.some((g) => g.id === selectedGroupId) && (
              <Panel title="Properties — the selected folder">
                <ParamControl registry={registry} paramKey={`group.${selectedGroupId}.mode`} />
                <p style={{ margin: '6px 0 0', fontSize: 11, color: '#6f767d' }}>
                  Together: every layer inside runs at once. In turn: one after another, each for
                  its seconds (set on the row), looping. The ▦ on the folder row picks one
                  animation for every layer inside.
                </p>
              </Panel>
            )}
            <details style={foldStyle} open={!calibration.enabled}>
              <summary style={summaryStyle}>
                Warp — square the frame to the wall{calibration.enabled ? ' (on)' : ' (off)'}
              </summary>
              <div style={{ paddingTop: 8 }}>{warpBody}</div>
            </details>
            <details style={foldStyle}>
              <summary style={summaryStyle}>Transport — pause, scrub, rate</summary>
              <div style={{ paddingTop: 8 }}>
                <TransportPanel transport={clockTransport} clock={previewClock} />
              </div>
            </details>
            <details style={foldStyle}>
              <summary style={summaryStyle}>Advanced — roles and shared fills</summary>
              <div style={{ paddingTop: 8, display: 'grid', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 11, color: '#6f767d' }}>
                  Underneath, a face carries a role and a layer fills a role. Every traced face
                  is on its own role, which is what makes it a layer above. Type <code>panel</code>
                  on several faces and one fill for <code>panel</code> lights them all — the old
                  way, still here.
                </p>
                {roomPanel}
                {fillPanel}
              </div>
            </details>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div style={{ width: 380, flex: '0 0 380px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <header>
              <h1 style={{ font: '600 15px/1.3 inherit', margin: '0 0 4px' }}>Projection Engine</h1>
              <p style={{ margin: 0, color: '#8b939b' }}>
                Sprint build · output {DEV_RESOLUTION.width}×{DEV_RESOLUTION.height}
              </p>
            </header>

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
                          {d.size.width}×{d.size.height} @ {d.displayFrequency}Hz · scale {d.scaleFactor}
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

            <Panel title="Output metrics — SPEC.md §4 (always-on mirror)">
              {metrics ? (
                <>
                  <pre style={preStyle}>{formatReport(metrics, uncapped)}</pre>
                  <p style={{ margin: 0, fontSize: 12, color: '#8b939b' }}>
                    Gate needs <strong>both</strong>: M1 {passesPresentation(metrics) ? '✓' : '✗'} · M2{' '}
                    {passesHeadroom(metrics) ? '✓' : '✗'} (p99 ≤ {(MAX_RENDER_FRACTION * 100).toFixed(0)}% of
                    N, A10)
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, color: '#8b939b' }}>Waiting for the output window…</p>
              )}
            </Panel>

            <details style={foldStyle}>
              <summary style={summaryStyle}>Measurement &amp; debug</summary>
              <div style={{ display: 'grid', gap: 14, paddingTop: 10 }}>
                <div>
                  <div style={subheadStyle}>{PARAM_TEST_PATTERN_SPEED} — the clock rate, Phase 0's knob</div>
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
                </div>

                <div>
                  <div style={subheadStyle}>Editor → output latency (A11: two figures, never conflated)</div>
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
                    <p style={{ margin: 0, color: '#8b939b' }}>Move the slider above to sample.</p>
                  )}
                  <p style={{ margin: '6px 0 0', color: '#6f767d', fontSize: 12 }}>
                    <strong>Transport</strong> is editor event → output receipt, no frame wait.{' '}
                    <strong>Presented</strong> is acked from the frame after the one that rendered, so
                    it is conservative by one frame by construction. Neither includes projector panel
                    latency.
                  </p>
                </div>

                <div>
                  <div style={subheadStyle}>Measurement mode (ADD-2)</div>
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
                </div>
              </div>
            </details>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {previewPanel}
            {roomPanel}
            {fillPanel}
            {groupsPanel}

            <Panel title="Transport — I-2, one clock for everything">
              <TransportPanel transport={clockTransport} clock={previewClock} />
            </Panel>

            <Panel title="Warp — I-5 final stage, calibration/ not scenes">{warpBody}</Panel>

            <Panel title="Forces & parallax — I-4, I-8, I-14, D3">
              <ForcePanel scene={scene} registry={registry} />
            </Panel>

            <Panel title="Layers — z-order, opacity, blend, depth (I-1, I-6, I-8)">
              <LayerPanel
                scene={scene}
                setScene={setScene}
                registry={registry}
                failures={failures}
                selectedId={selectedLayerId(panelUi, scene)}
                onSelect={(id) => setPanelUi({ ...panelUi, selectedLayerId: id })}
              />
            </Panel>

            <Panel title="Entity — content, parameters, motion (I-8, I-18)">
              <EntityPanel
                scene={scene}
                setScene={setScene}
                registry={registry}
                layerId={selectedLayerId(panelUi, scene)}
                ui={panelUi}
                setUi={setPanelUi}
                libraryVersion={libraryVersion}
              />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

/** I-9: the single viewport v1 drives. Calibration is keyed by it. */
const CALIBRATION_VIEWPORT = 'main';

/**
 * The role the one-click white fill binds to — the same default a newly marked
 * face gets, which is the entire trick. Mark a face and it lights, with no
 * second step and nothing to type. SPRINT.md calls that beat 7 and it is the
 * reel's opening shot.
 *
 * A literal here rather than `DEFAULT_SURFACE_ROLE` imported from the surface
 * tree, and that is I-15 rather than sloppiness: content binds to a role by
 * NAME, and a scene that imported the room's constant would be a scene that
 * cannot be loaded in a room it has never seen. The two halves agree on a
 * string, which is the only thing they are allowed to agree on.
 */
const WHITE_FILL_ROLE = 'panel';

/**
 * The preview at twice its normal edge in wall mode. Exactly 16:9 and integral,
 * so it is the same geometry at a bigger backing store rather than a stretch —
 * `Compositor.resize` rebuilds every mask from its normalized path (I-1), so a
 * face marked at one size is the same face at the other.
 *
 * 864×486: 1.8× the full-mode preview's edge, so a corner is over three times
 * easier to hit than at 480 wide — and the room fits BESIDE it in the 1440-wide
 * default window (888 + 12 + 520 + 20 = 1440, the warp's 480-wide corner box included), which is the point of the
 * two-column wall layout: preview → faces → fill without scrolling. On a
 * narrower window the room wraps underneath, as it did before.
 */
const WALL_PREVIEW_SIZE = { width: 864, height: 486 } as const;

const stageLayout: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'stretch',
  flex: '1 1 0',
  minHeight: 0,
};

const segmentStyle: React.CSSProperties = {
  display: 'inline-flex',
  border: '1px solid #2b2f34',
  borderRadius: 5,
  overflow: 'hidden',
};

const segmentButton: React.CSSProperties = {
  padding: '6px 12px',
  border: 'none',
  background: '#191c1f',
  color: '#a9b1b8',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
};

const segmentOn: React.CSSProperties = {
  background: '#16323a',
  color: '#e6ebf0',
  boxShadow: 'inset 0 -2px 0 #40e0ff',
};

const foldStyle: React.CSSProperties = {
  border: '1px solid #2b2f34',
  borderRadius: 6,
  padding: '8px 12px',
  background: '#15181b',
  flexShrink: 0,
};

const stepsCard: React.CSSProperties = {
  border: '1px solid #2b2f34',
  borderRadius: 6,
  padding: '8px 12px',
  background: '#15181b',
};

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  font: '600 11px/1.4 ui-monospace, Menlo, monospace',
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  color: '#8b939b',
  userSelect: 'none',
};

const subheadStyle: React.CSSProperties = {
  font: '600 11px/1.4 ui-monospace, Menlo, monospace',
  color: '#8b939b',
  marginBottom: 6,
};

const wallBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 12,
  flexWrap: 'wrap',
};

/** The four steps of the loop, numbered. The answer to "I don't understand". */
const stepsStyle: React.CSSProperties = {
  margin: 0,
  padding: '10px 10px 10px 30px',
  border: '1px solid #2b2f34',
  borderRadius: 6,
  background: '#15181b',
  color: '#c7ced4',
  fontSize: 13,
  lineHeight: 1.7,
  maxWidth: 900,
};

const kbdStyle: React.CSSProperties = {
  padding: '1px 5px',
  borderRadius: 3,
  border: '1px solid #3a4046',
  background: '#22262a',
  font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
};

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
        // A grid or flex item is as wide as its widest child unless told
        // otherwise; a thumbnail strip must scroll inside, not widen the column.
        minWidth: 0,
        overflow: 'hidden',
        // In the scrolling column a panel keeps its height; the column
        // scrolls rather than the panels squashing to fit.
        flexShrink: 0,
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
