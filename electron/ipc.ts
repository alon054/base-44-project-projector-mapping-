/**
 * Typed IPC contract. JSON only, never pixel buffers (I-7).
 *
 * This module is deliberately dependency-free so both the main process and the
 * renderers can import it, and so `assertJsonOnly` is unit-testable as pure
 * logic with no GPU and no Electron (SPEC.md §8.1).
 */

/** SPEC.md §4. Measured resolution through Phase 8 — the projector's native mode. */
export const DEV_RESOLUTION = { width: 1280, height: 720 } as const;
/** SPEC.md §4. The v1 spec target, validated when better hardware exists. */
export const TARGET_RESOLUTION = { width: 1920, height: 1080 } as const;

export const CH = {
  /** editor -> main -> output: one parameter value. */
  paramSet: 'param:set',
  /**
   * output -> main -> editor: the same token, sent the instant the output
   * renderer RECEIVES it, before any frame wait (A11 transport latency).
   */
  paramRecv: 'param:recv',
  /** output -> main -> editor: the same token, once the change has been presented. */
  paramAck: 'param:ack',
  /** main -> renderer: resolution, display mode, measurement-mode state. */
  outputConfig: 'output:config',
  /**
   * renderer -> main (invoke): pull the current config.
   * A push alone races the renderer's async setup — the renderer awaits its Pixi
   * init before it can register a listener, by which time `did-finish-load` has
   * already fired and the pushed message is gone. The pull is what makes N
   * reliably reach the metrics.
   */
  outputConfigRequest: 'output:config:get',
  /**
   * editor -> main -> output: the whole scene, as JSON (I-7, I-12).
   *
   * The scene and not a delta: Phase 1's scenes are small, edits are
   * operator-paced rather than per-frame, and a delta protocol is a second
   * description of the state whose only job is to agree with the first one.
   * Phase 6 owns history and coalescing (D12); if the payload ever gets large
   * enough to matter, that is the phase that will know it.
   */
  sceneSet: 'scene:set',
  /** output -> main -> editor: layers currently showing an I-13 placeholder. */
  sceneFailures: 'scene:failures',
  /**
   * I-2 / I-7. editor -> main -> output: the whole clock state, as JSON.
   *
   * A separate channel from `scene:set`, for the same reason `calibration:set`
   * is one. The clock is not scene content: loading a different scene must not
   * stop the show's time, and pausing must not have to carry a scene payload
   * with it. Sharing a channel would make both of those properties of message
   * ordering rather than of the design.
   *
   * Whole state, never a delta or a bare command. `{timeMs, playing, rate}` is
   * three numbers; a `pause` message would make the output's clock depend on
   * having received every previous message in order, and a dropped or replayed
   * one would leave the two windows disagreeing about the time with nothing in
   * either log to say so. Main replays the last one to a reopened output
   * window, exactly as it replays the last scene.
   */
  clockSet: 'clock:set',
  /**
   * I-5. editor -> main -> output: the whole warp calibration for one viewport.
   * Main persists it to `calibration/` on the way through and forwards it; it
   * never inspects it (see electron/calibration.ts).
   *
   * A separate channel from `scene:set` on purpose. Sharing one would make
   * "loading a different scene keeps the same calibration" a property of
   * message ordering rather than of the design, and I-5 says these are
   * different kinds of state.
   */
  calibrationSet: 'calibration:set',
  /** renderer -> main (invoke): the stored calibration, or null. Read at launch. */
  calibrationGet: 'calibration:get',
  /** output -> main -> editor: HUD numbers, for the editor's always-on text mirror (C4). */
  metrics: 'metrics:report',
  /** editor -> main (invoke): enumerate displays. */
  displaysList: 'displays:list',
  /** editor -> main (invoke): choose the projector display. */
  displaysSelect: 'displays:select',
  /** editor -> main (invoke): toggle uncapped measurement mode; needs a relaunch (ADD-2). */
  measurementMode: 'measurement:set',
  /** output -> main: persist HUD visibility to `config/` (SPEC.md §7). */
  hudState: 'hud:state',
  /** main -> renderer: a warning banner the operator must see. */
  warning: 'warning:show',
  /** output -> main: an unattended measurement run has finished; quit. */
  measureDone: 'measure:done',
  /**
   * output -> main: §4's measurement window is opening; give me focus.
   *
   * The renderer cannot do this itself. `window.focus()` from inside a
   * renderer does not raise an Electron BrowserWindow, and main's existing
   * focus call happens at `did-finish-load` — which, since the measurement run
   * gained a settling period and a cold probe, is now half a minute before the
   * window that actually needs focus. A gate run recorded `focus gained` at
   * t=53s INSIDE its own window because the editor had held it until then.
   */
  focusOutput: 'measure:focus',
  /**
   * output -> main (invoke): perform one unattended provocation. Attribution
   * runs only — a gate run never sends this. The renderer owns the schedule
   * because it owns the post-warmup clock every other timestamp is on.
   */
  provoke: 'run:provoke',
  /**
   * P5-E. editor -> main -> output: one output-window shortcut, by key identity.
   *
   * The projector display runs `cursor: none` and is usually not the focused
   * window, so the operator cannot press `h` at it without first clicking a
   * display where the pointer is invisible. This channel is the way the editor
   * presses it for them.
   *
   * **Key identity and nothing else** (I-7). The payload is `{ key }` — one
   * character out of `OUTPUT_SHORTCUTS`. It is not a command, not an action id
   * and not a state: the output decides what a key means, exactly as it does
   * when the key is pressed at its own window, so the two paths cannot come to
   * disagree about what `h` does.
   */
  outputKey: 'output:key',
} as const;

