/**
 * Hosts a PixiJS canvas that React mounts once and never renders into
 * (SPEC.md §5: "the canvas stays PixiJS and is never React-managed").
 *
 * I-7: this is an approximation of the output at reduced resolution, not a
 * mirror. It runs its own render loop from the same scene model.
 *
 * P5-B adds pointer interaction on top of it, and the *shape* of that addition
 * is what keeps two invariants true by construction rather than by care:
 *
 *  - **The selection overlay is an SVG sibling of the canvas, not a Pixi
 *    layer.** The output window (`src/output/main.ts`) and the golden harness
 *    (`src/golden/main.ts`) both build a `Compositor` directly and neither
 *    loads this file, so the outline cannot reach the projector or a blessed
 *    frame — there is no code path along which it could, which is a stronger
 *    statement than a flag that says it should not. That also means no golden
 *    is re-blessed for this block.
 *  - **Selection is `useState` here.** It is not a field on `Scene`, so it has
 *    nowhere to be serialized to, nothing to send it over IPC and no way to
 *    round-trip. The overlay reads it back through `scene.layers`, so a layer
 *    deleted from the layer list leaves a selection that simply draws nothing.
 *
 * D11: this is scene space, pre-warp. Placement here is placement in the same
 * coordinates the output composites in, and the forward warp carries a scene
 * point to its physical spot — which is why the preview host is built without a
 * warp stage and why an operator can trust a region's normalized position to
 * mean the same thing on the wall.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRenderHost, type RenderHost } from '../render/host';
import { shortcutFor } from './outputKeys';
import { downloadedEntries, onLibraryChange } from './assets';
import type { Clock, ClockTransport } from '../core/clock';
import type { Scene } from '../core/scene';
import { addLayer, removeLayer, setLayerRect, type NormalizedRect } from '../core/sceneEdit';
import {
  PROCEDURAL_KINDS,
  PROCEDURAL_PROVIDER_ID,
  type ProceduralKind,
} from '../providers/procedural/ProceduralProvider';
import {
  CLOSE_MIN_POINTS,
  commitActivePath,
  deleteFromPathSession,
  discardActivePath,
  emptyPathSession,
  pathSessionDown,
  pathSessionMove,
  pathSessionUp,
  bankedHitAt,
  nextPathId,
  previewPoints,
  removePath,
  wouldClose,
  type PathSession,
  type PathToolState,
} from './pathTool';
import type { Path } from '../core/paths';
import { reconcileSurfaces, type SurfaceTree } from '../core/surfaces';
import {
  SURFACE_MODES,
  SURFACE_MODE_LABELS,
  draftBounds,
  generateShape,
  isDraftPlaceable,
  isGeneratedMode,
  type ShapeDraft,
  type SurfaceMode,
} from './shapeTool';
import {
  HANDLES,
  aspectOf,
  beginGesture,
  gestureRect,
  handlePoint,
  isPlaceable,
  toNormalizedPoint,
  type Gesture,
  type NormalizedPoint,
} from './interaction';
import type { BlendMode } from '../core/layer';
import { gridLines, type GridWeight } from './grid';

export const PREVIEW_SIZE = { width: 480, height: 270 } as const;

/**
 * The room a preview mounted without one has: none. A stable reference, so the
 * default does not look like a new room on every render and re-push an empty
 * tree to the host each pass.
 */
const EMPTY_ROOM: SurfaceTree = [];

/** A `PathSession` minus the banked paths — see `RegionSurface`. */
type DrawingState = Omit<PathSession, 'paths'>;

/**
 * Split a session's editor half off from the room half.
 *
 * A rest destructure rather than four named fields, so a field added to
 * `PathSession` later travels with the drawing state automatically instead of
 * being silently dropped by a copy that was written out by hand. `grabPoint`
 * arrived exactly that way in this block.
 */
function drawingOf(session: PathSession): DrawingState {
  const { paths, ...rest } = session;
  void paths;
  return rest;
}

