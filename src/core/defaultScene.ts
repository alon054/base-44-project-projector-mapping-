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
import { createLayer, type Layer } from './layer';
import { createScene, type Scene } from './scene';
import { PROCEDURAL_PROVIDER_ID } from '../providers/procedural/ProceduralProvider';
import { FORCE_DEFINITIONS } from './forceDefs';
import { BUNDLED_PROVIDER_ID } from '../providers/bundled/id';

/**
 * W1 fix. What the editor opens on when no scene is stored: nothing. The
 * builder's words — "start from a blank page, no tree or water." The Phase-1
 * scene is still `createDefaultScene` for the tests, the goldens and the
 * measurement runs that name it; it is just not the first thing on the wall.
 */
export function createBlankScene(): Scene {
  return createScene({ id: 'blank', name: 'Blank' });
}

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
 * Phase 3's load, multiplied — for §4's "record the measured headroom" and for
 * §10 row 2's concurrent video and Lottie caps.
 *
 * §4 is explicit that the Phase-3 load is "a **floor** to validate the
 * pipeline, not the ceiling for a finished scene. Raise it deliberately,
 * measuring at each step, and record the measured headroom." A gate that only
 * ever measured the floor would report that the floor is comfortable, which is
 * not the same statement and is the one that gets read as headroom later.
 *
 * `n` multiplies every kind together — `n` videos, `2n` sprites, `n` Lotties —
 * because §5 names video count and live-Lottie count as the two things
 * expected to blow the budget first, and finding out which of them does it
 * needs them raised past the point where one of them wins.
 *
 * Layers are spread across the frame rather than stacked, so the cost is real
 * fill and not a stack of layers the GPU can trivially occlude.
 */
export function createPhase3LoadScene(n: number): Scene {
  const mult = Math.max(1, Math.floor(n));
  const layers: Layer[] = [];
  let z = 0;
  const videos = ['test.video.seamless', 'test.video.nonSeamless'];
  const sheets = ['kenney.smoke.whitePuff', 'kenney.smoke.explosion'];

  for (let i = 0; i < mult; i++) {
    layers.push(
      createLayer({
        id: `video${i}`,
        name: `Video ${i + 1}`,
        providerId: BUNDLED_PROVIDER_ID,
        // Alternating clips, so a second decoder is a second FILE and not the
        // same one shared — a browser may back two elements on one source with
        // one decode, which would make the count meaningless.
        content: { assetId: videos[i % videos.length] as string, seam: 'none' },
        transform: {
          x: 0.5,
          y: 0.5,
          width: 1,
          height: 1,
          rotation: 0,
        },
        zOrder: z++,
        opacity: i === 0 ? 0.85 : 0.4,
        blendMode: i === 0 ? 'normal' : 'add',
        depth: 0.05,
      }),
    );
  }
  for (let i = 0; i < mult * 2; i++) {
    layers.push(
      createLayer({
        id: `sprite${i}`,
        name: `Sprite ${i + 1}`,
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: sheets[i % sheets.length] as string },
        transform: {
          x: 0.12 + ((i * 0.19) % 0.76),
          y: 0.25 + ((i * 0.23) % 0.5),
          width: 0.3,
          height: 0.53,
          rotation: 0,
        },
        zOrder: z++,
        blendMode: i % 2 === 0 ? 'normal' : 'add',
        depth: 0.5,
      }),
    );
  }
  for (let i = 0; i < mult; i++) {
    layers.push(
      createLayer({
        id: `lottie${i}`,
        name: `Lottie ${i + 1}`,
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'authored.lottie.clockRings' },
        transform: {
          x: 0.2 + ((i * 0.27) % 0.6),
          y: 0.3 + ((i * 0.17) % 0.4),
          width: 0.36,
          height: 0.56,
          rotation: 0,
        },
        zOrder: z++,
        opacity: 0.9,
        blendMode: 'add',
        depth: 0.8,
      }),
    );
  }
  return createScene({
    id: `phase3-x${mult}`,
    name: `Phase 3 headroom — ${mult} video + ${mult * 2} sprite + ${mult} Lottie`,
    seed: 0x3eed + mult,
    background: 0x000000,
    layers,
  });
}

