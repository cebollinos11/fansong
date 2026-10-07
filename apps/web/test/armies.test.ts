import { describe, expect, it } from 'vitest';
import { PRESETS, type Warband, type WarbandUnit } from '@fansong/content';
import {
  ARMIES_KEY,
  armyChoice,
  armyFileName,
  choiceWarband,
  deleteArmy,
  loadArmies,
  newArmyId,
  parseArmyText,
  playableArmies,
  saveArmy,
} from '../src/game/armies.js';
import type { MapStorage } from '../src/game/customMaps.js';
import {
  armyFromPreset,
  blankUnit,
  clampStat,
  copyBase,
  copyLabel,
  EDITOR_TRAITS,
  moveUnit,
  renumberRun,
  templateUnit,
  TRAIT_GROUPS,
  traitCost,
  traitPatch,
  traitReplaced,
  traitsOf,
  uniqueName,
  unitRuns,
  withRunUnit,
  withStat,
  withTint,
  withTrait,
} from '../src/ui/armyView.js';

function memoryStorage(initial: Record<string, string> = {}): MapStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const ARMY: Warband = { name: 'Horde', units: [{ name: 'Grunt', quality: 3, combat: 4, fast: true, look: 'Marauder' }] };

describe('saved armies', () => {
  it('saves, replaces by id, loads and deletes', () => {
    const s = memoryStorage();
    saveArmy(s, { id: 'a1', warband: ARMY });
    saveArmy(s, { id: 'a2', warband: { ...ARMY, name: 'Other' } });
    saveArmy(s, { id: 'a1', warband: { ...ARMY, name: 'Renamed' } });
    expect(loadArmies(s).map((a) => [a.id, a.warband.name])).toEqual([
      ['a1', 'Renamed'],
      ['a2', 'Other'],
    ]);
    expect(deleteArmy(s, 'a1').map((a) => a.id)).toEqual(['a2']);
    expect(loadArmies(s).map((a) => a.id)).toEqual(['a2']);
  });

  it('skips corrupt storage and entries instead of throwing', () => {
    expect(loadArmies(null)).toEqual([]);
    expect(loadArmies(memoryStorage({ [ARMIES_KEY]: '{oops' }))).toEqual([]);
    const mixed = JSON.stringify([
      { id: 'a1', warband: ARMY },
      { id: 5 },
      { id: 'a3', warband: { name: 1 } },
      { id: 'a1', warband: ARMY },
    ]);
    expect(loadArmies(memoryStorage({ [ARMIES_KEY]: mixed }))).toEqual([{ id: 'a1', warband: ARMY }]);
  });

  it('offers only playable armies for play', () => {
    const s = memoryStorage();
    saveArmy(s, { id: 'ok', warband: ARMY });
    saveArmy(s, { id: 'bad', warband: { name: 'Empty', units: [] } });
    expect(playableArmies(s).map((a) => a.id)).toEqual(['ok']);
  });

  it('throws when storage is unavailable', () => {
    expect(() => saveArmy(null, { id: 'a1', warband: ARMY })).toThrow(/unavailable/);
  });

  it('resolves setup choices to presets or saved armies', () => {
    const armies = [{ id: 'a1', warband: ARMY }];
    expect(choiceWarband('iron-wardens-medium', armies)).toBe(PRESETS['iron-wardens-medium']);
    expect(choiceWarband(armyChoice('a1'), armies)).toBe(ARMY);
    expect(choiceWarband(armyChoice('gone'), armies)).toBeUndefined();
  });

  it('mints ids no army uses', () => {
    expect(newArmyId([{ id: 'a' + (100).toString(36), warband: ARMY }], 100)).toBe('a' + (101).toString(36));
  });

  it('imports army files and names exports', () => {
    expect(parseArmyText(JSON.stringify(ARMY))).toEqual(ARMY);
    expect(() => parseArmyText('nope')).toThrow(/JSON/);
    const tooMany = { name: 'X', units: Array.from({ length: 31 }, () => ARMY.units[0]) };
    expect(() => parseArmyText(JSON.stringify(tooMany))).toThrow(/most allowed/);
    expect(armyFileName({ ...ARMY, name: 'My  Horde!' })).toBe('my-horde.json');
    expect(armyFileName({ ...ARMY, name: '!!' })).toBe('army.json');
  });
});

