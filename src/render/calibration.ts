/**
 * I-5 — warp calibration: the control-point state for the final mapping stage,
 * persisted in `calibration/` and never inside a scene (SPEC.md §7).
 *
 * Three things are deliberately true of this file:
 *
 *  - **It is pure.** No PixiJS, no filesystem, no Electron. The geometry that
 *    decides whether a wall looks square is unit-testable without a GPU (§8.1),
 *    and the process boundary is somebody else's problem.
 *  - **It stores normalized corners, never pixels** (I-1). A calibration made at
 *    1280x720 is the same calibration at 1920x1080; `toPixelCorners` is the only
 *    place a corner becomes a pixel, and it is called at draw time.
 *  - **It is NOT in the I-8 parameter registry, and that is a decision.** I-8's
 *    subject is forces, per-entity parameters and grade settings — things an
 *    operator modulates during a show. Calibration is the description of a
 *    physical surface. Registering corners would make them MIDI-mappable in
 *    Phase 11, and a knob that nudges keystone mid-show is a destroyed
 *    calibration with no undo on a wall. A unit test asserts no `warp.*` key is
 *    ever registered, so the absence is checked rather than merely intended.
 *
 * Corner order is **clockwise from top-left: TL, TR, BR, BL**. That is also
 * PixiJS's `PerspectiveMesh.setCorners` order, chosen so there is no reordering
 * step between this model and the renderer that could be got wrong in one
 * direction only.
 */

/** Bumped when the on-disk shape changes. Phase 7's gate requires migration. */
export const CALIBRATION_VERSION = 1;

/** A control point in normalized output space (I-1). */
export interface CalibrationPoint {
  /** [0, 1] of output width. */
  x: number;
  /** [0, 1] of output height. */
  y: number;
}

/** TL, TR, BR, BL — clockwise from top-left. */
export type CalibrationCorners = readonly [
  CalibrationPoint,
  CalibrationPoint,
  CalibrationPoint,
  CalibrationPoint,
];

export const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL'] as const;
export type CornerIndex = 0 | 1 | 2 | 3;

/**
 * Calibration for one output viewport. Keyed by `OutputViewport.id` so that
 * I-9's array stays shape-only here too: a second projector in Phase 11 is
 * another entry, not a change to this type.
 */
export interface ViewportCalibration {
  viewportId: string;
  /**
   * Whether the warp stage is in the path at all. Off means the compositor is
   * drawn straight to the stage — not "warped by an identity transform" — so
   * that "disabling warp changes nothing" (Gate 2) is structural rather than a
   * claim about floating point.
   */
  enabled: boolean;
  corners: CalibrationCorners;
}

export interface CalibrationFile {
  version: number;
  viewports: ViewportCalibration[];
}

/** The unwarped unit square. Equal to the output rect at any resolution. */
export function identityCorners(): CalibrationCorners {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
}

export function isIdentityCorners(c: CalibrationCorners): boolean {
  const id = identityCorners();
  return c.every((p, i) => p.x === id[i]!.x && p.y === id[i]!.y);
}

export function createCalibration(viewportId: string): ViewportCalibration {
  return { viewportId, enabled: false, corners: identityCorners() };
}

export function createCalibrationFile(): CalibrationFile {
  return { version: CALIBRATION_VERSION, viewports: [] };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Quad health.
//
// A projective transform from the unit square to an arbitrary quad is singular
// when the quad is degenerate, and a singular homography produces NaN vertex
// positions — which is a black wall in the middle of a show, arriving from a
// drag that looked ordinary. So a corner move that would destroy the quad is
// REFUSED at the model, before it can reach the mesh. This is I-13 applied to
// the operator's own hand rather than to a missing asset.
//
// Strict convexity is the actual requirement: all four cross products the same
// sign means the quad does not self-intersect and has no reflex vertex, which
// is exactly the condition for the map to be invertible. The area floor is a
// separate, purely numerical guard against a quad that is convex but so thin
// the homography loses precision.
// ---------------------------------------------------------------------------

/** Shoelace area, positive for the clockwise-in-screen-space corner order. */
export function quadArea(c: CalibrationCorners): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Fraction of the full output rect the quad covers. 1 for the identity square. */
const MIN_AREA = 0.01;
/** Guards against a convex-but-needle quad. Fraction of the output diagonal. */
const MIN_EDGE = 0.02;

export type QuadFault = 'not-finite' | 'out-of-range' | 'inverted' | 'too-small' | 'edge-too-short';

/**
 * `null` when the quad is usable. Otherwise the reason, so a refusal can be
 * logged and asserted rather than silently swallowed.
 */
export function quadFault(c: CalibrationCorners): QuadFault | null {
  for (const p of c) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'not-finite';
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return 'out-of-range';
  }
  for (let i = 0; i < 4; i++) {
    const prev = c[(i + 3) % 4]!;
    const cur = c[i]!;
    const next = c[(i + 1) % 4]!;
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    // Clockwise in screen space (y down) gives a positive cross at every vertex.
    // Any non-positive one is a reflex or collinear vertex: not strictly convex.
    if (!(cross > 0)) return 'inverted';
    const edge = Math.hypot(next.x - cur.x, next.y - cur.y);
    if (edge < MIN_EDGE) return 'edge-too-short';
  }
  if (quadArea(c) < MIN_AREA) return 'too-small';
  return null;
}

