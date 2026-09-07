/**
 * S2 — a typed role is one rebuild, not one per character.
 *
 * B3 found the fault on the pointer path (a rebuild per drag sample) and fixed
 * it with `reshapeFill`. The same fault sat on the keyboard: `role` is in the
 * shape key, `fillRole` is a new scene, and both wrote per keystroke. This
 * file is the test that would have failed at one-per-character.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Container, Graphics } from 'pixi.js';
import { Compositor } from '../render/compositor';
import { createPath, type Path } from '../core/paths';
import { createSurface, withSurfaceRole, type SurfaceTree } from '../core/surfaces';
import { resetRoleLog } from '../core/roles';
import { createLayer } from '../core/layer';
import { createScene } from '../core/scene';
import { EMPTY_FORCE_FIELD } from '../core/forces';
import {
  ProviderRegistry,
  type ContentProvider,
  type LayerFrame,
  type LayerView,
  type ProviderContext,
} from '../providers/ContentProvider';
import { TEXT_COMMIT_DELAY_MS, TextCommitter } from '../editor/debouncedText';

const SRC = join(new URL('../', import.meta.url).pathname);
const W = 1280;
const H = 720;
const FRAME: LayerFrame = { timeSeconds: 1, phase: 0.25, playing: false, rate: 1, scrubSeq: 0, forces: EMPTY_FORCE_FIELD };

class RecordingProvider implements ContentProvider {
  readonly id = 'recording';
  creates = 0;
  create(ctx: ProviderContext): LayerView {
    this.creates++;
    const view = new Container();
    view.addChild(new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: 0x808080 }));
    return { view, update: () => {}, resize: () => {}, destroy: () => {} };
  }
}

function quad(id: string, x = 0.1, y = 0.2): Path {
  return createPath({
    id,
    closed: true,
    points: [{ x, y }, { x: x + 0.3, y }, { x: x + 0.3, y: y + 0.3 }, { x, y: y + 0.3 }],
  });
}

function room(): SurfaceTree {
  return [createSurface({ id: 'surface-1', name: 'face 1', path: quad('path-1') })];
}

function compositorFor(surfaces: SurfaceTree, provider: ContentProvider): Compositor {
  const providers = new ProviderRegistry();
  providers.register(provider);
  const c = new Compositor({ providers, width: W, height: H, surfaces });
  c.setScene(
    createScene({
      id: 'fill',
      layers: [createLayer({ id: 'fill-1', providerId: 'recording', content: {}, fillRole: 'panel' })],
    }),
  );
  c.update(FRAME);
  return c;
}

/**
 * The reel's own case (UI_PLAN.md H2): the face is `panel` already — the
 * default — and the builder appends ` f1` to give it a sequence slot. Every
 * keystroke leaves `panel` in the string, so the face keeps matching and each
 * write is a rebuild WITH a view (a decoder, with a video fill); that is what
 * makes the count below a count of rebuilds.
 */
const BASE = 'panel';
const TYPED = 'panel f1';
const KEYSTROKES = [...TYPED.slice(BASE.length)].map((_, i) => TYPED.slice(0, BASE.length + i + 1));

describe('S2 — TextCommitter, the one debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a word typed is one commit, of the whole word, after the quiet period', () => {
    const commits: string[] = [];
    const t = new TextCommitter((v) => commits.push(v));
    for (const k of KEYSTROKES) {
      t.type(k);
      vi.advanceTimersByTime(TEXT_COMMIT_DELAY_MS - 1);
    }
    expect(commits).toEqual([]);
    expect(t.pending).toBe(true);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([TYPED]);
    expect(t.pending).toBe(false);
  });

  it('the delay is 250 ms — still live on camera, not a write per character', () => {
    expect(TEXT_COMMIT_DELAY_MS).toBe(250);
  });

  it('flush (blur, Enter, unmount) commits now; with nothing pending it writes nothing', () => {
    const commits: string[] = [];
    const t = new TextCommitter((v) => commits.push(v));
    t.flush();
    expect(commits).toEqual([]);
    t.type('pa');
    t.flush();
    expect(commits).toEqual(['pa']);
    vi.advanceTimersByTime(TEXT_COMMIT_DELAY_MS * 2);
    expect(commits).toEqual(['pa']);
  });

  it('cancel drops the pending value and the timer', () => {
    const commits: string[] = [];
    const t = new TextCommitter((v) => commits.push(v));
    t.type('pan');
    t.cancel();
    vi.advanceTimersByTime(TEXT_COMMIT_DELAY_MS * 2);
    expect(commits).toEqual([]);
    expect(t.pending).toBe(false);
  });

  it('a pause longer than the delay mid-word is two commits — the face lights at the pause', () => {
    const commits: string[] = [];
    const t = new TextCommitter((v) => commits.push(v));
    t.type('panel');
    vi.advanceTimersByTime(TEXT_COMMIT_DELAY_MS);
    t.type('panel f1');
    vi.advanceTimersByTime(TEXT_COMMIT_DELAY_MS);
    expect(commits).toEqual(['panel', 'panel f1']);
  });
});

