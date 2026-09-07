/**
 * One control, for one parameter key. The panel's whole vocabulary (P5-F).
 *
 * **It takes a key and nothing else about the value.** No min, no max, no
 * label, no kind — all of that comes from `registry.definition(key)`, and the
 * write goes back through `registry.write(key, v)`. That is what makes "every
 * control writes through the registry" a property of the code rather than a
 * discipline: this component cannot be pointed at a value that is not in the
 * registry, because there is no parameter to pass it one.
 *
 * `registry.read` on every render rather than a cached value: the registry is
 * an index onto scene state (I-12), and a cached copy here would be a second
 * source of truth for the same number — `ForcePanel`'s `ParamSlider` settled
 * this in Phase 4 and this is the same decision, generalised to the other two
 * kinds.
 *
 * An unknown key renders nothing rather than throwing. A panel that white-
 * screens because a layer was deleted a frame before its controls re-rendered
 * is a worse failure than a row that is briefly absent (I-13's principle), and
 * the selection is corrected in `controls.ts` on the same pass anyway.
 */
import type { ParameterRegistry } from '../core/parameters';
import { DebouncedTextInput } from './DebouncedTextInput';

interface Props {
  registry: ParameterRegistry;
  paramKey: string;
  /** Overrides the definition's own label. For a row whose group already says it. */
  label?: string;
}

/**
 * Every write below lands in scene state through the accessors the registry
 * holds, and scene state is React state in `App`, so the re-render is the
 * write's own consequence and there is no change callback to forget to pass.
 */
export function ParamControl({ registry, paramKey, label }: Props): React.JSX.Element | null {
  const def = registry.definition(paramKey);
  if (!def) return null;

  const write = (v: number | boolean | string): void => {
    registry.write(paramKey, v);
  };

  const shown = label ?? def.label;

  return (
    <div style={rowStyle}>
      <div>
        <div style={labelStyle}>{shown}</div>
        {/*
          The hierarchical key, printed beside the control it drives. Gate 4
          asked that every force be "enumerable from the parameter registry by
          hierarchical key" and this is what made that checkable by reading the
          panel out loud; P5-F extends it to every entity parameter for the same
          reason — a key that is registered but wrong is visible rather than
          buried.
        */}
        <div style={keyStyle}>{paramKey}</div>
      </div>

      {def.kind === 'number' && (
        <input
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={registry.read(paramKey) as number}
          onChange={(e) => write(Number(e.currentTarget.value))}
        />
      )}
      {def.kind === 'boolean' && (
        <input
          type="checkbox"
          checked={registry.read(paramKey) as boolean}
          onChange={(e) => write(e.currentTarget.checked)}
        />
      )}
      {/*
        B3. A free string, for `fillRole` and `travelRole` (SPRINT.md §3 R2).

        Not on blur: the builder is at the wall typing a role, and a value that
        lands only when focus leaves the field is a face that lights when they
        click somewhere else. But not per keystroke either (S2): every commit
        is a `registry.write`, which is a new scene, which the output rebuilds
        whole — a decoder per character with a video fill. The field commits
        250 ms after the last keystroke through the editor's one debounce
        (`debouncedText.ts`); the write itself is still `registry.write`, here.

        `def.default` as the placeholder, so an empty field shows what empty
        MEANS rather than looking like a field that failed to load.
      */}
      {def.kind === 'text' && (
        <DebouncedTextInput
          value={registry.read(paramKey) as string}
          placeholder={def.default === '' ? 'none' : def.default}
          maxLength={def.maxLength}
          spellCheck={false}
          style={textStyle}
          onCommit={(v) => write(v)}
        />
      )}
      {def.kind === 'enum' && (
        <select
          value={registry.read(paramKey) as string}
          style={selectStyle}
          onChange={(e) => write(e.currentTarget.value)}
        >
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}

      <span style={valueStyle}>{formatValue(registry.read(paramKey), def.kind)}</span>
    </div>
  );
}

/**
 * The readout beside the control.
 *
 * Fixed decimals for a number, because a slider reporting `0.30000000000000004`
 * is a control that looks broken. Integers stay integers — `drops` at 220 and
 * `tint` at 16711680 are both counts, not fractions, and `220.00` reads as a
 * measurement that has been rounded rather than a number that is exact.
 */
export function formatValue(v: number | boolean | string, kind: string): string {
  if (kind === 'boolean') return v ? 'on' : 'off';
  if (typeof v !== 'number') return String(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '148px 1fr 62px',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
};

const labelStyle: React.CSSProperties = { fontSize: 12, color: '#c7ced4' };

const keyStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#6f767d',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const valueStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#c7ced4',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  textAlign: 'right',
  overflow: 'hidden',
};

const textStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace',
  minWidth: 0,
};

const selectStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #2b2f34',
  background: '#15181b',
  color: 'inherit',
  font: '12px/1.2 inherit',
};
