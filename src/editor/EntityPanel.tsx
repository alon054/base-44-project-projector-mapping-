/**
 * The per-entity control panel (P5-F): what one layer is, and every parameter
 * it has.
 *
 * **There is not one hard-coded parameter key in this file, and that is the
 * point.** Every control comes from `entityParamGroups(registry, id)`, which
 * enumerates what I-8 actually holds for that layer, and every one of them is a
 * `<ParamControl>`, which reads and writes only through the registry. So the
 * checklist's "per-entity params driven through `registry.write`, never by
 * mutating a layer" is not a rule this file follows — it is the only thing this
 * file is able to do. A parameter that exists is drawn; one that is not
 * registered cannot be drawn; and `controls.test.ts` reads this file's source
 * to check that every `paramKey` passed below is the loop variable over the
 * registry's own keys and never a literal, so a later edit cannot quietly
 * introduce one.
 *
 * The exception is the picker at the top, and it is an exception on purpose:
 * `kind` and `assetId` are `STRUCTURAL_CONTENT_KEYS` in both providers because
 * changing one replaces the layer rather than modulating it. That is a scene
 * edit, it goes through `applyContentChoice`, and `controls.ts`'s header is
 * where the distinction is written down.
 */
import { useMemo } from 'react';
import type { Scene } from '../core/scene';
import type { ParameterRegistry } from '../core/parameters';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import { editorLibrary } from './assets';
import { ContentPicker } from './ContentPicker';
import { ParamControl } from './ParamControl';
import {
  applyContentChoice,
  contentChoices,
  currentChoiceId,
  entityParamGroups,
  toggleSection,
  type PanelUi,
} from './controls';

interface Props {
  scene: Scene;
  setScene: (update: (prev: Scene) => Scene) => void;
  registry: ParameterRegistry;
  layerId: string | null;
  ui: PanelUi;
  setUi: (ui: PanelUi) => void;
  /** Ticks when a catalog asset lands, so the choice list is re-derived. */
  libraryVersion: number;
  /**
   * Off where the layer list already has a picker on the row (the Layers
   * column): one layer, one picker. On by default for the Everything mode,
   * where this panel is the only one.
   */
  showContentPicker?: boolean;
}

export function EntityPanel({
  scene,
  setScene,
  registry,
  layerId,
  ui,
  setUi,
  libraryVersion,
  showContentPicker = true,
}: Props): React.JSX.Element {
  // Rebuilt only when the library grows (a catalog asset landed), never on a
  // slider drag — sorting the catalog sixty times a second is what the memo
  // exists to avoid.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const choices = useMemo(() => contentChoices(editorLibrary.all()), [libraryVersion]);

  if (layerId === null) {
    return <p style={{ margin: 0, color: '#8b939b' }}>No layers. Add one in the layer list.</p>;
  }
  const layer = scene.layers.find((l) => l.id === layerId);
  if (!layer) {
    return <p style={{ margin: 0, color: '#8b939b' }}>That layer is gone.</p>;
  }

  const groups = entityParamGroups(registry, layerId);
  const chosen = currentChoiceId(scene, layerId, choices);
  const open = (section: string): boolean => ui.openSections.includes(section);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: 13, color: '#e6ebf0' }}>{layer.name}</strong>
        <span style={keyStyle}>entity.{layer.id}.*</span>
      </div>

      {/* The picker. A plain dropdown this block — the library browser is P8-B. */}
      {showContentPicker && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12, color: '#c7ced4', width: 148 }} htmlFor="content-choice">
          Content
        </label>
        <ContentPicker
          id="content-choice"
          choices={choices}
          chosen={chosen}
          library={editorLibrary}
          providerId={layer.providerId}
          onPick={(next) => setScene((prev) => applyContentChoice(prev, layerId, next))}
        />
      </div>
      )}

      <Section
        title={`Parameters (${groups.layer.length + groups.content.length})`}
        id="params"
        open={open('params')}
        onToggle={() => setUi(toggleSection(ui, 'params'))}
      >
        {[...groups.layer, ...groups.content].map((key) => (
          <ParamControl key={key} registry={registry} paramKey={key} />
        ))}
      </Section>

      {/*
        I-18's four fields, P5-C's arithmetic, this block's controls. `period`
        is what the entity takes to walk the route once; `orient` turns it to
        face its heading; `endBehavior` is what happens at the end; and
        `phaseOffset` is the one that makes two entities on one route differ by
        nothing else, which is Gate 5's own condition.
      */}
      <Section
        title={`Motion along a route — I-18 (${groups.motion.length})`}
        id="motion"
        open={open('motion')}
        onToggle={() => setUi(toggleSection(ui, 'motion'))}
      >
        {groups.motion.map((key) => (
          <ParamControl key={key} registry={registry} paramKey={key} />
        ))}
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#6f767d' }}>
          Declared on the entity, never on the path (D21): a route is a shape and knows nothing
          about who walks it, so two entities can share one and differ only by phase offset.
        </p>
      </Section>

      <Section
        title={`Susceptibility — I-4 (${groups.susceptibility.length} of ${FORCE_DEFINITIONS.length} forces)`}
        id="susceptibility"
        open={open('susceptibility')}
        onToggle={() => setUi(toggleSection(ui, 'susceptibility'))}
      >
        {groups.susceptibility.map((key) => (
          <ParamControl key={key} registry={registry} paramKey={key} />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  id: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={{ borderTop: '1px solid #2b2f34', paddingTop: 8 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          background: 'none',
          border: 'none',
          color: '#6ea8ff',
          fontSize: 11,
          cursor: 'pointer',
          padding: '2px 0 6px',
        }}
      >
        {open ? '▾' : '▸'} {title}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

const keyStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#6f767d',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const selectStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 inherit',
};
