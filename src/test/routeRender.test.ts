/**
 * B5 — route motion on the render path (I-1, I-2, I-17, I-18, D21).
 *
 * `core/motion.ts` was built and green in P5-C; nothing read it at draw time.
 * This suite covers the WIRING, on a real `Compositor` with a recording
 * provider, and the two things SPRINT.md says compile, pass a naive test and
 * fail on the wall:
 *
 *  1. Motion resolves into the Phase 4 axis vocabulary and never sets a
 *     transform field. Asserted as `base → motion → forces` WITH A FORCE
 *     ACTIVE, and by a grep over the compositor.
 *  2. `orient` writes the rotate axis's OVERRIDE, not a contribution: base
 *     rotation 0.25 turns, orient on, a rotating force active → drawn rotation
 *     is `heading + force`, NOT `base + heading + force`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Container, Graphics } from 'pixi.js';
import { Compositor, surfacesShapeKey } from '../render/compositor';
import { createLayer, type Layer } from '../core/layer';
import { createScene, type Scene } from '../core/scene';
import { createPath, pathLength, pointAtProgress, type Path } from '../core/paths';
import { createSurface, type Surface } from '../core/surfaces';
import {
  DEFAULT_ROUTE_MOTION,
  createRouteMotion,
  headingAtProgress,
  isRouteTraversable,
  pointAtMotion,
  progressAt,
  type RouteMotion,
} from '../core/motion';
import {
  EMPTY_FORCE_FIELD,
  FORCE_AXES,
  OVERRIDABLE_AXES,
  composeAxes,
  evaluateForces,
  identityModulation,
  type ForceDefinition,
  type ForceField,
} from '../core/forces';
import { resetRoleLog } from '../core/roles';
import {
  ProviderRegistry,
  type ContentProvider,
  type LayerFrame,
  type LayerView,
  type ProviderContext,
} from '../providers/ContentProvider';

const W = 1280;
const H = 720;
const TAU = Math.PI * 2;
const PROVIDER = 'procedural';

/** A straight route along the middle, left to right. Length 0.8. */
const STRAIGHT: Path = createPath({
  id: 'straight',
  closed: false,
  points: [
    { x: 0.1, y: 0.5 },
    { x: 0.9, y: 0.5 },
  ],
});

/** Two segments of very different lengths — the constant-speed case. */
const UNEVEN: Path = createPath({
  id: 'uneven',
  closed: false,
  points: [
    { x: 0.1, y: 0.5 },
    { x: 0.2, y: 0.5 },
    { x: 0.9, y: 0.5 },
  ],
});

/** Two points, +x then +y: the heading changes at the corner. */
const CORNER: Path = createPath({
  id: 'corner',
  closed: false,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.5, y: 0.5 },
  ],
});

const routeSurface = (path: Path, role = 'route', id = 'route-1'): Surface =>
  createSurface({ id, name: id, role, path });

function frame(timeSeconds: number, forces: ForceField = EMPTY_FORCE_FIELD): LayerFrame {
  return { timeSeconds, phase: 0, playing: true, rate: 1, scrubSeq: 0, forces };
}

function walker(motion: Partial<RouteMotion> | undefined, extra: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({
      id: 'walker',
      providerId: PROVIDER,
      content: { kind: 'rect' },
      transform: { x: 0.2, y: 0.9, width: 0.1, height: 0.1, rotation: 0 },
      zOrder: 0,
      ...(motion === undefined ? {} : { motion: createRouteMotion(motion) }),
    }),
    ...extra,
  };
}

function sceneOf(...layers: Layer[]): Scene {
  return createScene({ id: 'route-test', seed: 1, layers });
}

class RecordingProvider implements ContentProvider {
  readonly id = PROVIDER;
  readonly views = new Map<string, Container>();
  creates = 0;
  create(ctx: ProviderContext): LayerView {
    this.creates++;
    const view = new Container();
    view.addChild(new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: 0x808080 }));
    this.views.set(ctx.layer.id, view);
    return { view, update: () => {}, resize: () => {}, destroy: () => {} };
  }
}

