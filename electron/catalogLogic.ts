/**
 * The online catalog — the PURE half (SPEC.md §12's "catalog APIs", pulled
 * forward at the operator's request; see BUILD_LOG.md SPEC-CHANGE-PROPOSED).
 *
 * Nothing in this file touches the network, the disk or Electron. It builds
 * the request URLs, reads the responses, decides which file of an item is the
 * one worth downloading, and turns what it learned into a `LibraryEntry` that
 * the renderers' `AssetLibrary` will accept — or refuses, naming why. That
 * split is what lets the unit suite cover every decision here without a
 * network (§8.1), and what keeps `catalog.ts` down to fetch-and-write.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE INTERNET ARCHIVE.
 *
 * It is the one catalog with a keyless JSON search API, per-item license
 * metadata (`licenseurl`), and a large body of CC0 / CC-BY VJ loops and
 * abstract animation. Every other candidate (Pexels, Pixabay, LottieFiles,
 * Giphy) needs an API key the builder would have to obtain and store. The
 * source is behind `CatalogSource` so a keyed one can be added beside it.
 *
 * I-10 IS SATISFIED HERE, BEFORE A BYTE IS DOWNLOADED.
 *
 * `licenseFromUrl` maps the Archive's `licenseurl` onto a license NAME.
 * Every Creative Commons variant and the Public Domain Mark map by name; a
 * URL this code cannot read, or no URL at all, maps to `unverified`. Nothing
 * is refused on its license any more (operator, 2026-09-07: 34 of 40 results
 * were dead buttons) — what I-10 asks for is that every asset carries a
 * record, and every entry built here does: the name as the source stated it,
 * the raw URL kept beside it in the results so the operator can read what
 * the name means, attribution required for everything but CC0, and the
 * creator named. `AssetLibrary.register` still refuses a record with a
 * missing field; that is the invariant, and it is unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The license names this mapping can produce. A subset of `core/library.ts`'s list. Mirrored, not imported — see `ipc.ts`'s header. */
export const CATALOG_ALLOWED_LICENSES = [
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-3.0',
  'CC-BY-SA-4.0',
  'CC-BY-SA-3.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-3.0',
  'CC-BY-NC-SA-4.0',
  'CC-BY-NC-SA-3.0',
  'CC-BY-ND-4.0',
  'CC-BY-ND-3.0',
  'CC-BY-NC-ND-4.0',
  'CC-BY-NC-ND-3.0',
  'PDM-1.0',
  'unverified',
] as const;
/** The names under which the source grants reuse without a further condition the operator has to read. Shown green; the rest amber. */
export const CATALOG_OPEN_LICENSES: readonly CatalogLicense[] = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'PDM-1.0'];
export type CatalogLicense = (typeof CATALOG_ALLOWED_LICENSES)[number];

export const CATALOG_SOURCES = ['archive'] as const;
export type CatalogSource = (typeof CATALOG_SOURCES)[number];

/** What the catalog can bring home. Video loops and stills; Lottie needs a keyed source. */
export type CatalogKind = 'video' | 'still';

/** One search result, as the editor lists it. JSON only (I-7). */
export interface CatalogHit {
  source: CatalogSource;
  /** The Archive item identifier. Stable; the download and the thumbnail key off it. */
  identifier: string;
  title: string;
  creator: string;
  kind: CatalogKind;
  /** Mapped from `licenseurl`; `unverified` when the URL names nothing this code reads (I-10: a record, always). */
  license: CatalogLicense;
  /** The raw license URL, so the operator can read what the name means. */
  licenseUrl: string;
  downloads: number;
  /** Served by the `library:` protocol from a disk cache — never bytes over IPC. */
  thumbUrl: string;
}

/** One asset in `assets/library/index.json`, and what crosses IPC to the renderers. */
export interface LibraryEntry {
  id: string;
  name: string;
  kind: CatalogKind;
  /** `library://assets/<dir>/<file>` — resolved by main's protocol handler. */
  url: string;
  /** Video only. `library://thumbs/<identifier>.jpg`. */
  posterUrl?: string;
  /** Video only. Seconds. */
  loopSeconds?: number;
  /** Video only. VJ loops are cut to loop; assumed true, editable per layer. */
  seamless?: boolean;
  /** I-10's record, in `core/library.ts`'s shape. */
  license: {
    source: string;
    license: CatalogLicense;
    attributionRequired: boolean;
    retrievedAt: string;
    attribution?: string;
  };
  origin: { source: CatalogSource; identifier: string; file: string };
  bytes: number;
}

