/**
 * App/installation preferences (SPEC.md §7 `config/`).
 *
 * Not a scene, not calibration (I-5). Files on disk, never localStorage
 * (CLAUDE.md). Electron 44's own `windowStatePersistence` option is deliberately
 * left off: two competing persistence mechanisms is how a projector window comes
 * back fullscreen on the wrong display.
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Identity of a display that survives a relaunch. `Display.id` alone does not —
 * it is not stable across reboots and cable reconnects on macOS — so it is
 * stored as a hint and the tuple is what actually matches.
 */
export interface DisplayFingerprint {
  id: number;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  internal: boolean;
}

export interface Settings {
  version: 1;
  /** The display chosen as the projector, or null if never chosen. */
  outputDisplay: DisplayFingerprint | null;
  /** HUD is off by default in the output window (C4). */
  hudVisible: boolean;
  /** Uncapped measurement mode; applied at launch, needs a relaunch to change (ADD-2). */
  measurementMode: boolean;
  editorBounds: { x: number; y: number; width: number; height: number } | null;
}

const DEFAULTS: Settings = {
  version: 1,
  outputDisplay: null,
  hudVisible: false,
  measurementMode: false,
  editorBounds: null,
};

function settingsPath(): string {
  // Packaged: userData. Dev: the repo's config/ dir, so it is inspectable.
  return app.isPackaged
    ? join(app.getPath('userData'), 'settings.json')
    : join(app.getAppPath(), 'config', 'settings.json');
}

let cache: Settings | null = null;

export function loadSettings(): Settings {
  if (cache) return cache;
  const p = settingsPath();
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<Settings>;
      // Shallow, tolerant merge — a settings file from a future version must not
      // stop the app from opening (I-13 in spirit: no config failure ends a session).
      cache = { ...DEFAULTS, ...raw, version: 1 };
      return cache;
    }
  } catch (err) {
    console.error('[config] unreadable settings, using defaults:', err);
  }
  cache = { ...DEFAULTS };
  return cache;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...loadSettings(), ...patch, version: 1 };
  cache = next;
  const p = settingsPath();
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[config] could not persist settings:', err);
  }
  return next;
}

export function fingerprint(d: Electron.Display): DisplayFingerprint {
  return {
    id: d.id,
    label: d.label,
    width: d.size.width,
    height: d.size.height,
    scaleFactor: d.scaleFactor,
    internal: d.internal,
  };
}

export type DisplayPickReason =
  | 'pinned-exact-id'
  | 'pinned-fingerprint'
  | 'stale-pin-fallback'
  | 'first-run-largest-external'
  | 'primary-fallback'
  | 'none';

export interface DisplayPick {
  display: Electron.Display | null;
  reason: DisplayPickReason;
  /** True when an operator's explicit pin resolved. The show-critical path. */
  pinned: boolean;
  /**
   * True when a pin exists but no attached display matches it — the projector
   * was unplugged, or a different external is present. The session continues
   * (I-13) but never silently retargets a stranger at fullscreen.
   */
  stalePin: boolean;
  /**
   * Gate 0 (C6) and A13: never enter fullscreen without explicit confirmation
   * when this is set. A cursorless frameless fullscreen window on the only
   * monitor is how you lock up a machine; a cursorless fullscreen window on
   * the wrong external is how you lose a show.
   */
  needsConfirmation: boolean;
}

/**
 * Resolve which display to project onto.
 *
 * **A13 policy — an explicit pin always wins; the heuristic is a first-run
 * fallback only.** This is show-critical: the operator's choice is data, the
 * heuristic is a guess, and a guess must never quietly overrule data.
 *
 * The tension with I-13 (loss of the output display must not end the session)
 * is resolved by degrading rather than retargeting: when a pin exists and does
 * not resolve, a window still opens on the best available display so the
 * session survives, but it opens **framed, with a warning, and never
 * fullscreen**, so the operator sees that the pin was lost instead of
 * discovering it on the wall.
 *
 * `Display.id` is tried first but never trusted alone — it is not stable across
 * reboots and cable reconnects on macOS — so the fingerprint tuple is what
 * actually matches.
 */
export function pickOutputDisplay(
  displays: readonly Electron.Display[],
  primaryId: number,
  saved: DisplayFingerprint | null,
): DisplayPick {
  if (saved) {
    const byId = displays.find((d) => d.id === saved.id && d.internal === saved.internal);
    if (byId) return pinnedPick(byId, 'pinned-exact-id', primaryId);

    const byPrint = displays.find(
      (d) =>
        d.label === saved.label &&
        d.size.width === saved.width &&
        d.size.height === saved.height &&
        d.scaleFactor === saved.scaleFactor &&
        d.internal === saved.internal,
    );
    if (byPrint) return pinnedPick(byPrint, 'pinned-fingerprint', primaryId);
  }

  const stalePin = saved !== null;

  const externals = displays
    .filter((d) => !d.internal && d.detected)
    .sort((a, b) => b.size.width * b.size.height - a.size.width * a.size.height);
  const largest = externals[0];
  if (largest) {
    return {
      display: largest,
      reason: stalePin ? 'stale-pin-fallback' : 'first-run-largest-external',
      pinned: false,
      stalePin,
      // A13: a stale pin is never silently promoted to fullscreen.
      needsConfirmation: stalePin || largest.id === primaryId || largest.internal,
    };
  }

  const primary = displays.find((d) => d.id === primaryId);
  if (primary) {
    return {
      display: primary,
      reason: 'primary-fallback',
      pinned: false,
      stalePin,
      needsConfirmation: true,
    };
  }

  return {
    display: null,
    reason: 'none',
    pinned: false,
    stalePin,
    needsConfirmation: true,
  };
}

function pinnedPick(
  d: Electron.Display,
  reason: 'pinned-exact-id' | 'pinned-fingerprint',
  primaryId: number,
): DisplayPick {
  return {
    display: d,
    reason,
    pinned: true,
    stalePin: false,
    // A pin to the internal/primary display is still a pin, but C6 stands: the
    // operator confirms before a cursorless fullscreen window covers their only
    // monitor.
    needsConfirmation: d.id === primaryId || d.internal,
  };
}
