/**
 * I-5 — the final, isolated mapping stage.
 *
 * The composite is rendered to a `RenderTexture` and that texture is drawn on a
 * mesh whose four corners the operator drags. Nothing upstream knows this stage
 * exists: it takes a `Container` and a `Renderer` and touches no scene state,
 * no layer, and no provider. That direction of ignorance is the invariant, and
 * it is why this file imports nothing from `core/`.
 *
 * **Off means absent, not identity.** When the warp is disabled the source
 * container is a direct child of the stage and no render texture is in the
 * path at all — the exact Phase 1 pipeline, byte for byte. Gate 2's "disabling
 * warp changes nothing in the scene" is therefore structural rather than a
 * claim about floating point. A separate golden case covers the other half:
 * warp ON at identity corners must be pixel-identical to warp off, which is the
 * claim worth distrusting, because a half-pixel resample would put a blur on
 * the wall that the projector currently gets blamed for.
 *
 * **The perspective is projective, not affine.** A literal two-triangle quad
 * interpolates linearly and cannot square a keystone — it bends the diagonal,
 * and it would do so while every golden hash stayed green. PixiJS 8.20's
 * `PerspectiveMesh` computes the true homography from the four corners and
 * pushes vertex POSITIONS through it on a subdivided plane, so every vertex
 * lands exactly right and the only residual is affine interpolation of the
 * texture between vertices. `VERTICES` below buys that residual down; the
 * measured straight-line error is in BUILD_LOG.md rather than assumed here.
 */
import { Container, PerspectiveMesh, RenderTexture, Texture, type Renderer } from 'pixi.js';
import {
  describeCalibration,
  identityCorners,
  toPixelCorners,
  type ViewportCalibration,
} from './calibration';

/**
 * Subdivision of the warp mesh. NOT control points — the operator has exactly
 * four of those in Phase 2, and Phase 7 owns the N×M control grid. This is the
 * resolution at which the exact homography is sampled, and it is chosen from a
 * measurement rather than by feel (`src/test/warp.test.ts` recomputes it):
 *
 *   verticesX   max deviation from the exact projective map, Gate 2's keystone
 *   ---------   ---------------------------------------------------------------
 *          2      91.58 px   <- a bare quad. This is the affine bend, and it is
 *                               visible from across a room.
 *         10       1.63 px   <- PixiJS's default
 *         40       0.09 px   <- chosen
 *
 * On a deliberately harsh off-axis quad the same three are 166.08 / 4.48 /
 * 0.26 px, so the choice holds for warps well beyond the gate's.
 *
 * 40 rather than 20 (0.37 px) because the cost is close to zero and paid in the
 * wrong place to matter: the geometry is recomputed in `setCorners`, which runs
 * on a corner drag, not per frame. 1600 vertices is 26 KB and no extra
 * rasterization — the same pixels are covered either way.
 */
const VERTICES = 40;

/** Coalescing window for `[warp]` lines during a corner drag. */
const LOG_INTERVAL_MS = 250;

export interface WarpStageOptions {
  renderer: Renderer;
  /** What the warped mesh is added to. Usually `app.stage`. */
  stage: Container;
  /** The composite. Added to the stage directly whenever the warp is off. */
  source: Container;
  width: number;
  height: number;
  /** I-13: the warp failed and the stage fell back to a direct draw. Once. */
  onFallback?: (reason: string) => void;
  /** Emitted on every calibration change, mirroring `[scene] applied`. */
  log?: (line: string) => void;
}

export class WarpStage {
  private readonly renderer: Renderer;
  private readonly stage: Container;
  private readonly source: Container;
  private width: number;
  private height: number;
  private readonly onFallback: (reason: string) => void;
  private readonly log: (line: string) => void;

