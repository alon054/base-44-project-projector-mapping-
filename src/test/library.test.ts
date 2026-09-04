/**
 * I-10 — the asset library, and the enforcement that makes it an invariant.
 *
 * "No asset enters the library without one. **This is enforced at the library
 * API level, not by discipline.**" Every rejection below is that clause being
 * true rather than intended. A test suite that only checked the happy path
 * would be checking that the manifest is currently correct, which is a fact
 * about today, not a property of the system.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_LICENSES,
  ASSET_KINDS,
  AssetLibrary,
  LicenseError,
  validateLicense,
  type BundledAsset,
  type LicenseRecord,
} from '../core/library';
import { BUNDLED_ASSETS, createBundledLibrary } from '../providers/bundled/manifest';

const GOOD: LicenseRecord = {
  source: 'https://example.org/pack',
  license: 'CC0-1.0',
  attributionRequired: false,
  retrievedAt: '2026-09-04',
};

const asset = (over: Partial<BundledAsset> = {}): BundledAsset =>
  ({
    id: 'test.asset',
    name: 'Test',
    kind: 'still',
    url: 'blob:test',
    license: GOOD,
    ...over,
  }) as BundledAsset;

describe('I-10 — a license record is mandatory, at the API', () => {
  it('accepts a complete record', () => {
    const lib = new AssetLibrary();
    expect(() => lib.register(asset())).not.toThrow();
    expect(lib.size).toBe(1);
  });

  it('refuses an asset with no license record at all', () => {
    const lib = new AssetLibrary();
    expect(() => lib.register(asset({ license: undefined as never }))).toThrow(LicenseError);
    // And it is not half-registered. A refusal that leaves the asset reachable
    // would be worse than no check.
    expect(lib.size).toBe(0);
    expect(lib.get('test.asset')).toBeUndefined();
  });

  it('refuses a source that is not a resolvable URL', () => {
    // "Kenney" is not a source; a link that still answers in three years is.
    expect(() => validateLicense('x', { ...GOOD, source: 'Kenney' })).toThrow(/resolvable URL/);
    expect(() => validateLicense('x', { ...GOOD, source: '' })).toThrow(/source is missing/);
  });

  it('refuses a license name that is not on the allowed list', () => {
    expect(() => validateLicense('x', { ...GOOD, license: 'CC0' })).toThrow(/must be one of/);
    expect(() => validateLicense('x', { ...GOOD, license: 'proprietary' })).toThrow(/must be one of/);
    // A prose paragraph is checkable by reading it; a name is checkable.
    expect(() =>
      validateLicense('x', { ...GOOD, license: 'You may use these assets freely' }),
    ).toThrow(/must be one of/);
  });

  it('refuses attributionRequired that is not an explicit boolean', () => {
    // Never inferred from the license name: a per-file license (LottieFiles,
    // D7) varies file by file within one source.
    expect(() => validateLicense('x', { ...GOOD, attributionRequired: undefined })).toThrow(
      /explicit boolean/,
    );
    expect(() => validateLicense('x', { ...GOOD, attributionRequired: 'yes' })).toThrow(
      /explicit boolean/,
    );
  });

  it('refuses a retrievedAt that is not an ISO date', () => {
    // D7 wants a terms re-check before Phase 8, and a re-check needs to know
    // what date the old terms were.
    expect(() => validateLicense('x', { ...GOOD, retrievedAt: 'yesterday' })).toThrow(/ISO/);
    expect(() => validateLicense('x', { ...GOOD, retrievedAt: '04/09/2026' })).toThrow(/ISO/);
    expect(() => validateLicense('x', { ...GOOD, retrievedAt: '' })).toThrow(/ISO/);
  });

  it('refuses an attribution-required asset with nobody named', () => {
    // The one failure mode a license record can have while looking complete.
    expect(() =>
      validateLicense('x', { ...GOOD, attributionRequired: true }),
    ).toThrow(/no attribution is named/);
    expect(() =>
      validateLicense('x', { ...GOOD, attributionRequired: true, attribution: '' }),
    ).toThrow(/no attribution is named/);
    expect(() =>
      validateLicense('x', { ...GOOD, attributionRequired: true, attribution: 'Someone' }),
    ).not.toThrow();
  });

  it('refuses a duplicate id, an empty id, an unknown kind and a missing url', () => {
    const lib = new AssetLibrary();
    lib.register(asset());
    expect(() => lib.register(asset())).toThrow(/already registered/);
    expect(() => lib.register(asset({ id: '' }))).toThrow(LicenseError);
    expect(() => lib.register(asset({ id: 'k', kind: 'movie' as never }))).toThrow(/unknown asset kind/);
    expect(() => lib.register(asset({ id: 'u', url: '' }))).toThrow(/url is missing/);
  });

  it('stores a canonicalized copy, not the caller’s object', () => {
    const lib = new AssetLibrary();
    const original = asset({ license: { ...GOOD, attribution: 'Someone' } });
    lib.register(original);
    // Mutating what the caller still holds must not change the library. A
    // license record that can be edited after registration is not enforcement.
    (original.license as { license: string }).license = 'proprietary';
    expect(lib.get('test.asset')?.license.license).toBe('CC0-1.0');
  });

  it('enumerates stably and reports what must be credited', () => {
    const lib = new AssetLibrary();
    lib.register(asset({ id: 'b' }));
    lib.register(asset({ id: 'a' }));
    lib.register(
      asset({ id: 'c', license: { ...GOOD, attributionRequired: true, attribution: 'A Person' } }),
    );
    expect(lib.ids()).toEqual(['a', 'b', 'c']);
    // Empty for a CC0-only library, and being able to STATE that is the point.
    expect(lib.attributions()).toEqual([
      { id: 'c', attribution: 'A Person', source: 'https://example.org/pack' },
    ]);
  });
});

/**
 * The shipped manifest. These are assertions about the actual bundled library,
 * so a future asset added without a record fails here as well as at the API.
 */
