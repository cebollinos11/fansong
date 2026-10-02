import { describe, expect, it } from 'vitest';
import { PRESETS, type Warband } from '@fansong/content';
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
import { armyFromPreset, blankUnit, clampStat, moveUnit, templateUnit, traitCost, traitPatch, traitReplaced, traitsOf, uniqueName, withStat, withTint, withTrait } from '../src/ui/armyView.js';

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
    const bow = PRESETS['iron-wardens-large']!.units.find((u) => u.name === 'Longbow')!;
    expect(templateUnit(bow, [bow])).toMatchObject({ name: 'Longbow 2', look: 'Longbow', shooter: 'long' });
    expect(armyFromPreset('iron-wardens-small').units.map((u) => u.look)).toEqual(['Warden-Captain', 'Ironguard', 'Crossbow']);
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
