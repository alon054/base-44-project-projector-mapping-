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
  deletePointAt,
  discardActivePath,
  emptyPathSession,
  pathToolDown,
  pathToolMove,
  pathToolUp,
  pointIndexAt,
  previewPoints,
  removePath,
  wouldClose,
  type PathSession,
  type PathToolState,
} from './pathTool';
import type { Path } from '../core/paths';
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

export const PREVIEW_SIZE = { width: 480, height: 270 } as const;

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
}

export function PreviewCanvas({
  speed,
  nominalMs,
  scene,
  clockState,
  onClockReady,
  setScene,
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

  useEffect(() => {
    let disposed = false;
    let created: RenderHost | null = null;
    const el = mount.current;
    if (!el) return;

    void createRenderHost({
      parent: el,
      width: PREVIEW_SIZE.width,
      height: PREVIEW_SIZE.height,
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
      h.setSpeed(speed);
      h.setScene(sceneRef.current);
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

  useEffect(() => {
    if (nominalMs > 0) host.current?.setNominalMs(nominalMs);
  }, [nominalMs]);

  useEffect(() => {
    host.current?.setScene(scene);
  }, [scene]);

  // I-2. The preview's clock is a real clock; this applies the operator's
  // intent to it, which is what makes a pause visible in the editor without a
  // round trip to the output window.
  useEffect(() => {
    host.current?.setClock(clockState);
  }, [clockState]);

  return (
    <RegionSurface scene={scene} setScene={setScene}>
      <div
        ref={mount}
        style={{
          width: PREVIEW_SIZE.width,
          height: PREVIEW_SIZE.height,
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
  children,
}: {
  scene: Scene;
  setScene: ((update: (prev: Scene) => Scene) => void) | undefined;
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
  const [session, setSession] = useState<PathSession>(emptyPathSession());
  const [hover, setHover] = useState<NormalizedPoint | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  const aspect = aspectOf(PREVIEW_SIZE.width, PREVIEW_SIZE.height);

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

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!setScene) return;
    const p = pointOf(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Focus, so the Delete key below reaches this element rather than the page.
    surface.current?.focus();
    if (tool === 'path') {
      setShiftHeld(e.shiftKey);
      setSession((prev) => ({ ...prev, active: pathToolDown(prev.active, p, aspect, e.shiftKey) }));
      return;
    }
    const start = beginGesture(scene, selectedId, p, aspect);
    setSelectedId(start.selectedId);
    setGesture(start.gesture);
    setDraft(gestureRect(scene, start.gesture, p, aspect));
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const p = pointOf(e);
    if (tool === 'path') {
      setShiftHeld(e.shiftKey);
      setHover(p);
      if (p) {
        setSession((prev) => ({
          ...prev,
          active: pathToolMove(prev.active, p, aspect, e.shiftKey),
        }));
      }
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
    if (tool === 'path') {
      const p = pointOf(e);
      // Simplification happens inside this call, once, on release (D19).
      setSession((prev) => ({ ...prev, active: pathToolUp(prev.active, p, aspect, e.shiftKey) }));
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
    if (tool === 'path' && e.key === 'Enter') {
      e.preventDefault();
      setSession(commitActivePath);
      return;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (tool === 'path') {
      e.preventDefault();
      // The point under the pointer, or the last one placed when the pointer is
      // nowhere near a point — which is what "undo that click" means here.
      setSession((prev) => {
        const at = hover ? pointIndexAt(prev.active, hover, aspect) : null;
        return { ...prev, active: deletePointAt(prev.active, at ?? prev.active.points.length - 1) };
      });
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

  const px = (v: number): number => v * PREVIEW_SIZE.width;
  const py = (v: number): number => v * PREVIEW_SIZE.height;
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
          width: PREVIEW_SIZE.width,
          height: PREVIEW_SIZE.height,
          cursor: setScene ? 'crosshair' : 'default',
          touchAction: 'none',
          outline: 'none',
        }}
      >
        {children}
        <svg
          width={PREVIEW_SIZE.width}
          height={PREVIEW_SIZE.height}
          // The canvas underneath owns every pointer event; this is decoration.
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
          aria-hidden
        >
          {tool === 'region' && outline && (
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
          {tool === 'path' && (
            <>
              {session.paths.map((q) => (
                <BankedPath key={q.id} path={q} px={px} py={py} />
              ))}
              <PathOverlay
                state={session.active}
                hover={hover}
                aspect={aspect}
                shift={shiftHeld}
                px={px}
                py={py}
              />
            </>
          )}
          {/* Handles only on a settled selection: mid-gesture they would be
              drawn at the corners of a box that is still moving under them. */}
          {tool === 'region' && selected && !draft &&
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
        <label htmlFor="place-kind" style={{ color: '#8b939b' }}>
          draw
        </label>
        <select
          id="place-kind"
          value={placeKind}
          onChange={(e) => setPlaceKind(e.currentTarget.value as ProceduralKind)}
          disabled={tool === 'path'}
          style={SELECT_STYLE}
        >
          {PROCEDURAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {tool === 'path' ? (
          <>
            <button
              type="button"
              onClick={() => setSession(discardActivePath)}
              style={SELECT_STYLE}
            >
              discard
            </button>
            <button
              type="button"
              onClick={() =>
                setSession((prev) =>
                  prev.paths.length === 0
                    ? prev
                    : removePath(prev, prev.paths[prev.paths.length - 1]!.id),
                )
              }
              disabled={session.paths.length === 0}
              style={SELECT_STYLE}
            >
              undo last
            </button>
            <span>
              {`${session.paths.length} path${session.paths.length === 1 ? '' : 's'} · ` +
                `${session.active.points.length} point${
                  session.active.points.length === 1 ? '' : 's'
                } in this one` +
                (session.active.closed ? ' · closed' : '') +
                (session.active.lastSimplification
                  ? ` · last stroke ${session.active.lastSimplification.before} → ${session.active.lastSimplification.after}`
                  : '') +
                ' — click adds, drag draws, shift squares, Delete removes' +
                (session.active.points.length >= 2 ? ', Enter finishes and starts the next' : '') +
                (session.active.points.length >= CLOSE_MIN_POINTS && !session.active.closed
                  ? ', first point closes it into a loop'
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
 * A path already banked. Drawn dimmer and without its points, so the one being
 * drawn is the one that looks live — the operator needs to see the faces they
 * have marked without those marks competing with the stroke in their hand.
 */
function BankedPath({
  path,
  px,
  py,
}: {
  path: Path;
  px: (v: number) => number;
  py: (v: number) => number;
}): React.JSX.Element | null {
  if (path.points.length < 2) return null;
  const d = path.points.map((q) => `${px(q.x)},${py(q.y)}`).join(' ');
  return path.closed ? (
    <polygon points={d} fill="rgba(64,224,255,0.06)" stroke="#2f7f92" strokeWidth={1} />
  ) : (
    <polyline points={d} fill="none" stroke="#2f7f92" strokeWidth={1} />
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