/**
 * **Phase 4's scene — the one Gate 4 is judged on.**
 *
 * Built to be *watched*, not computed. Phase 1's defect was a scene that could
 * not demonstrate the invariant it sat under; Phase 2's was a control that
 * could not be operated; Phase 3's was an instrument that lied. Phase 4's
 * analogous risk, named in advance, is a force bus that is provably correct and
 * whose effect nobody can see. So this scene is arranged as two side-by-side
 * controlled experiments, each isolating exactly one variable, with everything
 * else held equal:
 *
 * **Left half — susceptibility, at one depth.** Three identical bars at
 * `depth 0.5`, same size, same y, evenly spaced, differing only in
 * `susceptibility.wind`: 0.0, 0.5, 1.0. They are colour-coded so the operator
 * can name them from across a room (grey / amber / cyan), and because they are
 * identical in every other respect, one wind slider producing three different
 * amounts of movement *is* Gate 4's first condition, seen rather than argued.
 * The grey bar not moving at all is the control, and it is deliberately the
 * leftmost so that "one of them stays still" is the first thing you notice.
 *
 * **Right half — depth, at one susceptibility.** Three trees, all at
 * `susceptibility.wind = 0.7`, at `depth` 0.08, 0.5 and 0.95. Same force, same
 * subscription, different plane. They sway by visibly different amounts and
 * they slide across each other when the parallax control is swept — Gate 4's
 * third condition, and D3's whole claim that depth is what converts decoration
 * into space. `depthGain` IS the depth, so the far tree responds at 0.15x and
 * the near one at 0.95x — a 6.3x spread, chosen to be unmistakable rather than
 * subtle.
 *
 * **Every full-frame layer here is at `depth 0`, and that is not decoration.**
 * I-1 caps a layer's `width` at 1, so a layer spanning the frame has no bleed;
 * any parallax at all slides a black band in from one edge. A golden preview
 * caught it — see `DEPTH_GAIN_FAR` in `forces.ts`. The sky, the hills, the
 * water and the rain sheet are therefore pinned, and everything with a visible
 * edge inside the frame is free to move.
 *
 * **The sky and the ground** exist so `timeOfDay` has something large to act on
 * — Gate 4's second condition is about the WHOLE scene's light, and a scene of
 * thin objects on black has no light to sweep. Both sit at low depth so they
 * barely parallax, which is what makes the trees appear to move against them.
 *
 * **The lantern** is an `add` layer (I-6): it is how you tell whether
 * `timeOfDay` is dimming *light sources* the same way it dims surfaces. On a
 * projector it should read as light in the scene rather than paint on it (D1).
 *
 * **The rain** is a full-frame sheet with `susceptibility.wind = 0`, and that
 * zero is load-bearing: translating a full-frame layer would drag its edges
 * into view. The sheet stays put and the DROPS inside it lean, because
 * `RainView` reads the wind force's raw parameters — a force maps onto axes and
 * cannot create geometry, so a slanted drop is content responding to a force.
 *
 * Force values start at a **demonstrable** point rather than at zero: wind at
 * 0.45 so the scene is already alive when the operator first sees it, rain at 0
 * so turning it on is an event, and `timeOfDay` at 15.5 — late afternoon, on
 * the warm shoulder of the day ramp where a sweep in either direction changes
 * the light immediately. A gate scene that opens looking like nothing is
 * happening is a gate scene that has to be explained before it can be judged.
 */
