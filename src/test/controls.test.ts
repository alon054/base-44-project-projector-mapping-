/**
 * The control panel's logic, and the three claims its structure rests on (P5-F).
 *
 * The claims are checkable at the source level and are checked that way, which
 * is `ipc.test.ts`'s precedent from P5-E: a rule that lives only in a comment
 * is a rule until someone in a hurry edits the file beside it.
 *
 *  1. `<ParamControl>` is the ONLY thing in the editor that writes a parameter.
 *  2. `EntityPanel` never names a key — every control it draws comes from the
 *     registry's own enumeration.
 *  3. The panel's UI state has no field in common with a scene, and nothing
 *     copies one into the other.
 *
 * Pure logic and file reads. No DOM (SPEC.md §8.1).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLayer } from '../core/layer';
import { createScene, serializeScene, type Scene } from '../core/scene';
import { addLayer } from '../core/sceneEdit';
import { MAX_CONCURRENT_VIDEO, capBreachMessage, sceneCapBreaches } from '../core/library';
import { BUNDLED_PROVIDER_ID } from '../providers/bundled/id';
import { PROCEDURAL_KINDS } from '../providers/procedural/ProceduralProvider';
import {
  applyContentChoice,
  capWarnings,
  contentChoices,
  createPanelUi,
  currentChoiceId,
  selectedLayerId,
  toggleSection,
  type ContentChoice,
} from '../editor/controls';

const EDITOR = new URL('../editor/', import.meta.url).pathname;
const source = (file: string): string => readFileSync(join(EDITOR, file), 'utf8');

/**
 * Source with comments removed, for the checks below.
 *
 * `motion.test.ts` set this precedent in P5-C: a grep that counts the prose
 * describing a rule as a violation of it is a test that fails for saying so.
 * Two files below explain `registry.write` in their headers and neither calls
 * it.
 */
const code = (file: string): string =>
  source(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const panels = (): string[] =>
  readdirSync(EDITOR).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));

const scene = (): Scene =>
  createScene({
    id: 'panel',
    layers: [
      createLayer({ id: 'sea', providerId: 'procedural', content: { kind: 'water', tint: 0x2040d0 } }),
      createLayer({ id: 'lamp', providerId: 'procedural', content: { kind: 'glow' }, zOrder: 1 }),
    ],
  });

const ASSETS = [
  { id: 'kenney-flame', name: 'Flame', kind: 'still' as const },
  { id: 'loop-seamless', name: 'Seamless loop', kind: 'video' as const },
  { id: 'clock-rings', name: 'Clock rings', kind: 'lottie' as const },
];

describe('the content picker — a structural edit, not a parameter write', () => {
  it('offers every procedural kind and every bundled asset, with unique ids', () => {
    const choices = contentChoices(ASSETS);
    expect(choices).toHaveLength(PROCEDURAL_KINDS.length + ASSETS.length);
    expect(new Set(choices.map((c) => c.id)).size).toBe(choices.length);
    expect(choices.filter((c) => c.providerId === BUNDLED_PROVIDER_ID)).toHaveLength(ASSETS.length);
  });

  it('names only structural content — a choice never carries a parameter value', () => {
    // `kind` and `assetId` are the two providers' `STRUCTURAL_CONTENT_KEYS`. A
    // choice carrying `tint` or `bands` would be the picker writing a
    // parameter, which is exactly the confusion this file's header is about.
    for (const c of contentChoices(ASSETS)) {
      expect(Object.keys(c.content)).toEqual([c.providerId === BUNDLED_PROVIDER_ID ? 'assetId' : 'kind']);
    }
  });

  it('reports which choice a layer currently is, and null for content it does not describe', () => {
    const choices = contentChoices(ASSETS);
    const s = scene();
    expect(currentChoiceId(s, 'sea', choices)).toBe('procedural:water');
    const handAuthored: Scene = {
      ...s,
      layers: s.layers.map((l) => (l.id === 'sea' ? { ...l, providerId: 'catalog' } : l)),
    };
    expect(currentChoiceId(handAuthored, 'sea', choices)).toBeNull();
  });

  it('replaces the content and keeps the tint, the id and the transform', () => {
    const choices = contentChoices(ASSETS);
    const glow = choices.find((c) => c.id === 'procedural:glow')!;
    const before = scene();
    const after = applyContentChoice(before, 'sea', glow);
    const layer = after.layers.find((l) => l.id === 'sea')!;
    expect(layer.content).toEqual({ kind: 'glow', tint: 0x2040d0 });
    expect(layer.transform).toEqual(before.layers[0]!.transform);
    expect(layer.zOrder).toBe(before.layers[0]!.zOrder);
    // `bands` belonged to a thing that is no longer there.
    expect(layer.content['bands']).toBeUndefined();
  });

  it('switches provider as well as content', () => {
    const choices = contentChoices(ASSETS);
    const video = choices.find((c) => c.id === `${BUNDLED_PROVIDER_ID}:loop-seamless`)!;
    const after = applyContentChoice(scene(), 'lamp', video);
    const layer = after.layers.find((l) => l.id === 'lamp')!;
    expect(layer.providerId).toBe(BUNDLED_PROVIDER_ID);
    expect(layer.content['assetId']).toBe('loop-seamless');
  });

  it('refuses a layer that is not in the scene rather than silently doing nothing', () => {
    const choices = contentChoices(ASSETS);
    expect(() => applyContentChoice(scene(), 'ghost', choices[0] as ContentChoice)).toThrow(
      /no layer "ghost"/,
    );
  });
});

