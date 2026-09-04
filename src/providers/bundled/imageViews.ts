/**
 * The still and sprite-sheet layer views (I-3, I-13, D5).
 *
 * **Both populate themselves after `create` returns.** `ContentProvider.create`
 * is synchronous by design — awaiting a provider would mean a scene switch
 * mid-show stalls on a load — so each view exists from the first frame showing
 * its I-13 placeholder, and swaps to content when the texture arrives. The
 * placeholder is not a loading spinner: if the load never completes, the
 * placeholder is already the correct final state and nothing has to notice.
 *
 * Nothing here reads the output resolution or stores a pixel value (I-1). The
 * compositor hands each view a pixel box and the view fits itself to it.
 */
import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { SpriteSheetAsset, StillAsset } from '../../core/library';
import type { LayerFrame, LayerView } from '../ContentProvider';
import { createPlaceholderGraphic } from '../../render/placeholder';
import { frameAt, frameCell, seamWeights, type SeamMode } from './seam';
import { phaseAt } from '../../core/clock';

/** Fits a sprite inside `w x h` preserving aspect, centred. */
function fitContain(sprite: Sprite, w: number, h: number, texW: number, texH: number): void {
  if (texW <= 0 || texH <= 0 || w <= 0 || h <= 0) return;
  const scale = Math.min(w / texW, h / texH);
  sprite.width = texW * scale;
  sprite.height = texH * scale;
  sprite.position.set((w - sprite.width) / 2, (h - sprite.height) / 2);
}

/**
 * A single alpha-bearing image. Kenney's particle PNGs.
 *
 * This is the view Gate 3 judges "a Kenney alpha sprite renders with correct
 * alpha and correct blend mode" on. Note what it does NOT do: it does not
 * premultiply, tint, or otherwise touch the alpha channel, and it sets no blend
 * mode of its own — `blendMode` is a LAYER property (I-6) applied by the
 * compositor, so a provider that set one here would be overriding the operator.
 */
export function createStillView(asset: StillAsset, width: number, height: number): LayerView {
  const view = new Container();
  const sprite = new Sprite();
  sprite.visible = false;
  const ph = createPlaceholderGraphic({
    layerId: asset.id,
    layerName: asset.name,
    providerId: 'bundled',
    reason: 'loading',
  });
  view.addChild(ph.view, sprite);

  let w = width;
  let h = height;
  let texW = 0;
  let texH = 0;
  let destroyed = false;
  ph.draw(w, h);

  void Assets.load<Texture>(asset.url)
    .then((tex) => {
      if (destroyed) return;
      sprite.texture = tex;
      texW = tex.width;
      texH = tex.height;
      sprite.visible = true;
      ph.view.visible = false;
      fitContain(sprite, w, h, texW, texH);
    })
    .catch(() => {
      // I-13: a load that never arrives leaves the placeholder in place, which
      // is already the right final state. Nothing throws into the render loop.
      if (destroyed) return;
      ph.view.visible = true;
    });

  return {
    view,
    update: () => {},
    resize: (nw, nh) => {
      w = nw;
      h = nh;
      ph.draw(w, h);
      fitContain(sprite, w, h, texW, texH);
    },
    destroy: () => {
      destroyed = true;
      view.destroy({ children: true });
    },
  };
}

/**
 * A grid of frames in one image, advanced by the global clock (I-2).
 *
 * **The frame is DERIVED from clock time every frame, never advanced.** There
 * is no `currentFrame++` here and there must not be: an advancing counter is
 * per-layer state, and Gate 3 asks that a scrub put two sheets of different
 * lengths where the arithmetic says rather than where their histories left
 * them. `frameAt(phaseAt(t, period), frames)` has no history to be wrong about.
 *
 * Two sprites, not one, because D5's crossfade draws the same animation twice
 * half a period apart (see `seam.ts`). With `seam: 'none'` the second sprite
 * sits at weight 0 and costs one hidden quad.
 */
export function createSpriteSheetView(
  asset: SpriteSheetAsset,
  width: number,
  height: number,
  seam: SeamMode,
): LayerView {
  const view = new Container();
  const a = new Sprite();
  const b = new Sprite();
  a.visible = false;
  b.visible = false;
  const ph = createPlaceholderGraphic({
    layerId: asset.id,
    layerName: asset.name,
    providerId: 'bundled',
    reason: 'loading',
  });
  view.addChild(ph.view, a, b);

  let w = width;
  let h = height;
  let frames: Texture[] = [];
  let cellW = 0;
  let cellH = 0;
  let destroyed = false;
  ph.draw(w, h);

  void Assets.load<Texture>(asset.url)
    .then((sheet) => {
      if (destroyed) return;
      cellW = Math.floor(sheet.width / asset.columns);
      cellH = Math.floor(sheet.height / asset.rows);
      // Sliced once, at load. Building a Rectangle per frame per tick would be
      // an allocation on the render thread 60 times a second, which A14 rules
      // out for the instrument and which is no more acceptable for a layer.
      frames = [];
      for (let i = 0; i < asset.frames; i++) {
        const { col, row } = frameCell(i, asset.columns);
        frames.push(
          new Texture({
            source: sheet.source,
            frame: new Rectangle(col * cellW, row * cellH, cellW, cellH),
          }),
        );
      }
      a.visible = true;
      b.visible = seam === 'crossfade';
      ph.view.visible = false;
      layout();
    })
    .catch(() => {
      if (destroyed) return;
      ph.view.visible = true;
    });

  const layout = (): void => {
    fitContain(a, w, h, cellW, cellH);
    fitContain(b, w, h, cellW, cellH);
  };

  return {
    view,
    update: (frame: LayerFrame) => {
      if (frames.length === 0) return;
      const phase = phaseAt(frame.timeSeconds * 1000, asset.loopSeconds);
      const weights = seamWeights(seam, phase);
      const ta = frames[frameAt(weights.phaseA, asset.frames)];
      if (ta) a.texture = ta;
      a.alpha = weights.weightA;
      if (seam === 'crossfade') {
        const tb = frames[frameAt(weights.phaseB, asset.frames)];
        if (tb) b.texture = tb;
        b.alpha = weights.weightB;
      }
    },
    resize: (nw, nh) => {
      w = nw;
      h = nh;
      ph.draw(w, h);
      layout();
    },
    destroy: () => {
      destroyed = true;
      // The per-frame sub-textures are ours; the sheet behind them belongs to
      // `Assets` and is not destroyed here, or a second layer using the same
      // sheet would lose its source when this one is removed.
      for (const t of frames) t.destroy(false);
      frames = [];
      view.destroy({ children: true });
    },
  };
}
