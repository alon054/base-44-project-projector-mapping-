/**
 * B2 — the mask, the role fill, and the counter that proves the mask is free.
 *
 * Three claims are under test here and they fail in different ways, so they are
 * tested separately:
 *
 *  1. **The geometry.** A normalized path becomes pixels once, at draw time.
 *     Pure arithmetic, checked against literal coordinates.
 *  2. **The wiring.** One layer with a `fillRole` becomes one provider view per
 *     matching face, each handed that face's pixel box (I-3) and clipped by a
 *     `Graphics`. Checked on a real `Compositor` with a recording provider —
 *     no GPU is needed to build a display list, which is why this can be a unit
 *     test at all rather than only a picture.
 *  3. **The cost.** A `Graphics` mask takes PixiJS v8's stencil path and a
 *     `Sprite` mask takes the alpha path, which allocates a render target per
 *     masked container. The negative control below is the point: it asserts
 *     that the wrong choice really would be the expensive one, so the passing
 *     assertion beside it is worth something.
 *
 * What is NOT here: whether the clipped result looks right. That is the golden
 * runner's `fill-two-surfaces-one-role`, and ultimately the wall.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Container, Graphics, Sprite, StencilMask } from 'pixi.js';
import {
  MASK_MIN_POINTS,
  buildMask,
  drawMask,
  isMaskable,
  pathPixelBounds,
  pathPixelPoints,
} from '../render/mask';
import { Compositor } from '../render/compositor';
import { createPath, type Path } from '../core/paths';
import { createSurface, canonicalizeSurface, type Surface } from '../core/surfaces';
import { resetRoleLog } from '../core/roles';
import { readSurfaces } from '../render/calibration';
import { createLayer } from '../core/layer';
import { FIXTURE_L } from './roomFixture';
import { createScene } from '../core/scene';
import { EMPTY_FORCE_FIELD, evaluateForces } from '../core/forces';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import {
  ProviderRegistry,
  type ContentProvider,
  type LayerFrame,
  type LayerView,
  type ProviderContext,
} from '../providers/ContentProvider';
import { INVALID_RENDER_TARGETS, readGpuResources, readRenderTargets } from '../debug/gpu';

const W = 1280;
const H = 720;

const FRAME: LayerFrame = {
  timeSeconds: 1,
  phase: 0.25,
  playing: false,
  rate: 1,
  scrubSeq: 0,
  forces: EMPTY_FORCE_FIELD,
};

/** A square in the top-left quadrant. Four points, closed. */
const square = (id = 'p'): Path =>
  createPath({
    id,
    closed: true,
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.6 },
      { x: 0.1, y: 0.6 },
    ],
  });

/** The committed room from B1, read through the loader that ships. */
function committedRoom(): Surface[] {
  const raw = JSON.parse(
    readFileSync(join(new URL('../../', import.meta.url).pathname, 'calibration', 'surfaces.json'), 'utf8'),
  ) as unknown;
  return readSurfaces(raw, canonicalizeSurface);
}

/** What one `create` call was handed. The I-3 claim is checked against these. */
interface Call {
  width: number;
  height: number;
  layerId: string;
}

class RecordingProvider implements ContentProvider {
  readonly id = 'recording';
  readonly calls: Call[] = [];
  readonly resizes: [number, number][] = [];
  readonly views: Container[] = [];
  /** Throw on the Nth create (1-based). 0 means never. */
  throwOnCreate = 0;
  /** Throw on the Nth update across all instances. 0 means never. */
  throwOnUpdate = 0;
  private updates = 0;

  create(ctx: ProviderContext): LayerView {
    this.calls.push({ width: ctx.width, height: ctx.height, layerId: ctx.layer.id });
    if (this.throwOnCreate === this.calls.length) throw new Error('provider create failed');
    const view = new Container();
    view.addChild(new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: 0x808080 }));
    this.views.push(view);
    return {
      view,
      update: () => {
        this.updates++;
        if (this.throwOnUpdate === this.updates) throw new Error('provider update failed');
      },
      resize: (w, h) => {
        this.resizes.push([w, h]);
      },
      destroy: () => {},
    };
  }
}

function compositorWith(
  surfaces: readonly Surface[],
  provider: ContentProvider,
): Compositor {
  const providers = new ProviderRegistry();
  providers.register(provider);
  return new Compositor({ providers, width: W, height: H, surfaces });
}