export function createPhase4Scene(): Scene {
  /** Held equal across the three susceptibility bars — only `wind` differs. */
  const bar = (id: string, x: number, tint: number, wind: number): Layer =>
    createLayer({
      id,
      name: `Wind susceptibility ${wind.toFixed(2)}`,
      providerId: PROCEDURAL_PROVIDER_ID,
      content: { kind: 'rect', tint },
      transform: { x, y: 0.6, width: 0.05, height: 0.34, rotation: 0 },
      zOrder: 0,
      depth: 0.5,
      susceptibility: { wind },
    });

  /** Held equal across the three trees — only `depth` differs. */
  const tree = (id: string, x: number, depth: number): Layer =>
    createLayer({
      id,
      name: `Tree at depth ${depth.toFixed(2)}`,
      providerId: PROCEDURAL_PROVIDER_ID,
      content: { kind: 'tree', tint: 0x7a5636 },
      transform: { x, y: 0.58, width: 0.22, height: 0.5, rotation: 0 },
      zOrder: 0,
      depth,
      susceptibility: { wind: 0.7 },
    });

  const layers: Layer[] = [
    createLayer({
      id: 'sky',
      name: 'Sky',
      providerId: PROCEDURAL_PROVIDER_ID,
      content: { kind: 'rect', tint: 0x5a86c0 },
      transform: { x: 0.5, y: 0.32, width: 1, height: 0.66, rotation: 0 },
      zOrder: 0,
      opacity: 0.5,
      // depth 0 — the far plane does not parallax. A full-frame layer MUST be
      // authored here: I-1 caps `width` at 1, so it has no bleed, and any
      // parallax at all exposes a black band down one edge. See `depthGain`.
      depth: 0,
      // A sky does not sway. Stated rather than left to the default, because
      // this is the layer whose stillness makes the others' movement legible.
      susceptibility: { wind: 0 },
    }),
    createLayer({
      id: 'hills',
      name: 'Hills',
      providerId: PROCEDURAL_PROVIDER_ID,
      content: { kind: 'rect', tint: 0x2e4a3a },
      transform: { x: 0.5, y: 0.72, width: 1, height: 0.22, rotation: 0 },
      zOrder: 1,
      opacity: 0.9,
      // Full width, so depth 0 for the same reason as the sky.
      depth: 0,
      susceptibility: { wind: 0 },
    }),
    createLayer({
      id: 'water',
      name: 'Water',
      providerId: PROCEDURAL_PROVIDER_ID,
      content: { kind: 'water', bands: 16 },
      transform: { x: 0.5, y: 0.89, width: 1, height: 0.26, rotation: 0 },
      zOrder: 2,
      depth: 0,
      // Full width. Its ripples are its own provider's animation and need no
      // help from the force bus, so it is pinned on both counts.
      susceptibility: { wind: 0 },
    }),

    // Left half: susceptibility at one depth. Grey is the control.
    { ...bar('sus-000', 0.1, 0x6a7076, 0), zOrder: 3 },
    { ...bar('sus-050', 0.22, 0xd2952f, 0.5), zOrder: 4 },
    { ...bar('sus-100', 0.34, 0x35c8c8, 1), zOrder: 5 },

    // Right half: depth at one susceptibility. Far first, so the near tree
    // occludes the far one and the parallax slide is a real occlusion change.
    { ...tree('depth-far', 0.58, 0.15), zOrder: 6 },
    { ...tree('depth-mid', 0.71, 0.5), zOrder: 7 },
    { ...tree('depth-near', 0.84, 0.95), zOrder: 8 },

    createLayer({
      id: 'lantern',
      name: 'Lantern (add)',
      providerId: PROCEDURAL_PROVIDER_ID,
      content: { kind: 'glow', rings: 22, tint: 0xffb040 },
      transform: { x: 0.5, y: 0.34, width: 0.3, height: 0.3, rotation: 0 },
      zOrder: 9,
      opacity: 0.9,
      // I-6: a lantern IS a light source, so `add` on a dark background.
      blendMode: 'add',
      depth: 0.65,
      susceptibility: { wind: 0.3 },
    }),

    createLayer({
      id: 'rain',
      name: 'Rain',
      providerId: PROCEDURAL_PROVIDER_ID,
      // A8: `drops` is scene state. Nothing derives a count from pixel area.
      content: { kind: 'rain', drops: 260, tint: 0xbfe0ff, length: 0.06, fallRate: 1.1 },
      transform: { x: 0.5, y: 0.5, width: 1, height: 1, rotation: 0 },
      zOrder: 10,
      // I-6: rain catches light rather than painting over what is behind it.
      blendMode: 'add',
      // Full-frame, so depth 0 — a sheet of rain that parallaxed would slide a
      // rain-free band across the frame. Rain is conceptually in FRONT of
      // everything, and this is the one place where the authoring rule and the
      // fiction disagree; the rule wins, because the artefact is visible and
      // the fiction is not.
      depth: 0,
      // Load-bearing zero — see this function's header.
      susceptibility: { wind: 0 },
    }),
  ];

  return createScene({
    id: 'phase4-forces',
    name: 'Phase 4 — forces & parallax',
    seed: 0x4f0,
    background: 0x000000,
    layers,
    forces: {
      wind: { strength: 0.45, direction: 0, gustiness: 0.5 },
      rain: { intensity: 0, wetness: 0.6 },
      timeOfDay: { hour: 15.5 },
      temperature: { warmth: 0.5 },
    },
  });
}

