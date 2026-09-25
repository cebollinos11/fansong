import { describe, expect, it } from 'vitest';
import { BASE_MOVE } from '@fansong/engine';
import {
  COST_WEIGHTS,
  profileMove,
  profileRange,
  SHOOTER_KINDS,
  shooterForRange,
  STAT_BOUNDS,
  statErrors,
  unitCost,
  type Profile,
  type ShooterKind,
} from '../src/cost.js';

const baseline: Profile = { quality: 3, combat: 3 };

describe('unitCost', () => {
  it('costs a baseline profile by (C*5 + SA) * (7-Q) / 2', () => {
    // (3*5 + 0) * (7-3) / 2 = 30
    expect(unitCost(baseline)).toBe(30);
    // (4*5 + 0) * (7-2) / 2 = 50
    expect(unitCost({ quality: 2, combat: 4 })).toBe(50);
  });

  it('rounds a half point up', () => {
    // (3*5 + 0) * (7-4) / 2 = 22.5
    expect(unitCost({ quality: 4, combat: 3 })).toBe(23);
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

  it('adds 3 per favorable trait, scaled by Quality', () => {
    // (3*5 + 3) * (7-3) / 2 = 36
    for (const trait of ['fast', 'tough', 'guard', 'big', 'flying', 'reassembling'] as const) {
      expect(unitCost({ ...baseline, [trait]: true })).toBe(36);
    }
    for (const shooter of SHOOTER_KINDS) expect(unitCost({ ...baseline, shooter })).toBe(36);
    // (3*5 + 6) * (7-3) / 2 = 42
    expect(unitCost({ ...baseline, tough: true, guard: true })).toBe(42);
  });


  it('takes 3 off per unfavorable trait, scaled by Quality', () => {
    // (3*5 - 3) * (7-3) / 2 = 24
    expect(unitCost({ ...baseline, slow: true })).toBe(24);
    expect(COST_WEIGHTS.unfavorable).toBe(-COST_WEIGHTS.favorable);
  });

  it('never returns less than 1 even for the worst legal stats', () => {
    const worst: Profile = { quality: STAT_BOUNDS.quality[1], combat: STAT_BOUNDS.combat[0], slow: true };
    expect(unitCost(worst)).toBeGreaterThanOrEqual(1);
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
    expect(statErrors({ quality: 0, combat: 0 })).toHaveLength(2);
  });

  it('rejects a unit both Slow and Fast', () => {
    expect(statErrors({ ...baseline, slow: true })).toEqual([]);
    expect(statErrors({ ...baseline, fast: true })).toEqual([]);
    expect(statErrors({ ...baseline, slow: true, fast: true })).toHaveLength(1);
  });

  it('accepts each Shooter trait and rejects an unknown one', () => {
    for (const shooter of SHOOTER_KINDS) expect(statErrors({ ...baseline, shooter })).toEqual([]);
    expect(statErrors({ ...baseline, shooter: 'huge' as ShooterKind })).toHaveLength(1);
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

describe('profileRange', () => {
  it('gives short range 3, Shooter 5 and long range 7, and melee units 0', () => {
    expect(profileRange({ shooter: 'short' })).toBe(3);
    expect(profileRange({ shooter: 'normal' })).toBe(5);
    expect(profileRange({ shooter: 'long' })).toBe(7);
    expect(profileRange(baseline)).toBe(0);
  });
});

describe('shooterForRange', () => {
  it('picks the Shooter trait nearest a raw range, ties going longer', () => {
    expect(shooterForRange(0)).toBeUndefined();
    expect([1, 2, 3].map(shooterForRange)).toEqual(['short', 'short', 'short']);
    expect([4, 5].map(shooterForRange)).toEqual(['normal', 'normal']);
    expect([6, 7, 8].map(shooterForRange)).toEqual(['long', 'long', 'long']);
  });
});