/** SPEC.md I-8: hierarchical key. Registered in `parameters.ts` in Phase 1 (§0.2). */
export const PARAM_TEST_PATTERN_SPEED = 'debug.testPattern.speed';

/**
 * P5-E. The output window's shortcuts, as ONE table.
 *
 * Two paths can fire one of these — the output window's own `keydown`
 * listener, and the editor forwarding over `CH.outputKey` — and this array is
 * the only place either one learns what the keys are. The editor forwards
 * whatever is in it; the output dispatches through a
 * `Record<OutputShortcutAction, () => void>`, so a row added here fails to
 * compile until the output has a handler for it.
 *
 * That is the mechanism the block asked for rather than a guard: there is no
 * state in which one path knows a key the other does not, because neither path
 * holds a list of its own to fall out of step with.
 *
 * Keys are lowercase; matching is case-insensitive, so shift-h works at either
 * window as it always has.
 */
export const OUTPUT_SHORTCUTS = [
  { key: 'h', action: 'hud', label: 'HUD' },
  { key: 'r', action: 'resetMetrics', label: 'reset metrics window' },
  { key: 'k', action: 'probeK', label: 'k probe' },
] as const;

export type OutputShortcut = (typeof OUTPUT_SHORTCUTS)[number];
export type OutputShortcutKey = OutputShortcut['key'];
/** What the output DOES. Never crosses IPC — the wire carries the key (I-7). */
export type OutputShortcutAction = OutputShortcut['action'];

/**
 * The shortcut a keystroke names, or null.
 *
 * Case-insensitive, so shift-H works. Named keys fall out on their own — no
 * `length` guard, because `'Enter'.toLowerCase()` is in the table exactly as
 * often as `'q'` is, and a guard that can never be the reason for a `null` is
 * a branch nothing can test.
 */
export function outputShortcutFor(key: string): OutputShortcut | null {
  const lower = key.toLowerCase();
  return OUTPUT_SHORTCUTS.find((s) => s.key === lower) ?? null;
}

/** Key identity, and deliberately nothing else. */
export interface OutputKeyPress {
  key: OutputShortcutKey;
}

/** A payload that did not come from a build this one understands. */
export class OutputKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputKeyError';
  }
}

