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
import {
  createDefaultScene,
  createPhase3Scene,
  createPhase4Scene,
  createPhase4ReferenceScene,
} from '../core/defaultScene';

/**
 * The reference patch's own box, from `createPhase4ReferenceScene`. Kept beside
 * the cases that use it so the two cannot drift apart silently — a region that
 * no longer covers the patch would pass this assertion by hashing black.
 */
const REFERENCE_PATCH_REGION = { x: 0.5, y: 0.5, width: 0.34, height: 0.44 };
import { ProviderRegistry, type LayerFrame } from '../providers/ContentProvider';
import { EMPTY_FORCE_FIELD, evaluateForces, type ForceField } from '../core/forces';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import { ProceduralProvider } from '../providers/procedural/ProceduralProvider';
import { BundledProvider, BUNDLED_PROVIDER_ID } from '../providers/bundled/BundledProvider';
import { BUNDLED_ASSETS, createBundledLibrary } from '../providers/bundled/manifest';
import { ensureLottie } from '../providers/bundled/LottieView';
import { Compositor } from '../render/compositor';
import { createPath } from '../core/paths';
import { DEFAULT_ROUTE_MOTION, createRouteMotion } from '../core/motion';
import { createSurface, type SurfaceTree } from '../core/surfaces';
import { readRenderTargets, type RenderTargetCensus } from '../debug/gpu';
import { WarpStage } from '../render/warp';
import {
  createCalibration,
  withCorner,
  withEnabled,
  type ViewportCalibration,
} from '../render/calibration';
import { firstPixelOutside, hashFrame } from './hash';

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
  // I-4's identity. Every axis at its identity value, so the force bus reaches
  // the compositor here exactly as it does live and contributes nothing — which
  // is what makes "the 19 Phase 1-2 frames are byte-identical" a statement
  // about the bus rather than about the harness having been kept away from it.
  //
  // Phase 4's own golden cases pass a POPULATED field instead, per case, so the
  // deterministic subset (fixed seed, no video, clock paused) still covers what
  // forces do. See `forceField(...)` below.
  forces: EMPTY_FORCE_FIELD,
} as const;

const PROVIDER_ID = 'procedural';

/**
 * A populated force field at the golden instant, for the Phase 4 cases.
 *
 * I-12's deterministic subset is "fixed seed, no video, clock paused", and a
 * force field satisfies it exactly: `evaluateForces` is pure in
 * `(definitions, values, timeSeconds, seed, parallax)`, and every varying
 * quantity inside it comes from seeded value noise. A force is therefore one of
 * the few animated things in this engine that a hash CAN legitimately cover.
 */
function forceField(
  values: Record<string, Record<string, number>>,
  parallax?: { x: number; y: number },
): ForceField {
  return evaluateForces({
    definitions: FORCE_DEFINITIONS,
    values,
    timeSeconds: GOLDEN_TIME_SECONDS,
    seed: 0x5eed,
    ...(parallax ? { parallax } : {}),
  });
}

/**
 * The text a placeholder or badge draws, as a normalized rect (I-1), excluded
 * from this case's hash and statistics.
 *
 * Measured, not guessed: `scripts/font-probe.mjs` renders the suite with glyphs
 * suppressed and reports the exact footprint. Each rect below is that footprint
 * with a ~4 px margin, and the margin is the point — a rect sized to today's
 * glyphs would need re-measuring the first time any of them moved.
 */
