/**
 * The editor window's one bundled library.
 *
 * A module-level singleton because `createBundledLibrary()` validates every
 * asset's I-10 licence record on construction, and there is no reason for the
 * parameter registry, the content picker and the caps warning to each build
 * their own copy of the same catalog and each pay for that. One instance also
 * means the picker cannot offer an asset the registry has never heard of.
 *
 * Separate from `useSceneRegistry` so that a panel needing the catalog does not
 * have to import a React hook to reach it.
 */
import { createBundledLibrary } from '../providers/bundled/manifest';

export const editorLibrary = createBundledLibrary();
