/**
 * The bundled library's catalog (D6, D7, I-10).
 *
 * **Every asset is a static `?url` import, and that is what makes "with no
 * network" structural** rather than a promise. The bundler resolves each path
 * at build time and emits the bytes into `dist/`; there is no fetch, no
 * directory scan, and no code path by which a missing file becomes a runtime
 * URL that might have worked if the machine had been online. Gate 3 asks for a
 * Kenney sprite to render "from the bundled library, with no network" — an
 * import that fails to resolve fails the BUILD, which is a stronger statement
 * than a test that happened to pass with the wifi off.
 *
 * Every entry carries its I-10 license record inline. `AssetLibrary.register`
 * refuses one that does not, so the enforcement is at the API and this file
 * cannot quietly grow an exception (see `core/library.ts`).
 */
import puffUrl from '../../../assets/bundled/kenney-smoke-particles/whitePuff_5x5.png?url';
import explosionUrl from '../../../assets/bundled/kenney-smoke-particles/explosion_3x3.png?url';
import flameUrl from '../../../assets/bundled/kenney-particle-pack/flame_05.png?url';
import starUrl from '../../../assets/bundled/kenney-particle-pack/star_07.png?url';
import sparkUrl from '../../../assets/bundled/kenney-particle-pack/spark_04.png?url';
import lightUrl from '../../../assets/bundled/kenney-particle-pack/light_01.png?url';
import seamlessUrl from '../../../assets/bundled/test-video/loop-seamless.mp4?url';
import seamlessPosterUrl from '../../../assets/bundled/test-video/loop-seamless.poster.jpg?url';
import nonSeamlessUrl from '../../../assets/bundled/test-video/loop-nonseamless.mp4?url';
import nonSeamlessPosterUrl from '../../../assets/bundled/test-video/loop-nonseamless.poster.jpg?url';
import corruptUrl from '../../../assets/bundled/test-video/corrupt.mp4?url';
import corruptPosterUrl from '../../../assets/bundled/test-video/corrupt.poster.jpg?url';
// Imported as DATA, not as a URL, and that is a CSP consequence rather than a
// preference. Vite inlines an asset under its size threshold as a `data:` URI,
// and `fetch()` on a `data:` URI is a `connect-src` violation under this app's
// hardened CSP — the Lottie loaded fine in dev and failed in the built app,
// which the run log caught on the first launch of the Phase 3 scene.
import ringsData from '../../../assets/bundled/authored/clock-rings.json';
import { AssetLibrary, type BundledAsset, type LicenseRecord } from '../../core/library';

/** The date the Kenney packs were downloaded. D7 wants this re-checked before Phase 8. */
const RETRIEVED = '2026-09-04';

const KENNEY_PARTICLE: LicenseRecord = {
  source: 'https://kenney.nl/assets/particle-pack',
  license: 'CC0-1.0',
  // Kenney's own License.txt: "Credit would be nice but is not mandatory."
  // Recorded as false because that is what the text says, not because CC0
  // implies it — I-10 wants the answer, not an inference from the name.
  attributionRequired: false,
  attribution: 'Kenney Vleugels (kenney.nl)',
  retrievedAt: RETRIEVED,
  licenseFile: 'assets/bundled/kenney-particle-pack/License.txt',
};

const KENNEY_SMOKE: LicenseRecord = {
  source: 'https://kenney.nl/assets/smoke-particles',
  license: 'CC0-1.0',
  attributionRequired: false,
  attribution: 'Kenney Vleugels (kenney.nl)',
  retrievedAt: RETRIEVED,
  licenseFile: 'assets/bundled/kenney-smoke-particles/license.txt',
};

const AUTHORED_VIDEO: LicenseRecord = {
  source: 'https://creativecommons.org/publicdomain/zero/1.0/',
  license: 'CC0-1.0',
  attributionRequired: false,
  retrievedAt: RETRIEVED,
  licenseFile: 'assets/bundled/test-video/LICENSE.txt',
};