interface GoldenCase {
  name: string;
  scene: Scene;
  /** Phase 4. Defaults to `EMPTY_FORCE_FIELD` — see `GOLDEN_FRAME`. */
  forces?: ForceField;
  /**
   * Hash only this normalized rectangle of the frame, in addition to the whole
   * one, and report it as `regionHash`.
   *
   * Built for one question the whole-frame hash structurally cannot answer.
   * The operator reported that changing any control shifts the colours across
   * the whole wall; the reference patch (`phase4-reference`) is a layer that is
   * subscribed to no force and provably cannot be modulated, so if its PIXELS
   * are identical between two frames that differ in a force value, the engine
   * is not what moved it. A whole-frame hash cannot say that, because the rest
   * of the frame is *supposed* to differ — the witnesses moving is the point.
   *
   * Normalized (I-1), so the region means the same thing at any resolution.
   */
  region?: { x: number; y: number; width: number; height: number };
  /**
   * Hash and summarise the frame MINUS this normalized rectangle.
   *
   * These three cases prove I-13 — that a failed layer draws a visible
   * placeholder — and I-13 is what they are blessed for. The glyphs inside the
   * label are not the subject under test, and they are the one thing in the
   * frame the operating system rasterises rather than this engine: on
   * 2026-09-05 a macOS update moved them and turned three green cases red with
   * no engine change behind it.
   *
   * Excluding the text is deliberately preferred over pinning a font. Pinning
   * the family does not pin the raster — and in this instance would not have
   * helped at all, because no font file changed; the glyphs simply landed a
   * whole pixel over. An exclusion is durable against every future rasteriser,
   * metric and hinting change, and it costs only the coverage of pixels this
   * suite never meant to assert on.
   */
  exclude?: { x: number; y: number; width: number; height: number }[];
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
   * Render at this clock time instead of `GOLDEN_FRAME`'s.
   *
   * Gate 3 asks that "two sprite/Lottie loops of different lengths stay
   * phase-consistent relative to the clock after a scrub". `clock.test.ts`
   * proves that of the arithmetic; this proves it of the RENDER, which is a
   * different claim — a view that ignored `timeSeconds` and advanced a counter
   * of its own would pass every pure test and fail here.
   */
  timeSeconds?: number;
  /**
   * B2. The room this case is rendered against (I-15).
   *
   * A LITERAL here, exactly like `GOLDEN_RESOLUTION`, and for the same reason
   * spelled out at the top of this file: `calibration/surfaces.json` is the
   * BUILDER's room and is replaced the first evening anybody marks a real box.
   * A golden that read it would re-bless itself every time the wall changed,
   * which is the regression net quietly disappearing in a commit that looks
   * like a marking session. The coordinates below were copied from B1's file
   * once; they are the harness's now.
   */
  surfaces?: SurfaceTree;
  /**
   * B2. Check the lit area of this case against the geometry it should have
   * been clipped to — see `clipExpectation`.
   *
   * A hash says the frame did not change; it cannot say the frame is clipped,
   * and a mask that silently stopped working would hash consistently forever.
   */
  clipRole?: string;
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
    {
      name: 'resilience',
      scene: faulty,
      // two placeholder labels: measured footprint x[328..951] y[44..199]
      exclude: [
        // upper label: measured x[324..643] y[40..111]
        { x: 0.378125, y: 0.105556, width: 0.25, height: 0.1 },
        // lower label: measured x[645..955] y[150..203]
        { x: 0.625391, y: 0.245833, width: 0.242969, height: 0.075 },
      ],
    },

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
      // the video badge "> live in output": measured x[10..134] y[12..24]
      exclude: [{ x: 0.056641, y: 0.025694, width: 0.103906, height: 0.029167 }],
    },

    {
      // I-13. A scene naming an asset this build does not have must come back
      // as a flagged placeholder, not as a crash and not as a black rectangle.
      name: 'bundled-missing-asset',
      scene: bundledMissing(),
      // one placeholder label: measured footprint x[200..467] y[154..181]
      exclude: [{ x: 0.260937, y: 0.233333, width: 0.215625, height: 0.05 }],
    },
    {
      // -------------------------------------------------------------------
      // THE SCRUB, at the render level (Gate 3, I-2).
      //
      // Same scene as `bundled-spritesheets`, same everything, rendered at
      // t = 7.3 s instead of t = 1 s. Nothing "played" between the two — this
      // IS a scrub, in the only sense the engine has: a different clock time
      // handed to the same views.
      //
      // The frames are computable by hand and are asserted in `seam.test.ts`
      // as arithmetic:
      //   puff  2.5 s / 25 f: 7.3/2.5 = 2.92 -> phase 0.92 -> frame 23
      //   burst 1.8 s /  9 f: 7.3/1.8 = 4.06 -> phase 0.06 -> frame 0
      // Both loops land where their own period says, and neither lands where
      // 6.3 seconds of playback would have left an accumulating counter.
      // -------------------------------------------------------------------
      name: 'bundled-spritesheets-scrubbed',
      scene: bundledSheets('none'),
      timeSeconds: 7.3,
      preload: sheetUrls,
    },
    {
      // The Lottie under the same scrub. 7.3/3 = 2.433 -> phase 0.433 -> frame
      // 39 of 90. A player running on its own timeline would be wherever
      // `requestAnimationFrame` had carried it, which is the I-2 violation
      // this case exists to catch.
      name: 'bundled-lottie-scrubbed',
      scene: bundledLottie(),
      timeSeconds: 7.3,
    },

    // -----------------------------------------------------------------------
    // PHASE 4 — forces and parallax (I-4, I-14, D3).
    //
    // A force field is a legitimate subject for a hash, which is not obvious
    // and is worth stating. I-12 restricts pixel comparison to "an explicitly
    // deterministic subset: fixed seed, no video, clock paused" — and
    // `evaluateForces` is a pure function of (definitions, values, time, seed,
    // parallax) whose only varying quantity is seeded value noise. Every case
    // below pins all five. Nothing here decodes, and the clock is the frozen
    // `GOLDEN_TIME_SECONDS`.
    //
    // The cases are arranged in PAIRS that differ in exactly one force value,
    // so a hash difference attributes to that value and a hash MATCH between a
    // pair is itself a failure — a force that silently did nothing would show
    // up as two identical frames rather than as a crash.
    // -----------------------------------------------------------------------
    {
      // The scene as the operator first sees it: its own stored force values.
      name: 'phase4-forces',
      scene: createPhase4Scene(),
      forces: forceField(createPhase4Scene().forces),
    },
    {
      // Wind at zero. The baseline the next case is judged against — every
      // layer sits exactly on its stored transform.
      name: 'phase4-wind-none',
      scene: createPhase4Scene(),
      forces: forceField({ wind: { strength: 0, direction: 0, gustiness: 0.5 } }),
    },
    {
      // Wind at maximum. Gate 4's first condition, frozen: the three bars are
      // identical in every respect but `susceptibility.wind` (0, 0.5, 1), so
      // this frame shows three different displacements from one force value.
      // MUST differ from `phase4-wind-none`.
      name: 'phase4-wind-max',
      scene: createPhase4Scene(),
      forces: forceField({ wind: { strength: 1, direction: 0, gustiness: 0.5 } }),
    },
    {
      // Wind blowing the other way. Direction is a real parameter, not a sign.
      name: 'phase4-wind-reversed',
      scene: createPhase4Scene(),
      forces: forceField({ wind: { strength: 1, direction: 0.5, gustiness: 0.5 } }),
    },
    {
      // Midnight. Gate 4's second condition at one end of its travel: the whole
      // scene, every layer, dark and blue — and uniformly so, because
      // `timeOfDay` defaults to a susceptibility of 1 and no layer opts out.
      name: 'phase4-midnight',
      scene: createPhase4Scene(),
      forces: forceField({ timeOfDay: { hour: 0 } }),
    },
    {
      // Noon. Exactly neutral: this frame must be the one the tint axes cannot
      // brighten past, and every layer at its authored colour.
      name: 'phase4-noon',
      scene: createPhase4Scene(),
      forces: forceField({ timeOfDay: { hour: 12 } }),
    },
    {
      // Golden hour, the interesting middle of the ramp.
      name: 'phase4-golden-hour',
      scene: createPhase4Scene(),
      forces: forceField({ timeOfDay: { hour: 18.5 } }),
    },
    {
      // Rain at full. Two things at once, and they are separable by eye: the
      // DROPS (content, reading `force.rain.intensity` off the frame) and the
      // WETNESS TINT (the force's own axes) on everything beneath them.
      name: 'phase4-rain',
      scene: createPhase4Scene(),
      forces: forceField({ rain: { intensity: 1, wetness: 1 } }),
    },
    {
      // Rain slanted by wind. The drops lean while the SHEET stays put — the
      // rain layer states `susceptibility.wind = 0` precisely so a full-frame
      // layer is never translated into showing its own edges.
      name: 'phase4-rain-windblown',
      scene: createPhase4Scene(),
      forces: forceField({
        rain: { intensity: 1, wetness: 0.6 },
        wind: { strength: 1, direction: 0, gustiness: 0 },
      }),
    },
    {
      // D3, one end. Gate 4's third condition: at parallax 0 the near tree has
      // moved 0.98x of the sweep and the sky 0.15x of it, so the trees slide
      // across the background rather than with it.
      name: 'phase4-parallax-left',
      scene: createPhase4Scene(),
      forces: forceField({}, { x: 0, y: 0.5 }),
    },
    {
      // D3, the other end. MUST differ from `phase4-parallax-left`, and the
      // difference between the two is the whole of "depth converts decoration
      // into space".
      name: 'phase4-parallax-right',
      scene: createPhase4Scene(),
      forces: forceField({}, { x: 1, y: 0.5 }),
    },
    {
      // I-1 under modulation. A force offset is normalized like everything
      // else, so a modulated scene must land in the same RELATIVE place at a
      // different resolution — the same claim `stack@640x360` makes for a
      // stored transform, now made for a computed one.
      //
      // Rain is hidden for this case alone: its stroke width is floored at
      // 2 px (deliberately — thin strokes are what read as soft on the wall),
      // and a floor is by definition not proportional to resolution. Comparing
      // it across two resolutions would be testing the floor, not I-1.
      name: 'phase4-wind-max-no-rain',
      scene: phase4WithoutRain(),
      forces: forceField({ wind: { strength: 1, direction: 0, gustiness: 0.5 } }),
    },
    // -----------------------------------------------------------------------
    // THE REFERENCE PATCH, IN PIXELS (the operator's colour-shift report).
    //
    // These two cases differ in EXACTLY ONE THING: wind at 0 versus wind at
    // full. Their whole-frame hashes MUST differ — the witness bar moves, and a
    // match would mean the scene was dead. Their `regionHash` over the grey
    // patch MUST be IDENTICAL, because the patch states susceptibility 0 for
    // every force and sits at depth 0.
    //
    // That pair is the engine's half of the question, settled in pixels rather
    // than in modulation arithmetic. If the hashes match and the patch still
    // appears to shift on the wall, the cause is downstream of this renderer —
    // the projector, or simultaneous contrast against a neighbour that really
    // is changing. Neither is something this code can fix, and both are things
    // it would otherwise be blamed for.
    // -----------------------------------------------------------------------
    {
      name: 'phase4-reference-wind-none',
      scene: createPhase4ReferenceScene(),
      forces: forceField({ wind: { strength: 0 }, timeOfDay: { hour: 12 } }),
      region: REFERENCE_PATCH_REGION,
    },
    {
      name: 'phase4-reference-wind-max',
      scene: createPhase4ReferenceScene(),
      forces: forceField({ wind: { strength: 1, gustiness: 1 }, timeOfDay: { hour: 12 } }),
      region: REFERENCE_PATCH_REGION,
    },
    {
      name: 'phase4-wind-max-no-rain@640x360',
      scene: phase4WithoutRain(),
      forces: forceField({ wind: { strength: 1, direction: 0, gustiness: 0.5 } }),
      size: { width: 640, height: 360 },
      compareTo: 'phase4-wind-max-no-rain',
    },
    // -----------------------------------------------------------------------
    // B2 — SPRINT.md R2 and R3. One layer, clipped to marked faces.
    //
    // `rect` on purpose: it fills its whole pixel box at alpha 1, so the shape
    // in the frame is the MASK's shape and nothing else. Any provider that drew
    // something smaller than its box would make a clip and a small drawing
    // indistinguishable, which is the one thing these two cases exist to tell
    // apart. `add` on black is what the reel is shot with (I-6).
    //
    // The first case is the block: an L with a reflex corner, filled by a
    // provider that can only draw rectangles. If the frame shows a rectangle,
    // the mask is not in the path — and the runner measures that rather than
    // leaving it to the eye, see `clipExpectation`.
    // -----------------------------------------------------------------------
    {
      name: 'fill-one-surface',
      scene: fillScene('panel', 0x40c0ff),
      surfaces: [GOLDEN_FACE_L],
      clipRole: 'panel',
    },
    {
      name: 'fill-two-surfaces-one-role',
      scene: fillScene('panel', 0x40c0ff),
      // Both faces carry `panel`, so ONE layer draws twice — R2's "leave it
      // alone and every face shares one layer", which is beat 7 of the reel.
      surfaces: [GOLDEN_FACE_QUAD, GOLDEN_FACE_L],
      clipRole: 'panel',
    },

    // -----------------------------------------------------------------------
    // B4 — I-16, SPRINT.md R4. Groups.
    //
    // `group-parallel-default` is the `stack` scene with every layer placed in
    // an explicit `parallel` group. It MUST hash identical to `stack`: the
    // standard a force met at Phase 4 — a group is inert at its defaults, and
    // the runner asserts the equality rather than leaving it to a re-bless.
    //
    // The three `group-sequence-*` cases are one scene — three full-frame
    // rects, red 5 s, green 3 s, blue 2 s, in one sequence — at three clock
    // times. Only the active block is drawn, so the centre pixel names the
    // block: t = 6 is green (block 2 at local 1), t = 9.5 is blue, and t = 12
    // wraps to 2 and is red again. The runner reads those pixels; a sequence
    // that drew everything would show blue (the top layer) at every t, and one
    // that never advanced would show red.
    // -----------------------------------------------------------------------
    { name: 'group-parallel-default', scene: parallelGrouped(stack()) },
    { name: 'group-sequence-t6', scene: sequenceScene(), timeSeconds: 6 },
    { name: 'group-sequence-t9.5', scene: sequenceScene(), timeSeconds: 9.5 },
    { name: 'group-sequence-t12', scene: sequenceScene(), timeSeconds: 12 },

    // -----------------------------------------------------------------------
    // B5 — I-18, D21. Route motion on the render path.
    //
    // `motion-default` is the `stack` scene with a DEFAULTED motion record on
    // every layer (`travelRole: ''`). It MUST hash identical to `stack`, and
    // the runner asserts it: a declared-but-empty motion is inert.
    //
    // `route-travel` is one rect on an open two-segment route (a surface with
    // `role: 'route'`), period 8 s, `orient` on, drawn at t = 3 — progress
    // 0.375, three quarters along the first segment, turned to face down the
    // slope. `route-travel-t0` is the same scene at t = 0, parked at the
    // route's first point; the runner asserts the two frames DIFFER, which is
    // the render-level statement that position is a function of the clock.
    // -----------------------------------------------------------------------
    { name: 'motion-default', scene: motionDefaulted(stack()) },
    { name: 'route-travel', scene: routeScene(), surfaces: [GOLDEN_ROUTE], timeSeconds: 3 },
    { name: 'route-travel-t0', scene: routeScene(), surfaces: [GOLDEN_ROUTE], timeSeconds: 0 },
  ];
}