/**
 * The validation boundary for `CH.outputKey`, on the receiving side.
 *
 * Returns a FRESH object carrying `key` alone. Anything else the sender
 * attached — including something that would fail the I-7 guard — is not
 * copied, so "the channel carries key identity only" is a property of this
 * function rather than a promise made by the sender.
 *
 * An unrecognised key is REFUSED and named, not ignored: a key this build has
 * no handler for means the message came from one that does, and the project
 * settled at P5-A that an unknown enum value is refused while float drift is
 * clamped.
 */
export function canonicalizeOutputKeyPress(v: unknown): OutputKeyPress {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new OutputKeyError(`output key press: expected an object, got ${describe(v)}`);
  }
  const key = (v as { key?: unknown }).key;
  if (typeof key !== 'string') {
    throw new OutputKeyError(`output key press: key must be a string, got ${describe(key)}`);
  }
  const shortcut = outputShortcutFor(key);
  if (!shortcut) {
    throw new OutputKeyError(
      `output key press: unknown shortcut "${key}" — this build knows ` +
        OUTPUT_SHORTCUTS.map((s) => s.key).join(', '),
    );
  }
  return { key: shortcut.key };
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return typeof v;
}

/**
 * The scene, unvalidated. Typed as `unknown` on purpose: this module is
 * dependency-free so main and both renderers can import it, and `Scene` lives
 * in `src/core/scene.ts`. The receiving renderer runs `canonicalizeScene()`,
 * which is the validation boundary that module exists to be — so a malformed
 * scene is refused where it can be refused loudly, not typed away here.
 */
export interface SceneSet {
  scene: unknown;
}

/** I-13: what the output is showing as broken, mirrored into the layer list. */
/**
 * The wire shape of one viewport's calibration. Structural and JSON-only (I-7):
 * main relays it without understanding it, and the renderer canonicalizes on
 * receipt exactly as it does for a scene. `corners` is TL, TR, BR, BL in
 * normalized [0,1] output space (I-1) — no pixels cross this channel either.
 */
export interface CalibrationSet {
  viewportId: string;
  enabled: boolean;
  corners: { x: number; y: number }[];
}

/**
 * I-2's state, on the wire. Mirrors `ClockTransport` in `src/core/clock.ts`,
 * which this dependency-free module cannot import — the receiving renderer runs
 * `canonicalizeClockTransport()`, which is the validation boundary.
 */
export interface ClockSet {
  timeMs: number;
  playing: boolean;
  rate: number;
  /**
   * Increments only when the operator moves time. The receiver applies
   * `timeMs` when this is new to it and ignores it otherwise — see
   * `ClockTransport` in `src/core/clock.ts` for the defect this exists to
   * prevent, which is a show that jumps to its start on a rate nudge.
   */
  scrubSeq: number;
}

export interface SceneFailure {
  layerId: string;
  layerName: string;
  providerId: string;
  reason: string;
}

export interface ParamSet {
  key: string;
  value: number;
  /** Round-trip correlation id. */
  token: number;
  /** Editor-local `performance.now()` at send. Only the editor interprets it. */
  t0: number;
}

export interface ParamAck {
  token: number;
  t0: number;
}

/**
 * A11: SPEC.md §4 records two latency figures and never conflates them.
 * Transport is the one that moves under load; presented is conservative by one
 * frame by construction. This is the transport half.
 */
export type ParamRecv = ParamAck;

/** A11, SPEC.md §4: transport latency gate, p95. */
export const TRANSPORT_GATE_MS = 5;
/** A11, SPEC.md §4: presented round-trip gate, p95. Four frames at 60 Hz. */
export const PRESENTED_GATE_MS = 66;

