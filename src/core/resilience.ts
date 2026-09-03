/**
 * I-13 — per-layer error isolation.
 *
 * "This is performance equipment. No single asset or device failure ends the
 * session." A provider that throws must cost its own layer, not the frame.
 *
 * This module is **generic over the view type and free of PixiJS**. That is not
 * fastidiousness: SPEC.md §8.1 requires I-13 to be tested as pure logic with no
 * GPU, and the thing worth testing is the *policy* — a full layer list comes
 * back, the failure is recorded, and a layer that threw once is never called
 * again. The Pixi placeholder itself lives in `render/compositor.ts`, which is
 * the only place that knows what magenta looks like.
 */
import type { Layer } from './layer';

export type LayerStatus = 'ok' | 'placeholder';

export interface IsolatedLayer<V> {
  layer: Layer;
  view: V;
  status: LayerStatus;
  /** The message shown on the placeholder, and logged. Empty when `ok`. */
  error: string;
}

/** What a placeholder should say. The renderer decides how to draw it. */
export interface PlaceholderInfo {
  layerId: string;
  layerName: string;
  providerId: string;
  reason: string;
}

export type PlaceholderFactory<V> = (info: PlaceholderInfo) => V;
export type ErrorSink = (info: PlaceholderInfo, error: unknown) => void;

export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message === '' ? e.name : e.message;
  return String(e);
}

function infoFor(layer: Layer, reason: string): PlaceholderInfo {
  return {
    layerId: layer.id,
    layerName: layer.name,
    providerId: layer.providerId,
    reason,
  };
}

/**
 * Builds a view per layer, substituting a placeholder for any layer whose
 * provider throws. **The returned list always has one entry per input layer, in
 * input order** — that is the property Gate 1 checks, because a compositor that
 * silently drops a failed layer produces a scene that is wrong in a way nobody
 * notices until the show.
 */
export function isolateCreate<V>(
  layers: readonly Layer[],
  create: (layer: Layer) => V,
  placeholder: PlaceholderFactory<V>,
  onError: ErrorSink = () => {},
): IsolatedLayer<V>[] {
  return layers.map((layer) => {
    try {
      return { layer, view: create(layer), status: 'ok' as const, error: '' };
    } catch (e) {
      const reason = describeError(e);
      const info = infoFor(layer, reason);
      onError(info, e);
      return { layer, view: placeholder(info), status: 'placeholder' as const, error: reason };
    }
  });
}

/**
 * Runs a per-frame update across isolated layers. A layer that throws is
 * swapped for a placeholder and **never called again** — retrying every frame
 * would turn one broken provider into 60 exceptions and 60 log lines a second,
 * which is its own way of ending a session.
 *
 * Returns the entries that changed status, so the caller can swap the view in
 * its display list and flag the layer in the UI (I-13's "flagged in the layer
 * list").
 */
export function isolateUpdate<V>(
  entries: IsolatedLayer<V>[],
  update: (entry: IsolatedLayer<V>) => void,
  placeholder: PlaceholderFactory<V>,
  onError: ErrorSink = () => {},
): IsolatedLayer<V>[] {
  const changed: IsolatedLayer<V>[] = [];
  for (const entry of entries) {
    if (entry.status === 'placeholder') continue;
    try {
      update(entry);
    } catch (e) {
      const reason = describeError(e);
      const info = infoFor(entry.layer, reason);
      onError(info, e);
      entry.view = placeholder(info);
      entry.status = 'placeholder';
      entry.error = reason;
      changed.push(entry);
    }
  }
  return changed;
}

/** The layers a live session should be showing as broken (I-13's flag). */
export function failedLayers<V>(entries: readonly IsolatedLayer<V>[]): IsolatedLayer<V>[] {
  return entries.filter((e) => e.status === 'placeholder');
}
