/**
 * I-13's video fallback chain, as a pure decision.
 *
 * "A video that fails to decode falls back to its **poster frame**, then to the
 * **placeholder**."
 *
 * Three rungs, and the reason they are extracted here rather than left as
 * conditionals inside `VideoView` is that the chain's correctness is a property
 * of a TABLE, not of a sequence of events. The same end state has to come out
 * whichever order the two loads finish in — and they race: the poster is a
 * small JPEG and the video is a megabyte of H.264, so on a warm cache the
 * decoder can fail before the poster has arrived, and on a cold one the poster
 * can arrive first. A run log confirmed the first ordering on the very first
 * resilience run:
 *
 *     [video] broken: placeholder — decode failed
 *     [video] broken: poster — poster ready
 *
 * A layer that ended on `placeholder` when a perfectly good poster existed
 * would be a worse projection than one that ended on the poster, and nothing
 * about which promise settled first should decide that.
 *
 * Free of the DOM so §8.1 can test the chain without a decoder.
 */

/** What the view is currently showing. Reported to the HUD and the run log. */
export type VideoStage = 'loading' | 'poster' | 'playing' | 'placeholder';

export interface VideoStageInput {
  /** §5/A2: false in the editor preview, where no `<video>` is created at all. */
  decoding: boolean;
  /** The decoder produced a usable frame. */
  decoded: boolean;
  /** The decoder reported an error, or decoded to nothing. */
  decodeFailed: boolean;
  /** A poster texture is loaded and has real dimensions. */
  hasPoster: boolean;
  /** The poster load rejected. */
  posterFailed: boolean;
}

/**
 * The whole chain, as one expression.
 *
 * Order of the tests is the chain's order and is the only thing that matters:
 * playing beats poster, poster beats placeholder, and `loading` is only ever
 * the answer while nothing has resolved yet.
 */
export function resolveVideoStage(s: VideoStageInput): VideoStage {
  // Rung 1. A live decode wins outright, and only the OUTPUT window decodes.
  if (s.decoding && s.decoded && !s.decodeFailed) return 'playing';
  // Rung 2. A poster is a real picture on the wall that looks deliberate. It
  // is the answer whenever one exists and the decode is not running — whether
  // because the decode failed, or because this is the preview and there is no
  // decoder by design.
  if (s.hasPoster) return 'poster';
  // Rung 3. Nothing left. Visible magenta beats a black rectangle, because a
  // silently-black layer is indistinguishable from content meant to be black.
  if (s.decodeFailed || s.posterFailed) return 'placeholder';
  // Nothing has resolved yet. Still shows the placeholder on screen — it is a
  // distinct STATE from a settled failure, and the run log distinguishes them.
  return 'loading';
}

/** True when the view has reached a state it will not leave on its own. */
export function isSettled(stage: VideoStage, s: VideoStageInput): boolean {
  if (stage === 'playing') return true;
  if (stage === 'placeholder') return s.posterFailed && (s.decodeFailed || !s.decoding);
  if (stage === 'poster') return !s.decoding || s.decodeFailed;
  return false;
}

/**
 * Whether the decoder should be running, given the clock.
 *
 * Pure, and separate from the view, because the first version of this decision
 * was two independent `if`s inside the per-frame update and they FOUGHT each
 * other. At rate 0 the first branch saw a paused element and resumed it, the
 * second saw a running element at rate 0 and paused it, and the decoder was
 * started and stopped sixty times a second — the run log filled with
 * alternating `decoder resumed` / `decoder held` lines, hundreds of them.
 *
 * It was found the first time the clock was ever paused in a real process, by
 * the unattended transport exercise, on its first run. Nothing in the unit
 * suite could have caught it: each branch was individually correct, and the
 * bug lived only in their interaction across a frame boundary. Gate 3 asks
 * that "video pauses too, at frame granularity", and a decoder thrashing at 60
 * Hz might well have looked like a frozen frame to a person watching a wall.
 *
 * One function, one answer, applied once.
 */
export function decoderShouldRun(playing: boolean, rate: number): boolean {
  // Rate 0 is a held frame that has NOT left the playing state (see
  // `core/clock.ts`), and a media element cannot be asked for playbackRate 0 —
  // some engines throw. Pausing is the same result on the wall.
  return playing && Number.isFinite(rate) && rate > 0;
}

/** What to do to the element this frame. `unchanged` is the common case. */
export type DecoderAction = 'run' | 'hold' | 'unchanged';

export function decoderAction(
  playing: boolean,
  rate: number,
  currentlyPaused: boolean,
): DecoderAction {
  const shouldRun = decoderShouldRun(playing, rate);
  if (shouldRun && currentlyPaused) return 'run';
  if (!shouldRun && !currentlyPaused) return 'hold';
  return 'unchanged';
}
