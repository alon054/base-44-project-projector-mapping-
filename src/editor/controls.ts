/**
 * The control panel's logic, with no React in it (P5-F).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE DISTINCTION THIS FILE EXISTS TO KEEP.
 *
 * A control is either a **parameter** or a **structural edit**, and the two go
 * to different places:
 *
 *  - A parameter modulates a layer that already exists — opacity, depth, tint,
 *    a susceptibility, a motion field. It is addressable under a hierarchical
 *    key (I-8) and the panel writes it with `registry.write(key, value)` and no
 *    other way. The panel does not know the key names; it asks the registry
 *    which keys a layer has and renders a control per key, so a control that
 *    writes nowhere is not a bug that can be introduced — there is nothing to
 *    render it from.
 *
 *  - A structural edit changes WHICH layers exist, in what order, and what each
 *    one IS: add, remove, reorder, and the provider/content picker. `kind` and
 *    `assetId` are `STRUCTURAL_CONTENT_KEYS` in both providers precisely
 *    because changing one does not modulate the layer, it replaces it — that is
 *    an edit to the scene, not a knob to map a fader to. These go through
 *    `core/sceneEdit.ts` and the one function below.
 *
 * Both halves end in scene state (I-12). Neither ends anywhere else, which is
 * the other thing this file is for: the panel's own UI state — which layer is
 * selected, which sections are open — is `PanelUi` here and never a scene
 * field, so it cannot reach a saved file.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { JsonObject } from '../core/layer';
import type { ParameterRegistry } from '../core/parameters';
import type { Scene } from '../core/scene';
import {
  capBreachMessage,
  sceneCapBreaches,
  type AssetKind,
  type CapBreach,
} from '../core/library';
import { PROCEDURAL_KINDS, PROCEDURAL_PROVIDER_ID } from '../providers/procedural/ProceduralProvider';
import { BUNDLED_PROVIDER_ID } from '../providers/bundled/id';

/* ────────────────────────── panel UI state ────────────────────────── */

/**
 * What the panel remembers about itself. **Never scene state** — the checklist
 * bullet is "panel UI state does not enter the scene file", and the way to hold
 * that is for the two shapes to have no field in common and no function that
 * copies one into the other. There is no `toScene` here and there must not be.
 *
 * It is a declared type rather than four `useState` calls scattered through the
 * panels so that the statement above is checkable by a test, which is what
 * `controls.test.ts` does with it.
 */
export interface PanelUi {
  /** Which layer's parameters are showing. `null` is "none picked yet". */
  selectedLayerId: string | null;
  /** Collapsible sections currently open, by section id. */
  openSections: readonly string[];
}

export function createPanelUi(): PanelUi {
  return { selectedLayerId: null, openSections: ['params', 'motion'] };
}

export function toggleSection(ui: PanelUi, section: string): PanelUi {
  return {
    ...ui,
    openSections: ui.openSections.includes(section)
      ? ui.openSections.filter((s) => s !== section)
      : [...ui.openSections, section],
  };
}

/**
 * The selection, corrected against the scene.
 *
 * A layer can be deleted while it is selected, and a panel holding a dead id
 * would render controls for keys the registry has already given back —
 * `registry.definition` returns `undefined`, every control disappears, and the
 * operator is looking at an empty panel with a layer name at the top of it.
 * Resolving the selection through the scene on every render makes that state
 * unreachable rather than merely unlikely.
 */
export function selectedLayerId(ui: PanelUi, scene: Scene): string | null {
  if (ui.selectedLayerId !== null && scene.layers.some((l) => l.id === ui.selectedLayerId)) {
    return ui.selectedLayerId;
  }
  return scene.layers.length > 0 ? (scene.layers[scene.layers.length - 1]?.id ?? null) : null;
}

/* ────────────────────── parameters, by group ────────────────────── */

/**
 * A layer's registered keys, split into the four groups the panel draws.
 *
 * Enumerated FROM THE REGISTRY, never from a list of names kept here. That is
 * the mechanism behind "every control writes through `registry.write`": a
 * control exists because a key does, so there is no way to draw one that is not
 * backed by a key, and a key that is registered but misnamed shows up as a
 * control in the wrong group rather than as a silent no-op.
 *
 * The split is by key SHAPE and not by a table of which suffix goes where:
 * three segments is a layer-level or content parameter, four is a family, and
 * the family name is the third segment. That is I-8's own structure, so a fifth
 * family added later files itself.
 */
export interface EntityParamGroups {
  /** `entity.<id>.opacity` and the rest of `defineLayerParameters`. */
  layer: string[];
  /** Whatever the provider declared (rule 9). */
  content: string[];
  /** `entity.<id>.motion.*` — the four I-18 fields. */
  motion: string[];
  /** `entity.<id>.susceptibility.<forceId>` (I-4). */
  susceptibility: string[];
}

/** What `defineLayerParameters` registers. Content is everything else flat. */
const LAYER_LEVEL = new Set(['opacity', 'depth', 'visible', 'blendMode']);

/**
 * A layer's registered CONTENT keys, by suffix — what the provider declared
 * (rule 9), with the layer-level keys and the two four-segment families
 * removed.
 *
 * Exported because `syncEntityParameters` asks exactly this question to decide
 * whether a layer's registrations are still the right ones after the picker
 * changed what it draws. One definition of "which suffixes are content",
 * shared, rather than two that agree until one of them is edited.
 */
export function contentKeysOf(registry: ParameterRegistry, layerId: string): string[] {
  const prefix = `entity.${layerId}.`;
  return entityParamGroups(registry, layerId).content.map((k) => k.slice(prefix.length));
}

