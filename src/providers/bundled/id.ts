/**
 * The bundled provider's identity, and nothing else.
 *
 * Split out of `BundledProvider.ts` because a *constant* must not drag a
 * renderer into a pure test. `core/defaultScene.ts` needs only this id to build
 * a scene, but importing it from the provider pulled in `LottieView` and
 * therefore `lottie-web`, which calls `document.createElement` at module scope
 * — so three existing unit-test files that had never heard of Lottie failed to
 * load with `ReferenceError: document is not defined`.
 *
 * SPEC.md §8.1 is explicit that the unit suite is "pure logic, no GPU". A scene
 * model that cannot be constructed without a DOM is not that, and the fix
 * belongs at the import graph rather than in a test environment setting: making
 * the tests run in jsdom would have hidden the coupling instead of removing it.
 */
export const BUNDLED_PROVIDER_ID = 'bundled';

/**
 * Structural keys: they select WHICH asset a layer is, not a value on it.
 * `assetId` is excluded from the parameter registry for the same reason
 * `ProceduralProvider` excludes `kind` — changing it does not modulate the
 * layer, it replaces it. CLAUDE.md rule 9's grep test reads this list.
 */
export const STRUCTURAL_CONTENT_KEYS = ['assetId'] as const;