export interface OutputConfig {
  width: number;
  height: number;
  /** Read from `Display.displayFrequency` — never assumed (SPEC.md §4). */
  displayFrequency: number;
  /** Device pixel ratio of the target display. */
  scaleFactor: number;
  /** True when the frame-rate cap was disabled at launch (ADD-2). */
  uncapped: boolean;
  /** Which window this is; the preview is an approximation, not a mirror (I-7). */
  role: 'output' | 'preview';
  /** Persisted HUD visibility (SPEC.md §7 `config/`). Off by default (C4). */
  hudVisible: boolean;
  /**
   * Unattended measurement run: a label, or '' for normal interactive use.
   * The run enables the HUD, resets the window, waits out §4's warmup plus
   * measurement window untouched, emits a structured summary, probes k, quits.
   */
  measureLabel: string;
  /**
   * Post-warmup seconds at which to show an on-wall cue. Used only by the
   * operator-driven disturbance run, where the point is a timed interruption.
   */
  measureCues: number[];
  /**
   * Unattended provocations, fired by the harness with no human involved.
   * Empty for every gate run — a run carrying these is an attribution run and
   * its M1 numbers describe the provocation, not the engine.
   */
  provocations: ProvocationSpec[];
  /**
   * §8.2's soak, in minutes. 0 is the ordinary §4 protocol window, untouched —
   * a gate run and a soak run must not be confusable for one another.
   */
  soakMinutes: number;
  /**
   * Which named scene to open at, or '' for the build's default.
   *
   * Added in Phase 3, because §4's protocol says a run happens "at the phase's
   * stated layer load" and the harness had no way to reach one: every
   * unattended run opened on Phase 1's default scene, which was the correct
   * load right up until it was not. A gate number measured on the wrong scene
   * is worse than no number, and nothing in the summary would have said so.
   *
   * Reaches BOTH windows. The editor opens on it too rather than the output
   * pinning it, so the two windows agree the ordinary way instead of the output
   * learning to ignore scene messages during a measurement — a special case
   * there would be a code path that only ever runs when a gate is being judged.
   */
  sceneId: string;
  /**
   * Run the unattended transport exercise during the settle period
   * (`PROJENGINE_TRANSPORT=1`). Pause, scrub, resume, rate 0, rate 1, scrub.
   *
   * Added in Phase 3 because the clock had never been paused in any run the
   * project had taken — so `VideoView`'s pause branch had never executed
   * outside a unit test. It runs well before §4's window and perturbs no gate
   * number; what it produces is `[clock]` and `[video]` lines that say whether
   * the decoder actually obeyed.
   */
  transportExercise: boolean;
  /** Captured once at run start, reported in the summary. */
  conditions: RunConditions | null;
}

/**
 * The conditions a run was made under, captured by the app rather than
 * reconstructed afterwards.
 *
 * This exists because run5-mc's null result could not be interpreted: whether
 * `Displays have separate Spaces` was on decided whether the run had tested its
 * mechanism at all, and the answer had to be recovered from `defaults read`
 * after the fact. Same class as A9 and A14 — an instrument that cannot see the
 * conditions it measured under cannot say what it measured.
 */
export interface RunConditions {
  platform: string;
  /** Raw `com.apple.spaces spans-displays`: '0', '1', or 'absent'. macOS only. */
  spansDisplaysRaw: string;
  /**
   * True when each display has its own Spaces. macOS defaults to on, which is
   * `spans-displays` absent or 0; the key is only written once toggled.
   * Null off darwin.
   */
  separateSpaces: boolean | null;
  /** The output window's `hiddenInMissionControl`, read from the window itself. */
  hiddenInMissionControl: boolean | null;
  /** Attached displays at run start. */
  displayCount: number;
  outputDisplay: {
    id: number;
    label: string;
    width: number;
    height: number;
    scaleFactor: number;
    displayFrequency: number;
    internal: boolean;
    isPrimary: boolean;
  } | null;
  /** False means the window is framed — a stale pin or an unconfirmed display. */
  outputFullscreen: boolean;
  /** A13: `PINNED (...)` or `HEURISTIC (...)`, verbatim from the picker. */
  pin: string;
}

