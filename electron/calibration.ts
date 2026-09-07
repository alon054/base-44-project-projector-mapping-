/**
 * I-5 — the calibration file store (SPEC.md §7 `calibration/`).
 *
 * **Deliberately dumb.** The main process reads and writes opaque JSON and has
 * no idea what a corner is. Every rule about what makes a calibration valid —
 * version, corner count, quad health, migration — lives in
 * `src/render/calibration.ts`, on the renderer side, where the warp is.
 *
 * That split is not just a tsconfig boundary (`rootDir: electron` means main
 * genuinely cannot import from `src/`). It is I-5 pointed at the process
 * boundary: the fewer places that know the shape of a calibration, the fewer
 * places can half-interpret one. Main's only job is that the bytes survive a
 * relaunch.
 *
 * Not a scene, not a setting. Scenes go to `scenes/` in Phase 6; app prefs are
 * `config/settings.json`. Three separate files because I-5 says calibration is
 * persisted separately from scenes, and because a scene bank that could
 * overwrite a calibration is how a night's alignment gets lost on a scene load.
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * One named file in `calibration/`. **The only place that directory is
 * spelled**, so the warp and the room cannot end up in different places.
 *
 * B3 is why this is a parameter rather than two functions with a literal in
 * each: `surfaces.json` arrived beside `warp.json`, and a second copy of the
 * packaged-vs-dev branch is a second thing to get wrong the first time this app
 * is packaged. CLAUDE.md's "when you fix an instance, grep for the class" —
 * here the class was reached before the second instance could diverge.
 *
 * Packaged: userData. Dev: the repo's calibration/ dir, so it is inspectable —
 * same policy as config/, for the same reason.
 */
function calibrationDirFile(name: string): string {
  return app.isPackaged
    ? join(app.getPath('userData'), 'calibration', name)
    : join(app.getAppPath(), 'calibration', name);
}

/**
 * Raw JSON from a file in `calibration/`, or `null`. **Never throws.** A
 * calibration that fails to load costs an alignment; a main process that throws
 * on boot costs the session (I-13). The room degrades the same way and for the
 * same reason: an evening of re-marking beats an app that will not start.
 */
function loadRaw(name: string): unknown {
  const p = calibrationDirFile(name);
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as unknown;
  } catch (err) {
    console.error(`[calibration] ${name} unreadable, continuing without it: ${String(err)}`);
    return null;
  }
}

/** Writes one file in `calibration/`. Never throws; a failed write is logged. */
function saveRaw(name: string, data: unknown): void {
  const p = calibrationDirFile(name);
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error(`[calibration] could not persist ${name}: ${String(err)}`);
  }
}

const WARP_FILE = 'warp.json';
/**
 * I-15, SPRINT.md §3 R1. The room — every marked face, its role and its path.
 *
 * Rewritten on **every** edit, including each pointer sample of a point drag,
 * because the builder is at the wall and there is no save button to find in the
 * dark. That is affordable precisely because main is dumb on this path: it
 * stringifies a small JSON blob and writes it. It does not know what a face is
 * and nothing here should teach it — the shape lives in `core/surfaces.ts` and
 * the envelope in `src/render/calibration.ts`, exactly as the warp's does.
 */
const SURFACES_FILE = 'surfaces.json';

export function loadCalibrationRaw(): unknown {
  return loadRaw(WARP_FILE);
}

export function saveCalibrationRaw(data: unknown): void {
  saveRaw(WARP_FILE, data);
}

export function loadSurfacesRaw(): unknown {
  return loadRaw(SURFACES_FILE);
}

export function saveSurfacesRaw(data: unknown): void {
  saveRaw(SURFACES_FILE, data);
}

export function calibrationFilePath(): string {
  return calibrationDirFile(WARP_FILE);
}

export function surfacesFilePath(): string {
  return calibrationDirFile(SURFACES_FILE);
}

/**
 * S3. `calibration/surfaces.history/NN.json` — the room as it was before a
 * gesture began, rotating over `ROOM_HISTORY_DEPTH` slots. Same directory
 * helper, same dumb write, same "never throws": a snapshot that fails to land
 * costs one backup, never the write it accompanies (I-13). WHEN a snapshot is
 * taken is not decided here — `roomHistory.ts` holds that rule, and main
 * applies it in the one handler that already writes `surfaces.json`.
 */
const SURFACES_HISTORY_DIR = 'surfaces.history';

export function saveSurfacesSnapshotRaw(index: number, data: unknown): void {
  saveRaw(join(SURFACES_HISTORY_DIR, `${String(index).padStart(2, '0')}.json`), data);
}

export function surfacesHistoryDirPath(): string {
  return calibrationDirFile(SURFACES_HISTORY_DIR);
}
