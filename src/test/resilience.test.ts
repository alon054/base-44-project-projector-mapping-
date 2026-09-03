/**
 * I-13 — per-layer error isolation (SPEC.md §8.1: "a provider that throws
 * yields a placeholder layer and a logged error, and the compositor still
 * returns a full layer list").
 *
 * Pure logic, no PixiJS: `core/resilience.ts` is generic over the view type
 * precisely so this can run with no GPU.
 */
import { describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer } from '../core/layer';
import {
  describeError,
  failedLayers,
  isolateCreate,
  isolateUpdate,
  type IsolatedLayer,
  type PlaceholderInfo,
} from '../core/resilience';

type View = { tag: string; updates: number };

const layers = (...ids: string[]): Layer[] =>
  ids.map((id) => createLayer({ id, name: id.toUpperCase(), providerId: 'procedural' }));

const placeholder = (info: PlaceholderInfo): View => ({
  tag: `placeholder:${info.layerId}:${info.reason}`,
  updates: 0,
});

describe('I-13 create isolation', () => {
  it('one throwing provider does not blank the frame — the list is still full and in order', () => {
    const ls = layers('a', 'bad', 'c');
    const entries = isolateCreate<View>(
      ls,
      (l) => {
        if (l.id === 'bad') throw new Error('asset missing');
        return { tag: l.id, updates: 0 };
      },
      placeholder,
    );
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.layer.id)).toEqual(['a', 'bad', 'c']);
    expect(entries.map((e) => e.status)).toEqual(['ok', 'placeholder', 'ok']);
    expect(entries[1]!.view.tag).toBe('placeholder:bad:asset missing');
  });

  it('every layer can fail and the list is still full', () => {
    const entries = isolateCreate<View>(
      layers('a', 'b'),
      () => {
        throw new Error('nope');
      },
      placeholder,
    );
    expect(entries).toHaveLength(2);
    expect(failedLayers(entries)).toHaveLength(2);
  });

  it('logs the error with the layer identified', () => {
    const sink = vi.fn();
    isolateCreate<View>(
      layers('bad'),
      () => {
        throw new Error('asset missing');
      },
      placeholder,
      sink,
    );
    expect(sink).toHaveBeenCalledTimes(1);
    const [info] = sink.mock.calls[0]!;
    expect(info).toMatchObject({
      layerId: 'bad',
      layerName: 'BAD',
      providerId: 'procedural',
      reason: 'asset missing',
    });
  });

  it('survives a provider that throws something that is not an Error', () => {
    const entries = isolateCreate<View>(
      layers('bad'),
      () => {
        throw 'a string, because providers are not all ours';
      },
      placeholder,
    );
    expect(entries[0]!.status).toBe('placeholder');
    expect(entries[0]!.error).toBe('a string, because providers are not all ours');
  });

  it('describeError names an Error with an empty message rather than reporting nothing', () => {
    expect(describeError(new TypeError(''))).toBe('TypeError');
    expect(describeError(undefined)).toBe('undefined');
  });
});

describe('I-13 update isolation', () => {
  const build = (): IsolatedLayer<View>[] =>
    isolateCreate<View>(layers('a', 'bad', 'c'), (l) => ({ tag: l.id, updates: 0 }), placeholder);

  it('a layer that throws mid-session is disabled, and the others keep updating', () => {
    const entries = build();
    const run = (): IsolatedLayer<View>[] =>
      isolateUpdate<View>(
        entries,
        (e) => {
          if (e.layer.id === 'bad') throw new Error('decode failed');
          e.view.updates++;
        },
        placeholder,
      );

    const changed = run();
    expect(changed.map((e) => e.layer.id)).toEqual(['bad']);
    expect(entries[1]!.status).toBe('placeholder');
    expect(entries[0]!.view.updates).toBe(1);
    expect(entries[2]!.view.updates).toBe(1);
  });

  it('never calls a failed layer again — one broken provider is not 60 exceptions a second', () => {
    const entries = build();
    const attempted: string[] = [];
    const sink = vi.fn();
    const run = (): void => {
      isolateUpdate<View>(
        entries,
        (e) => {
          attempted.push(e.layer.id);
          if (e.layer.id === 'bad') throw new Error('decode failed');
        },
        placeholder,
        sink,
      );
    };
    for (let i = 0; i < 60; i++) run();

    expect(attempted.filter((id) => id === 'bad')).toHaveLength(1);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(attempted.filter((id) => id === 'a')).toHaveLength(60);
  });

  it('reports a status change exactly once, so the UI flags the layer once', () => {
    const entries = build();
    const fail = (): IsolatedLayer<View>[] =>
      isolateUpdate<View>(
        entries,
        (e) => {
          if (e.layer.id === 'bad') throw new Error('x');
        },
        placeholder,
      );
    expect(fail()).toHaveLength(1);
    expect(fail()).toHaveLength(0);
  });
});
