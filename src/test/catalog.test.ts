/**
 * The online catalog — the pure half, with no network (§8.1).
 *
 * Every decision `electron/catalog.ts` acts on is made in `catalogLogic.ts`
 * and is tested here: the search URL, the response parse, the I-10 license
 * mapping, which file of an item comes home, the entry that is built, and the
 * renderer's canonicalizer that turns that entry into an asset the library
 * will register — or refuses.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CATALOG_ALLOWED_LICENSES,
  MAX_DOWNLOAD_BYTES,
  archiveDownloadUrl,
  archiveMetadataUrl,
  archiveSearchUrl,
  buildLibraryEntry,
  candidateFiles,
  isLowRes,
  catalogAssetId,
  catalogClips,
  clipBase,
  describeFormats,
  fileThumbFor,
  libraryThumbUrl,
  licenseFromUrl,
  parseArchiveSearch,
  parseSeconds,
  pickArchiveFile,
  readLibraryIndex,
  slug,
  withEntry,
  type ArchiveFile,
  type CatalogHit,
} from '@shared/catalogLogic';
import { ALLOWED_LICENSES, AssetLibrary, LicenseError } from '../core/library';
import { LibraryEntryError, canonicalizeLibraryEntry } from '../core/libraryEntry';

const hit = (over: Partial<CatalogHit> = {}): CatalogHit => ({
  source: 'archive',
  identifier: 'vj-loop-001',
  title: 'VJ Loop 001',
  creator: 'Someone',
  kind: 'video',
  license: 'CC-BY-4.0',
  licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  downloads: 12,
  thumbUrl: libraryThumbUrl('vj-loop-001'),
  ...over,
});

describe('the Archive request URLs', () => {
  it('search restricts to movies and images and asks for the fields the parser reads', () => {
    const u = new URL(archiveSearchUrl('vj loops'));
    expect(u.origin).toBe('https://archive.org');
    expect(u.searchParams.get('q')).toBe('(vj loops) AND mediatype:(movies OR image)');
    expect(u.searchParams.getAll('fl[]')).toEqual(
      expect.arrayContaining(['identifier', 'title', 'licenseurl', 'mediatype']),
    );
    expect(u.searchParams.get('output')).toBe('json');
  });

  it('metadata and download URLs encode the identifier and the file name', () => {
    expect(archiveMetadataUrl('a b')).toBe('https://archive.org/metadata/a%20b');
    expect(archiveDownloadUrl('item', 'my loop.mp4')).toBe('https://archive.org/download/item/my%20loop.mp4');
  });
});

describe('I-10 — the license mapping refuses everything it cannot name', () => {
  it('maps CC0, CC-BY 4.0 and CC-BY 3.0', () => {
    expect(licenseFromUrl('https://creativecommons.org/publicdomain/zero/1.0/')).toBe('CC0-1.0');
    expect(licenseFromUrl('http://creativecommons.org/licenses/by/4.0/')).toBe('CC-BY-4.0');
    expect(licenseFromUrl('http://creativecommons.org/licenses/by/3.0/us/')).toBe('CC-BY-3.0');
  });

  it('refuses ShareAlike, NonCommercial, the Public Domain Mark, and nothing', () => {
    for (const u of [
      'http://creativecommons.org/licenses/by-sa/4.0/',
      'http://creativecommons.org/licenses/by-nc/3.0/',
      'http://creativecommons.org/publicdomain/mark/1.0/',
      'https://example.com/licenses/by/4.0/',
      '',
      undefined,
      null,
    ]) {
      expect(licenseFromUrl(u)).toBeNull();
    }
  });

  it('the catalog accepts a subset of what the library accepts — never more', () => {
    for (const l of CATALOG_ALLOWED_LICENSES) expect(ALLOWED_LICENSES).toContain(l);
  });
});

describe('the search response', () => {
  const json = {
    response: {
      docs: [
        { identifier: 'loop-a', title: 'Loop A', creator: ['X', 'Y'], licenseurl: 'http://creativecommons.org/publicdomain/zero/1.0/', mediatype: 'movies', downloads: 40 },
        { identifier: 'pic-b', title: 'Pic B', mediatype: 'image', downloads: '7' },
        { identifier: 'txt-c', title: 'Text', mediatype: 'texts' },
        { title: 'no identifier', mediatype: 'movies' },
      ],
    },
  };

  it('reads hits, joins array creators, maps the license, and skips what the engine cannot show', () => {
    const hits = parseArchiveSearch(json);
    expect(hits.map((h) => h.identifier)).toEqual(['loop-a', 'pic-b']);
    expect(hits[0]).toMatchObject({ kind: 'video', license: 'CC0-1.0', creator: 'X, Y', downloads: 40 });
    expect(hits[1]).toMatchObject({ kind: 'still', license: null, licenseUrl: '', downloads: 7 });
    expect(hits[0]?.thumbUrl).toBe('library://thumbs/loop-a.jpg');
  });

  it('a malformed response is no hits, not a throw', () => {
    expect(parseArchiveSearch(null)).toEqual([]);
    expect(parseArchiveSearch({ response: {} })).toEqual([]);
    expect(parseArchiveSearch('nope')).toEqual([]);
  });
});

describe('which file comes home', () => {
  const files: ArchiveFile[] = [
    { name: 'loop.mov', format: 'QuickTime', size: '900000000', source: 'original' },
    { name: 'loop.mp4', format: 'h.264', size: '12000000', length: '8.0', height: '720', source: 'derivative' },
    { name: 'loop_512kb.mp4', format: '512Kb MPEG4', size: '3000000', length: '8.0', height: '240', source: 'derivative' },
    { name: 'loop.ogv', format: 'Ogg Video', size: '5000000', source: 'derivative' },
    { name: 'loop.gif', format: 'Animated GIF', size: '400000', source: 'derivative' },
    { name: '__ia_thumb.jpg', format: 'Item Tile', size: '4000', source: 'metadata' },
  ];

  it('video: an h.264 derivative beats the 512Kb one, and the height nearest 720 rows wins', () => {
    // `loop_512kb.mp4` is smaller but is the Archive's low-quality derivative;
    // with a real h.264 present it is not the one to put on a wall.
    expect(pickArchiveFile(files, 'video')?.name).toBe('loop.mp4');
    const two = [
      ...files,
      { name: 'loop_1080.mp4', format: 'h.264 HD', size: '40000000', height: '1080', source: 'derivative' },
    ];
    expect(pickArchiveFile(two, 'video')?.name).toBe('loop.mp4');
  });

  it('W1 fix: 720 beats 240 even when 240 is the smaller file — the old rule chose 240 here', () => {
    const both: ArchiveFile[] = [
      { name: 'a_240.mp4', format: 'h.264', size: '1000', height: '240' },
      { name: 'a_720.mp4', format: 'h.264', size: '9000', height: '720' },
      { name: 'a_360.mp4', format: 'h.264', size: '3000', height: '360' },
    ];
    expect(candidateFiles(both, 'video').map((f) => f.name)).toEqual(['a_720.mp4', 'a_360.mp4', 'a_240.mp4']);
  });

  it('W1 fix: low-res is named — under 480 rows, or a _512kb derivative of unknown height', () => {
    expect(isLowRes({ name: 'x.mp4', height: '240' })).toBe(true);
    expect(isLowRes({ name: 'x.mp4', height: '480' })).toBe(false);
    expect(isLowRes({ name: 'x_512kb.mp4' })).toBe(true);
    expect(isLowRes({ name: 'x.mp4' })).toBe(false);
    const clips = catalogClips('pack-1', [{ name: 'c_512kb.mp4', format: '512Kb MPEG4', size: '300', height: '240' }], 'video');
    expect(clips[0]?.lowRes).toBe(true);
  });

  it('video: falls back to any MP4 when there is no h.264 derivative', () => {
    const only = [{ name: 'raw.mp4', format: 'MPEG4', size: '2000' }];
    expect(pickArchiveFile(only, 'video')?.name).toBe('raw.mp4');
  });

  it('video: never a file over the cap, and null when nothing qualifies', () => {
    const huge = [{ name: 'huge.mp4', format: 'h.264', size: String(MAX_DOWNLOAD_BYTES + 1) }];
    expect(pickArchiveFile(huge, 'video')).toBeNull();
    expect(pickArchiveFile([{ name: 'a.txt', size: '3' }], 'video')).toBeNull();
  });

  it('a pack comes back as a list, best first, and the picker is its head', () => {
    const pack: ArchiveFile[] = [
      { name: 'clip_b_512kb.mp4', format: '512Kb MPEG4', size: '300', length: '4.0' },
      { name: 'clip_a_512kb.mp4', format: '512Kb MPEG4', size: '200', length: '3.5' },
      { name: 'clip_a.mov', format: 'QuickTime', size: '9000', source: 'original' },
      { name: 'clip_a.gif', format: 'Animated GIF', size: '100' },
      { name: 'pack.thumbs/clip_a_000001.jpg', format: 'Thumbnail', size: '10' },
      { name: 'pack.thumbs/clip_b_000001.jpg', format: 'Thumbnail', size: '10' },
    ];
    expect(candidateFiles(pack, 'video').map((f) => f.name)).toEqual(['clip_a_512kb.mp4', 'clip_b_512kb.mp4']);
    expect(pickArchiveFile(pack, 'video')?.name).toBe('clip_a_512kb.mp4');
    const clips = catalogClips('pack-1', pack, 'video');
    expect(clips.map((c) => c.label)).toEqual(['clip_a', 'clip_b']);
    expect(clips[0]?.thumbUrl).toBe('library://filethumbs/pack-1/pack.thumbs/clip_a_000001.jpg');
    expect(clips[0]?.seconds).toBe(3.5);
  });

  it('QuickTime, Flash and GIF packs have nothing playable, and the refusal names what was there', () => {
    const mov: ArchiveFile[] = [
      { name: 'a.mov', format: 'QuickTime', size: '100' },
      { name: 'a.gif', format: 'Animated GIF', size: '10' },
      { name: 'x.thumbs/a_000001.jpg', format: 'Thumbnail', size: '1' },
      { name: 'x_meta.xml', format: 'Metadata', size: '1' },
    ];
    expect(candidateFiles(mov, 'video')).toEqual([]);
    expect(describeFormats(mov)).toBe('1× QuickTime, 1× Animated GIF');
    expect(candidateFiles([{ name: 'a.flv', format: 'Flash Video', size: '5' }], 'video')).toEqual([]);
  });

  it('the per-clip thumb is matched on the clip base, without the derivative suffix', () => {
    expect(clipBase('foo_512kb.mp4')).toBe('foo');
    expect(clipBase('dir/bar.h264.mp4')).toBe('bar');
    const files: ArchiveFile[] = [
      { name: 'p.thumbs/foo_000001.jpg' },
      { name: 'p.thumbs/foo_000002.jpg' },
      { name: 'p.thumbs/foobar_000001.jpg' },
    ];
    expect(fileThumbFor(files, { name: 'foo_512kb.mp4' })?.name).toBe('p.thumbs/foo_000001.jpg');
    expect(fileThumbFor(files, { name: 'nothing.mp4' })).toBeNull();
  });

  it('still: the original JPEG or PNG, largest first — never an item thumb', () => {
    const withThumb: ArchiveFile[] = [
      { name: 'x.thumbs/orig_000001.jpg', format: 'Thumbnail', size: '99999', source: 'derivative' },
      { name: 'orig.jpg', format: 'JPEG', size: '9000', source: 'original' },
    ];
    expect(pickArchiveFile(withThumb, 'still')?.name).toBe('orig.jpg');
  });

  it('still: the original JPEG or PNG, largest first', () => {
    const imgs: ArchiveFile[] = [
      { name: 'small.jpg', format: 'JPEG Thumb', size: '100', source: 'derivative' },
      { name: 'big.png', format: 'PNG', size: '5000', source: 'original' },
      { name: 'orig.jpg', format: 'JPEG', size: '9000', source: 'original' },
    ];
    expect(pickArchiveFile(imgs, 'still')?.name).toBe('orig.jpg');
  });
});

describe('durations, slugs and ids', () => {
  it('parses seconds from a decimal string, m:ss, and h:mm:ss, falling back to 4', () => {
    expect(parseSeconds('8.5')).toBe(8.5);
    expect(parseSeconds('0:12')).toBe(12);
    expect(parseSeconds('1:02:03')).toBe(3723);
    expect(parseSeconds('')).toBe(4);
    expect(parseSeconds(undefined)).toBe(4);
    expect(parseSeconds('0')).toBe(4);
  });

  it('slug keeps only [A-Za-z0-9_.-] and the id is stable for one file of one item', () => {
    expect(slug('My Loop (final)!!')).toBe('My-Loop-final');
    expect(catalogAssetId('archive', 'vj loops 2', 'clip 01.mp4')).toBe('archive.vj-loops-2.clip-01');
    expect(catalogAssetId('archive', 'x', 'a.mp4')).toBe(catalogAssetId('archive', 'x', 'a.mp4'));
  });
});

describe('the entry that is built', () => {
  const file: ArchiveFile = { name: 'loop_512kb.mp4', format: '512Kb MPEG4', size: '3000000', length: '8.0' };

  it('a CC-BY video: attribution required and named, poster from the thumb cache, loop from the file', () => {
    const r = buildLibraryEntry({ hit: hit(), file, today: '2026-09-07' });
    expect('entry' in r).toBe(true);
    if (!('entry' in r)) return;
    expect(r.entry).toMatchObject({
      id: 'archive.vj-loop-001.loop_512kb',
      kind: 'video',
      url: 'library://assets/archive/vj-loop-001/loop_512kb.mp4',
      posterUrl: 'library://thumbs/vj-loop-001.jpg',
      loopSeconds: 8,
      seamless: true,
      bytes: 3000000,
      license: {
        license: 'CC-BY-4.0',
        attributionRequired: true,
        attribution: 'Someone',
        retrievedAt: '2026-09-07',
        source: 'https://archive.org/details/vj-loop-001',
      },
    });
  });

  it('a clip of a pack takes the clip\'s thumb as its poster and the clip\'s name in its label', () => {
    const r = buildLibraryEntry({
      hit: hit(),
      file,
      thumbFile: 'pack.thumbs/loop_000001.jpg',
      clipCount: 57,
      today: '2026-09-07',
    });
    if (!('entry' in r)) throw new Error(r.refused);
    expect(r.entry.posterUrl).toBe('library://filethumbs/vj-loop-001/pack.thumbs/loop_000001.jpg');
    expect(r.entry.name).toBe('loop · VJ Loop 001');
  });

  it('a CC0 still: no attribution required, no poster, no loop', () => {
    const r = buildLibraryEntry({
      hit: hit({ kind: 'still', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }),
      file: { name: 'pic.png', size: '500' },
      today: '2026-09-07',
    });
    if (!('entry' in r)) throw new Error(r.refused);
    expect(r.entry.kind).toBe('still');
    expect(r.entry.license.attributionRequired).toBe(false);
    expect(r.entry.license.attribution).toBeUndefined();
    expect(r.entry.posterUrl).toBeUndefined();
  });

  it('the item metadata license wins over the search doc', () => {
    const r = buildLibraryEntry({
      hit: hit({ license: null, licenseUrl: '' }),
      file,
      itemLicenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      today: '2026-09-07',
    });
    if (!('entry' in r)) throw new Error(r.refused);
    expect(r.entry.license.license).toBe('CC0-1.0');
  });

  it('refuses, in words, an item with no usable license — before a byte is downloaded (I-10)', () => {
    const r = buildLibraryEntry({
      hit: hit({ license: null, licenseUrl: 'http://creativecommons.org/licenses/by-nc/4.0/' }),
      file,
      today: '2026-09-07',
    });
    expect('refused' in r && r.refused).toMatch(/by-nc.*I-10/);
  });

  it('refuses a file over the cap, naming the size', () => {
    const r = buildLibraryEntry({ hit: hit(), file: { name: 'x.mp4', size: String(MAX_DOWNLOAD_BYTES + 1) }, today: '2026-09-07' });
    expect('refused' in r && r.refused).toMatch(/over the 250 MB cap/);
  });
});

describe('the receiving side — canonicalizeLibraryEntry and the library door', () => {
  const built = (): unknown => {
    const r = buildLibraryEntry({
      hit: hit(),
      file: { name: 'loop.mp4', size: '100', length: '6' },
      today: '2026-09-07',
    });
    if (!('entry' in r)) throw new Error(r.refused);
    return JSON.parse(JSON.stringify(r.entry));
  };

  it('what main builds, the renderer registers — the two shapes agree end to end', () => {
    const lib = new AssetLibrary();
    const asset = lib.register(canonicalizeLibraryEntry(built()));
    expect(asset.kind).toBe('video');
    expect(asset.license.license).toBe('CC-BY-4.0');
    expect(lib.get('archive.vj-loop-001.loop')?.url).toBe('library://assets/archive/vj-loop-001/loop.mp4');
  });

  it('refuses a url that is not library:// — a byte must not arrive any other way (I-7)', () => {
    const e = built() as Record<string, unknown>;
    e['url'] = 'https://archive.org/download/x/y.mp4';
    expect(() => canonicalizeLibraryEntry(e)).toThrow(/library:\/\//);
    e['url'] = 'file:///tmp/y.mp4';
    expect(() => canonicalizeLibraryEntry(e)).toThrow(LibraryEntryError);
  });

  it('refuses a video with no poster (I-13 needs the middle rung) and an unknown kind', () => {
    const e = built() as Record<string, unknown>;
    delete e['posterUrl'];
    expect(() => canonicalizeLibraryEntry(e)).toThrow(/posterUrl/);
    expect(() => canonicalizeLibraryEntry({ ...(built() as object), kind: 'lottie' })).toThrow(/kind/);
  });

  it('a missing or malformed license is refused by the library door, not papered over', () => {
    const e = built() as Record<string, unknown>;
    e['license'] = { source: 'https://archive.org/details/x', license: 'WTFPL', attributionRequired: false, retrievedAt: '2026-09-07' };
    const lib = new AssetLibrary();
    expect(() => lib.register(canonicalizeLibraryEntry(e))).toThrow(LicenseError);
    delete e['license'];
    expect(() => canonicalizeLibraryEntry(e)).toThrow(/license record/);
  });
});

describe('the index file', () => {
  it('reads empty for nothing, refuses a newer version, and replaces by id', () => {
    expect(readLibraryIndex(null).index.entries).toEqual([]);
    expect(readLibraryIndex({ version: 99, entries: [] }).problem).toMatch(/newer/);
    const a = { id: 'a' } as never;
    const a2 = { id: 'a', name: 'again' } as never;
    const idx = withEntry(withEntry(readLibraryIndex(null).index, a), a2);
    expect(idx.entries).toEqual([a2]);
  });
});

describe('the renderers may load library:// and nothing else new', () => {
  it('both windows allow the library scheme for images, media and fetch — and no remote host', () => {
    for (const file of ['../editor/index.html', '../output/index.html']) {
      const html = readFileSync(new URL(file, import.meta.url), 'utf8');
      const csp = /Content-Security-Policy"\s*content="([^"]+)"/.exec(html)?.[1] ?? '';
      for (const directive of ['img-src', 'media-src', 'connect-src']) {
        const value = new RegExp(`${directive} ([^;]+)`).exec(csp)?.[1] ?? '';
        expect(value, `${file} ${directive}`).toContain('library:');
        expect(value, `${file} ${directive} must not reach archive.org directly`).not.toContain('archive.org');
        expect(value).not.toMatch(/https:/);
      }
    }
  });
});
