/**
 * Phase 1's starting scene. Not a saved scene — `scenes/` and the scene bank
 * arrive in Phase 6 — but a deterministic composition that exercises what
 * Gate 1 asks about, so the gate is checked against something the operator can
 * see rather than something a test constructs.
 *
 * The order matters: `water` under `tree`, with `glow` on `add` above both, is
 * Gate 1's first condition ("a dark-background `add` glow layer visibly
 * brightens layers beneath it").
 */
import { createLayer } from './layer';
import { createScene, type Scene } from './scene';
import { PROCEDURAL_PROVIDER_ID } from '../providers/procedural/ProceduralProvider';
import { BUNDLED_PROVIDER_ID } from '../providers/bundled/BundledProvider';

export function createDefaultScene(): Scene {
  return createScene({
    id: 'phase1-default',
    name: 'Phase 1 — layer compositor',
    seed: 0x5eed,
    // Black, because on a projector black is the absence of light and that is
    // what makes the additive layer above read as light rather than as paint (D1).
    background: 0x000000,
    layers: [
      createLayer({
        id: 'water',
        name: 'Water',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'water', bands: 16 },
        transform: { x: 0.5, y: 0.78, width: 1, height: 0.42, rotation: 0 },
        zOrder: 0,
        depth: 0.15,
      }),
      createLayer({
        id: 'tree',
        name: 'Tree',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'tree' },
        transform: { x: 0.32, y: 0.56, width: 0.42, height: 0.72, rotation: 0 },
        zOrder: 1,
        depth: 0.6,
      }),
      createLayer({
        id: 'glow',
        name: 'Glow (add)',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'glow', rings: 24, tint: 0xffb040 },
        transform: { x: 0.32, y: 0.42, width: 0.36, height: 0.36, rotation: 0 },
        zOrder: 2,
        blendMode: 'add',
        depth: 0.62,
      }),
      createLayer({
        id: 'testPattern',
        name: 'Test pattern',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'testPattern', cells: 8 },
        transform: { x: 0.5, y: 0.5, width: 1, height: 1, rotation: 0 },
        zOrder: 3,
        // Off by default. Phase 0's panel-edge check (the magenta frame) is
        // passed and does not need to be on screen every launch, but the layer
        // stays in the scene so the operator can bring it back from the layer
        // list without editing code.
        visible: false,
      }),
    ],
  });
}

/**
 * A SECOND constructed scene. Not a scene bank — `scenes/`, save/load and live
 * switching are all Phase 6 (D12), and none of that is built here.
 *
 * It exists for one Gate 2 condition: "loading a different scene keeps the same
 * calibration". With no scene loading in the project yet, the honest way to
 * test that is to hand a genuinely different scene to the same editor path the
 * layer list already uses, and check the warp does not move. Building Phase 6's
 * bank to satisfy a Phase 2 gate would be the scope creep CLAUDE.md forbids;
 * skipping the box would cross a gate on an untested condition, which rule 3
 * forbids. This is the smallest thing that is actually a different scene.
 *
 * Deliberately unmistakable from `createDefaultScene` at a glance, because the
 * operator has to be able to tell the switch happened while looking at a wall.
 * Phase 1 shipped two added layers that were pixel-identical and cost three
 * rounds of clicking; a scene that cannot be told apart from the other one
 * would be that defect again.
 */
export function createAltScene(): Scene {
  return createScene({
    id: 'phase2-alt',
    name: 'Phase 2 — second scene (Gate 2)',
    seed: 0xa17,
    background: 0x000000,
    layers: [
      createLayer({
        id: 'ground',
        name: 'Ground',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'rect', tint: 0x1a3d5c },
        transform: { x: 0.5, y: 0.85, width: 1, height: 0.3, rotation: 0 },
        zOrder: 0,
        depth: 0.1,
      }),
      createLayer({
        id: 'pillar-left',
        name: 'Pillar (left)',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'rect', tint: 0x8a6a3a },
        transform: { x: 0.22, y: 0.55, width: 0.09, height: 0.62, rotation: 0 },
        zOrder: 1,
        depth: 0.5,
      }),
      createLayer({
        id: 'pillar-right',
        name: 'Pillar (right)',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'rect', tint: 0x8a6a3a },
        transform: { x: 0.78, y: 0.55, width: 0.09, height: 0.62, rotation: 0 },
        zOrder: 2,
        depth: 0.5,
      }),
      createLayer({
        id: 'lantern',
        name: 'Lantern (add)',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'glow', rings: 20, tint: 0x60d0ff },
        transform: { x: 0.5, y: 0.38, width: 0.44, height: 0.44, rotation: 0 },
        zOrder: 3,
        blendMode: 'add',
        depth: 0.7,
      }),
    ],
  });
}

/**
 * Phase 3's scene: **1 video + 2 sprite + 1 Lottie**, which is exactly §4's
 * stated layer load for Gate 3.
 *
 * Not a demo scene that happens to contain those things — the load is the
 * point, and it is defined here rather than assembled at the gate so that the
 * §4 runs, the golden frames and the operator's own eyes are all looking at the
 * same composition. Phase 1's lesson was a scene that could not demonstrate the
 * invariant; the fix is to build the scene the gate asks about.
 *
 * The two sprite sheets have **different loop lengths** (2.5 s and 1.8 s) and
 * the Lottie a third (3 s). That is Gate 3's "two sprite/Lottie loops of
 * different lengths stay phase-consistent relative to the clock after a scrub"
 * standing in the scene, so the condition can be watched rather than computed.
 * 2.5, 1.8 and 3 share no convenient factor — three loops that agreed at a
 * common seam could hide an accumulator bug at exactly the moment it mattered.
 */
