/**
 * The headless render smoke test (SPEC.md §8.1, from Phase 1).
 *
 * Fixed seed, clock paused, no video — the exact deterministic subset I-12
 * permits pixel comparison for. One frame is rendered per case, the backing
 * store is hashed, and `scripts/golden.mjs` compares the hash to a committed
 * golden.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A8 — THE GOLDEN RESOLUTION IS FIXED HERE AND NOWHERE ELSE.
 *
 * `GOLDEN_RESOLUTION` is a literal. It must NEVER be imported from
 * `DEV_RESOLUTION` or `TARGET_RESOLUTION`, and it must never be read from a
 * display, a window, or an environment variable.
 *
 * It presently equals DEV_RESOLUTION (1280×720). That is a coincidence of the
 * projector's native mode, not a relationship, and it is the single most
 * dangerous thing about this file: the two numbers look identical, so a future
 * reader can "tidy" the literal into an import without appearing to change
 * anything. If the golden resolution ever tracks whichever resolution the app
 * happens to run at, the first 1080p run re-blesses every golden at once and
 * the regression net is gone — silently, in a commit that looks routine
 * (SPEC.md §8.1).
 *
 * A unit test asserts that this file imports neither resolution constant.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import 'pixi.js/unsafe-eval';
import { Application, Assets, Rectangle } from 'pixi.js';
import { createLayer } from '../core/layer';
import { createScene, type Scene } from '../core/scene';
import { addLayer, moveLayer } from '../core/sceneEdit';
import { createDefaultScene, createPhase3Scene } from '../core/defaultScene';
import { ProviderRegistry } from '../providers/ContentProvider';
import { ProceduralProvider } from '../providers/procedural/ProceduralProvider';
import { BundledProvider, BUNDLED_PROVIDER_ID } from '../providers/bundled/BundledProvider';
import { BUNDLED_ASSETS, createBundledLibrary } from '../providers/bundled/manifest';
import { Compositor } from '../render/compositor';
import { WarpStage } from '../render/warp';
import {
  createCalibration,
  withCorner,
  withEnabled,
  type ViewportCalibration,
} from '../render/calibration';

/** A8: a literal, decided in Phase 1's setup. Read the block comment above. */
const GOLDEN_RESOLUTION = { width: 1280, height: 720 } as const;

/**
 * I-12's deterministic subset: fixed seed, no video, clock paused.
 *
 * The clock is paused by *not existing here at all* — the golden harness drives
 * the compositor directly with a fixed frame, so there is no `Clock` to pause
 * and nothing that could drift between a bless and a check.
 *
 * `GOLDEN_PHASE` predates I-2 and is kept at 0.25 deliberately: re-deriving it
 * from `GLOBAL_LOOP_SECONDS` would change nothing about the frames but would
 * re-bless all 19 for a reason nobody could state later. `GOLDEN_TIME_SECONDS`
 * is the same instant expressed as clock time — 0.25 of a 4-second loop — so a
 * provider reading either field sees one consistent moment.
 */
const GOLDEN_PHASE = 0.25;
const GOLDEN_TIME_SECONDS = 1;

/**
 * The one frame every golden case is drawn at. A frozen `LayerFrame` rather
 * than a pair of loose numbers, so a field added to the contract later is a
 * compile error here instead of a silently-defaulted golden.
 */
const GOLDEN_FRAME = {
  timeSeconds: GOLDEN_TIME_SECONDS,
  phase: GOLDEN_PHASE,
  // Paused, which is I-12's deterministic subset stated rather than implied.
  playing: false,
  rate: 1,
  scrubSeq: 0,
} as const;

const PROVIDER_ID = 'procedural';