interface Props {
  speed: number;
  nominalMs: number;
  scene: Scene;
  /** I-2: operator intent, applied to this host's clock. */
  clockState: ClockTransport;
  /**
   * Handed back once the host exists, so the transport can read a clock that is
   * actually running rather than the intent it just sent. Null on teardown.
   */
  onClockReady?: (clock: Clock | null) => void;
  /**
   * P5-B. Structural edits from the pointer, in the same shape `LayerPanel`
   * takes — every one of them a pure function from `core/sceneEdit.ts`, and
   * every resulting scene sent to the output as JSON on the existing
   * `scene:set` channel by `App`'s effect. No new channel; no pixels (I-7).
   */
  setScene?: (update: (prev: Scene) => Scene) => void;
  /**
   * I-15, B3. The room — every marked face, held by `App` and written to
   * `calibration/surfaces.json` on every change.
   *
   * A PROP, not state here, and that is the block's central decision. The path
   * tool used to bank its paths into its own `useState` and P5-D's comment said
   * so: "paths belong to the surface tree, which is calibration and is Phase 6".
   * That is now. The banked list IS the room, so it is held once, in the place
   * that can persist it and send it to the wall, and this component draws it and
   * edits it rather than owning a second copy.
   */
  surfaces?: SurfaceTree;
  /**
   * The room after an edit. Called on **every** change — bank, point drag,
   * point delete, whole-face move, delete — because the builder is at the wall
   * and there is no save button to find in the dark (SPRINT.md §3 R1).
   *
   * Called with the whole tree rather than a patch, for the reason the scene
   * crosses whole: a partial update makes the wall's room depend on having
   * received every previous one in order.
   */
  onSurfaces?: (tree: SurfaceTree) => void;
  /**
   * How big to draw the preview, in CSS pixels. Defaults to `PREVIEW_SIZE`.
   *
   * The BACKING STORE is resized to match, never stretched: `host.resize` goes
   * through `Compositor.resize`, which rebuilds every mask from its normalized
   * path (I-1) rather than scaling the pixels it had. A stretched canvas would
   * put a marked face half a box out at the new size, which is the one thing on
   * this path I-1 exists to prevent.
   */
  size?: { width: number; height: number };
  /**
   * B3, after the first attempt to use this at a wall. Wall mode: the pointer
   * marks faces and does nothing else.
   *
   * The tool is FORCED to `path` and its dropdown is gone. That dropdown was the
   * whole failure — a builder who did not find it clicked on the preview and got
   * coloured rectangles instead of a marked face, which reads as "it doesn't
   * work" and is indistinguishable from a broken engine at three metres in a
   * dark room.
   */
  wallMode?: boolean;
}

