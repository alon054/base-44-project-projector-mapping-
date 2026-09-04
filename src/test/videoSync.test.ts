/**
 * D5 — video phase alignment, tested without a decoder.
 *
 * "Video layers are phase-aligned at loop boundaries — synced at start-of-loop,
 * then free-running within the loop."
 *
 * Gate 3's wording is the thing under test: *"video re-syncs at its **next**
 * loop boundary"*. A scrub must NOT seek. Seeking on the scrub is the naive
 * reading, it would demo better, and it is exactly the per-frame seeking D5
 * says produces visible stutter.
 *
 * A `<video>` element in a unit test is a decoder in a unit test, which is why
 * the state machine is pure and this file touches no DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  createVideoSyncState,
  crossedBoundary,
  noteScrub,
  stepVideoSync,
} from '../providers/bundled/videoSync';

const DURATION = 4;

describe('boundary detection', () => {
  it('treats the first frame as a boundary — the element must start aligned', () => {
    expect(crossedBoundary(null, 0.4)).toBe(true);
  });

  it('is a wrap, not a threshold', () => {
    expect(crossedBoundary(0.9, 0.1)).toBe(true);
    expect(crossedBoundary(0.1, 0.2)).toBe(false);
    expect(crossedBoundary(0.99, 0.99)).toBe(false);
  });

  it('counts a backwards move as a crossing too', () => {
    // A backwards scrub crosses the boundary, and treating it as one keeps
    // "align at boundaries" free of a special case for direction of travel.
    expect(crossedBoundary(0.8, 0.2)).toBe(true);
  });
});

describe('stepVideoSync — free-run within a loop, realign at its edge', () => {
  it('seeks on the first frame and then leaves the element alone', () => {
    const s = createVideoSyncState();
    const first = stepVideoSync(s, 0.25, DURATION);
    expect(first.kind).toBe('seek');
    expect(first.kind === 'seek' && first.reason).toBe('first');
    expect(first.kind === 'seek' && first.timeSeconds).toBeCloseTo(1, 9);

    // Everything after, inside the same loop, is free-running. This is the
    // whole of D5's "not frame-exact, and the only option that does not
    // stutter" — a seek here would be one per frame.
    for (const p of [0.3, 0.4, 0.6, 0.9, 0.99]) {
      expect(stepVideoSync(s, p, DURATION).kind).toBe('none');
    }
  });

  it('realigns exactly once, at the wrap', () => {
    const s = createVideoSyncState();
    stepVideoSync(s, 0.1, DURATION);
    stepVideoSync(s, 0.9, DURATION);
    const atWrap = stepVideoSync(s, 0.02, DURATION);
    expect(atWrap.kind).toBe('seek');
    expect(atWrap.kind === 'seek' && atWrap.reason).toBe('boundary');
    expect(atWrap.kind === 'seek' && atWrap.timeSeconds).toBeCloseTo(0.08, 9);
    expect(stepVideoSync(s, 0.03, DURATION).kind).toBe('none');
  });

  it('scales the phase by the DECODER’s duration, not the declared period', () => {
    // A clip's container duration and its nominal length differ by a frame
    // often enough that using the declared value would put the seek a frame
    // off at every boundary, forever, in the same direction.
    const s = createVideoSyncState();
    const a = stepVideoSync(s, 0.5, 4.0333);
    expect(a.kind === 'seek' && a.timeSeconds).toBeCloseTo(2.01665, 6);
  });

  it('never seeks past the end of the media', () => {
    const s = createVideoSyncState();
    const a = stepVideoSync(s, 0.9999999, DURATION);
    expect(a.kind === 'seek' && a.timeSeconds).toBeLessThanOrEqual(DURATION);
  });

  it('does nothing when the duration is not yet known', () => {
    // `el.duration` is NaN until metadata arrives. Seeking to NaN throws in
    // some engines and silently rewinds in others; both are worse than waiting.
    const s = createVideoSyncState();
    expect(stepVideoSync(s, 0.5, Number.NaN).kind).toBe('none');
    const t = createVideoSyncState();
    expect(stepVideoSync(t, 0.5, 0).kind).toBe('none');
  });
});

describe('a scrub arms the next boundary and does NOT seek (Gate 3)', () => {
  it('notices a new scrub sequence exactly once', () => {
    const s = createVideoSyncState();
    expect(noteScrub(s, 0)).toBe(false);
    expect(noteScrub(s, 1)).toBe(true);
    expect(noteScrub(s, 1)).toBe(false);
    expect(noteScrub(s, 2)).toBe(true);
  });

  it('a scrub mid-loop produces no seek until the loop ends', () => {
    const s = createVideoSyncState();
    stepVideoSync(s, 0.1, DURATION); // first-frame align
    stepVideoSync(s, 0.2, DURATION);

    // The operator scrubs. The video carries on from wherever it was — which
    // is what a viewer sees as "the video keeps playing and then quietly lands
    // back in step", and is the opposite of a stutter.
    noteScrub(s, 1);
    expect(stepVideoSync(s, 0.7, DURATION).kind).toBe('none');
    expect(stepVideoSync(s, 0.8, DURATION).kind).toBe('none');

    // ...and at the next boundary it realigns.
    const landed = stepVideoSync(s, 0.05, DURATION);
    expect(landed.kind).toBe('seek');
    expect(landed.kind === 'seek' && landed.timeSeconds).toBeCloseTo(0.2, 9);
  });

  it('a scrub that itself crosses the boundary realigns immediately', () => {
    // Not a special case — the scrub moved the phase backwards past 0, which
    // IS a boundary crossing, and the same rule applies.
    const s = createVideoSyncState();
    stepVideoSync(s, 0.8, DURATION);
    noteScrub(s, 1);
    const jumped = stepVideoSync(s, 0.1, DURATION);
    expect(jumped.kind).toBe('seek');
  });

  it('sync is loop-granular by construction: at most one seek per loop', () => {
    // Walk several loops at 60 Hz over a 4 s clip and count the seeks. 240
    // frames per loop; anything more than one seek per loop is the per-frame
    // seeking D5 rules out.
    const s = createVideoSyncState();
    let seeks = 0;
    const framesPerLoop = 240;
    const loops = 5;
    for (let i = 0; i < framesPerLoop * loops; i++) {
      const phase = (i / framesPerLoop) % 1;
      if (stepVideoSync(s, phase, DURATION).kind === 'seek') seeks++;
    }
    expect(seeks).toBe(loops);
  });
});
