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
    // 31 + 22 + 27 = 80
    expect(warbandCost(legal)).toBe(80);
  });
});

describe('validateWarband', () => {
  it('accepts a legal warband and reports its cost', () => {
    const result = validateWarband(legal);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.cost).toBe(80);
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

  it('rejects an over-budget warband', () => {
    const elites = Array.from({ length: 8 }, (_, i) => ({
      name: `E${i}`,
      quality: 2,
      combat: 5,
      fast: true,
    }));
    const result = validateWarband({ name: 'Deathstar', units: elites });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('over budget'))).toBe(true);
  });

  it('attributes a bad stat to its unit by name and skips the budget check', () => {
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
    expect(result.errors.some((e) => e.includes('over budget'))).toBe(false);
  });
});

describe('validateArmy (army builder: no point limit)', () => {
  const grunt = { name: 'Grunt', quality: 2, combat: 6, fast: true, ranged: 8, tough: true, guard: true };

  it('accepts any point total within the roster size', () => {
    const army: Warband = { name: 'Horde', units: Array.from({ length: ARMY_RULES.maxUnits }, () => grunt) };
    const check = validateArmy(army);
    expect(check.ok).toBe(true);
    expect(check.cost).toBeGreaterThan(DEFAULT_RULES.budget * 10);
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

  it('rejects malformed input with a friendly error', () => {
    expect(() => parseWarband(null)).toThrow(/Not an army/);
    expect(() => parseWarband({ name: 'X' })).toThrow(/unit list/);
    expect(() => parseWarband({ name: 'X', units: [{ name: 'A', quality: '3', combat: 3 }] })).toThrow(/quality/);
  });
});