export function createPhase3Scene(): Scene {
  return createScene({
    id: 'phase3-load',
    name: 'Phase 3 — 1 video + 2 sprite + 1 Lottie',
    seed: 0x3eed,
    background: 0x000000,
    layers: [
      createLayer({
        id: 'backdrop',
        name: 'Backdrop (video)',
        providerId: BUNDLED_PROVIDER_ID,
        // The SEAMLESS clip, and seam handling off. D5's two routes are a
        // crossfade or filtering to seamless assets, and for video §5 says to
        // cap decoders hard — so the §4 gate load is one decoder, not two.
        content: { assetId: 'test.video.seamless', seam: 'none' },
        transform: { x: 0.5, y: 0.5, width: 1, height: 1, rotation: 0 },
        zOrder: 0,
        opacity: 0.85,
        blendMode: 'normal',
        depth: 0.05,
      }),
      createLayer({
        id: 'puff',
        name: 'Puff (25f sheet, 2.5 s)',
        providerId: BUNDLED_PROVIDER_ID,
        // seam left unset, so the provider's default applies: this asset
        // declares `seamless: false`, so it gets the crossfade. That is the
        // scene's demonstration of "loop-seam handling, configurable per layer".
        content: { assetId: 'kenney.smoke.whitePuff' },
        transform: { x: 0.28, y: 0.42, width: 0.34, height: 0.6, rotation: 0 },
        zOrder: 1,
        opacity: 1,
        // I-6: smoke is not a light source. Normal, not add.
        blendMode: 'normal',
        depth: 0.5,
      }),
      createLayer({
        id: 'burst',
        name: 'Burst (9f sheet, 1.8 s)',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'kenney.smoke.explosion' },
        transform: { x: 0.74, y: 0.55, width: 0.3, height: 0.53, rotation: 0 },
        zOrder: 2,
        opacity: 1,
        // I-6: a fireball IS a light source, so `add` on a dark background.
        // This is also the layer Gate 3 reads for "correct alpha and correct
        // blend mode" — an alpha bug shows as a grey box, a blend bug as a
        // rectangle of raised black.
        blendMode: 'add',
        depth: 0.6,
      }),
      createLayer({
        id: 'rings',
        name: 'Rings (Lottie, 3 s)',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'authored.lottie.clockRings' },
        transform: { x: 0.5, y: 0.36, width: 0.42, height: 0.62, rotation: 0 },
        zOrder: 3,
        opacity: 0.9,
        blendMode: 'add',
        depth: 0.8,
      }),
    ],
  });
}

/**
 * The I-13 fixture scene: a deliberately corrupt video beside a working one.
 *
 * Gate 3 asks that "a deliberately corrupted video file falls back to poster
 * then placeholder, without dropping the frame rate below the hard floor". Two
 * layers rather than one, because the condition is not only that the broken
 * layer degrades — it is that the SESSION continues, and a scene containing
 * only the broken layer cannot show that.
 */
export function createResilienceVideoScene(): Scene {
  return createScene({
    id: 'phase3-resilience',
    name: 'Phase 3 — corrupt video beside a working one (I-13)',
    seed: 0x13ed,
    background: 0x000000,
    layers: [
      createLayer({
        id: 'broken',
        name: 'Corrupt video',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'test.video.corrupt' },
        transform: { x: 0.27, y: 0.5, width: 0.5, height: 0.7, rotation: 0 },
        zOrder: 0,
        blendMode: 'normal',
        depth: 0.3,
      }),
      createLayer({
        id: 'missing',
        name: 'Missing asset',
        providerId: BUNDLED_PROVIDER_ID,
        // No such asset. The provider throws at create and `isolateCreate`
        // substitutes the compositor's placeholder — the other half of I-13.
        content: { assetId: 'nope.does.not.exist' },
        transform: { x: 0.73, y: 0.28, width: 0.4, height: 0.3, rotation: 0 },
        zOrder: 1,
        blendMode: 'normal',
        depth: 0.5,
      }),
      createLayer({
        id: 'alive',
        name: 'Still playing',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'kenney.smoke.explosion' },
        transform: { x: 0.73, y: 0.72, width: 0.36, height: 0.44, rotation: 0 },
        zOrder: 2,
        blendMode: 'add',
        depth: 0.7,
      }),
    ],
  });
}

/**
 * The named scenes this build can open at, by id.
 *
 * A real scene bank is Phase 6 (D12); this is the minimum that lets `§4`'s
 * "at the phase's stated layer load" be reachable by an unattended run and by
 * the editor's buttons from one list, so the two cannot drift apart. When
 * Phase 6 lands, this is what it replaces.
 */
export const NAMED_SCENES: Readonly<Record<string, () => Scene>> = {
  'phase1-default': createDefaultScene,
  'phase1-alt': createAltScene,
  'phase3-load': createPhase3Scene,
  'phase3-resilience': createResilienceVideoScene,
};

/** Undefined for an unknown id — the caller keeps its current scene (I-13). */
export function sceneById(id: string): Scene | undefined {
  const make = NAMED_SCENES[id];
  return make ? make() : undefined;
}
