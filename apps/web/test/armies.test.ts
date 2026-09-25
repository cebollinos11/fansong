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
import { armyFromPreset, blankUnit, clampStat, moveUnit, templateUnit, uniqueName, withStat, withTrait } from '../src/ui/armyView.js';

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
    expect(choiceWarband('iron-wardens', armies)).toBe(PRESETS['iron-wardens']);
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
  it('clamps stats into range and drops a zero range', () => {
    expect(clampStat('combat', 99)).toBe(6);
    expect(clampStat('quality', 1)).toBe(2);
    expect(clampStat('ranged', NaN)).toBe(0);
    const u = withStat({ name: 'A', quality: 3, combat: 3, ranged: 4 }, 'ranged', 0);
    expect('ranged' in u).toBe(false);
    expect(withStat(u, 'ranged', 3).ranged).toBe(3);
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

  it('keeps unit names unique and preset looks', () => {
    const units = [blankUnit([])];
    expect(units[0]!.name).toBe('Soldier');
    expect(blankUnit(units).name).toBe('Soldier 2');
    expect(uniqueName('X', [])).toBe('X');
    const bow = PRESETS['hollow-watch']!.units[2]!;
    expect(templateUnit(bow, [bow])).toMatchObject({ name: 'Longbow 2', look: 'Longbow', ranged: 4 });
    expect(armyFromPreset('thorn-patrol').units.map((u) => u.look)).toEqual(['Thorn-Bow', 'Thorn-Blade', 'Thorn-Spear']);
  });

  it('reorders units', () => {
    const units = ['a', 'b', 'c'].map((name) => ({ name, quality: 3, combat: 3 }));
    expect(moveUnit(units, 0, 1).map((u) => u.name)).toEqual(['b', 'a', 'c']);
    expect(moveUnit(units, 2, 5).map((u) => u.name)).toEqual(['a', 'b', 'c']);
  });
});
