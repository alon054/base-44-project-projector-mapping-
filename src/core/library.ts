/**
 * I-10 — the asset library, and the license record that is mandatory in it.
 *
 * "Every catalog asset carries a `license` record (source, license name,
 * attribution-required flag, retrieved-at date). No asset enters the library
 * without one. **This is enforced at the library API level, not by
 * discipline.**"
 *
 * That last clause is the whole design. The tempting shape is a directory scan
 * plus a convention that every folder also contains a `license.txt`, which is
 * discipline wearing a filesystem costume: the day someone drops a sprite in
 * without one, nothing complains, and the omission is discovered when a lawyer
 * asks rather than when the asset is added. So there is no directory scan. The
 * only way an asset becomes reachable is `AssetLibrary.register`, and that
 * function refuses anything whose four license fields are not present and
 * well-formed.
 *
 * The four fields are I-10's own list and are not negotiable individually:
 *
 *  - `source` — where it came from, as a resolvable URL. "Kenney" is not a
 *    source; a link that still answers in three years is.
 *  - `license` — the license NAME (`CC0-1.0`), not a prose paragraph. A name is
 *    checkable against a list; a paragraph is checkable by reading it.
 *  - `attributionRequired` — a boolean and not an inference from the name,
 *    because the answer for a per-file license (LottieFiles, D7) varies file by
 *    file within one source.
 *  - `retrievedAt` — an ISO date. D7 says every source needs "a terms re-check
 *    before Phase 8"; a re-check needs to know what date the old terms were.
 *
 * Phase 8's catalog providers register into this same API, which is why it
 * lives in `core/` and takes no view of where the bytes came from.
 */

/** Licenses this project will accept into the library. */
export const ALLOWED_LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'MIT', 'OFL-1.1'] as const;
export type LicenseName = (typeof ALLOWED_LICENSES)[number];

export interface LicenseRecord {
  /** Resolvable URL the asset came from. */
  source: string;
  /** SPDX-style identifier from `ALLOWED_LICENSES`. */
  license: LicenseName;
  /** Never inferred from the license name — see this file's header. */
  attributionRequired: boolean;
  /** ISO `YYYY-MM-DD`. */
  retrievedAt: string;
  /** Who to credit. Required when `attributionRequired` is true. */
  attribution?: string;
  /** Path, relative to the asset, of the license text as it was shipped. */
  licenseFile?: string;
}

/**
 * §10 row 2 — the concurrent caps, ratified by the operator 2026-09-04.
 *
 * **Video: 4, and this one is measured.** The `phase3-x{n}` ladder ran n
 * videos + 2n sprites + n Lotties at DEV_RESOLUTION. n = 1..5 all passed §4's
 * M1 with 0.0000% late frames and a worst interval of 17.70-17.80 ms. n = 6
 * FAILED M1 on two clauses at once: a run of 14 consecutive late frames
 * against a limit of 2, and 9 intervals over 3 x N against A12's allowance of
 * one. 4 is one step below the measured failure.
 *
 * **Lottie: 4, and this one is NOT measured.** It is set by analogy with the
 * video cap. No run isolated Lottie count from video count — the ladder raised
 * all three kinds together — so nothing separates a Lottie's main-thread
 * re-render from a decoder or a sprite. If it ever matters it needs its own
 * ladder. Phase 9 confirms both.
 *
 * **What the video cap actually limits is not what it counts.** The x6 failure
 * was a BURST — all nine events inside 0.7 s — because D5 realigns each video
 * at its own loop boundary and nothing staggers them, so decoders sharing a
 * period seek in the same frame. Per-decoder cost is nearly flat from one to
 * five. Staggering the realignment is parked for Phase 9; it may lift this
 * number a long way.
 *
 * **WARN, do not refuse.** Exceeding the cap costs 15 late frames in 3555 and
 * one 150 ms hitch — a visible stumble, not a failure. Nothing crashed at x6:
 * no errors, no placeholders, all six decoders reached `playing`, memory flat.
 * This is performance equipment (I-13), and refusing an operator mid-show over
 * a stumble that could be flagged instead is the wrong trade.
 */
export const MAX_CONCURRENT_VIDEO = 4;
export const MAX_CONCURRENT_LOTTIE = 4;

/** Kinds that carry a concurrency cap, and the cap for each. */
export const CONCURRENCY_CAPS: Readonly<Partial<Record<AssetKind, number>>> = {
  video: MAX_CONCURRENT_VIDEO,
  lottie: MAX_CONCURRENT_LOTTIE,
};

/**
 * Which caps a set of asset kinds exceeds, and by how much. Empty when none.
 *
 * Pure, so §8.1 can test it without a renderer, and returning the overage
 * rather than a boolean because "6 videos against a cap of 4" is the message
 * an operator can act on.
 */