const AUTHORED_LOTTIE: LicenseRecord = {
  source: 'https://creativecommons.org/publicdomain/zero/1.0/',
  license: 'CC0-1.0',
  attributionRequired: false,
  retrievedAt: RETRIEVED,
  licenseFile: 'assets/bundled/authored/LICENSE.txt',
};

/**
 * The catalog.
 *
 * The two sprite sheets have **deliberately different loop lengths** (25 frames
 * over 2.5 s and 9 frames over 1.8 s). That is Gate 3's "two sprite/Lottie
 * loops of different lengths stay phase-consistent relative to the clock after
 * a scrub" — the fixture for the condition is in the library rather than
 * invented at the gate, and 2.5 and 1.8 share no convenient factor so a wrong
 * implementation cannot pass by coincidence.
 */
export const BUNDLED_ASSETS: readonly BundledAsset[] = [
  {
    id: 'kenney.smoke.whitePuff',
    name: 'White puff (25f)',
    kind: 'spritesheet',
    url: puffUrl,
    columns: 5,
    rows: 5,
    frames: 25,
    loopSeconds: 2.5,
    // A puff dissipates to nothing and restarts opaque. It is NOT seamless and
    // saying so is the point: `seamless: false` is what turns seam handling on.
    seamless: false,
    license: KENNEY_SMOKE,
  },
  {
    id: 'kenney.smoke.explosion',
    name: 'Explosion (9f)',
    kind: 'spritesheet',
    url: explosionUrl,
    columns: 3,
    rows: 3,
    frames: 9,
    loopSeconds: 1.8,
    seamless: false,
    license: KENNEY_SMOKE,
  },
  {
    id: 'kenney.particle.flame',
    name: 'Flame',
    kind: 'still',
    url: flameUrl,
    license: KENNEY_PARTICLE,
  },
  {
    id: 'kenney.particle.star',
    name: 'Star',
    kind: 'still',
    url: starUrl,
    license: KENNEY_PARTICLE,
  },
  {
    id: 'kenney.particle.spark',
    name: 'Spark',
    kind: 'still',
    url: sparkUrl,
    license: KENNEY_PARTICLE,
  },
  {
    id: 'kenney.particle.light',
    name: 'Light',
    kind: 'still',
    url: lightUrl,
    license: KENNEY_PARTICLE,
  },
  {
    id: 'test.video.seamless',
    name: 'Seamless loop (4 s)',
    kind: 'video',
    url: seamlessUrl,
    posterUrl: seamlessPosterUrl,
    loopSeconds: 4,
    seamless: true,
    license: AUTHORED_VIDEO,
  },
  {
    id: 'test.video.nonSeamless',
    name: 'Non-seamless loop (3 s)',
    kind: 'video',
    url: nonSeamlessUrl,
    posterUrl: nonSeamlessPosterUrl,
    loopSeconds: 3,
    // Gate 3's fixture. Its brightness ramps and snaps back; see the pack's
    // LICENSE.txt, which says not to "fix" it.
    seamless: false,
    license: AUTHORED_VIDEO,
  },
  {
    id: 'test.video.corrupt',
    name: 'Corrupt video (I-13 fixture)',
    kind: 'video',
    url: corruptUrl,
    posterUrl: corruptPosterUrl,
    loopSeconds: 4,
    seamless: true,
    license: AUTHORED_VIDEO,
  },
  {
    id: 'authored.lottie.clockRings',
    name: 'Clock rings (3 s)',
    kind: 'lottie',
    // Not a URL. See the import.
    url: 'bundled:authored/clock-rings.json',
    data: ringsData as unknown as Record<string, unknown>,
    loopSeconds: 3,
    // Every ring turns a WHOLE number of times per loop and its pulse returns
    // to exactly 100%, so frame 90 abuts frame 0.
    seamless: true,
    license: AUTHORED_LOTTIE,
  },
];

/**
 * The process-wide bundled library. Built at module load, which means an asset
 * with a bad license record throws before any window opens rather than when
 * somebody adds it to a scene.
 */
export function createBundledLibrary(): AssetLibrary {
  const library = new AssetLibrary();
  library.registerAll(BUNDLED_ASSETS);
  return library;
}
