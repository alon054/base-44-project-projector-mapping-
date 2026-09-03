/**
 * The `Scene` model (I-12). The scene JSON is the unit of truth; the frame
 * buffer is a consequence of it, never a source.
 *
 * Correctness here is judged by deep-equal round-trip, not by pixels — see
 * SPEC.md §8.1. `deserialize(serialize(s))` must equal `s` exactly, which
 * constrains this file in one non-obvious way: **deserialization fills defaults
 * for absent fields, so only a canonical scene round-trips.** `createScene` and
 * `canonicalizeScene` are the two ways to obtain one, and every scene that
 * enters the app goes through one of them.
 */
import {
  createLayer,
  clamp01,
  isBlendMode,
  normalizeTransform,
  type BlendMode,
  type JsonObject,
  type JsonValue,
  type Layer,
} from './layer';

/**
 * Bumped whenever a stored scene's shape changes incompatibly. A file from a
 * future version is refused rather than guessed at — Phase 6 owns migration
 * (D12), and a silent misread is worse than a refusal (I-13's principle: fail
 * visibly, keep the session).
 */
export const SCENE_FORMAT_VERSION = 1;

export interface Scene {
  version: number;
  id: string;
  name: string;
  /** I-12. Every provider's RNG derives from this plus the layer's own seed. */
  seed: number;
  /**
   * The composite's clear colour, 0xRRGGBB. Black by default: on a projector
   * black is the absence of light, so a black background is what makes I-6's
   * additive assumption hold on a wall (D1).
   */
  background: number;
  layers: Layer[];
}

export interface SceneInit {
  id: string;
  name?: string;
  seed?: number;
  background?: number;
  layers?: Layer[];
}

export function createScene(init: SceneInit): Scene {
  return {
    version: SCENE_FORMAT_VERSION,
    id: init.id,
    name: init.name ?? init.id,
    seed: Number.isFinite(init.seed) ? (init.seed as number) >>> 0 : 1,
    background: Number.isFinite(init.background) ? (init.background as number) >>> 0 : 0x000000,
    layers: init.layers ?? [],
  };
}

/**
 * Draw order: `zOrder` ascending, ties broken by position in `layers`.
 *
 * The stable tie-break is the point. `Array.prototype.sort` has been stable
 * since ES2019, but relying on that implicitly would make the occlusion order
 * of two same-z layers an unstated property of the runtime; Gate 1 tests
 * reordering, so it is stated and tested here instead.
 */
export function layersInDrawOrder(scene: Scene): Layer[] {
  return scene.layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.zOrder - b.layer.zOrder || a.index - b.index)
    .map((e) => e.layer);
}

/** Re-indexes `zOrder` to 0..n-1 in current draw order. Used after a reorder. */
export function reindexZOrder(scene: Scene): Scene {
  const ordered = layersInDrawOrder(scene);
  const z = new Map(ordered.map((l, i) => [l.id, i]));
  return {
    ...scene,
    layers: scene.layers.map((l) => ({ ...l, zOrder: z.get(l.id) ?? l.zOrder })),
  };
}

export function serializeScene(scene: Scene): string {
  return JSON.stringify(scene);
}

export class SceneFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneFormatError';
  }
}

export function deserializeScene(json: string): Scene {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new SceneFormatError(`scene is not valid JSON: ${(e as Error).message}`);
  }
  return canonicalizeScene(raw);
}

/**
 * Accepts anything shaped roughly like a scene and returns a canonical one, or
 * throws. This is the single entry point for untrusted scene data — a file on
 * disk, an IPC payload, a scene bank entry.
 */
