/**
 * The Layers column — Photoshop's list over the scene: folders, rows, drag
 * to reorder or to file, an eye per row, a picker for a row or a whole
 * folder. The pure half is `layerTreeModel.ts`; this file is presentation and
 * drag state.
 *
 * What it may write, and through what:
 *  - **structure** (order, folders, membership, names, existence) through
 *    `core/sceneEdit.ts` and `layerTreeModel.ts`'s `dropLayer` — `setScene`;
 *  - **parameters** (the eye is `entity.<id>.visible`, a folder's mode is
 *    `group.<id>.mode`, a block's length is `child.<id>.duration`) through
 *    `<ParamControl compact>` and nothing else — `controls.test.ts` keeps
 *    `ParamControl` the one writer in the editor;
 *  - **content** through `applyContentChoice`, the same call every picker
 *    makes; a folder's picker is that call once per child.
 *
 * Rename is an inline field that commits on Enter or blur — one write per
 * name, never per keystroke (S2's reason: a scene write is a rebuild).
 */
import { useMemo, useState } from 'react';
import type { SceneFailure } from '@shared/ipc';
import type { ParameterRegistry } from '../core/parameters';
import type { Scene } from '../core/scene';
import { groupDuration } from '../core/groups';
import { resolveRole } from '../core/roles';
import { addGroup, removeGroup, removeLayer, renameLayer } from '../core/sceneEdit';
import { removeSurface, withSurfaceGuide, withSurfaceName, type SurfaceTree } from '../core/surfaces';
import { faceOfLayer } from './faceLayers';
import { CONCURRENCY_CAPS } from '../core/library';
import { editorLibrary } from './assets';
import { ContentPicker } from './ContentPicker';
import { ParamControl } from './ParamControl';
import { applyContentChoice, contentChoices, currentChoiceId } from './controls';
import { applyChoiceToFolder, buildLayerTree, dropLayer, flattenTree, folderLabel, type DropTarget, type TreeRow } from './layerTreeModel';

interface Props {
  scene: Scene;
  setScene: (update: (prev: Scene) => Scene) => void;
  registry: ParameterRegistry;
  surfaces: SurfaceTree;
  /**
   * The room after an edit — a face's name, its guide grid, its deletion —
   * because a face's row IS the face (`faceLayers.ts`). Goes to `App`'s one
   * room writer; this file never touches the room tree itself.
   */
  onSurfaces: (tree: SurfaceTree) => void;
  failures: SceneFailure[];
  /** Panel UI state, never scene state. One of the two is set, or neither. */
  selectedLayerId: string | null;
  selectedGroupId: string | null;
  onSelectLayer: (id: string) => void;
  onSelectGroup: (id: string) => void;
  libraryVersion: number;
}

const PER_INSTANCE_COST = new Set(['video', 'lottie']);

