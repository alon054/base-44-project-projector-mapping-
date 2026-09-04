/**
 * D5 — video phase alignment, as a pure decision function.
 *
 * "Video layers are phase-aligned at loop boundaries — synced at start-of-loop,
 * then free-running within the loop. … Accept that video sync is loop-granular,
 * not frame-exact: good enough for atmosphere, and the only option that does
 * not stutter."
 *
 * The rule that makes this non-obvious is the second half of Gate 3's scrub
 * condition: *"video re-syncs at its **next** loop boundary"*. So a scrub does
 * NOT seek the video. It arms a resync, and the seek happens when the clock's
 * phase next wraps. Seeking on the scrub itself would be the naive reading,
 * would look better in a demo, and would be exactly the per-frame seeking D5
 * says produces visible stutter — the gate is worded the way it is on purpose.
 *
 * Pure and free of the DOM so §8.1 can test the state machine without a decoder
 * (a video element in a unit test is a decoder in a unit test).
 */

export type VideoSyncAction =
  | { kind: 'none' }
  /** Seek the element to `timeSeconds`, then resume if the clock is playing. */
  | { kind: 'seek'; timeSeconds: number; reason: 'boundary' | 'first' };

export interface VideoSyncState {
  /** Clock phase at the previous frame, or null before the first frame. */
  lastPhase: number | null;
  /** A scrub happened; the next boundary must resync rather than free-run. */
  resyncArmed: boolean;
  /** The clock's `scrubSeq` last seen, so a scrub is detected without a hook. */
  lastScrubSeq: number;
}

export function createVideoSyncState(): VideoSyncState {
  return { lastPhase: null, resyncArmed: true, lastScrubSeq: 0 };
}

/**
 * True when the clock's phase wrapped between two frames.
 *
 * A wrap is `phase < lastPhase`. That is also true if the operator scrubbed
 * backwards, which is correct: a backwards scrub crosses the boundary too, and
 * treating it as one keeps the rule "align at boundaries" free of a special
 * case for the direction of travel.
 */
export function crossedBoundary(lastPhase: number | null, phase: number): boolean {
  if (lastPhase === null) return true;
  return phase < lastPhase;
}

/**
 * Decide what to do with the video element this frame.
 *
 * `durationSeconds` is the element's real decoded duration, which is not
 * necessarily the asset's declared `loopSeconds` — a clip's container duration
 * and its nominal length differ by a frame often enough that using the declared
 * value would put the seek a frame off at every boundary. The PHASE comes from
 * the clock and the declared period (I-2); the TARGET TIME is that phase scaled
 * by what the decoder actually has.
 */
export function stepVideoSync(
  state: VideoSyncState,
  phase: number,
  durationSeconds: number,
): VideoSyncAction {
  const first = state.lastPhase === null;
  const boundary = crossedBoundary(state.lastPhase, phase);
  state.lastPhase = phase;

  if (!boundary) return { kind: 'none' };
  // At a boundary, always realign — that IS the D5 rule. `resyncArmed` matters
  // only in that a scrub must not be allowed to seek before one.
  state.resyncArmed = false;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return { kind: 'none' };
  const target = clamp(phase * durationSeconds, 0, durationSeconds);
  return { kind: 'seek', timeSeconds: target, reason: first ? 'first' : 'boundary' };
}

/**
 * Notice a scrub and arm the resync, without seeking.
 *
 * Returns true when a scrub was seen. The video keeps playing from wherever it
 * was until the next boundary, which is what "re-syncs at its next loop
 * boundary" means and is what a viewer sees as "the video carries on and then
 * quietly lands back in step".
 */
export function noteScrub(state: VideoSyncState, scrubSeq: number): boolean {
  if (scrubSeq === state.lastScrubSeq) return false;
  state.lastScrubSeq = scrubSeq;
  state.resyncArmed = true;
  return true;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
