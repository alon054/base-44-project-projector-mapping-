/**
 * The online catalog — the NODE half: fetch, download, cache, index.
 *
 * Everything decided here was decided in `catalogLogic.ts`; this file only
 * carries bytes. Three places bytes land, all under one root
 * (`libraryRoot()`), and the renderers read them ONLY through the `library:`
 * protocol `main.ts` registers — never over IPC (I-7):
 *
 *   <root>/index.json              every entry, versioned (`LIBRARY_INDEX_VERSION`)
 *   <root>/<source>/<item>/<file>  the downloaded asset
 *   <root>/.thumbs/<item>.jpg      the Archive's item tile, cached on first view
 *
 * Packaged: userData. Dev: the repo's `assets/library/`, gitignored — it is the
 * operator's collection, like `calibration/` is the operator's room, and SPEC.md
 * §7 already reserves that path for "the demo library".
 *
 * Never throws across IPC. A failed search is an empty list plus a console
 * line; a failed add is `{ ok: false, reason }` in words the operator can act on
 * (I-13: nothing here may end a session).
 */
import { app, net } from 'electron';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  archiveDownloadUrl,
  archiveMetadataUrl,
  archiveSearchUrl,
  archiveThumbUrl,
  buildLibraryEntry,
  candidateFiles,
  catalogAssetDir,
  catalogClips,
  describeFormats,
  fileThumbFor,
  licenseFromUrl,
  emptyLibraryIndex,
  parseArchiveSearch,
  readLibraryIndex,
  slug,
  withEntry,
  type ArchiveFile,
  type CatalogClip,
  type CatalogHit,
  type LibraryEntry,
  type LibraryIndex,
} from './catalogLogic';

const INDEX_FILE = 'index.json';
const THUMBS_DIR = '.thumbs';
const FETCH_TIMEOUT_MS = 20_000;

export function libraryRoot(): string {
  return app.isPackaged
    ? join(app.getPath('userData'), 'library')
    : join(app.getAppPath(), 'assets', 'library');
}

function indexPath(): string {
  return join(libraryRoot(), INDEX_FILE);
}

let cached: LibraryIndex | null = null;

/** The index, read once and kept. Unreadable → empty, with a console line. */
export function loadLibraryIndex(): LibraryIndex {
  if (cached) return cached;
  let raw: unknown = null;
  try {
    if (existsSync(indexPath())) raw = JSON.parse(readFileSync(indexPath(), 'utf8')) as unknown;
  } catch (err) {
    console.error(`[library] index unreadable, starting empty: ${String(err)}`);
  }
  const { index, problem } = readLibraryIndex(raw);
  if (problem) console.error(`[library] ${problem} — starting empty`);
  // An entry whose file has gone (the operator tidied the folder) is dropped
  // here rather than offered to a picker and failing at the wall.
  const present = index.entries.filter((e) => existsSync(entryPath(e)));
  if (present.length !== index.entries.length) {
    console.warn(`[library] ${index.entries.length - present.length} entr(ies) point at missing files; dropped`);
  }
  cached = { ...index, entries: present };
  return cached;
}