export function PreviewCanvas({
  speed,
  nominalMs,
  scene,
  clockState,
  onClockReady,
  setScene,
  surfaces = EMPTY_ROOM,
  onSurfaces,
  size = PREVIEW_SIZE,
  wallMode = false,
}: Props): React.JSX.Element {
  const mount = useRef<HTMLDivElement | null>(null);
  const host = useRef<RenderHost | null>(null);
  // The mount effect runs once and must not capture a stale scene.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const clockStateRef = useRef(clockState);
  clockStateRef.current = clockState;
  const onClockReadyRef = useRef(onClockReady);
  onClockReadyRef.current = onClockReady;
  // Same reason as `sceneRef`: the mount effect runs once, and a room that was
  // already loaded from disk before the host finished initialising must not be
  // the one thing the preview never hears about.
  const surfacesRef = useRef(surfaces);
  surfacesRef.current = surfaces;
  // The mount effect runs once and must start at whatever size was asked for,
  // not at the default — opening straight into wall mode would otherwise leave a
  // 480-wide backing store under a much wider canvas until something else moved.
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    let disposed = false;
    let created: RenderHost | null = null;
    const el = mount.current;
    if (!el) return;

    void createRenderHost({
      parent: el,
      width: sizeRef.current.width,
      height: sizeRef.current.height,
      nominalMs: nominalMs || 16.67,
      // §5 / A2, stated by omission elsewhere and explicitly here: the preview
      // does NOT decode video. It shows the poster plus a badge. This is not a
      // fidelity setting — a second decoder spends a 16 GB pool shared between
      // CPU and GPU twice, for a preview nobody projects.
      decodeVideo: false,
      // §5: "Lottie *does* run in the preview, at reduced size, capped." The
      // preview is 480x270, so a 512 px canvas would be rendering more Lottie
      // pixels than it can show.
      lottieResolution: 192,
    }).then((h) => {
      created = h;
      if (disposed) {
        h.destroy();
        return;
      }
      host.current = h;
      // W1 fix. The preview's host has its own asset library, and nothing
      // told it about the DOWNLOADED clips — so a library video showed the
      // I-13 placeholder here ("no bundled asset") while it played on the
      // projector. The output registers them at start and on `library:added`
      // (`output/main.ts`); the preview now does the same with the entries the
      // editor's library accepted, before the first scene is applied.
      h.registerAssets(downloadedEntries());
      h.setSpeed(speed);
      h.setScene(sceneRef.current);
      h.setSurfaces(surfacesRef.current);
      h.setClock(clockStateRef.current);
      onClockReadyRef.current?.(h.clock);
    });

    return () => {
      disposed = true;
      onClockReadyRef.current?.(null);
      created?.destroy();
      if (host.current === created) host.current = null;
    };
    // Mounted once, deliberately. Updates arrive through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    host.current?.setSpeed(speed);
  }, [speed]);

  // W1 fix, the other half: a clip downloaded while the editor is open. Same
  // rule as the output — register, and re-apply the scene only if something
  // was actually new, so a placeholder standing in for it becomes the poster.
  useEffect(
    () =>
      onLibraryChange(() => {
        const h = host.current;
        if (!h) return;
        if (h.registerAssets(downloadedEntries()).length > 0) h.reapplyScene();
      }),
    [],
  );

  useEffect(() => {
    if (nominalMs > 0) host.current?.setNominalMs(nominalMs);
  }, [nominalMs]);

  useEffect(() => {
    host.current?.setScene(scene);
  }, [scene]);

  /**
   * I-15. The preview shows the fills too.
   *
   * Not decoration: the builder marks a face here and has to see it light HERE,
   * because the projector is behind them and a preview that showed the marks
   * but not what lands on them would make every drag a guess checked over one
   * shoulder. It is the same `Compositor.setSurfaces` the output window runs,
   * at preview resolution, from the same tree — I-7's "approximation, not a
   * mirror", applied to the room exactly as it already is to the scene.
   */
  useEffect(() => {
    host.current?.setSurfaces(surfaces);
  }, [surfaces]);

  /**
   * Resize the backing store, not the CSS box alone.
   *
   * `Compositor.resize` re-derives every layer's pixel box and rebuilds every
   * fill mask from its normalized path, so a face marked at 480x270 is the same
   * face at 960x540 (I-1). `RenderHost.resize` returns early when the size has
   * not changed, so this is safe to run on every render.
   */
  useEffect(() => {
    host.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  // I-2. The preview's clock is a real clock; this applies the operator's
  // intent to it, which is what makes a pause visible in the editor without a
  // round trip to the output window.
  useEffect(() => {
    host.current?.setClock(clockState);
  }, [clockState]);

  return (
    <RegionSurface
      scene={scene}
      setScene={setScene}
      surfaces={surfaces}
      size={size}
      wallMode={wallMode}
      {...(onSurfaces ? { onSurfaces } : {})}
    >
      <div
        ref={mount}
        style={{
          width: size.width,
          height: size.height,
          background: '#000',
          border: '1px solid #2b2f34',
          borderRadius: 4,
        }}
      />
    </RegionSurface>
  );
}

/**
 * The pointer layer. Separated from the host above because the host must mount
 * exactly once and this re-renders on every pointer move — merging them would
 * put a render loop's worth of React work in the same component as a `useEffect`
 * whose entire contract is that it never runs twice.
 *
 * P5-D adds the path tool alongside the region gestures. It is a second *tool*,
 * not a second mode inside one: D19's "no mode switch" is about click-versus-
 * drag within the path tool, and that decision lives in `pathTool.ts` where it
 * has a test. Which tool the pointer feeds is the operator's choice, the way
 * the `draw` kind already is.
 *
 * The path the tool produces stays here, in `useState`, and is not written into
 * the scene — there is nowhere for it to go. Paths belong to the surface tree,
 * which is calibration and is Phase 6 (I-15). The overlay draws it for the same
 * reason it draws the selection outline: an SVG sibling of the canvas cannot
 * reach the projector or a golden frame, because neither loads this file.
 */
function RegionSurface({
  scene,
  setScene,
  surfaces,
  onSurfaces,
  size,
  wallMode,
  children,
}: {
  scene: Scene;
  setScene: ((update: (prev: Scene) => Scene) => void) | undefined;
  surfaces: SurfaceTree;
  onSurfaces?: (tree: SurfaceTree) => void;
  size: { width: number; height: number };
  wallMode: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const surface = useRef<HTMLDivElement | null>(null);
  /** Editor UI state. Never scene state — see this file's header. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [draft, setDraft] = useState<NormalizedRect | null>(null);
  const [placeKind, setPlaceKind] = useState<ProceduralKind>('rect');
  /** P5-D. The paths drawn so far plus the one being drawn, and the pointer. */
  const [tool, setTool] = useState<'region' | 'path'>('region');
  /**
   * Wall mode marks faces and nothing else, so the tool is not a choice there.
   *
   * Resolved on every render rather than pushed into `setTool` by an effect: a
   * mode flag that has to be copied into a second piece of state is a second
   * source of truth, and it would flicker one render's worth of region gestures
   * on the way in — which at a wall is a coloured rectangle appearing on the
   * projection for a frame.
   */
  const activeTool: 'region' | 'path' = wallMode ? 'path' : tool;
  /**
   * D11. On by default: the mental model is meant to be right from the start,
   * not corrected after the first placement lands somewhere surprising. It is
   * `useState` here for the same reason selection is — there is no field on
   * `Scene` for it, so it cannot be serialized, cannot cross IPC and cannot
   * reach the output.
   */
  const [showGrid, setShowGrid] = useState(true);
  /**
   * The half of a `PathSession` that is genuinely the editor's: the path being
   * drawn, which face is selected, and the gesture in flight.
   *
   * The other half — the banked paths — is the ROOM, and it lives in `App` and
   * on disk. Splitting the session this way rather than mirroring the tree into
   * a second `useState` is the whole point: there is one list of marked faces,
   * so there is no copy to fall out of step with the file, and every function in
   * `pathTool.ts` still sees the `PathSession` it was written against.
   */
  const [drawing, setDrawing] = useState<DrawingState>(() => drawingOf(emptyPathSession()));
  /**
   * How the NEXT face gets drawn. Editor state, and it is not stored anywhere:
   * once `generateShape` has run its output is a plain `Path`, and no surface
   * remembers which mode made it (see `shapeTool.ts`).
   */
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('rect');
  /** A face being dragged out. Null except between press and release. */
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  const [hover, setHover] = useState<NormalizedPoint | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  const aspect = aspectOf(size.width, size.height);

  /**
   * The session the path tool operates on, assembled from the room and the
   * drawing state. Rebuilt per render rather than stored, because a stored copy
   * is the second source of truth this split exists to remove.
   */
  const session: PathSession = useMemo(
    () => ({ ...drawing, paths: surfaces.map((s) => s.path) }),
    [drawing, surfaces],
  );

  /**
   * **The one place a path-tool result becomes a room.** Every gesture — down,
   * move, up, Enter, Delete, the buttons — ends here.
   *
   * `reconcileSurfaces` does the matching (see its header): a path the room has
   * not seen is a bank, a path that moved is an edit that keeps its role and
   * name, a path that vanished is a delete. So SPRINT.md §3 R1's "written on
   * every change" is true because there is one funnel, not because six handlers
   * each remember to call a writer.
   *
   * Computed against THIS render's `surfaces`, and the write is issued outside
   * any state updater — `addLayer`'s ruling three functions down, for its
   * reason: an updater runs twice under StrictMode, and a side effect that
   * crosses a process boundary must not.
   *
   * The identity check is not an optimisation. Holding the pointer still
   * mid-drag produces the same room every frame, and without it that would be
   * an IPC message and a `surfaces.json` write per frame for a hand that is not
   * moving.
   */
  const applySession = (next: PathSession): void => {
    setDrawing(drawingOf(next));
    const tree = reconcileSurfaces(surfaces, next.paths);
    if (tree !== surfaces) onSurfaces?.(tree);
  };

  /**
   * The one place a pointer event becomes normalized. Reads the element's live
   * CSS box rather than `PREVIEW_SIZE`, so a preview that is ever laid out at a
   * different size stays correct — the box is measured, the geometry is not.
   */
  const pointOf = useCallback((e: React.PointerEvent): NormalizedPoint | null => {
    const el = surface.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return toNormalizedPoint(e.clientX - box.left, e.clientY - box.top, box.width, box.height);
  }, []);

  const selected = selectedId === null ? undefined : scene.layers.find((l) => l.id === selectedId);
  /**
   * The marked face under selection, resolved against the room on every render
   * rather than stored resolved — `App`'s ruling for the panel's layer
   * selection, for the same reason: a face deleted from the surface list leaves
   * a selection that names nothing, and resolving it here means that reads as
   * "no face" instead of as a stale name on a button.
   */
  const selectedFace = surfaces.find((sf) => sf.path.id === session.selectedId);

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!setScene) return;
    const p = pointOf(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Focus, so the Delete key below reaches this element rather than the page.
    surface.current?.focus();
    if (activeTool === 'path') {
      setShiftHeld(e.shiftKey);
      /**
       * The ordering IS the decision again, one level up from `pathSessionDown`.
       *
       * In a generated mode, a press on something already banked EDITS it —
       * select it, grab a point, insert an anchor — and a press on empty space
       * drags out a new face. That is what makes the shape modes usable as a
       * default rather than as a mode you have to leave to fix anything: the
       * builder never switches back to `Pen` to nudge a corner.
       *
       * `bankedHitAt` is the same hit test `pathSessionDown` runs, asked here
       * rather than repeated — so "is the pointer over a face" cannot get two
       * different answers on one press.
       */
      if (isGeneratedMode(surfaceMode) && session.active.points.length === 0) {
        if (bankedHitAt(session, p, aspect) === null) {
          setShapeDraft({ mode: surfaceMode, origin: p, current: p });
          return;
        }
      }
      applySession(pathSessionDown(session, p, aspect, e.shiftKey));
      return;
    }
    const start = beginGesture(scene, selectedId, p, aspect);
    setSelectedId(start.selectedId);
    setGesture(start.gesture);
    setDraft(gestureRect(scene, start.gesture, p, aspect));
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const p = pointOf(e);
    if (activeTool === 'path') {
      setShiftHeld(e.shiftKey);
      setHover(p);
      if (shapeDraft) {
        // The room is NOT written while a shape is being dragged out — there is
        // no face yet, only a rubber band. One write, on release, when the
        // generator has actually produced something.
        if (p) setShapeDraft({ ...shapeDraft, current: p });
        return;
      }
      // **The room is written on every pointer sample**, which is the opposite
      // of the region gesture below and is deliberate (SPRINT.md §3 R1): a
      // builder dragging a face's corner needs the wall to answer while their
      // finger is down. It is affordable because `Compositor.setSurfaces`
      // reshapes the masks it has instead of rebuilding the layer stack — see
      // its header, which is where the reasoning for both halves lives.
      if (p) applySession(pathSessionMove(session, p, aspect, e.shiftKey));
      return;
    }
    if (!gesture || !p) return;
    setDraft(gestureRect(scene, gesture, p, aspect));
  };

  /**
   * **The scene is mutated once, on release** — not on every move.
   *
   * Deliberate, and the reason is structural rather than a matter of taste.
   * `Compositor.setScene` tears the whole layer stack down and rebuilds it,
   * because scene edits were designed as operator-paced; and `App`'s effect
   * sends the whole scene over IPC on every change. Mutating per pointer-move
   * would put both of those on a 60 Hz path: every provider view destroyed and
   * recreated, every texture rebuilt, and a scene JSON crossing the boundary
   * per frame — visible as flicker, and as texture churn in exactly the counter
   * the rolling flatness check watches. The live outline gives the operator the
   * feedback; the commit gives the engine one edit.
   *
   * A drag whose content follows the pointer live wants a diffing compositor,
   * which is a different block than this one and is not on the ship list.
   */
  const onPointerUp = (e: React.PointerEvent): void => {
    if (activeTool === 'path') {
      const p = pointOf(e);
      if (shapeDraft) {
        /**
         * **The generator runs here, once, and then it is out of the picture.**
         *
         * What comes back is a plain I-17 `Path` that goes through the SAME
         * funnel a pen-drawn one does — `applySession` hands it to
         * `reconcileSurfaces`, which banks it as a face with the default role
         * and name. Nothing downstream can tell it was a rectangle, because
         * nothing records that it was.
         */
        const settled = p ? { ...shapeDraft, current: p } : shapeDraft;
        setShapeDraft(null);
        const path = generateShape(settled.mode, settled, nextPathId(session.paths));
        // A drag too small to have been meant produces nothing. Refused rather
        // than clamped up to a minimum: silently inventing a face the builder
        // did not draw is a face they then have to find and delete.
        if (path) applySession({ ...session, paths: [...session.paths, path] });
        return;
      }
      // Simplification happens inside this call, once, on release (D19).
      applySession(pathSessionUp(session, p, aspect, e.shiftKey));
      return;
    }
    const g = gesture;
    setGesture(null);
    setDraft(null);
    if (!g || !setScene) return;
    const p = pointOf(e);
    const rect = p ? gestureRect(scene, g, p, aspect) : null;
    if (!rect) return;

    if (g.kind === 'place') {
      if (!isPlaceable(rect)) return; // A click on empty space. Deselect only.
      // Computed outside the updater rather than inside it, because the new
      // layer's id has to be READ — `addLayer` picks the first free suffix —
      // and setting selection from inside a state updater would run twice under
      // StrictMode's double invocation. The base is this render's scene, which
      // is the same scene every other gesture computation above reads.
      const next = addLayer(scene, {
        idPrefix: placeKind,
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: placeKind },
        rect,
        ...(placeKind === 'glow' ? { blendMode: 'add' as BlendMode } : {}),
      });
      const added = next.layers.find((l) => !scene.layers.some((q) => q.id === l.id));
      setScene(() => next);
      if (added) setSelectedId(added.id);
      return;
    }
    setScene((prev) => setLayerRect(prev, g.layerId, rect));
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Enter finishes the path where it stands AND starts the next one. It is
    // the only way to end an OPEN path — closing is for loops, and a route or a
    // run along one edge of a box is neither — and one gesture rather than two,
    // because an operator who has just marked one face of a box is about to
    // mark the next.
    if (activeTool === 'path' && e.key === 'Enter') {
      e.preventDefault();
      // Enter banks the active path, which `applySession` turns into a marked
      // face. Closing a path banks it too — that decision is in
      // `pathSessionDown` so both gestures reach the same `commitActivePath`.
      applySession(commitActivePath(session, aspect));
      return;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (activeTool === 'path') {
      e.preventDefault();
      // The point under the pointer, or the last one placed when the pointer is
      // nowhere near a point — which is what "undo that click" means here. On a
      // banked face the same rule trims a corner, and only a press away from
      // every point deletes the face (see `deleteFromPathSession`).
      applySession(deleteFromPathSession(session, hover, aspect));
      return;
    }
    if (selectedId === null || !setScene) return;
    e.preventDefault();
    const id = selectedId;
    setSelectedId(null);
    // Texture disposal rides on this: the scene that comes back reaches the
    // host through `setScene`, and `Compositor.setScene` tears every view down
    // before rebuilding. See `removeLayer`'s comment — there is no second
    // removal path to keep in step.
    setScene((prev) => removeLayer(prev, id));
  };

  /**
   * What the overlay draws: the committed transform, or the gesture's live rect
   * when one is in flight. `gestureRect` is the same function the commit uses,
   * so the outline is not an approximation of where the region will land.
   */
  const outline = useMemo((): NormalizedRect | null => {
    if (draft && gesture) return draft;
    if (!selected) return null;
    const t = selected.transform;
    return { x: t.x, y: t.y, width: t.width, height: t.height };
  }, [draft, gesture, selected]);

  const px = (v: number): number => v * size.width;
  const py = (v: number): number => v * size.height;
  const rotationDeg = selected && !draft ? selected.transform.rotation * 360 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        ref={surface}
        tabIndex={0}
        role="application"
        aria-label="Preview — click to select a region, drag to move, drag a corner to scale"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{
          position: 'relative',
          width: size.width,
          height: size.height,
          cursor: setScene ? 'crosshair' : 'default',
          touchAction: 'none',
          outline: 'none',
        }}
      >
        {children}
        <svg
          width={size.width}
          height={size.height}
          // The canvas underneath owns every pointer event; this is decoration.
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
          aria-hidden
        >
          {/* First child, so everything else draws over it. */}
          {showGrid && <SceneGrid px={px} py={py} />}
          {activeTool === 'region' && outline && (
            <g
              transform={
                rotationDeg === 0
                  ? undefined
                  : `rotate(${rotationDeg} ${px(outline.x)} ${py(outline.y)})`
              }
            >
              <rect
                x={px(outline.x - outline.width / 2)}
                y={py(outline.y - outline.height / 2)}
                width={px(outline.width)}
                height={py(outline.height)}
                fill="none"
                stroke="#40e0ff"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            </g>
          )}
          {activeTool === 'path' && (
            <>
              {session.paths.map((q) => (
                <BankedPath
                  key={q.id}
                  path={q}
                  selected={q.id === session.selectedId}
                  px={px}
                  py={py}
                />
              ))}
              <PathOverlay
                state={session.active}
                hover={hover}
                aspect={aspect}
                shift={shiftHeld}
                px={px}
                py={py}
              />
              {/*
                The shape being dragged out, drawn from `generateShape` — the
                SAME call the release will bank. The outline the builder watches
                is therefore the face they get, not a second drawing of the same
                idea; `previewPoints` makes the identical promise for the pen.
              */}
              <ShapeDraftOverlay draft={shapeDraft} px={px} py={py} />
            </>
          )}
          {/* Handles only on a settled selection: mid-gesture they would be
              drawn at the corners of a box that is still moving under them. */}
          {activeTool === 'region' && selected && !draft &&
            HANDLES.map((h) => {
              const c = handlePoint(selected.transform, h, aspect);
              return (
                <rect
                  key={h}
                  x={px(c.x) - 3.5}
                  y={py(c.y) - 3.5}
                  width={7}
                  height={7}
                  fill="#40e0ff"
                  stroke="#06202a"
                  strokeWidth={1}
                />
              );
            })}
        </svg>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#6f767d' }}>
        {/*
          Hidden in wall mode, and that is the fix rather than a tidy-up. A
          builder who did not find this dropdown clicked on the preview and got
          coloured rectangles instead of a marked face — which at a projector is
          indistinguishable from an engine that does not work.
        */}
        {!wallMode && (
          <>
            <label htmlFor="edit-tool" style={{ color: '#8b939b' }}>
              tool
            </label>
            <select
              id="edit-tool"
              value={tool}
              onChange={(e) => setTool(e.currentTarget.value as 'region' | 'path')}
              style={SELECT_STYLE}
            >
              <option value="region">region</option>
              <option value="path">path</option>
            </select>
          </>
        )}
        {/*
          W1 follow-up. Two grids, two controls, side by side — the builder
          toggled this checkbox and expected the projector's grid to go, and it
          did not, because this one is the PREVIEW's scene-space grid (D11) and
          the projector's guides are the output window's (`g`). They are
          different by design (hard rule 9: nothing drawn here reaches the
          wall), so they are not merged; they are labelled and put together.
        */}
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#8b939b' }}
          title="The grid in THIS preview only. It never reaches the projector."
        >
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.currentTarget.checked)}
          />
          preview grid
        </label>
        <button
          type="button"
          onClick={() => window.engine.sendOutputKey({ key: shortcutFor('wallGrid').key })}
          style={PROJECTOR_GRID_STYLE}
          title="The white grid and face guides ON THE PROJECTOR. Toggle — press again to clear. Same as g on the output. Off before a take."
        >
          projector grid ⇄
        </button>
        {!wallMode && (
          <>
            <label htmlFor="place-kind" style={{ color: '#8b939b' }}>
              draw
            </label>
            <select
              id="place-kind"
              value={placeKind}
              onChange={(e) => setPlaceKind(e.currentTarget.value as ProceduralKind)}
              disabled={activeTool === 'path'}
              style={SELECT_STYLE}
            >
              {PROCEDURAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </>
        )}
        {activeTool === 'path' ? (
          <>
            {/*
              New Surface. Buttons and not a dropdown, deliberately: the last
              control that mattered here WAS a dropdown, and it was missed
              entirely at a projector. Four things the builder can see and hit.

              These pick how the NEXT face is drawn and nothing else — there is
              no mode to leave. A press on an existing face always edits it,
              whichever button is lit (see `onPointerDown`), so `Pen` is for
              drawing an outline point by point rather than for repairing one.
            */}
            <span style={{ color: '#8b939b' }}>new</span>
            {SURFACE_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSurfaceMode(m)}
                title={
                  m === 'pen'
                    ? 'Click each corner; Enter banks it, or click the first point to close and bank it'
                    : `Press and drag to size a ${SURFACE_MODE_LABELS[m].toLowerCase()}, release to bank it`
                }
                style={{
                  ...SELECT_STYLE,
                  borderColor: surfaceMode === m ? '#40e0ff' : '#2b2f34',
                  background: surfaceMode === m ? '#16323a' : '#15181b',
                  color: surfaceMode === m ? '#e6f9ff' : 'inherit',
                }}
              >
                {SURFACE_MODE_LABELS[m]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => applySession(discardActivePath(session))}
              style={SELECT_STYLE}
            >
              discard
            </button>
            <button
              type="button"
              onClick={() =>
                applySession(
                  session.selectedId !== null
                    ? removePath(session, session.selectedId)
                    : session.paths.length === 0
                      ? session
                      : removePath(session, session.paths[session.paths.length - 1]!.id),
                )
              }
              disabled={session.paths.length === 0}
              style={SELECT_STYLE}
            >
              {session.selectedId === null
                ? 'undo last'
                : `delete ${selectedFace?.name ?? session.selectedId}`}
            </button>
            <span>
              {(surfaceMode === 'pen'
                ? 'Pen: click each corner, Enter banks it. '
                : `${SURFACE_MODE_LABELS[surfaceMode]}: press and drag on empty space to size one. `) +
                `${surfaces.length} face${surfaces.length === 1 ? '' : 's'} · ` +
                `${session.active.points.length} point${
                  session.active.points.length === 1 ? '' : 's'
                } in this one` +
                (session.active.lastSimplification
                  ? ` · last stroke ${session.active.lastSimplification.before} → ${session.active.lastSimplification.after}`
                  : '') +
                (session.selectedId !== null && session.active.points.length === 0
                  ? ` · ${selectedFace?.name ?? session.selectedId} (${selectedFace?.role ?? '?'}) — ` +
                    'drag a point to adjust, click an edge to add a point there, ' +
                    'drag the face to move it, Delete on a point trims it, ' +
                    'Delete elsewhere removes the face'
                  : ' — click a face to select and edit it') +
                (session.active.points.length >= 2
                  ? ', Enter finishes it and banks it as a face'
                  : '') +
                (session.active.points.length >= CLOSE_MIN_POINTS && !session.active.closed
                  ? ', first point closes AND banks it'
                  : '')}
            </span>
          </>
        ) : (
          <span>
            {selected
              ? `${selected.name} · ${selected.transform.x.toFixed(3)}, ${selected.transform.y.toFixed(3)} · ` +
                `${selected.transform.width.toFixed(3)}×${selected.transform.height.toFixed(3)} — Delete removes it`
              : 'drag empty space to place · click a region to select'}
          </span>
        )}
      </div>
    </div>
  );
}

