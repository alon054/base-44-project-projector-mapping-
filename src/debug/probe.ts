/**
 * A8: the render-multiplier probe.
 *
 * SPEC.md §4's gate metric 2 times *CPU* render duration. Fill-rate work scales
 * ~2.25x from 720p to 1080p while per-layer CPU work barely scales at all, so
 * M2 is structurally blind to exactly the resolution change it was designated
 * to guard. We do not need a 1080p projector to measure 1080p fill rate — we
 * need a 1080p framebuffer.
 *
 * `k` is how many times the current scene fits into one frame interval at a
 * given resolution. `k_dev` is measured at DEV_RESOLUTION, `k_target` against
 * an offscreen 1920x1080 RenderTexture, and the ratio is the measured
 * fill-rate coefficient. Informational through Phase 8; whether a minimum
 * `k_target` belongs in the gate is a Phase 9 decision.
 *
 * The probe is on-demand, never continuous: it saturates the GPU by design and
 * would corrupt the very metrics it sits beside.
 */
import { Rectangle, RenderTexture, type Container, type Renderer } from 'pixi.js';

/** The 1x1 region read back to force a GPU sync. See `timeBurst`. */
const SYNC_PIXEL = new Rectangle(0, 0, 1, 1);
import type { KReport } from '@shared/ipc';
import { validateNominal } from './hud';

/**
 * Renders per burst.
 *
 * Raised from 32 in Phase 3. The measured quantity is `many - one` against a
 * FIXED readback cost, so the readback's own jitter is the noise floor and the
 * only way to lift the signal above it is more renders per burst. At 32 the
 * 1080p probe produced samples where 32 renders timed no slower than 1 —
 * `perRenderFromBurst` correctly returned 0, and a k of 0 then sat in the
 * distribution as though it were a measurement.
 */
export const PROBE_ITERATIONS = 96;

/**
 * Cost of one render, with the fixed GPU-sync readback cancelled out.
 *
 * A single burst cannot be divided by its iteration count: the readback that
 * forces the GPU to finish is a large fixed cost that would be smeared across
 * every iteration and would shrink as the count grew. Timing one render and
 * many renders against the same readback subtracts it exactly.
 */
export function perRenderFromBurst(
  oneMs: number,
  manyMs: number,
  iterations: number,
): number {
  if (iterations < 2) return 0;
  const per = (manyMs - oneMs) / (iterations - 1);
  return per > 0 ? per : 0;
}

/**
 * How many times the scene fits into one frame interval. 0 when either input is
 * unusable — A9: no metric renders a number from unvalidated inputs.
 */
export function computeK(nominalMs: number, perRenderMs: number): number {
  if (!validateNominal(nominalMs).valid) return 0;
  if (!Number.isFinite(perRenderMs) || perRenderMs <= 0) return 0;
  return nominalMs / perRenderMs;
}

function timeBurst(
  renderer: Renderer,
  container: Container,
  target: RenderTexture,
  iterations: number,
  now: () => number,
): number {
  const t0 = now();
  for (let i = 0; i < iterations; i++) {
    renderer.render({ container, target });
  }
  // Forces the GPU to finish. Without it the loop above times command
  // submission only, which is the CPU-blindness this probe exists to fix.
  //
  // ONE PIXEL, not the whole target. A `glReadPixels` synchronises the pipeline
  // for the bound framebuffer whatever its size, so a 1x1 read forces the same
  // finish while transferring 4 bytes instead of 8 MB at 1920x1080. The full
  // readback made the fixed cost this function is built to cancel both large
  // AND variable, and its variance landed directly in the probe's spread.
  renderer.extract.pixels({ target, frame: SYNC_PIXEL });
  return now() - t0;
}

/**
 * One per-render measurement against an ALREADY-ALLOCATED render texture.
 *
 * The texture is passed in rather than created here, and that is a spread fix
 * rather than tidiness: the first version allocated and destroyed a
 * 1920x1080 RGBA target (8 MB) on every repeat, so each sample carried a
 * driver-side allocate/free of its own. Allocating once and reusing it across
 * the repeats removes that from the variance the repeats are trying to measure.
 */
function measure(
  renderer: Renderer,
  container: Container,
  rt: RenderTexture,
  iterations: number,
  now: () => number,
): number {
  const one = timeBurst(renderer, container, rt, 1, now);
  const many = timeBurst(renderer, container, rt, iterations, now);
  return perRenderFromBurst(one, many, iterations);
}

/**
 * Repeats per probe run. Each repeat alternates which resolution goes first.
 *
 * Five, and odd on purpose: the median of an odd count is a measured sample
 * rather than the mean of two, so `k_dev` is always a number the instrument
 * actually produced. Larger would narrow the spread further and costs a longer
 * hitch — the probe saturates the GPU by design, and it is run twice in a
 * 20-minute measurement run (A1's minute-1 and minute-20 readings).
 */
export const PROBE_REPEATS = 5;

export interface ProbeOptions {
  nominalMs: number;
  dev: { width: number; height: number };
  target: { width: number; height: number };
  iterations?: number;
  /**
   * Which resolution is measured first ON THE FIRST REPEAT. Subsequent repeats
   * ALTERNATE, which is the fix for the order bias Gate 0 measured directly:
   * an order-alternating bench gave 2.800 / 0.696 / 1.273 / 1.500 on an
   * unchanged scene. Whatever that bias is — cache state, clock ramp, driver
   * warm-up — alternating cancels its first-order term instead of leaving it
   * to be argued about.
   */
  order?: 'dev-first' | 'target-first';
  /** Defaults to `PROBE_REPEATS`. 1 reproduces the Phase 0-2 behaviour. */
  repeats?: number;
  /** What the caller handed us, recorded in the report. */
  subject?: 'composite' | 'stage';
  /**
   * The instrument's clock. Defaults to `performance.now()`, which in a
   * renderer is coarsened to 100 us — see `debug/clock-source.ts`. The probe's
   * bursts are milliseconds long so quantisation is not its dominant error,
   * but there is no reason to time them with the blunter of two available
   * clocks.
   */
  now?: () => number;
}