interface GoldenCase {
  name: string;
  scene: Scene;
  /** Rendered at this size instead of GOLDEN_RESOLUTION, for the I-1 cases. */
  size?: { width: number; height: number };
  /**
   * I-1. Compare this case's layout against another case rendered at a
   * different resolution. A hash cannot do it — different pixel counts hash
   * differently by construction — so the comparison is made on a
   * resolution-independent luminance signature instead.
   */
  compareTo?: string;
  /**
   * Apply this scene FIRST, then `scene`, on the same Application. The editor
   * never renders a scene into a fresh compositor — it always replaces a live
   * one — and every other case here calls `setScene` exactly once, so the
   * teardown-and-rebuild path had no coverage at all.
   */
  afterScene?: Scene;
  /**
   * A negative control: this case is *deliberately* mislaid, and its delta must
   * land ABOVE the runner's threshold. Without one, the threshold is taste — it
   * would pass a measure that reported zero for everything.
   */
  expectLayoutMismatch?: boolean;
  /**
   * I-5. Put the warp stage in this case's path with this calibration. Absent
   * means the Phase 1 pipeline exactly — no render texture, no mesh — which is
   * what the `warp-identity` and `warp-disabled` cases are compared against.
   */
  warp?: ViewportCalibration;
  /**
   * Asset URLs to load before rendering.
   *
   * Phase 3's views populate themselves after `create` returns (I-3: `create`
   * is synchronous so a scene switch never stalls on a load). A single-frame
   * harness would therefore hash the I-13 placeholder every time and call it a
   * sprite. Pre-loading warms `Assets`' cache so each view's own
   * `Assets.load` resolves on the next microtask, which the runner then waits
   * for. Without this every bundled golden would be a picture of a magenta box
   * — and would be perfectly stable, which is the worst kind of wrong.
   */
  preload?: readonly string[];
}

/**
 * The signature grid for the I-1 comparison. Coarse on purpose: a 1-pixel
 * stroke covers twice the fraction of a 640-wide frame that it does of a
 * 1280-wide one, so a fine grid would measure stroke rasterization rather than
 * layout. 32x18 cells is coarse enough to be about *where things are*.
 */
const SIGNATURE_COLS = 32;
const SIGNATURE_ROWS = 18;

