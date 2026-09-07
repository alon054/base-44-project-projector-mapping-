/**
 * A face with its own animation — `editor/ownFill.ts`. Operator, 2026-09-07:
 * "pick to each layer the animation and that it wouldn't change all of them
 * together." Two pure halves, one per tree; the room half never sees the
 * scene and the scene half never sees the room (I-15).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScene } from '../core/scene';
import { addWhiteFill } from '../core/sceneEdit';
import { DEFAULT_SURFACE_ROLE, emptySurface, type SurfaceTree } from '../core/surfaces';
import { resolveRole } from '../core/roles';
import {
  ensureOwnFillLayer,
  hasOwnFill,
  ownFillRole,
  withOwnFillRole,
  withSharedFillRole,
  withoutOwnFillLayers,
} from '../editor/ownFill';

const room = (): SurfaceTree => [emptySurface('surface-1', 'left box'), emptySurface('surface-2', 'right box')];
const scene = () => addWhiteFill(createScene({ id: 's' }), DEFAULT_SURFACE_ROLE);

describe('the room half', () => {
  it('"own" re-tags one face with its own id and touches no other', () => {
    const next = withOwnFillRole(room(), 'surface-2');
    expect(next.map((s) => s.role)).toEqual([DEFAULT_SURFACE_ROLE, 'surface-2']);
    expect(hasOwnFill(next[1]!)).toBe(true);
    expect(hasOwnFill(next[0]!)).toBe(false);
  });

  it('the own token resolves to exactly that face, and the shared role no longer reaches it', () => {
    const next = withOwnFillRole(room(), 'surface-2');
    expect(resolveRole('surface-2', next).surfaces.map((s) => s.id)).toEqual(['surface-2']);
    expect(resolveRole(DEFAULT_SURFACE_ROLE, next).surfaces.map((s) => s.id)).toEqual(['surface-1']);
  });

  it('"own" replaces the role rather than adding to it — the face is not lit twice', () => {
    const tagged = room().map((s) => (s.id === 'surface-1' ? { ...s, role: 'panel f1' } : s));
    const next = withOwnFillRole(tagged, 'surface-1');
    expect(next[0]!.role).toBe('surface-1');
  });

  it('"share" puts the face back on the default role', () => {
    const own = withOwnFillRole(room(), 'surface-1');
    expect(withSharedFillRole(own, 'surface-1')[0]!.role).toBe(DEFAULT_SURFACE_ROLE);
  });

  it('both are identity when nothing would change, and for an unknown face', () => {
    const r = room();
    expect(withSharedFillRole(r, 'surface-1')).toBe(r);
    expect(withOwnFillRole(r, 'surface-9')).toBe(r);
    const own = withOwnFillRole(r, 'surface-1');
    expect(withOwnFillRole(own, 'surface-1')).toBe(own);
  });
});

describe('the scene half', () => {
  it('"own" adds one white fill bound to the face token, named after the face; the shared fill stays', () => {
    const s = ensureOwnFillLayer(scene(), { id: 'surface-2', name: 'right box' });
    expect(s.layers.map((l) => l.fillRole)).toEqual([DEFAULT_SURFACE_ROLE, 'surface-2']);
    const own = s.layers[1]!;
    expect(own.name).toBe('right box — own fill');
    expect(own.providerId).toBe('procedural');
    expect(own.content).toMatchObject({ kind: 'rect', tint: 0xffffff });
  });

  it('a second press stacks nothing', () => {
    const once = ensureOwnFillLayer(scene(), { id: 'surface-2', name: 'right box' });
    expect(ensureOwnFillLayer(once, { id: 'surface-2', name: 'renamed' })).toBe(once);
  });

  it('"share" removes every layer bound to the token and only those', () => {
    const s = ensureOwnFillLayer(scene(), { id: 'surface-2', name: 'right box' });
    const back = withoutOwnFillLayers(s, { id: 'surface-2' });
    expect(back.layers.map((l) => l.fillRole)).toEqual([DEFAULT_SURFACE_ROLE]);
    expect(withoutOwnFillLayers(back, { id: 'surface-2' })).toBe(back);
  });

  it('the token is the id, whatever the face is called (a name may hold spaces; a role token may not)', () => {
    expect(ownFillRole({ id: 'surface-7' })).toBe('surface-7');
    expect(ownFillRole({ id: 'surface-7' })).not.toMatch(/\s/);
  });
});

describe('where it lives (I-15)', () => {
  const SRC = join(import.meta.dirname, '..');
  const importsOf = (file: string): string[] =>
    [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

  it('ownFill.ts is editor-side and imports no renderer — the two trees meet there and nowhere in core/', () => {
    const imports = importsOf(join(SRC, 'editor', 'ownFill.ts'));
    expect(imports.filter((i) => /(^|\/)render\//.test(i) || i.startsWith('pixi'))).toEqual([]);
    expect(imports.some((i) => /core\/surfaces$/.test(i))).toBe(true);
    expect(imports.some((i) => /core\/sceneEdit$/.test(i))).toBe(true);
  });

  it('the Room panel offers the button and App applies each half down its own path', () => {
    const panel = readFileSync(join(SRC, 'editor', 'SurfacePanel.tsx'), 'utf8');
    expect(panel).toMatch(/onOwnFill\(surface\.id\)/);
    expect(panel).toMatch(/onShareFill\(surface\.id\)/);
    const app = readFileSync(join(SRC, 'editor', 'App.tsx'), 'utf8');
    expect(app).toMatch(/applySurfaces\(withOwnFillRole\(/);
    expect(app).toMatch(/setScene\(\(prev\) => ensureOwnFillLayer\(prev, face\)\)/);
  });
});