describe('S2 — THE CLAIM: typing a role into a face is one rebuild', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('without the mechanism, one rebuild per character — the fault, stated', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    let tree = room();
    const c = compositorFor(tree, provider);
    expect(provider.creates).toBe(1);
    for (const k of KEYSTROKES) {
      tree = withSurfaceRole(tree, 'surface-1', k);
      c.setSurfaces(tree);
    }
    // Each keystroke is a new role, a new shape key, a full rebuild: the
    // face's view destroyed and created again. With a video fill each of
    // these is a decoder torn down and rebuilt.
    expect(KEYSTROKES).toEqual(['panel ', 'panel f', 'panel f1']);
    expect(provider.creates).toBe(1 + KEYSTROKES.length);
    c.destroy();
  });

  it('through TextCommitter, the same typing is ONE rebuild', () => {
    resetRoleLog();
    const provider = new RecordingProvider();
    let tree = room();
    const c = compositorFor(tree, provider);
    const t = new TextCommitter((v) => {
      tree = withSurfaceRole(tree, 'surface-1', v);
      c.setSurfaces(tree);
    });
    for (const k of KEYSTROKES) {
      t.type(k);
      vi.advanceTimersByTime(40); // a fast typist
    }
    expect(provider.creates).toBe(1);
    vi.advanceTimersByTime(TEXT_COMMIT_DELAY_MS);
    expect(provider.creates).toBe(2);
    expect(tree[0]!.role).toBe(TYPED);
    c.destroy();
  });
});

describe('S2 — one mechanism, and geometry is not in it', () => {
  const read = (f: string) => readFileSync(join(SRC, 'editor', f), 'utf8');

  it('no raw text input writes per keystroke in the two panels that rebuild', () => {
    for (const f of ['SurfacePanel.tsx', 'ParamControl.tsx']) {
      const src = read(f);
      expect(/type="text"/.test(src), `${f} still has a raw text input`).toBe(false);
      expect(src.includes('DebouncedTextInput'), `${f} does not use the mechanism`).toBe(true);
    }
  });

  it('the input component is the only user of TextCommitter, and it writes no parameter', () => {
    const comp = read('DebouncedTextInput.tsx');
    expect(comp.includes('new TextCommitter(')).toBe(true);
    expect(comp.includes('registry.write')).toBe(false);
    // Nothing else constructs one: a second debounce is a second "live".
    const others = ['App.tsx', 'SurfacePanel.tsx', 'ParamControl.tsx', 'PreviewCanvas.tsx', 'FillPanel.tsx', 'GroupPanel.tsx'];
    for (const f of others) expect(read(f).includes('new TextCommitter('), f).toBe(false);
  });

  it('the preview (point drags) does not import the debounce', () => {
    expect(/debouncedText|DebouncedTextInput/.test(read('PreviewCanvas.tsx'))).toBe(false);
    expect(/debouncedText|DebouncedTextInput/.test(read('pathTool.ts'))).toBe(false);
  });

  it('the late write reads its callback at commit time, not at the keystroke', () => {
    // The mechanism that stops a 250 ms-old closure from reverting a point
    // drag made in between. Asserted at the source because it is the kind of
    // line a tidy-up removes.
    const comp = read('DebouncedTextInput.tsx');
    // As statements, not as words: a comment must not satisfy this.
    expect(/^\s*commitRef\.current = onCommit;$/m.test(comp)).toBe(true);
    expect(/^\s*committer\.current = new TextCommitter\(\(v\) => commitRef\.current\(v\)\);$/m.test(comp)).toBe(true);
  });
});
