/**
 * Groups — "together" and "in turn" (I-16, D18). Sprint block B4's minimal UI.
 *
 * Not the block strip. P7-C's strip draws duration-proportional blocks laid
 * end to end with draggable edges; this is a list with a slider per child,
 * which is enough to time a sequence for a camera and nothing more.
 *
 * The one distinction `controls.ts` exists to keep, kept here too:
 *
 *  - **Parameters** — a group's `mode`, a child's `duration` — are registered
 *    under `group.<id>.mode` and `child.<id>.duration` (I-8) and are drawn as
 *    `<ParamControl>`s, the only component in the editor that writes a
 *    parameter. This file never calls `registry.write`.
 *  - **Structure** — which groups exist, which layer is in which, in what
 *    order — goes through `core/sceneEdit.ts`: `addGroup`, `removeGroup`,
 *    `setLayerGroup`, `moveChild`.
 *
 * FOR THE REEL'S BEAT 6. Give every face a role like `panel f1`, `panel f2`,
 * … (`roleTokens`: a face carries every word of its role). One layer at
 * `fillRole: panel` in no group fills them all, all the time. Then a sequence
 * of layers, one per tag — `f1`, `f2`, … — lights them one after another on
 * top of it. Both from one clock; neither knows about the other.
 */
import type { ParameterRegistry } from '../core/parameters';
import type { Scene } from '../core/scene';
import { groupDuration, rootGroup } from '../core/groups';
import { addGroup, moveChild, removeGroup, setLayerGroup } from '../core/sceneEdit';
import { ParamControl } from './ParamControl';

interface Props {
  scene: Scene;
  setScene: (update: (prev: Scene) => Scene) => void;
  registry: ParameterRegistry;
}

export function GroupPanel({ scene, setScene, registry }: Props): React.JSX.Element {
  const nameOf = (layerId: string): string =>
    scene.layers.find((l) => l.id === layerId)?.name ?? layerId;
  const ungrouped = rootGroup(scene).children.map((c) => c.id);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={buttonStyle}
          title="A group whose children play one after another, each for its duration, looping."
          onClick={() => setScene((prev) => addGroup(prev, 'sequence'))}
        >
          + sequence
        </button>
        <button
          type="button"
          style={buttonStyle}
          title="A group whose children all run together — what every layer does with no group."
          onClick={() => setScene((prev) => addGroup(prev, 'parallel'))}
        >
          + parallel
        </button>
        <span style={{ fontSize: 12, color: '#8b939b' }}>
          {scene.groups.length === 0
            ? 'no groups — every layer runs together (the implicit parallel root)'
            : `${ungrouped.length} layer${ungrouped.length === 1 ? '' : 's'} in the root, running throughout`}
        </span>
      </div>

      {scene.groups.map((group) => {
        const total = groupDuration(group);
        // `flatMap` rather than a filter over the layers: `sceneEdit.test.ts`
        // greps for that spelling as the engine's one structural removal.
        const candidates = scene.layers.flatMap((l) =>
          group.children.some((c) => c.id === l.id) ? [] : [l],
        );
        return (
          <div key={group.id} style={groupStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ fontSize: 12, flex: 1 }}>
                {group.id}
                {group.mode === 'sequence' ? ` · ${total.toFixed(1)} s loop` : ''}
              </code>
              <button
                type="button"
                style={iconButtonStyle}
                title="Delete the group. Its layers go back to the root and keep playing."
                onClick={() => setScene((prev) => removeGroup(prev, group.id))}
              >
                ✕
              </button>
            </div>
            <ParamControl registry={registry} paramKey={`group.${group.id}.mode`} />

            {group.children.length === 0 && (
              <p style={{ margin: 0, fontSize: 11, color: '#6f767d' }}>
                Empty. Add a layer below
                {group.mode === 'sequence' ? ' — the order here is the order they play in.' : '.'}
              </p>
            )}
            {group.children.map((child, i) => (
              <div key={child.id} style={childStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ fontSize: 12, flex: 1 }}>
                    {group.mode === 'sequence' ? `${i + 1}. ` : ''}
                    {nameOf(child.id)}
                  </code>
                  {group.mode === 'sequence' && (
                    <>
                      <button
                        type="button"
                        style={iconButtonStyle}
                        disabled={i === 0}
                        title="Earlier"
                        onClick={() => setScene((prev) => moveChild(prev, group.id, child.id, -1))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        style={iconButtonStyle}
                        disabled={i === group.children.length - 1}
                        title="Later"
                        onClick={() => setScene((prev) => moveChild(prev, group.id, child.id, 1))}
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    style={iconButtonStyle}
                    title="Take out of the group (back to the root)"
                    onClick={() => setScene((prev) => setLayerGroup(prev, child.id, null))}
                  >
                    ⤴
                  </button>
                </div>
                {group.mode === 'sequence' && (
                  <ParamControl registry={registry} paramKey={`child.${child.id}.duration`} />
                )}
              </div>
            ))}

            {candidates.length > 0 && (
              <select
                value=""
                aria-label={`add a layer to ${group.id}`}
                style={selectStyle}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  if (id !== '') setScene((prev) => setLayerGroup(prev, id, group.id));
                }}
              >
                <option value="">+ add a layer to this group…</option>
                {candidates.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.fillRole ? ` → ${l.fillRole}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

const groupStyle: React.CSSProperties = {
  border: '1px solid #2b2f34',
  borderRadius: 5,
  padding: 8,
  background: '#191c1f',
  display: 'grid',
  gap: 6,
};

const childStyle: React.CSSProperties = {
  borderLeft: '2px solid #2b2f34',
  paddingLeft: 8,
  display: 'grid',
  gap: 4,
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
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 inherit',
};