const SELECT_STYLE: React.CSSProperties = {
  padding: '2px 5px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '11px/1.2 inherit',
};

/**
 * D11's scene-space grid, drawn under everything else.
 *
 * Structurally unreachable from the projector: this is an SVG sibling of the
 * preview canvas, in a file `src/output/main.ts` and `src/golden/main.ts` do not
 * import — the same shape that keeps the selection overlay off the wall, and
 * asserted by the import-graph test in `sceneEdit.test.ts`. There is no flag
 * anywhere saying the grid should not be composited, because there is no path
 * along which it could be.
 *
 * Every coordinate comes from `gridLines`, normalized; `px`/`py` are the only
 * multiplication by a pixel size in the whole overlay (I-1).
 */
function SceneGrid({
  px,
  py,
}: {
  px: (v: number) => number;
  py: (v: number) => number;
}): React.JSX.Element {
  return (
    <g>
      {/* The frame edge itself — the boundary the normalized coordinates mean.
          Inset by half a stroke so it is not clipped by the canvas edge. */}
      <rect
        x={0.5}
        y={0.5}
        width={px(1) - 1}
        height={py(1) - 1}
        fill="none"
        stroke={GRID_STROKE.major}
        strokeWidth={1}
      />
      {gridLines().map((l) =>
        l.axis === 'x' ? (
          <line
            key={`x${l.at}`}
            x1={px(l.at)}
            y1={0}
            x2={px(l.at)}
            y2={py(1)}
            stroke={GRID_STROKE[l.weight]}
            strokeWidth={1}
          />
        ) : (
          <line
            key={`y${l.at}`}
            x1={0}
            y1={py(l.at)}
            x2={px(1)}
            y2={py(l.at)}
            stroke={GRID_STROKE[l.weight]}
            strokeWidth={1}
          />
        ),
      )}
    </g>
  );
}

