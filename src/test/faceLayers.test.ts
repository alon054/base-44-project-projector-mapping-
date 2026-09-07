/**
 * A face is a layer — `editor/faceLayers.ts`. The room half and the scene
 * half, and the launch race the prune must not lose.
 */
import { describe, expect, it } from 'vitest';
import { createScene } from '../core/scene';
import { addWhiteFill } from '../core/sceneEdit';
import { DEFAULT_SURFACE_ROLE, emptySurface, type SurfaceTree } from '../core/surfaces';
import { faceOfLayer, syncFaceLayers, withFaceRoles } from '../editor/faceLayers';

const room = (): SurfaceTree => [emptySurface('surface-1', 'left'), emptySurface('surface-2', 'right')];

describe('the room half', () => {
  it('a default-role face goes onto its own token; a typed role is left alone; identity when nothing changes', () => {
    const typed = room().map((s) => (s.id === 'surface-2' ? { ...s, role: 'panel f1' } : s));
    const next = withFaceRoles(typed);
    expect(next.map((s) => s.role)).toEqual(['surface-1', 'panel f1']);
    expect(withFaceRoles(next)).toBe(next);
    expect(withFaceRoles([{ ...typed[0]!, role: '  ' }])[0]!.role).toBe('surface-1');
  });
});

describe('the scene half', () => {
  it('every own-token face gets one white layer named after it; a second sync adds nothing', () => {
    const r = withFaceRoles(room());
    const s = syncFaceLayers(createScene({ id: 's' }), r, true);
    expect(s.layers.map((l) => [l.fillRole, l.name])).toEqual([
      ['surface-1', 'left — own fill'],
      ['surface-2', 'right — own fill'],
    ]);
    expect(syncFaceLayers(s, r, true)).toBe(s);
  });

  it('a face still on the shared role gets no row of its own', () => {
    const s = syncFaceLayers(createScene({ id: 's' }), room(), true);
    expect(s.layers).toEqual([]);
  });

  it('a layer whose face is gone leaves — but only once the room is known (the launch race)', () => {
    const r = withFaceRoles(room());
    const s = syncFaceLayers(createScene({ id: 's' }), r, true);
    const smaller = r.filter((x) => x.id !== 'surface-2');
    expect(syncFaceLayers(s, smaller, false)).toBe(s);
    expect(syncFaceLayers(s, [], false)).toBe(s);
    expect(syncFaceLayers(s, smaller, true).layers.map((l) => l.fillRole)).toEqual(['surface-1']);
  });

  it('a layer on the shared role, or on a typed role, is never pruned', () => {
    let s = addWhiteFill(createScene({ id: 's' }), DEFAULT_SURFACE_ROLE);
    s = addWhiteFill(s, 'f1');
    expect(syncFaceLayers(s, [], true)).toBe(s);
  });

  it('faceOfLayer names the face for a face row and nothing for any other layer', () => {
    const r = withFaceRoles(room());
    const s = syncFaceLayers(addWhiteFill(createScene({ id: 's' }), DEFAULT_SURFACE_ROLE), r, true);
    expect(faceOfLayer(s.layers[1]!, r)?.name).toBe('left');
    expect(faceOfLayer(s.layers[0]!, r)).toBeUndefined();
    // A face token on a face that was re-tagged by hand is not a row either.
    const retagged = r.map((x) => (x.id === 'surface-1' ? { ...x, role: 'panel' } : x));
    expect(faceOfLayer(s.layers[1]!, retagged)).toBeUndefined();
  });
});
