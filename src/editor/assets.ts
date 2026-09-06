/**
 * The editor window's one library: the bundled catalog, plus whatever the
 * operator has brought home from the online catalog.
 *
 * A module-level singleton because `createBundledLibrary()` validates every
 * asset's I-10 licence record on construction, and there is no reason for the
 * parameter registry, the content picker and the caps warning to each build
 * their own copy of the same catalog and each pay for that. One instance also
 * means the picker cannot offer an asset the registry has never heard of.
 *
 * Separate from `useSceneRegistry` so that a panel needing the catalog does not
 * have to import a React hook to reach it.
 *
 * Downloaded entries arrive from main as JSON (`library:list` at startup,
 * `library:added` afterwards) and go in through the SAME door the bundled ones
 * used — `AssetLibrary.register`, which is where I-10 refuses. `libraryVersion`
 * ticks once per registration so a React panel that memoised its choice list
 * can re-derive it; the library itself is not React state and never copies.
 */
import { createBundledLibrary } from '../providers/bundled/manifest';
import { canonicalizeLibraryEntry } from '../core/libraryEntry';

export const editorLibrary = createBundledLibrary();

let version = 0;
const listeners = new Set<(v: number) => void>();

/** Ticks once per successful registration. A memo dependency, nothing more. */
export function libraryVersion(): number {
  return version;
}

export function onLibraryChange(fn: (v: number) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Register downloaded entries. Returns the ids that were new. A malformed
 * entry is logged and skipped (I-13); one already present is skipped silently
 * — `library:list` and `library:added` can both deliver the same id.
 */
export function registerLibraryEntries(entries: readonly unknown[]): string[] {
  const added: string[] = [];
  for (const raw of entries) {
    try {
      const asset = canonicalizeLibraryEntry(raw);
      if (editorLibrary.get(asset.id)) continue;
      editorLibrary.register(asset);
      added.push(asset.id);
    } catch (err) {
      console.warn(`[library] entry skipped: ${String(err)}`);
    }
  }
  if (added.length > 0) {
    version++;
    // Operator-paced and once per batch: the run log's evidence that a
    // downloaded asset reached the pickers, beside the output's own line.
    console.log(`[library] ${added.length} downloaded asset(s) in the pickers: ${added.join(', ')}`);
    for (const fn of listeners) fn(version);
  }
  return added;
}
