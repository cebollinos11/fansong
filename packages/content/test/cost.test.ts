import { describe, expect, it } from 'vitest';
import { BASE_MOVE, SPEED_STEP } from '@fansong/engine';
import { COST_WEIGHTS, profileMove, STAT_BOUNDS, statErrors, unitCost, type Profile } from '../src/cost.js';

const baseline: Profile = { quality: 3, combat: 3 };

describe('unitCost', () => {
  it('costs a baseline profile at a stable known value', () => {
    // base 4 + (6-3)*4 + 3*5 + 0 = 31
    expect(unitCost(baseline)).toBe(31);
  });

  it('makes better Quality (lower number) cost more', () => {
    const better = unitCost({ ...baseline, quality: 2 });
    const worse = unitCost({ ...baseline, quality: 5 });
    expect(better).toBeGreaterThan(unitCost(baseline));
    expect(unitCost(baseline)).toBeGreaterThan(worse);
  });

  it('makes higher Combat cost more, linearly', () => {
    const c2 = unitCost({ ...baseline, combat: 2 });
    const c3 = unitCost({ ...baseline, combat: 3 });
    const c4 = unitCost({ ...baseline, combat: 4 });
    expect(c3 - c2).toBe(c4 - c3);
    expect(c4).toBeGreaterThan(c2);
  });

  it('charges for Fast and rebates Slow, per cell of Move they shift', () => {
    const step = SPEED_STEP * COST_WEIGHTS.perMove;
    expect(unitCost({ ...baseline, fast: true }) - unitCost(baseline)).toBe(step);
    expect(unitCost(baseline) - unitCost({ ...baseline, slow: true })).toBe(step);
  });

  it('never returns less than 1 even for the worst legal stats', () => {
    const worst: Profile = { quality: STAT_BOUNDS.quality[1], combat: STAT_BOUNDS.combat[0], slow: true };
    expect(unitCost(worst)).toBeGreaterThanOrEqual(1);
  });

  it('charges per cell of ranged reach', () => {
    expect(unitCost({ ...baseline, ranged: 4 }) - unitCost(baseline)).toBe(4 * COST_WEIGHTS.perRanged);
    expect(unitCost({ ...baseline, ranged: 0 })).toBe(unitCost(baseline));
  });

  it('charges a flat surcharge for Tough and Guard', () => {
    expect(unitCost({ ...baseline, tough: true }) - unitCost(baseline)).toBe(COST_WEIGHTS.tough);
    expect(unitCost({ ...baseline, guard: true }) - unitCost(baseline)).toBe(COST_WEIGHTS.guard);
    expect(unitCost({ ...baseline, tough: true, guard: true }) - unitCost(baseline)).toBe(
      COST_WEIGHTS.tough + COST_WEIGHTS.guard,
    );
  });

  it('charges for Big, but under a point of Combat — it cuts both ways', () => {
    expect(unitCost({ ...baseline, big: true }) - unitCost(baseline)).toBe(COST_WEIGHTS.big);
    expect(COST_WEIGHTS.big).toBeLessThan(COST_WEIGHTS.perCombat);
  });

  it('charges a flat surcharge for Flying', () => {
    expect(unitCost({ ...baseline, flying: true }) - unitCost(baseline)).toBe(COST_WEIGHTS.flying);
  });

  it('charges a flat surcharge for Reassembling, under a Tough save', () => {
    expect(unitCost({ ...baseline, reassembling: true }) - unitCost(baseline)).toBe(COST_WEIGHTS.reassembling);
    expect(COST_WEIGHTS.reassembling).toBeLessThan(COST_WEIGHTS.tough);
  });
});

describe('statErrors', () => {
  it('accepts in-range stats', () => {
    expect(statErrors(baseline)).toEqual([]);
  });

  it('rejects out-of-range and non-integer stats', () => {
    expect(statErrors({ quality: 1, combat: 3 })).toHaveLength(1);
    expect(statErrors({ quality: 3, combat: 9 })).toHaveLength(1);
    expect(statErrors({ quality: 3.5, combat: 3 })).toHaveLength(1);
    expect(statErrors({ quality: 0, combat: 0, ranged: -1 })).toHaveLength(3);
  });

  it('rejects a unit both Slow and Fast', () => {
    expect(statErrors({ ...baseline, slow: true })).toEqual([]);
    expect(statErrors({ ...baseline, fast: true })).toEqual([]);
    expect(statErrors({ ...baseline, slow: true, fast: true })).toHaveLength(1);
  });

  it('rejects a ranged value out of range but accepts an omitted one', () => {
    expect(statErrors({ ...baseline, ranged: 9 })).toHaveLength(1);
    expect(statErrors({ ...baseline, ranged: 4 })).toEqual([]);
    expect(statErrors(baseline)).toEqual([]); // ranged omitted == 0
  });
});

describe('profileMove', () => {
  it('is the base Move, shifted down by Slow and up by Fast', () => {
    expect(BASE_MOVE).toBe(5);
    expect(profileMove(baseline)).toBe(5);
    expect(profileMove({ slow: true })).toBe(3);
    expect(profileMove({ fast: true })).toBe(7);
  });
});