export function isUsableQuad(c: CalibrationCorners): boolean {
  return quadFault(c) === null;
}

/**
 * Move one corner, returning a new calibration. A move that would make the quad
 * unusable is refused and the previous calibration is returned unchanged — the
 * drag stops at the last good position instead of tearing the image.
 */
export function withCorner(
  cal: ViewportCalibration,
  index: CornerIndex,
  point: CalibrationPoint,
): ViewportCalibration {
  const next = cal.corners.map((p, i) =>
    i === index ? { x: clamp01(point.x), y: clamp01(point.y) } : { x: p.x, y: p.y },
  ) as unknown as CalibrationCorners;
  if (!isUsableQuad(next)) return cal;
  return { ...cal, corners: next };
}

export function withEnabled(cal: ViewportCalibration, enabled: boolean): ViewportCalibration {
  return { ...cal, enabled };
}

export function resetCorners(cal: ViewportCalibration): ViewportCalibration {
  return { ...cal, corners: identityCorners() };
}

// ---------------------------------------------------------------------------
// Persistence shape.
// ---------------------------------------------------------------------------

function readPoint(raw: unknown): CalibrationPoint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o['x'] !== 'number' || typeof o['y'] !== 'number') return null;
  if (!Number.isFinite(o['x']) || !Number.isFinite(o['y'])) return null;
  return { x: clamp01(o['x']), y: clamp01(o['y']) };
}

function readViewport(raw: unknown): ViewportCalibration | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = o['viewportId'];
  if (typeof id !== 'string' || id.length === 0) return null;
  const rawCorners = o['corners'];
  if (!Array.isArray(rawCorners) || rawCorners.length !== 4) return null;
  const points = rawCorners.map(readPoint);
  const tl = points[0];
  const tr = points[1];
  const br = points[2];
  const bl = points[3];
  if (!tl || !tr || !br || !bl) return null;
  const corners: CalibrationCorners = [tl, tr, br, bl];
  return {
    viewportId: id,
    enabled: o['enabled'] === true,
    // A file whose quad is degenerate loads as identity rather than failing to
    // load. Losing a calibration is recoverable in a minute; a session that
    // will not start is not (I-13).
    corners: isUsableQuad(corners) ? corners : identityCorners(),
  };
}

/**
 * The one versioned-file reader in `calibration/`. **Never throws.**
 *
 * Every file in that directory has the same envelope — a `version` and one
 * named list — and this is the only code that opens it. warp.json and
 * `surfaces.json` are two calls to this function with different entry readers,
 * not two loaders that happen to agree today.
 *
 * The policy, in one place:
 *
 * - A corrupt or **future-version** file degrades to an empty list rather than
 *   stopping the app. Unknown versions are refused **as a whole** rather than
 *   half-interpreted, which is Phase 7's gate condition ("a Phase-2 file either
 *   loads or is migrated, never silently misinterpreted") pointed the other way
 *   in time.
 * - An unreadable **entry** is skipped and the rest of the file survives. One
 *   bad face is not a lost room (I-13).
 * - Duplicate ids: first wins. Later entries are dropped rather than merged,
 *   because a merge is a guess.
 *
 * Generic and structurally typed, so this module still imports **nothing at
 * all** — see warp.test.ts. The entry reader arrives as an argument, which is
 * also what keeps the surface tree in `core/` where SPEC.md §7 puts it while its
 * bytes are read here (I-5: nothing under `core/` may import this file).
 */
export function readVersionedList<T>(
  raw: unknown,
  expectedVersion: number,
  key: string,
  readEntry: (entry: unknown) => T | null,
  idOf: (entry: T) => string,
): T[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const o = raw as Record<string, unknown>;
  if (o['version'] !== expectedVersion) return [];
  const list = o[key];
  if (!Array.isArray(list)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const v = readEntry(entry);
    if (!v || seen.has(idOf(v))) continue;
    seen.add(idOf(v));
    out.push(v);
  }
  return out;
}

