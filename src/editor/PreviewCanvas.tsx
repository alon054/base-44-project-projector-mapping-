/**
 * Hosts a PixiJS canvas that React mounts once and never renders into
 * (SPEC.md §5: "the canvas stays PixiJS and is never React-managed").
 *
 * I-7: this is an approximation of the output at reduced resolution, not a
 * mirror. It runs its own render loop from the same scene model.
 */
import { useEffect, useRef } from 'react';
import { createRenderHost, type RenderHost } from '../render/host';
import type { Clock, ClockTransport } from '../core/clock';
import type { Scene } from '../core/scene';

export const PREVIEW_SIZE = { width: 480, height: 270 } as const;

interface Props {
  speed: number;
  nominalMs: number;
  scene: Scene;
  /** I-2: operator intent, applied to this host's clock. */
  clockState: ClockTransport;
  /**
   * Handed back once the host exists, so the transport can read a clock that is
   * actually running rather than the intent it just sent. Null on teardown.
   */
  onClockReady?: (clock: Clock | null) => void;
}

export function PreviewCanvas({
  speed,
  nominalMs,
  scene,
  clockState,
  onClockReady,
}: Props): React.JSX.Element {
  const mount = useRef<HTMLDivElement | null>(null);
  const host = useRef<RenderHost | null>(null);
  // The mount effect runs once and must not capture a stale scene.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const clockStateRef = useRef(clockState);
  clockStateRef.current = clockState;
  const onClockReadyRef = useRef(onClockReady);
  onClockReadyRef.current = onClockReady;

  useEffect(() => {
    let disposed = false;
    let created: RenderHost | null = null;
    const el = mount.current;
    if (!el) return;

    void createRenderHost({
      parent: el,
      width: PREVIEW_SIZE.width,
      height: PREVIEW_SIZE.height,
      nominalMs: nominalMs || 16.67,
      // §5 / A2, stated by omission elsewhere and explicitly here: the preview
      // does NOT decode video. It shows the poster plus a badge. This is not a
      // fidelity setting — a second decoder spends a 16 GB pool shared between
      // CPU and GPU twice, for a preview nobody projects.
      decodeVideo: false,
      // §5: "Lottie *does* run in the preview, at reduced size, capped." The
      // preview is 480x270, so a 512 px canvas would be rendering more Lottie
      // pixels than it can show.
      lottieResolution: 192,
    }).then((h) => {
      created = h;
      if (disposed) {
        h.destroy();
        return;
      }
      host.current = h;
      h.setSpeed(speed);
      h.setScene(sceneRef.current);
      h.setClock(clockStateRef.current);
      onClockReadyRef.current?.(h.clock);
    });

    return () => {
      disposed = true;
      onClockReadyRef.current?.(null);
      created?.destroy();
      if (host.current === created) host.current = null;
    };
    // Mounted once, deliberately. Updates arrive through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    host.current?.setSpeed(speed);
  }, [speed]);

  useEffect(() => {
    if (nominalMs > 0) host.current?.setNominalMs(nominalMs);
  }, [nominalMs]);

  useEffect(() => {
    host.current?.setScene(scene);
  }, [scene]);

  // I-2. The preview's clock is a real clock; this applies the operator's
  // intent to it, which is what makes a pause visible in the editor without a
  // round trip to the output window.
  useEffect(() => {
    host.current?.setClock(clockState);
  }, [clockState]);

  return (
    <div
      ref={mount}
      style={{
        width: PREVIEW_SIZE.width,
        height: PREVIEW_SIZE.height,
        background: '#000',
        border: '1px solid #2b2f34',
        borderRadius: 4,
      }}
    />
  );
}