function saveLibraryIndex(index: LibraryIndex): void {
  cached = index;
  try {
    mkdirSync(libraryRoot(), { recursive: true });
    writeFileSync(indexPath(), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error(`[library] could not write ${INDEX_FILE}: ${String(err)}`);
  }
}

/** Where an entry's bytes live on disk, from its `library://assets/...` url. */
function entryPath(entry: LibraryEntry): string {
  const rel = decodeURIComponent(entry.url.replace(/^library:\/\/assets\//, ''));
  return join(libraryRoot(), ...rel.split('/'));
}

/**
 * Resolve a `library://` request to a file on disk, or `null` when it points
 * outside the root or at nothing. `library://assets/<path>` is a downloaded
 * file; `library://thumbs/<item>.jpg` is a cached tile, fetched on first use.
 */
export async function resolveLibraryRequest(url: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const root = libraryRoot();
  const rel = decodeURIComponent(u.pathname).split('/').filter((p) => p !== '');
  if (u.host === 'assets') {
    const p = normalize(join(root, ...rel));
    if (!p.startsWith(root + sep) || !existsSync(p)) return null;
    return p;
  }
  if (u.host === 'filethumbs' && rel.length >= 2) {
    // A per-clip thumb: a file INSIDE the item, fetched from /download and
    // cached under the item's slug. Only `.jpg` names under a `.thumbs/` path
    // are fetched, so this cannot be used to pull arbitrary item files.
    const identifier = rel[0] as string;
    const thumbFile = rel.slice(1).join('/');
    if (!/\.thumbs\/[^/]+\.jpg$/i.test(thumbFile)) return null;
    const p = join(root, THUMBS_DIR, slug(identifier), `${slug(thumbFile.replace(/^.*\//, ''))}`);
    if (existsSync(p)) return p;
    return cacheFetch(archiveDownloadUrl(identifier, thumbFile), p, `filethumb ${identifier}/${thumbFile}`);
  }
  if (u.host === 'thumbs' && rel.length === 1) {
    const name = rel[0] as string;
    const identifier = name.replace(/\.jpg$/, '');
    const p = join(root, THUMBS_DIR, `${slug(identifier)}.jpg`);
    if (existsSync(p)) return p;
    return cacheFetch(archiveThumbUrl(identifier), p, `thumb ${identifier}`);
  }
  return null;
}

/** Fetch a small file into the cache, atomically. `null` on any failure, logged. */
async function cacheFetch(url: string, p: string, what: string): Promise<string | null> {
  {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok || !res.body) return null;
      mkdirSync(dirname(p), { recursive: true });
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${p}.part`));
      renameSync(`${p}.part`, p);
      return p;
    } catch (err) {
      console.warn(`[library] ${what}: ${String(err)}`);
      return null;
    }
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await net.fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Free-text search. A failure is an empty list and a console line, never a throw. */
export async function searchCatalog(query: string): Promise<CatalogHit[]> {
  const q = query.trim();
  if (q === '') return [];
  try {
    const res = await fetchWithTimeout(archiveSearchUrl(q));
    if (!res.ok) {
      console.warn(`[catalog] search "${q}": HTTP ${res.status}`);
      return [];
    }
    const hits = parseArchiveSearch((await res.json()) as unknown);
    console.log(`[catalog] search "${q}": ${hits.length} hit(s)`);
    return hits;
  } catch (err) {
    console.warn(`[catalog] search "${q}" failed: ${String(err)}`);
    return [];
  }
}

export type AddResult = { ok: true; entry: LibraryEntry } | { ok: false; reason: string };
export type FilesResult =
  | { ok: true; clips: CatalogClip[]; license: string; licenseUrl: string }
  | { ok: false; reason: string };

interface ItemMeta {
  metadata?: Record<string, unknown>;
  files?: ArchiveFile[];
}

async function readItem(identifier: string): Promise<{ meta: ItemMeta } | { reason: string }> {
  try {
    const res = await fetchWithTimeout(archiveMetadataUrl(identifier));
    if (!res.ok) return { reason: `archive.org answered HTTP ${res.status} for "${identifier}"` };
    return { meta: (await res.json()) as ItemMeta };
  } catch (err) {
    return { reason: `could not read "${identifier}": ${String(err)}` };
  }
}

/** The playable clips of one item, best first, with the item's own license reading. */
export async function listCatalogFiles(hit: CatalogHit): Promise<FilesResult> {
  const item = await readItem(hit.identifier);
  if ('reason' in item) return { ok: false, reason: item.reason };
  const files = item.meta.files ?? [];
  const clips = catalogClips(hit.identifier, files, hit.kind);
  const licenseUrlRaw = item.meta.metadata?.['licenseurl'];
  const licenseUrl = typeof licenseUrlRaw === 'string' ? licenseUrlRaw : hit.licenseUrl;
  if (clips.length === 0) {
    return {
      ok: false,
      reason:
        hit.kind === 'video'
          ? `"${hit.title}" has no MP4 the projector can play — it holds ${describeFormats(files)}`
          : `"${hit.title}" has no JPEG or PNG to bring home — it holds ${describeFormats(files)}`,
    };
  }
  return { ok: true, clips, license: licenseFromUrl(licenseUrl), licenseUrl };
}

/**
 * Bring one hit home: read the item's metadata, pick the file, build the entry
 * (which is where I-10's record is built), download to a `.part` beside the final name,
 * rename on completion, write the index. `onProgress` is called at most a few
 * times a second — never per frame, and never on any render thread; this is
 * main.
 */
export async function addFromCatalog(
  hit: CatalogHit,
  onProgress: (received: number, total: number) => void,
  fileName?: string,
): Promise<AddResult> {
  const item = await readItem(hit.identifier);
  if ('reason' in item) return { ok: false, reason: item.reason };
  const meta = item.meta;
  const files = meta.files ?? [];
  const candidates = candidateFiles(files, hit.kind);
  // A named clip must be one the item offers AND one the picker would accept
  // — the request came from the clip list, and a name that is not in it is a
  // stale or forged request, not a preference.
  const file = fileName === undefined ? (candidates[0] ?? null) : (candidates.find((f) => f.name === fileName) ?? null);
  if (!file) {
    return {
      ok: false,
      reason:
        fileName !== undefined
          ? `"${fileName}" is not a playable clip of "${hit.title}"`
          : hit.kind === 'video'
            ? `"${hit.title}" has no MP4 the projector can play — it holds ${describeFormats(files)}`
            : `"${hit.title}" has no JPEG or PNG to bring home — it holds ${describeFormats(files)}`,
    };
  }
  const itemLicense = meta.metadata?.['licenseurl'];
  const runtime = meta.metadata?.['runtime'];
  const thumb = fileThumbFor(files, file);
  const built = buildLibraryEntry({
    hit,
    file,
    itemLicenseUrl: typeof itemLicense === 'string' ? itemLicense : undefined,
    itemRuntime: typeof runtime === 'string' ? runtime : undefined,
    thumbFile: thumb?.name,
    clipCount: candidates.length,
    today: new Date().toISOString().slice(0, 10),
  });
  if ('refused' in built) return { ok: false, reason: built.refused };
  const entry = built.entry;

  const dest = join(libraryRoot(), ...catalogAssetDir(hit.source, hit.identifier).split('/'), file.name);
  const existing = loadLibraryIndex().entries.find((e) => e.id === entry.id);
  if (existing && existsSync(dest)) {
    console.log(`[catalog] ${entry.id} already in the library`);
    return { ok: true, entry: existing };
  }
  try {
    mkdirSync(dirname(dest), { recursive: true });
    const res = await net.fetch(archiveDownloadUrl(hit.identifier, file.name));
    if (!res.ok || !res.body) return { ok: false, reason: `download of "${file.name}" answered HTTP ${res.status}` };
    const total = Number(res.headers.get('content-length')) || entry.bytes;
    let received = 0;
    let lastReport = 0;
    const counting = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        const now = Date.now();
        if (now - lastReport > 200) {
          lastReport = now;
          onProgress(received, total);
        }
        controller.enqueue(chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counting) as never), createWriteStream(`${dest}.part`));
    renameSync(`${dest}.part`, dest);
    onProgress(received, total);
  } catch (err) {
    try {
      rmSync(`${dest}.part`, { force: true });
    } catch {
      // A leftover .part is untidy, not dangerous; nothing reads it.
    }
    return { ok: false, reason: `download of "${file.name}" failed: ${String(err)}` };
  }
  const bytes = (() => {
    try {
      return statSync(dest).size;
    } catch {
      return entry.bytes;
    }
  })();
  const final: LibraryEntry = { ...entry, bytes };
  saveLibraryIndex(withEntry(loadLibraryIndex(), final));
  console.log(`[catalog] added ${final.id} (${(bytes / 1048576).toFixed(1)} MB, ${final.license.license})`);
  return { ok: true, entry: final };
}

export function libraryEntries(): LibraryEntry[] {
  return loadLibraryIndex().entries;
}

export { emptyLibraryIndex };
