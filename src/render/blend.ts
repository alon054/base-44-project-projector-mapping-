/**
 * I-6 — blend-mode mapping.
 *
 * The engine's four modes happen to be spelled identically in PixiJS v8, which
 * makes this file look redundant. It is not, for two reasons:
 *
 *  1. The scene format must not be defined by whatever strings the renderer
 *     accepts this year. `normal | add | multiply | screen` is a decision in
 *     SPEC.md I-6; Pixi v8 offers 33 modes and v7 used numeric constants. A
 *     stored scene has to survive that.
 *  2. All four of ours are **native** GL blend modes. Everything else in Pixi
 *     v8's list is an "advanced" mode requiring the `pixi.js/advanced-blend-modes`
 *     sub-export and a filter pass per use. Verified against the installed
 *     `State.mjs` blend-mode id table, not from memory. Widening I-6 later is
 *     therefore a performance decision, not a typing one, and this file is
 *     where that will be noticed.
 */
import type { BLEND_MODES } from 'pixi.js';
import { BLEND_MODES as ENGINE_BLEND_MODES, type BlendMode } from '../core/layer';

const TO_PIXI: Record<BlendMode, BLEND_MODES> = {
  normal: 'normal',
  add: 'add',
  multiply: 'multiply',
  screen: 'screen',
};

/**
 * Every mode here is native in Pixi v8's `blendModeIds` table. Asserted by the
 * unit suite, so adding a mode to I-6 that needs the advanced sub-export fails
 * a test rather than quietly costing a filter pass per layer.
 */
export const NATIVE_PIXI_BLEND_MODES: readonly string[] = [
  'normal',
  'add',
  'multiply',
  'screen',
];

export function toPixiBlendMode(mode: BlendMode): BLEND_MODES {
  return TO_PIXI[mode];
}

/** Round-trips a Pixi mode back to the engine's vocabulary, or null. */
export function fromPixiBlendMode(mode: string): BlendMode | null {
  const hit = ENGINE_BLEND_MODES.find((m) => TO_PIXI[m] === mode);
  return hit ?? null;
}