/** The mask effect PixiJS chose for a container, by class. */
const maskEffectOf = (c: Container): unknown =>
  (c as unknown as { _maskEffect: unknown })._maskEffect;

/** The pixel points a mask actually recorded, straight out of its context. */
function maskPoints(g: Graphics): number[] {
  const fill = g.context.instructions[0] as
    | { data: { path?: { instructions: { data: unknown[] }[] } } }
    | undefined;
  const poly = fill?.data.path?.instructions[0];
  return (poly?.data[0] as number[]) ?? [];
}

describe('I-1 — a path becomes pixels at draw time and nowhere else', () => {
  it('multiplies normalized points by the output size, in order', () => {
    expect(pathPixelPoints(square(), W, H)).toEqual([
      0.1 * W, 0.2 * H,
      0.5 * W, 0.2 * H,
      0.5 * W, 0.6 * H,
      0.1 * W, 0.6 * H,
    ]);
  });

  it('the same path at half the resolution is exactly half the pixels', () => {
    // I-1's actual claim. Not "roughly proportional" — the stored value is
    // untouched by the size, so the two runs differ by exactly the factor.
    const big = pathPixelPoints(square(), W, H);
    const small = pathPixelPoints(square(), W / 2, H / 2);
    expect(small).toEqual(big.map((v) => v / 2));
  });

  it('the bounding box is the extent of the points, in pixels (I-3)', () => {
    expect(pathPixelBounds(square(), W, H)).toEqual({
      x: 0.1 * W,
      y: 0.2 * H,
      width: 0.4 * W,
      height: 0.4 * H,
    });
  });

  it('a reflex corner does not shrink the box below the outermost point', () => {
    // B1's six-point L, from the FROZEN fixture rather than from
    // `calibration/surfaces.json`. That file is the room a builder marks, and a
    // test asserting its exact coordinates goes red the first time the tool is
    // used for its purpose — see `roomFixture.ts`. The claim here is about the
    // arithmetic, not about anybody's room.
    //
    // The box is the full extent; the notch is the mask's job, not the box's,
    // and a box that followed the notch would starve the provider of the pixels
    // it has to draw into.
    const l = FIXTURE_L;
    const box = pathPixelBounds(l.path, W, H);
    expect(box.x).toBeCloseTo(0.56 * W, 6);
    expect(box.y).toBeCloseTo(0.16 * H, 6);
    expect(box.width).toBeCloseTo(0.36 * W, 6);
    expect(box.height).toBeCloseTo(0.64 * H, 6);
  });

  it('an empty path has no box rather than an invented one', () => {
    expect(pathPixelBounds(createPath({ id: 'e' }), W, H)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('R3 — the mask is a Graphics, and that is what makes it free', () => {
  it('records the pixel outline it was given', () => {
    expect(maskPoints(buildMask(square(), W, H))).toEqual(pathPixelPoints(square(), W, H));
  });

  it('closes an open path, because an area is closed or it is not an area', () => {
    const open = createPath({ id: 'o', closed: false, points: square().points });
    expect(maskPoints(buildMask(open, W, H))).toEqual(maskPoints(buildMask(square(), W, H)));
  });

  it('draws nothing for a path that cannot enclose an area', () => {
    for (const n of [0, 1, 2]) {
      const p = createPath({ id: 'p', closed: true, points: square().points.slice(0, n) });
      expect(isMaskable(p)).toBe(false);
      expect(buildMask(p, W, H).context.instructions).toHaveLength(0);
    }
    expect(MASK_MIN_POINTS).toBe(3);
    expect(isMaskable(createPath({ id: 'p', points: square().points.slice(0, 3) }))).toBe(true);
  });

  it('redraws in place on a resize instead of allocating a second mask', () => {
    const g = buildMask(square(), W, H);
    const same = drawMask(g, square(), W / 2, H / 2);
    expect(same).toBe(g);
    expect(maskPoints(g)).toEqual(pathPixelPoints(square(), W / 2, H / 2));
  });

  it('a Graphics mask takes the stencil path — and a Sprite mask would not', () => {
    // The claim and its negative control, side by side. R3 is not "we chose a
    // Graphics"; it is "the choice is what decides whether a render target is
    // allocated", and that is only demonstrated by showing the other branch.
    const clipped = new Container();
    const mask = buildMask(square(), W, H);
    clipped.addChild(mask);
    clipped.mask = mask;
    expect(maskEffectOf(clipped)).toBeInstanceOf(StencilMask);

    const wrong = new Container();
    wrong.mask = new Sprite();
    expect(maskEffectOf(wrong)).not.toBeInstanceOf(StencilMask);
    expect((maskEffectOf(wrong) as { constructor: { name: string } }).constructor.name).toBe(
      'AlphaMask',
    );
  });
});

describe('R2 — a layer with a fillRole renders once into every matching face', () => {
  const twoPanels = (): Surface[] => [
    createSurface({ id: 'surface-1', role: 'panel', path: square('a') }),
    createSurface({
      id: 'surface-2',
      role: 'panel',
      path: createPath({
        id: 'b',
        closed: true,
        points: [
          { x: 0.6, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.5 },
          { x: 0.6, y: 0.5 },
        ],
      }),
    }),
    createSurface({ id: 'surface-3', role: 'floor', path: square('c') }),
  ];

  const fillScene = (role = 'panel', blendMode: 'normal' | 'add' = 'add') =>
    createScene({
      id: 's',
      seed: 1,
      layers: [
        createLayer({
          id: 'fill',
          providerId: 'recording',
          fillRole: role,
          blendMode,
          zOrder: 0,
        }),
      ],
    });

  it('creates one instance per surface carrying the role, in marking order', () => {
    const provider = new RecordingProvider();
    const c = compositorWith(twoPanels(), provider);
    c.setScene(fillScene());
    // Two `panel` faces, one `floor` face that must not be touched.
    expect(provider.calls).toHaveLength(2);
    expect(c.roleMisses()).toEqual([]);
    expect(c.failures()).toEqual([]);
    c.destroy();
  });

  it('hands each instance THAT face’s pixel box and nothing else (I-3)', () => {
    const provider = new RecordingProvider();
    const c = compositorWith(twoPanels(), provider);
    c.setScene(fillScene());
    expect(provider.calls.map((call) => [call.width, call.height])).toEqual([
      [Math.round(0.4 * W), Math.round(0.4 * H)],
      [Math.round(0.3 * W), Math.round(0.4 * H)],
    ]);
    // The layer's own transform is the default full frame. If the fill were
    // sized from it, both boxes would read 1280x720 — which is exactly the bug
    // this assertion exists to catch.
    expect(provider.calls.every((call) => call.width !== W)).toBe(true);
    c.destroy();
  });

  it('masks each instance with its own outline', () => {
    const provider = new RecordingProvider();
    const surfaces = twoPanels();
    const c = compositorWith(surfaces, provider);
    c.setScene(fillScene());
    const instances = provider.views.map((v) => v.parent!.parent!);
    expect(instances).toHaveLength(2);
    for (const [i, instance] of instances.entries()) {
      const mask = instance.mask as Graphics;
      expect(mask).toBeInstanceOf(Graphics);
      expect(maskEffectOf(instance)).toBeInstanceOf(StencilMask);
      expect(maskPoints(mask)).toEqual(pathPixelPoints(surfaces[i]!.path, W, H));
    }
    c.destroy();
  });

  it('lands each instance on its own face, not on the layer’s transform', () => {
    const provider = new RecordingProvider();
    const surfaces = twoPanels();
    const c = compositorWith(surfaces, provider);
    c.setScene(fillScene());
    c.update(FRAME);
    for (const [i, view] of provider.views.entries()) {
      const box = pathPixelBounds(surfaces[i]!.path, W, H);
      const content = view.parent!;
      expect(content.position.x).toBeCloseTo(box.x + box.width / 2, 6);
      expect(content.position.y).toBeCloseTo(box.y + box.height / 2, 6);
    }
    c.destroy();
  });

  it('I-6: the layer’s blend mode reaches the masked instance', () => {
    const provider = new RecordingProvider();
    const c = compositorWith(twoPanels(), provider);
    c.setScene(fillScene('panel', 'add'));
    // holder -> instance -> content -> provider view. `add` on dark is what the
    // reel is shot with, so it has to survive the two containers the mask added.
    // view -> content -> instance -> the stack's own root -> holder.
    const holder = provider.views[0]!.parent!.parent!.parent!.parent!;
    expect(holder.blendMode).toBe('add');
    c.destroy();
  });

  it('rebuilds every mask and box on a resize rather than scaling them', () => {
    const provider = new RecordingProvider();
    const surfaces = twoPanels();
    const c = compositorWith(surfaces, provider);
    c.setScene(fillScene());
    provider.resizes.length = 0;
    c.resize(W / 2, H / 2);
    expect(provider.resizes).toEqual([
      [Math.round(0.4 * (W / 2)), Math.round(0.4 * (H / 2))],
      [Math.round(0.3 * (W / 2)), Math.round(0.4 * (H / 2))],
    ]);
    const mask = provider.views[0]!.parent!.parent!.mask as Graphics;
    expect(maskPoints(mask)).toEqual(pathPixelPoints(surfaces[0]!.path, W / 2, H / 2));
    c.destroy();
  });

  it('a face marked later lights itself, with no scene edit (beat 7)', () => {
    const provider = new RecordingProvider();
    const c = compositorWith([twoPanels()[0]!], provider);
    c.setScene(fillScene());
    expect(provider.calls).toHaveLength(1);
    c.setSurfaces(twoPanels());
    expect(provider.calls).toHaveLength(3); // one rebuild, now two faces
    c.destroy();
  });

  it('a force moves the content INSIDE the mask and never the mask', () => {
    const provider = new RecordingProvider();
    const surfaces = twoPanels();
    const c = compositorWith(surfaces, provider);
    c.setScene(fillScene());
    c.update(FRAME);
    const instance = provider.views[0]!.parent!.parent!;
    const content = provider.views[0]!.parent!;
    const before = { x: content.position.x, mask: maskPoints(instance.mask as Graphics) };

    const forces = evaluateForces({
      definitions: FORCE_DEFINITIONS,
      values: { wind: { strength: 1 } },
      timeSeconds: 3,
      seed: 0x5eed,
    });
    c.update({ ...FRAME, forces });
    // Something moved...
    expect(content.position.x).not.toBe(before.x);
    // ...and it was not the clip. A mask that travelled with the content would
    // slide the lit shape off the box, which is a re-shoot rather than a bug.
    expect(maskPoints(instance.mask as Graphics)).toEqual(before.mask);
    c.destroy();
  });
});

describe('B1’s committed room, filled by one layer', () => {
  it('one `panel` layer fills every `panel` face in calibration/surfaces.json', () => {
    // The Done-when line, against the actual file rather than against a copy of
    // it. Written to survive B3: it asserts the count MATCHES the room, not
    // that the room has two faces, so an evening of re-marking cannot turn this
    // red for a reason that has nothing to do with the compositor.
    const room = committedRoom();
    const panels = room.filter((s) => s.role === 'panel');
    expect(panels.length).toBeGreaterThan(0);

    const provider = new RecordingProvider();
    const c = compositorWith(room, provider);
    c.setScene(
      createScene({
        id: 's',
        seed: 1,
        layers: [createLayer({ id: 'fill', providerId: 'recording', fillRole: 'panel' })],
      }),
    );
    expect(provider.calls).toHaveLength(panels.length);
    expect(provider.calls.map((call) => [call.width, call.height])).toEqual(
      panels.map((s) => {
        const box = pathPixelBounds(s.path, W, H);
        return [Math.max(1, Math.round(box.width)), Math.max(1, Math.round(box.height))];
      }),
    );
    expect(c.roleMisses()).toEqual([]);
    expect(c.failures()).toEqual([]);
    c.destroy();
  });
});

describe('I-13 — a fill that lands nowhere is flagged, not substituted', () => {
  const withMiss = (surfaces: Surface[], role: string) => {
    const provider = new RecordingProvider();
    const c = compositorWith(surfaces, provider);
    c.setScene(
      createScene({
        id: 's',
        seed: 1,
        layers: [
          createLayer({ id: 'fill', providerId: 'recording', fillRole: role, zOrder: 0 }),
          createLayer({ id: 'plain', providerId: 'recording', zOrder: 1 }),
        ],
      }),
    );
    return { provider, c };
  };

  it('draws nothing, substitutes nothing, and lets the rest of the frame draw', () => {
    const { provider, c } = withMiss(
      [createSurface({ id: 'surface-1', role: 'panel', path: square() })],
      'bxo-left',
    );
    // No instance for the fill; the plain layer beside it was created normally.
    expect(provider.calls.map((call) => call.layerId)).toEqual(['plain']);
    // Not a placeholder: a magenta box for a typo is a second wrong answer.
    expect(c.failures()).toEqual([]);
    const miss = c.roleMisses();
    expect(miss).toHaveLength(1);
    expect(miss[0]!.layerId).toBe('fill');
    expect(miss[0]!.role).toBe('bxo-left');
    // A9: the message names the offending value AND what exists.
    expect(miss[0]!.reason).toContain('bxo-left');
    expect(miss[0]!.reason).toContain('panel');
    c.update(FRAME);
    expect(c.failures()).toEqual([]);
    c.destroy();
  });

  it('logs a miss once per role, not once per rebuild', () => {
    resetRoleLog();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { c } = withMiss([createSurface({ id: 'surface-1', path: square() })], 'typo');
      // A point drag rebuilds the stack on every pointer move. Sixty warnings a
      // second for one typo is the failure `roles.ts` exists to avoid.
      for (let i = 0; i < 5; i++) c.setSurfaces([createSurface({ id: 'surface-1', path: square() })]);
      expect(warn).toHaveBeenCalledTimes(1);
      c.destroy();
    } finally {
      warn.mockRestore();
      resetRoleLog();
    }
  });

  it('skips a face still being marked and lights its siblings', () => {
    const provider = new RecordingProvider();
    const c = compositorWith(
      [
        createSurface({
          id: 'surface-1',
          role: 'panel',
          path: createPath({ id: 'half', closed: true, points: square().points.slice(0, 2) }),
        }),
        createSurface({ id: 'surface-2', role: 'panel', path: square('b') }),
      ],
      provider,
    );
    c.setScene(
      createScene({
        id: 's',
        seed: 1,
        layers: [createLayer({ id: 'fill', providerId: 'recording', fillRole: 'panel' })],
      }),
    );
    expect(provider.calls).toHaveLength(1);
    expect(c.roleMisses()).toHaveLength(1);
    expect(c.roleMisses()[0]!.reason).toContain('surface-1');
    expect(c.failures()).toEqual([]);
    c.destroy();
  });
});

describe('I-13 — one layer drawing N times is still one layer to isolate', () => {
  const twoLayerScene = () =>
    createScene({
      id: 's',
      seed: 1,
      layers: [
        createLayer({ id: 'fill', providerId: 'recording', fillRole: 'panel', zOrder: 0 }),
        createLayer({ id: 'plain', providerId: 'recording', zOrder: 1 }),
      ],
    });

  const surfaces = (): Surface[] => [
    createSurface({ id: 'surface-1', role: 'panel', path: square('a') }),
    createSurface({ id: 'surface-2', role: 'panel', path: square('b') }),
  ];

  it('a throw in ONE instance at create disables that layer and not the frame', () => {
    const provider = new RecordingProvider();
    provider.throwOnCreate = 2; // the second face, after the first succeeded
    const c = compositorWith(surfaces(), provider);
    c.setScene(twoLayerScene());
    const failed = c.failures();
    expect(failed.map((f) => f.layerId)).toEqual(['fill']);
    expect(failed[0]!.reason).toBe('provider create failed');
    // The layer beside it still built, which is the whole of I-13.
    expect(provider.calls.map((call) => call.layerId)).toEqual(['fill', 'fill', 'plain']);
    c.destroy();
  });

  it('a throw in ONE instance mid-frame disables that layer and not the frame', () => {
    const provider = new RecordingProvider();
    const c = compositorWith(surfaces(), provider);
    c.setScene(twoLayerScene());
    provider.throwOnUpdate = 2; // the fill's second instance, on the first frame
    c.update(FRAME);
    expect(c.failures().map((f) => f.layerId)).toEqual(['fill']);
    // And it is not retried: a broken provider must not be 60 exceptions a second.
    const before = c.failures().length;
    c.update(FRAME);
    c.update(FRAME);
    expect(c.failures()).toHaveLength(before);
    c.destroy();
  });

  it('the placeholder for a failed fill is drawn at the layer’s own transform', () => {
    const provider = new RecordingProvider();
    const c = compositorWith(surfaces(), provider);
    c.setScene(
      createScene({
        id: 's',
        seed: 1,
        layers: [
          createLayer({
            id: 'fill',
            providerId: 'recording',
            fillRole: 'panel',
            transform: { x: 0.25, y: 0.75, width: 0.4, height: 0.2, rotation: 0 },
          }),
        ],
      }),
    );
    provider.throwOnUpdate = 1;
    c.update(FRAME);
    // The fill holder sat at identity while it was a fill. A placeholder left
    // there would land in the frame's corner instead of on the layer.
    const holder = c.view.children[1]!.children[0]!;
    expect(holder.position.x).toBeCloseTo(0.25 * W, 6);
    expect(holder.position.y).toBeCloseTo(0.75 * H, 6);
    c.destroy();
  });
});

describe('a layer with no fillRole is untouched by any of this', () => {
  it('is handed its own transform box and carries no mask', () => {
    const provider = new RecordingProvider();
    const c = compositorWith([createSurface({ id: 'surface-1', path: square() })], provider);
    c.setScene(
      createScene({
        id: 's',
        seed: 1,
        layers: [
          createLayer({
            id: 'plain',
            providerId: 'recording',
            transform: { x: 0.5, y: 0.5, width: 0.5, height: 0.25, rotation: 0 },
          }),
        ],
      }),
    );
    expect(provider.calls).toEqual([{ layerId: 'plain', width: W / 2, height: H / 4 }]);
    const holder = provider.views[0]!.parent!;
    expect(holder.mask).toBeFalsy();
    // Straight into the holder — no instance container, no content container.
    expect(holder.position.x).toBeCloseTo(0.5 * W, 6);
    c.destroy();
  });
});

describe('A14 — the render-target counter reports on itself', () => {
  /** A renderer shaped like PixiJS v8's, with `n` live targets. */
  const rendererWith = (n: number, gpuHash: Record<string, unknown>) => ({
    renderTarget: {
      _renderSurfaceToRenderTargetHash: new Map(
        Array.from({ length: n }, (_, i) => [`surface-${i}`, { uid: i }]),
      ),
      _gpuRenderTargetHash: gpuHash,
    },
  });

  it('counts live targets from the Map that has no graves', () => {
    const r = readRenderTargets(rendererWith(2, { 1: {}, 2: {} }));
    expect(r.valid).toBe(true);
    expect(r.count).toBe(2);
    expect(r.gpuLive).toBe(2);
    expect(r.gpuSlots).toBe(2);
  });

  it('counts the gpu hash BOTH ways, because that one does tombstone', () => {
    // `destroyRenderTarget` assigns null into `_gpuRenderTargetHash` rather than
    // deleting the key — the identical shape to `managedTextures`, which
    // reported a 5209% false leak for four gates by counting graves.
    const r = readRenderTargets(rendererWith(1, { 1: {}, 2: null, 3: null }));
    expect(r.count).toBe(1);
    expect(r.gpuLive).toBe(1);
    expect(r.gpuSlots).toBe(3);
  });

  it('reports INVALID rather than a confident zero when the internals move', () => {
    for (const bad of [null, undefined, 42, {}, { renderTarget: 7 }]) {
      const r = readRenderTargets(bad);
      expect(r.valid).toBe(false);
      expect(r.count).toBe(0);
      expect(r.invalidReason).toMatch(/renderTarget/);
    }
    expect(readRenderTargets({ renderTarget: { _gpuRenderTargetHash: {} } }).invalidReason).toContain(
      '_renderSurfaceToRenderTargetHash',
    );
  });

  it('cannot invalidate the four counters beside it', () => {
    // The A14 lesson as a test. This counter is new; textures, buffers and
    // geometries have four gates of history behind them, and a version bump
    // that hides the render-target system must not take those down with it.
    const report = readGpuResources({
      texture: { managedTextures: [{ pixelWidth: 4, pixelHeight: 4 }] },
      buffer: { _managedBuffers: { items: { 1: {} } } },
      geometry: { _managedGeometries: { items: { 1: {} } } },
    });
    expect(report.valid).toBe(true);
    expect(report.renderTargets.valid).toBe(false);
    expect(INVALID_RENDER_TARGETS.count).toBe(0);
  });
});
