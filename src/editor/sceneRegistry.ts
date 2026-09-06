/**
 * Binding the I-8 registry to a scene — the part with no React in it.
 *
 * This was the body of `useSceneRegistry`'s two effects and it moved here for
 * one reason: P5-F's gate condition is "a scene edited only through the panel
 * round-trips deep-equal", and a claim about what the panel's writes do to a
 * scene cannot be checked while the only path to those writes is a hook that
 * needs a renderer. `useSceneRegistry` is now the React shell around these two
 * functions and holds the refs; the functions themselves take a getter and a
 * setter and know nothing about where the scene is kept.
 *
 * **Providers are injected, not imported.** `BundledProvider` reaches
 * `lottie-web`, which calls `document.createElement` at module scope, and
 * SPEC.md §8.1 says the unit suite is pure logic with no DOM — the lesson
 * `providers/bundled/id.ts` was split out for. So this file asks for a function
 * that answers "which content keys does this layer expose", and the editor
 * hands it one backed by the real provider registry.
 */
import { applyLayerPatch, type Layer, type LayerPatch } from '../core/layer';
import {
  ParameterRegistry,
  defineChildParameters,
  defineContentParameters,
  defineGroupParameters,
  defineForceParameters,
  defineLayerParameters,
  defineMotionParameters,
  defineParallaxParameters,
  defineSusceptibilityParameters,
} from '../core/parameters';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import { DEFAULT_ROUTE_MOTION, createRouteMotion, type RouteMotion } from '../core/motion';
import type { ContentParamSpec } from '../providers/ContentProvider';
// One definition of "which suffixes are content", shared with the panel that
// draws them. Two copies of that fact would be the pair of counters CLAUDE.md's
// "a fix to one counter is not a fix to the counter beside it" is about.
import { contentKeysOf } from './controls';
import type { Scene } from '../core/scene';
import { setChildDuration, setGroupMode } from '../core/sceneEdit';
import type { Group, GroupChild } from '../core/groups';

/** What the caller must be able to do to the scene. Nothing more. */
export type ReadScene = () => Scene;
export type UpdateScene = (update: (prev: Scene) => Scene) => void;

/** Injected — see this file's header for why it is not an import. */
export type ContentSpecsFor = (layer: Layer) => readonly ContentParamSpec[];

/**
 * The scene-wide keys: `force.*` (I-4, I-14) and `parallax.*` (D3).
 *
 * Registered once and never per layer, because forces are global and do not
 * come and go with entities. Idempotent, because React runs effects twice in
 * StrictMode and the registry throws on a duplicate key by design (I-8).
 */
export function registerGlobalParameters(
  registry: ParameterRegistry,
  read: ReadScene,
  setScene: UpdateScene,
): void {
  if (registry.keys('force').length > 0) return;
  registry.registerAll(
    defineForceParameters(
      FORCE_DEFINITIONS,
      () => read().forces,
      (forceId, key, value) => {
        setScene((prev) => ({
          ...prev,
          forces: { ...prev.forces, [forceId]: { ...prev.forces[forceId], [key]: value } },
        }));
      },
    ),
  );
  registry.registerAll(
    defineParallaxParameters(
      () => read().parallax,
      (parallax) => setScene((prev) => ({ ...prev, parallax })),
    ),
  );
}

/**
 * A string that changes when, and only when, a layer's KEY SET might have.
 *
 * This is the React effect's dependency and nothing else — the rebuild decision
 * itself is made from the registry, below. Keyed on more than the layer id,
 * which is what it was before P5-F: the control panel can now change a layer's
 * provider and its structural content key (`kind`, `assetId`) from a dropdown,
 * and both change which content parameters exist — a `water` layer exposes
 * `bands` and a `glow` layer does not. On the id alone the effect never re-ran,
 * so switching kind left the old kind's keys registered and the new kind's
 * missing: a panel of controls that write nowhere, which is the failure I-8
 * exists to make impossible.
 *
 * The structural keys are `kind`, `when` and `assetId` — the two providers'
 * `STRUCTURAL_CONTENT_KEYS`. Named here rather than imported, because importing
 * `BundledProvider`'s module for a string array is what the `id.ts` split
 * exists to avoid, and because a provider this file has never heard of would
 * not be covered by an import either. Being over-inclusive here is free: a
 * false alarm costs one comparison per layer, and the comparison then finds
 * nothing to do.
 */
const STRUCTURAL_KEYS = ['kind', 'when', 'assetId'] as const;

export function layerSignature(scene: Scene): string {
  return scene.layers
    .map((l) => {
      const structural = STRUCTURAL_KEYS.map((k) => `${k}=${String(l.content[k] ?? '')}`).join(',');
      return `${l.id}|${l.providerId}|${structural}`;
    })
    .join(' ');
}

/**
 * Brings `entity.*` into step with the scene: every live layer registered,
 * every dead layer's keys given back.
 *
 * Idempotent and cheap to call again. A layer whose registered content keys
 * already match what its provider declares is skipped entirely; one that does
 * not has its whole `entity.<id>` subtree dropped and rebuilt, rather than the
 * content keys patched in place — one rebuild path, so there is no
 * half-updated state to reason about.
 *
 * A deleted layer must give its keys back or re-adding a layer with the same id
 * collides and the operator sees a crash on an ordinary edit (I-8).
 */