export interface CapBreach {
  kind: AssetKind;
  count: number;
  cap: number;
}

export function capBreaches(
  kinds: readonly AssetKind[],
): CapBreach[] {
  const counts = new Map<AssetKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const out: CapBreach[] = [];
  for (const [kind, cap] of Object.entries(CONCURRENCY_CAPS) as [AssetKind, number][]) {
    const count = counts.get(kind) ?? 0;
    if (count > cap) out.push({ kind, count, cap });
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind));
}

/**
 * The caps a SCENE breaches, from its layers and a library to look them up in.
 *
 * One function rather than two call sites doing the same join, because there
 * are two consumers with the same question and no reason for them to disagree:
 * the output window's `[caps]` log line (Phase 3) and the operator-facing
 * warning in the editor's layer panel (P5-F, the line Phase 3 deferred). The
 * pair before this existed is exactly the shape CLAUDE.md's "a fix to one
 * counter is not a fix to the counter beside it" is about.
 *
 * Structurally typed on purpose: `core/library.ts` takes no view of the scene
 * model, so it asks for the little it reads. Only `content.assetId` selects an
 * asset (`STRUCTURAL_CONTENT_KEYS`), and a layer naming none — every procedural
 * layer — contributes nothing to any cap.
 */
export function sceneCapBreaches(
  layers: readonly { content: { [k: string]: unknown } }[],
  library: { get(id: string): { kind: AssetKind } | undefined },
): CapBreach[] {
  return capBreaches(
    layers
      .map((l) => {
        const assetId = l.content['assetId'];
        return typeof assetId === 'string' ? library.get(assetId) : undefined;
      })
      .filter((a): a is { kind: AssetKind } => a !== undefined)
      .map((a) => a.kind),
  );
}

/**
 * One sentence for one breach, shared by the log line and the operator warning.
 *
 * **It says what happens, and what does not.** "Expect dropped frames; the
 * session continues" is the whole of the WARN-not-refuse decision in the words
 * an operator reads at the moment it matters — see this file's cap header for
 * the measurement behind it. A second wording of this sentence somewhere else
 * would eventually promise something the code does not do.
 */
export function capBreachMessage(b: CapBreach): string {
  return (
    `${b.count} concurrent ${b.kind} layers, over the cap of ${b.cap} ` +
    '(§10 row 2). Expect dropped frames; the session continues.'
  );
}

