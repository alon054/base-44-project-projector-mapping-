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
import { RenderTexture, type Container, type Renderer } from 'pixi.js';
import type { KReport } from '@shared/ipc';
import { validateNominal } from './hud';

/** Renders per burst. Large enough to amortize noise, short enough to not hitch. */
export const PROBE_ITERATIONS = 32;

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
): number {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    renderer.render({ container, target });
  }
  // Forces the GPU to finish. Without it the loop above times command
  // submission only, which is the CPU-blindness this probe exists to fix.
  renderer.extract.pixels(target);
  return performance.now() - t0;
}

function measure(
  renderer: Renderer,
  container: Container,
  width: number,
  height: number,
  iterations: number,
): number {
  const rt = RenderTexture.create({ width, height, resolution: 1 });
  try {
    // Discarded: shader compilation and first-use allocation are not render cost.
    timeBurst(renderer, container, rt, 1);
    const one = timeBurst(renderer, container, rt, 1);
    const many = timeBurst(renderer, container, rt, iterations);
    return perRenderFromBurst(one, many, iterations);
  } finally {
    rt.destroy(true);
  }
}

export interface ProbeOptions {
  nominalMs: number;
  dev: { width: number; height: number };
  target: { width: number; height: number };
  iterations?: number;
  /** Which resolution is measured first. Exists to expose order bias. */
  order?: 'dev-first' | 'target-first';
}

/**
 * Run both probes. Costs a visible hitch, so the caller resets the measurement
 * window afterwards rather than letting the probe pollute a gate run.
 */
export function runRenderMultiplierProbe(
  renderer: Renderer,
  container: Container,
  opts: ProbeOptions,
): KReport {
  const iterations = opts.iterations ?? PROBE_ITERATIONS;
  const devFirst = (opts.order ?? 'dev-first') === 'dev-first';
  let devMs: number;
  let targetMs: number;
  if (devFirst) {
    devMs = measure(renderer, container, opts.dev.width, opts.dev.height, iterations);
    targetMs = measure(renderer, container, opts.target.width, opts.target.height, iterations);
  } else {
    targetMs = measure(renderer, container, opts.target.width, opts.target.height, iterations);
    devMs = measure(renderer, container, opts.dev.width, opts.dev.height, iterations);
  }
  const dev = computeK(opts.nominalMs, devMs);
  const target = computeK(opts.nominalMs, targetMs);
  return {
    dev,
    target,
    ratio: target > 0 ? dev / target : 0,
    devMs,
    targetMs,
    iterations,
  };
}
