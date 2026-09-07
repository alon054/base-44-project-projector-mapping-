/**
 * S1 — a scene as a file. The renderer-side half of `scenes/<name>.json`;
 * `electron/scenes.ts` is the other half and knows only bytes.
 *
 * There is no second reader and no second format here. A scene has carried its
 * own `version` since Phase 1 and `canonicalizeScene` is already "the single
 * entry point for untrusted scene data — a file on disk, an IPC payload". This
 * module only says what a refusal looks like when the untrusted data came from
 * a file: **never a throw**, always a reason naming the offending value, and
 * the scene the editor already holds left exactly as it was (I-13: a bad file
 * costs a show, never a session — the same policy `readVersionedList` applies
 * to the room).
 *
 * What a scene file does NOT contain, asserted in `sceneFile.test.ts` in both
 * directions: any surface geometry. `core/scene.ts` still imports nothing from
 * the surface tree (the import-graph test), and a file that arrives with a
 * `surfaces` key is refused whole (I-15).
 */
import { SceneFormatError, canonicalizeScene, type Scene } from './scene';

export type SceneFileRead = { ok: true; scene: Scene } | { ok: false; reason: string };

/**
 * What `scenes/<name>.json` holds: the scene, pretty-printed so a committed
 * `scenes/reel.json` diffs by line. Byte-for-byte what main writes, so a test
 * can round-trip through this without a process boundary.
 */
export function sceneFileBytes(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`;
}

/** The raw object main hands back over IPC, judged. Never throws. */
export function readSceneFile(raw: unknown): SceneFileRead {
  try {
    return { ok: true, scene: canonicalizeScene(raw) };
  } catch (e) {
    if (e instanceof SceneFormatError) return { ok: false, reason: e.message };
    return { ok: false, reason: String(e) };
  }
}

/** The bytes of a scene file, judged. Never throws. */
export function readSceneFileText(text: string): SceneFileRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `scene file is not valid JSON: ${(e as Error).message}` };
  }
  return readSceneFile(raw);
}
