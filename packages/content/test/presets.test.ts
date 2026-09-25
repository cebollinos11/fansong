import { describe, expect, it } from 'vitest';
import { PRESETS, PRESET_IDS, PRESET_ROSTERS, PRESET_UNITS, expandRoster, getPreset, presetUnit } from '../src/presets.js';
import { validateWarband } from '../src/warband.js';

describe('preset warbands', () => {
  it('exposes at least three presets', () => {
    expect(PRESET_IDS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(PRESET_IDS)('%s is legal under the default rules', (id) => {
    const result = validateWarband(PRESETS[id]!);
    expect(result.ok, result.errors.join('; ')).toBe(true);
  });

  it('gives every unit a distinct name within its warband', () => {
    for (const id of PRESET_IDS) {
      const names = PRESETS[id]!.units.map((u) => u.name);
      expect(new Set(names).size, `duplicate name in ${id}`).toBe(names.length);
    }
  });

  it('looks presets up by id and misses cleanly', () => {
    expect(getPreset('iron-wardens')).toBeDefined();
    expect(getPreset('no-such-band')).toBeUndefined();
  });

  it('builds every preset from shared units that exist', () => {
    for (const [id, roster] of Object.entries(PRESET_ROSTERS)) {
      for (const slot of roster.units) {
        expect(PRESET_UNITS[slot.unit], `${id} names "${slot.unit}"`).toBeDefined();
        expect(Number.isInteger(slot.count ?? 1) && (slot.count ?? 1) >= 1, `${id}: count of ${slot.unit}`).toBe(true);
      }
    }
    expect(PRESET_IDS).toEqual(Object.keys(PRESET_ROSTERS));
  });

  it('expands a counted line into numbered copies drawn as the unit', () => {
    const w = expandRoster({ name: 'Pack', units: [{ unit: 'Wolf', count: 3 }, { unit: 'Bear' }] }, presetUnit);
    expect(w.units.map((u) => [u.name, u.look])).toEqual([
      ['Wolf', undefined],
      ['Wolf 2', 'Wolf'],
      ['Wolf 3', 'Wolf'],
      ['Bear', undefined],
    ]);
    expect(w.units[2]).toMatchObject(PRESET_UNITS.Wolf!);
    expect(() => expandRoster({ name: 'Nope', units: [{ unit: 'Dragon' }] }, presetUnit)).toThrow('Nope: no unit "Dragon"');
  });
});
