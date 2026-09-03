/**
 * Seeded RNG (I-12). No provider ever calls `Math.random()`.
 *
 * I-12's requirement is that "same state implies same intended look", so every
 * random number a provider draws must be reproducible from the scene JSON
 * alone. That means two things, and both are load-bearing:
 *
 *  1. The seed lives in scene state, not in the RNG. This module produces a
 *     stream from a number the scene already carries.
 *  2. A layer's stream is derived from `(scene.seed, layer.seed)`, so adding,
 *     deleting or reordering a layer cannot shift any other layer's stream.
 *     A single shared generator consumed in draw order would do exactly that,
 *     which is the classic way "deterministic" scenes stop being deterministic
 *     the moment someone edits them.
 */

/** A deterministic stream of numbers in [0, 1). */
export interface Rng {
  /** The 32-bit state this stream was constructed from. */
  readonly seed: number;
  /** Next value in [0, 1). */
  next(): number;
  /** Next value in [min, max). */
  range(min: number, max: number): number;
  /** Next integer in [0, n). Returns 0 for n <= 0. */
  int(n: number): number;
  /** Next value in [-1, 1). */
  signed(): number;
  /** True with probability p. */
  chance(p: number): boolean;
}

/**
 * FNV-1a over a string, to a 32-bit unsigned int. Used to turn a stable
 * identifier (a layer id, a provider-internal stream label) into a seed
 * without the caller having to invent numbers.
 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619, in 32-bit arithmetic that survives float64.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mix two seeds into one. Commutativity would be a bug here — `(scene, layer)`
 * and `(layer, scene)` must not collide — so the mix is deliberately
 * order-dependent.
 */
export function mixSeed(a: number, b: number): number {
  let h = (a >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = (h ^ (b >>> 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Mulberry32. Chosen over `Math.random`-alikes for three properties this
 * project needs and quality of distribution is not one of them: it is 32-bit
 * integer state (so it serializes exactly), it is seedable from a plain number,
 * and it is short enough to be obviously correct on inspection.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed: seed >>> 0,
    next,
    range: (min, max) => min + next() * (max - min),
    int: (n) => (n <= 0 ? 0 : Math.floor(next() * n) % n),
    signed: () => next() * 2 - 1,
    chance: (p) => next() < p,
  };
}

/**
 * The stream a layer's provider draws from. Derived, never stored — storing it
 * would create a second copy of a value the scene already determines, which is
 * the I-12 failure mode this file exists to prevent.
 *
 * `label` lets one provider keep several independent streams (positions vs.
 * colours, say) without one of them consuming the other's numbers.
 */
export function layerRng(sceneSeed: number, layerSeed: number, label = ''): Rng {
  const base = mixSeed(sceneSeed, layerSeed);
  return createRng(label === '' ? base : mixSeed(base, hashString(label)));
}
