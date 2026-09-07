/**
 * S1 — the scene file store (SPEC.md §7 `scenes/`). A minimal third of P8-C,
 * arriving early the way B1 pulled P6-A forward.
 *
 * **Deliberately dumb**, exactly as `calibration.ts` is for the room. Main
 * reads and writes opaque JSON and has no idea what a layer is. Every rule
 * about what makes a scene valid — version, layer shape, groups, the refusal
 * of any surface geometry (I-15) — lives in `src/core/scene.ts`, on the
 * renderer side, behind `canonicalizeScene`. `rootDir: electron` means main
 * genuinely cannot import it, and that is I-5 pointed at the process boundary.
 *
 * Three directories, three modules, on purpose: a scene store that could reach
 * `calibration/` is how a night's alignment gets lost on a scene load (I-5).
 * This module spells `scenes/` and nothing else.
 *
 * The one thing main judges is the NAME, because it becomes a path segment.
 * `isSceneName` (ipc.ts) is that judgement; a name that fails is refused, never
 * rewritten.
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isSceneName } from './ipc';

/** Packaged: userData. Dev: the repo's scenes/ dir, so `scenes/reel.json` can be committed. */
function scenesDirFile(name: string): string {
  if (!isSceneName(name)) throw new Error(`not a scene name: ${JSON.stringify(name)}`);
  const file = `${name}.json`;
  return app.isPackaged
    ? join(app.getPath('userData'), 'scenes', file)
    : join(app.getAppPath(), 'scenes', file);
}

/**
 * Raw JSON for a named scene, or `null`. **Never throws.** A scene that fails
 * to load costs a show that has to be rebuilt from the editor; a main process
 * that throws on a bad file costs the session (I-13).
 */
export function loadSceneRaw(name: string): unknown {
  if (!isSceneName(name)) return null;
  const p = scenesDirFile(name);
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as unknown;
  } catch (err) {
    console.error(`[scenes] ${name}.json unreadable, continuing without it: ${String(err)}`);
    return null;
  }
}

/** Writes one scene file. Returns the path written, or the reason it was not. */
export function saveSceneRaw(name: string, data: unknown): { ok: true; path: string } | { ok: false; reason: string } {
  if (!isSceneName(name)) return { ok: false, reason: `not a scene name: ${JSON.stringify(name)}` };
  const p = scenesDirFile(name);
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return { ok: true, path: p };
  } catch (err) {
    console.error(`[scenes] could not persist ${name}.json: ${String(err)}`);
    return { ok: false, reason: String(err) };
  }
}

export function sceneFilePath(name: string): string {
  return scenesDirFile(name);
}
