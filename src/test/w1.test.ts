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
import { createSurface, reconcileSurfaces, type SurfaceTree } from '../core/surfaces';
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
    expect(body.indexOf('this.faceGuides.visible = on')).toBeLessThan(body.indexOf('drawFaceGuides('));
    expect(src).toMatch(/if \(this\.faceGuides\.visible\) drawFaceGuides\(this\.faceGuides, tree/);
    expect(src).toMatch(/if \(this\.faceGuides\.visible\) drawFaceGuides\(this\.faceGuides, this\.surfaces/);
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
