import { describe, expect, it } from 'vitest';
import {
  ARMY_RULES,
  DEFAULT_RULES,
  parseWarband,
  validateArmy,
  validateWarband,
  warbandCost,
  type Warband,
} from '../src/warband.js';

const legal: Warband = {
  name: 'Test Band',
  units: [
    { name: 'A', quality: 3, combat: 3 },
    { name: 'B', quality: 4, combat: 2 },
    { name: 'C', quality: 4, combat: 3 },
  ],
};

describe('warbandCost', () => {
  it('sums the unit costs', () => {
    // 30 + 15 + 23 = 68
    expect(warbandCost(legal)).toBe(68);
  });
});

describe('validateWarband', () => {
  it('accepts a legal warband and reports its cost', () => {
    const result = validateWarband(legal);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.cost).toBe(68);
  });

  it('rejects a roster that is too small', () => {
    const result = validateWarband({ name: 'Tiny', units: [legal.units[0]!] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('too few'))).toBe(true);
  });

  it('rejects a roster that is too large', () => {
    const many = Array.from({ length: DEFAULT_RULES.maxUnits + 1 }, (_, i) => ({
      name: `U${i}`,
      quality: 4,
      combat: 2,
    }));
    const result = validateWarband({ name: 'Horde', units: many });
    expect(result.errors.some((e) => e.includes('too many'))).toBe(true);
  });

  it('has no point limit', () => {
    const elites = Array.from({ length: 8 }, (_, i) => ({
      name: `E${i}`,
      quality: 2,
      combat: 5,
      fast: true,
    }));
    const result = validateWarband({ name: 'Deathstar', units: elites });
    expect(result.ok).toBe(true);
    // (5*5 + 3) * (7-2) / 2 = 70 each
    expect(result.cost).toBe(8 * 70);
  });

  it('attributes a bad stat to its unit by name and costs only the clean units', () => {
    const result = validateWarband({
      name: 'Broken',
      units: [
        { name: 'A', quality: 3, combat: 3 },
        { name: 'B', quality: 3, combat: 3 },
        { name: 'Gremlin', quality: 9, combat: 3 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('Gremlin:'))).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.cost).toBe(60);
  });
});

describe('validateArmy (army builder)', () => {
  const grunt = { name: 'Grunt', quality: 2, combat: 6, fast: true, shooter: 'long' as const, tough: true, guard: true };

  it('accepts any point total within the roster size', () => {
    const army: Warband = { name: 'Horde', units: Array.from({ length: ARMY_RULES.maxUnits }, () => grunt) };
    const check = validateArmy(army);
    expect(check.ok).toBe(true);
    expect(check.cost).toBeGreaterThan(1000);
  });

  it('allows a single unit but not none, nor more than the cap', () => {
    expect(validateArmy({ name: 'Lone', units: [grunt] }).ok).toBe(true);
    expect(validateArmy({ name: 'Empty', units: [] }).errors).toContain('too few units: 0 < 1');
    const over = validateArmy({ name: 'Over', units: Array.from({ length: ARMY_RULES.maxUnits + 1 }, () => grunt) });
    expect(over.ok).toBe(false);
  });

  it('still checks stat ranges and names', () => {
    const check = validateArmy({ name: ' ', units: [{ ...grunt, combat: 7 }, { ...grunt, name: '' }] });
    expect(check.errors).toEqual(expect.arrayContaining(['the army needs a name', 'unit 2 needs a name']));
    expect(check.errors.some((e) => e.includes('combat 7'))).toBe(true);
  });
});

describe('parseWarband', () => {
  it('keeps known fields, drops unknown ones and false traits', () => {
    const w = parseWarband({
      name: 'X',
      extra: 1,
      units: [
        { name: 'A', quality: 3, combat: 3, fast: true, tough: false, guard: true, big: true, look: 'Longbow', hp: 9 },
      ],
    });
    expect(w).toEqual({
      name: 'X',
      units: [{ name: 'A', quality: 3, combat: 3, fast: true, guard: true, big: true, look: 'Longbow' }],
    });
  });

  it('turns a legacy numeric Move (baseline 3) into Slow or Fast', () => {
    const w = parseWarband({
      name: 'Old',
      units: [
        { name: 'S', quality: 3, combat: 3, move: 2 },
        { name: 'N', quality: 3, combat: 3, move: 3 },
        { name: 'F', quality: 3, combat: 3, move: 5 },
      ],
    });
    expect(w.units).toEqual([
      { name: 'S', quality: 3, combat: 3, slow: true },
      { name: 'N', quality: 3, combat: 3 },
      { name: 'F', quality: 3, combat: 3, fast: true },
    ]);
  });

  it('keeps a Shooter trait, drops an unknown one, and turns a legacy range into the nearest', () => {
    const w = parseWarband({
      name: 'Bows',
      units: [
        { name: 'L', quality: 3, combat: 2, shooter: 'long' },
        { name: 'X', quality: 3, combat: 2, shooter: 'huge' },
        { name: 'R3', quality: 3, combat: 2, ranged: 3 },
        { name: 'R4', quality: 3, combat: 2, ranged: 4 },
        { name: 'R8', quality: 3, combat: 2, ranged: 8 },
        { name: 'R0', quality: 3, combat: 2, ranged: 0 },
      ],
    });
    expect(w.units.map((u) => u.shooter)).toEqual(['long', undefined, 'short', 'normal', 'long', undefined]);
    expect(w.units.every((u) => !('ranged' in u))).toBe(true);
  });

  it('rejects malformed input with a friendly error', () => {
    expect(() => parseWarband(null)).toThrow(/Not an army/);
    expect(() => parseWarband({ name: 'X' })).toThrow(/unit list/);
    expect(() => parseWarband({ name: 'X', units: [{ name: 'A', quality: '3', combat: 3 }] })).toThrow(/quality/);
  });
});