function cases(): GoldenCase[] {
  const stack = (): Scene =>
    createScene({
      id: 'golden-stack',
      seed: 0x5eed,
      background: 0x000000,
      layers: [
        createLayer({
          id: 'water',
          providerId: PROVIDER_ID,
          content: { kind: 'water', bands: 16 },
          transform: { x: 0.5, y: 0.78, width: 1, height: 0.42, rotation: 0 },
          zOrder: 0,
        }),
        createLayer({
          id: 'tree',
          providerId: PROVIDER_ID,
          content: { kind: 'tree' },
          transform: { x: 0.32, y: 0.56, width: 0.42, height: 0.72, rotation: 0 },
          zOrder: 1,
        }),
        createLayer({
          id: 'glow',
          providerId: PROVIDER_ID,
          content: { kind: 'glow', rings: 24, tint: 0xffb040 },
          transform: { x: 0.32, y: 0.42, width: 0.36, height: 0.36, rotation: 0 },
          zOrder: 2,
          blendMode: 'add',
        }),
      ],
    });

  const faulty = createScene({
    id: 'golden-faulty',
    seed: 7,
    layers: [
      createLayer({
        id: 'ok',
        providerId: PROVIDER_ID,
        content: { kind: 'glow', rings: 12 },
        transform: { x: 0.25, y: 0.5, width: 0.4, height: 0.6, rotation: 0 },
        zOrder: 0,
      }),
      createLayer({
        id: 'broken',
        name: 'Broken',
        providerId: PROVIDER_ID,
        content: { kind: 'fault' },
        transform: { x: 0.72, y: 0.5, width: 0.44, height: 0.6, rotation: 0 },
        zOrder: 1,
      }),
      createLayer({
        id: 'no-such-provider',
        name: 'Missing provider',
        providerId: 'catalog-that-does-not-exist-yet',
        transform: { x: 0.5, y: 0.14, width: 0.5, height: 0.18, rotation: 0 },
        zOrder: 2,
      }),
    ],
  });

  // `default` and `stack` render the same three layers; the default scene also
  // carries the test-pattern layer with `visible: false`. Their hashes are
  // therefore expected to be EQUAL, and that equality is the assertion: an
  // invisible layer must contribute exactly zero pixels, not merely few.
  return [
    { name: 'default', scene: createDefaultScene() },
    { name: 'stack', scene: stack() },
    // I-1: the same scene at a different resolution. Compared as its own
    // golden, and checked for equal layout by scripts/golden.mjs.
    {
      name: 'stack@640x360',
      scene: stack(),
      size: { width: 640, height: 360 },
      compareTo: 'stack',
    },
    // The control. One layer nudged by 0.05 of the frame width — a shift small
    // enough to be easy to miss by eye, and the smallest thing the I-1 check
    // has to be able to see.
    {
      name: 'stack-shifted@640x360',
      scene: shifted(stack(), 'tree', 0.05),
      size: { width: 640, height: 360 },
      compareTo: 'stack',
      expectLayoutMismatch: true,
    },
    // Gate 1: reordering layers changes occlusion correctly. Two opaque
    // overlapping rects, the same scene with the z-order swapped. The hashes
    // must differ AND the centre pixel must be whichever layer is on top.
    { name: 'occlusion-red-over-blue', scene: occlusionScene('red') },
    { name: 'occlusion-blue-over-red', scene: occlusionScene('blue') },
    // The editor's actual path: a live compositor is handed a new scene. This
    // must land on exactly the same pixels as rendering that scene cold.
    {
      name: 'occlusion-reordered-live',
      scene: moveLayer(occlusionScene('red'), 'blue', 1),
      afterScene: occlusionScene('red'),
    },
    // EXACTLY the operator's click sequence: the default scene, "+ rect",
    // "+ rect", then the top one moved back one place. If these two hash the
    // same, the layer list cannot demonstrate z-order no matter how correct
    // the engine is — which is the failure this pair exists to catch, and the
    // one that wasted three rounds of clicking on the wall.
    { name: 'editor-two-rects', scene: twoRects(false) },
    { name: 'editor-two-rects-swapped', scene: twoRects(true) },
    // The operator's remaining complaint: everything reorders except `water`.
    // Same scene, water dragged from the back to the very front. If this
    // hashes the same as `editor-two-rects`, the water layer genuinely draws
    // nothing where it overlaps — and that is a defect in the layer, not in
    // the ordering.
    { name: 'editor-water-to-front', scene: waterToFront() },
    { name: 'testPattern', scene: testPatternScene() },
    // Gate 1, condition 1: identical scenes but for the glow's blend mode. The
    // ONLY difference is `add` vs `normal`, so the gap between their mean
    // luminances is the additive contribution and nothing else.
    { name: 'glow-normal', scene: glowOverTree('normal') },
    { name: 'glow-add', scene: glowOverTree('add') },
    { name: 'blend-modes', scene: blendScene() },
    { name: 'resilience', scene: faulty },

    // -----------------------------------------------------------------------
    // I-5, Gate 2. Three of these four are about the warp NOT changing things.
    //
    // `warp-disabled` has the stage constructed and switched off; `warp-identity`
    // has it switched on with the unit square. Both must hash EXACTLY equal to
    // `default`, which has no warp stage at all. The second is the one worth
    // distrusting: it is a full round trip through a render texture and a
    // 20x20 mesh, and a half-pixel misalignment there would put a resample blur
    // on the wall that the projector currently gets blamed for.
    //
    // `warp-keystone` must differ from `default`. A warp that changes nothing
    // is the failure a hash alone would happily record.
    // -----------------------------------------------------------------------
    { name: 'warp-disabled', scene: createDefaultScene(), warp: warpOff() },
    { name: 'warp-identity', scene: createDefaultScene(), warp: warpIdentity() },
    { name: 'warp-keystone', scene: createDefaultScene(), warp: warpKeystone() },
    // The eyeball case. A grid is the only thing in the scene bank that makes a
    // projective bend visible to a person, and the `.golden-preview/` PNG is
    // where the re-bless is judged rather than taken on trust.
    { name: 'warp-keystone-grid', scene: testPatternScene(), warp: warpKeystone() },

    // -----------------------------------------------------------------------
    // Phase 3 — the bundled library (D6, I-10) and the new layer types.
    //
    // Video is present but NEVER decoded: `decodeVideo: false` in the runner.
    // I-12's deterministic subset is "fixed seed, no video, clock paused", so a
    // decoder here would make the hash a function of decode timing and the
    // goldens would flap. What the video cases DO cover is the §5 preview path
    // — poster plus badge — which is a real rendering and needed one.
    //
    // Every one of these is a picture of a specific claim, because a hash of a
    // magenta placeholder is a perfectly stable hash of nothing. `preload` is
    // what stops that: see `GoldenCase.preload`.
    // -----------------------------------------------------------------------
    {
      // Gate 3: "a Kenney alpha sprite renders with correct alpha and correct
      // blend mode". NORMAL blend, so the sprite's own alpha is the whole of
      // what is being judged — a premultiply bug shows here as a grey box.
      name: 'bundled-alpha-normal',
      scene: bundledStills('normal'),
      preload: stillUrls,
    },
    {
      // The same sprites on `add` (I-6). This case and the one above differ in
      // NOTHING but blend mode, so the difference between their mean
      // luminances is the additive gain itself — the same shape of evidence
      // Gate 1 used for the procedural glow.
      name: 'bundled-alpha-add',
      scene: bundledStills('add'),
      preload: stillUrls,
    },
    {
      // Both sheets at the pinned clock. `GOLDEN_FRAME.timeSeconds` is 1 s, so
      // the 2.5 s sheet is at frame 10 of 25 and the 1.8 s sheet at frame 5 of
      // 9 — two different frames from one clock, which is I-2 in a picture.
      name: 'bundled-spritesheets',
      scene: bundledSheets('none'),
      preload: sheetUrls,
    },
    {
      // D5's crossfade. Same scene, same clock, `seam: 'crossfade'` — so this
      // hash MUST differ from the case above, and a crossfade that silently did
      // nothing would be caught by them matching.
      name: 'bundled-spritesheets-crossfade',
      scene: bundledSheets('crossfade'),
      preload: sheetUrls,
    },
    {
      // The Lottie, driven to a frame by the clock rather than by its own
      // timeline. lottie-web is loaded from the light canvas build (no `eval`,
      // CSP), so this also proves that build actually renders.
      name: 'bundled-lottie',
      scene: bundledLottie(),
    },
    {
      // Gate 3's stated layer load, as the editor preview sees it.
      name: 'phase3-load-preview',
      scene: createPhase3Scene(),
      preload: allBundledUrls,
    },

    {
      // I-13. A scene naming an asset this build does not have must come back
      // as a flagged placeholder, not as a crash and not as a black rectangle.
      name: 'bundled-missing-asset',
      scene: bundledMissing(),
    },
  ];
}

