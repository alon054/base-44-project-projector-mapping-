import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The spec version is stated in two documents, and they must agree.
 *
 * ─── the history, because it is the whole reason this file exists ────────────
 *
 * **B1** fixed this drift once: `SPEC.md`'s header said `v3` while §1's top
 * block said v3.2. It shipped as an edit, and the edit said the header would
 * now carry version *and* status "so the two cannot drift apart silently
 * again". One version later the header said v3.3 against §1's v3.3.1 — silently
 * — because a fix that ships as an edit comes back.
 *
 * So it was rebuilt as a test. That was the right move and it is still the
 * right move; what changed is **what the two copies are.**
 *
 * **v4.0 deleted §1's revision history entirely** (§1 is now *What it is*), and
 * this test went on slicing the file from a heading that no longer exists.
 * `indexOf` returned -1, `slice(-1)` quietly took the last character of the
 * file rather than erroring, and the test failed — correctly, but by accident,
 * and against a copy of the version that no longer existed to disagree with.
 *
 * **The pair that can drift today is a different pair.** `SPEC.md` states its
 * version once, so it cannot contradict itself; `CHECKLIST.md` states which
 * spec version it tracks, in another file, with nothing checking it. That is
 * B1's defect with one document's worth of distance added. This test is now
 * aimed there — the same mechanism, pointed at the surface that is live.
 *
 * Two consequences worth stating, because both are load-bearing:
 *
 *  - **A missing marker fails loudly.** Every lookup below is asserted non-null
 *    with a message naming the file and the line it expected. A cross-check
 *    that vacuously passes when its subject is deleted is how this test spent
 *    a session reporting a spec rewrite as a null-pointer complaint.
 *  - **`SPEC.md` must state its version exactly once.** A second statement
 *    inside one file is the original B1 defect returning, and it would be
 *    invisible to a test that only compares across files.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SPEC = resolve(import.meta.dirname, '../../SPEC.md');
const CHECKLIST = resolve(import.meta.dirname, '../../CHECKLIST.md');

/** `**Spec version:** v4.0` — `SPEC.md`'s header. */
const SPEC_VERSION = /^\*\*Spec version:\*\* (v[\d.]+)$/m;
/** ``**Tracking `SPEC.md` v4.0.**`` — `CHECKLIST.md`'s header. */
const CHECKLIST_TRACKS = /^\*\*Tracking `SPEC\.md` (v[\d.]+)\.\*\*/m;

describe('spec version (B1, as a mechanism)', () => {
  const spec = readFileSync(SPEC, 'utf8');
  const checklist = readFileSync(CHECKLIST, 'utf8');

  it('SPEC.md states a version in its header', () => {
    expect(
      SPEC_VERSION.exec(spec),
      'SPEC.md has no `**Spec version:** vX` line. B1 put it there so the ' +
        'version is stated somewhere machine-readable; restore it rather than ' +
        'relaxing this test.',
    ).not.toBeNull();
  });

  it('SPEC.md states it exactly once — a file cannot disagree with itself', () => {
    // The original B1 defect, guarded at its source. Two version statements in
    // one document is the thing that drifted twice; one cannot.
    const all = [...spec.matchAll(/^\*\*Spec version:\*\*/gm)];
    expect(all.length, `SPEC.md states its version ${all.length} times`).toBe(1);
  });

  it('CHECKLIST.md names the spec version it tracks', () => {
    expect(
      CHECKLIST_TRACKS.exec(checklist),
      'CHECKLIST.md has no ``**Tracking `SPEC.md` vX.**`` line. That line IS ' +
        'the second copy this test compares; deleting it removes the drift ' +
        'surface AND the check, so it fails here rather than passing vacuously.',
    ).not.toBeNull();
  });

  it('the two agree', () => {
    const specVersion = SPEC_VERSION.exec(spec)?.[1];
    const tracked = CHECKLIST_TRACKS.exec(checklist)?.[1];
    // Print the values, not only the verdict (A9, A14).
    expect(
      tracked,
      `SPEC.md says ${specVersion} and CHECKLIST.md tracks ${tracked}`,
    ).toBe(specVersion);
  });
});
