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