/**
 * Unattended provocations for an attribution run. Each one drives a real OS
 * event from the harness itself, so no human presses a key and no human reports
 * what they saw.
 *
 * - `hide` / `apphide` — genuine surface suspend/resume, the positive controls.
 *   If these produce no stall beyond the deliberate gap, surface suspend/resume
 *   is not the mechanism regardless of what triggers it.
 * - `mc` — Mission Control in the shipping configuration.
 * - `mcvisible` — Mission Control with `hiddenInMissionControl` temporarily
 *   cleared, which is the only way to tell that flag's effect apart from a
 *   Spaces setting without a second binary.
 */
export type ProvocationKind =
  | 'hide'
  | 'apphide'
  | 'mc'
  | 'mcvisible'
  /**
   * The control that isolates the variable. `backgroundThrottling: false` has
   * been set on the output window since the first scaffold commit, and Electron
   * documents that it "also affects the Page Visibility API" — so it is the
   * candidate explanation for why `hide`, `apphide`, `mc` and `mcvisible` all
   * produced no suspend at all. These re-enable throttling for the duration of
   * the provocation, and are the only configurations in which a suspend should
   * be reachable.
   */
  | 'hidethrottled'
  | 'mcthrottled';

export interface ProvocationSpec {
  kind: ProvocationKind;
  /** Post-warmup seconds at which to fire. */
  atSeconds: number;
}

/**
 * What one provocation actually did, decided by the machine.
 *
 * `visibilityHidden` is the ground truth for "the surface really suspended" —
 * the renderer's `visibilitychange` listener demonstrably fires on a real
 * surface hide and did not fire in run5-mc.
 */
export interface ProvocationVerdict {
  kind: ProvocationKind;
  requestedAtSeconds: number;
  /** Did the surface genuinely suspend? The whole experiment turns on this. */
  visibilityHidden: boolean;
  focusLost: boolean;
  /** Longest presentation interval inside the provocation window, ms. */
  maxIntervalMs: number;
  /** Clause-3 events inside the window — the deliberate gap included. */
  clause3InWindow: number;
  /**
   * The first intervals after the surface came back. This is the number that
   * separates "the gap we asked for" from "a resume cost we did not" — a
   * suspend of D ms yields one interval of ~D by construction, so only what
   * follows it can attribute a stall to resume.
   */
  intervalsAfterResume: number[];
  /** Anything the main process reported back about performing it. */
  note: string;
}

/**
 * A12: a presentation interval over 3 x N. Rate and magnitude are separate
 * facts, so these are carried individually and attributed in `BUILD_LOG.md`.
 */
export interface MagnitudeEvent {
  /** Post-warmup sample number, so a recurring hitch can be spotted by its n. */
  index: number;
  /** The offending interval, ms. */
  intervalMs: number;
  /** Seconds since the measurement window opened. */
  atSeconds: number;
}

/**
 * A8: the render-multiplier probe. `k` is how many times the current scene fits
 * into one frame interval at a given resolution, GPU included.
 */
export interface KReport {
  /** k at DEV_RESOLUTION (1280x720). */
  dev: number;
  /** k against an offscreen 1920x1080 RenderTexture. */
  target: number;
  /** k_dev / k_target — the measured fill-rate coefficient. */
  ratio: number;
  /** Per-render cost behind k_dev, ms, GPU sync included. */
  devMs: number;
  /** Per-render cost behind k_target, ms, GPU sync included. */
  targetMs: number;
  /** Renders per resolution in the probe burst. */
  iterations: number;
  /**
   * How many repeats the medians above were taken from (A8, Phase 3).
   *
   * Eight single-repeat samples across Phases 1 and 2 spanned 0.9262-1.3269
   * against a theoretical 2.25 fill-bound / 1.0 CPU-bound. A point estimate
   * from that distribution is not a measurement, and the thermal derate A1
   * asks for is a DELTA between two such points — so the probe now reports a
   * median and the spread it came from, and a reader can see whether a derate
   * is bigger than the instrument's own noise before believing it.
   */
  repeats: number;
  /**
   * Bursts (of `repeats * 2`) that measured nothing and were discarded (A9).
   *
   * A burst whose `iterations` renders time no slower than its single render
   * has produced no signal, and averaging the resulting 0 into a median gives a
   * confident wrong k. Counted rather than silently dropped: a probe that threw
   * most of its samples away is reporting on very little, and the reader
   * deserves to know before quoting the number.
   */
  discarded: number;
  /** Min and max k_dev across the repeats. */
  devMin: number;
  devMax: number;
  /** Min and max k_target across the repeats. */
  targetMin: number;
  targetMax: number;
  /**
   * `(devMax - devMin) / devMedian` — the probe's own dispersion, as a
   * fraction. Any derate smaller than this is noise, and saying so is the
   * point of reporting it beside the value rather than in a comment.
   */
  devSpread: number;
  targetSpread: number;
  /**
   * What was rendered. `composite` is the compositor's own container;
   * `stage` is the whole Pixi stage.
   *
   * Recorded because the probe measured `app.stage` through Phases 0-2, and
   * with the warp enabled the stage holds the MESH rather than the scene — so
   * k_dev read 42-50 warp-off against 90-96 warp-on, which is not a speedup,
   * it is a different subject. Any k compared against another k must agree on
   * this field.
   */
  subject: 'composite' | 'stage';
}

