import { describe, expect, it } from 'vitest';
import { pickOutputDisplay, type DisplayFingerprint } from '@shared/config';

type D = Electron.Display;

function display(over: Partial<D> & { id: number }): D {
  const width = over.size?.width ?? 1280;
  const height = over.size?.height ?? 720;
  return {
    id: over.id,
    label: over.label ?? `Display ${over.id}`,
    size: { width, height },
    bounds: over.bounds ?? { x: 0, y: 0, width, height },
    workArea: { x: 0, y: 0, width, height },
    workAreaSize: { width, height },
    scaleFactor: over.scaleFactor ?? 1,
    displayFrequency: over.displayFrequency ?? 60,
    internal: over.internal ?? false,
    detected: over.detected ?? true,
    rotation: 0,
    touchSupport: 'unknown',
    accelerometerSupport: 'unknown',
    monochrome: false,
    colorDepth: 24,
    colorSpace: '{}',
    depthPerComponent: 8,
    nativeOrigin: { x: 0, y: 0 },
    maximumCursorSize: { width: 32, height: 32 },
  } as D;
}

const internal = display({
  id: 1,
  label: 'Color LCD',
  size: { width: 1280, height: 832 },
  scaleFactor: 2,
  internal: true,
});
const projector = display({
  id: 2,
  label: 'NEBULA',
  size: { width: 1280, height: 720 },
  displayFrequency: 60,
});

function printOf(d: D): DisplayFingerprint {
  return {
    id: d.id,
    label: d.label,
    width: d.size.width,
    height: d.size.height,
    scaleFactor: d.scaleFactor,
    internal: d.internal,
  };
}

describe('pickOutputDisplay — Gate 0 relaunch without reconfiguration', () => {
  it('matches the saved display by id when the id is still valid', () => {
    const pick = pickOutputDisplay([internal, projector], 1, printOf(projector));
    expect(pick.display?.id).toBe(2);
    expect(pick.reason).toBe('exact-id');
    expect(pick.needsConfirmation).toBe(false);
  });

  it('falls back to the fingerprint when the id changed across a reconnect', () => {
    const reconnected = display({
      id: 99,
      label: 'NEBULA',
      size: { width: 1280, height: 720 },
    });
    const pick = pickOutputDisplay([internal, reconnected], 1, printOf(projector));
    expect(pick.display?.id).toBe(99);
    expect(pick.reason).toBe('fingerprint');
  });

  it('does not match a saved external display against the internal one', () => {
    // The saved id happens to collide with the internal display's id.
    const saved = { ...printOf(projector), id: 1 };
    const pick = pickOutputDisplay([internal, projector], 1, saved);
    expect(pick.display?.internal).toBe(false);
    expect(pick.reason).toBe('fingerprint');
  });

  it('picks the largest detected external display when nothing is saved', () => {
    const small = display({ id: 3, size: { width: 800, height: 600 } });
    const pick = pickOutputDisplay([internal, small, projector], 1, null);
    expect(pick.display?.id).toBe(2);
    expect(pick.reason).toBe('largest-external');
    expect(pick.needsConfirmation).toBe(false);
  });

  it('ignores undetected displays', () => {
    const ghost = display({ id: 4, size: { width: 3840, height: 2160 }, detected: false });
    const pick = pickOutputDisplay([internal, ghost, projector], 1, null);
    expect(pick.display?.id).toBe(2);
  });

  it('falls back to primary but demands confirmation — C6', () => {
    const pick = pickOutputDisplay([internal], 1, null);
    expect(pick.display?.id).toBe(1);
    expect(pick.reason).toBe('primary-fallback');
    expect(pick.needsConfirmation).toBe(true);
  });

  it('demands confirmation for the internal display even when it was saved', () => {
    const pick = pickOutputDisplay([internal], 1, printOf(internal));
    expect(pick.reason).toBe('exact-id');
    expect(pick.needsConfirmation).toBe(true);
  });

  it('returns nothing when there are no displays at all', () => {
    const pick = pickOutputDisplay([], 1, null);
    expect(pick.display).toBeNull();
    expect(pick.reason).toBe('none');
  });

  it('does not resurrect a saved display that is gone', () => {
    const pick = pickOutputDisplay([internal], 1, printOf(projector));
    expect(pick.display?.id).toBe(1);
    expect(pick.reason).toBe('primary-fallback');
  });
});
