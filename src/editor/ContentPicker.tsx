/**
 * The content picker: a picture of every choice, and the current one beside
 * the dropdown.
 *
 * The dropdown stays — it is the accessible control and the one the existing
 * tests know — and the grid under it is open by default: a builder choosing
 * what goes on a wall wants to see "White puff (25f)" before putting it there,
 * not after. Both fire the same structural edit (`onPick` →
 * `applyContentChoice` in the caller); this file writes no parameter and knows
 * nothing about the registry.
 *
 * WHAT A THUMBNAIL IS, PER KIND:
 *
 *  - procedural: the kind itself, drawn once offscreen (`thumbnails.ts`) at
 *    the golden instant; a kind that cannot be drawn (`fault`) shows its name.
 *  - still: the image, `object-fit: contain`.
 *  - spritesheet: the sheet as a CSS background sized to `columns × rows`, so
 *    the tile shows FRAME 0 and not the whole grid.
 *  - video: the poster (I-7's preview rung — no `<video>` is constructed here,
 *    exactly as in the preview canvas).
 *  - lottie: a label. Rendering one for a tile would spin up a player per tile.
 *
 * Every image URL is one the CSP already allows: a bundled `?url` import, a
 * `library://` file main serves from disk, or a `data:` URL this window drew.
 * Nothing here reaches the network.
 */
import { useState } from 'react';
import type { AssetLibrary, BundledAsset } from '../core/library';
import type { ContentChoice } from './controls';
import { useProceduralThumb } from './thumbnails';

interface Props {
  choices: readonly ContentChoice[];
  /** The choice the layer currently is, or `null` for content no choice describes. */
  chosen: string | null;
  library: AssetLibrary;
  onPick: (choice: ContentChoice) => void;
  /** For the empty option's text when `chosen` is null. */
  providerId: string;
  id?: string;
  ariaLabel?: string;
  /** Start with the grid open. On by default — the picture IS the picker. */
  browse?: boolean;
}

/** Downloaded assets are the third group, after `contentChoices`' two. */
const DOWNLOADED_GROUP = 'Downloaded (Library)';