export function syncEntityParameters(
  registry: ParameterRegistry,
  read: ReadScene,
  setScene: UpdateScene,
  contentSpecsFor: ContentSpecsFor,
): void {
  const scene = read();
  const live = new Set(scene.layers.map((l) => l.id));

  for (const key of registry.keys('entity')) {
    const id = key.split('.')[1];
    if (id !== undefined && !live.has(id)) registry.unregisterPrefix(`entity.${id}`);
  }

  for (const layer of scene.layers) {
    const id = layer.id;
    const readLayer = (): Layer => {
      const found = read().layers.find((l) => l.id === id);
      if (!found) throw new Error(`layer ${id} is gone`);
      return found;
    };
    const specs = contentSpecsFor(layer);

    /**
     * Whether this layer's keys are already the right ones, asked OF THE
     * REGISTRY rather than of a remembered signature beside it.
     *
     * A side map of "what I registered last time" is a second source of truth
     * for something the registry already knows, and it goes stale exactly when
     * two registries share a layer id — which a test does routinely. Here the
     * question is answered from the thing being corrected: the content keys
     * currently registered against the keys the provider now declares. A
     * `tree` layer switched to `rect` exposes the same single `tint` and needs
     * no rebuild, and this says so without being told.
     */
    if (registry.has(`entity.${id}.opacity`)) {
      if (sameKeys(contentKeysOf(registry, id), specs.map((sp) => sp.key))) continue;
      registry.unregisterPrefix(`entity.${id}`);
    }

    // `applyLayerPatch`, not a spread: a patch that clears an optional field
    // carries `undefined`, and a spread would leave the KEY behind holding it.
    // See that function — the layer this produces has to be deep-equal to one
    // that never had the field, or P5-F's round-trip gate is measuring a
    // difference that does not exist.
    const patchLayer = (patch: LayerPatch): void => {
      setScene((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? applyLayerPatch(l, patch) : l)),
      }));
    };

    registry.registerAll(defineLayerParameters(id, readLayer, patchLayer));

    // Rule 9: whatever the provider invented is addressable too, or half the
    // instrument is unreachable when Phase 11 goes looking for it.
    registry.registerAll(
      defineContentParameters(id, specs, readLayer, (content) => patchLayer({ content })),
    );

    // I-4's entity half. Four segments (`entity.<id>.susceptibility.<forceId>`)
    // so a force id can never collide with a provider's content key.
    registry.registerAll(
      defineSusceptibilityParameters(id, FORCE_DEFINITIONS, readLayer, (susceptibility) =>
        patchLayer({ susceptibility }),
      ),
    );

    // I-18, P5-F. The four keys P5-C registered, now bound to scene state.
    //
    // A layer with no `motion` record READS as the defaults and WRITES a full
    // one: absent means "no motion declared" (P5-C), and the first write is
    // where the operator declares some. That asymmetry is why the read side
    // cannot be `layer.motion!` and the write side cannot be a shallow patch —
    // `createRouteMotion` fills the other three fields from the same defaults
    // the read reported, so the record the panel writes says what the panel
    // showed.
    registry.registerAll(
      defineMotionParameters(
        id,
        () => readLayer().motion ?? DEFAULT_ROUTE_MOTION,
        (patch: Partial<RouteMotion>) =>
          patchLayer({ motion: createRouteMotion({ ...(readLayer().motion ?? {}), ...patch }) }),
      ),
    );
  }
}

/**
 * A string that changes when, and only when, the GROUP key set might have:
 * which groups exist and which layers are their children. The mode is not in
 * it — toggling a mode changes a value, not a key — and neither is a duration.
 */
export function groupSignature(scene: Scene): string {
  return scene.groups.map((g) => `${g.id}:${g.children.map((c) => c.id).join(',')}`).join(' ');
}

/**
 * Brings `group.*` and `child.*` into step with the scene (I-16, B4): every
 * live group's mode and every child's duration registered, every dead one's
 * keys given back. Idempotent and cheap to call again, like
 * `syncEntityParameters`, and for the same reason: React runs effects twice.
 *
 * The writes go through `core/sceneEdit.ts` — `setGroupMode` fills durations
 * on the way into `sequence`, and `setChildDuration` refuses a zero — so the
 * registry and the panel's structural buttons produce the same scene for the
 * same intent rather than two that agree today.
 */
export function syncGroupParameters(
  registry: ParameterRegistry,
  read: ReadScene,
  setScene: UpdateScene,
): void {
  const scene = read();
  const liveGroups = new Set(scene.groups.map((g) => g.id));
  const liveChildren = new Set(scene.groups.flatMap((g) => g.children.map((c) => c.id)));

  for (const key of registry.keys('group')) {
    const id = key.split('.')[1];
    if (id !== undefined && !liveGroups.has(id)) registry.unregisterPrefix(`group.${id}`);
  }
  for (const key of registry.keys('child')) {
    const id = key.split('.')[1];
    if (id !== undefined && !liveChildren.has(id)) registry.unregisterPrefix(`child.${id}`);
  }

  for (const group of scene.groups) {
    const gid = group.id;
    if (!registry.has(`group.${gid}.mode`)) {
      const readGroup = (): Group => {
        const found = read().groups.find((g) => g.id === gid);
        if (!found) throw new Error(`group ${gid} is gone`);
        return found;
      };
      registry.registerAll(
        defineGroupParameters(gid, readGroup, (mode) =>
          setScene((prev) => setGroupMode(prev, gid, mode)),
        ),
      );
    }
    for (const child of group.children) {
      const cid = child.id;
      if (registry.has(`child.${cid}.duration`)) continue;
      const readChild = (): GroupChild => {
        for (const g of read().groups) {
          const found = g.children.find((c) => c.id === cid);
          if (found) return found;
        }
        throw new Error(`child ${cid} is gone`);
      };
      registry.registerAll(
        defineChildParameters(cid, readChild, (duration) =>
          setScene((prev) => setChildDuration(prev, cid, duration)),
        ),
      );
    }
  }
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