/** Kenney's alpha particles, laid out in a row. `blend` is the whole variable. */
function bundledStills(blend: 'normal' | 'add'): Scene {
  const ids = [
    'kenney.particle.flame',
    'kenney.particle.star',
    'kenney.particle.spark',
    'kenney.particle.light',
  ];
  return createScene({
    id: `golden-bundled-still-${blend}`,
    seed: 0x5eed,
    // Deliberately NOT black: an alpha bug shows as an opaque box, and against
    // black an opaque black box is invisible. A dark blue ground makes the
    // failure visible in the PNG a person actually looks at.
    background: 0x101828,
    layers: ids.map((assetId, i) =>
      createLayer({
        id: `still${i}`,
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId },
        transform: { x: 0.15 + i * 0.235, y: 0.5, width: 0.22, height: 0.39, rotation: 0 },
        zOrder: i,
        blendMode: blend,
      }),
    ),
  });
}

function bundledSheets(seam: 'none' | 'crossfade'): Scene {
  return createScene({
    id: `golden-bundled-sheets-${seam}`,
    seed: 0x5eed,
    background: 0x101828,
    layers: [
      createLayer({
        id: 'puff',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'kenney.smoke.whitePuff', seam },
        transform: { x: 0.28, y: 0.5, width: 0.44, height: 0.78, rotation: 0 },
        zOrder: 0,
      }),
      createLayer({
        id: 'burst',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'kenney.smoke.explosion', seam },
        transform: { x: 0.72, y: 0.5, width: 0.44, height: 0.78, rotation: 0 },
        zOrder: 1,
      }),
    ],
  });
}