export function ContentPicker({
  choices,
  chosen,
  library,
  onPick,
  providerId,
  id,
  ariaLabel,
  browse = true,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(browse);
  const groupOf = (c: ContentChoice): string => {
    const asset = assetOf(c, library);
    return asset && asset.url.startsWith('library://') ? DOWNLOADED_GROUP : c.group;
  };
  const groups = [...new Set(choices.map(groupOf))];
  const current = choices.find((c) => c.id === chosen) ?? null;

  return (
    <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={currentBox} title={current ? `${current.label} — ${groupOf(current)}` : 'nothing picked'}>
          {current ? <Thumb asset={assetOf(current, library)} choice={current} small /> : <span style={badgeStyle}>none</span>}
        </div>
        <select
          {...(id ? { id } : {})}
          {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
          value={chosen ?? ''}
          style={selectStyle}
          onChange={(e) => {
            const next = choices.find((c) => c.id === e.currentTarget.value);
            if (next) onPick(next);
          }}
        >
          {chosen === null && <option value="">{`${providerId} — not in the picker`}</option>}
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {choices
                .filter((c) => groupOf(c) === group)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          style={{ ...toggleStyle, borderColor: open ? '#40e0ff' : '#2b2f34' }}
          title={open ? 'Hide the pictures' : 'Show a picture of each choice'}
          aria-pressed={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '▾ pictures' : '▸ pictures'}
        </button>
      </div>
      {open && (
        <div style={gridStyle} role="listbox" aria-label="content previews">
          {groups.map((group) => (
            <div key={group} style={{ display: 'contents' }}>
              <div style={groupLabel}>{group}</div>
              {choices
                .filter((c) => groupOf(c) === group)
                .map((c) => {
                  const asset = assetOf(c, library);
                  const selected = c.id === chosen;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={`${c.label}${asset ? ` · ${asset.kind} · ${asset.license.license}` : ''}`}
                      style={{
                        ...tileStyle,
                        borderColor: selected ? '#40e0ff' : '#2b2f34',
                        boxShadow: selected ? '0 0 0 1px #40e0ff inset' : 'none',
                      }}
                      onClick={() => onPick(c)}
                    >
                      <Thumb asset={asset} choice={c} />
                      <span style={captionStyle}>{c.label}</span>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function assetOf(c: ContentChoice, library: AssetLibrary): BundledAsset | undefined {
  const id = c.content['assetId'];
  return typeof id === 'string' ? library.get(id) : undefined;
}

/** The picture for one choice. See the file header for what each kind shows. */
function Thumb({
  asset,
  choice,
  small = false,
}: {
  asset: BundledAsset | undefined;
  choice: ContentChoice;
  small?: boolean;
}): React.JSX.Element {
  const kind = typeof choice.content['kind'] === 'string' && !asset ? choice.content['kind'] : null;
  const drawn = useProceduralThumb(kind);
  const box = small ? thumbSmall : thumbBox;
  if (!asset) {
    if (drawn) return <img src={drawn} alt="" style={{ ...box, objectFit: 'cover' }} draggable={false} />;
    return (
      <div style={{ ...box, background: 'linear-gradient(135deg, #1d2a33, #2a1d33)' }}>
        <span style={badgeStyle}>{choice.label}</span>
      </div>
    );
  }
  switch (asset.kind) {
    case 'still':
      return <img src={asset.url} alt="" style={{ ...box, objectFit: 'contain' }} draggable={false} />;
    case 'spritesheet':
      return (
        <div
          style={{
            ...box,
            backgroundImage: `url("${asset.url}")`,
            backgroundSize: `${asset.columns * 100}% ${asset.rows * 100}%`,
            backgroundPosition: '0 0',
            backgroundRepeat: 'no-repeat',
          }}
          title={`frame 0 of ${asset.frames}`}
        />
      );
    case 'video':
      return (
        <div style={{ ...box, position: 'relative' }}>
          <img src={asset.posterUrl} alt="" style={{ ...box, objectFit: 'cover' }} draggable={false} />
          {!small && (
            <span style={{ ...badgeStyle, position: 'absolute', right: 3, bottom: 3 }}>▶ {asset.loopSeconds}s</span>
          )}
        </div>
      );
    case 'lottie':
      return (
        <div style={{ ...box, background: '#1a1f24' }}>
          <span style={badgeStyle}>{small ? 'Lottie' : `Lottie · ${asset.loopSeconds}s`}</span>
        </div>
      );
  }
}

const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 inherit',
};

const toggleStyle: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: '#a9b1b8',
  font: '11px/1.2 inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
  gap: 6,
  maxHeight: 236,
  overflowY: 'auto',
  padding: '4px 2px',
  border: '1px solid #1f2327',
  borderRadius: 5,
  background: '#0f1214',
};

const groupLabel: React.CSSProperties = {
  gridColumn: '1 / -1',
  font: '600 10px/1.4 ui-monospace, Menlo, monospace',
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  color: '#6f767d',
  padding: '4px 4px 0',
};

const tileStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: 3,
  borderRadius: 5,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  minWidth: 0,
};

const thumbBox: React.CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 9',
  borderRadius: 3,
  background: '#000',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const thumbSmall: React.CSSProperties = {
  width: 64,
  height: 36,
  borderRadius: 3,
  background: '#000',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const currentBox: React.CSSProperties = {
  flex: '0 0 auto',
  width: 64,
  height: 36,
  borderRadius: 3,
  border: '1px solid #2b2f34',
  background: '#000',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const captionStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#a9b1b8',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const badgeStyle: React.CSSProperties = {
  font: '600 9px/1.2 ui-monospace, Menlo, monospace',
  color: '#c7ced4',
  background: 'rgba(0,0,0,.55)',
  padding: '1px 4px',
  borderRadius: 3,
  maxWidth: 84,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