describe('the caps warning — §10 row 2, WARN and never refuse', () => {
  const library = {
    get: (id: string) => ASSETS.find((a) => a.id === id),
  };

  const withVideos = (n: number): Scene => {
    let s = createScene({ id: 'caps' });
    for (let i = 0; i < n; i++) {
      s = addLayer(s, {
        idPrefix: 'clip',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'loop-seamless' },
      });
    }
    return s;
  };

  it('says nothing at the cap', () => {
    expect(capWarnings(withVideos(MAX_CONCURRENT_VIDEO), library)).toEqual([]);
  });

  it('warns over the cap, naming the count and the cap', () => {
    const warnings = capWarnings(withVideos(MAX_CONCURRENT_VIDEO + 2), library);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.breach).toEqual({
      kind: 'video',
      count: MAX_CONCURRENT_VIDEO + 2,
      cap: MAX_CONCURRENT_VIDEO,
    });
    expect(warnings[0]!.text).toContain(String(MAX_CONCURRENT_VIDEO + 2));
    expect(warnings[0]!.text).toContain('the session continues');
  });

  it('does not refuse: every layer over the cap is still in the scene', () => {
    // The half of "WARN, never refuse" that a message cannot state. Phase 3
    // measured the cost of x6 as 15 late frames in 3555 and one 150 ms hitch —
    // a stumble, not a failure — and this is performance equipment (I-13).
    const s = withVideos(MAX_CONCURRENT_VIDEO + 2);
    expect(s.layers).toHaveLength(MAX_CONCURRENT_VIDEO + 2);
    expect(() => capWarnings(s, library)).not.toThrow();
  });

  it('counts only what a cap covers — a scene of stills never warns', () => {
    let s = createScene({ id: 'stills' });
    for (let i = 0; i < 20; i++) {
      s = addLayer(s, {
        idPrefix: 'puff',
        providerId: BUNDLED_PROVIDER_ID,
        content: { assetId: 'kenney-flame' },
      });
    }
    expect(capWarnings(s, library)).toEqual([]);
  });

  it('is the same sentence the output window logs — one wording, two readers', () => {
    const s = withVideos(MAX_CONCURRENT_VIDEO + 1);
    const fromOutput = sceneCapBreaches(s.layers, library).map(capBreachMessage);
    expect(capWarnings(s, library).map((w) => w.text)).toEqual(fromOutput);
  });
});