describe('army builder helpers', () => {
  it('clamps stats into range', () => {
    expect(clampStat('combat', 99)).toBe(6);
    expect(clampStat('quality', 1)).toBe(2);
    expect(clampStat('combat', NaN)).toBe(1);
    expect(withStat({ name: 'A', quality: 3, combat: 3 }, 'combat', 9).combat).toBe(6);
  });

  it('treats each Shooter kind as a trait, one at a time, dropping the key for melee only', () => {
    const u = withTrait({ name: 'A', quality: 3, combat: 3 }, 'shooter-long', true);
    expect(u.shooter).toBe('long');
    const short = withTrait(u, 'shooter-short', true);
    expect(short.shooter).toBe('short');
    expect(traitReplaced(u, 'shooter-short')).toBe('shooter-long');
    expect('shooter' in withTrait(short, 'shooter-short', false)).toBe(false);
    // Removing a Shooter kind the unit doesn't have leaves its own alone.
    expect(withTrait(short, 'shooter-long', false).shooter).toBe('short');
  });

  it('patches a live unit with false for traits switched off', () => {
    const unit = { name: 'A', quality: 3, combat: 3, slow: true };
    expect(traitPatch(unit, 'fast', true)).toEqual({ fast: true, slow: false });
    expect(traitPatch(unit, 'slow', false)).toEqual({ slow: false });
    expect(traitPatch({ ...unit, shooter: 'normal' }, 'shooter-normal', false)).toEqual({ shooter: undefined });
  });

  it('toggles traits, dropping the key when off', () => {
    const on = withTrait({ name: 'A', quality: 3, combat: 3 }, 'tough', true);
    expect(on.tough).toBe(true);
    expect('tough' in withTrait(on, 'tough', false)).toBe(false);
  });

  it('keeps Slow and Fast exclusive', () => {
    const slow = withTrait({ name: 'A', quality: 3, combat: 3 }, 'slow', true);
    const fast = withTrait(slow, 'fast', true);
    expect(fast).toEqual({ name: 'A', quality: 3, combat: 3, fast: true });
    expect(withTrait(fast, 'slow', true)).toEqual({ name: 'A', quality: 3, combat: 3, slow: true });
  });

  it('lists a unit’s traits in display order, skipping ones switched off', () => {
    const unit = { name: 'A', quality: 3, combat: 3 };
    expect(traitsOf({ ...unit, sharpshooter: true, tough: true, slow: false, shooter: 'long' })).toEqual([
      'shooter-long',
      'tough',
      'sharpshooter',
    ]);
    expect(traitsOf(unit)).toEqual([]);
  });

  it('prices a trait by what it would add to this unit', () => {
    const unit = { name: 'A', quality: 3, combat: 3 };
    expect(traitCost(unit, 'tough')).toBe(6);
    expect(traitCost(unit, 'leader')).toBe(12);
    expect(traitCost(unit, 'slow')).toBe(-6);
    // Quality 6 scales by 1, and the halves round up: 8 → 9.
    expect(traitCost({ ...unit, quality: 6 }, 'tough')).toBe(1);
    // Fast on a Slow unit drops the Slow rebate too.
    expect(traitCost({ ...unit, slow: true }, 'fast')).toBe(12);
    // Every Shooter kind costs one trait; swapping one for another is free.
    expect(traitCost(unit, 'shooter-long')).toBe(6);
    expect(traitCost({ ...unit, shooter: 'short' }, 'shooter-long')).toBe(0);
  });

  it('keeps unit names unique and preset looks', () => {
    const units = [blankUnit([])];
    expect(units[0]!.name).toBe('Soldier');
    expect(blankUnit(units).name).toBe('Soldier 2');
    expect(uniqueName('X', [])).toBe('X');
    const bow = PRESETS['iron-wardens-medium']!.units.find((u) => u.name === 'Crossbow')!;
    expect(templateUnit(bow, [bow])).toMatchObject({ name: 'Crossbow 2', look: 'Crossbow', shooter: 'long' });
    expect(armyFromPreset('wolf-pack-small').units.map((u) => u.look)).toEqual(['Wolf', 'Wolf', 'Wolf']);
  });

  it('tints a unit and drops the key when the tint is switched off', () => {
    const unit = { name: 'A', quality: 3, combat: 3 };
    const tinted = withTint(unit, '#336699');
    expect(tinted.tint).toBe('#336699');
    expect(withTint(tinted, undefined)).toEqual(unit);
    expect('tint' in withTint(tinted, undefined)).toBe(false);
  });

  it('reorders units', () => {
    const units = ['a', 'b', 'c'].map((name) => ({ name, quality: 3, combat: 3 }));
    expect(moveUnit(units, 0, 1).map((u) => u.name)).toEqual(['b', 'a', 'c']);
    expect(moveUnit(units, 2, 5).map((u) => u.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('roster rows that stand for several units', () => {
  const foot = (name: string): WarbandUnit => ({ name, quality: 4, combat: 3, look: 'Recruit' });

  it('names the copies the way "+ Add unit" does', () => {
    expect(copyLabel('Soldier', 1)).toBe('Soldier');
    expect(copyLabel('Soldier', 3)).toBe('Soldier 3');
    expect(copyBase('Soldier 3')).toBe('Soldier');
    expect(copyBase('Soldier')).toBe('Soldier');
  });

  it('folds neighbouring copies into one row and leaves named units alone', () => {
    const units = [foot('Soldier'), foot('Soldier 2'), foot('Soldier 3'), { ...foot('Bob'), combat: 4 }, foot('Alice')];
    expect(unitRuns(units).map((r) => [r.unit.name, r.at, r.count])).toEqual([
      ['Soldier', 0, 3],
      ['Bob', 3, 1],
      // Alice is the same kind as the Soldiers but is not one of their copies.
      ['Alice', 4, 1],
    ]);
  });

  it('does not fold units that only look alike because they are drawn by name', () => {
    const byName = [
      { name: 'Soldier', quality: 4, combat: 3 },
      { name: 'Soldier 2', quality: 4, combat: 3 },
    ];
    expect(unitRuns(byName)).toHaveLength(2);
  });

  it('edits every unit of a row at once, each keeping its name', () => {
    const units = [foot('Soldier'), foot('Soldier 2'), foot('Keeper')];
    const run = unitRuns(units)[0]!;
    const edited = withRunUnit(units, run, withStat(run.unit, 'combat', 5));
    expect(edited.map((u) => [u.name, u.combat])).toEqual([
      ['Soldier', 5],
      ['Soldier 2', 5],
      ['Keeper', 3],
    ]);
  });

  it('renumbers a row when it is renamed or resized, and empties it to remove it', () => {
    const units = [foot('Soldier'), foot('Soldier 2'), foot('Keeper')];
    const run = unitRuns(units)[0]!;
    expect(renumberRun(units, run, 'Guard', 2).map((u) => u.name)).toEqual(['Guard', 'Guard 2', 'Keeper']);
    expect(renumberRun(units, run, 'Soldier', 4).map((u) => u.name)).toEqual([
      'Soldier',
      'Soldier 2',
      'Soldier 3',
      'Soldier 4',
      'Keeper',
    ]);
    expect(renumberRun(units, run, 'Soldier', 1).map((u) => u.name)).toEqual(['Soldier', 'Keeper']);
    expect(renumberRun(units, run, 'Soldier', 0).map((u) => u.name)).toEqual(['Keeper']);
  });

  it('keeps a resized row folded, so the stepper can go back down again', () => {
    const units = [foot('Soldier'), foot('Keeper')];
    const grown = renumberRun(units, unitRuns(units)[0]!, 'Soldier', 3);
    expect(unitRuns(grown)[0]).toMatchObject({ at: 0, count: 3 });
  });

  it('offers every trait in the menu exactly once', () => {
    const grouped = TRAIT_GROUPS.flatMap((g) => g.traits);
    expect([...grouped].sort()).toEqual([...EDITOR_TRAITS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});
