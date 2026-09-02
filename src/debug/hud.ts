/**
 * I-11: the frame budget is visible from Phase 0.
 *
 * `FrameMetrics` is pure logic with no DOM and no Pixi, so SPEC.md §4's two gate
 * metrics are unit-testable rather than eyeballed (§8.1). `Hud` is the overlay.
 *
 * The overlay is DOM, not Pixi, on purpose: a Pixi-drawn HUD would be inside the
 * measured `renderer.render()` call and would inflate gate metric 2 with the
 * cost of the instrument.
 */
import type { MetricsReport } from '@shared/ipc';

/** SPEC.md §4: the first 10 seconds are discarded. */
export const WARMUP_MS = 10_000;
/** SPEC.md §4: a 60-second continuous measurement window. */
export const WINDOW_MS = 60_000;
/** SPEC.md §4 gate metric 1: an interval over 1.5 x N is "late". */
export const LATE_FACTOR = 1.5;
/** SPEC.md §4 gate metric 1: at most 5% of intervals may be late. */
export const MAX_LATE_FRACTION = 0.05;
/** SPEC.md §4 gate metric 1: zero runs of 3 or more consecutive late frames. */
export const MAX_LATE_RUN = 2;
/** SPEC.md §4 gate metric 2: render p95 must sit at or under 60% of N. */
export const MAX_RENDER_FRACTION = 0.6;

export interface FrameMetricsOptions {
  warmupMs?: number;
  windowMs?: number;
}

interface Sample {
  t: number;
  interval: number;
  render: number;
}

export class FrameMetrics {
  private readonly warmupMs: number;
  private readonly windowMs: number;
  private samples: Sample[] = [];
  private startedAt: number | null = null;
  private lastPresent: number | null = null;
  private pendingRender = 0;
  private worstInterval = 0;
  /** Informational, not gated (SPEC.md §4): hitches seen during warmup. */
  private warmupWorst = 0;

  constructor(
    private nominalMs: number,
    opts: FrameMetricsOptions = {},
  ) {
    this.warmupMs = opts.warmupMs ?? WARMUP_MS;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
  }

  /** N changes if the display mode changes; never assume it (SPEC.md §4). */
  setNominalMs(ms: number): void {
    if (ms > 0 && ms !== this.nominalMs) {
      this.nominalMs = ms;
      this.reset();
    }
  }

  get nominal(): number {
    return this.nominalMs;
  }

  reset(): void {
    this.samples = [];
    this.startedAt = null;
    this.lastPresent = null;
    this.worstInterval = 0;
    this.warmupWorst = 0;
  }

  /** Pixi CPU render duration for the frame about to be presented. */
  noteRenderDuration(ms: number): void {
    this.pendingRender = ms;
  }

  /** Call once per presented frame, with a monotonic clock reading. */
  notePresentation(now: number): void {
    this.startedAt ??= now;
    const prev = this.lastPresent;
    this.lastPresent = now;
    if (prev === null) return;

    const interval = now - prev;
    // Both endpoints must be past warmup. Testing only `now` lets an interval
    // that STARTED during warmup be counted as a gate sample — which is exactly
    // the startup hitch SPEC.md §4's warmup clause exists to exclude.
    if (prev - this.startedAt < this.warmupMs) {
      this.warmupWorst = Math.max(this.warmupWorst, interval);
      return;
    }

    this.samples.push({ t: now, interval, render: this.pendingRender });
    this.worstInterval = Math.max(this.worstInterval, interval);

    const cutoff = now - this.windowMs;
    if (this.samples.length > 0 && this.samples[0]!.t < cutoff) {
      let drop = 0;
      while (drop < this.samples.length && this.samples[drop]!.t < cutoff) drop++;
      this.samples = this.samples.slice(drop);
    }
  }

  get warmedUp(): boolean {
    return this.startedAt !== null && this.lastPresent !== null
      ? this.lastPresent - this.startedAt >= this.warmupMs
      : false;
  }

  /** Hitches during warmup — reported, never gated (SPEC.md §4). */
  get warmupWorstMs(): number {
    return this.warmupWorst;
  }

  report(): MetricsReport {
    const n = this.samples.length;
    const lateThreshold = this.nominalMs * LATE_FACTOR;

    let late = 0;
    let run = 0;
    let worstRun = 0;
    let elapsed = 0;
    for (const s of this.samples) {
      elapsed += s.interval;
      if (s.interval > lateThreshold) {
        late++;
        run++;
        worstRun = Math.max(worstRun, run);
      } else {
        run = 0;
      }
    }

    const renderP95 = percentile(
      this.samples.map((s) => s.render),
      0.95,
    );

    return {
      nominalMs: this.nominalMs,
      lateFraction: n > 0 ? late / n : 0,
      worstLateRun: worstRun,
      renderP95Ms: renderP95,
      renderP95OfNominal: this.nominalMs > 0 ? renderP95 / this.nominalMs : 0,
      fps: elapsed > 0 ? (n / elapsed) * 1000 : 0,
      samples: n,
      warmedUp: this.warmedUp,
      worstIntervalMs: this.worstInterval,
    };
  }
}

/** Nearest-rank p95. Empty input is 0, not NaN. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx]!;
}

/** SPEC.md §4 gate metric 1. */
export function passesPresentation(r: MetricsReport): boolean {
  return r.lateFraction <= MAX_LATE_FRACTION && r.worstLateRun <= MAX_LATE_RUN;
}

/** SPEC.md §4 gate metric 2 — the one that gets recorded. */
export function passesHeadroom(r: MetricsReport): boolean {
  return r.renderP95OfNominal <= MAX_RENDER_FRACTION;
}

export function formatReport(r: MetricsReport, uncapped: boolean): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const m1 = passesPresentation(r) ? 'PASS' : 'FAIL';
  const m2 = passesHeadroom(r) ? 'PASS' : 'FAIL';
  return [
    `${r.fps.toFixed(1)} fps   N=${r.nominalMs.toFixed(2)} ms${uncapped ? '  [UNCAPPED]' : ''}`,
    `M1 presentation ${m1}  late ${pct(r.lateFraction)} (<=5%)  worst run ${r.worstLateRun} (<=2)`,
    `M2 headroom     ${m2}  render p95 ${r.renderP95Ms.toFixed(2)} ms = ${pct(r.renderP95OfNominal)} of N (<=60%)`,
    `samples ${r.samples}  worst interval ${r.worstIntervalMs.toFixed(1)} ms  ${r.warmedUp ? 'warm' : 'WARMUP'}`,
  ].join('\n');
}

/** The output-window overlay. Off by default (C4); key-toggled. */
export class Hud {
  private readonly el: HTMLPreElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.style.cssText = [
      'position:fixed',
      'left:12px',
      'top:12px',
      'margin:0',
      'padding:8px 10px',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#7CFFB2',
      'background:rgba(0,0,0,.62)',
      'border:1px solid rgba(124,255,178,.35)',
      'border-radius:4px',
      'pointer-events:none',
      'white-space:pre',
      'z-index:10',
      'display:none',
    ].join(';');
    parent.appendChild(this.el);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  update(text: string): void {
    if (this.visible) this.el.textContent = text;
  }
}