/**
 * §8.2: managed GPU resources, for the "texture memory flat over a soak"
 * rolling check. Named `gpu` and not `texture` deliberately — Phase 1 has no
 * textures at all, and what it allocates and frees is geometry and buffers.
 */
export interface GpuResources {
  valid: boolean;
  invalidReason: string;
  textureCount: number;
  textureBytesEstimate: number;
  bufferCount: number;
  geometryCount: number;
}

/**
 * A3: scaleFactor is a first-class concern. One backing-store pixel must land
 * on exactly one panel pixel, or something between us and the wall is scaling.
 */
export interface ScaleReport {
  /** Pixi backing store, device pixels. */
  bufferWidth: number;
  bufferHeight: number;
  /** The CSS box the canvas occupies. */
  cssWidth: number;
  cssHeight: number;
  /** `window.devicePixelRatio` in the window holding the canvas. */
  dpr: number;
  /** True when buffer == css x dpr on both axes: no scaler in the path. */
  oneToOne: boolean;
}

/**
 * A14: the measurement apparatus is subject to the budget it measures, so it
 * reports its own cost rather than leaving it to be inferred from a stall.
 */
export interface InstrumentCost {
  /** Worst per-frame cost of the metrics call itself, ms. */
  perFrameMaxMs: number;
  /** Mean per-frame cost of the metrics call itself, ms. */
  perFrameMeanMs: number;
  /** Cost of one report + format + DOM write tick, ms. */
  tickMs: number;
  /** `perFrameMaxMs` as a share of N. Anything visible here is a problem. */
  maxShareOfNominal: number;
}