/**
 * Faint on purpose. The grid is a reference the operator reads when they look
 * for it; content and the selection outline have to stay the brightest things
 * on the preview or the overlay has made the tool harder to use.
 */
const GRID_STROKE: Record<GridWeight | 'major', string> = {
  centre: 'rgba(64,224,255,0.26)',
  major: 'rgba(255,255,255,0.16)',
  minor: 'rgba(255,255,255,0.07)',
};

/**
 * A path already banked. Drawn dimmer and without its points, so the one being
 * drawn is the one that looks live — the operator needs to see the faces they
 * have marked without those marks competing with the stroke in their hand.
 */
/**
 * The rubber-banded face, mid-drag.
 *
 * Dashed and dimmed while it is not yet a face, matching `PathOverlay`'s rule
 * that a dashed outline is one still taking input — so "is this mine to let go
 * of yet" is answerable at a glance rather than by releasing and finding out.
 */
function ShapeDraftOverlay({
  draft,
  px,
  py,
}: {
  draft: ShapeDraft | null;
  px: (v: number) => number;
  py: (v: number) => number;
}): React.JSX.Element | null {
  if (!draft) return null;
  const path = generateShape(draft.mode, draft, 'draft');
  const placeable = isDraftPlaceable(draft);
  if (!path) {
    // Too small to be meant — show the box that is being dragged, so the
    // builder can see the tool is alive and that it has not reached a size that
    // would make a face yet.
    const b = draftBounds(draft);
    return (
      <rect
        x={px(b.minX)}
        y={py(b.minY)}
        width={px(b.maxX - b.minX)}
        height={py(b.maxY - b.minY)}
        fill="none"
        stroke="#6f767d"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
    );
  }
  const d = path.points.map((q) => `${px(q.x)},${py(q.y)}`).join(' ');
  return (
    <g>
      <polygon
        points={d}
        fill="rgba(64,224,255,0.10)"
        stroke="#40e0ff"
        strokeWidth={1}
        strokeDasharray={placeable ? undefined : '4 3'}
      />
      {path.points.map((q, i) => (
        <rect
          key={i}
          x={px(q.x) - 2}
          y={py(q.y) - 2}
          width={4}
          height={4}
          fill="#40e0ff"
          stroke="#06202a"
          strokeWidth={1}
        />
      ))}
    </g>
  );
}


