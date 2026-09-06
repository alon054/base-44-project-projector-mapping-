/**
 * The white reference grid on the projection, and the three things that keep it
 * from ending up in a take.
 *
 * The grid itself is easy — lines at normalized positions, multiplied by the
 * output size. What is worth testing is everything around it:
 *
 *  1. It is **off** unless somebody turns it on, at construction and at every
 *     launch, and it is not persisted.
 *  2. The **golden harness never turns it on**, so no blessed frame can contain
 *     it — checked at the source, because that is where the guarantee lives.
 *  3. Hard rule 9's actual mechanism is **untouched**: the preview's SVG overlay
 *     still cannot reach the projector. This grid is a separate pattern drawn by
 *     the output window, not the editor's overlay leaking, and the import graph
 *     that says so still passes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Container, Graphics } from 'pixi.js';
import { drawWallGrid } from '../render/wallGrid';
import { gridLines } from '../editor/grid';
import { Compositor } from '../render/compositor';
import { createScene } from '../core/scene';
import { ProviderRegistry, type ContentProvider, type LayerView, type ProviderContext } from '../providers/ContentProvider';

const SRC = join(import.meta.dirname, '..');
const W = 1280;
const H = 720;

class StubProvider implements ContentProvider {
  readonly id = 'stub';
  create(ctx: ProviderContext): LayerView {
    const view = new Container();
    view.addChild(new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: 0x404040 }));
    return { view, update: () => {}, resize: () => {}, destroy: () => {} };
  }
}

function compositor(): Compositor {
  const providers = new ProviderRegistry();
  providers.register(new StubProvider());
  return new Compositor({ providers, width: W, height: H });
}

/** Every distinct pixel coordinate the grid drew a line at, per axis. */
function drawnLines(g: Graphics): { xs: number[]; ys: number[] } {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const inst of g.context.instructions) {
    const path = (inst as { data?: { path?: { instructions: { action: string; data: number[] }[] } } })
      .data?.path;
    if (!path) continue;
    for (const step of path.instructions) {
      if (step.action !== 'moveTo' && step.action !== 'lineTo') continue;
      const [x, y] = step.data;
      if (typeof x === 'number' && typeof y === 'number') {
        xs.add(x);
        ys.add(y);
      }
    }
  }
  return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) };
}

describe('drawWallGrid — normalized positions become pixels here and nowhere else (I-1)', () => {
  it('draws a line at every division the preview grid draws', () => {
    const g = drawWallGrid(new Graphics(), W, H);
    const { xs, ys } = drawnLines(g);
    for (const line of gridLines()) {
      if (line.axis === 'x') expect(xs, `x ${line.at}`).toContain(line.at * W);
      else expect(ys, `y ${line.at}`).toContain(line.at * H);
    }
  });

  it('is the SAME lines the preview draws, so the two can be read against each other', () => {
    // The divisions come from `editor/grid.ts` rather than being restated. If
    // that ever became a second list, this is what would notice: the wall would
    // be describing a different space than the preview the builder is placing in.
    const g = drawWallGrid(new Graphics(), W, H);
    const { xs } = drawnLines(g);
    const previewXs = gridLines()
      .filter((l) => l.axis === 'x')
      .map((l) => l.at * W);
    for (const x of previewXs) expect(xs).toContain(x);
  });

  it('the same grid at half the size is exactly half the pixels', () => {
    // I-1's actual claim, the way `mask.test.ts` states it: the stored positions
    // are untouched by the output size, so the two runs differ by the factor.
    const big = drawnLines(drawWallGrid(new Graphics(), W, H));
    const small = drawnLines(drawWallGrid(new Graphics(), W / 2, H / 2));
    expect(small.xs.map((x) => x * 2)).toEqual(big.xs);
  });

  it('draws the frame edge, which the preview grid deliberately does not', () => {
    // On a wall there is no canvas border, and the frame edge is what W1 warps
    // to the box — the single most useful line there is.
    const g = drawWallGrid(new Graphics(), W, H);
    const rect = g.context.instructions.some((inst) => {
      const path = (inst as { data?: { path?: { instructions: { action: string }[] } } }).data?.path;
      return path?.instructions.some((s) => s.action === 'rect') ?? false;
    });
    expect(rect).toBe(true);
    // And the preview's own grid still omits it, so nothing was changed there.
    expect(gridLines().some((l) => l.at === 0 || l.at === 1)).toBe(false);
  });

  it('clears before redrawing, so a resize does not leave the old grid behind', () => {
    const g = new Graphics();
    drawWallGrid(g, W, H);
    const first = g.context.instructions.length;
    drawWallGrid(g, W, H);
    expect(g.context.instructions.length).toBe(first);
  });
});

