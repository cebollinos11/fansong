import { describe, expect, it } from 'vitest';
import { PRESETS, PRESET_IDS, PRESET_ROSTERS, PRESET_UNITS, expandRoster, getPreset, presetUnit } from '../src/presets.js';
import { SHOOTER_KINDS, unitCost, type Profile } from '../src/cost.js';
import { validateWarband, warbandCost } from '../src/warband.js';

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

  it('fields every trait in at least one warband', () => {
    const units = PRESET_IDS.flatMap((id) => PRESETS[id]!.units);
    const traits = [
      'slow', 'fast', 'tough', 'guard', 'big', 'flying', 'reassembling', 'opportunist', 'savage',
      'leader', 'armored', 'sharpshooter', 'mastery', 'shieldwall', 'rusher', 'slippery', 'whirling',
      'immovable', 'woodwise', 'trample', 'dumb', 'disloyal', 'badBalance',
    ] as const satisfies readonly (keyof Profile)[];
    for (const trait of traits) expect(units.some((u) => u[trait]), `no preset unit is ${trait}`).toBe(true);
    for (const kind of SHOOTER_KINDS) expect(units.some((u) => u.shooter === kind), `no ${kind} shooter`).toBe(true);
    // A trait added to the cost model must be added to the list above (and to a warband).
    const priced = { quality: 4, combat: 3 };
    for (const trait of traits) expect(unitCost({ ...priced, [trait]: true }), trait).not.toBe(unitCost(priced));
  });

  it('comes in three sizes: 3 or 4 units near 120 points, and near 250 and 400', () => {
    const bands = { small: [105, 135], medium: [235, 265], large: [380, 420] } as const;
    for (const id of PRESET_IDS) {
      const size = id.slice(id.lastIndexOf('-') + 1) as keyof typeof bands;
      const [min, max] = bands[size];
      const cost = warbandCost(PRESETS[id]!);
      expect(cost, `${id} costs ${cost}`).toBeGreaterThanOrEqual(min);
      expect(cost, `${id} costs ${cost}`).toBeLessThanOrEqual(max);
      if (size === 'small') expect(PRESETS[id]!.units.length).toBeLessThanOrEqual(4);
    }
  });

  it('looks presets up by id and misses cleanly', () => {
    expect(getPreset('iron-wardens-medium')).toBeDefined();
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