export function LayerTree({
  scene,
  setScene,
  registry,
  surfaces,
  onSurfaces,
  failures,
  selectedLayerId,
  selectedGroupId,
  onSelectLayer,
  onSelectGroup,
  libraryVersion,
}: Props): React.JSX.Element {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const assets = useMemo(() => editorLibrary.all(), [libraryVersion]);
  const choices = useMemo(() => contentChoices(assets), [assets]);
  const rows = flattenTree(buildLayerTree(scene));

  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const endDrag = (): void => {
    setDragId(null);
    setOver(null);
  };
  const drop = (target: DropTarget): void => {
    const id = dragId;
    endDrag();
    if (id === null) return;
    setScene((prev) => dropLayer(prev, id, target));
  };
  const dragHandlers = (key: string, target: DropTarget) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragId === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== key) setOver(key);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      drop(target);
    },
  });

  const commitRename = (): void => {
    const r = renaming;
    setRenaming(null);
    if (!r) return;
    // A face's row renames the FACE (room); any other row renames the layer.
    const layer = scene.layers.find((l) => l.id === r.id);
    const face = layer ? faceOfLayer(layer, surfaces) : undefined;
    if (face) onSurfaces(withSurfaceName(surfaces, face.id, r.text));
    else setScene((prev) => renameLayer(prev, r.id, r.text));
  };

  const layerRow = (row: Extract<TreeRow, { kind: 'layer' }>): React.JSX.Element => {
    const { layer, group, blockIndex } = row;
    const face = faceOfLayer(layer, surfaces);
    const shownName = face ? face.name : layer.name;
    const selected = layer.id === selectedLayerId && selectedGroupId === null;
    const failure = failures.find((f) => f.layerId === layer.id);
    const faces = layer.fillRole ? resolveRole(layer.fillRole, surfaces).surfaces : [];
    const asset = assets.find((a) => a.id === layer.content['assetId']);
    const cap = asset && PER_INSTANCE_COST.has(asset.kind) ? (CONCURRENCY_CAPS as Record<string, number>)[asset.kind] : undefined;
    const overCap = cap !== undefined && faces.length > cap;
    const what = asset ? asset.name : String(layer.content['kind'] ?? layer.providerId);
    const key = `layer:${layer.id}`;
    return (
      <div key={key} style={{ display: 'grid', gap: 4, gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div
          {...dragHandlers(key, { kind: 'before', layerId: layer.id })}
          onClick={() => onSelectLayer(layer.id)}
          style={{
            ...rowStyle,
            paddingLeft: group ? 22 : 6,
            borderColor: over === key && dragId !== null && dragId !== layer.id ? '#7CFFB2' : failure ? '#7a2a72' : selected ? '#40e0ff' : '#2b2f34',
            background: selected ? '#16303a' : failure ? '#1d1420' : '#191c1f',
            opacity: dragId === layer.id ? 0.45 : layer.visible ? 1 : 0.55,
          }}
        >
          <span
            draggable
            onDragStart={(e) => {
              setDragId(layer.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', layer.id);
            }}
            onDragEnd={endDrag}
            title="Drag above another row to reorder, onto a folder to file it"
            aria-label={`drag ${shownName}`}
            style={gripStyle}
          >
            ⠿
          </span>
          <span onClick={(e) => e.stopPropagation()} title="visible">
            <ParamControl registry={registry} paramKey={`entity.${layer.id}.visible`} label="visible" compact />
          </span>
          {blockIndex !== null && <span style={blockNo}>{blockIndex + 1}.</span>}
          {renaming?.id === layer.id ? (
            <input
              autoFocus
              value={renaming.text}
              aria-label={`rename ${shownName}`}
              spellCheck={false}
              style={renameStyle}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenaming({ id: layer.id, text: e.currentTarget.value })}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <span
              style={nameStyle}
              title={`${shownName} — double-click to rename`}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setRenaming({ id: layer.id, text: shownName });
              }}
            >
              {face ? '▱ ' : ''}
              {shownName}
            </span>
          )}
          <span
            style={chipStyle}
            title={face ? `${what} on this face` : layer.fillRole ? `fills role "${layer.fillRole}" · ${faces.length} face${faces.length === 1 ? '' : 's'}` : 'draws in its own rectangle, on no face'}
          >
            {what}
            {face ? '' : layer.fillRole ? ` → ${layer.fillRole} · ${faces.length}` : ''}
          </span>
          {face && (
            <label
              onClick={(e) => e.stopPropagation()}
              style={gridLabel}
              title="White guide grid on this face on the projector. Off once the face has its animation unless you pin it on. g on the output hides them all."
            >
              <input
                type="checkbox"
                checked={face.guide ?? false}
                aria-label={`guide grid on ${face.name}`}
                onChange={(e) => onSurfaces(withSurfaceGuide(surfaces, face.id, e.currentTarget.checked))}
              />
              grid
            </label>
          )}
          {group?.mode === 'sequence' && (
            <span onClick={(e) => e.stopPropagation()} title="block length, seconds">
              <ParamControl registry={registry} paramKey={`child.${layer.id}.duration`} label="seconds" compact />
            </span>
          )}
          <button
            type="button"
            style={{ ...iconStyle, ...(pickerFor === layer.id ? iconOn : {}) }}
            title="Pick this layer's animation"
            onClick={(e) => {
              e.stopPropagation();
              onSelectLayer(layer.id);
              setPickerFor(pickerFor === layer.id ? null : layer.id);
            }}
          >
            ▦
          </button>
          <button
            type="button"
            style={iconStyle}
            title={face ? 'Delete this face — its light goes out on the wall' : 'Delete this layer'}
            onClick={(e) => {
              e.stopPropagation();
              // A face's row deletes the FACE; its layer follows through
              // `syncFaceLayers` in App, the one place that rule lives.
              if (face) onSurfaces(removeSurface(surfaces, face.id));
              else setScene((prev) => removeLayer(prev, layer.id));
            }}
          >
            ✕
          </button>
        </div>
        {failure && <p style={noteStyle('#ff7ae6')}>I-13 placeholder: {failure.reason}</p>}
        {overCap && (
          <p style={noteStyle('#ffb4b4')}>
            {`${asset?.kind} × ${faces.length} faces = ${faces.length} decoders against a cap of ${cap} — expect a stumble (SPRINT.md R2).`}
          </p>
        )}
        {pickerFor === layer.id && (
          <div style={{ paddingLeft: group ? 22 : 6, minWidth: 0, overflow: 'hidden' }}>
            <ContentPicker
              choices={choices}
              chosen={currentChoiceId(scene, layer.id, choices)}
              library={editorLibrary}
              providerId={layer.providerId}
              ariaLabel={`animation for ${shownName}`}
              onPick={(next) => setScene((prev) => applyContentChoice(prev, layer.id, next))}
            />
          </div>
        )}
      </div>
    );
  };

  const folderRow = (row: Extract<TreeRow, { kind: 'folder' }>): React.JSX.Element => {
    const { group, children } = row;
    const key = `folder:${group.id}`;
    const selected = group.id === selectedGroupId;
    const label = folderLabel(group);
    const chosenId = children.length > 0 ? currentChoiceId(scene, children[0]!.id, choices) : null;
    return (
      <div
        key={key}
        {...dragHandlers(key, { kind: 'into', groupId: group.id })}
        onClick={() => onSelectGroup(group.id)}
        style={{
          ...rowStyle,
          borderColor: over === key && dragId !== null ? '#7CFFB2' : selected ? '#40e0ff' : '#3a3f45',
          background: selected ? '#16303a' : '#1e2226',
        }}
      >
        <span style={{ ...gripStyle, cursor: 'default' }} aria-hidden>
          📁
        </span>
        <span style={nameStyle} title={`${label} · ${group.id} — drop a layer here to put it inside`}>
          {label}
        </span>
        <span onClick={(e) => e.stopPropagation()} title="together: all at once · in turn: one after another">
          <ParamControl registry={registry} paramKey={`group.${group.id}.mode`} label="mode" compact />
        </span>
        <span style={chipStyle}>
          {children.length} layer{children.length === 1 ? '' : 's'}
          {group.mode === 'sequence' ? ` · ${groupDuration(group).toFixed(1)} s` : ''}
        </span>
        <button
          type="button"
          style={{ ...iconStyle, ...(pickerFor === group.id ? iconOn : {}) }}
          title="Pick one animation for every layer in this folder"
          disabled={children.length === 0}
          onClick={(e) => {
            e.stopPropagation();
            onSelectGroup(group.id);
            setPickerFor(pickerFor === group.id ? null : group.id);
          }}
        >
          ▦
        </button>
        <button
          type="button"
          style={iconStyle}
          title="Delete the folder. Its layers stay and go back to the root."
          onClick={(e) => { e.stopPropagation(); setScene((prev) => removeGroup(prev, group.id)); }}
        >
          ✕
        </button>
        {pickerFor === group.id && children.length > 0 && (
          <div style={{ gridColumn: '1 / -1', minWidth: 0, overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            <ContentPicker
              choices={choices}
              chosen={chosenId}
              library={editorLibrary}
              providerId={children[0]!.providerId}
              ariaLabel={`animation for every layer in ${label}`}
              onPick={(next) => setScene((prev) => applyChoiceToFolder(prev, group.id, next))}
            />
          </div>
        )}
      </div>
    );
  };

  // `minmax(0, 1fr)`: a grid track is as wide as its widest item unless told
  // otherwise, and an open picker's thumbnail strip would widen every row
  // past the column, taking the row buttons with it.
  return (
    <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#8b939b', alignSelf: 'center' }}>
          Trace a face on the stage — it appears here as a layer, white until you pick its animation.
        </span>
        <button type="button" style={addStyle} title="A folder whose layers all run together" onClick={() => setScene((prev) => addGroup(prev, 'parallel'))}>
          + folder
        </button>
        <button type="button" style={addStyle} title="A folder whose layers play one after another, each for its seconds, looping" onClick={() => setScene((prev) => addGroup(prev, 'sequence'))}>
          + folder, in turn
        </button>
      </div>
      {rows.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: '#8b939b' }}>
          No layers yet. Pick <strong>Rect</strong> under the stage and drag over a box.
        </p>
      )}
      {rows.map((row) => (row.kind === 'folder' ? folderRow(row) : layerRow(row)))}
      <div
        {...dragHandlers('root-end', { kind: 'root-end' })}
        style={{
          ...rootZone,
          borderColor: over === 'root-end' && dragId !== null ? '#7CFFB2' : '#2b2f34',
          opacity: dragId === null ? 0.5 : 1,
        }}
      >
        {dragId === null ? 'top covers what is below · drop here to send to the back, out of any folder' : 'drop: to the back, out of any folder'}
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto auto auto minmax(60px, 1fr) auto auto auto auto auto',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  borderRadius: 5,
  border: '1px solid #2b2f34',
  cursor: 'default',
  minWidth: 0,
};

