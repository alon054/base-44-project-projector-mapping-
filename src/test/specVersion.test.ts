import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `SPEC.md`'s version header must equal the first version named in §1.
 *
 * B1 fixed exactly this drift — the header said `v3` while §1 said v3.2 — and
 * said the header would now carry version and status "so the two cannot drift
 * apart silently again". One version later the header said v3.3 against §1's
 * v3.3.1, silently, because B1 shipped as an edit and not as a mechanism.
 *
 * **A fix that shipped as an edit comes back; a fix that shipped as a test does
 * not.** This is that fix, shipped the second way.
 */
const SPEC = resolve(import.meta.dirname, '../../SPEC.md');

describe('SPEC.md version header (B1, as a mechanism)', () => {
  const text = readFileSync(SPEC, 'utf8');

  it('states a version in its header', () => {
    expect(text).toMatch(/^\*\*Spec version:\*\* v[\d.]+$/m);
  });

  it('agrees with the first version named in §1', () => {
    const header = /^\*\*Spec version:\*\* (v[\d.]+)$/m.exec(text);
    const first = /^\*\*(v[\d.]+) —/m.exec(text.slice(text.indexOf('## 1. Revision history')));
    expect(header, 'no `**Spec version:** vX` line in the header').not.toBeNull();
    expect(first, 'no `**vX — ...**` revision block in §1').not.toBeNull();
    // Print the values, not only the verdict (A9, A14).
    expect(
      header?.[1],
      `header says ${header?.[1]} and §1's first block says ${first?.[1]}`,
    ).toBe(first?.[1]);
  });
});
