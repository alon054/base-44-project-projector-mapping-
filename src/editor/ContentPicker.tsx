/**
 * The content picker with a picture of each choice.
 *
 * The dropdown stays — it is the accessible control and the one the existing
 * tests know — and a strip of thumbnails sits under it so a builder can see
 * what "White puff (25f)" IS before putting it on a wall. Both fire the same
 * structural edit (`onPick` → `applyContentChoice` in the caller); this file
 * writes no parameter and knows nothing about the registry.
 *
 * WHAT A THUMBNAIL IS, PER KIND — and why no thumbnail is ever rendered:
 *
 *  - still: the image itself, `object-fit: contain`.
 *  - spritesheet: the sheet as a CSS background sized to `columns × rows`, so
 *    the tile shows FRAME 0 and not the whole grid.
 *  - video: the poster (I-7's preview rung — no `<video>` is constructed here,
 *    exactly as in the preview canvas).
 *  - lottie: a label. Rendering one for a thumbnail would spin up a player per
 *    tile; the picker is not the place to spend that.
 *  - procedural: a label on a swatch. There is no file to show.
 *
 * Every image URL is one the CSP already allows: a bundled `?url` import, or a
 * `library://` file main serves from disk. Nothing here reaches the network.
 */
import { useState } from 'react';
import type { AssetLibrary, BundledAsset } from '../core/library';
import type { ContentChoice } from './controls';

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
  /** Start with the strip open. Off by default in dense panels. */
  browse?: boolean;
}

export function ContentPicker({
  choices,
  chosen,
  library,
  onPick,
  providerId,
  id,
  ariaLabel,
  browse = false,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(browse);
  const groups = [...new Set(choices.map((c) => c.group))];

  return (
    <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                .filter((c) => c.group === group)
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
          title="Show a picture of each choice"
          aria-pressed={open}
          onClick={() => setOpen((o) => !o)}
        >
          ▦
        </button>
      </div>
      {open && (
        <div style={stripStyle} role="listbox" aria-label="content previews">
          {choices.map((c) => {
            const asset = typeof c.content['assetId'] === 'string' ? library.get(c.content['assetId']) : undefined;
            const selected = c.id === chosen;
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={selected}
                title={`${c.label} — ${c.group}${asset ? ` · ${asset.license.license}` : ''}`}
                style={{ ...tileStyle, borderColor: selected ? '#40e0ff' : '#2b2f34' }}
                onClick={() => onPick(c)}
              >
                <Thumb asset={asset} label={c.label} />
                <span style={captionStyle}>{c.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The picture for one choice. See the file header for what each kind shows. */
function Thumb({ asset, label }: { asset: BundledAsset | undefined; label: string }): React.JSX.Element {
  if (!asset) {
    return (
      <div style={{ ...thumbBox, background: 'linear-gradient(135deg, #1d2a33, #2a1d33)' }}>
        <span style={badgeStyle}>{label}</span>
      </div>
    );
  }
  switch (asset.kind) {
    case 'still':
      return <img src={asset.url} alt="" style={{ ...thumbBox, objectFit: 'contain' }} draggable={false} />;
    case 'spritesheet':
      return (
        <div
          style={{
            ...thumbBox,
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
        <div style={{ ...thumbBox, position: 'relative' }}>
          <img src={asset.posterUrl} alt="" style={{ ...thumbBox, objectFit: 'cover' }} draggable={false} />
          <span style={{ ...badgeStyle, position: 'absolute', right: 3, bottom: 3 }}>▶ {asset.loopSeconds}s</span>
        </div>
      );
    case 'lottie':
      return (
        <div style={{ ...thumbBox, background: '#1a1f24' }}>
          <span style={badgeStyle}>Lottie · {asset.loopSeconds}s</span>
        </div>
      );
  }
}

const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 inherit',
};

const toggleStyle: React.CSSProperties = {
  padding: '2px 7px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 inherit',
  cursor: 'pointer',
};

const stripStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  overflowX: 'auto',
  padding: '4px 2px',
};

const tileStyle: React.CSSProperties = {
  flex: '0 0 auto',
  width: 84,
  display: 'grid',
  gap: 3,
  padding: 3,
  borderRadius: 5,
  border: '1px solid #2b2f34',
  background: '#0f1214',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
};

const thumbBox: React.CSSProperties = {
  width: 76,
  height: 46,
  borderRadius: 3,
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
  maxWidth: 70,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
