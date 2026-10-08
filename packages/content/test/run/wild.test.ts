import { describe, expect, it } from 'vitest';
import {
  makeRunRandom,
  PRESET_UNITS,
  RECRUIT_POOL,
  recruitOffer,
  statErrors,
  TROOP_POOL,
  unitCost,
  NAME_LIMITS,
  WILD_UNITS,
} from '../../src/index.js';

describe('wild units', () => {
  it('are legal troops under names no preset unit has', () => {
    expect(WILD_UNITS.length).toBeGreaterThan(150);
    expect(new Set(WILD_UNITS.map((u) => u.name)).size).toBe(WILD_UNITS.length);
    for (const u of WILD_UNITS) {
      expect(statErrors(u), u.name).toEqual([]);
      expect(u.name in PRESET_UNITS, u.name).toBe(false);
      expect(u.name.length, u.name).toBeLessThanOrEqual(NAME_LIMITS.unit);
      expect(u.leader, u.name).toBeUndefined();
    }
  });

  it('are built from their sketch: stats by rank, traits by role, and their own on top', () => {
    const unit = (name: string) => WILD_UNITS.find((u) => u.name === name);
    expect(unit('Dwarvish Miner')).toEqual({ name: 'Dwarvish Miner', quality: 5, combat: 2 });
    expect(unit('Master Bowman')).toEqual({ name: 'Master Bowman', quality: 3, combat: 3, shooter: 'long', sharpshooter: true });
    expect(unit('Assassin')).toEqual({ name: 'Assassin', quality: 3, combat: 4, slippery: true, opportunist: true, savage: true, shooter: 'short' });
    expect(unit('Great Troll')).toEqual({ name: 'Great Troll', quality: 2, combat: 4, big: true, tough: true, savage: true });
    // A seasoned unit costs more than a green one of its line.
    expect(unitCost(unit('Knight')!)).toBeGreaterThan(unitCost(unit('Horseman')!));
  });

  it('are recruited beside the preset troops, but not drafted', () => {
    expect(RECRUIT_POOL).toEqual([...TROOP_POOL, ...WILD_UNITS]);
    const offered = new Set<string>();
    for (let seed = 0; seed < 200; seed++) for (const u of recruitOffer(3, makeRunRandom(seed, 1, 0))) offered.add(u.name);
    expect(WILD_UNITS.some((u) => offered.has(u.name))).toBe(true);
    expect(TROOP_POOL.some((u) => offered.has(u.name))).toBe(true);
  });
});
