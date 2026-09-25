import { DEFAULT_SETUP, PRESET_IDS, PRESET_UNITS, PRESETS } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import { moveUnit, withTrait } from '../src/ui/armyView.js';
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
  idErrors,
  loadPresetDraft,
  matchupErrors,
  newPreset,
  newUnit,
  parsePresetsText,
  presetErrors,
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
} from '../src/ui/presetEditorView.js';

const at = (draft: PresetDraft, id: string): number => draft.presets.findIndex((e) => e.id === id);
const warband = (draft: PresetDraft, id: string) => expandEntry(draft, draft.presets[at(draft, id)]!);
/** Make `bands` all field the shipped Wolf (one line each). */
const shareWolf = (draft: PresetDraft, ...bands: string[]): PresetDraft =>
  bands.reduce((d, id) => addLine(d, at(d, id), 'Wolf'), draft);

describe('preset editor model', () => {
  it('starts from an unchanged copy of the shipped units, warbands and matchup', () => {
    const draft = draftFromPresets();
    expect(draft.units.map((u) => u.ref)).toEqual(Object.keys(PRESET_UNITS));
    expect(draft.presets.map((e) => e.id)).toEqual(PRESET_IDS);
    for (const id of PRESET_IDS) expect(warband(draft, id)).toEqual(PRESETS[id]);
    expect(draft.matchup).toEqual(DEFAULT_SETUP.presets);
    expect(draftChanges(draft)).toEqual([]);
    expect(draftBroken(draft)).toBe(false);
    draft.presets.forEach((e) => expect(entryChanged(draft, e)).toBe(false));
    draft.units.forEach((u) => expect(unitChanged(u)).toBe(false));
  });

  it('edits a shared unit once for every warband that fields it', () => {
    let draft = shareWolf(draftFromPresets(), 'iron-wardens', 'free-company');
    expect(usedBy(draft, 'Wolf').map((e) => e.id)).toEqual(['iron-wardens', 'free-company', 'wild-menagerie']);
    draft = setUnit(draft, 'Wolf', { ...unitByRef(draft, 'Wolf')!.unit, combat: 5 });
    for (const id of ['iron-wardens', 'free-company', 'wild-menagerie'])
      expect(warband(draft, id).units.find((u) => u.name === 'Wolf')?.combat).toBe(5);
    expect(draftChanges(draft)).toEqual([
      'edited unit "Wolf"',
      'edited warband "Iron Wardens" (iron-wardens)',
      'edited warband "Free Company" (free-company)',
    ]);
  });

  it('forks a line into the warband’s own copy', () => {
    let draft = shareWolf(draftFromPresets(), 'iron-wardens');
    const i = at(draft, 'iron-wardens');
    draft = forkLine(draft, i, draft.presets[i]!.lines.length - 1);
    const ref = draft.presets[i]!.lines.at(-1)!.unit;
    expect(ref).not.toBe('Wolf');
    expect(unitByRef(draft, ref)!.unit).toMatchObject({ name: 'Wolf 2', look: 'Wolf', combat: PRESET_UNITS.Wolf!.combat });
    draft = setUnit(draft, ref, { ...unitByRef(draft, ref)!.unit, combat: 6 });
    expect(unitByRef(draft, 'Wolf')!.unit.combat).toBe(PRESET_UNITS.Wolf!.combat);
    expect(usedBy(draft, 'Wolf').map((e) => e.id)).toEqual(['wild-menagerie']);
  });

  it('counts a line into numbered copies, and adding a fielded unit raises its count', () => {
    let draft = draftFromPresets();
    const i = at(draft, 'thorn-patrol');
    draft = addLine(addLine(draft, i, 'Wolf'), i, 'Wolf');
    expect(draft.presets[i]!.lines.at(-1)).toEqual({ unit: 'Wolf', count: 2 });
    expect(warband(draft, 'thorn-patrol').units.map((u) => u.name).slice(-2)).toEqual(['Wolf', 'Wolf 2']);
    draft = updateEntry(draft, i, (e) => ({ ...e, lines: [...e.lines, { unit: 'Wolf', count: 1 }] }));
    expect(entryErrors(draft, i)).toContain('Wolf is listed twice — raise its count instead');
  });

  it('deletes a unit from every warband, and restores it', () => {
    let draft = deleteUnit(draftFromPresets(), 'Bear');
    expect(usedBy(draft, 'Bear')).toEqual([]);
    expect(warband(draft, 'monstrous-horde').units.map((u) => u.name)).not.toContain('Bear');
    expect(deletedUnits(draft)).toEqual(['Bear']);
    expect(draftChanges(draft)).toEqual(['deleted unit "Bear"', 'edited warband "Monstrous Horde" (monstrous-horde)']);
    draft = restoreUnit(draft, 'Bear');
    expect(deletedUnits(draft)).toEqual([]);
  });

  it('reverts a roster, bringing back deleted units but keeping shared edits', () => {
    let draft = deleteUnit(draftFromPresets(), 'Bear');
    draft = setUnit(draft, 'Yeti', { ...unitByRef(draft, 'Yeti')!.unit, combat: 6 });
    const i = at(draft, 'monstrous-horde');
    draft = restorePreset(updateEntry(draft, i, (e) => ({ ...e, name: 'Brutes' })), 'monstrous-horde', i);
    expect(rosterChanged(draft, draft.presets[i]!)).toBe(false);
    expect(warband(draft, 'monstrous-horde').units.find((u) => u.name === 'Yeti')?.combat).toBe(6);
    expect(draftChanges(draft)).toEqual(['edited unit "Yeti"']);
  });

  it('checks shared units for bad stats and clashing names', () => {
    let draft = draftFromPresets();
    const bear = draft.units.findIndex((u) => u.ref === 'Bear');
    draft = setUnit(draft, 'Bear', { ...draft.units[bear]!.unit, name: 'Yeti', combat: 9 });
    expect(unitErrors(draft, bear)).toContain('another unit has this name');
    expect(unitErrors(draft, bear).length).toBeGreaterThan(1);
    expect(draftBroken(draft)).toBe(true);
  });

  it('does not count a trait switched on and back off as a change', () => {
    const draft = draftFromPresets();
    const bear = unitByRef(draft, 'Bear')!;
    expect(unitChanged({ ...bear, unit: withTrait(withTrait(bear.unit, 'tough', true), 'tough', false) })).toBe(false);
    expect(unitChanged({ ...bear, unit: { ...bear.unit, combat: 6 } })).toBe(true);
  });

  it('keeps a renamed unit drawn with its old sprite', () => {
    const bear = { name: 'Bear', quality: 4, combat: 4 };
    expect(renameUnit(bear, 'Cave Bear')).toEqual({ ...bear, name: 'Cave Bear', look: 'Bear' });
    expect(renameUnit({ ...bear, look: 'Yeti' }, 'Cave Bear').look).toBe('Yeti');
    expect(renameUnit(bear, 'Yeti').look).toBeUndefined();
  });

  it('flags illegal warbands', () => {
    const w = { name: '', units: [{ name: 'A', quality: 4, combat: 3 }, { name: 'A', quality: 4, combat: 3 }] };
    const errors = presetErrors(w);
    expect(errors).toContain('the preset needs a name');
    expect(errors).toContain('two units are named "A"');
    expect(errors.some((e) => e.startsWith('too few units'))).toBe(true);
  });

  it('checks ids for shape and clashes', () => {
    const draft = draftFromPresets();
    const i = at(draft, 'sky-talons');
    expect(idErrors(setPresetId(draft, i, 'iron-wardens'), i)).toEqual(['another preset already has the id "iron-wardens"']);
    expect(idErrors(setPresetId(draft, i, 'Sky Talons'), i)).toHaveLength(1);
    expect(idErrors(setPresetId(draft, i, 'sky--talons'), i)).toHaveLength(1);
    expect(idErrors(setPresetId(draft, i, ''), i)).toEqual(['the preset needs an id']);
    expect(entryErrors(setPresetId(draft, i, 'sky-riders'), i)).toEqual([]);
    expect(slugify('  Iron Wardens (II)! ')).toBe('iron-wardens-ii');
  });

  it('records an id change as a rename and carries the matchup along', () => {
    const draft = setPresetId(draftFromPresets(), 0, 'wardens');
    expect(draft.matchup).toEqual(['wardens', DEFAULT_SETUP.presets[1]]);
    expect(deletedPresets(draft)).toEqual([]);
    expect(draftChanges(draft)).toEqual(['id iron-wardens → wardens']);
    expect(matchupErrors(draft)).toEqual([]);
  });

  it('describes adds, deletes, reorders and a new matchup', () => {
    let draft = draftFromPresets();
    draft = { ...draft, presets: draft.presets.filter((e) => e.id !== 'sky-talons') };
    draft = newPreset({ ...draft, presets: moveUnit(draft.presets, 1, -1) });
    draft = { ...draft, matchup: ['free-company', 'new-preset'] };
    expect(draftChanges(draft)).toEqual([
      'added unit "Soldier"',
      'added warband "New Preset" (new-preset)',
      'deleted warband "Sky Talons" (sky-talons)',
      'reordered the warbands',
      'default matchup free-company vs new-preset',
    ]);
    expect(warband(draft, 'new-preset').units.map((u) => u.name)).toEqual(['Soldier', 'Soldier 2', 'Soldier 3']);
    expect(draftBroken(draft)).toBe(false);
    expect(newPreset(draft).presets.at(-1)!.id).toBe('new-preset-2');
  });

  it('flags a default matchup naming a deleted warband', () => {
    const draft = draftFromPresets();
    const gone = { ...draft, presets: draft.presets.filter((e) => e.id !== DEFAULT_SETUP.presets[0]) };
    expect(matchupErrors(gone)).toHaveLength(1);
    expect(draftBroken(gone)).toBe(true);
    expect(deletedPresets(restorePreset(gone, DEFAULT_SETUP.presets[0]))).toEqual([]);
  });

  it('round-trips the export file', () => {
    let draft = shareWolf(setPresetId(draftFromPresets(), 2, 'free-lances'), 'iron-wardens');
    draft = forkLine(draft, 0, draft.presets[0]!.lines.length - 1);
    const [withNew] = newUnit(draft);
    draft = { ...copyUnit(withNew, 'Bear')[0], matchup: ['hollow-watch', 'free-lances'] };
    const text = presetsToJson(draft);
    expect(JSON.parse(text).changes).toEqual(draftChanges(draft));
    expect(parsePresetsText(text)).toEqual(draft);
    expect(() => parsePresetsText('{"name":"x","units":[]}')).toThrow('Not a presets file.');
    expect(() => parsePresetsText('nope')).toThrow('Not a JSON file.');
  });

  it('carries a version 2 draft over to shared units', () => {
    const horde = PRESETS['monstrous-horde']!;
    const edited = { ...horde, units: horde.units.map((u) => (u.name === 'Bear' ? { ...u, name: 'Cave Bear', look: 'Bear', combat: 5 } : u)) };
    const v2 = JSON.stringify({
      format: 'fansong-presets',
      version: 2,
      matchup: ['iron-wardens', 'monstrous-horde'],
      presets: [
        { id: 'iron-wardens', source: 'iron-wardens', ...PRESETS['iron-wardens'] },
        { id: 'horde', source: 'monstrous-horde', ...edited },
        { id: 'new-1', name: 'Pack', units: [PRESETS['wild-menagerie']!.units[3], { name: 'Pup', quality: 5, combat: 1 }, { name: 'Pup 2', quality: 5, combat: 1 }] },
      ],
    });
    const draft = parsePresetsText(v2);
    expect(draft.presets.map((e) => e.id)).toEqual(['iron-wardens', 'horde', 'new-1']);
    expect(warband(draft, 'horde')).toEqual(edited);
    expect(unitByRef(draft, 'Bear')!.unit).toMatchObject({ name: 'Cave Bear', combat: 5 });
    expect(warband(draft, 'new-1').units.map((u) => u.name)).toEqual(['Wolf', 'Pup', 'Pup 2']);
    expect(draft.presets[2]!.lines[0]!.unit).toBe('Wolf');
    expect(draft.matchup).toEqual(['iron-wardens', 'monstrous-horde']);
  });

  it('still reads a version 1 file', () => {
    const v1 = JSON.stringify({ format: 'fansong-presets', version: 1, presets: { 'iron-wardens': PRESETS['iron-wardens'] } });
    const draft = parsePresetsText(v1);
    expect(draft.presets.map((e) => [e.id, e.source])).toEqual([['iron-wardens', 'iron-wardens']]);
    expect(warband(draft, 'iron-wardens')).toEqual(PRESETS['iron-wardens']);
  });

  it('autosaves and restores the draft', () => {
    const items = new Map<string, string>();
    const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
    expect(loadPresetDraft(storage)).toBeNull();
    const draft = shareWolf(setPresetId(draftFromPresets(), 1, 'ashfang'), 'thorn-patrol');
    savePresetDraft(storage, draft);
    expect(loadPresetDraft(storage)).toEqual(draft);
  });
});
