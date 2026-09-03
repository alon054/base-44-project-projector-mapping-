/**
 * The layer list: add / remove / reorder, opacity and blend mode per layer.
 *
 * Every per-layer edit goes through the I-8 registry (`entity.<id>.*`) rather
 * than mutating the layer directly. Structure — which layers exist and in what
 * order — is not a parameter and is edited on the scene itself.
 */
import type { SceneFailure } from '@shared/ipc';
import { BLEND_MODES, type BlendMode } from '../core/layer';
import type { ParameterRegistry } from '../core/parameters';
import { layersInDrawOrder, type Scene } from '../core/scene';
import { addLayer, moveLayer, removeLayer } from '../core/sceneEdit';
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
}

export function LayerPanel({ scene, setScene, registry, failures }: Props): React.JSX.Element {
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
        Listed back to front — the last row draws on top. <code>fault</code> throws on purpose
        (I-13): it must show a magenta placeholder, never blank the frame.
      </p>

      {ordered.length === 0 && (
        <p style={{ margin: 0, color: '#8b939b' }}>No layers. The output is the background only.</p>
      )}

      {ordered.map((layer, i) => {
        const failure = failureFor(layer.id);
        return (
          <div
            key={layer.id}
            style={{
              border: `1px solid ${failure ? '#7a2a72' : '#2b2f34'}`,
              borderRadius: 5,
              padding: 8,
              background: failure ? '#1d1420' : '#191c1f',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 11, color: '#8b939b', width: 52 }} htmlFor={`o-${layer.id}`}>
                opacity
              </label>
              <input
                id={`o-${layer.id}`}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={layer.opacity}
                style={{ flex: 1 }}
                onChange={(e) =>
                  registry.write(`entity.${layer.id}.opacity`, Number(e.currentTarget.value))
                }
              />
              <code style={{ fontSize: 11, color: '#8b939b', width: 34 }}>
                {layer.opacity.toFixed(2)}
              </code>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 11, color: '#8b939b', width: 52 }} htmlFor={`b-${layer.id}`}>
                blend
              </label>
              <select
                id={`b-${layer.id}`}
                value={layer.blendMode}
                style={selectStyle}
                onChange={(e) =>
                  registry.write(`entity.${layer.id}.blendMode`, e.currentTarget.value as BlendMode)
                }
              >
                {BLEND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <label style={{ fontSize: 11, color: '#8b939b', display: 'flex', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(e) => registry.write(`entity.${layer.id}.visible`, e.currentTarget.checked)}
                />
                visible
              </label>
            </div>

            <code style={{ fontSize: 10, color: '#5c6470' }}>
              entity.{layer.id}.* · {layer.providerId} · depth {layer.depth.toFixed(2)}
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

const selectStyle: React.CSSProperties = {
  flex: 1,
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 inherit',
};