/**
 * The I-14 fixture: the SAME scene, with every entity subscribed to a force
 * this build may or may not ship.
 *
 * Gate 4 asks that a fifth force be added in under 30 minutes, as data,
 * touching no bus code. The half of that which is easy to fake is the timing;
 * the half that matters is that the scene needed no edit either. This scene is
 * `phase4-forces` with one extra key per layer, and it is written now — before
 * any fifth force exists — so that at the gate the ONLY change is an entry in
 * `FORCE_DEFINITIONS`. If the fifth force is not registered, every one of these
 * susceptibilities addresses nothing, the bus ignores them, and the scene
 * renders identically to `phase4-forces`. That is the correct behaviour and it
 * is itself worth watching.
 */
export function createPhase4FifthForceScene(): Scene {
  const base = createPhase4Scene();
  return createScene({
    ...base,
    id: 'phase4-fifth',
    name: 'Phase 4 — fifth force fixture (I-14)',
    layers: base.layers.map((l) => ({
      ...l,
      // Varied on purpose: a fifth force that reached everything equally could
      // not be told apart from a global grade change.
      susceptibility: { ...l.susceptibility, fog: 0.25 + 0.75 * l.depth },
    })),
  });
}

/**
 * **The reference-patch scene — a diagnostic instrument, not a demo.**
 *
 * Built to answer one question the operator asked on the wall: *"every time I
 * change anything — opacity, a force, the scale of something — the projector's
 * colours shift a little, across the whole wall."*
 *
 * That report has three candidate causes and no unit test can separate them:
 * the projector's own adaptive brightness re-grading the frame when the average
 * light level moves; a bug in the per-frame `holder.tint` write the compositor
 * gained in Phase 4; or correct `add`-blend compositing being read as a colour
 * change (I-6). What separates them is having ONE THING ON THE WALL THAT CANNOT
 * CHANGE.
 *
 * `reference` is that thing. It states `susceptibility: 0` for every shipped
 * force explicitly — not by omission, because an omitted force falls back to
 * its definition's default and `timeOfDay` defaults to 1 — and sits at
 * `depth 0`, so parallax cannot move it either. Its modulation is the identity
 * for any force values whatever, and `forces.test.ts` asserts exactly that, so
 * the engine's half of the question is closed before anyone looks at a wall.
 *
 * **The test, and its pass condition inverts.** Drag any control and watch only
 * the patch:
 *
 *  - The patch does NOT change → the engine is behaving, and a whole-wall shift
 *    is happening downstream, in the projector. **This check passes by nothing
 *    happening**, which is stated here because Phase 3 lost three rounds of
 *    questions to an "all good" that covered a check of exactly this shape.
 *  - The patch DOES change while its neighbours move → the engine is implicated
 *    and the susceptibility-zero path is broken.
 *
 * Two neighbours are present so that "nothing happened" can be told apart from
 * "nothing is running": `witness-wind` moves when wind moves, `witness-tint`
 * changes colour when `timeOfDay` moves. A frozen patch beside two moving
 * witnesses is evidence; a frozen patch beside a frozen scene is a screenshot.
 *
 * **It is deliberately NOT part of `phase4-forces`.** Adding a twelfth layer to
 * the gate scene would change the layer load §4's window was measured at and
 * re-bless thirteen golden frames, to answer a question that has nothing to do
 * with either.
 */
