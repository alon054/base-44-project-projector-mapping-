/**
 * The online catalog panel: search the Internet Archive for loops, bring one
 * home, and it appears in every picker.
 *
 * Operator-requested, ahead of SPEC.md's Phase 8 and against §12's cut of
 * catalog APIs — recorded as a SPEC-CHANGE-PROPOSED in BUILD_LOG.md. What it
 * does NOT change: I-10 (every asset that lands carries a license record or is
 * refused before download — see `electron/catalogLogic.ts`), I-7 (no bytes
 * cross IPC; the renderer loads `library://` files main serves from disk), and
 * the picker (a downloaded asset is a `BundledAsset` like any other and goes
 * through the same door).
 *
 * This window never reaches archive.org itself. The CSP forbids it and the
 * test in `catalog.test.ts` asserts it; main does the fetching.
 */
import { useEffect, useRef, useState } from 'react';
import type { CatalogClip, CatalogHit, CatalogProgress } from '@shared/ipc';
import { registerLibraryEntries } from './assets';

const PRESETS = ['vj loops', 'abstract animation loop', 'particles loop', 'fire loop', 'light leaks'] as const;

interface Props {
  /** Called after an asset was registered, so the panels' pickers refresh. */
  onAdded?: (id: string) => void;
}

export function CatalogPanel({ onAdded }: Props): React.JSX.Element {
  const [query, setQuery] = useState('vj loops');
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>('');
  const [progress, setProgress] = useState<Record<string, CatalogProgress>>({});
  const [added, setAdded] = useState<Record<string, string>>({});
  /** Expanded packs: the clip list main returned for an item, by identifier. */
  const [clips, setClips] = useState<Record<string, CatalogClip[]>>({});
  const [listing, setListing] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const off = window.engine.onCatalogProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.identifier]: p }));
    });
    return () => {
      alive.current = false;
      off();
    };
  }, []);

  const search = async (q: string): Promise<void> => {
    const text = q.trim();
    if (text === '') return;
    setBusy(true);
    setNote('');
    try {
      const found = await window.engine.searchCatalog({ query: text });
      if (!alive.current) return;
      setHits(found);
      setNote(found.length === 0 ? 'nothing found — or no network. Main logs the reason.' : '');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const add = async (hit: CatalogHit, file?: string): Promise<void> => {
    setNote('');
    const result = await window.engine.addFromCatalog(file === undefined ? { hit } : { hit, file });
    if (!alive.current) return;
    if (!result.ok) {
      setNote(result.reason);
      return;
    }
    const ids = registerLibraryEntries([result.entry]);
    setAdded((prev) => ({ ...prev, [file === undefined ? hit.identifier : `${hit.identifier}/${file}`]: result.entry.id }));
    for (const id of ids) onAdded?.(id);
    if (ids.length === 0) setNote(`${result.entry.name} was already in the library`);
  };

  /**
   * One item is usually a PACK. Ask main which clips it holds; one clip adds
   * straight away, several open a clip list with the Archive's per-clip thumbs.
   */
  const open = async (hit: CatalogHit): Promise<void> => {
    setNote('');
    setListing(hit.identifier);
    try {
      const result = await window.engine.listCatalogFiles({ hit });
      if (!alive.current) return;
      if (!result.ok) {
        setNote(result.reason);
        return;
      }
      if (result.clips.length === 1) {
        await add(hit, result.clips[0]?.name);
        return;
      }
      setClips((prev) => ({ ...prev, [hit.identifier]: result.clips }));
    } finally {
      if (alive.current) setListing(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <form
        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <input
          type="search"
          value={query}
          placeholder="search the Internet Archive…"
          aria-label="catalog search"
          style={inputStyle}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <button type="submit" style={buttonStyle} disabled={busy}>
          {busy ? 'searching…' : 'Search'}
        </button>
      </form>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            style={chipStyle}
            onClick={() => {
              setQuery(p);
              void search(p);
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: '#6f767d' }}>
        Only CC0 and CC-BY items can be added (I-10). Video loops come home as the smallest MP4 the
        projector can play; one instance per face means one decoder per face — keep video on
        single-face roles. Abstract content only: skew is invisible in fire and particles.
      </p>
      {note && (
        <p style={{ margin: 0, fontSize: 12, color: '#ffb4b4' }}>{note}</p>
      )}
      <div style={gridStyle}>
        {hits.map((hit) => {
          const p = progress[hit.identifier];
          const done = added[hit.identifier];
          const downloading = p !== undefined && !p.done;
          const pct = p && p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : null;
          return (
            <div key={hit.identifier} style={cardStyle}>
              <div style={thumbWrap}>
                <img src={hit.thumbUrl} alt="" style={thumbStyle} loading="lazy" draggable={false} />
                <span style={{ ...badgeStyle, position: 'absolute', left: 4, top: 4 }}>
                  {hit.kind === 'video' ? '▶ video' : 'image'}
                </span>
                <span
                  style={{
                    ...badgeStyle,
                    position: 'absolute',
                    right: 4,
                    top: 4,
                    color: hit.license ? '#7CFFB2' : '#ffb4b4',
                  }}
                  title={hit.licenseUrl || 'no license URL on the item'}
                >
                  {hit.license ?? 'no license'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#e6ebf0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={hit.title}>
                {hit.title}
              </div>
              <div style={{ fontSize: 10, color: '#6f767d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hit.creator || hit.identifier} · {hit.downloads.toLocaleString()} downloads
              </div>
              {downloading ? (
                <div style={barTrack} aria-label="download progress">
                  <div style={{ ...barFill, width: `${pct ?? 5}%` }} />
                </div>
              ) : (
                <button
                  type="button"
                  style={{ ...buttonStyle, opacity: hit.license ? 1 : 0.5 }}
                  disabled={!hit.license || done !== undefined || listing === hit.identifier}
                  title={
                    hit.license
                      ? 'List the clips in this item; a single clip downloads into assets/library straight away'
                      : `Cannot add: ${hit.licenseUrl || 'no license'} is not CC0 / CC-BY (I-10)`
                  }
                  onClick={() => void open(hit)}
                >
                  {done
                    ? 'in library ✓'
                    : listing === hit.identifier
                      ? 'reading…'
                      : hit.license
                        ? clips[hit.identifier]
                          ? `${clips[hit.identifier]?.length} clips ▾`
                          : '+ open / add'
                        : 'not addable'}
                </button>
              )}
              {clips[hit.identifier] && (
                <div style={clipGrid} aria-label={`clips in ${hit.title}`}>
                  {clips[hit.identifier]?.map((clip) => {
                    const key = `${hit.identifier}/${clip.name}`;
                    const inLib = added[key] !== undefined;
                    return (
                      <button
                        key={clip.name}
                        type="button"
                        style={{ ...clipTile, borderColor: inLib ? '#7CFFB2' : '#2b2f34' }}
                        disabled={inLib || downloading}
                        title={`${clip.name} · ${(clip.bytes / 1048576).toFixed(1)} MB${clip.seconds ? ` · ${clip.seconds.toFixed(1)} s` : ''}${clip.width ? ` · ${clip.width}×${clip.height}` : ''}`}
                        onClick={() => void add(hit, clip.name)}
                      >
                        <img src={clip.thumbUrl} alt="" style={clipThumb} loading="lazy" draggable={false} />
                        <span style={clipCaption}>
                          {inLib ? '✓ ' : ''}
                          {clip.label}
                          {/* W1 fix: the resolution BEFORE the download, and low-res named as such. */}
                          {clip.width ? ` · ${clip.width}×${clip.height}` : ''}
                          {clip.lowRes ? <span style={{ color: '#d8b45a' }}> · low-res</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 inherit',
};

const buttonStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#191c1f',
  color: 'inherit',
  font: '12px/1.2 inherit',
  cursor: 'pointer',
};

const chipStyle: React.CSSProperties = {
  ...buttonStyle,
  padding: '2px 8px',
  borderRadius: 999,
  color: '#a9b1b8',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  gap: 8,
  maxHeight: 420,
  overflowY: 'auto',
};

const cardStyle: React.CSSProperties = {
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

const thumbStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const badgeStyle: React.CSSProperties = {
  font: '600 9px/1.2 ui-monospace, Menlo, monospace',
  color: '#c7ced4',
  background: 'rgba(0,0,0,.6)',
  padding: '1px 4px',
  borderRadius: 3,
};

const clipGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
  gap: 4,
  maxHeight: 180,
  overflowY: 'auto',
  paddingTop: 4,
  borderTop: '1px solid #2b2f34',
};

const clipTile: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: 2,
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#000',
  color: 'inherit',
  cursor: 'pointer',
};

const clipThumb: React.CSSProperties = {
  width: '100%',
  aspectRatio: '4 / 3',
  objectFit: 'cover',
  display: 'block',
  borderRadius: 2,
};

const clipCaption: React.CSSProperties = {
  fontSize: 9,
  color: '#a9b1b8',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const barTrack: React.CSSProperties = {
  height: 6,
  borderRadius: 3,
  background: '#1a1f24',
  overflow: 'hidden',
};

const barFill: React.CSSProperties = {
  height: '100%',
  background: '#40e0ff',
  transition: 'width .2s linear',
};
