/**
 * The bundled-library `ContentProvider` (I-3, D6).
 *
 * D6's provider order is Procedural (Phase 1) → **bundled CC0 (Phase 3)** →
 * Catalog APIs (Phase 8) → AI (Phase 10). This is the second, and the first one
 * whose pixels come from a file rather than from code.
 *
 * **One provider, four view kinds, and the kind comes from the ASSET.** The
 * alternative — a `bundled.sprite`, `bundled.video` and `bundled.lottie`
 * provider each matching its own `providerId` — would put the same fact in two
 * places: the scene would say "this is a video layer" and the library would say
 * "this asset is a video", and a scene edited by hand could disagree with
 * itself. Here a layer names an `assetId` and nothing else; what kind of view
 * that produces is the library's business (I-10 owns the metadata) and the
 * compositor's ignorance is preserved (I-3).
 */
import type { JsonObject } from '../../core/layer';
import type {
  ContentParamSpec,
  ContentProvider,
  LayerView,
  ProviderContext,
} from '../ContentProvider';
import { AssetLibrary } from '../../core/library';
import { createStillView, createSpriteSheetView } from './imageViews';
import { createVideoView, type VideoStage } from './VideoView';
import { createLottieView } from './LottieView';
import { defaultSeamMode, isSeamMode, SEAM_MODES, type SeamMode } from './seam';

export const BUNDLED_PROVIDER_ID = 'bundled';

/**
 * Structural keys: they select WHICH asset a layer is, not a value on it.
 * `assetId` is excluded from the parameter registry for the same reason
 * `ProceduralProvider` excludes `kind` — changing it does not modulate the
 * layer, it replaces it. Rule 9's grep test knows about this list.
 */
const STRUCTURAL_CONTENT_KEYS = ['assetId'] as const;

export interface BundledProviderOptions {
  library: AssetLibrary;
  /**
   * §5 / A2. False in the editor preview: no `<video>` element is created and
   * the layer shows its poster plus a badge. This is not a fidelity setting to
   * be relaxed later — see §5's note that the decision is load-bearing.
   */
  decodeVideo: boolean;
  /** §5: Lottie runs in the preview "at reduced size, capped". */
  lottieResolution: number;
  /** For the run log. Stage changes only, never per frame. */
  onVideoStage?: (layerId: string, stage: VideoStage, detail: string) => void;
  onLottieFailed?: (layerId: string, reason: string) => void;
}

export class BundledProvider implements ContentProvider {
  readonly id = BUNDLED_PROVIDER_ID;

  constructor(private readonly opts: BundledProviderOptions) {}

  /**
   * I-8 / rule 9. Every content value this provider READS is declared here,
   * except the structural ones above, and a unit test greps this file to prove
   * the two lists agree.
   */
  contentParameters(content: JsonObject): ContentParamSpec[] {
    const asset = this.assetFor(content);
    const params: ContentParamSpec[] = [];
    if (!asset) return params;

    // Seam handling is per layer and configurable, which is the deliverable's
    // wording. It is a parameter and not a structural key because turning a
    // crossfade on and off during a show is a legitimate thing to do.
    if (asset.kind !== 'still') {
      params.push({
        key: 'seam',
        label: 'Loop seam',
        kind: 'enum',
        options: SEAM_MODES,
        default: defaultSeamMode(
          'seamless' in asset ? asset.seamless : true,
          asset.kind,
        ),
      });
    }
    return params;
  }

  create(ctx: ProviderContext): LayerView {
    const asset = this.assetFor(ctx.content);
    if (!asset) {
      // Throws, so `isolateCreate` substitutes the compositor's placeholder
      // (I-13). A scene naming an asset this build does not have is exactly the
      // "loading a scene whose assets are partly missing succeeds, with the
      // missing layers flagged" case.
      const id = ctx.content['assetId'];
      throw new Error(`no bundled asset "${String(id)}"`);
    }

    const seam = this.seamFor(ctx.content, asset.kind, 'seamless' in asset ? asset.seamless : true);

    switch (asset.kind) {
      case 'still':
        return createStillView(asset, ctx.width, ctx.height);
      case 'spritesheet':
        return createSpriteSheetView(asset, ctx.width, ctx.height, seam);
      case 'video':
        return createVideoView({
          asset,
          width: ctx.width,
          height: ctx.height,
          decode: this.opts.decodeVideo,
          ...(this.opts.onVideoStage
            ? {
                onStage: (stage: VideoStage, detail: string) =>
                  this.opts.onVideoStage?.(ctx.layer.id, stage, detail),
              }
            : {}),
        });
      case 'lottie':
        return createLottieView({
          asset,
          width: ctx.width,
          height: ctx.height,
          resolution: this.opts.lottieResolution,
          ...(this.opts.onLottieFailed
            ? { onFailed: (reason: string) => this.opts.onLottieFailed?.(ctx.layer.id, reason) }
            : {}),
        });
    }
  }

  private assetFor(content: JsonObject) {
    const id = content['assetId'];
    if (typeof id !== 'string') return undefined;
    return this.opts.library.get(id);
  }

  private seamFor(content: JsonObject, kind: string, seamless: boolean): SeamMode {
    const v = content['seam'];
    if (isSeamMode(v)) return v;
    return defaultSeamMode(seamless, kind);
  }
}

/** Exported for the rule-9 grep test, which reads this list rather than guessing. */
export const BUNDLED_STRUCTURAL_KEYS = STRUCTURAL_CONTENT_KEYS;
