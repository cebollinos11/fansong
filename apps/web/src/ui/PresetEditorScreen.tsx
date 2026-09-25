import { useEffect, useRef, useState } from 'react';
import { DEFAULT_RULES, NAME_LIMITS, PRESET_ROSTERS, PRESET_UNITS, unitCost, warbandCost, statErrors } from '@fansong/content';
import { browserStorage } from '../game/customMaps.js';
import { downloadJson } from '../game/replay-io.js';
import { UnitRow, UnitTableHead } from './ArmyBuilderScreen.js';
import { moveUnit } from './armyView.js';
import {
  addLine,
  copyUnit,
  deletedPresets,
  deletedUnits,
  deleteUnit,
  draftBroken,
  draftChanges,
  draftFromPresets,
  entryChanged,
  entryErrors,
  expandEntry,
  forkLine,
  loadPresetDraft,
  matchupErrors,
  MAX_PRESET_ID,
  newPreset,
  newUnit,
  parsePresetsText,
  PRESET_FILE_NAME,
  presetsToJson,
  renameUnit,
  restorePreset,
  restoreUnit,
  rosterChanged,
  savePresetDraft,
  setPresetId,
  setUnit,
  slugify,
  unitByRef,
  unitChanged,
  unitErrors,
  updateEntry,
  usedBy,
  type PresetDraft,
} from './presetEditorView.js';

interface Props {
  onExit: () => void;
}

/** What the main pane shows: one warband's roster, or the shared unit list. */
type Tab = { kind: 'warband'; index: number } | { kind: 'units' };

/**
 * Dev tool (`?dev=1`): edit the shipped preset warbands and the shared units
 * they're built from — ids, names, order, rosters, stats and traits, and the
 * default matchup — and export them as one file to be folded into the game's
 * code. The draft autosaves in this browser; nothing here changes the presets in play.
 */
