/**
 * I-3 — the content provider contract.
 *
 * "Anything that produces visual content implements one interface. The
 * compositor never knows or cares whether a layer's pixels came from code, a
 * catalog file, or AI."
 *
 * This is the one interface SPEC.md sanctions building before its consumers
 * exist (CLAUDE.md, "what not to do"), so the shape is chosen now with the
 * later providers in mind. Two decisions in it are not obvious:
 *
 * **`create` is synchronous and returns a view immediately.** A catalog or AI
 * provider cannot have its texture ready at create time, so the tempting shape
 * is `Promise<LayerView>`. It is the wrong one for a live instrument: awaiting
 * a provider means a scene switch mid-show stalls on a network fetch. Instead a
 * view exists from the first frame and populates itself — placeholder, then
 * poster, then content — which is exactly the fallback chain I-13 already
 * requires of video in Phase 3. Nothing about that is Phase-1 machinery; it is
 * what makes the sync signature correct rather than merely convenient.
 *
 * **The view is handed a pixel box, not the output size.** The compositor owns
 * the normalized-to-pixel step (I-1), so a provider never sees a normalized
 * transform and cannot accidentally store one in pixels.
 */
import type { Container } from 'pixi.js';
import type { JsonObject, Layer } from '../core/layer';
import type { Rng } from '../core/rng';

export interface ProviderContext {
  /** The layer being filled. Read-only to the provider. */
  readonly layer: Layer;
  /** The layer's content config, already validated as JSON (I-7, I-12). */
  readonly content: JsonObject;
  /**
   * I-12. A seeded stream derived from `(scene.seed, layer.seed, label)`.
   * A provider that wants randomness calls this and never `Math.random()`.
   */
  rng(label?: string): Rng;
  /** The layer's box in device pixels. Changes on resize. */
  readonly width: number;
  readonly height: number;
}

/**
 * What the provider renders into, per frame. Every field is derived from the
 * one global clock (I-2) — a provider that wants time asks for it here and
 * never reads a wall clock of its own.
 */
export interface LayerFrame {
  /**
   * Authoritative scene time in seconds. **This is the I-2 handle.**
   *
   * A provider with a loop length of its own — a sprite sheet, a video, a
   * Lottie composition — derives its own position from this, with
   * `phaseAt(timeMs, period)`. It must not accumulate: an accumulated position
   * cannot survive a scrub, and Gate 3 asks precisely that two loops of
   * different lengths stay phase-consistent after one.
   */
  timeSeconds: number;
  /**
   * Normalized [0, 1) position in the engine's default loop
   * (`GLOBAL_LOOP_SECONDS`), for providers with no period of their own.
   *
   * Phase 1 passed the throwaway host ticker's accumulated phase. Phase 3
   * deleted that ticker; this is now derived from the clock, and the signature
   * is unchanged so the 19 blessed golden frames stay byte-identical.
   */
  phase: number;
}

export interface LayerView {
  /** Added to the layer's container by the compositor. Never reparented. */
  readonly view: Container;
  /** Called every frame. May throw — the compositor isolates it (I-13). */
  update(frame: LayerFrame): void;
  /** New pixel box. Providers redraw resolution-derived geometry here (I-1). */
  resize(width: number, height: number): void;
  destroy(): void;
}

/**
 * I-8 / CLAUDE.md rule 9: a content value this provider exposes as an
 * addressable parameter, registered under `entity.<id>.<key>`.
 *
 * Provider content is opaque to the compositor (I-3), which is why the provider
 * and not the registry declares these. Without this hook, every value a
 * provider invented — a tint, a band count — would be a per-entity parameter
 * living outside the registry, and Phase 11's MIDI mapping would find half the
 * instrument unaddressable.
 */
export interface ContentParamSpec {
  /** Suffix under `entity.<id>.`, e.g. `tint`. */
  key: string;
  label: string;
  kind: 'number' | 'boolean' | 'enum';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}

export interface ContentProvider {
  /** Matches `Layer.providerId`. */
  readonly id: string;

  /**
   * The content values this provider exposes as parameters, for the given
   * content blob. Structural choices are deliberately NOT included — see
   * `ProceduralProvider` for which and why.
   */
  contentParameters?(content: JsonObject): ContentParamSpec[];
  /**
   * Build a view for one layer. May throw; the compositor substitutes a
   * placeholder rather than blanking the frame (I-13).
   */
  create(ctx: ProviderContext): LayerView;
}

/** Lookup by `Layer.providerId`. A miss is an I-13 placeholder, not a crash. */
export class ProviderRegistry {
  private readonly providers = new Map<string, ContentProvider>();

  register(provider: ContentProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): ContentProvider | undefined {
    return this.providers.get(id);
  }

  ids(): string[] {
    return [...this.providers.keys()].sort();
  }
}
