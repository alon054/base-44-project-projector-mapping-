/**
 * The room, as a list: every marked face, its role, its size, and a delete.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS PANEL DOES NOT WRITE A PARAMETER.
 *
 * Every other control in this editor goes through `<ParamControl>` and
 * `registry.write` (I-8), and three tests in `controls.test.ts` keep it that
 * way. This one does not, and the reason is the same one that keeps the warp's
 * corners out of the registry: **a surface is not content.** It is the
 * description of a physical box in a physical room, it lives in `calibration/`
 * (I-5), and it survives every scene switch. Registering `surface.<id>.role`
 * would make the room MIDI-mappable in Phase 11 — a knob that re-tags a face
 * mid-show is an evening of marking destroyed with no undo, which is exactly
 * the argument `render/calibration.ts` already records for the corners.
 *
 * A layer's `fillRole` IS a parameter and IS registered, and the layer panel
 * writes it through `<ParamControl>` like everything else. The two halves of
 * I-15 meeting at a string is the point: the room says what a face IS, the
 * scene says what a layer FILLS, and neither imports the other.
 *
 * WHY THE ROLE IS A TEXT FIELD AND NOT A DROPDOWN.
 *
 * SPRINT.md §3 R2. A role is a free string typed by somebody standing in a dark
 * room. A dropdown would have to be built from the roles that already exist,
 * which on a fresh install is nothing at all, and it would make naming a new
 * role a two-step affordance at the exact moment the builder is holding a
 * projector remote. An unmatched role lights nothing and is fixed in one
 * keystroke; that is the stated exception to "refuse what is wrong".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Like every other panel here this is pure presentation over pure functions:
 * `withSurfaceName`, `withSurfaceRole` and `removeSurface` come from
 * `core/surfaces.ts`, and the resulting tree goes back to `App`, which is the
 * one place that writes the file and sends it to the wall.
 */
import {
  DEFAULT_SURFACE_ROLE,
  removeSurface,
  withSurfaceGuide,
  withSurfaceName,
  withSurfaceRole,
  type SurfaceTree,
} from '../core/surfaces';
import { DebouncedTextInput } from './DebouncedTextInput';
import { hasOwnFill } from './ownFill';
import { MASK_MIN_POINTS } from '../render/mask';
import { roleTokens } from '../core/roles';

interface Props {
  surfaces: SurfaceTree;
  /** The room after an edit. Written to disk and sent to the output by `App`. */
  onSurfaces: (tree: SurfaceTree) => void;
  /**
   * Which roles the scene's fill layers are asking for. Shown against each
   * face so "this face is tagged `panel` and nothing fills `panel`" is readable
   * from the panel rather than only from a dark rectangle on the wall (I-13).
   */
  filledRoles: readonly string[];
  /**
   * "Own": this face gets a private role and its own fill, so picking a
   * picture for it changes nothing else. "Share": back to `panel`. Both halves
   * — the room's and the scene's — are `App`'s to apply, one per tree
   * (`ownFill.ts`); this panel only asks.
   */
  onOwnFill: (surfaceId: string) => void;
  onShareFill: (surfaceId: string) => void;
}

