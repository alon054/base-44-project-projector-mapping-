/**
 * A downloaded catalog asset, judged at the renderer's boundary and turned into
 * a `BundledAsset` the library will register (I-10, I-13).
 *
 * `electron/catalogLogic.ts` builds the entry in main; this is the RECEIVING
 * side, and it trusts nothing it was handed. Main cannot import from `src/`
 * (`rootDir: electron`), so the shape is stated twice and this function is
 * what makes the two agree: an entry that drifts from what `AssetLibrary`
 * accepts is refused here with the field named, not registered as a half-asset
 * that throws when a scene names it.
 *
 * The URL must be `library://…`. That scheme is served by main's protocol
 * handler from the library directory on disk, and it is the only way a
 * downloaded byte reaches a renderer — never over IPC (I-7).
 */
import type { StillAsset, VideoAsset } from './library';

export const LIBRARY_SCHEME = 'library://';

export class LibraryEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryEntryError';
  }
}

export function canonicalizeLibraryEntry(raw: unknown): StillAsset | VideoAsset {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LibraryEntryError('library entry must be an object');
  }
  const o = raw as Record<string, unknown>;
  const id = o['id'];
  if (typeof id !== 'string' || id === '') throw new LibraryEntryError('library entry has no id');
  const name = typeof o['name'] === 'string' && o['name'] !== '' ? o['name'] : id;
  const url = o['url'];
  if (typeof url !== 'string' || !url.startsWith(LIBRARY_SCHEME)) {
    throw new LibraryEntryError(
      `library entry "${id}": url must start with ${LIBRARY_SCHEME}, got ${JSON.stringify(url)}`,
    );
  }
  const license = o['license'];
  if (typeof license !== 'object' || license === null) {
    throw new LibraryEntryError(`library entry "${id}": no license record (I-10)`);
  }
  const kind = o['kind'];
  if (kind === 'still') {
    // `validateLicense` runs inside `AssetLibrary.register`; the record is
    // passed through as-is so there is one validator, not two that agree today.
    return { id, name, kind: 'still', url, license: license as StillAsset['license'] };
  }
  if (kind === 'video') {
    const posterUrl = o['posterUrl'];
    if (typeof posterUrl !== 'string' || !posterUrl.startsWith(LIBRARY_SCHEME)) {
      throw new LibraryEntryError(`library entry "${id}": a video needs a library:// posterUrl (I-13)`);
    }
    const loop = o['loopSeconds'];
    const loopSeconds = typeof loop === 'number' && Number.isFinite(loop) && loop > 0 ? loop : 4;
    return {
      id,
      name,
      kind: 'video',
      url,
      posterUrl,
      loopSeconds,
      seamless: o['seamless'] !== false,
      license: license as VideoAsset['license'],
    };
  }
  throw new LibraryEntryError(
    `library entry "${id}": kind must be "still" or "video", got ${JSON.stringify(kind)}`,
  );
}
