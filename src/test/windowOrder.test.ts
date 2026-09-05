import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The output window must never be the first `BrowserWindow` the process
 * creates.
 *
 * §10 row 11's fix drops `sandbox` on the output window so the preload gets a
 * real `process.hrtime` — 41 ns against `performance.now()`'s 100 us, ~2,400x
 * finer, which is what turns §4's metric 2 from a ceiling into a measurement.
 * Measured 2026-09-05, three runs out of three, the mixed configuration is
 * **order-dependent**: sandboxed editor first then unsandboxed output works,
 * and unsandboxed output first fails to load with `ERR_FAILED (-2)` and takes
 * the process down with `SIGTRAP`.
 *
 * The shape of the fix is the subject of this file. A comment plus a guard
 * leaves the wrong order reachable — it just dies with a better message — and
 * an undocumented ordering dependency between two adjacent lines is a trap
 * sprung in six months by someone reordering window creation for an unrelated
 * reason. So the dependency is expressed as a **call**: `openOutputWindow`
 * establishes its own precondition by calling `ensureEditorWindow` first, and
 * the ordering lives inside one function instead of at four call sites.
 *
 * This test asserts that property against the source, so a later edit that
 * quietly restores the convention fails here rather than on the wall.
 * B1 again, on code instead of documents.
 */
const MAIN = resolve(import.meta.dirname, '../../electron/main.ts');
const text = readFileSync(MAIN, 'utf8');

/** The body of a top-level `function name(...)` declaration, brace-matched. */
function bodyOf(name: string): string {
  const start = text.indexOf(`\nfunction ${name}(`);
  expect(start, `electron/main.ts declares no top-level function \`${name}\``).toBeGreaterThan(-1);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe('window creation order (§10 row 11, as a mechanism)', () => {
  it('creates exactly two BrowserWindows, one per window role', () => {
    const n = text.match(/new BrowserWindow\(/g)?.length ?? 0;
    expect(n, `electron/main.ts constructs ${n} BrowserWindow(s), expected 2`).toBe(2);
  });

  it('drops the sandbox on the output window and nowhere else', () => {
    const all = text.match(/sandbox: (true|false)/g) ?? [];
    expect(all, `sandbox flags in main.ts: ${JSON.stringify(all)}`).toEqual([
      'sandbox: true',
      'sandbox: false',
    ]);
    expect(bodyOf('ensureEditorWindow'), 'the editor window keeps its sandbox').toContain(
      'sandbox: true',
    );
    expect(bodyOf('openOutputWindow'), 'the output window is the unsandboxed one').toContain(
      'sandbox: false',
    );
  });

  it('ensures the editor window BEFORE constructing the output window', () => {
    const body = bodyOf('openOutputWindow');
    const ensure = body.indexOf('ensureEditorWindow()');
    const construct = body.indexOf('new BrowserWindow(');
    expect(ensure, '`openOutputWindow` never calls `ensureEditorWindow()`').toBeGreaterThan(-1);
    // Print the positions, not only the verdict (A9, A14).
    expect(
      ensure,
      `ensureEditorWindow() at ${ensure}, new BrowserWindow() at ${construct} — the precondition must come first`,
    ).toBeLessThan(construct);
  });

  it('ensures the editor idempotently, so a reopen does not close it', () => {
    // Without this the precondition would destroy the operator's editor every
    // time the output display changed — a fix that breaks the thing it guards.
    expect(bodyOf('ensureEditorWindow')).toMatch(
      /if \(editorWin && !editorWin\.isDestroyed\(\)\) return editorWin;/,
    );
  });

  it('exposes exactly one path that brings up a fresh pair', () => {
    const create = bodyOf('createWindows');
    expect(create).toContain('ensureEditorWindow()');
    expect(create).toContain('openOutputWindow(');

    // "The only exported path" stated literally: `ensureEditorWindow` is
    // CALLED from its own declaration, from `openOutputWindow`'s
    // precondition, and from `createWindows`. A fourth site is a cold start
    // that has grown its own pairing and can grow its own order with it.
    const sites = [...text.matchAll(/ensureEditorWindow\(/g)].map((m) => m.index ?? 0);
    const inside = (b: string, i: number): boolean => {
      const at = text.indexOf(b);
      return i >= at && i < at + b.length;
    };
    const stray = sites.filter(
      (i) =>
        !inside(bodyOf('ensureEditorWindow'), i) &&
        !inside(bodyOf('openOutputWindow'), i) &&
        !inside(create, i) &&
        !text.slice(0, i).endsWith('function '),
    );
    expect(
      stray.map((i) => text.slice(text.lastIndexOf('\n', i) + 1, text.indexOf('\n', i)).trim()),
      'a site outside createWindows() brings up the editor itself',
    ).toEqual([]);
  });
});
