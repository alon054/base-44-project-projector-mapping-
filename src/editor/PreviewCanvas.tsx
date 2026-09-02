/**
 * Hosts a PixiJS canvas that React mounts once and never renders into
 * (SPEC.md §5: "the canvas stays PixiJS and is never React-managed").
 *
 * I-7: this is an approximation of the output at reduced resolution, not a
 * mirror. It runs its own render loop from the same scene model.
 */
import { useEffect, useRef } from 'react';
import { createRenderHost, type RenderHost } from '../render/host';

export const PREVIEW_SIZE = { width: 480, height: 270 } as const;

interface Props {
  speed: number;
  nominalMs: number;
}

export function PreviewCanvas({ speed, nominalMs }: Props): React.JSX.Element {
  const mount = useRef<HTMLDivElement | null>(null);
  const host = useRef<RenderHost | null>(null);

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
    }).then((h) => {
      created = h;
      if (disposed) {
        h.destroy();
        return;
      }
      host.current = h;
      h.setSpeed(speed);
    });

    return () => {
      disposed = true;
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