export function SurfacePanel({ surfaces, onSurfaces, filledRoles, onOwnFill, onShareFill }: Props): React.JSX.Element {
  if (surfaces.length === 0) {
    return (
      <p style={{ margin: 0, color: '#8b939b', fontSize: 12 }}>
        No faces marked. Pick <strong>Rect</strong>, <strong>Triangle</strong> or{' '}
        <strong>Ellipse</strong> under the preview and drag on empty space; or <strong>Pen</strong>:
        click the corners and press Enter. Either banks the face and writes{' '}
        <code>surfaces.json</code>.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {surfaces.map((surface) => {
        const points = surface.path.points.length;
        // B2's rule, restated where the operator can act on it: a face with
        // fewer than three points encloses no area, so nothing can be clipped
        // to it. Not an error — it is what a face looks like mid-marking, and
        // one more point fixes it.
        const tooFew = points < MASK_MIN_POINTS;
        // Any token of the face's role that a layer fills lights it (`roleTokens`).
        const lit = roleTokens(surface.role).some((t) => filledRoles.includes(t));
        const own = hasOwnFill(surface);
        return (
          <div key={surface.id} style={rowStyle}>
            {/*
              S2. Name and role commit 250 ms after the last keystroke
              (`DebouncedTextInput`), not per character: `role` is in the
              shape key, so each commit is a full rebuild on the output, and a
              rebuild per character with a video fill is a decoder per
              character. The point drags in the preview are NOT debounced —
              a drag is a reshape and writes every sample (B3).
            */}
            <DebouncedTextInput
              value={surface.name}
              aria-label={`name of ${surface.id}`}
              spellCheck={false}
              style={{ ...fieldStyle, gridColumn: '1' }}
              onCommit={(v) => onSurfaces(withSurfaceName(surfaces, surface.id, v))}
            />
            <DebouncedTextInput
              value={surface.role}
              aria-label={`role of ${surface.id}`}
              placeholder={DEFAULT_SURFACE_ROLE}
              spellCheck={false}
              style={{
                ...fieldStyle,
                // Lit is not decoration. Four faces marked and one of them
                // silently mistyped is the failure this whole panel exists to
                // make visible before the builder is squinting at a wall.
                borderColor: lit ? '#2f7f92' : '#4a3a1a',
                color: lit ? '#c7ced4' : '#d8b45a',
              }}
              onCommit={(v) => onSurfaces(withSurfaceRole(surfaces, surface.id, v))}
            />
            {/*
              W1 fix. The face's guide grid on the projection. Checked = shown.
              Unset, it follows the rule the output applies: shown while nothing
              fills the face, hidden once something does — so the box reads
              "on" for a bare face and "off" the moment its animation lands,
              and a click pins either way. `lit` here is the same question the
              output answers with its fill instances.
            */}
            <label style={guideStyle} title="White guide grid on this face, on the projection. Unset: on until the face has a fill. g on the output hides them all.">
              <input
                type="checkbox"
                checked={surface.guide ?? !lit}
                aria-label={`guide grid on ${surface.name}`}
                onChange={(e) => onSurfaces(withSurfaceGuide(surfaces, surface.id, e.currentTarget.checked))}
              />
              grid
            </label>
            <button
              type="button"
              style={{ ...ownStyle, ...(own ? ownOnStyle : {}) }}
              aria-label={own ? `share ${surface.name}'s fill again` : `give ${surface.name} its own fill`}
              title={
                own
                  ? `Back to the shared fill: role "${DEFAULT_SURFACE_ROLE}" again, and this face's own fill layer is removed.`
                  : `Its own animation: this face leaves role "${DEFAULT_SURFACE_ROLE}", gets the role "${surface.id}" and a fill bound to it. Pick what it shows under Fill — nothing else changes.`
              }
              onClick={() => (own ? onShareFill(surface.id) : onOwnFill(surface.id))}
            >
              {own ? 'own ✓' : 'own'}
            </button>
            <span style={countStyle} title={surface.id}>
              {points} pt{points === 1 ? '' : 's'}
              {surface.path.closed ? '' : ' · open'}
              {tooFew ? ' · too few' : ''}
              {lit ? '' : ' · unfilled'}
            </span>
            <button
              type="button"
              style={deleteStyle}
              title={`delete ${surface.name} — its light goes out and nothing else changes`}
              onClick={() => onSurfaces(removeSurface(surfaces, surface.id))}
            >
              ×
            </button>
          </div>
        );
      })}
      <p style={{ margin: '2px 0 0', color: '#6f767d', fontSize: 11 }}>
        Every edit here rewrites <code>calibration/surfaces.json</code> and reaches the output
        window immediately — there is no save button (SPRINT.md §3 R1). Role is a free string:
        leave it <code>{DEFAULT_SURFACE_ROLE}</code> and every face shares one fill; set it to
        something else and only a layer naming that role fills it. <strong>own</strong> does that
        in one press: the face gets a private role and its own card under Fill.
      </p>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  // The role field is wide enough for two words (`panel f1`); the status
  // column sizes to its text so 'unfilled' is never clipped to 'unfille'.
  gridTemplateColumns: 'minmax(80px, 1fr) 120px auto auto auto 22px',
  alignItems: 'center',
  gap: 6,
};

const fieldStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace',
  minWidth: 0,
};

const guideStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 11,
  color: '#8b939b',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const ownStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#191c1f',
  color: '#8b939b',
  font: 'inherit',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const ownOnStyle: React.CSSProperties = {
  borderColor: '#2f7f92',
  color: '#c7ced4',
  background: '#16303a',
};

const countStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8b939b',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
};

const deleteStyle: React.CSSProperties = {
  padding: '2px 0',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#191c1f',
  color: '#c7ced4',
  font: 'inherit',
  cursor: 'pointer',
};