function BankedPath({
  path,
  selected,
  px,
  py,
}: {
  path: Path;
  selected: boolean;
  px: (v: number) => number;
  py: (v: number) => number;
}): React.JSX.Element | null {
  if (path.points.length < 2) return null;
  const d = path.points.map((q) => `${px(q.x)},${py(q.y)}`).join(' ');
  const stroke = selected ? '#ffd166' : '#2f7f92';
  return (
    <g>
      {path.closed ? (
        <polygon
          points={d}
          fill={selected ? 'rgba(255,209,102,0.12)' : 'rgba(64,224,255,0.06)'}
          stroke={stroke}
          strokeWidth={selected ? 1.5 : 1}
        />
      ) : (
        <polyline points={d} fill="none" stroke={stroke} strokeWidth={selected ? 1.5 : 1} />
      )}
      {/* Points shown on the selected path only, so "this is the one that will
          move" is visible without every banked path sprouting handles. */}
      {selected &&
        path.points.map((q, i) => (
          <rect
            key={i}
            x={px(q.x) - 2.5}
            y={py(q.y) - 2.5}
            width={5}
            height={5}
            fill={stroke}
            stroke="#2a1f06"
            strokeWidth={1}
          />
        ))}
    </g>
  );
}

/**
 * The path being drawn, live.
 *
 * Every coordinate it draws comes from `previewPoints` — the same array the
 * commit is built from — so the line the operator watches is the path they get
 * rather than a second drawing of the same idea. The rubber band to an
 * unpressed pointer is part of that array, not a segment added here.
 */