/** `scene` with `DEFAULT_ROUTE_MOTION` stated on every layer. Must change nothing. */
function motionDefaulted(scene: Scene): Scene {
  return {
    ...scene,
    id: `${scene.id}-motion-default`,
    layers: scene.layers.map((l) => ({ ...l, motion: { ...DEFAULT_ROUTE_MOTION } })),
  };
}

/**
 * The harness's route: OPEN, two segments of equal length, a peak in the
 * middle. A literal for `GOLDEN_FACE_L`'s reason — the builder's room is not
 * a fixture.
 */
const GOLDEN_ROUTE = createSurface({
  id: 'route-1',
  name: 'route 1',
  role: 'route',
  path: createPath({
    id: 'route-1-path',
    closed: false,
    points: [
      { x: 0.1, y: 0.8 },
      { x: 0.5, y: 0.2 },
      { x: 0.9, y: 0.8 },
    ],
  }),
});

/** One small rect that travels `GOLDEN_ROUTE`, facing its heading. */
function routeScene(): Scene {
  return createScene({
    id: 'golden-route',
    seed: 0x5eed,
    background: 0x000000,
    layers: [
      createLayer({
        id: 'walker',
        providerId: PROVIDER_ID,
        content: { kind: 'rect', tint: 0xffc040 },
        // A base position OFF the route on purpose: if motion failed to move
        // the layer it would sit here, at the bottom-left, and both frames
        // would hash equal — which the runner refuses.
        transform: { x: 0.2, y: 0.9, width: 0.14, height: 0.08, rotation: 0 },
        zOrder: 0,
        motion: createRouteMotion({ periodSeconds: 8, orient: true, travelRole: 'route' }),
      }),
    ],
  });
}

