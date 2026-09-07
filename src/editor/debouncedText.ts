/**
 * S2 — the one mechanism behind every text field whose write takes the
 * REBUILD path.
 *
 * B3 took a fair SHORTCUT: a face's `role` and `name` write on every
 * keystroke so the face lights while the builder types, and `fillRole` in
 * `ParamControl` writes the same way for the same reason. Two facts combine
 * that into a fault. `surfacesShapeKey` includes `role`, so a role change is a
 * full `setScene` rebuild — every provider view destroyed and re-created,
 * and for a video fill that is a decoder. And a `fillRole` keystroke is a new
 * scene, which the output's deep-equal guard cannot skip. So typing
 * `panel f1` was eight rebuilds and, with a video fill, eight decoders — the
 * fault B3 found on the pointer path, arriving from the keyboard.
 *
 * The fix is not "write on blur": a value that lands when focus leaves is a
 * face that lights when the builder clicks somewhere else, which is what B3
 * refused. It is a quiet period. 250 ms after the last keystroke the value
 * commits; a pause that short still reads as live on camera, and a word typed
 * at any speed is one rebuild, not one per character.
 *
 * Geometry is NOT here. A point drag is a reshape (`reshapeFill`), cheap by
 * construction, and it writes every sample as B3 settled. This module is for
 * the text that rebuilds, and it is the only debounce in the editor — a second
 * one with a different delay is how two fields come to disagree about what
 * "live" means.
 *
 * Pure and timer-injected so it is tested headless with fake timers; the
 * React wrapper (`DebouncedTextInput.tsx`) adds only a draft to type into.
 */

export const TEXT_COMMIT_DELAY_MS = 250;

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const REAL_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class TextCommitter {
  private handle: unknown = null;
  private pendingValue: string | null = null;

  constructor(
    private readonly commit: (value: string) => void,
    private readonly delayMs: number = TEXT_COMMIT_DELAY_MS,
    private readonly timers: Timers = REAL_TIMERS,
  ) {}

  /** A keystroke. Restarts the quiet period; nothing is written yet. */
  type(value: string): void {
    this.pendingValue = value;
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.flush();
    }, this.delayMs);
  }

  /** Blur, Enter, unmount: whatever is pending commits now. Nothing pending, nothing written. */
  flush(): void {
    if (this.handle !== null) {
      this.timers.clear(this.handle);
      this.handle = null;
    }
    if (this.pendingValue === null) return;
    const v = this.pendingValue;
    this.pendingValue = null;
    this.commit(v);
  }

  /** Drop what is pending without writing it. */
  cancel(): void {
    if (this.handle !== null) {
      this.timers.clear(this.handle);
      this.handle = null;
    }
    this.pendingValue = null;
  }

  get pending(): boolean {
    return this.pendingValue !== null;
  }
}