/** A file inside an Archive item, as `/metadata/<id>` lists it. */
export interface ArchiveFile {
  name: string;
  format?: string;
  size?: string | number;
  /** Seconds, as a string ("12.34") for media derivatives. */
  length?: string | number;
  source?: 'original' | 'derivative' | 'metadata' | string;
  width?: string | number;
  height?: string | number;
}

export const ARCHIVE_BASE = 'https://archive.org';
export const ARCHIVE_SEARCH_ROWS = 40;

/** The largest file the catalog will bring home. A VJ loop over this is a film. */
export const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;

/**
 * The advanced-search URL for a free-text query, restricted to movies and
 * images and sorted by downloads so the useful loops come first.
 */
export function archiveSearchUrl(query: string, rows = ARCHIVE_SEARCH_ROWS): string {
  const q = `(${query.trim()}) AND mediatype:(movies OR image)`;
  const p = new URLSearchParams();
  p.set('q', q);
  for (const f of ['identifier', 'title', 'creator', 'licenseurl', 'mediatype', 'downloads']) {
    p.append('fl[]', f);
  }
  p.append('sort[]', 'downloads desc');
  p.set('rows', String(rows));
  p.set('page', '1');
  p.set('output', 'json');
  return `${ARCHIVE_BASE}/advancedsearch.php?${p.toString()}`;
}

export function archiveMetadataUrl(identifier: string): string {
  return `${ARCHIVE_BASE}/metadata/${encodeURIComponent(identifier)}`;
}

export function archiveDownloadUrl(identifier: string, file: string): string {
  return `${ARCHIVE_BASE}/download/${encodeURIComponent(identifier)}/${encodeURI(file)}`;
}

export function archiveThumbUrl(identifier: string): string {
  return `${ARCHIVE_BASE}/services/img/${encodeURIComponent(identifier)}`;
}

/** The URL the renderer loads a cached item tile from. Main serves it; no bytes cross IPC. */
export function libraryThumbUrl(identifier: string): string {
  return `library://thumbs/${encodeURIComponent(identifier)}.jpg`;
}

/**
 * The URL the renderer loads a cached PER-FILE thumbnail from. The Archive
 * renders one for every video derivative it makes, as a file inside the item
 * (`<item>.thumbs/<clip>_000001.jpg`); main fetches it on first view and
 * caches it beside the item tile.
 */
export function libraryFileThumbUrl(identifier: string, thumbFile: string): string {
  return `library://filethumbs/${encodeURIComponent(identifier)}/${encodeURI(thumbFile)}`;
}

/**
 * One playable clip of an item, as the editor lists it when an item holds
 * several — which on the Archive is the norm: a "VJ loops" item is a pack of
 * fifty to a hundred clips, and "the smallest MP4 in the pack" is not a
 * choice anybody meant to make.
 */
export interface CatalogClip {
  /** The file name inside the item — what `CatalogAddRequest.file` names. */
  name: string;
  bytes: number;
  /** Seconds when the Archive states a length; 0 when it does not. */
  seconds: number;
  width: number;
  height: number;
  /** `library://filethumbs/...` when the item carries a thumb for this clip; else the item tile. */
  thumbUrl: string;
  /** The clip's base name without the derivative suffix, for the label. */
  label: string;
  /** W1 fix: under 480 rows (or a `_512kb` derivative of unknown height). Shown before the download. */
  lowRes: boolean;
}

/**
 * I-10's mapping: a URL to the NAME the record carries. Every Creative
 * Commons license and the Public Domain Mark map to their SPDX name; a URL
 * that names nothing this code reads, a non-CC URL, or no URL, is recorded
 * as `unverified`. Never `null` — every hit can become a record.
 */
export function licenseFromUrl(licenseUrl: string | undefined | null): CatalogLicense {
  if (typeof licenseUrl !== 'string') return 'unverified';
  const u = licenseUrl.toLowerCase();
  if (!u.includes('creativecommons.org')) return 'unverified';
  if (u.includes('/publicdomain/zero/1.0')) return 'CC0-1.0';
  if (u.includes('/publicdomain/mark/1.0')) return 'PDM-1.0';
  const m = /\/licenses\/(by(?:-nc)?(?:-sa|-nd)?)\/([34])\.0/.exec(u);
  if (!m) return 'unverified';
  const name = `CC-${m[1]!.toUpperCase()}-${m[2]}.0`;
  return (CATALOG_ALLOWED_LICENSES as readonly string[]).includes(name) ? (name as CatalogLicense) : 'unverified';
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ');
  if (typeof v === 'number') return String(v);
  return '';
}