describe('panel UI state stays out of the scene file', () => {
  it('shares no field name with a scene or a layer', () => {
    const ui = createPanelUi();
    const s = scene();
    const sceneFields = new Set([...Object.keys(s), ...Object.keys(s.layers[0]!)]);
    for (const key of Object.keys(ui)) expect(sceneFields.has(key)).toBe(false);
  });

  it('a serialized scene contains none of its field names, after a full session', () => {
    // The UI state is set to everything it can be, and the scene is then
    // serialized as it would be saved. Field NAMES, not values: a section id
    // happens to be the word `susceptibility`, which is also a legitimate
    // scene field, and testing values would confuse the two.
    const ui = toggleSection({ ...createPanelUi(), selectedLayerId: 'sea' }, 'susceptibility');
    const json = serializeScene(scene());
    for (const key of Object.keys(ui)) expect(json).not.toContain(`"${key}"`);
  });

  it('toggles a section open and shut without touching anything else', () => {
    const ui = createPanelUi();
    const shut = toggleSection(ui, 'motion');
    expect(shut.openSections).not.toContain('motion');
    expect(toggleSection(shut, 'motion').openSections).toContain('motion');
    expect(shut.selectedLayerId).toBe(ui.selectedLayerId);
  });

  it('corrects a selection that points at a deleted layer', () => {
    const s = scene();
    expect(selectedLayerId({ ...createPanelUi(), selectedLayerId: 'sea' }, s)).toBe('sea');
    expect(selectedLayerId({ ...createPanelUi(), selectedLayerId: 'ghost' }, s)).toBe('lamp');
    expect(
      selectedLayerId({ ...createPanelUi(), selectedLayerId: 'sea' }, createScene({ id: 'empty' })),
    ).toBeNull();
  });
});

describe('the mechanism: a control that writes outside the registry cannot be written', () => {
  it('ParamControl is the only editor file that writes a parameter', () => {
    // Not "the panels are careful". The panels have no way to write one: they
    // render `<ParamControl paramKey={key}>`, and that component takes a key
    // and reaches the value only through `registry.write`. `ForcePanel` is the
    // Phase 4 original and is listed because it is the same shape — its
    // `ParamSlider` is a private copy of the same idea, from before there was a
    // shared one, and it is not refactored here (a passed phase).
    const writers = panels().filter((f) => code(f).includes('registry.write('));
    expect(writers.sort()).toEqual(['ForcePanel.tsx', 'ParamControl.tsx']);
  });

  it('EntityPanel names no parameter key — every control comes from the enumeration', () => {
    const src = source('EntityPanel.tsx');
    const passed = [...src.matchAll(/paramKey=\{([^}]*)\}/g)].map((m) => m[1]);
    expect(passed.length).toBeGreaterThan(0);
    // Every one of them is the loop variable over the registry's own keys. A
    // literal here would be a control that survives its key being renamed.
    expect([...new Set(passed)]).toEqual(['key']);
  });

  it('the layer list draws its four parameters from the enumeration too', () => {
    const src = source('LayerPanel.tsx');
    expect(src).toContain('entityParamGroups(registry, layer.id).layer');
    const passed = [...src.matchAll(/paramKey=\{([^}]*)\}/g)].map((m) => m[1]);
    expect([...new Set(passed)]).toEqual(['key']);
  });

  it('no panel mutates a layer parameter through setScene', () => {
    // The other direction of the same rule: a panel reaching into scene state
    // to set `opacity` would work, would look ordinary, and would leave the
    // registry describing a value nothing writes through it.
    //
    // A `setScene` call is legitimate when it is one of the sanctioned
    // STRUCTURAL edits — those decide which layers exist and what each one is,
    // they are `core/sceneEdit.ts`'s and `controls.ts`'s, and they are tested
    // there. `addLayer` naming a new glow's blend mode is creation, not
    // modulation, and this is the line between the two.
    const STRUCTURAL = /\b(addLayer|removeLayer|moveLayer|reorderLayer|applyContentChoice)\(/;
    const PARAM_FIELDS = /\b(opacity|blendMode|depth|visible|susceptibility|motion)\s*:/;
    let checked = 0;
    for (const file of panels().filter((f) => f.endsWith('Panel.tsx'))) {
      for (const call of code(file).matchAll(/setScene\(([\s\S]{0,400}?)\n\s*\);/g)) {
        const body = call[1] ?? '';
        checked++;
        if (STRUCTURAL.test(body)) continue;
        expect(PARAM_FIELDS.test(body), `${file}: ${body.slice(0, 90)}`).toBe(false);
      }
    }
    // A regex that matched nothing would pass this test in silence, which is
    // the "a test that cannot fail is not a test" rule.
    expect(checked).toBeGreaterThan(0);
  });
});