function bundledLottie(): Scene {
  return createScene({
    id: 'golden-bundled-lottie',
    seed: 0x5eed,
    background: 0x101828,
    layers: [
      createLayer({
        id: 'rings',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'authored.lottie.clockRings' },
        transform: { x: 0.5, y: 0.5, width: 0.62, height: 1, rotation: 0 },
        zOrder: 0,
      }),
    ],
  });
}

function bundledMissing(): Scene {
  return createScene({
    id: 'golden-bundled-missing',
    seed: 0x5eed,
    background: 0x000000,
    layers: [
      createLayer({
        id: 'gone',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'no.such.asset' },
        transform: { x: 0.5, y: 0.5, width: 0.7, height: 0.6, rotation: 0 },
        zOrder: 0,
      }),
    ],
  });
}

/** Pulled from the manifest rather than retyped, so a renamed asset is a build error. */
const urlOf = (id: string): string => {
  const a = BUNDLED_ASSETS.find((x) => x.id === id);
  if (!a) throw new Error(`golden: no bundled asset "${id}"`);
  return a.url;
};
const posterOf = (id: string): string => {
  const a = BUNDLED_ASSETS.find((x) => x.id === id);
  if (!a || a.kind !== 'video') throw new Error(`golden: no bundled video "${id}"`);
  return a.posterUrl;
};
const stillUrls = [
  urlOf('kenney.particle.flame'),
  urlOf('kenney.particle.star'),
  urlOf('kenney.particle.spark'),
  urlOf('kenney.particle.light'),
];
const sheetUrls = [urlOf('kenney.smoke.whitePuff'), urlOf('kenney.smoke.explosion')];
const allBundledUrls = [...sheetUrls, posterOf('test.video.seamless')];

/** The stage present and switched off — the toggle, not the absence of code. */
function warpOff(): ViewportCalibration {
  return createCalibration('golden');
}

function warpIdentity(): ViewportCalibration {
  return withEnabled(createCalibration('golden'), true);
}

/**
 * The shape a projector sitting below its surface and tilted up produces, and
 * therefore the correction for it: the top corners pulled in. Deliberately a
 * strong keystone — a subtle one would hide the affine bend a bare 2x2 quad
 * produces, which is the whole reason the mesh is subdivided.
 */
function warpKeystone(): ViewportCalibration {
  let cal = withEnabled(createCalibration('golden'), true);
  cal = withCorner(cal, 0, { x: 0.12, y: 0 });
  cal = withCorner(cal, 1, { x: 0.88, y: 0 });
  return cal;
}

/** Moves one layer along x, in normalized space. The I-1 control's mislaying. */
function shifted(scene: Scene, layerId: string, dx: number): Scene {
  return {
    ...scene,
    id: `${scene.id}-shifted`,
    layers: scene.layers.map((l) =>
      l.id === layerId ? { ...l, transform: { ...l.transform, x: l.transform.x + dx } } : l,
    ),
  };
}

function glowOverTree(blendMode: 'normal' | 'add'): Scene {
  return createScene({
    id: `golden-glow-${blendMode}`,
    seed: 0x5eed,
    background: 0x000000,
    layers: [
      createLayer({
        id: 'tree',
        providerId: PROVIDER_ID,
        content: { kind: 'tree' },
        transform: { x: 0.5, y: 0.56, width: 0.5, height: 0.72, rotation: 0 },
        zOrder: 0,
      }),
      createLayer({
        id: 'glow',
        providerId: PROVIDER_ID,
        content: { kind: 'glow', rings: 24, tint: 0xffb040 },
        transform: { x: 0.5, y: 0.42, width: 0.4, height: 0.4, rotation: 0 },
        zOrder: 1,
        blendMode,
      }),
    ],
  });
}

