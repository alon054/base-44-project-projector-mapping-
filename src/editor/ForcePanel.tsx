/**
 * The force controls — Gate 4's instrument.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LESSON FROM THREE PHASES, APPLIED FORWARD AGAIN.
 *
 * Phase 1: a scene that could not demonstrate its invariant. Phase 2: a control
 * that could not be operated — 28 passing warp tests and three of four corner
 * handles uncatchable by a human hand. Phase 3: an instrument that lied in six
 * different ways.
 *
 * Phase 4's analogous failure is a force bus that is provably correct and whose
 * effect nobody can see. This panel is built against that, and three of its
 * decisions are load-bearing rather than cosmetic:
 *
 * **Every control goes through `registry.write(key, v)`.** Not through
 * `setScene`. I-8 says every parameter is addressable; a panel that reached
 * into scene state directly would leave the registry a table nothing reads
 * until Phase 11 asks it to carry MIDI — and Phase 11 would then discover which
 * keys were never actually wired. Here, if a key is missing or misnamed, the
 * slider does not work, immediately, in front of the operator.
 *
 * **The hierarchical key is printed next to every control.** Gate 4 asks that
 * "every force is enumerable from the parameter registry by hierarchical key".
 * That condition is checkable by reading this panel out loud. It also means a
 * key that is registered but wrong is visible rather than buried.
 *
 * **Susceptibility is shown as a column beside the force that drives it.** Gate
 * 4's first condition is "one wind slider visibly affects multiple entities at
 * once, scaled by their individual susceptibility" — which is one sentence
 * about two numbers. Putting the per-entity subscriptions next to the force's
 * own sliders is what lets an operator drag one control and watch which
 * entities respond and by how much, without holding a table in their head.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState } from 'react';
import { FORCE_DEFINITIONS } from '../core/forceDefs';
import { depthGain } from '../core/forces';
import type { ParameterRegistry, NumberParameterDef } from '../core/parameters';
import type { Scene } from '../core/scene';

interface Props {
  /** Re-renders this panel when anything it writes changes (I-12). */
  scene: Scene;
  registry: ParameterRegistry;
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '132px 1fr 56px',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
};

const keyStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#6f767d',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const labelStyle: React.CSSProperties = { fontSize: 12, color: '#c7ced4' };
const valueStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#c7ced4',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  textAlign: 'right',
};

/**
 * One registry-backed slider. Reads and writes exclusively by key.
 *
 * `registry.read` on every render rather than a cached value: the registry is
 * an index onto scene state (I-12), and a cached copy here would be a second
 * source of truth for the same number — the exact thing the registry's own
 * header says it exists to avoid.
 */
function ParamSlider({
  registry,
  paramKey,
  label,
  digits = 2,
}: {
  registry: ParameterRegistry;
  paramKey: string;
  label: string;
  digits?: number;
}): React.JSX.Element | null {
  const def = registry.definition(paramKey);
  if (!def || def.kind !== 'number') return null;
  const spec = def as NumberParameterDef;
  const value = registry.read(paramKey) as number;
  return (
    <div style={rowStyle}>
      <div>
        <div style={labelStyle}>{label}</div>
        <div style={keyStyle}>{paramKey}</div>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => registry.write(paramKey, Number(e.target.value))}
      />
      <span style={valueStyle}>{value.toFixed(digits)}</span>
    </div>
  );
}

export function ForcePanel({ scene, registry }: Props): React.JSX.Element {
  const [openForce, setOpenForce] = useState<string | null>('wind');

  // Enumerated from the REGISTRY, not from the definitions list, so what the
  // panel shows is what I-8 actually holds. If a force existed but was never
  // registered, it would be missing here and the gate condition would fail
  // visibly instead of passing on a definition nobody wired up.
  const registeredForceKeys = registry.keys('force');

  return (
    <div>
      {FORCE_DEFINITIONS.map((force) => {
        const keys = registeredForceKeys.filter((k) => k.startsWith(`force.${force.id}.`));
        const open = openForce === force.id;
        // How many entities this force reaches, by the same rule the bus uses:
        // a stated susceptibility, or the definition's default.
        const reached = scene.layers.filter((l) => {
          const stated = l.susceptibility[force.id];
          const s = typeof stated === 'number' ? stated : force.defaultSusceptibility;
          return s > 0;
        }).length;

        return (
          <div
            key={force.id}
            style={{ borderTop: '1px solid #2b2f34', paddingTop: 8, marginBottom: 8 }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <strong style={{ fontSize: 13, color: '#e6ebf0' }}>{force.label}</strong>
              <span style={keyStyle}>force.{force.id}.*</span>
              <span
                style={{
                  fontSize: 11,
                  marginLeft: 'auto',
                  // The one thing the operator must not miss: a force they are
                  // dragging that reaches nothing. Same signal as the
                  // `** REACHES NOTHING **` marker on the `[force]` log line.
                  color: reached === 0 ? '#ff6b6b' : '#8b939b',
                }}
              >
                reaches {reached}/{scene.layers.length} entities
              </span>
            </div>

            {keys.map((k) => {
              const suffix = k.slice(`force.${force.id}.`.length);
              const p = force.params.find((x) => x.key === suffix);
              return (
                <ParamSlider
                  key={k}
                  registry={registry}
                  paramKey={k}
                  label={`${p?.label ?? suffix}${p?.unit ? ` (${p.unit})` : ''}`}
                  digits={p?.unit === 'h' ? 2 : 3}
                />
              );
            })}

            <button
              type="button"
              onClick={() => setOpenForce(open ? null : force.id)}
              style={{
                background: 'none',
                border: 'none',
                color: '#6ea8ff',
                fontSize: 11,
                cursor: 'pointer',
                padding: '2px 0',
              }}
            >
              {open ? '▾' : '▸'} per-entity susceptibility ({scene.layers.length})
            </button>

            {open && (
              <div style={{ marginTop: 4, paddingLeft: 8 }}>
                {scene.layers.map((l) => (
                  <ParamSlider
                    key={l.id}
                    registry={registry}
                    paramKey={`entity.${l.id}.susceptibility.${force.id}`}
                    label={l.name}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/*
        Parallax is deliberately NOT under `force.*` — it is the viewpoint, and
        what scales it per entity is `depth`, which every layer already has.
        Filing it as a force would make Gate 4's "every force is enumerable"
        answer with something that is not one.
      */}
      <div style={{ borderTop: '1px solid #2b2f34', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ fontSize: 13, color: '#e6ebf0' }}>Parallax (D3 — not a force)</strong>
          <span style={keyStyle}>parallax.*</span>
        </div>
        <ParamSlider registry={registry} paramKey="parallax.x" label="Parallax X" digits={3} />
        <ParamSlider registry={registry} paramKey="parallax.y" label="Parallax Y" digits={3} />
        <div style={{ marginTop: 6 }}>
          {/*
            The depth gain per layer, printed. This is what makes "near layers
            shift more than far layers" a number the operator can check against
            what they see on the wall, rather than a claim about the code.
          */}
          {[...scene.layers]
            .sort((a, b) => a.depth - b.depth)
            .map((l) => (
              <div key={l.id} style={{ ...keyStyle, display: 'flex', gap: 6 }}>
                <span style={{ width: 150 }}>{l.name}</span>
                <span>depth {l.depth.toFixed(2)}</span>
                <span>→ ×{depthGain(l.depth).toFixed(2)}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