function mount(scene: Scene, surfaces: readonly Surface[] = []) {
  resetRoleLog();
  const provider = new RecordingProvider();
  const providers = new ProviderRegistry();
  providers.register(provider);
  const compositor = new Compositor({ providers, width: W, height: H, surfaces });
  compositor.setScene(scene);
  const holder = (id: string): Container => provider.views.get(id)!.parent!;
  return { compositor, provider, holder };
}

/** A force that leans everything by a fixed turn and pushes it right. Test-only. */
const LEAN: ForceDefinition = {
  id: 'lean',
  label: 'Lean',
  axes: ['rotate', 'offsetX'],
  defaultSusceptibility: 1,
  params: [{ key: 'amount', label: 'Amount', min: 0, max: 1, default: 0.1, step: 0.01 }],
  evaluate(ctx) {
    return { rotate: ctx.param('amount'), offsetX: ctx.param('amount') / 2 };
  },
};

const leaning = (amount = 0.1): ForceField =>
  evaluateForces({ definitions: [LEAN], values: { lean: { amount } }, timeSeconds: 0, seed: 1 });

/* -------------------------------------------------------------------------- */
/* Travel                                                                     */
/* -------------------------------------------------------------------------- */

describe('I-18 — an entity travels its route at constant speed, from the clock', () => {
  it('sits on the route point for its clock time, not at its stored transform', () => {
    const { compositor, holder } = mount(
      sceneOf(walker({ periodSeconds: 8, travelRole: 'route' })),
      [routeSurface(STRAIGHT)],
    );
    compositor.update(frame(2)); // progress 0.25 -> x = 0.1 + 0.25 * 0.8 = 0.3
    expect(holder('walker').x).toBeCloseTo(0.3 * W, 6);
    expect(holder('walker').y).toBeCloseTo(0.5 * H, 6);
    compositor.update(frame(6)); // 0.75 -> 0.7
    expect(holder('walker').x).toBeCloseTo(0.7 * W, 6);
  });

  it('constant speed over unevenly spaced points — equal time, equal distance', () => {
    const { compositor, holder } = mount(
      sceneOf(walker({ periodSeconds: 8, travelRole: 'route' })),
      [routeSurface(UNEVEN)],
    );
    const xs: number[] = [];
    for (const t of [0, 1, 2, 3, 4]) {
      compositor.update(frame(t));
      xs.push(holder('walker').x);
    }
    const steps = xs.slice(1).map((x, i) => x - (xs[i] as number));
    for (const s of steps) expect(s).toBeCloseTo(steps[0] as number, 6);
    // And the first point is the route's first point, not the corner.
    expect(xs[0]).toBeCloseTo(0.1 * W, 6);
  });

  it('pause freezes it and a scrub lands it exactly — the same t gives the same pixels', () => {
    const { compositor, holder } = mount(
      sceneOf(walker({ periodSeconds: 8, travelRole: 'route' })),
      [routeSurface(STRAIGHT)],
    );
    compositor.update(frame(2));
    const at2 = [holder('walker').x, holder('walker').y];
    compositor.update(frame(7.3));
    compositor.update(frame(0.1));
    compositor.update(frame(2));
    expect([holder('walker').x, holder('walker').y]).toEqual(at2);
    compositor.update({ ...frame(2), playing: false });
    expect([holder('walker').x, holder('walker').y]).toEqual(at2);
  });

  it('two entities on one route differ only by phaseOffset', () => {
    const b = { ...walker({ periodSeconds: 8, travelRole: 'route', phaseOffset: 0.5 }), id: 'second' };
    const { compositor, holder } = mount(
      sceneOf(walker({ periodSeconds: 8, travelRole: 'route' }), b),
      [routeSurface(STRAIGHT)],
    );
    compositor.update(frame(2));
    expect(holder('walker').x).toBeCloseTo(0.3 * W, 6);
    expect(holder('second').x).toBeCloseTo(0.7 * W, 6);
  });

  it('the motion arithmetic is not reimplemented — the holder is exactly pointAtMotion', () => {
    const motion = createRouteMotion({ periodSeconds: 5, endBehavior: 'pingpong', phaseOffset: 0.2, travelRole: 'route' });
    const { compositor, holder } = mount(sceneOf(walker(motion)), [routeSurface(CORNER)]);
    for (const t of [0, 1.3, 2.7, 4.4, 9.9]) {
      compositor.update(frame(t));
      const p = pointAtMotion(CORNER, t, motion);
      expect(holder('walker').x).toBeCloseTo(p.x * W, 6);
      expect(holder('walker').y).toBeCloseTo(p.y * H, 6);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Orient and the override                                                    */
/* -------------------------------------------------------------------------- */

describe('I-18 — orient writes the rotate OVERRIDE; forces still sum on top', () => {
  it('only rotate accepts an override, and composeAxes refuses any other', () => {
    expect(OVERRIDABLE_AXES).toEqual(['rotate']);
    expect(() =>
      composeAxes(identityModulation(), [{ axis: 'offsetX', value: 0.1, mode: 'override' }]),
    ).toThrow(/does not accept an override/);
  });

  it('composeAxes: base -> motion -> forces, with the override replacing the base', () => {
    const forces = { ...identityModulation(), rotate: 0.1, offsetX: 0.05 };
    const out = composeAxes(forces, [
      { axis: 'offsetX', value: 0.3, mode: 'contribute' },
      { axis: 'rotate', value: 0.75, mode: 'override' },
    ]);
    expect(out.modulation.offsetX).toBeCloseTo(0.35, 12);
    expect(out.modulation.rotate).toBeCloseTo(0.1, 12);
    expect(out.rotateOverride).toBe(0.75);
    // Nothing else moved, and a write of identity is identity.
    for (const axis of FORCE_AXES) {
      if (axis === 'offsetX' || axis === 'rotate') continue;
      expect(out.modulation[axis]).toBe(identityModulation()[axis]);
    }
    expect(composeAxes(identityModulation(), []).rotateOverride).toBeNull();
  });

  it('with orient on, the drawn rotation is heading + force, NOT base + heading + force', () => {
    // Base rotation 0.25 turns — the authored value that a contribution would
    // wrongly keep. Along +y (the second leg of CORNER) the heading is 0.25 too,
    // so the naive answer (0.25 + 0.25 + 0.1) is visibly different from the
    // right one (0.25 + 0.1).
    const layer = walker({ periodSeconds: 8, orient: true, travelRole: 'route' });
    layer.transform = { ...layer.transform, rotation: 0.25 };
    const { compositor, holder } = mount(sceneOf(layer), [routeSurface(CORNER)]);
    compositor.update(frame(6, leaning(0.1))); // progress 0.75 -> on the +y leg
    const heading = headingAtProgress(CORNER, 0.75);
    expect(heading).toBeCloseTo(0.25, 9);
    expect(holder('walker').rotation).toBeCloseTo((heading + 0.1) * TAU, 9);
    expect(holder('walker').rotation).not.toBeCloseTo((0.25 + heading + 0.1) * TAU, 3);
  });

  it('with orient off, the base rotation stands and the force sums onto it', () => {
    const layer = walker({ periodSeconds: 8, orient: false, travelRole: 'route' });
    layer.transform = { ...layer.transform, rotation: 0.25 };
    const { compositor, holder } = mount(sceneOf(layer), [routeSurface(CORNER)]);
    compositor.update(frame(6, leaning(0.1)));
    expect(holder('walker').rotation).toBeCloseTo((0.25 + 0.1) * TAU, 9);
  });

  it('base -> motion -> forces, in position, with a force active: the wind leans a travelling object', () => {
    const { compositor, holder } = mount(
      sceneOf(walker({ periodSeconds: 8, travelRole: 'route' })),
      [routeSurface(STRAIGHT)],
    );
    const field = leaning(0.1);
    compositor.update(frame(2, field)); // route x 0.3, plus the force's offsetX
    const m = field.modulationFor(walker({ periodSeconds: 8, travelRole: 'route' }));
    expect(m.offsetX).not.toBe(0);
    expect(holder('walker').x).toBeCloseTo((0.3 + m.offsetX) * W, 6);
  });

  it('the heading turns at the corner', () => {
    const { compositor, holder } = mount(
      sceneOf(walker({ periodSeconds: 8, orient: true, travelRole: 'route' })),
      [routeSurface(CORNER)],
    );
    compositor.update(frame(2)); // first leg, +x
    expect(holder('walker').rotation).toBeCloseTo(0, 9);
    compositor.update(frame(6)); // second leg, +y (down the frame)
    expect(holder('walker').rotation).toBeCloseTo(0.25 * TAU, 9);
  });
});

/* -------------------------------------------------------------------------- */
/* Closed routes, misses, defaults                                            */
/* -------------------------------------------------------------------------- */

describe('I-17 — a closed route\'s arc length includes the closing segment', () => {
  const square: Path = createPath({
    id: 'sq',
    closed: true,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.6 },
      { x: 0.2, y: 0.6 },
    ],
  });

  it('pathLength counts four sides, not three', () => {
    expect(pathLength(square)).toBeCloseTo(1.6, 12);
    expect(pathLength({ ...square, closed: false })).toBeCloseTo(1.2, 12);
  });

  it('the last quarter of the loop is spent on the closing edge, at the same speed', () => {
    // 0.875 of the way round a square is halfway down the closing edge.
    const p = pointAtProgress(square, 0.875);
    expect(p.x).toBeCloseTo(0.2, 12);
    expect(p.y).toBeCloseTo(0.4, 12);
    // And the traveller lands there from the render path too.
    const { compositor, holder } = mount(
      sceneOf(walker({ periodSeconds: 8, travelRole: 'route' })),
      [routeSurface(square)],
    );
    compositor.update(frame(7)); // 7/8
    expect(holder('walker').x).toBeCloseTo(0.2 * W, 6);
    expect(holder('walker').y).toBeCloseTo(0.4 * H, 6);
  });
});

describe('I-13 — a travelRole matching nothing leaves the entity at its base, flagged', () => {
  it('no throw, no placeholder, base transform, a role miss that names the value', () => {
    const { compositor, holder } = mount(sceneOf(walker({ periodSeconds: 8, travelRole: 'nowhere' })), [
      routeSurface(STRAIGHT),
    ]);
    compositor.update(frame(2));
    expect(compositor.failures()).toEqual([]);
    expect(holder('walker').x).toBeCloseTo(0.2 * W, 6);
    expect(holder('walker').y).toBeCloseTo(0.9 * H, 6);
    const misses = compositor.roleMisses();
    expect(misses).toHaveLength(1);
    expect(misses[0]?.layerId).toBe('walker');
    expect(misses[0]?.role).toBe('nowhere');
    expect(misses[0]?.reason).toContain('"nowhere"');
  });

  it('a route too short to travel is flagged the same way', () => {
    const dot = createPath({ id: 'dot', closed: false, points: [{ x: 0.3, y: 0.3 }] });
    expect(isRouteTraversable(dot)).toBe(false);
    const { compositor, holder } = mount(sceneOf(walker({ periodSeconds: 8, travelRole: 'route' })), [
      routeSurface(dot),
    ]);
    compositor.update(frame(2));
    expect(holder('walker').x).toBeCloseTo(0.2 * W, 6);
    expect(compositor.roleMisses()[0]?.reason).toMatch(/cannot be travelled/);
  });

  it('an empty travelRole is "no route" and is NOT a miss — a default cannot be a defect', () => {
    const { compositor } = mount(sceneOf(walker({ periodSeconds: 8 })), [routeSurface(STRAIGHT)]);
    compositor.update(frame(2));
    expect(compositor.roleMisses()).toEqual([]);
  });

  it('a fill layer does not travel — it is placed by its face', () => {
    const face = createSurface({
      id: 'surface-1',
      name: 'face',
      role: 'panel',
      path: createPath({
        id: 'f',
        closed: true,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.1 },
          { x: 0.5, y: 0.5 },
          { x: 0.1, y: 0.5 },
        ],
      }),
    });
    // `travelRole: 'nowhere'` on purpose: a fill never resolves a route, so it
    // cannot MISS one either. A fill flagged for an unmatched travel role would
    // be a flag for a thing that was never going to happen.
    const fill = { ...walker({ periodSeconds: 8, travelRole: 'nowhere' }), fillRole: 'panel' };
    const { compositor, provider } = mount(sceneOf(fill), [face, routeSurface(STRAIGHT)]);
    compositor.update(frame(2));
    expect(compositor.roleMisses()).toEqual([]);
    // The fill's content sits at its face's centre, untouched by the route.
    const content = provider.views.get('walker')!.parent!;
    expect(content.x).toBeCloseTo(0.3 * W, 6);
    expect(content.y).toBeCloseTo(0.3 * H, 6);
  });
});

describe('a defaulted motion record renders exactly as no motion at all', () => {
  it('same holder position and rotation at several times, with a force active', () => {
    const plain = mount(sceneOf(walker(undefined)));
    const stated = mount(sceneOf(walker(DEFAULT_ROUTE_MOTION)));
    for (const t of [0, 2, 7.3]) {
      plain.compositor.update(frame(t, leaning(0.2)));
      stated.compositor.update(frame(t, leaning(0.2)));
      expect(stated.holder('walker').x).toBe(plain.holder('walker').x);
      expect(stated.holder('walker').y).toBe(plain.holder('walker').y);
      expect(stated.holder('walker').rotation).toBe(plain.holder('walker').rotation);
    }
    expect(stated.compositor.roleMisses()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The room moving under a traveller                                          */
/* -------------------------------------------------------------------------- */

describe('the route reshaped at the wall', () => {
  it('a point drag on the route moves the traveller with no rebuild', () => {
    const { compositor, provider, holder } = mount(
      sceneOf(walker({ periodSeconds: 8, travelRole: 'route' })),
      [routeSurface(STRAIGHT)],
    );
    compositor.update(frame(2));
    expect(holder('walker').y).toBeCloseTo(0.5 * H, 6);
    const creates = provider.creates;
    const lifted = routeSurface({
      ...STRAIGHT,
      points: [
        { x: 0.1, y: 0.3 },
        { x: 0.9, y: 0.3 },
      ],
    });
    compositor.setSurfaces([lifted]);
    compositor.update(frame(2));
    expect(holder('walker').y).toBeCloseTo(0.3 * H, 6);
    expect(provider.creates).toBe(creates);
  });

  it('a route crossing the two-point threshold is a shape change', () => {
    const one = [routeSurface(createPath({ id: 'r', closed: false, points: [{ x: 0.1, y: 0.5 }] }))];
    const two = [routeSurface(STRAIGHT)];
    expect(surfacesShapeKey(one)).not.toBe(surfacesShapeKey(two));
  });

  it('a route marked later picks up a traveller waiting for it — I-13 flag, then light', () => {
    const { compositor, holder } = mount(sceneOf(walker({ periodSeconds: 8, travelRole: 'route' })), []);
    compositor.update(frame(2));
    expect(compositor.roleMisses()).toHaveLength(1);
    compositor.setSurfaces([routeSurface(STRAIGHT)]);
    compositor.update(frame(2));
    expect(compositor.roleMisses()).toEqual([]);
    expect(holder('walker').x).toBeCloseTo(0.3 * W, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* The grep                                                                   */
/* -------------------------------------------------------------------------- */

describe('motion never sets a transform field directly (B5\'s rule, I-12)', () => {
  const code = readFileSync(new URL('../render/compositor.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('the compositor writes no layer.transform and composes through the axis vocabulary', () => {
    expect(code).not.toMatch(/transform\s*\.\s*(x|y|rotation|width|height)\s*=[^=]/);
    expect(code).not.toMatch(/\.transform\s*=[^=]/);
    expect(code).toMatch(/composeAxes\(/);
    expect(code).toMatch(/mode: 'override'/);
  });

  it('progress comes from motion.ts, not from arithmetic of its own', () => {
    expect(code).toMatch(/progressAt\(/);
    expect(code).toMatch(/pointAtProgress\(/);
    expect(code).not.toMatch(/progressAlong\(/);
    // Unused import guard: the test above proves the seam is used.
    expect(typeof progressAt).toBe('function');
  });
});