/** The default scene after two "+ rect" clicks, optionally reordered. */
function twoRects(swapped: boolean): Scene {
  const spec = { idPrefix: 'rect', providerId: PROVIDER_ID, content: { kind: 'rect' } };
  const s = addLayer(addLayer(createDefaultScene(), spec), spec);
  return swapped ? moveLayer(s, 'rect-2', -1) : s;
}

/** `twoRects(false)` with `water` moved all the way to the front. */
function waterToFront(): Scene {
  let s = twoRects(false);
  for (let i = 0; i < 6; i++) s = moveLayer(s, 'water', 1);
  return s;
}

const OCCLUSION_RED = 0xd02020;
const OCCLUSION_BLUE = 0x2040d0;

function occlusionScene(top: 'red' | 'blue'): Scene {
  const z = (which: 'red' | 'blue'): number => (which === top ? 1 : 0);
  return createScene({
    id: `golden-occlusion-${top}`,
    seed: 5,
    background: 0x000000,
    layers: [
      createLayer({
        id: 'red',
        providerId: PROVIDER_ID,
        content: { kind: 'rect', tint: OCCLUSION_RED },
        transform: { x: 0.42, y: 0.5, width: 0.4, height: 0.4, rotation: 0 },
        zOrder: z('red'),
      }),
      createLayer({
        id: 'blue',
        providerId: PROVIDER_ID,
        content: { kind: 'rect', tint: OCCLUSION_BLUE },
        transform: { x: 0.58, y: 0.5, width: 0.4, height: 0.4, rotation: 0 },
        zOrder: z('blue'),
      }),
    ],
  });
}

function testPatternScene(): Scene {
  return createScene({
    id: 'golden-testpattern',
    seed: 1,
    layers: [
      createLayer({
        id: 'tp',
        providerId: PROVIDER_ID,
        content: { kind: 'testPattern', cells: 8 },
        zOrder: 0,
      }),
    ],
  });
}

/** One glow per blend mode, over a lit background, so the four differ. */
function blendScene(): Scene {
  const modes = ['normal', 'add', 'multiply', 'screen'] as const;
  return createScene({
    id: 'golden-blends',
    seed: 3,
    background: 0x101820,
    layers: [
      createLayer({
        id: 'under',
        providerId: PROVIDER_ID,
        content: { kind: 'water', bands: 10, tint: 0x3388aa },
        zOrder: 0,
      }),
      ...modes.map((blendMode, i) =>
        createLayer({
          id: `glow-${blendMode}`,
          providerId: PROVIDER_ID,
          content: { kind: 'glow', rings: 18, tint: 0xffb040 },
          transform: {
            x: (i + 0.5) / modes.length,
            y: 0.5,
            width: 1 / modes.length,
            height: 0.5,
            rotation: 0,
          },
          zOrder: i + 1,
          blendMode,
        }),
      ),
    ],
  });
}

export interface GoldenResult {
  name: string;
  width: number;
  height: number;
  /** FNV-1a over the RGBA backing store. */
  hash: string;
  /** Share of non-black pixels. A blank frame is a bug, not a passing hash. */
  coverage: number;
  /** I-13: layers that fell back to a placeholder. */
  failures: { layerId: string; reason: string }[];
  /**
   * I-1: how far this case's layout is from the case it names, on a
   * resolution-independent luminance signature. Null when nothing to compare.
   */
  layoutDelta: { against: string; maxCell: number; meanCell: number } | null;
  /** True for the negative control, whose delta must exceed the threshold. */
  expectLayoutMismatch: boolean;
  /**
   * Gate 1: "reordering layers changes occlusion correctly". The RGB of the
   * pixel at the centre of the frame, where two opaque layers overlap — so the
   * gate is answered by which colour is actually there, not by a hash saying
   * something changed.
   */
  centrePixel: [number, number, number];
  /**
   * I-6, Gate 1: mean luminance of the frame, in [0, 1]. The `add` and
   * `normal` variants of one glow scene differ only in blend mode, so the
   * difference between their means is the additive brightening itself —
   * a number rather than an impression.
   */
  meanLuminance: number;
  /** PNG data URL, written to disk by the runner for eyeballing. */
  png: string;
}