  private texture: RenderTexture | null = null;
  private mesh: PerspectiveMesh | null = null;
  private calibration: ViewportCalibration;
  /** Set once the stage has failed. It never retries inside a live session. */
  private broken = false;
  private lastLogged = '';
  private lastLogAt = 0;
  private trailingLog: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: WarpStageOptions) {
    this.renderer = opts.renderer;
    this.stage = opts.stage;
    this.source = opts.source;
    this.width = opts.width;
    this.height = opts.height;
    this.onFallback = opts.onFallback ?? (() => {});
    this.log = opts.log ?? ((line) => console.log(line));
    this.calibration = {
      viewportId: 'main',
      enabled: false,
      corners: identityCorners(),
    };
    this.stage.addChild(this.source);
  }

  /** True when the composite is actually going through the mesh this frame. */
  get active(): boolean {
    return this.calibration.enabled && !this.broken && this.mesh !== null;
  }

  /** True once the stage has failed and degraded to a direct draw (I-13). */
  get degraded(): boolean {
    return this.broken;
  }

  setCalibration(cal: ViewportCalibration): void {
    const prev = this.calibration;
    this.calibration = cal;
    if (cal.enabled) this.attach();
    else this.detach();
    this.applyCorners();

    // Logged on change, never per frame. This line is why a warp bug is
    // findable from a wall rather than arguable: Phase 1's `[scene] applied`
    // equivalent found three editor defects, and warp state is strictly harder
    // to read off a projection than draw order is.
    //
    // Corner moves are COALESCED, and that is not tidiness. A pointer drag
    // calls this at pointer-move rate: the first p2 measurement run recorded
    // ~300 `[warp]` lines from one drag, which buried `[scene] applied` and
    // every display event in the same log. A line nobody can find is not
    // instrumentation. Toggling and degrading are never coalesced — those are
    // state changes an operator needs to see the instant they happen.
    this.emit(!prev || prev.enabled !== cal.enabled);
  }

  /** ~4 Hz for corner moves, immediate for state changes, always trailing. */
  private emit(immediate: boolean): void {
    const line = `${describeCalibration(this.calibration)} mesh=${
      this.active ? `${VERTICES}x${VERTICES}` : 'bypassed'
    }${this.broken ? ' DEGRADED' : ''}`;
    if (line === this.lastLogged) return;

    const now = Date.now();
    if (immediate || now - this.lastLogAt >= LOG_INTERVAL_MS) {
      if (this.trailingLog !== null) {
        clearTimeout(this.trailingLog);
        this.trailingLog = null;
      }
      this.lastLogged = line;
      this.lastLogAt = now;
      this.log(line);
      return;
    }
    // A drag must not end on a stale line: the LAST position is the one the
    // operator will read off the log later, so a trailing emit is scheduled
    // rather than the move simply being dropped.
    if (this.trailingLog === null) {
      this.trailingLog = setTimeout(() => {
        this.trailingLog = null;
        this.emit(true);
      }, LOG_INTERVAL_MS - (now - this.lastLogAt));
    }
  }

  /**
   * Per frame, INSIDE the caller's timed region — the render-to-texture is the
   * warp stage's real cost and Gate 2 asks for it as a number, so it must not
   * sit outside the clock that produces §4's M2.
   */
  prepare(): void {
    if (!this.active || !this.texture) return;
    this.renderer.render({ container: this.source, target: this.texture, clear: true });
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    if (this.texture) {
      try {
        this.texture.resize(width, height, 1);
      } catch (err) {
        this.fail(`render texture resize failed: ${String(err)}`);
        return;
      }
    }
    this.applyCorners();
  }

  /**
   * Call this AFTER the renderer has gone, not before. See `release`.
   *
   * Safe to call when the Application has already destroyed the mesh as a
   * stage child, which is exactly what the documented order produces.
   */
  destroy(): void {
    this.release();
  }

  /**
   * Order matters, and the reason is in PixiJS rather than in us.
   *
   * A batched texture is held in `cachedGroups` in
   * `rendering/batcher/gpu/getTextureBatchBindGroup.mjs` — a MODULE-GLOBAL map
   * with no eviction and no public API to clear it. Destroying a texture that
   * has ever been batched therefore always logs
   * "[BindGroup] a 'textureSource' was destroyed while still bound to a shader",
   * and unbinding the mesh first does not help: measured, not assumed —
   * swapping in `Texture.EMPTY` and re-rendering before destroying left all
   * three warnings exactly where they were.
   *
   * What does work is destroying the renderer first. `BindGroup.destroy()`
   * drops its listeners, so the later texture teardown has nothing left to
   * warn about. So the render texture is released AFTER the Application, and
   * both call sites are written that way with this comment as the reason.
   *
   * Found by the golden harness, which treats renderer output as a failure
   * signal. Otherwise it would have been three quiet warnings a session and a
   * plausible suspect in the first soak that was not flat.
   */
  private release(): void {
    if (this.trailingLog !== null) {
      clearTimeout(this.trailingLog);
      this.trailingLog = null;
    }
    if (this.mesh && !this.mesh.destroyed) {
      if (this.mesh.parent) this.mesh.parent.removeChild(this.mesh);
      this.mesh.texture = Texture.EMPTY;
      this.mesh.destroy();
    }
    this.mesh = null;
    this.texture?.destroy(true);
    this.texture = null;
  }

  // -------------------------------------------------------------------------

  /**
   * Allocates the render texture and mesh on first enable, and KEEPS them when
   * the warp is switched off again. Toggling must not churn GPU allocations:
   * the soak check watches texture count, and an allocate/free per toggle is
   * exactly the shape of a leak it should be able to see. The idle cost of a
   * held texture is one output-sized RGBA surface, which is predictable.
   */
  private attach(): void {
    if (this.broken) return;
    if (!this.texture || !this.mesh) {
      try {
        this.texture = RenderTexture.create({
          width: this.width,
          height: this.height,
          // A3: the backing store is exactly the output size regardless of DPR.
          // Anything else silently resamples and no §4 number would describe
          // the pixels that reach the panel.
          resolution: 1,
          antialias: false,
        });
        this.mesh = new PerspectiveMesh({
          texture: this.texture,
          verticesX: VERTICES,
          verticesY: VERTICES,
        });
      } catch (err) {
        this.fail(`warp stage could not be created: ${String(err)}`);
        return;
      }
    }
    if (this.source.parent === this.stage) this.stage.removeChild(this.source);
    if (this.mesh.parent !== this.stage) this.stage.addChild(this.mesh);
  }

  private detach(): void {
    if (this.mesh && this.mesh.parent === this.stage) this.stage.removeChild(this.mesh);
    if (this.source.parent !== this.stage) this.stage.addChild(this.source);
  }

  private applyCorners(): void {
    if (!this.mesh) return;
    const p = toPixelCorners(this.calibration.corners, this.width, this.height);
    this.mesh.setCorners(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
  }

  /**
   * I-13: a warp failure costs the warp, not the session. The composite goes
   * back on the stage unwarped — a misaligned projection is recoverable in
   * front of an audience; a black one is not.
   */
  private fail(reason: string): void {
    if (this.broken) return;
    this.broken = true;
    try {
      this.release();
    } catch {
      // Already failing. Losing the teardown must not mask the fallback.
    }
    this.detach();
    this.onFallback(reason);
    console.error(`[warp] DEGRADED — ${reason}`);
  }
}
