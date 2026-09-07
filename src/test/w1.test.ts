/**
 * W1 fixes — what the builder's first wall session exposed, in their words:
 * a guide grid per face on the projector (and from launch), no white fill,
 * the control panel showing a placeholder for a clip the projector played,
 * and low-quality animations. Each is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Container, Graphics } from 'pixi.js';
import { Compositor } from '../render/compositor';
import { FACE_GRID_DIVISIONS, drawFaceGuide, drawFaceGuides } from '../render/faceGuides';
import { createPath, type Path } from '../core/paths';
import { canonicalizeSurface, createSurface, reconcileSurfaces, withSurfaceGuide, type SurfaceTree } from '../core/surfaces';
import { createBlankScene } from '../core/defaultScene';
import { createLayer } from '../core/layer';
import { type ContentProvider, type LayerView, type ProviderContext } from '../providers/ContentProvider';
import { ProviderRegistry } from '../providers/ContentProvider';
import { createScene } from '../core/scene';
import { addAssetFill } from '../core/sceneEdit';

const ROOT = join(new URL('../../', import.meta.url).pathname);
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const W = 1280;
const H = 720;

function quad(id: string, x = 0.1, y = 0.2): Path {
  return createPath({
    id,
    closed: true,
    points: [{ x, y }, { x: x + 0.3, y }, { x: x + 0.3, y: y + 0.3 }, { x, y: y + 0.3 }],
  });
}
function line(id: string): Path {
  return createPath({ id, closed: false, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] });
}
function room(...paths: Path[]): SurfaceTree {
  return paths.map((p, i) => createSurface({ id: `surface-${i + 1}`, name: `face ${i + 1}`, path: p }));
}
function compositor(surfaces: SurfaceTree): Compositor {
  return new Compositor({ providers: new ProviderRegistry(), width: W, height: H, surfaces });
}
function guidesOf(c: Compositor): Container[] {
  const out: Container[] = [];
  const walk = (n: Container): void => {
    if (n.label?.startsWith('guide:')) out.push(n);
    for (const ch of n.children) walk(ch as Container);
  };
  walk(c.view);
  return out;
}

describe('W1 note 1 — a white guide grid on every marked face, on the projection', () => {
  it('off at construction, like the wall grid; nothing drawn while hidden (A14)', () => {
    const c = compositor(room(quad('p1'), quad('p2', 0.5, 0.5)));
    expect(c.wallGridOn()).toBe(false);
    expect(guidesOf(c)).toEqual([]);
    c.destroy();
  });

  it('follows the wall grid\'s ONE toggle: on → one guide per maskable face, off → hidden', () => {
    const c = compositor(room(quad('p1'), quad('p2', 0.5, 0.5), line('open')));
    c.setWallGrid(true);
    // The two-point path is not a face (MASK_MIN_POINTS) and gets no guide.
    const on = guidesOf(c);
    expect(on.map((g) => g.label)).toEqual(['guide:surface-1', 'guide:surface-2']);
    expect(on.every((g) => g.parent!.visible)).toBe(true);
    c.setWallGrid(false);
    // Hidden, not torn down — the wall grid keeps its geometry the same way,
    // and a hidden container is no draw and no redraw (A14).
    expect(guidesOf(c).every((g) => !g.parent!.visible)).toBe(true);
    expect(c.wallGridOn()).toBe(false);
    c.destroy();
  });

  it('each guide is clipped by the face\'s own mask and holds an outline plus a 4×4 grid', () => {
    const c = compositor(room(quad('p1')));
    c.setWallGrid(true);
    const [g] = guidesOf(c);
    expect(g!.mask).toBeInstanceOf(Graphics);
    const grid = new Graphics();
    drawFaceGuide(grid, quad('p1'), W, H);
    // (DIVISIONS - 1) lines per axis, one stroke for all of them, plus the outline's stroke.
    expect(FACE_GRID_DIVISIONS).toBe(4);
    expect(grid.context.instructions.length).toBeGreaterThanOrEqual(2);
    c.destroy();
  });

  it('a room write redraws the guides from the new path — never scaled, never stale', () => {
    const before = room(quad('p1'));
    const c = compositor(before);
    c.setWallGrid(true);
    const first = guidesOf(c)[0]!.mask as Graphics;
    const firstX = first.context.bounds.minX;
    const moved = reconcileSurfaces(before, [quad('p1', 0.4, 0.2)]);
    c.setSurfaces(moved);
    const second = guidesOf(c)[0]!.mask as Graphics;
    expect(second.context.bounds.minX).toBeGreaterThan(firstX);
    c.destroy();
  });

  it('a room write while the guides are hidden draws nothing', () => {
    const before = room(quad('p1'));
    const c = compositor(before);
    c.setSurfaces(reconcileSurfaces(before, [quad('p1', 0.4, 0.2)]));
    expect(guidesOf(c)).toEqual([]);
    c.destroy();
  });

  it('sits between the layers and the wall grid, inside the composite (pre-warp)', () => {
    const src = read('src/render/compositor.ts');
    expect(src).toMatch(/addChild\(this\.background, this\.layerRoot, this\.faceGuides, this\.wallGrid\)/);
  });

  it('visible-then-draw, the v8 rule, in setWallGrid and in setSurfaces and resize', () => {
    const src = read('src/render/compositor.ts');
    const body = src.match(/setWallGrid\(on: boolean\): void \{([\s\S]*?)\n  \}/)![1]!;
    expect(body.indexOf('this.faceGuides.visible = on')).toBeLessThan(body.indexOf('this.refreshGuides()'));
    // One redraw path, guarded on visibility, called from the room write, the
    // scene apply and the resize — never per frame.
    const refresh = src.match(/private refreshGuides\(\): void \{([\s\S]*?)\n  \}/)![1]!;
    expect(refresh.indexOf('if (!this.faceGuides.visible) return;')).toBeLessThan(refresh.indexOf('drawFaceGuides('));
    expect((src.match(/this\.refreshGuides\(\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(src).not.toMatch(/update\([\s\S]{0,400}refreshGuides/);
  });

  it('the golden harness never enables it, so no blessed frame can contain a guide', () => {
    expect(read('src/golden/main.ts')).not.toMatch(/setWallGrid|faceGuides/);
  });

  it('the output turns it on at launch — unless a measurement run — and says so in the log', () => {
    const out = read('src/output/main.ts');
    const at = out.indexOf("if (config.measureLabel === '') {");
    expect(at).toBeGreaterThan(0);
    const block = out.slice(at, at + 300);
    expect(block).toContain('host.setWallGrid(true)');
    expect(block).toMatch(/\[grid\] ON at launch/);
  });

  it('drawFaceGuides: a plain container gets one masked child per face', () => {
    const root = new Container();
    drawFaceGuides(root, room(quad('a'), quad('b', 0.5, 0.5)), W, H);
    expect(root.children.length).toBe(2);
    drawFaceGuides(root, room(quad('a')), W, H);
    expect(root.children.length).toBe(1);
  });
});

describe('W1 note 2 — the fill is made where it is picked, and a download can make it', () => {
  it('addAssetFill: a layer bound to the role, showing the asset from the start', () => {
    const scene = addAssetFill(createScene({ id: 's' }), 'panel', 'archive.x.clip', 'clip');
    const l = scene.layers[0]!;
    expect(l.fillRole).toBe('panel');
    expect(l.providerId).toBe('bundled');
    expect(l.content['assetId']).toBe('archive.x.clip');
    expect(l.name).toBe('clip (panel)');
  });

  it('the drawer makes the fill when none exists; the fill panel offers to add one', () => {
    const drawer = read('src/editor/LibraryDrawer.tsx');
    expect(drawer).toMatch(/if \(!target\) \{[\s\S]*addAssetFill\(prev, DEFAULT_SURFACE_ROLE, asset\.id, asset\.name\)/);
    expect(drawer).not.toMatch(/disabled=\{fills\.length === 0\}/);
    const fill = read('src/editor/FillPanel.tsx');
    expect(fill).toMatch(/addWhiteFill\(prev, DEFAULT_SURFACE_ROLE\)/);
    expect(fill).not.toMatch(/White fill →/);
  });

  it('the button and the hint are gone from the editor; the core function stays for B3', () => {
    const app = read('src/editor/App.tsx');
    expect(app).not.toMatch(/White fill →/);
    expect(app).not.toMatch(/addWhiteFill\(/);
    expect(read('src/core/sceneEdit.ts')).toMatch(/export function addWhiteFill/);
  });
});

describe('W1 note 3 — the preview learns the downloaded clips', () => {
  it('the preview host registers the editor library before its first scene, and again on change', () => {
    const src = read('src/editor/PreviewCanvas.tsx');
    const reg = src.indexOf('h.registerAssets(downloadedEntries())');
    const scene = src.indexOf('h.setScene(sceneRef.current)');
    expect(reg).toBeGreaterThan(0);
    expect(reg).toBeLessThan(scene);
    expect(src).toMatch(/onLibraryChange\(\(\) => \{[\s\S]*registerAssets\(downloadedEntries\(\)\)[\s\S]*reapplyScene\(\)/);
    // Never the whole editor library: the bundled assets are not library:// entries.
    expect(src).not.toMatch(/editorLibrary\.all\(\)/);
  });
});


class PlainProvider implements ContentProvider {
  readonly id = 'plain';
  create(ctx: ProviderContext): LayerView {
    const view = new Container();
    view.addChild(new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: 0x808080 }));
    return { view, update: () => {}, resize: () => {}, destroy: () => {} };
  }
}
function fillScene(role: string) {
  return createScene({ id: 'f', layers: [createLayer({ id: 'fill-1', providerId: 'plain', content: {}, fillRole: role })] });
}
function guidedCompositor(surfaces: SurfaceTree): Compositor {
  const providers = new ProviderRegistry();
  providers.register(new PlainProvider());
  return new Compositor({ providers, width: W, height: H, surfaces });
}

describe('W1 follow-up — a per-face grid switch that hides itself once the face is filled', () => {
  it('the flag is optional, tolerant, and absent from a face that never touched it (R1 intact)', () => {
    const s = createSurface({ id: 'surface-1', path: quad('p1') });
    expect(Object.keys(s).sort()).toEqual(['id', 'name', 'path', 'role']);
    expect(canonicalizeSurface({ ...s, guide: true })?.guide).toBe(true);
    expect(canonicalizeSurface({ ...s, guide: false })?.guide).toBe(false);
    expect(canonicalizeSurface({ ...s, guide: 'yes' })).toEqual(s);
    expect(withSurfaceGuide([s], 'surface-1', true)[0]!.guide).toBe(true);
    expect(Object.keys(withSurfaceGuide(withSurfaceGuide([s], 'surface-1', true), 'surface-1', undefined)[0]!).sort()).toEqual(['id', 'name', 'path', 'role']);
  });

  it('the flag survives a drag — reconcile keeps the face and its switch', () => {
    const tree = withSurfaceGuide(room(quad('p1')), 'surface-1', true);
    const moved = reconcileSurfaces(tree, [quad('p1', 0.4, 0.2)]);
    expect(moved[0]!.guide).toBe(true);
  });

  it('auto: a bare face shows its grid; the moment a fill lands on it, the grid goes', () => {
    const c = guidedCompositor(room(quad('p1'), quad('p2', 0.5, 0.5)));
    c.setWallGrid(true);
    expect(guidesOf(c).map((g) => g.label)).toEqual(['guide:surface-1', 'guide:surface-2']);
    c.setScene(fillScene('panel'));
    // Both faces carry `panel`, both are filled, both grids gone.
    expect(guidesOf(c)).toEqual([]);
    c.setScene(fillScene('other'));
    // Nothing matches `other`: no fill lands, both grids back.
    expect(guidesOf(c).length).toBe(2);
    c.destroy();
  });

  it('a re-tag on the room side moves the grid with the fill, on the same write', () => {
    const tree = room(quad('p1'), quad('p2', 0.5, 0.5));
    const c = guidedCompositor(tree);
    c.setScene(fillScene('f1'));
    c.setWallGrid(true);
    expect(guidesOf(c).length).toBe(2);
    c.setSurfaces(tree.map((s) => (s.id === 'surface-1' ? { ...s, role: 'f1' } : s)));
    expect(guidesOf(c).map((g) => g.label)).toEqual(['guide:surface-2']);
    c.destroy();
  });

  it('the switch wins over auto, both ways', () => {
    const tree = room(quad('p1'), quad('p2', 0.5, 0.5));
    const c = guidedCompositor(tree);
    c.setScene(fillScene('panel'));
    c.setWallGrid(true);
    expect(guidesOf(c)).toEqual([]);
    c.setSurfaces(withSurfaceGuide(tree, 'surface-1', true));
    expect(guidesOf(c).map((g) => g.label)).toEqual(['guide:surface-1']);
    c.setScene(fillScene('other'));
    c.setSurfaces(withSurfaceGuide(tree, 'surface-2', false));
    expect(guidesOf(c).map((g) => g.label)).toEqual(['guide:surface-1']);
    c.destroy();
  });

  it('the panel row has the switch and it writes through the one room writer', () => {
    const src = read('src/editor/SurfacePanel.tsx');
    expect(src).toMatch(/checked=\{surface\.guide \?\? !lit\}/);
    expect(src).toMatch(/onSurfaces\(withSurfaceGuide\(surfaces, surface\.id, e\.currentTarget\.checked\)\)/);
  });
});

describe('W1 follow-up — a blank page at launch', () => {
  it('createBlankScene has no layers and no groups, and is a valid scene', () => {
    const b = createBlankScene();
    expect(b.layers).toEqual([]);
    expect(b.groups).toEqual([]);
    expect(b.id).toBe('blank');
  });

  it('the editor opens on it; the Phase-1 scene is still there for the debug buttons', () => {
    const app = read('src/editor/App.tsx');
    expect(app).toMatch(/useState<Scene>\(createBlankScene\)/);
    expect(app).toMatch(/setScene\(createDefaultScene\(\)\)/);
  });
});

describe('W1 follow-up — two grids, two controls, labelled and side by side', () => {
  it('the preview checkbox says preview; the projector control sits beside it and sends g', () => {
    const src = read('src/editor/PreviewCanvas.tsx');
    const box = src.indexOf('preview grid');
    const btn = src.indexOf('projector grid ⇄');
    expect(box).toBeGreaterThan(0);
    expect(btn).toBeGreaterThan(box);
    expect(btn - box).toBeLessThan(700);
    expect(src.slice(box, btn + 100)).toMatch(/sendOutputKey\(\{ key: shortcutFor\('wallGrid'\)\.key \}\)/);
    // The preview's grid still never reaches the output: the import-graph test
    // covers the mechanism; this covers the words.
    expect(src).not.toMatch(/setWallGrid\(/);
  });
});
