/**
 * P5-E. Which editor keystrokes are forwarded to the output window.
 *
 * Pure logic, no DOM types, so the decision is unit-testable without a browser
 * (§8.1). The wiring in `App.tsx` is four lines around `forwardedShortcut`.
 *
 * There is no list of keys here. `OUTPUT_SHORTCUTS` in `electron/ipc.ts` is the
 * only list, and this module asks it — which is the point: a key added there is
 * forwarded from that moment without this file being touched, and a key removed
 * there stops being forwarded for the same reason.
 */
import { outputShortcutFor, type OutputShortcut } from '@shared/ipc';

/** Structural, so a test can pass a literal and a listener can pass a real event. */
export interface EventTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTargetLike | null;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Is the keystroke going into something the operator is typing or picking in?
 *
 * The editor is full of number fields and scene pickers, and `k` typed into a
 * layer name must stay a `k`. `SELECT` is in the list because a native dropdown
 * uses letter keys to jump between options.
 */
export function isTypingTarget(t: EventTargetLike | null): boolean {
  if (!t) return false;
  if (t.isContentEditable === true) return true;
  return typeof t.tagName === 'string' && TYPING_TAGS.has(t.tagName.toUpperCase());
}

/**
 * The shortcut this editor keystroke should forward, or null.
 *
 * Modifiers disqualify it outright: Cmd-R is the operator reloading, Cmd-H is
 * macOS hiding the app, and neither is a request to touch the projector.
 */
export function forwardedShortcut(e: KeyEventLike): OutputShortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  return outputShortcutFor(e.key);
}
