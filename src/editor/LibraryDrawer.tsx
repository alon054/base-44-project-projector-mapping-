/**
 * The Library drawer: where content is FOUND and BROUGHT HOME. Slides over the
 * editor from the right; closed, it takes no space at all.
 *
 * Kept apart from the places content is USED on purpose. Choosing what a face
 * shows happens in the Fill panel and the entity panel, beside the faces;
 * searching the Archive and downloading is a different job that happens
 * before, and mixing the two in one scroll made the wall-mode page long and
 * the "which button puts this on the wall" question hard. So: pickers on the
 * page, catalog in the drawer, and the drawer's own "use on faces" button for
 * the moment a download should go straight to the wall.
 *
 * Writes no parameter. Its one scene edit is `applyContentChoice`, the same
 * structural call the pickers make.
 */
import { useEffect, useMemo } from 'react';
import type { Scene } from '../core/scene';
import type { BundledAsset } from '../core/library';
import { BUNDLED_PROVIDER_ID } from '../providers/bundled/id';
import { applyContentChoice, type ContentChoice } from './controls';
import { editorLibrary } from './assets';
import { CatalogPanel } from './CatalogPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  scene: Scene;
  setScene: (update: (prev: Scene) => Scene) => void;
  libraryVersion: number;
}

export function LibraryDrawer({ open, onClose, scene, setScene, libraryVersion }: Props): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const downloaded = useMemo(() => editorLibrary.all().filter((a) => a.url.startsWith('library://')), [libraryVersion]);
  // The layers a download can go straight onto: every layer bound to a role.
  const fills = scene.layers.flatMap((l) => (l.fillRole ? [l] : []));

  if (!open) return null;

  const useOnFaces = (asset: BundledAsset): void => {
    const choice: ContentChoice = {
      id: `${BUNDLED_PROVIDER_ID}:${asset.id}`,
      providerId: BUNDLED_PROVIDER_ID,
      label: asset.name,
      group: 'Downloaded (Library)',
      content: { assetId: asset.id },
    };
    // The FIRST bound layer — the white fill in the reel's case. A second bound
    // layer is a deliberate arrangement the pickers beside the faces handle.
    const target = fills[0];
    if (!target) return;
    setScene((prev) => applyContentChoice(prev, target.id, choice));
    onClose();
  };

  return (
    <div style={backdrop} onClick={onClose} role="presentation">
      <aside
        style={drawer}
        role="dialog"
        aria-label="Library — find and download content"
        onClick={(e) => e.stopPropagation()}
      >
        <header style={headerStyle}>
          <div>
            <strong style={{ fontSize: 14, color: '#e6ebf0' }}>Library</strong>
            <span style={{ fontSize: 12, color: '#8b939b', marginLeft: 8 }}>
              find loops, download them, then pick them on a face
            </span>
          </div>
          <button type="button" style={closeStyle} onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </header>

        <section style={sectionStyle}>
          <h3 style={h3Style}>Downloaded · {downloaded.length}</h3>
          {downloaded.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: '#8b939b' }}>
              Nothing yet. Search below; a downloaded clip lands in <code>assets/library/</code> and
              appears here and in every picker.
            </p>
          ) : (
            <div style={downloadedGrid}>
              {downloaded.map((a) => (
                <div key={a.id} style={card}>
                  <div style={thumbWrap}>
                    {a.kind === 'video' ? (
                      <img src={a.posterUrl} alt="" style={thumb} draggable={false} />
                    ) : (
                      <img src={a.url} alt="" style={{ ...thumb, objectFit: 'contain' }} draggable={false} />
                    )}
                    <span style={{ ...badge, position: 'absolute', left: 4, top: 4 }}>
                      {a.kind === 'video' ? `▶ ${a.loopSeconds}s` : 'image'}
                    </span>
                    <span style={{ ...badge, position: 'absolute', right: 4, top: 4, color: '#7CFFB2' }}>
                      {a.license.license}
                    </span>
                  </div>
                  <div style={titleStyle} title={a.name}>
                    {a.name}
                  </div>
                  <div style={metaStyle}>
                    {a.license.attributionRequired ? `credit: ${a.license.attribution}` : 'no credit required'}
                  </div>
                  <button
                    type="button"
                    style={{ ...button, opacity: fills.length === 0 ? 0.5 : 1 }}
                    disabled={fills.length === 0}
                    title={
                      fills.length === 0
                        ? 'Make a fill first (White fill → panel in the Room panel)'
                        : `Put this on "${fills[0]?.name}" — every face it fills changes at once`
                    }
                    onClick={() => useOnFaces(a)}
                  >
                    use on faces
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={sectionStyle}>
          <h3 style={h3Style}>Search the Internet Archive</h3>
          <CatalogPanel />
        </section>
      </aside>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.55)',
  zIndex: 50,
  display: 'flex',
  justifyContent: 'flex-end',
};

const drawer: React.CSSProperties = {
  width: 'min(640px, 100vw)',
  height: '100%',
  overflowY: 'auto',
  background: '#111214',
  borderLeft: '1px solid #2b2f34',
  boxShadow: '-12px 0 32px rgba(0,0,0,.5)',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 14px',
  borderBottom: '1px solid #2b2f34',
  position: 'sticky',
  top: 0,
  background: '#111214',
  zIndex: 1,
};

const sectionStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid #1f2327',
  display: 'grid',
  gap: 8,
};

const h3Style: React.CSSProperties = {
  font: '600 11px/1.4 ui-monospace, Menlo, monospace',
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  color: '#8b939b',
  margin: 0,
};

const closeStyle: React.CSSProperties = {
  padding: '3px 9px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#191c1f',
  color: 'inherit',
  font: '13px/1.2 inherit',
  cursor: 'pointer',
};

const downloadedGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  gap: 8,
};

const card: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 6,
  borderRadius: 5,
  border: '1px solid #2b2f34',
  background: '#0f1214',
};

const thumbWrap: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '16 / 9',
  background: '#000',
  borderRadius: 3,
  overflow: 'hidden',
};

const thumb: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

const badge: React.CSSProperties = {
  font: '600 9px/1.2 ui-monospace, Menlo, monospace',
  color: '#c7ced4',
  background: 'rgba(0,0,0,.6)',
  padding: '1px 4px',
  borderRadius: 3,
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#e6ebf0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const metaStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#6f767d',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const button: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#191c1f',
  color: 'inherit',
  font: '12px/1.2 inherit',
  cursor: 'pointer',
};
