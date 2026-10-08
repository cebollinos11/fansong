import { describe, expect, it } from 'vitest';
import {
  makeRunRandom,
  PRESET_UNITS,
  recruitOffer,
  SEA_CREATURES,
  troopOffer,
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

  it('are drafted and recruited beside the preset troops', () => {
    for (const u of WILD_UNITS) expect(TROOP_POOL).toContain(u);
    const offered = new Set<string>();
    for (let seed = 0; seed < 200; seed++) for (const u of recruitOffer(3, makeRunRandom(seed, 1, 0))) offered.add(u.name);
    expect(WILD_UNITS.some((u) => offered.has(u.name))).toBe(true);
    expect(TROOP_POOL.some((u) => u.name in PRESET_UNITS && offered.has(u.name))).toBe(true);
    const drafted = new Set<string>();
    for (let seed = 0; seed < 50; seed++) for (const u of troopOffer(80, makeRunRandom(seed, 1, 1))) drafted.add(u.name);
    expect(WILD_UNITS.some((u) => drafted.has(u.name))).toBe(true);
  });

  it('leave the creatures of the sea out', () => {
    expect(SEA_CREATURES.length).toBeGreaterThan(20);
    for (const name of SEA_CREATURES) expect(WILD_UNITS.some((u) => u.name === name), name).toBe(false);
    expect(WILD_UNITS.some((u) => /Merman|Naga|Kraken/.test(u.name))).toBe(false);
  });
});