/** `scene` with every layer in one explicit `parallel` group. Must change nothing. */
function parallelGrouped(scene: Scene): Scene {
  return {
    ...scene,
    id: `${scene.id}-grouped`,
    groups: [{ id: 'all', mode: 'parallel', children: scene.layers.map((l) => ({ id: l.id })) }],
  };
}

/** SPEC.md Gate 7's 5 + 3 + 2, as three coloured blocks. */
export const SEQUENCE_COLOURS = { a: 0xd02020, b: 0x20c060, c: 0x2040d0 } as const;

function sequenceScene(): Scene {
  const rect = (id: keyof typeof SEQUENCE_COLOURS, z: number): ReturnType<typeof createLayer> =>
    createLayer({
      id,
      providerId: PROVIDER_ID,
      content: { kind: 'rect', tint: SEQUENCE_COLOURS[id] },
      transform: { x: 0.5, y: 0.5, width: 0.8, height: 0.8, rotation: 0 },
      zOrder: z,
    });
  return createScene({
    id: 'golden-sequence',
    seed: 0x5eed,
    background: 0x000000,
    layers: [rect('a', 0), rect('b', 1), rect('c', 2)],
    groups: [
      {
        id: 'seq',
        mode: 'sequence',
        children: [
          { id: 'a', duration: 5 },
          { id: 'b', duration: 3 },
          { id: 'c', duration: 2 },
        ],
      },
    ],
  });
}