/**
 * The search response, read into hits. Tolerant of the Archive's habit of
 * returning a field as either a string or an array. A doc with no identifier
 * is skipped; an unknown mediatype is skipped — the query asked for movies
 * and images, and anything else is not something this engine can show.
 */
export function parseArchiveSearch(json: unknown): CatalogHit[] {
  const docs = (json as { response?: { docs?: unknown } } | null)?.response?.docs;
  if (!Array.isArray(docs)) return [];
  const out: CatalogHit[] = [];
  for (const d of docs) {
    if (typeof d !== 'object' || d === null) continue;
    const o = d as Record<string, unknown>;
    const identifier = asString(o['identifier']);
    if (identifier === '') continue;
    const mediatype = asString(o['mediatype']);
    const kind: CatalogKind | null =
      mediatype === 'movies' ? 'video' : mediatype === 'image' ? 'still' : null;
    if (kind === null) continue;
    const licenseUrl = asString(o['licenseurl']);
    const downloadsRaw = o['downloads'];
    out.push({
      source: 'archive',
      identifier,
      title: asString(o['title']) || identifier,
      creator: asString(o['creator']),
      kind,
      license: licenseFromUrl(licenseUrl),
      licenseUrl,
      downloads: typeof downloadsRaw === 'number' ? downloadsRaw : Number(downloadsRaw) || 0,
      thumbUrl: libraryThumbUrl(identifier),
    });
  }
  return out;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const VIDEO_FORMATS = ['h.264', 'h.264 ia', 'mpeg4', '512kb mpeg4', 'h.264 hd'];
const IMAGE_FORMATS = ['jpeg', 'png', 'jpg'];

const ext = (name: string): string => name.toLowerCase().replace(/^.*\./, '');

/**
 * Every file of an item that could come home, best first.
 *
 * Video: MP4s the `<video>` element will play — an `h.264` derivative when
 * there is one (the Archive transcodes to it, and it is the browser-safe one)
 * ranked before any other MP4, and within a rank the SMALLEST file at or
 * above 240 px tall when heights are known, because a projector shows 720
 * rows and a 4K original costs a decoder four times the work for pixels
 * nobody sees. Files over `MAX_DOWNLOAD_BYTES` never qualify. QuickTime, Flash,
 * Ogg and GIF never qualify either: Chromium has no decoder for PhotoJPEG
 * `.mov` and this engine has no GIF player, so offering them would be a
 * download that ends in a placeholder.
 *
 * Still: the ORIGINAL JPEG or PNG, largest first — a still is one texture and
 * the original is the one whose license the item states.
 *
 * A pack of clips comes back as a list in a stable order, so the editor can
 * show them and the operator can pick one; `pickArchiveFile` is its head.
 */
/**
 * W1 fix. A file the builder will see as "really low quality" on a 720-row
 * projector: under 480 rows when the height is known, or one of the Archive's
 * `_512kb` derivatives when it is not. Named so the drawer can SAY it before
 * the download — the FREE_VJ_LOOPS pack is 320×240 at the source, originals
 * included, and no ranking could have found a sharper file in it.
 */
export const LOW_RES_ROWS = 480;
export function isLowRes(f: Pick<ArchiveFile, 'name' | 'height'>): boolean {
  const h = num(f.height);
  if (h > 0) return h < LOW_RES_ROWS;
  return /_512kb\.mp4$/i.test(f.name);
}

export function candidateFiles(files: readonly ArchiveFile[], kind: CatalogKind): ArchiveFile[] {
  if (kind === 'video') {
    const mp4s = files.filter(
      (f) =>
        (ext(f.name) === 'mp4' || VIDEO_FORMATS.includes((f.format ?? '').toLowerCase())) &&
        ext(f.name) !== 'ogv' &&
        num(f.size) > 0 &&
        num(f.size) <= MAX_DOWNLOAD_BYTES,
    );
    // W1 fix. Was: within a rank, the SMALLEST file at or above 240 px. On a
    // 720-row projector that chose 240p over 720p every time a pack offered
    // both. Now: the height nearest 720 rows wins, a low-res file (`isLowRes`)
    // ranks after any that is not, and a pack's clips keep a stable name order.
    const rank = (f: ArchiveFile): number => {
      const h264 = (f.format ?? '').toLowerCase().startsWith('h.264') ? 0 : 1;
      return h264 * 2 + (isLowRes(f) ? 1 : 0);
    };
    const nearness = (f: ArchiveFile): number => (num(f.height) === 0 ? 360 : Math.abs(num(f.height) - 720));
    return mp4s.slice().sort((a, b) => rank(a) - rank(b) || nearness(a) - nearness(b) || a.name.localeCompare(b.name));
  }
  const images = files.filter(
    (f) =>
      (IMAGE_FORMATS.includes(ext(f.name)) || IMAGE_FORMATS.includes((f.format ?? '').toLowerCase())) &&
      !/\.thumbs\//.test(f.name) &&
      num(f.size) > 0 &&
      num(f.size) <= MAX_DOWNLOAD_BYTES,
  );
  const originals = images.filter((f) => f.source === 'original');
  const pool = originals.length > 0 ? originals : images;
  return pool.slice().sort((a, b) => num(b.size) - num(a.size) || a.name.localeCompare(b.name));
}

/** The best single file, or `null` when nothing qualifies. `candidateFiles`' head. */
export function pickArchiveFile(files: readonly ArchiveFile[], kind: CatalogKind): ArchiveFile | null {
  return candidateFiles(files, kind)[0] ?? null;
}

/** The formats an item holds, for a refusal that says what WAS there. */
export function describeFormats(files: readonly ArchiveFile[]): string {
  const counts = new Map<string, number>();
  for (const f of files) {
    const k = f.format ?? ext(f.name) ?? '?';
    if (/thumbnail|item tile|metadata|torrent/i.test(k)) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${n}× ${k}`).join(', ') || 'no media files';
}

/**
 * The Archive's per-clip thumbnail for a derivative, when the item has one:
 * `<anything>.thumbs/<clip base>_000001.jpg`. The base is the clip's name
 * without its derivative suffix (`_512kb`) and extension, because the thumbs
 * are made from the ORIGINAL and named after it.
 */
export function fileThumbFor(files: readonly ArchiveFile[], file: ArchiveFile): ArchiveFile | null {
  const base = clipBase(file.name).toLowerCase();
  const thumbs = files.filter((f) => /\.thumbs\/.+\.jpg$/i.test(f.name));
  const exact = thumbs.filter((f) => {
    const leaf = f.name.replace(/^.*\//, '').toLowerCase();
    return leaf.startsWith(`${base}_`) || leaf === `${base}.jpg`;
  });
  if (exact.length === 0) return null;
  return exact.slice().sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}

/** `foo_512kb.mp4` → `foo`; `bar.h264.mp4` → `bar`. */
export function clipBase(name: string): string {
  return name
    .replace(/^.*\//, '')
    .replace(/\.[^.]+$/, '')
    .replace(/(_512kb|_h264|\.h264|\.ia|_ia)$/i, '');
}

/** The clips of an item, for the editor's clip list. */
export function catalogClips(identifier: string, files: readonly ArchiveFile[], kind: CatalogKind): CatalogClip[] {
  return candidateFiles(files, kind).map((f) => {
    const thumb = fileThumbFor(files, f);
    return {
      name: f.name,
      bytes: num(f.size),
      seconds: parseSeconds(f.length, 0),
      width: num(f.width),
      height: num(f.height),
      thumbUrl: thumb ? libraryFileThumbUrl(identifier, thumb.name) : libraryThumbUrl(identifier),
      label: clipBase(f.name),
      lowRes: isLowRes(f),
    };
  });
}

/** Seconds from a file's `length` ("12.34" or "0:12"), or from an item runtime. Falls back to 4. */
export function parseSeconds(v: unknown, fallback = 4): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : fallback;
  }
  const parts = s.split(':').map((p) => Number(p));
  if (parts.length >= 2 && parts.every((p) => Number.isFinite(p))) {
    const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
    return secs > 0 ? secs : fallback;
  }
  return fallback;
}

/** A filesystem- and id-safe slug: `[A-Za-z0-9_.-]`, collapsed, trimmed. */
export function slug(s: string): string {
  return s
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}

/** The library id for one file of one item. Stored in scene JSON, so it must be stable. */
export function catalogAssetId(source: CatalogSource, identifier: string, file: string): string {
  return `${source}.${slug(identifier)}.${slug(file.replace(/\.[^.]+$/, ''))}`;
}

/** The directory (under the library root) one item's files live in. */
export function catalogAssetDir(source: CatalogSource, identifier: string): string {
  return `${source}/${slug(identifier)}`;
}

export interface BuildEntryInput {
  hit: CatalogHit;
  file: ArchiveFile;
  /** `metadata.licenseurl` from the item, which is authoritative over the search doc's. */
  itemLicenseUrl?: string | undefined;
  itemRuntime?: string | undefined;
  /** The item's per-clip thumb for `file`, when it has one (`fileThumbFor`). Video poster. */
  thumbFile?: string | undefined;
  /** How many clips the item offered — a pack's entry is named after its clip, not the pack. */
  clipCount?: number | undefined;
  /** ISO YYYY-MM-DD. Injected so a test can pin it. */
  today: string;
}

/**
 * The entry the renderers will register — or a refusal in words.
 *
 * Refused, never guessed: a file with no name, a file over the cap. The
 * license is never a refusal (see the header): the record carries the name
 * the source stated, or `unverified`. `attributionRequired` is what the
 * license SAYS — only CC0 waives it; everything else, `unverified` included,
 * names the creator — and never an inference from the name alone.
 */
export function buildLibraryEntry(input: BuildEntryInput): { entry: LibraryEntry } | { refused: string } {
  const { hit, file } = input;
  const licenseUrl = input.itemLicenseUrl || hit.licenseUrl;
  const license = licenseFromUrl(licenseUrl);
  if (!file.name) return { refused: `"${hit.title}" has no downloadable file` };
  const bytes = num(file.size);
  if (bytes > MAX_DOWNLOAD_BYTES) {
    return { refused: `"${file.name}" is ${(bytes / 1048576).toFixed(0)} MB, over the ${MAX_DOWNLOAD_BYTES / 1048576} MB cap` };
  }
  const attributionRequired = license !== 'CC0-1.0';
  const attribution = hit.creator || hit.identifier;
  const id = catalogAssetId(hit.source, hit.identifier, file.name);
  const dir = catalogAssetDir(hit.source, hit.identifier);
  const name =
    (input.clipCount ?? 1) > 1 ? `${clipBase(file.name)} · ${hit.title}`.slice(0, 80) : hit.title.slice(0, 80);
  const base: LibraryEntry = {
    id,
    name,
    kind: hit.kind,
    url: `library://assets/${dir}/${encodeURIComponent(file.name)}`,
    license: {
      source: `${ARCHIVE_BASE}/details/${encodeURIComponent(hit.identifier)}`,
      license,
      attributionRequired,
      retrievedAt: input.today,
      ...(attributionRequired ? { attribution } : {}),
    },
    origin: { source: hit.source, identifier: hit.identifier, file: file.name },
    bytes,
  };
  if (hit.kind === 'video') {
    return {
      entry: {
        ...base,
        posterUrl: input.thumbFile
          ? libraryFileThumbUrl(hit.identifier, input.thumbFile)
          : libraryThumbUrl(hit.identifier),
        loopSeconds: parseSeconds(file.length ?? input.itemRuntime),
        seamless: true,
      },
    };
  }
  return { entry: base };
}

/**
 * The index file's shape. Versioned like every other file this project
 * writes; a newer version is refused rather than misread.
 */
export const LIBRARY_INDEX_VERSION = 1;

export interface LibraryIndex {
  version: number;
  entries: LibraryEntry[];
}

export function emptyLibraryIndex(): LibraryIndex {
  return { version: LIBRARY_INDEX_VERSION, entries: [] };
}

/** Read an index from disk JSON. Unreadable or newer → empty, with a reason. */
export function readLibraryIndex(raw: unknown): { index: LibraryIndex; problem: string | null } {
  if (raw === null || raw === undefined) return { index: emptyLibraryIndex(), problem: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { index: emptyLibraryIndex(), problem: 'index is not an object' };
  }
  const o = raw as Record<string, unknown>;
  const version = typeof o['version'] === 'number' ? o['version'] : 0;
  if (version > LIBRARY_INDEX_VERSION) {
    return {
      index: emptyLibraryIndex(),
      problem: `index v${version} is newer than this build understands (v${LIBRARY_INDEX_VERSION})`,
    };
  }
  const entries = Array.isArray(o['entries'])
    ? (o['entries'].filter(
        (e) => typeof e === 'object' && e !== null && typeof (e as LibraryEntry).id === 'string',
      ) as LibraryEntry[])
    : [];
  return { index: { version: LIBRARY_INDEX_VERSION, entries }, problem: null };
}

/** Add or replace an entry by id. Pure. */
export function withEntry(index: LibraryIndex, entry: LibraryEntry): LibraryIndex {
  const rest = index.entries.filter((e) => e.id !== entry.id);
  return { version: LIBRARY_INDEX_VERSION, entries: [...rest, entry] };
}
