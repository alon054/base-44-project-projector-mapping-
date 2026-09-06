/**
 * P5-E. The forwarded-shortcut channel: the payload shape, the shared table,
 * and the two source-level checks that keep the table the ONLY table.
 *
 * The interesting tests here are the last three. Everything above them checks
 * a function; those check that neither path grew a list of its own — which is
 * the thing the block actually asked for, and the only part a future edit can
 * quietly undo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CH,
  OUTPUT_SHORTCUTS,
  OutputKeyError,
  assertJsonOnly,
  canonicalizeOutputKeyPress,
  outputShortcutFor,
} from '@shared/ipc';
import { forwardedShortcut, isTypingTarget } from '../editor/outputKeys';
import { shortcutLegend } from '../debug/hud';

const src = (rel: string): string =>
  readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');

describe('the shortcut table', () => {
  it('carries the keys the blocks name — P5-E\'s three, plus B3\'s wall grid', () => {
    expect(OUTPUT_SHORTCUTS.map((s) => s.key)).toEqual(['h', 'r', 'k', 'g']);
  });

  it('is well formed: single lowercase keys, unique keys, unique actions', () => {
    for (const s of OUTPUT_SHORTCUTS) {
      expect(s.key).toHaveLength(1);
      expect(s.key).toBe(s.key.toLowerCase());
      expect(s.label.length).toBeGreaterThan(0);
    }
    const keys = OUTPUT_SHORTCUTS.map((s) => s.key);
    const actions = OUTPUT_SHORTCUTS.map((s) => s.action);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('matches case-insensitively, so shift-H still toggles the HUD', () => {
    expect(outputShortcutFor('H')?.action).toBe('hud');
    expect(outputShortcutFor('h')?.action).toBe('hud');
    expect(outputShortcutFor('K')?.action).toBe('probeK');
  });

  it('returns null for a key that is not in it, and for multi-character keys', () => {
    expect(outputShortcutFor('q')).toBeNull();
    // The editor's own keys. `Enter` and `Delete` belong to the path tool and
    // must never be forwarded anywhere.
    expect(outputShortcutFor('Enter')).toBeNull();
    expect(outputShortcutFor('Delete')).toBeNull();
    expect(outputShortcutFor('')).toBeNull();
  });
});

describe('the payload shape — key identity only (I-7)', () => {
  it('accepts each key in the table and returns it canonicalized', () => {
    for (const s of OUTPUT_SHORTCUTS) {
      expect(canonicalizeOutputKeyPress({ key: s.key })).toEqual({ key: s.key });
    }
  });

  it('lowercases on the way through, so one shape reaches the dispatch', () => {
    expect(canonicalizeOutputKeyPress({ key: 'H' })).toEqual({ key: 'h' });
  });

  it('carries the key and NOTHING else — extra fields are not copied', () => {
    const out = canonicalizeOutputKeyPress({ key: 'h', screenshot: 'anything', at: 12 });
    expect(Object.keys(out)).toEqual(['key']);
  });

  it('drops a smuggled pixel buffer rather than relaying it (I-7)', () => {
    // The guard would refuse this at the send site; canonicalize means it also
    // cannot survive the receive side, so neither end alone has to be trusted.
    const out = canonicalizeOutputKeyPress({ key: 'r', frame: new Uint8Array(16) });
    expect(out).toEqual({ key: 'r' });
    expect(() => assertJsonOnly(out)).not.toThrow();
  });

  it('a real payload passes the I-7 guard', () => {
    expect(() => assertJsonOnly({ key: 'h' })).not.toThrow();
    expect(() => assertJsonOnly({ key: 'h', frame: new Float32Array(4) })).toThrow(/I-7/);
  });

  it('refuses an unknown key and NAMES it', () => {
    expect(() => canonicalizeOutputKeyPress({ key: 'q' })).toThrow(OutputKeyError);
    expect(() => canonicalizeOutputKeyPress({ key: 'q' })).toThrow(/"q"/);
    // And says what it does know, so the reader can see which build is behind.
    expect(() => canonicalizeOutputKeyPress({ key: 'q' })).toThrow(/h, r, k/);
  });

  it('refuses anything that is not an object with a string key', () => {
    expect(() => canonicalizeOutputKeyPress(null)).toThrow(/expected an object/);
    expect(() => canonicalizeOutputKeyPress('h')).toThrow(/expected an object/);
    expect(() => canonicalizeOutputKeyPress(['h'])).toThrow(/an array/);
    expect(() => canonicalizeOutputKeyPress({})).toThrow(/must be a string/);
    expect(() => canonicalizeOutputKeyPress({ key: 104 })).toThrow(/must be a string/);
  });

  it('travels on its own channel, distinct from every other one', () => {
    const channels = Object.values(CH);
    expect(new Set(channels).size).toBe(channels.length);
    expect(CH.outputKey).not.toBe(CH.sceneSet);
    expect(CH.outputKey).not.toBe(CH.paramSet);
  });
});

describe('what the editor forwards', () => {
  const ev = (over: Partial<Parameters<typeof forwardedShortcut>[0]>) => ({
    key: 'h',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    ...over,
  });

  it('forwards a bare shortcut key', () => {
    expect(forwardedShortcut(ev({}))?.action).toBe('hud');
    expect(forwardedShortcut(ev({ key: 'r' }))?.action).toBe('resetMetrics');
  });

  it('forwards nothing that is not in the table', () => {
    expect(forwardedShortcut(ev({ key: 'q' }))).toBeNull();
    expect(forwardedShortcut(ev({ key: 'Enter' }))).toBeNull();
  });

  it('leaves modified keys alone — Cmd-R is a reload, Cmd-H hides the app', () => {
    expect(forwardedShortcut(ev({ key: 'r', metaKey: true }))).toBeNull();
    expect(forwardedShortcut(ev({ key: 'h', ctrlKey: true }))).toBeNull();
    expect(forwardedShortcut(ev({ key: 'k', altKey: true }))).toBeNull();
  });

  it('leaves a key being typed into a field alone', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(forwardedShortcut(ev({ target: { tagName } })), tagName).toBeNull();
    }
    expect(forwardedShortcut(ev({ target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull();
  });

  it('still forwards from the preview surface, which is a focusable div', () => {
    // `role="application"` with `tabIndex` — not a typing target, and the most
    // likely place the operator's focus actually is when they reach for `h`.
    expect(forwardedShortcut(ev({ target: { tagName: 'DIV' } }))?.action).toBe('hud');
  });

  it('isTypingTarget survives a null target', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});

/**
 * The mechanism, checked at the source rather than at the behaviour.
 *
 * A guard would be a comment saying "keep these in step". These three say the
 * step is not possible: the output dispatches through a
 * `Record<OutputShortcutAction, ...>` (so the compiler demands a handler for
 * every row), the editor asks the table which keys to forward, and neither file
 * compares a key against a hardcoded letter any more.
 */
