/**
 * The layer list: add / remove / reorder / select, and the four layer-level
 * parameters — opacity, blend mode, visibility, depth.
 *
 * Every per-layer edit goes through the I-8 registry (`entity.<id>.*`) rather
 * than mutating the layer directly. Structure — which layers exist and in what
 * order — is not a parameter and is edited on the scene itself.
 *
 * **P5-F made that a mechanism rather than a habit.** The four parameter rows
 * were four hand-written `registry.write` calls naming four keys; they are now
 * `entityParamGroups(registry, id).layer` rendered through `<ParamControl>`,
 * which is the only component in the editor that writes a parameter at all. A
 * fifth layer-level parameter registered in `defineLayerParameters` appears
 * here by existing, and a control for a key that is not registered cannot be
 * written down. `depth` is the immediate proof: it was addressable from Phase 1
 * and printed here as text, and it became operable without this file learning
 * its name.
 */
import { useState } from 'react';
import type { SceneFailure } from '@shared/ipc';
import type { BlendMode } from '../core/layer';
import type { ParameterRegistry } from '../core/parameters';
import { layersInDrawOrder, type Scene } from '../core/scene';
import { addLayer, moveLayer, removeLayer, reorderLayer } from '../core/sceneEdit';
import { ParamControl } from './ParamControl';
import { capWarnings, entityParamGroups } from './controls';
import { editorLibrary } from './assets';
import {
  PROCEDURAL_KINDS,
  PROCEDURAL_PROVIDER_ID,
  type ProceduralKind,
} from '../providers/procedural/ProceduralProvider';