function PathOverlay({
  state,
  hover,
  aspect,
  shift,
  px,
  py,
}: {
  state: PathToolState;
  hover: NormalizedPoint | null;
  aspect: number;
  shift: boolean;
  px: (v: number) => number;
  py: (v: number) => number;
}): React.JSX.Element | null {
  const points = previewPoints(state, hover, aspect, shift);
  if (points.length === 0) return null;
  const d = points.map((q) => `${px(q.x)},${py(q.y)}`).join(' ');
  const closing = hover !== null && wouldClose(state, hover, aspect);
  return (
    <g>
      {points.length > 1 &&
        (state.closed ? (
          <polygon points={d} fill="rgba(64,224,255,0.10)" stroke="#40e0ff" strokeWidth={1} />
        ) : (
          <polyline
            points={d}
            fill="none"
            stroke="#40e0ff"
            strokeWidth={1}
            // Dashed while it is taking clicks. Enter banks it, and it comes
            // back as a solid `BankedPath` — so "is this still mine to edit" is
            // answerable at a glance rather than by clicking and finding out.
            // The solid branch stays reachable for a finished-but-unbanked
            // path, which is what `finishPath` alone produces.
            strokeDasharray={state.finished ? undefined : '4 3'}
          />
        ))}
      {state.points.map((q, i) => (
        <rect
          key={i}
          x={px(q.x) - 2.5}
          y={py(q.y) - 2.5}
          width={5}
          height={5}
          // The first point wears the close affordance while the pointer is
          // over it, so "click here to close" is visible before the click.
          fill={i === 0 && closing ? '#ffd166' : '#40e0ff'}
          stroke="#06202a"
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

const PROJECTOR_GRID_STYLE: React.CSSProperties = {
  background: '#16303a',
  color: '#c7ced4',
  border: '1px solid #2f7f92',
  borderRadius: 3,
  padding: '1px 6px',
  font: 'inherit',
  fontSize: 11,
  cursor: 'pointer',
};
