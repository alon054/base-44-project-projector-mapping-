/**
 * I-9 — the output is an array, not a singleton.
 *
 * v1 drives one projector. This file exists so that Phase 11's second viewport
 * and edge blend are an addition rather than a refactor of every call site that
 * assumed one output.
 *
 * **Deliberately shape-only.** SPEC.md I-9 says "do not build any multi-output
 * *logic* in v1 — only the shape", so there is no compositing across viewports
 * here, no blend region, no overlap maths. Adding those before Phase 11 would
 * be exactly the speculative abstraction CLAUDE.md forbids.
 */

export interface OutputViewport {
  /** Stable id, so calibration in `calibration/` can be keyed to a viewport (I-5). */
  id: string;
  /** Pixel size of this viewport's render target. Derived from the display. */
  width: number;
  height: number;
}

export interface Outputs {
  viewports: OutputViewport[];
}

/** The v1 case: one output. Returns an array of length 1, never a bare object. */
export function createOutputs(width: number, height: number, id = 'main'): Outputs {
  return { viewports: [{ id, width, height }] };
}

/**
 * The one place v1 is allowed to assume a single output. Every other caller
 * iterates `viewports`, so when Phase 11 adds a second one, the assumption is
 * findable by grepping for this function rather than by reading everything.
 */
export function primaryViewport(outputs: Outputs): OutputViewport {
  const first = outputs.viewports[0];
  if (!first) throw new Error('outputs.viewports is empty; v1 requires exactly one (I-9)');
  return first;
}

export function resizeOutput(outputs: Outputs, id: string, width: number, height: number): Outputs {
  return {
    viewports: outputs.viewports.map((v) => (v.id === id ? { ...v, width, height } : v)),
  };
}