/**
 * The bug the projector found, and the upstream behaviour behind it.
 *
 * Reported from the wall: the grid appears the first time it is switched on and
 * never again after an off/on cycle. The cause is in PixiJS v8, not in the
 * grid — see `Compositor.setWallGrid` — and these two tests pin both halves, so
 * neither the fix nor its reason can be quietly lost.
 */
describe('a geometry update made to an INVISIBLE view is dropped by v8', () => {
  it('upstream: onViewUpdate latches, and updateRenderable will not clear it while hidden', () => {
    // `RenderGroup.updateRenderable` returns early when `globalDisplayStatus < 7`
    // WITHOUT clearing `didViewUpdate`, and `ViewContainer.onViewUpdate`
    // early-returns for as long as that latch is set. This test is the reason the
    // fix is an ordering rule rather than a guess; if a PixiJS upgrade changes
    // the behaviour, this is what says so.
    const g = new Graphics() as Graphics & { didViewUpdate: boolean };
    new Container().addChild(g);
    g.visible = false;
    // A view that has been rendered at least once: the renderer clears the latch
    // when it processes a VISIBLE view (`ViewContainer.collectRenderables` and
    // `RenderGroup.updateRenderable` both do). Modelled by hand, because there is
    // no GPU here and that is the state the projector was in.
    g.didViewUpdate = false;

    drawWallGrid(g, W, H);
    // The draw latches an update...
    expect(g.didViewUpdate).toBe(true);

    // ...and nothing clears it while the view is hidden, so a SECOND draw
    // cannot register one. That is the dropped update, exactly.
    const before = g.context.instructions.length;
    drawWallGrid(g, W / 2, H / 2);
    expect(g.didViewUpdate).toBe(true);
    // The instructions really did change underneath — it is the notification
    // that was lost, not the geometry, which is why it is invisible to a test
    // that only counts instructions.
    expect(g.context.instructions.length).toBe(before);
    // Redrawn at half the size — the geometry moved, only the notification was
    // lost. (Not an exact figure: the frame edge's stroke extends outward past
    // the inset rect, and this test is about the latch, not about bounds.)
    expect(g.context.bounds.maxX).toBeLessThan(W * 0.75);
  });

  it('so the compositor makes the grid visible BEFORE it draws into it', () => {
    // The mechanism, read at the source — the same shape as sceneEdit.test.ts's
    // "setScene tears the stack down BEFORE it rebuilds". Swapping these two
    // lines is the entire bug, and it is invisible to every behavioural test
    // that does not have a GPU.
    const body = readFileSync(join(SRC, 'render', 'compositor.ts'), 'utf8')
      .match(/setWallGrid\(on: boolean\): void \{([\s\S]*?)\n  \}/)![1]!;
    const visibleAt = body.indexOf('this.wallGrid.visible = on');
    const drawAt = body.indexOf('drawWallGrid(');
    expect(visibleAt, 'setWallGrid stopped setting visible').toBeGreaterThanOrEqual(0);
    expect(drawAt, 'setWallGrid stopped drawing').toBeGreaterThanOrEqual(0);
    expect(drawAt, 'the grid is drawn BEFORE it is made visible — v8 drops that update').toBeGreaterThan(visibleAt);
  });

  it('turning it off and on again leaves it on, with current geometry', () => {
    const c = compositor();
    c.setWallGrid(true);
    c.setWallGrid(false);
    c.setWallGrid(true);
    expect(c.wallGridOn()).toBe(true);
    c.destroy();
  });

  it('the resize path only redraws a grid that is already visible', () => {
    // The same hazard from the other side: redrawing a hidden grid on resize
    // would latch an update nothing clears. It is skipped instead, and turning
    // the grid on redraws it at the current size anyway.
    const body = readFileSync(join(SRC, 'render', 'compositor.ts'), 'utf8');
    expect(body).toMatch(/if \(this\.wallGrid\.visible\) drawWallGrid/);
  });
});