export function createPhase4ReferenceScene(): Scene {
  /** Explicit zeroes. An OMITTED force is not zero — it takes its default. */
  const deaf: Record<string, number> = {};
  for (const def of FORCE_DEFINITIONS) deaf[def.id] = 0;

  return createScene({
    id: 'phase4-reference',
    name: 'Phase 4 — reference patch (colour-shift diagnosis)',
    seed: 0x4f1,
    background: 0x000000,
    layers: [
      createLayer({
        id: 'reference',
        name: 'REFERENCE — must never change',
        providerId: PROCEDURAL_PROVIDER_ID,
        // Mid grey, large, and centred. Mid grey because a shift is easiest to
        // see where no channel is clipped; large because the operator is
        // judging it from across a room.
        content: { kind: 'rect', tint: 0x808080 },
        transform: { x: 0.5, y: 0.5, width: 0.34, height: 0.44, rotation: 0 },
        zOrder: 2,
        opacity: 1,
        blendMode: 'normal',
        depth: 0,
        susceptibility: deaf,
      }),
      createLayer({
        id: 'witness-wind',
        name: 'Witness — moves with wind',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'rect', tint: 0x35c8c8 },
        transform: { x: 0.16, y: 0.5, width: 0.08, height: 0.44, rotation: 0 },
        zOrder: 0,
        depth: 0.9,
        susceptibility: { ...deaf, wind: 1 },
      }),
      createLayer({
        id: 'witness-tint',
        name: 'Witness — changes with timeOfDay',
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind: 'rect', tint: 0x808080 },
        transform: { x: 0.84, y: 0.5, width: 0.08, height: 0.44, rotation: 0 },
        zOrder: 1,
        depth: 0,
        susceptibility: { ...deaf, timeOfDay: 1, temperature: 1, rain: 1, fog: 1 },
      }),
    ],
    forces: { wind: { strength: 0.6, direction: 0, gustiness: 0.5 }, timeOfDay: { hour: 12 } },
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
  // §4's headroom steps. x1 is the same LOAD as `phase3-load` but laid out by
  // the generator, so the steps are comparable to each other; the gate number
  // is taken on `phase3-load` itself.
  'phase3-x1': () => createPhase3LoadScene(1),
  'phase3-x2': () => createPhase3LoadScene(2),
  'phase3-x3': () => createPhase3LoadScene(3),
  'phase3-x4': () => createPhase3LoadScene(4),
  'phase3-x5': () => createPhase3LoadScene(5),
  'phase3-x6': () => createPhase3LoadScene(6),
  // Phase 4. `phase4-forces` is what Gate 4 is judged on and what §4's Phase 4
  // measurement window is taken at; `phase4-fifth` is the I-14 fixture.
  'phase4-forces': createPhase4Scene,
  'phase4-fifth': createPhase4FifthForceScene,
  // The colour-shift diagnostic. Not a demo — see its own header.
  'phase4-reference': createPhase4ReferenceScene,
};

/** Undefined for an unknown id — the caller keeps its current scene (I-13). */
export function sceneById(id: string): Scene | undefined {
  const make = NAMED_SCENES[id];
  return make ? make() : undefined;
}
