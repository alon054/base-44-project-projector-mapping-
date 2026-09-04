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
 * Tolerant read. **Never throws** — a corrupt or future-version calibration
 * file must not stop the app from opening, so anything unreadable degrades to
 * "no calibration" and the caller logs it. Unknown future versions are refused
 * as a whole rather than half-interpreted, which is Phase 7's gate condition
 * ("a Phase-2 calibration file either loads or is migrated, never silently
 * misinterpreted") pointed the other way in time.
 */
export function canonicalizeCalibrationFile(raw: unknown): CalibrationFile {
  if (typeof raw !== 'object' || raw === null) return createCalibrationFile();
  const o = raw as Record<string, unknown>;
  const version = o['version'];
  if (version !== CALIBRATION_VERSION) return createCalibrationFile();
  const list = o['viewports'];
  if (!Array.isArray(list)) return createCalibrationFile();
  const viewports: ViewportCalibration[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const v = readViewport(entry);
    if (!v || seen.has(v.viewportId)) continue;
    seen.add(v.viewportId);
    viewports.push(v);
  }
  return { version: CALIBRATION_VERSION, viewports };
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
