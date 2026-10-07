import { useRef, useState } from 'react';
import {
  ARMY_RULES,
  NAME_LIMITS,
  PRESET_IDS,
  PRESETS,
  STAT_BOUNDS,
  statErrors,
  unitCost,
  validateArmy,
  warbandCost,
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
import { DEFAULT_TINT } from '../three/spriteTint.js';
import { LookSprite, Picker, UnitSprite, unitItem, warbandItem } from './Picker.js';
import { STAT_INFO, StatIcon } from './StatIcons.js';
import { TraitEditor } from './TraitEditor.js';
import {
  ARMY_RULES_TEXT,
  armyFromPreset,
  blankUnit,
  type BuilderStart,
  copyBase,
  EDITABLE_STATS,
  type EditableStat,
  LOOK_GROUPS,
  LOOKS,
  moveUnit,
  newArmy,
  presetTemplates,
  renumberRun,
  STAT_LABELS,
  templateUnit,
  unitRuns,
  withRunUnit,
  withStat,
  withTint,
  withTrait,
} from './armyView.js';

interface Props {
  onExit: () => void;
  /**
   * The army to open, when the builder was reached from a warband choice rather
   * than from the main menu: a saved one, or a roster to start a new one from.
   */
  start?: BuilderStart;
  /**
   * Given, the builder is standing in front of a setup screen: it offers to save
   * the open army and hand its id straight back, to be fielded there and then.
   */
  onUse?: (id: string) => void;
  /** What the way out is called; from the main menu it just goes back. */
  backLabel?: string;
}

/** The army being edited: its storage id and the working copy of its roster. */
interface Editing {
  id: string;
  warband: Warband;
  /**
   * The roster as it was when this army was opened — what "unsaved changes" are
   * measured against, so an army nobody has touched yet asks nothing on the way
   * out. `null` for an imported file, which is always worth keeping.
   */
  baseline: Warband | null;
}

/** Open `warband`: its working copy starts out matching itself, so it counts as untouched. */
function opened(id: string, warband: Warband): Editing {
  return { id, warband, baseline: warband };
}

/**
 * The army builder: make, edit, save, import and export custom warbands. There
 * is no point limit — the total is shown so players can agree on one themselves.
 * Saved armies appear on the setup screen for local and online play alike, and
 * those screens open this builder in front of themselves, so an army made there
 * can be fielded without leaving the battle being arranged.
 */
export function ArmyBuilderScreen({ onExit, start, onUse, backLabel = '⟵ Back' }: Props): JSX.Element {
  const storage = browserStorage();
  const [armies, setArmies] = useState<SavedArmy[]>(() => loadArmies(storage));
  const [editing, setEditing] = useState<Editing>(() => {
    const wanted = start && 'id' in start ? armies.find((a) => a.id === start.id) : undefined;
    if (wanted) return opened(wanted.id, wanted.warband);
    // A roster handed in counts as untouched, so backing straight out asks nothing.
    if (start && 'warband' in start) return opened(newArmyId(armies), start.warband);
    const first = armies[0];
    return first ? opened(first.id, first.warband) : opened(newArmyId(armies), newArmy());
  });
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const stored = armies.find((a) => a.id === editing.id);
  const { warband } = editing;
  // Changes worth a warning, and work worth a Save: a brand-new army has
  // nothing to lose on the way out, but it still has never been saved.
  const dirty = editing.baseline === null || JSON.stringify(editing.baseline) !== JSON.stringify(warband);
  const savable = dirty || !stored;
  const check = validateArmy(warband);
  const runs = unitRuns(warband.units);

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

  const save = (): void => {
    try {
      setArmies(saveArmy(storage, { id: editing.id, warband }));
      setEditing((e) => ({ ...e, baseline: e.warband }));
      report(check.ok ? `Saved "${warband.name}".` : `Saved "${warband.name}" — fix the problems below to play it.`);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e), true);
    }
  };

  const remove = (): void => {
    if (!stored) {
      open(opened(newArmyId(armies), newArmy()));
      return;
    }
    if (!window.confirm(`Delete "${stored.warband.name}"?`)) return;
    try {
      const kept = deleteArmy(storage, stored.id);
      setArmies(kept);
      setEditing(kept[0] ? opened(kept[0].id, kept[0].warband) : opened(newArmyId(kept), newArmy()));
      report(`Deleted "${stored.warband.name}".`);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e), true);
    }
  };

  const importFile = async (file: File): Promise<void> => {
    try {
      const imported = parseArmyText(await file.text());
      // No baseline: an import is only in the browser until it is saved, so
      // leaving without saving really would throw the file's army away.
      open({ id: newArmyId(armies), warband: imported, baseline: null });
      report(`Imported "${imported.name}" — save it to keep it.`);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e), true);
    }
  };

  const exit = (): void => {
    if (discardOk()) onExit();
  };

  /** Save the open army and field it on the screen waiting behind this one. */
  const use = (): void => {
    if (!onUse) return;
    if (!check.ok) {
      report('Fix the problems below before fielding this army.', true);
      return;
    }
    try {
      saveArmy(storage, { id: editing.id, warband });
    } catch (e) {
      report(e instanceof Error ? e.message : String(e), true);
      return;
    }
    onUse(editing.id);
  };

  return (
    <div className="army">
      <header className="army-header">
        <button className="ghost" onClick={exit}>
          {backLabel}
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
                    onClick={() => a.id !== editing.id && open(opened(a.id, a.warband))}
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
            <button onClick={() => open(opened(newArmyId(armies), newArmy()))}>+ New army</button>
            <Picker
              title="Start from a preset"
              kind="warband"
              groups={() => [{ items: PRESET_IDS.map((id) => warbandItem(id, PRESETS[id]!)) }]}
              onPick={(id) => open(opened(newArmyId(armies), armyFromPreset(id)))}
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
              <UnitTableHead counts />
              <tbody>
                {runs.map((run, r) => (
                  <UnitRow
                    key={run.at}
                    unit={run.unit}
                    count={run.count}
                    first={r === 0}
                    last={r === runs.length - 1}
                    titles={{ remove: run.count > 1 ? `Remove all ${run.count}` : 'Remove' }}
                    // A new name renumbers the whole run; anything else leaves every name alone.
                    onChange={(next) =>
                      setUnits(
                        next.name === run.unit.name
                          ? withRunUnit(warband.units, run, next)
                          : renumberRun(warband.units, run, next.name, run.count),
                      )
                    }
                    onCount={(count) => setUnits(renumberRun(warband.units, run, copyBase(run.unit.name), count))}
                    onMove={(delta) => setUnits(moveUnit(runs, r, delta).flatMap((m) => warband.units.slice(m.at, m.at + m.count)))}
                    onRemove={() => setUnits(renumberRun(warband.units, run, run.unit.name, 0))}
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
            {onUse ? (
              <button className="primary" onClick={use} title="Save this army and field it in the battle you were setting up">
                Use this army
              </button>
            ) : null}
            <button className={onUse ? undefined : 'primary'} onClick={save} disabled={!savable}>
              {savable ? 'Save army' : 'Saved'}
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

/**
 * The army builder standing in front of another screen, which stays mounted
 * behind it: a setup screen keeps every choice made on it, and an online room
 * keeps its socket, so an army built here can be fielded without starting over.
 */
export function ArmyBuilderOverlay(props: Props): JSX.Element {
  return (
    <div className="army-overlay" role="dialog" aria-modal="true" aria-label="Army builder">
      <ArmyBuilderScreen {...props} />
    </div>
  );
}

/**
 * The header row of a roster table, matching {@link UnitRow}'s columns (plus any
 * `extra` ones). `counts` adds the quantity column, for a table whose rows stand
 * for more than one unit each.
 */
export function UnitTableHead({ counts = false, extra }: { counts?: boolean; extra?: React.ReactNode }): JSX.Element {
  return (
    <thead>
      <tr>
        <th />
        <th>Name</th>
        <th>Looks like</th>
        <th title="A colour blended into the unit's sprite (its team colours stay as they are)">Tint</th>
        {EDITABLE_STATS.map((s) => (
          // Named, not just an icon: these two numbers are the unit, and which
          // way each one runs is the first thing a new player has to learn.
          <th key={s} title={STAT_LABELS[s].title}>
            <span className="army-stat-head">
              <StatIcon stat={s} />
              {STAT_INFO[s].name}
            </span>
          </th>
        ))}
        <th>Traits</th>
        {counts ? <th title="How many of this unit the army has">Qty</th> : null}
        <th>Pts</th>
        {extra}
        <th />
      </tr>
    </thead>
  );
}

/**
 * One editable unit in a roster table (shared with the dev preset editor). With
 * `count` the row stands for that many identical units and edits them together;
 * its stepper then does the work of the duplicate button, which is left out.
 */
export function UnitRow({
  unit,
  count = 1,
  first,
  last,
  rename = (u, name) => ({ ...u, name }),
  extra,
  titles = {},
  onChange,
  onCount,
  onMove,
  onCopy,
  onRemove,
}: {
  unit: WarbandUnit;
  /** How many identical units this row stands for; needs `onCount` to be editable. */
  count?: number;
  first: boolean;
  last: boolean;
  /** How a typed name is applied to the unit (the default just sets it). */
  rename?: (unit: WarbandUnit, name: string) => WarbandUnit;
  /** Extra cells after Pts, matching {@link UnitTableHead}'s `extra`. */
  extra?: React.ReactNode;
  /** Tooltips for the copy and remove buttons, where they mean something more specific. */
  titles?: { copy?: string; remove?: string };
  onChange: (unit: WarbandUnit) => void;
  /** Given, adds the quantity column (and {@link UnitTableHead} needs `counts`). */
  onCount?: (count: number) => void;
  onMove: (delta: number) => void;
  /** Given, adds the duplicate button. */
  onCopy?: () => void;
  onRemove: () => void;
}): JSX.Element {
  const valid = statErrors(unit).length === 0;
  // The colour last picked, so switching the tint off and on again brings it back.
  const [lastTint, setLastTint] = useState(unit.tint ?? DEFAULT_TINT);
  return (
    <tr>
      <td className="army-cell-sprite">
        <UnitSprite unit={unit} className="army-sprite" />
      </td>
      <td className="army-cell-name" data-label="Name">
        <input
          className="army-unit-name"
          value={unit.name}
          maxLength={NAME_LIMITS.unit}
          aria-label="Unit name"
          onChange={(e) => onChange(rename(unit, e.target.value))}
        />
      </td>
      <td className="army-cell-look" data-label="Looks like">
        <Picker
          title={`What ${unit.name || 'this unit'} looks like`}
          kind="sprite"
          ariaLabel="Looks like"
          className="picker-look"
          groups={() => LOOK_GROUPS.map((g) => ({ label: g.label, items: g.looks.map((l) => ({ key: l, title: l, preview: <LookSprite look={l} /> })) }))}
          value={unit.look}
          onPick={(look) => onChange({ ...unit, look })}
        >
          <span className="picker-look-name">{unit.look !== undefined && LOOKS.includes(unit.look) ? unit.look : '(default)'}</span>
        </Picker>
      </td>
      <td className="army-tint army-cell-tint" data-label="Tint">
        <input
          type="checkbox"
          checked={unit.tint !== undefined}
          aria-label="Tint the sprite"
          title={unit.tint !== undefined ? 'Remove the tint' : 'Tint the sprite'}
          onChange={(e) => onChange(withTint(unit, e.target.checked ? lastTint : undefined))}
        />
        <input
          type="color"
          value={unit.tint ?? lastTint}
          disabled={unit.tint === undefined}
          aria-label="Tint colour"
          onChange={(e) => {
            setLastTint(e.target.value);
            onChange(withTint(unit, e.target.value));
          }}
        />
      </td>
      {EDITABLE_STATS.map((s) => (
        <td key={s} className={`army-cell-stat army-cell-${s}`} data-label={STAT_INFO[s].name}>
          <select
            className="army-stat"
            value={unit[s] ?? 0}
            aria-label={STAT_LABELS[s].title}
            onChange={(e) => onChange(withStat(unit, s, parseInt(e.target.value, 10)))}
          >
            {statOptions(s, unit[s] ?? 0).map((v) => (
              // Quality reads as the number its dice must roll, as it does everywhere else.
              <option key={v} value={v}>
                {s === 'quality' ? `${v}+` : v}
              </option>
            ))}
          </select>
        </td>
      ))}
      <td className="army-traits army-cell-traits" data-label="Traits">
        <TraitEditor unit={unit} onToggle={(t, on) => onChange(withTrait(unit, t, on))} />
      </td>
      {onCount ? (
        <td className="army-cell-qty" data-label="Qty">
          <CountStepper unit={unit} count={count} onCount={onCount} />
        </td>
      ) : null}
      <td className="stats army-cell-pts" data-label="Points">
        {!valid ? '—' : count > 1 ? <GroupCost each={unitCost(unit)} count={count} /> : unitCost(unit)}
      </td>
      {extra}
      <td className="army-row-actions army-cell-actions">
        <button title="Move up" disabled={first} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button title="Move down" disabled={last} onClick={() => onMove(1)}>
          ↓
        </button>
        {onCopy ? (
          <button title={titles.copy ?? 'Duplicate'} onClick={onCopy}>
            ⧉
          </button>
        ) : null}
        <button title={titles.remove ?? 'Remove'} onClick={onRemove}>
          ✕
        </button>
      </td>
    </tr>
  );
}

/** How many of a unit the army has: a number to type, and a step either way. */
function CountStepper({ unit, count, onCount }: { unit: WarbandUnit; count: number; onCount: (count: number) => void }): JSX.Element {
  const set = (n: number): void => {
    if (Number.isFinite(n)) onCount(Math.min(ARMY_RULES.maxUnits, Math.max(1, Math.round(n))));
  };
  return (
    <span className="army-count">
      <button title={`One fewer ${unit.name}`} disabled={count <= 1} onClick={() => set(count - 1)}>
        −
      </button>
      <input
        type="number"
        min={1}
        max={ARMY_RULES.maxUnits}
        value={count}
        aria-label={`How many ${unit.name || 'of this unit'}`}
        onChange={(e) => set(parseInt(e.target.value, 10))}
      />
      <button title={`One more ${unit.name}`} disabled={count >= ARMY_RULES.maxUnits} onClick={() => set(count + 1)}>
        +
      </button>
    </span>
  );
}

/** What a row of several identical units costs: the total, over what one of them costs. */
function GroupCost({ each, count }: { each: number; count: number }): JSX.Element {
  return (
    <>
      {each * count}
      <span className="army-pts-each">
        {count} × {each}
      </span>
    </>
  );
}

/** Every legal value of a stat, plus the current one if an imported unit is out of range. */
function statOptions(stat: EditableStat, current: number): number[] {
  const [min, max] = STAT_BOUNDS[stat];
  const values: number[] = [];
  for (let v = min; v <= max; v++) values.push(v);
  if (!values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b);
}