describe('the grid is off until somebody turns it on', () => {
  it('a fresh compositor has no grid', () => {
    const c = compositor();
    expect(c.wallGridOn()).toBe(false);
    c.destroy();
  });

  it('toggles, and reports what it is actually doing', () => {
    const c = compositor();
    c.setWallGrid(true);
    expect(c.wallGridOn()).toBe(true);
    c.setWallGrid(false);
    expect(c.wallGridOn()).toBe(false);
    c.destroy();
  });

  it('setting a scene does not turn it on — content cannot raise a guide line', () => {
    const c = compositor();
    c.setScene(createScene({ id: 's' }));
    expect(c.wallGridOn()).toBe(false);
    c.destroy();
  });

  it('a resize does not turn it on either', () => {
    const c = compositor();
    c.resize(640, 360);
    expect(c.wallGridOn()).toBe(false);
    c.destroy();
  });
});

/**
 * The mechanism, read at the source. A behaviour test could only show that the
 * harness does not enable the grid TODAY; these say there is no call to.
 */
describe('no blessed frame can contain the grid', () => {
  const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

  it('the golden harness never asks for it', () => {
    expect(read('golden', 'main.ts')).not.toMatch(/setWallGrid|wallGrid/);
  });

  it('only the output window turns it on, and only from the shortcut table', () => {
    // The editor preview deliberately does NOT draw it: the preview already has
    // D11's scene-space grid, and drawing both would double every line.
    expect(read('editor', 'PreviewCanvas.tsx')).not.toMatch(/setWallGrid/);
    const out = read('output', 'main.ts');
    expect(out).toMatch(/wallGrid:/);
    expect(out).toMatch(/setWallGrid/);
    // And it logs, so a take shot with it up is answerable from the run log
    // rather than from an argument about a video.
    expect(out).toMatch(/\[grid\]/);
  });

  it('it is NOT persisted — a grid remembered from yesterday is a grid in a take', () => {
    // The HUD is persisted through `hud:state`; this deliberately is not, so it
    // is off at every launch whatever happened the night before.
    const out = read('output', 'main.ts');
    const handler = out.slice(out.indexOf('wallGrid: ()'), out.indexOf('wallGrid: ()') + 400);
    expect(handler).not.toMatch(/setHudState|hudState|config/i);
  });
});

/**
 * Hard rule 9's guard, restated where the grid is, because this is the block
 * that could plausibly have weakened it.
 */
describe('rule 9 still holds — the preview overlay cannot reach the projector', () => {
  const importsOf = (file: string): string[] =>
    [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

  it('wallGrid.ts reaches no editor module but the pure grid geometry', () => {
    // `editor/grid.ts` is pure normalized geometry that "knows nothing about the
    // preview" by its own header — it is misnamed rather than misplaced, and
    // `core/` is where it should eventually live. Importing it keeps ONE
    // definition of where the lines are; importing anything else from `editor/`
    // would be the door this test exists to keep shut.
    const bad = importsOf(join(SRC, 'render', 'wallGrid.ts')).filter(
      (i) => /editor\//.test(i) && !/editor\/grid$/.test(i),
    );
    expect(bad).toEqual([]);
  });

  it('the grid is drawn from geometry, not from anything the preview renders', () => {
    // Comments stripped first. The file's header discusses rule 9 at length and
    // names the very things it must not USE, which is the point of the header —
    // a source check that could not tell an explanation from a call would have
    // to be satisfied by deleting the explanation.
    const code = readFileSync(join(SRC, 'render', 'wallGrid.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/PreviewCanvas|BankedPath|PathOverlay|SceneGrid/);
  });
});