describe('the bundled manifest (D6, D7)', () => {
  it('builds without throwing — every shipped asset has a valid record', () => {
    const lib = createBundledLibrary();
    expect(lib.size).toBe(BUNDLED_ASSETS.length);
    expect(lib.size).toBeGreaterThan(5);
  });

  it('every asset is CC0 and none requires attribution', () => {
    // D7 bundles Kenney CC0 offline; the authored clips and Lottie are CC0 by
    // declaration. If that ever stops being true, the about-screen and the
    // printed programme need writing, and this test is where that is noticed.
    for (const a of createBundledLibrary().all()) {
      expect(ALLOWED_LICENSES).toContain(a.license.license);
      expect(a.license.license).toBe('CC0-1.0');
    }
    expect(createBundledLibrary().attributions()).toEqual([]);
  });

  it('every asset names a license file that was actually shipped', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const root = new URL('../../', import.meta.url).pathname;
    for (const a of createBundledLibrary().all()) {
      expect(a.license.licenseFile, `${a.id} names no license file`).toBeTruthy();
      // The record can say anything; the file has to be there. I-10 asks for a
      // record, and a record pointing at a file nobody shipped is a record of
      // nothing.
      await expect(
        fs.access(path.join(root, a.license.licenseFile as string)),
      ).resolves.toBeUndefined();
    }
  });

  it('covers every asset kind, so no kind is untested by accident', () => {
    const lib = createBundledLibrary();
    for (const kind of ASSET_KINDS) {
      expect(lib.ofKind(kind).length, `no bundled asset of kind ${kind}`).toBeGreaterThan(0);
    }
  });

  it('the two sprite sheets have DIFFERENT loop lengths (Gate 3)', () => {
    const lib = createBundledLibrary();
    const sheets = lib.ofKind('spritesheet');
    expect(sheets.length).toBeGreaterThanOrEqual(2);
    const periods = sheets.map((s) => ('loopSeconds' in s ? s.loopSeconds : 0));
    expect(new Set(periods).size).toBe(periods.length);
    // Not merely different — mutually non-dividing, so two loops cannot agree
    // at a common seam and hide an accumulator bug exactly where it matters.
    const [a, b] = periods as [number, number];
    expect(Math.abs((a / b) % 1)).toBeGreaterThan(0.05);
  });

  it('sheet geometry is consistent: frames fit the grid', () => {
    for (const s of createBundledLibrary().ofKind('spritesheet')) {
      if (s.kind !== 'spritesheet') continue;
      expect(s.frames).toBeGreaterThan(0);
      // A sheet claiming more frames than cells would silently read past the
      // last row and draw the top-left frame again.
      expect(s.frames).toBeLessThanOrEqual(s.columns * s.rows);
    }
  });

  it('every video declares a poster — I-13 has no chain without one', () => {
    for (const v of createBundledLibrary().ofKind('video')) {
      if (v.kind !== 'video') continue;
      expect(v.posterUrl, `${v.id} has no poster`).toBeTruthy();
      expect(v.posterUrl).not.toBe(v.url);
    }
  });

  it('keeps the deliberately broken fixtures Gate 3 depends on', () => {
    const lib = createBundledLibrary();
    // Named explicitly so that "tidying up the test assets" fails here rather
    // than at the gate. Both files carry the same warning in their LICENSE.txt.
    const corrupt = lib.get('test.video.corrupt');
    expect(corrupt, 'the I-13 corrupt-video fixture is gone').toBeDefined();
    const nonSeamless = lib.get('test.video.nonSeamless');
    expect(nonSeamless, 'the non-seamless loop fixture is gone').toBeDefined();
    expect(nonSeamless && 'seamless' in nonSeamless && nonSeamless.seamless).toBe(false);
  });
});
