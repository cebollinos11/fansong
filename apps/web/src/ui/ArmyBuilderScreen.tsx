import { useRef, useState } from 'react';
import {
  NAME_LIMITS,
  PRESET_IDS,
  PRESETS,
  STAT_BOUNDS,
  statErrors,
  unitCost,
  validateArmy,
  warbandCost,
  type ShooterKind,
  type Warband,
  type WarbandUnit,
} from '@fansong/content';
import {
  armyFileName,
  deleteArmy,
  loadArmies,
  newArmyId,
  parseArmyText,
  saveArmy,
  type SavedArmy,
} from '../game/armies.js';
import { browserStorage } from '../game/customMaps.js';
import { downloadJson } from '../game/replay-io.js';
import { spriteFor, spriteUrl } from '../three/unitSprites.js';
import { LookSprite, Picker, unitItem, warbandItem } from './Picker.js';
import { TraitEditor } from './TraitEditor.js';
import {
  ARMY_RULES_TEXT,
  armyFromPreset,
  blankUnit,
  EDITABLE_STATS,
  LOOKS,
  moveUnit,
  newArmy,
  presetTemplates,
  SHOOTER_OPTIONS,
  SHOOTER_TITLE,
  STAT_LABELS,
  templateUnit,
  withShooter,
  withStat,
  withTrait,
} from './armyView.js';

interface Props {
  onExit: () => void;
}

/** The army being edited: its storage id and the working copy of its roster. */
interface Editing {
  id: string;
  warband: Warband;
}

/**
 * The army builder: make, edit, save, import and export custom warbands. There
 * is no point limit — the total is shown so players can agree on one themselves.
 * Saved armies appear on the setup screen for local and online play alike.
 */
