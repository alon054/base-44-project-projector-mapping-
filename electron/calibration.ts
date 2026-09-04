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

function calibrationPath(): string {
  // Packaged: userData. Dev: the repo's calibration/ dir, so it is inspectable
  // — same policy as config/, for the same reason.
  return app.isPackaged
    ? join(app.getPath('userData'), 'calibration', 'warp.json')
    : join(app.getAppPath(), 'calibration', 'warp.json');
}

/**
 * The stored calibration as raw JSON, or `null` if there is none or it cannot
 * be read. **Never throws.** A calibration that fails to load costs an
 * alignment; a main process that throws on boot costs the session (I-13).
 */
export function loadCalibrationRaw(): unknown {
  const p = calibrationPath();
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as unknown;
  } catch (err) {
    console.error(`[calibration] unreadable, continuing without one: ${String(err)}`);
    return null;
  }
}

/** Writes the calibration. Never throws; a failed write is logged, not fatal. */
export function saveCalibrationRaw(data: unknown): void {
  const p = calibrationPath();
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error(`[calibration] could not persist: ${String(err)}`);
  }
}

export function calibrationFilePath(): string {
  return calibrationPath();
}