interface Props {
  scene: Scene;
  setScene: (update: (prev: Scene) => Scene) => void;
  registry: ParameterRegistry;
  /** I-13, reported by the output window. */
  failures: SceneFailure[];
  /** Which layer the per-entity panel is showing. Panel UI state, never scene state. */
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function LayerPanel({
  scene,
  setScene,
  registry,
  failures,
  selectedId,
  onSelect,
}: Props): React.JSX.Element {
  const ordered = layersInDrawOrder(scene);
  const failureFor = (id: string): SceneFailure | undefined =>
    failures.find((f) => f.layerId === id);

  const add = (kind: ProceduralKind): void => {
    setScene((prev) =>
      addLayer(prev, {
        idPrefix: kind,
        providerId: PROCEDURAL_PROVIDER_ID,
        content: { kind },
        ...(kind === 'glow' ? { blendMode: 'add' as BlendMode } : {}),
      }),
    );
  };

  const remove = (id: string): void => setScene((prev) => removeLayer(prev, id));
  const move = (id: string, delta: number): void =>
    setScene((prev) => moveLayer(prev, id, delta));

  /**
   * Drag-and-drop reordering. The grip is the drag source rather than the whole
   * row: a draggable row swallows pointer gestures on the sliders inside it, so
   * the opacity control would stop working in exchange for a nicer reorder.
   */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const endDrag = (): void => {
    setDragId(null);
    setDropIndex(null);
  };

  const dropOn = (index: number): void => {
    const id = dragId;
    endDrag();
    if (id === null) return;
    setScene((prev) => reorderLayer(prev, id, index));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PROCEDURAL_KINDS.map((kind) => (
          <button key={kind} type="button" style={addButtonStyle} onClick={() => add(kind)}>
            + {kind}
          </button>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: '#6f767d' }}>
        Listed back to front — the last row draws on top. Drag the <span aria-hidden>⠿</span> grip
        to reorder, or use ↑ / ↓. <code>fault</code> throws on purpose (I-13): it must show a
        magenta placeholder, never blank the frame.
      </p>

      {/*
        §10 row 2, in front of the operator — the line Phase 3 deferred to
        Phase 5. **A warning and never a refusal**: nothing above is disabled,
        no layer is rejected, and there is no code path here that could do
        either. Six concurrent videos cost 15 late frames in 3555 and one
        150 ms hitch, which is a visible stumble and not a failure, and this is
        performance equipment (I-13) — see `core/library.ts` for the ladder
        that measured it. The sentence is the output window's own `[caps]`
        wording, from the same function, so the wall's log and this box cannot
        come to disagree.
      */}
      {capWarnings(scene, editorLibrary).map(({ breach, text }) => (
        <div
          key={breach.kind}
          style={{
            border: '1px solid #8a6d1f',
            background: '#2a2410',
            borderRadius: 5,
            padding: '7px 9px',
            fontSize: 12,
            color: '#f0d68a',
          }}
        >
          <strong>[caps] warning</strong> — {text}
        </div>
      ))}

      {ordered.length === 0 && (
        <p style={{ margin: 0, color: '#8b939b' }}>No layers. The output is the background only.</p>
      )}

      {ordered.map((layer, i) => {
        const failure = failureFor(layer.id);
        return (
          <div
            key={layer.id}
            onDragOver={(e) => {
              if (dragId === null) return;
              // Without preventDefault the browser refuses the drop entirely.
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dropIndex !== i) setDropIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              dropOn(i);
            }}
            onClick={() => onSelect(layer.id)}
            style={{
              border: `1px solid ${
                dropIndex === i && dragId !== null && dragId !== layer.id
                  ? '#7CFFB2'
                  : failure
                    ? '#7a2a72'
                    : layer.id === selectedId
                      ? '#40e0ff'
                      : '#2b2f34'
              }`,
              borderRadius: 5,
              padding: 8,
              background: failure ? '#1d1420' : '#191c1f',
              opacity: dragId === layer.id ? 0.45 : 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                draggable
                onDragStart={(e) => {
                  setDragId(layer.id);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox refuses to start a drag without payload. The id is
                  // carried in React state; this is only to satisfy the API.
                  e.dataTransfer.setData('text/plain', layer.id);
                }}
                onDragEnd={endDrag}
                title="Drag to reorder"
                aria-label={`Drag ${layer.name} to reorder`}
                style={{
                  cursor: 'grab',
                  color: '#6f767d',
                  padding: '0 2px',
                  userSelect: 'none',
                }}
              >
                ⠿
              </span>
              <code style={{ flex: 1, fontSize: 12 }}>
                z{layer.zOrder} {layer.name}
              </code>
              <button
                type="button"
                style={iconButtonStyle}
                disabled={i === 0}
                title="Move back"
                onClick={() => move(layer.id, -1)}
              >
                ↓
              </button>
              <button
                type="button"
                style={iconButtonStyle}
                disabled={i === ordered.length - 1}
                title="Move forward"
                onClick={() => move(layer.id, 1)}
              >
                ↑
              </button>
              <button
                type="button"
                style={iconButtonStyle}
                title="Delete"
                onClick={() => remove(layer.id)}
              >
                ✕
              </button>
            </div>

            {failure && (
              <p style={{ margin: 0, fontSize: 11, color: '#ff7ae6' }}>
                I-13 placeholder: {failure.reason}
              </p>
            )}

            {/*
              Enumerated from the registry, not written out. See this file's
              header: the panel does not know these keys' names, so it cannot
              have a control that writes to something the registry does not
              hold, and it cannot miss one that the registry does.
            */}
            {entityParamGroups(registry, layer.id).layer.map((key) => (
              <ParamControl key={key} registry={registry} paramKey={key} />
            ))}

            <code style={{ fontSize: 10, color: '#5c6470' }}>
              entity.{layer.id}.* · {layer.providerId}
            </code>
          </div>
        );
      })}
    </div>
  );
}

const addButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#191c1f',
  color: 'inherit',
  font: '12px/1.2 inherit',
  cursor: 'pointer',
};

const iconButtonStyle: React.CSSProperties = {
  padding: '2px 7px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 inherit',
  cursor: 'pointer',
};
