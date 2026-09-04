/**
 * I-13's video fallback chain: poster, then placeholder.
 *
 * The chain is tested as a TABLE rather than as a sequence, because the two
 * loads behind it genuinely race — the poster is a small JPEG and the video a
 * megabyte of H.264 — and the same end state has to come out either way. The
 * first resilience run showed the decoder failing FIRST:
 *
 *     [video] broken: placeholder — decode failed
 *     [video] broken: poster — poster ready
 *
 * which is the ordering that a naive implementation gets wrong, by settling on
 * the placeholder and never reconsidering when the poster turns up.
 */
import { describe, expect, it } from 'vitest';
import { isSettled, resolveVideoStage, type VideoStageInput } from '../providers/bundled/videoStage';

const base: VideoStageInput = {
  decoding: true,
  decoded: false,
  decodeFailed: false,
  hasPoster: false,
  posterFailed: false,
};

const at = (over: Partial<VideoStageInput>): VideoStageInput => ({ ...base, ...over });

describe('I-13 — the three rungs', () => {
  it('a live decode wins outright', () => {
    expect(resolveVideoStage(at({ decoded: true }))).toBe('playing');
    expect(resolveVideoStage(at({ decoded: true, hasPoster: true }))).toBe('playing');
  });

  it('a decode failure with a poster lands on the POSTER, not the placeholder', () => {
    // The middle rung is the whole point: something on the wall that looks
    // deliberate, rather than a magenta box in front of an audience.
    expect(resolveVideoStage(at({ decodeFailed: true, hasPoster: true }))).toBe('poster');
  });

  it('a decode failure with NO poster falls all the way through', () => {
    expect(resolveVideoStage(at({ decodeFailed: true, posterFailed: true }))).toBe('placeholder');
    expect(resolveVideoStage(at({ decodeFailed: true }))).toBe('placeholder');
  });

  it('shows loading until something resolves', () => {
    expect(resolveVideoStage(base)).toBe('loading');
  });
});

describe('the chain does not depend on which load finished first', () => {
  it('poster-then-failure and failure-then-poster reach the same end state', () => {
    // Poster arrives, then the decoder fails.
    const posterFirst = resolveVideoStage(at({ hasPoster: true, decodeFailed: true }));
    // Decoder fails, then the poster arrives. Same inputs, and that is the
    // point — the resolver has no memory of ordering to get wrong.
    const failureFirst = resolveVideoStage(at({ decodeFailed: true, hasPoster: true }));
    expect(posterFirst).toBe(failureFirst);
    expect(posterFirst).toBe('poster');
  });

  it('a poster arriving after a settled placeholder rescues the layer', () => {
    const before = resolveVideoStage(at({ decodeFailed: true }));
    expect(before).toBe('placeholder');
    const after = resolveVideoStage(at({ decodeFailed: true, hasPoster: true }));
    expect(after).toBe('poster');
    // And the placeholder was NOT a settled state while a poster could still
    // arrive — which is what stops an implementation from latching it.
    expect(isSettled(before, at({ decodeFailed: true }))).toBe(false);
  });
});

describe('§5/A2 — the preview shows a poster and never decodes', () => {
  it('a non-decoding view with a poster is a poster, not a failure', () => {
    // No decoder is not an error. The editor preview is in this state for
    // every video layer, always, by design.
    expect(resolveVideoStage(at({ decoding: false, hasPoster: true }))).toBe('poster');
    expect(isSettled('poster', at({ decoding: false, hasPoster: true }))).toBe(true);
  });

  it('a non-decoding view whose poster fails is a placeholder', () => {
    expect(resolveVideoStage(at({ decoding: false, posterFailed: true }))).toBe('placeholder');
  });

  it('never reports playing when nothing is decoding', () => {
    // A preview that claimed to be playing would be a lie the badge exists to
    // prevent, and would hide the doubled-decoder cost A2 forbids.
    for (const over of [{ decoded: true }, { decoded: true, hasPoster: true }]) {
      expect(resolveVideoStage(at({ ...over, decoding: false }))).not.toBe('playing');
    }
  });
});

describe('every combination resolves to a legal stage', () => {
  it('is total over its input space', () => {
    const bools = [false, true];
    let seen = 0;
    for (const decoding of bools)
      for (const decoded of bools)
        for (const decodeFailed of bools)
          for (const hasPoster of bools)
            for (const posterFailed of bools) {
              const stage = resolveVideoStage({
                decoding,
                decoded,
                decodeFailed,
                hasPoster,
                posterFailed,
              });
              expect(['loading', 'poster', 'playing', 'placeholder']).toContain(stage);
              seen++;
            }
    expect(seen).toBe(32);
  });

  it('never returns loading once anything has settled', () => {
    const settledInputs: Partial<VideoStageInput>[] = [
      { decoded: true },
      { decodeFailed: true },
      { hasPoster: true },
      { posterFailed: true, decodeFailed: true },
    ];
    for (const over of settledInputs) {
      expect(resolveVideoStage(at(over))).not.toBe('loading');
    }
  });
});