/** Tolerant read of warp.json. See `readVersionedList` for the policy. */
export function canonicalizeCalibrationFile(raw: unknown): CalibrationFile {
  return {
    version: CALIBRATION_VERSION,
    viewports: readVersionedList(
      raw,
      CALIBRATION_VERSION,
      'viewports',
      readViewport,
      (v) => v.viewportId,
    ),
  };
}

// ---------------------------------------------------------------------------
// calibration/surfaces.json — the surface tree's bytes (I-15, SPRINT.md §3 R1).
//
// The room is calibration: it lives in `calibration/`, survives every scene
// switch and is re-made when the room changes. So it is read and written here,
// beside warp.json, through the envelope above — not by a second reader and
// not in a second format.
//
// The *shape* of a surface lives in `core/surfaces.ts` and arrives as the
// `readSurface` argument. That is not indirection for its own sake: I-5 forbids
// anything under `core/` from importing this module, and this module imports
// nothing, so the composition happens at the call site or nowhere.
// ---------------------------------------------------------------------------

/** Bumped when `surfaces.json`'s shape changes. Independent of the warp's version. */
export const SURFACES_VERSION = 1;

/** The on-disk envelope. Generic so this module needs no surface type. */
export interface SurfaceFile<S> {
  version: number;
  surfaces: S[];
}

/**
 * The surfaces in a stored file, in **marking order** — the array's order,
 * preserved end to end, because it is the order faces light in.
 */
export function readSurfaces<S extends { id: string }>(
  raw: unknown,
  readSurface: (entry: unknown) => S | null,
): S[] {
  return readVersionedList(raw, SURFACES_VERSION, 'surfaces', readSurface, (s) => s.id);
}

/**
 * The file to persist for a surface tree.
 *
 * **Called on every point drag** (B3), so it is O(n) in the number of faces and
 * copies nothing else: the entries are the caller's own objects, and the list
 * is copied only so a later edit to the tree cannot reach back into a file
 * already handed to the writer. There is no serialization, no clone and no
 * validation pass here — a drag must not pay for one.
 */
export function writeSurfaces<S>(surfaces: readonly S[]): SurfaceFile<S> {
  return { version: SURFACES_VERSION, surfaces: [...surfaces] };
}

/** The empty room. What a first launch has before anything is marked. */
export function createSurfaceFile<S>(): SurfaceFile<S> {
  return { version: SURFACES_VERSION, surfaces: [] };
}

/**
 * One viewport's calibration from whatever arrived over IPC. Tolerant in the
 * same way and for the same reason as `canonicalizeCalibrationFile`: this is
 * the validation boundary, and a malformed message leaves the warp showing what
 * it already had rather than half-applying a new one (the same policy
 * `canonicalizeScene` follows for scenes).
 */
export function canonicalizeCalibration(raw: unknown, viewportId: string): ViewportCalibration {
  return readViewport(raw) ?? createCalibration(viewportId);
}

/** The viewport's calibration, or a fresh identity one if it has none yet. */
export function calibrationFor(file: CalibrationFile, viewportId: string): ViewportCalibration {
  return file.viewports.find((v) => v.viewportId === viewportId) ?? createCalibration(viewportId);
}

export function withViewportCalibration(
  file: CalibrationFile,
  cal: ViewportCalibration,
): CalibrationFile {
  const exists = file.viewports.some((v) => v.viewportId === cal.viewportId);
  return {
    version: CALIBRATION_VERSION,
    viewports: exists
      ? file.viewports.map((v) => (v.viewportId === cal.viewportId ? cal : v))
      : [...file.viewports, cal],
  };
}

// ---------------------------------------------------------------------------
// Draw time.
// ---------------------------------------------------------------------------

/** Pixel corners, derived and never stored (I-1). The only such step here. */
export function toPixelCorners(
  c: CalibrationCorners,
  width: number,
  height: number,
): [number, number, number, number, number, number, number, number] {
  return [
    c[0].x * width, c[0].y * height,
    c[1].x * width, c[1].y * height,
    c[2].x * width, c[2].y * height,
    c[3].x * width, c[3].y * height,
  ];
}

/**
 * The `[warp]` log line, mirroring `[scene] applied`. That line is what made
 * three editor bugs findable in Phase 1; the equivalent for warp state must
 * exist BEFORE anything is debugged on a wall, not after.
 */
export function describeCalibration(cal: ViewportCalibration): string {
  const corners = cal.corners
    .map((p, i) => `${CORNER_LABELS[i]}(${p.x.toFixed(4)},${p.y.toFixed(4)})`)
    .join(' ');
  const shape = isIdentityCorners(cal.corners) ? 'identity' : `area=${quadArea(cal.corners).toFixed(4)}`;
  return `[warp] ${cal.viewportId}: ${cal.enabled ? 'ON' : 'OFF'} ${shape} ${corners}`;
}