/**
 * The harness's room. Copied from B1's `calibration/surfaces.json` and frozen
 * here — see `GoldenCase.surfaces` for why it is not read from that file.
 *
 * `GOLDEN_FACE_L` is the one that matters: six points with a reflex corner at
 * (0.74, 0.5), so its bounding box is 39% larger than its area. A fill that
 * ignored the mask would light that whole box.
 */
const GOLDEN_FACE_QUAD = createSurface({
  id: 'surface-1',
  name: 'face 1',
  role: 'panel',
  path: createPath({
    id: 'surface-1-path',
    closed: true,
    points: [
      { x: 0.08, y: 0.18 },
      { x: 0.44, y: 0.12 },
      { x: 0.44, y: 0.74 },
      { x: 0.08, y: 0.82 },
    ],
  }),
});

const GOLDEN_FACE_L = createSurface({
  id: 'surface-2',
  name: 'face 2',
  role: 'panel',
  path: createPath({
    id: 'surface-2-path',
    closed: true,
    points: [
      { x: 0.56, y: 0.16 },
      { x: 0.92, y: 0.22 },
      { x: 0.92, y: 0.52 },
      { x: 0.74, y: 0.5 },
      { x: 0.74, y: 0.78 },
      { x: 0.56, y: 0.8 },
    ],
  }),
});

