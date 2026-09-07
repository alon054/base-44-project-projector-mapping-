/**
 * Pictures of the procedural kinds, for the content picker.
 *
 * A bundled asset has a file to show; a procedural kind has only code. So one
 * small offscreen PixiJS application — created lazily, the first time a picker
 * opens — renders each kind once at the golden instant (t = 1 s, forces at
 * identity, fixed seed) into a 160×90 frame and hands back a data URL. Cached
 * for the life of the window: seven kinds, seven renders, never per frame.
 *
 * This is the editor's own renderer, not the preview's and not the output's:
 * nothing here touches a scene, crosses IPC, or reaches `PreviewCanvas` (rule
 * 9's import graph is unchanged). A kind that throws — `fault`, by design —
 * yields `null` and the picker shows its label, which is I-13 at thumbnail
 * scale.
 */
import 'pixi.js/unsafe-eval';
import { Application, Rectangle } from 'pixi.js';
import { useEffect, useState } from 'react';
import { createLayer } from '../core/layer';
import { EMPTY_FORCE_FIELD } from '../core/forces';
import { hashString, layerRng } from '../core/rng';
import type { LayerFrame } from '../providers/ContentProvider';
import { PROCEDURAL_PROVIDER_ID, ProceduralProvider } from '../providers/procedural/ProceduralProvider';

export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 90;

/** The golden instant — the same moment the goldens are drawn at. */
const FRAME: LayerFrame = {
  timeSeconds: 1,
  phase: 0.25,
  playing: false,
  rate: 1,
  scrubSeq: 0,
  forces: EMPTY_FORCE_FIELD,
};

let appPromise: Promise<Application | null> | null = null;
const provider = new ProceduralProvider();
const cache = new Map<string, Promise<string | null>>();

function offscreen(): Promise<Application | null> {
  if (appPromise) return appPromise;
  appPromise = (async () => {
    try {
      const app = new Application();
      await app.init({
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
        background: 0x000000,
        antialias: false,
        preference: 'webgl',
        resolution: 1,
        autoDensity: false,
        autoStart: false,
        sharedTicker: false,
      });
      return app;
    } catch (err) {
      console.warn(`[thumbs] no offscreen renderer: ${String(err)}`);
      return null;
    }
  })();
  return appPromise;
}

/** A data URL of `kind` drawn once, or `null` when it cannot be drawn. Cached. */
export function proceduralThumb(kind: string): Promise<string | null> {
  const hit = cache.get(kind);
  if (hit) return hit;
  const p = (async () => {
    const app = await offscreen();
    if (!app) return null;
    const layer = createLayer({ id: `thumb-${kind}`, providerId: PROCEDURAL_PROVIDER_ID, content: { kind } });
    let view: ReturnType<ProceduralProvider['create']> | null = null;
    try {
      view = provider.create({
        layer,
        content: layer.content,
        rng: (label?: string) => layerRng(1, hashString(kind), label ?? ''),
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
      });
      app.stage.removeChildren();
      app.stage.addChild(view.view);
      view.update(FRAME);
      app.renderer.render(app.stage);
      const canvas = app.renderer.extract.canvas({
        target: app.stage,
        frame: new Rectangle(0, 0, THUMB_WIDTH, THUMB_HEIGHT),
      }) as HTMLCanvasElement;
      return canvas.toDataURL('image/png');
    } catch {
      // `fault` throws on purpose; anything else that throws is a kind the
      // picker shows by name instead. Not an error worth a line per open.
      return null;
    } finally {
      try {
        view?.destroy();
      } catch {
        /* a view that throws on teardown must not strand the next thumbnail */
      }
      app.stage.removeChildren();
    }
  })();
  cache.set(kind, p);
  return p;
}

/** React shell: `null` until drawn, then the data URL (or stays `null`). */
export function useProceduralThumb(kind: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (kind === null) return;
    let live = true;
    void proceduralThumb(kind).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [kind]);
  return kind === null ? null : url;
}