/**
 * A9 — the fraction of repeats that must yield a usable sample before the probe
 * reports a number at all.
 *
 * "An instrument that emits a plausible wrong number is worse than one that
 * fails loudly." A burst whose 96 renders time no slower than its 1 render has
 * measured nothing; averaging that 0 into a median produces a confident,
 * precise, wrong k. Below this fraction the probe reports 0, which every
 * consumer already treats as INVALID.
 */
export const PROBE_MIN_VALID_FRACTION = 0.6;

/** Median of a non-empty list. Odd counts return a real sample (see PROBE_REPEATS). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : (((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

/** `(max - min) / median`, or 0 when there is nothing to disperse. */
export function spreadOf(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = median(values);
  if (!(m > 0)) return 0;
  return (Math.max(...values) - Math.min(...values)) / m;
}

/**
 * Run both probes, `repeats` times, alternating order, and report medians with
 * the spread they came from.
 *
 * Costs a visible hitch by design, so the caller resets the measurement window
 * afterwards rather than letting the probe pollute a gate run.
 *
 * **The caller must hand this the COMPOSITE, not the stage.** Through Phases
 * 0-2 the host passed `app.stage`, and once the warp stage existed the stage
 * held the mesh rather than the scene: k_dev read 42-50 warp-off against 90-96
 * warp-on. That is not a speedup, it is a different subject, and the two sets
 * of numbers were never comparable. `subject` is recorded so a later reader can
 * tell which kind of number they are holding.
 */
export function runRenderMultiplierProbe(
  renderer: Renderer,
  container: Container,
  opts: ProbeOptions,
): KReport {
  const iterations = opts.iterations ?? PROBE_ITERATIONS;
  const repeats = Math.max(1, Math.floor(opts.repeats ?? PROBE_REPEATS));
  const startDevFirst = (opts.order ?? 'dev-first') === 'dev-first';
  const now = opts.now ?? ((): number => performance.now());

  // Allocated ONCE for the whole run. See `measure`.
  const devRt = RenderTexture.create({
    width: opts.dev.width,
    height: opts.dev.height,
    resolution: 1,
  });
  const targetRt = RenderTexture.create({
    width: opts.target.width,
    height: opts.target.height,
    resolution: 1,
  });

  const devMsSamples: number[] = [];
  const targetMsSamples: number[] = [];
  try {
    // Discarded. Shader compilation and first-use allocation are not render
    // cost, and they are large — leaving them in the first repeat would put a
    // one-off into a distribution the caller is asked to read as dispersion.
    //
    // A FULL burst per texture, not a single render. A single render warms the
    // shader cache but not the GPU's clock state or the driver's command
    // path, and the cold probe's first repeats were visibly slower than its
    // last — 82% dispersion cold against 27% warm on the same scene, which is
    // a warm-up ramp inside the probe rather than a property of the scene.
    timeBurst(renderer, container, devRt, iterations, now);
    timeBurst(renderer, container, targetRt, iterations, now);

    for (let r = 0; r < repeats; r++) {
      // Alternates every repeat. With an odd count the first order is used one
      // more time than the other, which is why the SPREAD is reported rather
      // than only the median — a residual bias shows up as width.
      const devFirst = r % 2 === 0 ? startDevFirst : !startDevFirst;
      if (devFirst) {
        devMsSamples.push(measure(renderer, container, devRt, iterations, now));
        targetMsSamples.push(measure(renderer, container, targetRt, iterations, now));
      } else {
        targetMsSamples.push(measure(renderer, container, targetRt, iterations, now));
        devMsSamples.push(measure(renderer, container, devRt, iterations, now));
      }
    }
  } finally {
    devRt.destroy(true);
    targetRt.destroy(true);
  }

  // A9: a burst that measured nothing is DISCARDED, not averaged in. It is
  // counted, so a reader can see how much of the probe actually worked rather
  // than inferring it from a suspiciously round number.
  const usableDevMs = devMsSamples.filter((ms) => ms > 0);
  const usableTargetMs = targetMsSamples.filter((ms) => ms > 0);
  const discarded = repeats * 2 - usableDevMs.length - usableTargetMs.length;
  const enough = (n: number): boolean => n >= Math.ceil(repeats * PROBE_MIN_VALID_FRACTION);

  const devKs = usableDevMs.map((ms) => computeK(opts.nominalMs, ms));
  const targetKs = usableTargetMs.map((ms) => computeK(opts.nominalMs, ms));
  const dev = enough(devKs.length) ? median(devKs) : 0;
  const target = enough(targetKs.length) ? median(targetKs) : 0;

  return {
    dev,
    target,
    ratio: dev > 0 && target > 0 ? dev / target : 0,
    devMs: usableDevMs.length > 0 ? median(usableDevMs) : 0,
    targetMs: usableTargetMs.length > 0 ? median(usableTargetMs) : 0,
    iterations,
    repeats,
    discarded,
    devMin: devKs.length > 0 ? Math.min(...devKs) : 0,
    devMax: devKs.length > 0 ? Math.max(...devKs) : 0,
    targetMin: targetKs.length > 0 ? Math.min(...targetKs) : 0,
    targetMax: targetKs.length > 0 ? Math.max(...targetKs) : 0,
    devSpread: spreadOf(devKs),
    targetSpread: spreadOf(targetKs),
    subject: opts.subject ?? 'stage',
  };
}