/** What kind of layer view a bundled asset produces. */
export const ASSET_KINDS = ['still', 'spritesheet', 'video', 'lottie'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

interface AssetBase {
  /** Stable across sessions — it is stored in scene JSON (I-12). */
  id: string;
  /** Operator-facing. Never an identifier. */
  name: string;
  kind: AssetKind;
  /** I-10. Mandatory. */
  license: LicenseRecord;
  /** Resolved by the bundler, so "with no network" is structural. */
  url: string;
}

/** A single image with alpha. Kenney's particle PNGs. */
export interface StillAsset extends AssetBase {
  kind: 'still';
}

/**
 * A grid of frames in one image.
 *
 * `frames` is stated rather than derived from `columns * rows`, because a sheet
 * whose last row is partly empty is normal (25 frames in a 5x5 grid is not, but
 * 9 in a 3x3 is exactly full and the two must be describable the same way).
 */
export interface SpriteSheetAsset extends AssetBase {
  kind: 'spritesheet';
  columns: number;
  rows: number;
  frames: number;
  /** Seconds for one full pass. The layer's loop period (I-2). */
  loopSeconds: number;
  /** True when frame N abuts frame 0 without a visible step. */
  seamless: boolean;
}

export interface VideoAsset extends AssetBase {
  kind: 'video';
  /** I-13's middle rung: shown while decoding, and after a decode failure. */
  posterUrl: string;
  /** Nominal duration in seconds. The clock phase-aligns to it (D5). */
  loopSeconds: number;
  seamless: boolean;
}

export interface LottieAsset extends AssetBase {
  kind: 'lottie';
  loopSeconds: number;
  seamless: boolean;
  /**
   * The animation itself, already parsed.
   *
   * A bundled Lottie is imported as data rather than fetched from `url`,
   * because the bundler inlines a small asset as a `data:` URI and fetching one
   * violates this app's `connect-src` (see `manifest.ts`). `url` stays as the
   * asset's identity for logging and for I-10's record — it is a
   * `bundled:` pseudo-URL for this kind, not something to load.
   *
   * Phase 8's catalog Lottie will arrive over the network and will populate
   * this after a fetch instead; the view takes the data either way and does not
   * know which happened.
   */
  data: Record<string, unknown>;
}

export type BundledAsset = StillAsset | SpriteSheetAsset | VideoAsset | LottieAsset;

export class LicenseError extends Error {
  constructor(assetId: string, detail: string) {
    super(`asset "${assetId}" refused: ${detail} (I-10: no asset enters the library without a license record)`);
    this.name = 'LicenseError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates one license record. Exported so the unit suite can assert each
 * rejection separately rather than through a whole registration.
 */
export function validateLicense(assetId: string, license: unknown): LicenseRecord {
  if (typeof license !== 'object' || license === null || Array.isArray(license)) {
    throw new LicenseError(assetId, 'no license record');
  }
  const l = license as Record<string, unknown>;

  const source = l['source'];
  if (typeof source !== 'string' || source === '') {
    throw new LicenseError(assetId, 'license.source is missing');
  }
  // A source must be resolvable. "Kenney" is not a source (see header).
  try {
    new URL(source);
  } catch {
    throw new LicenseError(assetId, `license.source is not a resolvable URL: "${source}"`);
  }

  const name = l['license'];
  if (typeof name !== 'string' || !(ALLOWED_LICENSES as readonly string[]).includes(name)) {
    throw new LicenseError(
      assetId,
      `license.license must be one of [${ALLOWED_LICENSES.join(', ')}], got ${JSON.stringify(name)}`,
    );
  }

  const attributionRequired = l['attributionRequired'];
  if (typeof attributionRequired !== 'boolean') {
    throw new LicenseError(assetId, 'license.attributionRequired must be an explicit boolean');
  }

  const retrievedAt = l['retrievedAt'];
  if (typeof retrievedAt !== 'string' || !ISO_DATE.test(retrievedAt)) {
    throw new LicenseError(assetId, 'license.retrievedAt must be an ISO YYYY-MM-DD date');
  }

  const attribution = l['attribution'];
  if (attributionRequired && (typeof attribution !== 'string' || attribution === '')) {
    // An attribution-required asset with nobody named is the one failure mode
    // that a license record can have while looking complete.
    throw new LicenseError(assetId, 'license.attributionRequired is true but no attribution is named');
  }

  const licenseFile = l['licenseFile'];
  return {
    source,
    license: name as LicenseName,
    attributionRequired,
    retrievedAt,
    ...(typeof attribution === 'string' && attribution !== '' ? { attribution } : {}),
    ...(typeof licenseFile === 'string' && licenseFile !== '' ? { licenseFile } : {}),
  };
}

/**
 * The one door into the library. Nothing else makes an asset reachable.
 *
 * Deliberately not a directory scan — see this file's header for why that
 * would be I-10 as discipline rather than as enforcement.
 */
export class AssetLibrary {
  private readonly assets = new Map<string, BundledAsset>();

  register(asset: BundledAsset): BundledAsset {
    if (typeof asset.id !== 'string' || asset.id === '') {
      throw new LicenseError(String(asset.id), 'asset id must be a non-empty string');
    }
    if (this.assets.has(asset.id)) {
      throw new LicenseError(asset.id, 'an asset with this id is already registered');
    }
    if (!(ASSET_KINDS as readonly string[]).includes(asset.kind)) {
      throw new LicenseError(asset.id, `unknown asset kind "${asset.kind}"`);
    }
    if (typeof asset.url !== 'string' || asset.url === '') {
      throw new LicenseError(asset.id, 'asset url is missing');
    }
    // I-10, at the API level. This throw is the invariant.
    const license = validateLicense(asset.id, asset.license);
    const stored = { ...asset, license } as BundledAsset;
    this.assets.set(asset.id, stored);
    return stored;
  }

  registerAll(assets: readonly BundledAsset[]): void {
    for (const a of assets) this.register(a);
  }

  get(id: string): BundledAsset | undefined {
    return this.assets.get(id);
  }

  /** Sorted, so enumeration is stable for the UI and for tests. */
  ids(): string[] {
    return [...this.assets.keys()].sort();
  }

  all(): BundledAsset[] {
    return this.ids().map((id) => this.assets.get(id) as BundledAsset);
  }

  ofKind(kind: AssetKind): BundledAsset[] {
    return this.all().filter((a) => a.kind === kind);
  }

  get size(): number {
    return this.assets.size;
  }

  /**
   * Everything that must be credited, for an about screen or a printed
   * programme. Empty when nothing in the library requires attribution — which
   * is the CC0 case, and is a fact worth being able to state rather than
   * assume.
   */
  attributions(): { id: string; attribution: string; source: string }[] {
    return this.all()
      .filter((a) => a.license.attributionRequired)
      .map((a) => ({
        id: a.id,
        attribution: a.license.attribution ?? '',
        source: a.license.source,
      }));
  }
}