/** One layer, no transform of its own, bound to a role. SPRINT.md R2. */
function fillScene(role: string, tint: number): Scene {
  return createScene({
    id: `golden-fill-${role}`,
    seed: 0x5eed,
    background: 0x000000,
    layers: [
      createLayer({
        id: 'fill',
        name: 'Fill',
        providerId: PROVIDER_ID,
        content: { kind: 'rect', tint },
        // Deliberately the full frame. A fill is placed by its FACE, so this
        // transform must have no effect at all — and if it ever did, these two
        // cases would light the entire frame and say so.
        transform: { x: 0.5, y: 0.5, width: 1, height: 1, rotation: 0 },
        zOrder: 0,
        blendMode: 'add',
        fillRole: role,
      }),
    ],
  });
}

/**
 * What fraction of the frame this case's fill SHOULD light, and what fraction
 * it would light if the mask were not in the path.
 *
 * `polygon` is the shoelace area of every matching face; `box` is the area of
 * their bounding boxes, which is what an unmasked fill covers. The two differ
 * by 39% on the L, so the runner can tell a clipped frame from an unclipped one
 * arithmetically instead of by eye.
 *
 * Both assume the faces do not overlap, which is true of the two above and is
 * asserted by neither — a room where they did would report a `box` fraction
 * that double-counts, and the check would only ever be too strict.
 */