const gripStyle: React.CSSProperties = { cursor: 'grab', color: '#6f767d', padding: '0 2px', userSelect: 'none' };
const blockNo: React.CSSProperties = { fontSize: 11, color: '#8b939b', fontFamily: 'ui-monospace, Menlo, monospace' };
const nameStyle: React.CSSProperties = { fontSize: 12, color: '#e6ebf0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };
const chipStyle: React.CSSProperties = { fontSize: 10, color: '#8b939b', fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 };
const renameStyle: React.CSSProperties = { font: '12px/1.2 inherit', padding: '1px 4px', borderRadius: 3, border: '1px solid #40e0ff', background: '#0d1013', color: '#e6ebf0', minWidth: 0 };
const iconStyle: React.CSSProperties = { padding: '1px 6px', borderRadius: 4, border: '1px solid #2b2f34', background: '#15181b', color: 'inherit', font: '12px/1.2 inherit', cursor: 'pointer' };
const iconOn: React.CSSProperties = { borderColor: '#40e0ff', background: '#16303a' };
const addStyle: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid #2b2f34', background: '#191c1f', color: 'inherit', font: '12px/1.2 inherit', cursor: 'pointer' };
const rootZone: React.CSSProperties = { border: '1px dashed #2b2f34', borderRadius: 5, padding: '6px 8px', fontSize: 10, color: '#6f767d', textAlign: 'center' };
const gridLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#8b939b', cursor: 'pointer', whiteSpace: 'nowrap' };
const noteStyle = (color: string): React.CSSProperties => ({ margin: 0, fontSize: 11, color, paddingLeft: 6 });
