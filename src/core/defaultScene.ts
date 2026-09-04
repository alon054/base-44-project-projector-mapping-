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