/**
 * Mean luminance per cell of a SIGNATURE_COLS x SIGNATURE_ROWS grid, in [0, 1].
 * Resolution-independent by construction: the grid is a fraction of the frame,
 * not a pixel count.
 */
function signature(pixels: Uint8ClampedArray, width: number, height: number): Float64Array {
  const cells = new Float64Array(SIGNATURE_COLS * SIGNATURE_ROWS);
  const counts = new Float64Array(SIGNATURE_COLS * SIGNATURE_ROWS);
  for (let y = 0; y < height; y++) {
    const row = Math.min(SIGNATURE_ROWS - 1, Math.floor((y / height) * SIGNATURE_ROWS));
    for (let x = 0; x < width; x++) {
      const col = Math.min(SIGNATURE_COLS - 1, Math.floor((x / width) * SIGNATURE_COLS));
      const i = (y * width + x) * 4;
      const lum =
        0.2126 * (pixels[i] as number) +
        0.7152 * (pixels[i + 1] as number) +
        0.0722 * (pixels[i + 2] as number);
      const c = row * SIGNATURE_COLS + col;
      cells[c] = (cells[c] as number) + lum / 255;
      counts[c] = (counts[c] as number) + 1;
    }
  }
  for (let i = 0; i < cells.length; i++) {
    cells[i] = (counts[i] as number) > 0 ? (cells[i] as number) / (counts[i] as number) : 0;
  }
  return cells;
}

function meanLuminance(pixels: Uint8ClampedArray): number {
  let sum = 0;
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    sum +=
      0.2126 * (pixels[i] as number) +
      0.7152 * (pixels[i + 1] as number) +
      0.0722 * (pixels[i + 2] as number);
  }
  return sum / n / 255;
}