function clipExpectation(
  surfaces: SurfaceTree,
  role: string,
): { polygon: number; box: number } {
  let polygon = 0;
  let box = 0;
  for (const surface of surfaces) {
    if (surface.role !== role) continue;
    const pts = surface.path.points;
    let sum = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      sum += a.x * b.y - b.x * a.y;
      if (a.x < minX) minX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.x > maxX) maxX = a.x;
      if (a.y > maxY) maxY = a.y;
    }
    polygon += Math.abs(sum) / 2;
    box += (maxX - minX) * (maxY - minY);
  }
  return { polygon, box };
}

/** See `phase4-wind-max-no-rain` for why the rain layer is hidden. */
function phase4WithoutRain(): Scene {
  const scene = createPhase4Scene();
  return {
    ...scene,
    layers: scene.layers.map((l) => (l.id === 'rain' ? { ...l, visible: false } : l)),
  };
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
  /**
   * FNV-1a over just `GoldenCase.region`, when one is declared. Null otherwise.
   * Two cases that differ only in a force value must produce the SAME
   * `regionHash` over a layer that force cannot reach — see `GoldenCase.region`.
   */
  regionHash: string | null;
  /** The rect this case's hash and statistics skipped, and how many pixels. */
  excluded: { rects: { x: number; y: number; width: number; height: number }[]; pixels: number } | null;
  /** Live proof the narrowed hash can still fail. Null when nothing is excluded. */
  excludeControl: { tripped: boolean; at: [number, number] | null; note: string | null } | null;
  /**
   * SPRINT.md R3. The renderer's live render-target count for THIS case,
   * measured after the frame is drawn.
   *
   * Reported to the runner and deliberately NOT written into
   * `test/golden/frames.json`. The absolute number depends on the GL driver
   * that happened to run; the CLAIM is relative — a case with a fill must hold
   * the same count as a case without one — and committing a machine-dependent
   * absolute would turn the first run on another laptop into a false failure,
   * which is exactly how an instrument stops being believed.
   */
  renderTargets: RenderTargetCensus;
  /**
   * B2. What fraction of the frame this case's fill should light, and what it
   * would light unclipped. Null on every case with no `clipRole`.
   */
  clip: { role: string; polygon: number; box: number } | null;
  /** PNG data URL, written to disk by the runner for eyeballing. */
  png: string;
}

/**
 * FNV-1a over one normalized rectangle of the frame (I-1: the rect is a
 * fraction, so it names the same area at any resolution).
 *
 * Deliberately inset by one pixel on each edge. A layer's own boundary is
 * antialiased against whatever is behind it, and behind the reference patch is
 * a scene that IS meant to change — so hashing the outermost pixel row would
 * make this assertion fail for the one reason it is not asking about.
 */
function hashRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  region: { x: number; y: number; width: number; height: number },
): string {
  const x0 = Math.min(width - 1, Math.max(0, Math.round((region.x - region.width / 2) * width) + 1));
  const y0 = Math.min(height - 1, Math.max(0, Math.round((region.y - region.height / 2) * height) + 1));
  const x1 = Math.min(width, Math.max(x0 + 1, Math.round((region.x + region.width / 2) * width) - 1));
  const y1 = Math.min(height, Math.max(y0 + 1, Math.round((region.y + region.height / 2) * height) - 1));
  const out = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      out[n++] = pixels[i] as number;
      out[n++] = pixels[i + 1] as number;
      out[n++] = pixels[i + 2] as number;
      out[n++] = pixels[i + 3] as number;
    }
  }
  return fnv1a(out);
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

    // The Lottie player is loaded lazily (see `LottieView.ts`), so a golden
    // taken before it arrives would be a stable hash of a placeholder. Awaited
    // for EVERY case rather than only the Lottie ones: it is idempotent, and a
    // per-case flag is a thing to forget when the next Lottie case is added.
    await ensureLottie();

    if (c.preload && c.preload.length > 0) {
      // A load that fails is not fatal here: the case then hashes its I-13
      // placeholder, which is a real state and one the runner should be able
      // to bless rather than crash on.
      await Promise.allSettled(c.preload.map((u) => Assets.load(u)));
    }

    // Typed as the contract, not as `typeof GOLDEN_FRAME`: that constant is
    // `as const`, so its `timeSeconds` is the literal 1 and a scrubbed case
    // could not be built from it.
    const caseFrame: LayerFrame = {
      ...GOLDEN_FRAME,
      ...(c.timeSeconds === undefined ? {} : { timeSeconds: c.timeSeconds }),
      ...(c.forces === undefined ? {} : { forces: c.forces }),
    };

    // B2. The room, before the scene: role binding is resolved at mount, and a
    // fill mounted against an empty room would light nothing and hash black.
    if (c.surfaces) compositor.setSurfaces(c.surfaces);

    if (c.afterScene) {
      // Mount one scene, run a frame, then replace it — the editor's path.
      compositor.setScene(c.afterScene);
      compositor.update(caseFrame);
      warp?.prepare();
      app.renderer.render(app.stage);
    }
    compositor.setScene(c.scene);
    // Two updates, one render: `isolateUpdate` swaps a layer that throws for a
    // placeholder on the frame it throws, so a single-frame harness would hash
    // the frame before the swap and never see the placeholder it is meant to
    // be testing (I-13).
    compositor.update(caseFrame);
    compositor.update(caseFrame);
    // Let each view's own `Assets.load(...).then(...)` run. The cache is warm
    // from `preload` above, so this is a microtask drain rather than a wait —
    // but it has to happen between `setScene` and the render or the frame is
    // hashed before any texture has been attached.
    if (c.preload && c.preload.length > 0) {
      await new Promise((r) => setTimeout(r, 0));
      compositor.update(caseFrame);
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
    // One pass hashes and summarises the frame, skipping `exclude` if declared.
    // With no exclusion this is byte-identical to the previous whole-frame
    // behaviour, which `golden.test.ts` asserts rather than assumes.
    const stats = hashFrame(pixels.pixels, size.width, size.height, c.exclude);

    // The live negative control. A hash that ignores a rectangle must still see
    // a change one pixel outside it: flip a byte there and require the hash to
    // move. `region` shipped with a control for the same reason, and this
    // project has already shipped an assertion that could not fail.
    let excludeControl: GoldenResult['excludeControl'] = null;
    if (c.exclude) {
      const at = firstPixelOutside(size.width, size.height, c.exclude);
      if (at === null) {
        excludeControl = { tripped: false, at: null, note: 'the exclusion covers the whole frame' };
      } else {
        const copy = new Uint8ClampedArray(pixels.pixels);
        const i = (at[1] * size.width + at[0]) * 4;
        copy[i] = (copy[i] as number) ^ 0xff;
        const moved = hashFrame(copy, size.width, size.height, c.exclude).hash;
        excludeControl = { tripped: moved !== stats.hash, at, note: null };
      }
    }
    const canvas = app.renderer.extract.canvas({ target: app.stage, frame }) as HTMLCanvasElement;

    signatures.set(c.name, signature(pixels.pixels, size.width, size.height));

    results.push({
      name: c.name,
      width: size.width,
      height: size.height,
      hash: stats.hash,
      coverage: stats.lit / stats.counted,
      failures: compositor.failures().map((f) => ({ layerId: f.layerId, reason: f.reason })),
      png: canvas.toDataURL('image/png'),
      layoutDelta: null,
      expectLayoutMismatch: c.expectLayoutMismatch === true,
      centrePixel: centreRgb(pixels.pixels, size.width, size.height),
      meanLuminance: Number(stats.meanLuminance.toFixed(6)),
      // A14: the gate line prints the VALUE. A silent exclusion is a hash that
      // quietly stopped covering part of the frame.
      excluded: c.exclude ? { rects: c.exclude, pixels: stats.excluded } : null,
      excludeControl,
      regionHash: c.region
        ? hashRegion(pixels.pixels, size.width, size.height, c.region)
        : null,
      // R3, read AFTER the frame is drawn: a mask that allocated a target would
      // have allocated it during that render and not before it. A14 — the
      // counter is a probe over two small collections, it runs once per case
      // here and on the 250 ms metrics tick live, never on a frame path.
      renderTargets: readRenderTargets(app.renderer),
      clip:
        c.clipRole && c.surfaces
          ? { role: c.clipRole, ...clipExpectation(c.surfaces, c.clipRole) }
          : null,
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