describe('one table, and no second list to drift from it', () => {
  it('the output has a handler for every action, and the type demands it', () => {
    const out = src('src/output/main.ts');
    expect(out).toContain('Record<OutputShortcutAction, () => void>');
    for (const s of OUTPUT_SHORTCUTS) {
      expect(out, `no handler for ${s.action}`).toMatch(new RegExp(`\\b${s.action}:`));
    }
  });

  it('neither path compares a key against a hardcoded shortcut letter', () => {
    for (const file of ['src/output/main.ts', 'src/editor/App.tsx', 'src/editor/outputKeys.ts']) {
      const text = src(file);
      for (const s of OUTPUT_SHORTCUTS) {
        expect(text, `${file} hardcodes '${s.key}'`).not.toMatch(
          new RegExp(`key\\s*===\\s*['"\`]${s.key}['"\`]`, 'i'),
        );
      }
    }
  });

  it('both paths reach the shortcut through the shared module', () => {
    expect(src('src/output/main.ts')).toContain('outputShortcutFor');
    expect(src('src/editor/outputKeys.ts')).toContain("from '@shared/ipc'");
    expect(src('src/editor/App.tsx')).toContain('forwardedShortcut');
  });

  /**
   * The legend the operator reads off the wall, checked against the table
   * rather than against the string it currently produces — a legend typed out
   * by hand would pass a `toContain('OUTPUT_SHORTCUTS')` on the import line
   * alone, which is exactly what an earlier version of this test did and what
   * mutation M16 walked straight through.
   */
  it('the HUD legend is the table, not a second copy of it', () => {
    const legend = shortcutLegend();
    expect(legend).toContain(
      OUTPUT_SHORTCUTS.map((s) => `${s.key} ${s.label}`).join('  ·  '),
    );
    for (const s of OUTPUT_SHORTCUTS) expect(legend).toContain(s.label);
  });

  it('forwarding is additive: the output keeps its own keydown listener', () => {
    const out = src('src/output/main.ts');
    expect(out).toContain("window.addEventListener('keydown'");
    expect(out).toContain('window.engine.onOutputKey');
  });
});
