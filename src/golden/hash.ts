/**
 * Pixel hashing for the golden harness, in its own module so it can be
 * unit-tested with no GPU and no DOM (§8.1). `main.ts` imports pixi and cannot
 * be reached from vitest; an assertion that decides whether a gate passes is
 * worth more than the convenience of keeping it beside its caller.
 */

/** Normalized, centre-based — the same shape `GoldenCase.region` uses (I-1). */
export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Pixel bounds of a normalized rect, **outset by one pixel on every edge**.
 *
 * Deliberately the opposite of `hashRegion`'s inset, and for the mirror-image
 * reason. `region` asks *"are these pixels identical"*, so it steps inside the
 * antialiased boundary to avoid hashing a fringe blended against something that
 * is meant to move. An exclusion asks *"ignore this area"*, so it must step
 * **outside** the boundary — an exclusion that stops one pixel short leaves the
 * glyph's own antialiased fringe in the hash, which is the fringe most likely
 * to move when a rasteriser changes. Inset here would reproduce the bug.
 */
export function excludeBounds(width: number, height: number, r: NormRect): PixelBounds {
  const x0 = Math.max(0, Math.round((r.x - r.width / 2) * width) - 1);
  const y0 = Math.max(0, Math.round((r.y - r.height / 2) * height) - 1);
  const x1 = Math.min(width - 1, Math.round((r.x + r.width / 2) * width));
  const y1 = Math.min(height - 1, Math.round((r.y + r.height / 2) * height));
  return { x0, y0, x1, y1 };
}

function inBounds(b: PixelBounds, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

function inAny(bs: PixelBounds[], x: number, y: number): boolean {
  for (const b of bs) if (inBounds(b, x, y)) return true;
  return false;
}

export interface FrameStats {
  /** FNV-1a over every RGBA byte outside the excluded rect. */
  hash: string;
  /** Pixels that were skipped. Zero when no rect is given. */
  excluded: number;
  /** Pixels that were hashed. */
  counted: number;
  /** Mean relative luminance over the counted pixels, in [0, 1]. */
  meanLuminance: number;
  /** Counted pixels above the lit threshold. */
  lit: number;
}

/**
 * Hash and summarise a frame, optionally skipping one rectangle.
 *
 * With no rects this is byte-for-byte the previous whole-frame behaviour — the
 * 40 cases that declare no exclusion keep the hashes they were blessed with,
 * which is asserted in `golden.test.ts` rather than assumed here.
 *
 * The excluded area is skipped by **every** statistic, not only the hash.
 * Excluding it from the hash alone would leave `meanLuminance` and `coverage`
 * still reading the glyphs, so the next rasteriser change would fail the case
 * on a different line and the fix would have bought one release.
 */
export function hashFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  rects?: readonly NormRect[],
): FrameStats {
  const bs = (rects ?? []).map((r) => excludeBounds(width, height, r));
  let h = 0x811c9dc5;
  let excluded = 0;
  let counted = 0;
  let lum = 0;
  let lit = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bs.length > 0 && inAny(bs, x, y)) {
        excluded++;
        continue;
      }
      const i = (y * width + x) * 4;
      const r = pixels[i] as number;
      const g = pixels[i + 1] as number;
      const bl = pixels[i + 2] as number;
      const a = pixels[i + 3] as number;
      h ^= r;
      h = Math.imul(h, 0x01000193);
      h ^= g;
      h = Math.imul(h, 0x01000193);
      h ^= bl;
      h = Math.imul(h, 0x01000193);
      h ^= a;
      h = Math.imul(h, 0x01000193);
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      if (r > 8 || g > 8 || bl > 8) lit++;
      counted++;
    }
  }
  return {
    hash: (h >>> 0).toString(16).padStart(8, '0'),
    excluded,
    counted,
    meanLuminance: counted > 0 ? lum / counted / 255 : 0,
    lit,
  };
}

/**
 * The first pixel outside the excluded rect, scanning from the origin.
 *
 * Used by the live negative control: a hash that ignores a rectangle must still
 * see a change one pixel outside it. `region` shipped with a negative control
 * for the same reason, and this project has already shipped an assertion that
 * could not fail.
 */
export function firstPixelOutside(
  width: number,
  height: number,
  rects: readonly NormRect[],
): [number, number] | null {
  const bs = rects.map((r) => excludeBounds(width, height, r));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inAny(bs, x, y)) return [x, y];
    }
  }
  return null;
}
