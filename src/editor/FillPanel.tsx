/**
 * Swap what a bound layer fills its faces with — SPRINT.md's "white → animation"
 * beat, in one control.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS WHEN `EntityPanel` ALREADY HAS A CONTENT PICKER.
 *
 * It does, and it is the same call — `applyContentChoice`, from the same
 * `contentChoices` list. But reaching it means leaving wall mode, finding the
 * layer in the layer list, selecting it, and opening the entity panel: four
 * steps through two panels that wall mode exists to hide. "Swap the fill white
 * to an animation, do all five faces change at once" is a NAMED step of the
 * first wall session, and a named step that takes four clicks through a panel
 * the builder cannot see is the tool-dropdown failure again.
 *
 * So this is a second VIEW of one mechanism, not a second mechanism. It does not
 * write a parameter (`ParamControl` is still the only thing that does), it does
 * not know what content is, and it cannot express anything the entity panel
 * cannot — it just lists the layers that are bound to a role, which is exactly
 * the set a builder at a wall is thinking about.
 *
 * WHY IT WARNS ABOUT VIDEO AND LOTTIE.
 *
 * SPRINT.md §3 R2 records the consequence rather than leaving it to be
 * discovered: **one fill instance per matching surface means one decoder per
 * matching surface.** A role matching four faces with a video fill is four
 * decoders against `MAX_CONCURRENT_VIDEO` of 4. That is invisible in the
 * picker — the choice reads "seamless (video)" whether the role matches one face
 * or six — so the count is put next to it, before the click rather than after
 * the stutter. It WARNS and never refuses: §10's ruling is that this is
 * performance equipment and a stumble that can be flagged is not a reason to
 * stop an operator (I-13).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useMemo } from 'react';
import type { Scene } from '../core/scene';
import { applyContentChoice, contentChoices, currentChoiceId } from './controls';
import { editorLibrary } from './assets';
import { resolveRole } from '../core/roles';
import type { SurfaceTree } from '../core/surfaces';
import { CONCURRENCY_CAPS } from '../core/library';

interface Props {
  scene: Scene;
  setScene: (update: (prev: Scene) => Scene) => void;
  /** The room, so a fill can say how many faces it is about to land on. */
  surfaces: SurfaceTree;
}

/** Asset kinds that cost a decoder per instance. See this file's header. */
const PER_INSTANCE_COST = new Set(['video', 'lottie']);

export function FillPanel({ scene, setScene, surfaces }: Props): React.JSX.Element | null {
  const assets = useMemo(() => editorLibrary.all(), []);
  const choices = useMemo(() => contentChoices(assets), [assets]);

  const fills = scene.layers.filter((l) => l.fillRole !== undefined);
  if (fills.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
      {fills.map((layer) => {
        const role = layer.fillRole as string;
        const faces = resolveRole(role, surfaces).surfaces.length;
        const chosen = currentChoiceId(scene, layer.id, choices);
        const asset = assets.find((a) => a.id === layer.content['assetId']);
        const cap = asset && PER_INSTANCE_COST.has(asset.kind)
          ? (CONCURRENCY_CAPS as Record<string, number>)[asset.kind]
          : undefined;
        const overCap = cap !== undefined && faces > cap;

        return (
          <div key={layer.id} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#c7ced4', minWidth: 0, flex: '0 1 auto' }}>
                {layer.name}
              </span>
              <code style={{ fontSize: 11, color: '#6f767d' }}>
                → {role} · {faces} face{faces === 1 ? '' : 's'}
              </code>
              <select
                value={chosen ?? ''}
                aria-label={`fill content for ${layer.name}`}
                style={selectStyle}
                onChange={(e) => {
                  const next = choices.find((c) => c.id === e.currentTarget.value);
                  // One call, the same one the entity panel makes. It spreads
                  // the layer, so `fillRole` survives the swap — the faces keep
                  // their binding and only what is drawn into them changes.
                  if (next) setScene((prev) => applyContentChoice(prev, layer.id, next));
                }}
              >
                {chosen === null && (
                  <option value="">{`${layer.providerId} — not in the picker`}</option>
                )}
                {[...new Set(choices.map((c) => c.group))].map((group) => (
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
            </div>
            {asset && PER_INSTANCE_COST.has(asset.kind) && faces > 1 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: overCap ? '#ffb4b4' : '#d8b45a',
                }}
              >
                {`${asset.kind} × ${faces} faces = ${faces} decoder${faces === 1 ? '' : 's'}`}
                {cap === undefined ? '' : ` against a cap of ${cap}`}
                {overCap
                  ? ' — over the cap. Expect a stumble; put this role on one face, or use procedural content (SPRINT.md R2).'
                  : ' — at the limit. Multi-face roles want procedural or sprite content.'}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
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