export function PresetEditorScreen({ onExit }: Props): JSX.Element {
  const storage = browserStorage();
  const [draft, setDraft] = useState<PresetDraft>(() => loadPresetDraft(storage) ?? draftFromPresets());
  const [tab, setTab] = useState<Tab>({ kind: 'warband', index: 0 });
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => savePresetDraft(storage, draft), [storage, draft]);

  const changes = draftChanges(draft);
  const deleted = deletedPresets(draft);
  const report = (text: string, error = false): void => setStatus({ text, error });
  const replace = (next: PresetDraft, nextTab: Tab = { kind: 'warband', index: 0 }): void => {
    setDraft(next);
    setTab(nextTab);
  };

  const resetAll = (): void => {
    if (!window.confirm('Throw away every change and start again from the shipped presets?')) return;
    replace(draftFromPresets());
    report('Reset to the shipped presets.');
  };

  const importFile = async (file: File): Promise<void> => {
    try {
      const imported = parsePresetsText(await file.text());
      replace(imported);
      report(`Imported ${imported.presets.length} warbands and ${imported.units.length} units.`);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e), true);
    }
  };

  const exportFile = (): void => {
    downloadJson(presetsToJson(draft), PRESET_FILE_NAME);
    const broken = draftBroken(draft);
    report(broken ? 'Exported — but there are problems (marked "needs fixing") to fix first.' : `Exported ${PRESET_FILE_NAME}.`, broken);
  };

  const pickMatchup = (side: 0 | 1, id: string): void => {
    const matchup: [string, string] = [...draft.matchup];
    matchup[side] = id;
    setDraft({ ...draft, matchup });
  };

  const unitsBroken = draft.units.some((_, i) => unitErrors(draft, i).length > 0);

  return (
    <div className="army preset-editor">
      <header className="army-header">
        <button className="ghost" onClick={onExit}>
          ⟵ Back
        </button>
        <h1>Preset units (dev)</h1>
        <p className="hint">
          Edit the built-in warbands and the units they share, then export the file to have them changed in the game
          for everyone. Your edits autosave in this browser only.
        </p>
      </header>

      <div className="army-body">
        <aside className="army-list">
          <button
            className={tab.kind === 'units' ? 'army-item active' : 'army-item'}
            onClick={() => setTab({ kind: 'units' })}
          >
            <span>
              {draft.units.some(unitChanged) || deletedUnits(draft).length > 0 ? '● ' : ''}Shared units
            </span>
            <span className="stats">{unitsBroken ? 'needs fixing' : draft.units.length}</span>
          </button>

          <h3>Warbands</h3>
          <ul>
            {draft.presets.map((e, i) => (
              <li key={i}>
                <button
                  className={tab.kind === 'warband' && tab.index === i ? 'army-item active' : 'army-item'}
                  onClick={() => setTab({ kind: 'warband', index: i })}
                >
                  <span>
                    {entryChanged(draft, e) ? '● ' : ''}
                    {e.name || '(unnamed)'}
                  </span>
                  <span className="stats">
                    {entryErrors(draft, i).length > 0 ? 'needs fixing' : `${warbandCost(expandEntry(draft, e))} pts`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {deleted.length > 0 ? (
            <>
              <h3>Deleted warbands</h3>
              <ul>
                {deleted.map((id) => (
                  <li key={id}>
                    <button
                      className="army-item"
                      title="Restore"
                      onClick={() => replace(restorePreset(draft, id), { kind: 'warband', index: draft.presets.length })}
                    >
                      <span>
                        <s>{PRESET_ROSTERS[id]!.name}</s>
                      </span>
                      <span className="stats">restore</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h3>Default matchup</h3>
          <div className="preset-matchup">
            {([0, 1] as const).map((side) => (
              <select
                key={side}
                value={draft.matchup[side]}
                aria-label={side === 0 ? 'Default first warband' : 'Default second warband'}
                onChange={(e) => pickMatchup(side, e.target.value)}
              >
                {draft.presets.some((e) => e.id === draft.matchup[side]) ? null : (
                  <option value={draft.matchup[side]}>(missing: {draft.matchup[side]})</option>
                )}
                {draft.presets.map((e, i) => (
                  <option key={i} value={e.id}>
                    {e.name || e.id}
                  </option>
                ))}
              </select>
            ))}
          </div>
          {matchupErrors(draft).map((e) => (
            <p key={e} className="error">
              {e}
            </p>
          ))}

          {changes.length === 0 ? (
            <p className="hint">No changes yet.</p>
          ) : (
            <details className="preset-changes">
              <summary className="hint">
                {changes.length} change{changes.length === 1 ? '' : 's'} (●)
              </summary>
              <ul>
                {changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="army-list-actions">
            <button className="primary" onClick={exportFile}>
              Export file…
            </button>
            <button onClick={() => replace(newPreset(draft), { kind: 'warband', index: draft.presets.length })}>
              + New warband
            </button>
            <button onClick={() => fileInput.current?.click()}>Import file…</button>
            <button onClick={resetAll}>Reset all</button>
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
          {status ? <p className={status.error ? 'error' : 'hint'}>{status.text}</p> : null}
        </aside>

        {tab.kind === 'units' ? (
          <UnitsPane draft={draft} onDraft={setDraft} onOpenWarband={(index) => setTab({ kind: 'warband', index })} />
        ) : draft.presets[tab.index] ? (
          <WarbandPane
            draft={draft}
            index={tab.index}
            onDraft={setDraft}
            onSelect={(index) => setTab({ kind: 'warband', index })}
            onDeleted={(next) => replace(next, { kind: 'warband', index: Math.max(0, tab.index - 1) })}
          />
        ) : (
          <main className="army-editor">
            <p className="hint">No warbands left — add one or reset.</p>
          </main>
        )}
      </div>
    </div>
  );
}

/** One warband: its name, id and place in the lists, and its roster of shared units. */
function WarbandPane({
  draft,
  index,
  onDraft,
  onSelect,
  onDeleted,
}: {
  draft: PresetDraft;
  index: number;
  onDraft: (next: PresetDraft) => void;
  onSelect: (index: number) => void;
  onDeleted: (next: PresetDraft) => void;
}): JSX.Element {
  const entry = draft.presets[index]!;
  const warband = expandEntry(draft, entry);
  const edit = (f: Parameters<typeof updateEntry>[2]): void => onDraft(updateEntry(draft, index, f));
  const setCount = (line: number, count: number): void =>
    edit((e) => ({ ...e, lines: e.lines.map((l, k) => (k === line ? { ...l, count } : l)) }));

  const move = (delta: number): void => {
    onDraft({ ...draft, presets: moveUnit(draft.presets, index, delta) });
    onSelect(Math.min(draft.presets.length - 1, Math.max(0, index + delta)));
  };

  const remove = (): void => {
    if (!window.confirm(`Delete the warband "${entry.name}"? Its units stay in the shared list.`)) return;
    onDeleted({ ...draft, presets: draft.presets.filter((_, i) => i !== index) });
  };

  const addNewUnit = (): void => {
    const [next, ref] = newUnit(draft);
    onDraft(addLine(next, index, ref));
  };

  const sorted = [...draft.units].sort((a, b) => a.unit.name.localeCompare(b.unit.name));

  return (
    <main className="army-editor">
      <div className="army-title">
        <input
          className="army-name"
          value={entry.name}
          maxLength={NAME_LIMITS.warband}
          aria-label="Warband name"
          onChange={(e) => edit((x) => ({ ...x, name: e.target.value }))}
        />
        <div className="army-total">
          <strong>{warbandCost(warband)}</strong> pts · {warband.units.length} unit{warband.units.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="preset-meta">
        <label>
          Id
          <input
            className="preset-id"
            value={entry.id}
            maxLength={MAX_PRESET_ID}
            aria-label="Warband id"
            spellCheck={false}
            onChange={(e) => onDraft(setPresetId(draft, index, e.target.value))}
          />
        </label>
        <button
          title="Make the id from the warband's name"
          disabled={slugify(entry.name) === '' || slugify(entry.name) === entry.id}
          onClick={() => onDraft(setPresetId(draft, index, slugify(entry.name)))}
        >
          From name
        </button>
        {entry.source !== undefined && entry.id !== entry.source ? (
          <span className="hint">
            was <code>{entry.source}</code>
          </span>
        ) : null}
        <span className="preset-order">
          Position {index + 1} of {draft.presets.length}
          <button title="Earlier in the game's lists" disabled={index === 0} onClick={() => move(-1)}>
            ↑
          </button>
          <button title="Later in the game's lists" disabled={index === draft.presets.length - 1} onClick={() => move(1)}>
            ↓
          </button>
        </span>
      </div>

      <p className="hint preset-note">
        Units here are shared: editing one changes it in every warband marked in “Also in”. Use ⧉ to give this warband
        its own copy instead.
      </p>

      <div className="army-table-wrap">
        <table className="army-table">
          <UnitTableHead
            extra={
              <>
                <th title="How many of this unit the warband fields">×</th>
                <th>Also in</th>
              </>
            }
          />
          <tbody>
            {entry.lines.map((line, k) => {
              const shared = unitByRef(draft, line.unit)!;
              const others = usedBy(draft, line.unit).filter((e) => e !== entry);
              return (
                <UnitRow
                  key={`${k}:${line.unit}`}
                  unit={shared.unit}
                  first={k === 0}
                  last={k === entry.lines.length - 1}
                  rename={renameUnit}
                  titles={{ copy: 'Give this warband its own copy of the unit', remove: 'Take out of this warband' }}
                  extra={
                    <>
                      <td>
                        <input
                          className="army-stat"
                          type="number"
                          min={1}
                          max={DEFAULT_RULES.maxUnits}
                          value={line.count}
                          aria-label={`How many ${shared.unit.name}`}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (Number.isFinite(v)) setCount(k, Math.min(DEFAULT_RULES.maxUnits, Math.max(1, v)));
                          }}
                        />
                      </td>
                      <td className="preset-used">{others.length === 0 ? '—' : others.map((e) => e.name).join(', ')}</td>
                    </>
                  }
                  onChange={(next) => onDraft(setUnit(draft, line.unit, next))}
                  onMove={(delta) => edit((e) => ({ ...e, lines: moveUnit(e.lines, k, delta) }))}
                  onCopy={() => onDraft(forkLine(draft, index, k))}
                  onRemove={() => edit((e) => ({ ...e, lines: e.lines.filter((_, j) => j !== k) }))}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="army-add">
        <select
          value=""
          aria-label="Add a shared unit"
          onChange={(e) => e.target.value && onDraft(addLine(draft, index, e.target.value))}
        >
          <option value="">Add a shared unit…</option>
          {sorted.map((u) => (
            <option key={u.ref} value={u.ref}>
              {u.unit.name} — {statErrors(u.unit).length === 0 ? `${unitCost(u.unit)} pts` : 'needs fixing'}
            </option>
          ))}
        </select>
        <button onClick={addNewUnit}>+ New unit</button>
      </div>

      <Problems title="Not a legal warband yet:" errors={entryErrors(draft, index)} />

      <div className="army-actions">
        <button
          onClick={() => entry.source && onDraft(restorePreset(draft, entry.source, index))}
          disabled={entry.source === undefined || !rosterChanged(draft, entry)}
          title="Put back the shipped name and roster (edits to shared units are kept)"
        >
          Revert roster
        </button>
        <button onClick={remove}>Delete warband</button>
      </div>
    </main>
  );
}

/** Every shared unit, with the warbands that field it. */
function UnitsPane({
  draft,
  onDraft,
  onOpenWarband,
}: {
  draft: PresetDraft;
  onDraft: (next: PresetDraft) => void;
  onOpenWarband: (index: number) => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = draft.units.map((u, i) => ({ u, i })).filter(({ u }) => u.unit.name.toLowerCase().includes(needle));
  const gone = deletedUnits(draft);
  const problems = draft.units.flatMap((u, i) => unitErrors(draft, i).map((e) => `${u.unit.name || `unit ${i + 1}`}: ${e}`));

  const remove = (ref: string): void => {
    const users = usedBy(draft, ref);
    const name = unitByRef(draft, ref)!.unit.name;
    const warning =
      users.length === 0
        ? `Delete the unit "${name}"?`
        : `Delete "${name}"? It will be taken out of ${users.map((e) => e.name).join(', ')}.`;
    if (window.confirm(warning)) onDraft(deleteUnit(draft, ref));
  };

  return (
    <main className="army-editor">
      <div className="army-title">
        <h2 className="preset-pane-title">Shared units</h2>
        <input
          className="preset-filter"
          value={filter}
          placeholder="Filter by name…"
          aria-label="Filter units"
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="army-total">{draft.units.length} units</div>
      </div>
      <p className="hint preset-note">
        Each unit is defined once; editing it here changes it in every warband that fields it.
      </p>

      <div className="army-table-wrap">
        <table className="army-table">
          <UnitTableHead extra={<th>Used in</th>} />
          <tbody>
            {shown.map(({ u, i }) => {
              const users = usedBy(draft, u.ref);
              return (
                <UnitRow
                  key={u.ref}
                  unit={u.unit}
                  // Reordering only makes sense on the full list.
                  first={needle !== '' || i === 0}
                  last={needle !== '' || i === draft.units.length - 1}
                  rename={renameUnit}
                  titles={{ copy: 'Copy as a new unit', remove: 'Delete this unit' }}
                  extra={
                    <td className="preset-used">
                      {unitChanged(u) ? <span title="Changed from what ships">● </span> : null}
                      {users.length === 0 ? (
                        <span className="hint">unused</span>
                      ) : (
                        users.map((e, k) => (
                          <span key={e.id + k}>
                            {k > 0 ? ', ' : ''}
                            <button className="link" onClick={() => onOpenWarband(draft.presets.indexOf(e))}>
                              {e.name}
                            </button>
                          </span>
                        ))
                      )}
                    </td>
                  }
                  onChange={(next) => onDraft(setUnit(draft, u.ref, next))}
                  onMove={(delta) => onDraft({ ...draft, units: moveUnit(draft.units, i, delta) })}
                  onCopy={() => onDraft(copyUnit(draft, u.ref)[0])}
                  onRemove={() => remove(u.ref)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="army-add">
        <button onClick={() => onDraft(newUnit(draft)[0])}>+ New unit</button>
        {gone.length > 0 ? (
          <select value="" aria-label="Restore a deleted unit" onChange={(e) => e.target.value && onDraft(restoreUnit(draft, e.target.value))}>
            <option value="">Restore a deleted unit…</option>
            {gone.map((name) => (
              <option key={name} value={name}>
                {name} — {unitCost(PRESET_UNITS[name]!)} pts
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <Problems title="Units to fix:" errors={problems} />
    </main>
  );
}

function Problems({ title, errors }: { title: string; errors: string[] }): JSX.Element | null {
  if (errors.length === 0) return null;
  return (
    <div className="editor-validation">
      <p>{title}</p>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