export interface MetricsReport {
  /** Nominal frame interval N in ms, derived from `displayFrequency`. */
  nominalMs: number;
  /**
   * A9: false when N is unset, zero, or outside a plausible display-mode range.
   * Every derived figure below is then meaningless and must not be recorded.
   */
  valid: boolean;
  /** A9: why the report is invalid; empty string when valid. */
  invalidReason: string;
  /** Gate metric 1: share of presentation intervals over 1.5 x N, as a fraction. */
  lateFraction: number;
  /** Gate metric 1: longest run of consecutive late presentations. */
  worstLateRun: number;
  /** A12, gate metric 1 clause 3: intervals over 3 x N, each needing attribution. */
  magnitudeEvents: MagnitudeEvent[];
  /** A10: gate metric 2 gates on p99, ms. */
  renderP99Ms: number;
  /** A10: gate metric 2 as a share of N. Gate is <= 0.60. */
  renderP99OfNominal: number;
  /** A10: p95 is retained but informational — it is blind to M1's permitted tail. */
  renderP95Ms: number;
  renderP95OfNominal: number;
  /**
   * INFORMATIONAL, never a gate. A10 stands: gate metric 2 reads p99.
   *
   * `performance.now()` is coarsened to 100 us in Electron, so every render
   * duration is a multiple of 0.1 ms and both percentiles sit pinned at exactly
   * two quanta on any light scene — measured across three separate Phase 2
   * runs, warp off and warp on, all reporting the identical 0.200 ms. A
   * percentile of quantized samples cannot resolve a change smaller than one
   * quantum, which made "what does the warp stage cost?" unanswerable with the
   * statistics that existed.
   *
   * A mean over a full 3601-sample window averages the quantization out and
   * resolves to roughly a thousandth of a quantum. It is added for that
   * question and reported beside p99, never instead of it.
   */
  renderMeanMs: number;
  renderMeanOfNominal: number;
  /** Observed presentation rate, fps. */
  fps: number;
  /** Samples in the current window, after warmup. */
  samples: number;
  /** True once the 10-second warmup has been discarded (SPEC.md §4). */
  warmedUp: boolean;
  /** Informational, not gated: worst post-warmup interval in the window. */
  worstIntervalMs: number;
  /**
   * Seconds of samples the WINDOWED figures actually describe.
   *
   * Samples are evicted on a rolling 60-second window because that is §4's
   * gate window, so on a gate run this equals the run. On §8.2's 20-minute
   * soak it is still ~60 — `lateFraction`, `worstLateRun`, the percentiles and
   * the clause-3 LIST all describe the final minute, not the soak. Reported
   * because a summary that says `m1Pass: true` for a 20-minute run had better
   * say how much of it M1 looked at.
   */
  coveredSeconds: number;
  /**
   * Total intervals over 3 x N since reset — including ones evicted from the
   * list above, and ones past its length cap.
   *
   * §4 requires every such interval to be attributed in `BUILD_LOG.md`. An
   * event the report never mentions cannot be attributed, so the COUNT is kept
   * even where the detail is not.
   */
  magnitudeEventsLifetime: number;
  /** A8: null until the probe is run. */
  k: KReport | null;
  /** A3: null until the renderer reports its geometry. */
  scale: ScaleReport | null;
  /** §8.2: null until sampled. */
  gpu: GpuResources | null;
  /** A14: what the instrument itself costs. */
  instrument: InstrumentCost;
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  displayFrequency: number;
  internal: boolean;
  detected: boolean;
  isPrimary: boolean;
  isSelected: boolean;
}

/**
 * I-7, mechanised. Throws on anything that is not plain JSON — the point is that
 * a pixel buffer cannot cross this boundary even by accident.
 *
 * Returns the value so it can be used inline at a send site.
 */
export function assertJsonOnly<T>(value: T, path = 'payload'): T {
  walk(value, path, new Set());
  return value;
}

function walk(v: unknown, path: string, seen: Set<object>): void {
  if (v === null) return;
  const t = typeof v;
  if (t === 'boolean' || t === 'string') return;
  if (t === 'number') {
    if (!Number.isFinite(v as number)) {
      throw new TypeError(`${path}: ${String(v)} is not JSON-representable`);
    }
    return;
  }
  if (t === 'undefined') throw new TypeError(`${path}: undefined is not JSON`);
  if (t === 'function') throw new TypeError(`${path}: functions cannot cross IPC`);
  if (t === 'symbol') throw new TypeError(`${path}: symbols cannot cross IPC`);
  if (t === 'bigint') throw new TypeError(`${path}: bigint is not JSON-representable`);

  const o = v as object;
  if (seen.has(o)) throw new TypeError(`${path}: circular reference`);
  seen.add(o);

  // The whole reason this function exists (I-7).
  if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer) {
    throw new TypeError(`${path}: pixel/binary buffers must not cross IPC (I-7)`);
  }
  if (Array.isArray(o)) {
    o.forEach((item, i) => walk(item, `${path}[${i}]`, seen));
    seen.delete(o);
    return;
  }
  const proto = Object.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(
      `${path}: only plain objects cross IPC, got ${proto?.constructor?.name ?? 'unknown'}`,
    );
  }
  for (const [k, val] of Object.entries(o)) walk(val, `${path}.${k}`, seen);
  seen.delete(o);
}
