import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, validateWarband, warbandCost, type Warband } from '../src/warband.js';

const legal: Warband = {
  name: 'Test Band',
  units: [
    { name: 'A', quality: 3, combat: 3, move: 3 },
    { name: 'B', quality: 4, combat: 2, move: 3 },
    { name: 'C', quality: 4, combat: 3, move: 3 },
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
      move: 3,
    }));
    const result = validateWarband({ name: 'Horde', units: many });
    expect(result.errors.some((e) => e.includes('too many'))).toBe(true);
  });

  it('rejects an over-budget warband', () => {
    const elites = Array.from({ length: 8 }, (_, i) => ({
      name: `E${i}`,
      quality: 2,
      combat: 5,
      move: 4,
    }));
    const result = validateWarband({ name: 'Deathstar', units: elites });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('over budget'))).toBe(true);
  });

  it('attributes a bad stat to its unit by name and skips the budget check', () => {
    const result = validateWarband({
      name: 'Broken',
      units: [
        { name: 'A', quality: 3, combat: 3, move: 3 },
        { name: 'B', quality: 3, combat: 3, move: 3 },
        { name: 'Gremlin', quality: 9, combat: 3, move: 3 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('Gremlin:'))).toBe(true);
    expect(result.errors.some((e) => e.includes('over budget'))).toBe(false);
  });
});