export function ArmyBuilderScreen({ onExit }: Props): JSX.Element {
  const storage = browserStorage();
  const [armies, setArmies] = useState<SavedArmy[]>(() => loadArmies(storage));
  const [editing, setEditing] = useState<Editing>(() => {
    const first = armies[0];
    return first ? { ...first } : { id: newArmyId(armies), warband: newArmy() };
  });
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const stored = armies.find((a) => a.id === editing.id);
  const dirty = !stored || JSON.stringify(stored.warband) !== JSON.stringify(editing.warband);
  const { warband } = editing;
  const check = validateArmy(warband);

  const report = (text: string, error = false): void => setStatus({ text, error });
  const discardOk = (): boolean =>
    !dirty || window.confirm(`Unsaved changes to "${warband.name}" will be lost. Continue?`);
  const open = (next: Editing): void => {
    if (!discardOk()) return;
    setEditing(next);
    setStatus(null);
  };

  const setWarband = (next: Warband): void => setEditing((e) => ({ ...e, warband: next }));
  const setUnits = (units: WarbandUnit[]): void => setWarband({ ...warband, units });
  const setUnit = (i: number, unit: WarbandUnit): void => setUnits(warband.units.map((u, j) => (j === i ? unit : u)));

  const save = (): void => {
    try {
      setArmies(saveArmy(storage, { id: editing.id, warband }));
      report(check.ok ? `Saved "${warband.name}".` : `Saved "${warband.name}" — fix the problems below to play it.`);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e), true);
    }
  };

  const remove = (): void => {
    if (!stored) {
      open({ id: newArmyId(armies), warband: newArmy() });
      return;
    }
    if (!window.confirm(`Delete "${stored.warband.name}"?`)) return;
    try {
      const kept = deleteArmy(storage, stored.id);
      setArmies(kept);
      setEditing(kept[0] ? { ...kept[0] } : { id: newArmyId(kept), warband: newArmy() });
      report(`Deleted "${stored.warband.name}".`);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e), true);
    }
  };

  const importFile = async (file: File): Promise<void> => {
    try {
      const imported = parseArmyText(await file.text());
      open({ id: newArmyId(armies), warband: imported });
      report(`Imported "${imported.name}" — save it to keep it.`);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e), true);
    }
  };

  const exit = (): void => {
    if (discardOk()) onExit();
  };

  return (
    <div className="army">
      <header className="army-header">
        <button className="ghost" onClick={exit}>
          ⟵ Back
        </button>
        <h1>Army builder</h1>
        <p className="hint">{ARMY_RULES_TEXT}</p>
      </header>

      <div className="army-body">
        <aside className="army-list">
          <h3>Your armies</h3>
          {armies.length === 0 ? <p className="hint">None saved yet.</p> : null}
          <ul>
            {armies.map((a) => {
              const ok = validateArmy(a.warband).ok;
              return (
                <li key={a.id}>
                  <button
                    className={a.id === editing.id ? 'army-item active' : 'army-item'}
                    onClick={() => a.id !== editing.id && open({ ...a })}
                  >
                    <span>{a.warband.name || '(unnamed)'}</span>
                    <span className="stats">
                      {ok ? `${warbandCost(a.warband)} pts · ${a.warband.units.length}` : 'needs fixing'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="army-list-actions">
            <button onClick={() => open({ id: newArmyId(armies), warband: newArmy() })}>+ New army</button>
            <Picker
              title="Start from a preset"
              kind="warband"
              groups={() => [{ items: PRESET_IDS.map((id) => warbandItem(id, PRESETS[id]!)) }]}
              onPick={(id) => open({ id: newArmyId(armies), warband: armyFromPreset(id) })}
            >
              Copy a preset…
            </Picker>
            <button onClick={() => fileInput.current?.click()}>Import…</button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
                e.target.value = '';
              }}
            />
          </div>
        </aside>

        <main className="army-editor">
          <div className="army-title">
            <input
              className="army-name"
              value={warband.name}
              maxLength={NAME_LIMITS.warband}
              aria-label="Army name"
              onChange={(e) => setWarband({ ...warband, name: e.target.value })}
            />
            <div className="army-total">
              <strong>{check.cost}</strong> pts · {warband.units.length} unit{warband.units.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="army-table-wrap">
            <table className="army-table">
              <UnitTableHead />
              <tbody>
                {warband.units.map((u, i) => (
                  <UnitRow
                    key={i}
                    unit={u}
                    first={i === 0}
                    last={i === warband.units.length - 1}
                    onChange={(next) => setUnit(i, next)}
                    onMove={(delta) => setUnits(moveUnit(warband.units, i, delta))}
                    onCopy={() => setUnits([...warband.units.slice(0, i + 1), templateUnit(u, warband.units), ...warband.units.slice(i + 1)])}
                    onRemove={() => setUnits(warband.units.filter((_, j) => j !== i))}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="army-add">
            <button onClick={() => setUnits([...warband.units, blankUnit(warband.units)])}>+ Add unit</button>
            <Picker
              title="Add a preset unit"
              kind="unit"
              groups={() =>
                presetTemplates().map((group, g) => ({
                  label: group.preset,
                  items: group.units.map((t, u) => unitItem(`${g}:${u}`, t)),
                }))
              }
              onPick={(key) => {
                const [g, u] = key.split(':').map(Number);
                const template = presetTemplates()[g!]?.units[u!];
                if (template) setUnits([...warband.units, templateUnit(template, warband.units)]);
              }}
            >
              Add a preset unit…
            </Picker>
          </div>

          {check.ok ? null : (
            <div className="editor-validation">
              <p>Can't be played yet:</p>
              <ul>
                {check.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="army-actions">
            <button className="primary" onClick={save} disabled={!dirty}>
              {dirty ? 'Save army' : 'Saved'}
            </button>
            <button onClick={() => downloadJson(JSON.stringify(warband, null, 2), armyFileName(warband))}>Export…</button>
            <button onClick={remove}>{stored ? 'Delete' : 'Discard'}</button>
          </div>
          {status ? <p className={status.error ? 'error' : 'hint'}>{status.text}</p> : null}
        </main>
      </div>
    </div>
  );
}

/** The header row of a roster table, matching {@link UnitRow}'s columns (plus any `extra` ones). */
export function UnitTableHead({ extra }: { extra?: React.ReactNode }): JSX.Element {
  return (
    <thead>
      <tr>
        <th />
        <th>Name</th>
        <th>Looks like</th>
        {EDITABLE_STATS.map((s) => (
          <th key={s} title={STAT_LABELS[s].title}>
            {STAT_LABELS[s].short}
          </th>
        ))}
        <th title={SHOOTER_TITLE}>Shooter</th>
        <th>Traits</th>
        <th>Pts</th>
        {extra}
        <th />
      </tr>
    </thead>
  );
}

/** One editable unit in a roster table (shared with the dev preset editor). */
export function UnitRow({
  unit,
  first,
  last,
  rename = (u, name) => ({ ...u, name }),
  extra,
  titles = {},
  onChange,
  onMove,
  onCopy,
  onRemove,
}: {
  unit: WarbandUnit;
  first: boolean;
  last: boolean;
  /** How a typed name is applied to the unit (the default just sets it). */
  rename?: (unit: WarbandUnit, name: string) => WarbandUnit;
  /** Extra cells after Pts, matching {@link UnitTableHead}'s `extra`. */
  extra?: React.ReactNode;
  /** Tooltips for the copy and remove buttons, where they mean something more specific. */
  titles?: { copy?: string; remove?: string };
  onChange: (unit: WarbandUnit) => void;
  onMove: (delta: number) => void;
  onCopy: () => void;
  onRemove: () => void;
}): JSX.Element {
  const valid = statErrors(unit).length === 0;
  return (
    <tr>
      <td>
        <img className="army-sprite" src={spriteUrl(spriteFor(unit.look ?? unit.name))} alt="" />
      </td>
      <td>
        <input
          className="army-unit-name"
          value={unit.name}
          maxLength={NAME_LIMITS.unit}
          aria-label="Unit name"
          onChange={(e) => onChange(rename(unit, e.target.value))}
        />
      </td>
      <td>
        <Picker
          title={`What ${unit.name || 'this unit'} looks like`}
          kind="sprite"
          ariaLabel="Looks like"
          className="picker-look"
          groups={() => [{ items: LOOKS.map((l) => ({ key: l, title: l, preview: <LookSprite look={l} /> })) }]}
          value={unit.look}
          onPick={(look) => onChange({ ...unit, look })}
        >
          <span className="picker-look-name">{unit.look !== undefined && LOOKS.includes(unit.look) ? unit.look : '(default)'}</span>
        </Picker>
      </td>
      {EDITABLE_STATS.map((s) => (
        <td key={s}>
          <input
            className="army-stat"
            type="number"
            min={STAT_BOUNDS[s][0]}
            max={STAT_BOUNDS[s][1]}
            value={unit[s] ?? 0}
            aria-label={STAT_LABELS[s].title}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) onChange(withStat(unit, s, v));
            }}
          />
        </td>
      ))}
      <td>
        <select
          value={unit.shooter ?? ''}
          aria-label="Shooter"
          onChange={(e) => onChange(withShooter(unit, (e.target.value || undefined) as ShooterKind | undefined))}
        >
          {SHOOTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="army-traits">
        <TraitEditor traits={unit} onToggle={(t, on) => onChange(withTrait(unit, t, on))} />
      </td>
      <td className="stats">{valid ? unitCost(unit) : '—'}</td>
      {extra}
      <td className="army-row-actions">
        <button title="Move up" disabled={first} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button title="Move down" disabled={last} onClick={() => onMove(1)}>
          ↓
        </button>
        <button title={titles.copy ?? 'Duplicate'} onClick={onCopy}>
          ⧉
        </button>
        <button title={titles.remove ?? 'Remove'} onClick={onRemove}>
          ✕
        </button>
      </td>
    </tr>
  );
}