export function canonicalizeScene(raw: unknown): Scene {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SceneFormatError('scene must be an object');
  }
  const o = raw as Record<string, unknown>;
  const version = typeof o['version'] === 'number' ? o['version'] : SCENE_FORMAT_VERSION;
  if (version > SCENE_FORMAT_VERSION) {
    throw new SceneFormatError(
      `scene format v${version} is newer than this build understands (v${SCENE_FORMAT_VERSION})`,
    );
  }
  if (typeof o['id'] !== 'string' || o['id'] === '') {
    throw new SceneFormatError('scene.id must be a non-empty string');
  }
  const rawLayers = o['layers'];
  if (rawLayers !== undefined && !Array.isArray(rawLayers)) {
    throw new SceneFormatError('scene.layers must be an array');
  }
  const layers = (rawLayers ?? []).map((l, i) => canonicalizeLayer(l, i));
  const seen = new Set<string>();
  for (const l of layers) {
    if (seen.has(l.id)) throw new SceneFormatError(`duplicate layer id: ${l.id}`);
    seen.add(l.id);
  }
  return createScene({
    id: o['id'],
    name: typeof o['name'] === 'string' ? o['name'] : o['id'],
    seed: typeof o['seed'] === 'number' ? o['seed'] : 1,
    background: typeof o['background'] === 'number' ? o['background'] : 0x000000,
    layers,
  });
}

function canonicalizeLayer(raw: unknown, index: number): Layer {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SceneFormatError(`layers[${index}] must be an object`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || o['id'] === '') {
    throw new SceneFormatError(`layers[${index}].id must be a non-empty string`);
  }
  if (typeof o['providerId'] !== 'string' || o['providerId'] === '') {
    throw new SceneFormatError(`layers[${index}].providerId must be a non-empty string`);
  }
  const blendMode: BlendMode = isBlendMode(o['blendMode']) ? o['blendMode'] : 'normal';
  return createLayer({
    id: o['id'],
    name: typeof o['name'] === 'string' ? o['name'] : o['id'],
    providerId: o['providerId'],
    content: canonicalizeContent(o['content'], `layers[${index}].content`),
    transform: normalizeTransform(
      typeof o['transform'] === 'object' && o['transform'] !== null
        ? (o['transform'] as Record<string, number>)
        : undefined,
    ),
    zOrder: typeof o['zOrder'] === 'number' ? o['zOrder'] : index,
    opacity: clamp01(typeof o['opacity'] === 'number' ? o['opacity'] : 1),
    blendMode,
    depth: clamp01(typeof o['depth'] === 'number' ? o['depth'] : 0.5),
    visible: typeof o['visible'] === 'boolean' ? o['visible'] : true,
    ...(typeof o['seed'] === 'number' ? { seed: o['seed'] } : {}),
  });
}

/**
 * Provider config is opaque to the compositor but must still be JSON — it
 * crosses IPC (I-7) and it must survive a round-trip (I-12). Anything that is
 * not plain JSON is rejected here rather than at the send site, so a bad
 * content blob cannot reach `assertJsonOnly` and fail a scene save at the
 * worst possible moment.
 */
function canonicalizeContent(raw: unknown, path: string): JsonObject {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SceneFormatError(`${path} must be an object`);
  }
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = canonicalizeJson(v, `${path}.${k}`);
  }
  return out;
}

function canonicalizeJson(v: unknown, path: string): JsonValue {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'boolean' || t === 'string') return v as JsonValue;
  if (t === 'number') {
    if (!Number.isFinite(v as number)) {
      throw new SceneFormatError(`${path}: ${String(v)} is not JSON-representable`);
    }
    return v as number;
  }
  if (Array.isArray(v)) return v.map((item, i) => canonicalizeJson(item, `${path}[${i}]`));
  if (t === 'object') {
    // A typed array is an object with numeric keys, so `Object.entries` would
    // happily turn a 4 MB pixel buffer into a 4-million-key plain object and
    // call it valid scene state. Refused here, the same way `assertJsonOnly`
    // refuses it at the send site (I-7) — both boundaries, because content
    // reaches the scene from a provider as well as from IPC.
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
      throw new SceneFormatError(`${path}: pixel/binary buffers are not scene state (I-7)`);
    }
    const proto = Object.getPrototypeOf(v as object);
    if (proto !== Object.prototype && proto !== null) {
      throw new SceneFormatError(
        `${path}: only plain objects are scene state, got ${proto?.constructor?.name ?? 'unknown'}`,
      );
    }
    const out: JsonObject = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = canonicalizeJson(val, `${path}.${k}`);
    }
    return out;
  }
  throw new SceneFormatError(`${path}: ${t} cannot appear in scene state`);
}

/** Structural deep-equality, for I-12 assertions and Phase 6's history. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || !ka.every((k, i) => k === kb[i])) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}