export function entityParamGroups(registry: ParameterRegistry, layerId: string): EntityParamGroups {
  const prefix = `entity.${layerId}.`;
  const groups: EntityParamGroups = { layer: [], content: [], motion: [], susceptibility: [] };
  for (const key of registry.keys(`entity.${layerId}`)) {
    const suffix = key.slice(prefix.length);
    const dot = suffix.indexOf('.');
    if (dot < 0) {
      (LAYER_LEVEL.has(suffix) ? groups.layer : groups.content).push(key);
      continue;
    }
    const family = suffix.slice(0, dot);
    if (family === 'motion') groups.motion.push(key);
    else if (family === 'susceptibility') groups.susceptibility.push(key);
    // A family this build does not draw is not an error and is not invented
    // into a group: it stays addressable, and the panel simply has no row for
    // it until someone writes one. Refusing here would make adding a family a
    // two-file change for no gain.
  }
  return groups;
}

/* ───────────────────── the provider / content picker ───────────────────── */

/**
 * One entry in the per-region picker: a provider plus the structural content
 * that names what to draw.
 *
 * A plain dropdown this block, by the checklist — the library browser with
 * thumbnails, filters and licence display is P8-B. What must be right NOW is
 * that picking an entry is a structural edit and not a parameter write, because
 * getting that backwards is what would leave `assetId` addressable as a knob.
 */
export interface ContentChoice {
  /** Stable, and unique across providers — it is the `<option>` value. */
  id: string;
  providerId: string;
  /** Operator-facing. */
  label: string;
  /** The group the picker files it under. */
  group: string;
  /** The structural content this choice sets. Merged over nothing. */
  content: JsonObject;
}

/** The little a choice list needs to know about an asset. */
export interface PickableAsset {
  id: string;
  name: string;
  kind: AssetKind;
}

/**
 * Every choice the picker offers, procedural kinds first, then bundled assets.
 *
 * Assets are passed in rather than imported: `manifest.ts` reaches the bundler's
 * `?url` imports and `BundledProvider` reaches `lottie-web`, and SPEC.md §8.1
 * wants this file testable with no DOM. The editor hands it
 * `library.all()`; a test hands it three rows.
 */
export function contentChoices(assets: readonly PickableAsset[]): ContentChoice[] {
  const procedural: ContentChoice[] = PROCEDURAL_KINDS.map((kind) => ({
    id: `${PROCEDURAL_PROVIDER_ID}:${kind}`,
    providerId: PROCEDURAL_PROVIDER_ID,
    label: kind,
    group: 'Procedural',
    content: { kind },
  }));
  const bundled: ContentChoice[] = [...assets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((asset) => ({
      id: `${BUNDLED_PROVIDER_ID}:${asset.id}`,
      providerId: BUNDLED_PROVIDER_ID,
      label: `${asset.name} (${asset.kind})`,
      group: 'Bundled library',
      content: { assetId: asset.id },
    }));
  return [...procedural, ...bundled];
}

/** Which choice a layer currently is, or `null` for content no choice describes. */
export function currentChoiceId(
  scene: Scene,
  layerId: string,
  choices: readonly ContentChoice[],
): string | null {
  const layer = scene.layers.find((l) => l.id === layerId);
  if (!layer) return null;
  const match = choices.find(
    (c) =>
      c.providerId === layer.providerId &&
      Object.entries(c.content).every(([k, v]) => layer.content[k] === v),
  );
  return match?.id ?? null;
}

/**
 * Point a layer at different content. A structural edit — see the file header.
 *
 * **The old content does not survive, except its tint.** Changing kind replaces
 * the layer rather than modulating it, and the old kind's values are values of
 * a thing that is no longer there: `bands` on a layer that is now a glow means
 * nothing, and carrying it forward would leave an unregistered key sitting in
 * scene state, addressable by nobody, until someone switched back. Tint is the
 * exception because every procedural kind declares it and an operator who set a
 * layer red and then changed its kind did not ask for it to go white.
 *
 * Unknown layer id is refused rather than ignored: a picker firing at a layer
 * that is not there is a bug in the panel, and a silent no-op is how it would
 * survive to the wall.
 */
export function applyContentChoice(scene: Scene, layerId: string, choice: ContentChoice): Scene {
  const layer = scene.layers.find((l) => l.id === layerId);
  if (!layer) {
    throw new Error(`applyContentChoice: no layer "${layerId}" in scene "${scene.id}"`);
  }
  const tint = layer.content['tint'];
  const content: JsonObject = {
    ...choice.content,
    ...(typeof tint === 'number' ? { tint } : {}),
  };
  return {
    ...scene,
    layers: scene.layers.map((l) =>
      l.id === layerId ? { ...l, providerId: choice.providerId, content } : l,
    ),
  };
}

/* ─────────────────────────── the caps warning ─────────────────────────── */

/**
 * §10 row 2, in front of the operator. **WARN, never refuse.**
 *
 * Phase 3 measured the failure and made the call: six concurrent videos cost 15
 * late frames in 3555 and one 150 ms hitch — a visible stumble, not a failure,
 * with nothing crashing and every decoder reaching `playing`. This is
 * performance equipment (I-13), and refusing an operator mid-show over a
 * stumble that can be flagged instead is the wrong trade. So this function
 * returns sentences, and there is deliberately no sibling that returns a
 * boolean for something to disable a button with.
 *
 * The sentence itself is `capBreachMessage`, which the output window's `[caps]`
 * log line also uses — one wording, so what the operator reads and what the run
 * log records cannot come to disagree.
 */
export function capWarnings(
  scene: Scene,
  library: { get(id: string): { kind: AssetKind } | undefined },
): { breach: CapBreach; text: string }[] {
  return sceneCapBreaches(scene.layers, library).map((breach) => ({
    breach,
    text: capBreachMessage(breach),
  }));
}