/** RGB at the exact centre of the frame. */
function centreRgb(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const i = ((height >> 1) * width + (width >> 1)) * 4;
  return [pixels[i] as number, pixels[i + 1] as number, pixels[i + 2] as number];
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function run(): Promise<GoldenResult[]> {
  const results: GoldenResult[] = [];
  const signatures = new Map<string, Float64Array>();
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('no #stage');

  for (const c of cases()) {
    const size = c.size ?? GOLDEN_RESOLUTION;
    const app = new Application();
    await app.init({
      width: size.width,
      height: size.height,
      background: 0x000000,
      antialias: false,
      preference: 'webgl',
      resolution: 1,
      autoDensity: false,
      autoStart: false,
      sharedTicker: false,
    });
    stage.appendChild(app.canvas);

    const providers = new ProviderRegistry();
    providers.register(new ProceduralProvider());
    // D6's bundled provider. `decodeVideo: false` on purpose and twice over:
    // I-12's deterministic subset is "fixed seed, NO VIDEO, clock paused", and
    // a decoder in a golden would make the hash a function of decode timing.
    // It also means the video cases here render the §5 preview path — poster
    // plus badge — which is a thing worth having a golden of.
    providers.register(
      new BundledProvider({
        library: createBundledLibrary(),
        decodeVideo: false,
        lottieResolution: 256,
      }),
    );
    const compositor = new Compositor({
      providers,
      width: size.width,
      height: size.height,
    });
    // The warp stage parents the composite itself when present — whether the
    // composite is a stage child or feeds a render texture is what it owns.
    const warp = c.warp
      ? new WarpStage({
          renderer: app.renderer,
          stage: app.stage,
          source: compositor.view,
          width: size.width,
          height: size.height,
          // Quiet here; the `[warp]` line has its own unit tests, and the
          // harness treats renderer output as a failure signal.
          log: () => {},
        })
      : null;
    if (!warp) app.stage.addChild(compositor.view);
    warp?.setCalibration(c.warp!);

    if (c.preload && c.preload.length > 0) {
      // A load that fails is not fatal here: the case then hashes its I-13
      // placeholder, which is a real state and one the runner should be able
      // to bless rather than crash on.
      await Promise.allSettled(c.preload.map((u) => Assets.load(u)));
    }

    if (c.afterScene) {
      // Mount one scene, run a frame, then replace it — the editor's path.
      compositor.setScene(c.afterScene);
      compositor.update(GOLDEN_FRAME);
      warp?.prepare();
      app.renderer.render(app.stage);
    }
    compositor.setScene(c.scene);
    // Two updates, one render: `isolateUpdate` swaps a layer that throws for a
    // placeholder on the frame it throws, so a single-frame harness would hash
    // the frame before the swap and never see the placeholder it is meant to
    // be testing (I-13).
    compositor.update(GOLDEN_FRAME);
    compositor.update(GOLDEN_FRAME);
    // Let each view's own `Assets.load(...).then(...)` run. The cache is warm
    // from `preload` above, so this is a microtask drain rather than a wait —
    // but it has to happen between `setScene` and the render or the frame is
    // hashed before any texture has been attached.
    if (c.preload && c.preload.length > 0) {
      await new Promise((r) => setTimeout(r, 0));
      compositor.update(GOLDEN_FRAME);
    }
    warp?.prepare();
    app.renderer.render(app.stage);

    // The frame is stated explicitly. `extract.pixels(stage)` frames the
    // stage's *bounds*, which a layer wider than the output silently enlarges —
    // the golden would then hash a different pixel count than the one the
    // harness claims to render at, and the A8 resolution guarantee would be
    // quietly untrue. (Caught here by a blend-modes case reporting 100.0002%
    // coverage on a 1280x720 frame.)
    const frame = new Rectangle(0, 0, size.width, size.height);
    const pixels = app.renderer.extract.pixels({ target: app.stage, frame });
    let lit = 0;
    for (let i = 0; i < pixels.pixels.length; i += 4) {
      if (
        (pixels.pixels[i] as number) > 8 ||
        (pixels.pixels[i + 1] as number) > 8 ||
        (pixels.pixels[i + 2] as number) > 8
      ) {
        lit++;
      }
    }
    const canvas = app.renderer.extract.canvas({ target: app.stage, frame }) as HTMLCanvasElement;

    signatures.set(c.name, signature(pixels.pixels, size.width, size.height));

    results.push({
      name: c.name,
      width: size.width,
      height: size.height,
      hash: fnv1a(new Uint8Array(pixels.pixels.buffer, pixels.pixels.byteOffset, pixels.pixels.byteLength)),
      coverage: lit / (size.width * size.height),
      failures: compositor.failures().map((f) => ({ layerId: f.layerId, reason: f.reason })),
      png: canvas.toDataURL('image/png'),
      layoutDelta: null,
      expectLayoutMismatch: c.expectLayoutMismatch === true,
      centrePixel: centreRgb(pixels.pixels, size.width, size.height),
      meanLuminance: Number(meanLuminance(pixels.pixels).toFixed(6)),
    });

    compositor.destroy();
    app.destroy(true, { children: true });
    warp?.destroy();
    stage.replaceChildren();
  }

  for (const c of cases()) {
    if (!c.compareTo) continue;
    const mine = signatures.get(c.name);
    const theirs = signatures.get(c.compareTo);
    const result = results.find((r) => r.name === c.name);
    if (!mine || !theirs || !result) continue;
    let max = 0;
    let sum = 0;
    for (let i = 0; i < mine.length; i++) {
      const d = Math.abs((mine[i] as number) - (theirs[i] as number));
      if (d > max) max = d;
      sum += d;
    }
    result.layoutDelta = {
      against: c.compareTo,
      maxCell: Number(max.toFixed(6)),
      meanCell: Number((sum / mine.length).toFixed(6)),
    };
  }

  return results;
}

declare global {
  interface Window {
    __golden?: Promise<GoldenResult[]>;
  }
}

window.__golden = run();
