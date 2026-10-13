import { describe, expect, it } from 'vitest';
import {
  LEADER_POOL,
  makeRunRandom,
  NAME_LIMITS,
  PRESET_ROSTERS,
  PRESET_UNITS,
  recruitOffer,
  RUN_TUNING,
  SEA_CREATURES,
  statErrors,
  troopOffer,
  TROOP_POOL,
  unitCost,
} from '../../src/index.js';

describe('the units a run drafts and recruits', () => {
  it('are every legal preset unit, fielded by a warband or not', () => {
    const names = Object.keys(PRESET_UNITS);
    expect(names.length).toBeGreaterThan(200);
    for (const name of names) {
      expect(statErrors(PRESET_UNITS[name]!), name).toEqual([]);
      expect(name.length, name).toBeLessThanOrEqual(NAME_LIMITS.unit);
    }
    const leaders = names.filter((name) => PRESET_UNITS[name]!.leader && !SEA_CREATURES.includes(name));
    expect(TROOP_POOL.length + leaders.length).toBe(names.length - SEA_CREATURES.length);
    expect(TROOP_POOL.some((u) => u.leader)).toBe(false);
  });

  it('let any preset unit lead that costs no more than the draft allows as a Leader', () => {
    const { leaderMax } = RUN_TUNING.draft;
    expect(LEADER_POOL.every((u) => u.leader && unitCost(u) <= leaderMax)).toBe(true);
    expect(new Set(LEADER_POOL.map((u) => u.name)).size).toBe(LEADER_POOL.length);
    // Troops lead too, at the price of the trait; no unit over the cap does.
    expect(LEADER_POOL.some((u) => TROOP_POOL.some((t) => t.name === u.name))).toBe(true);
    for (const t of TROOP_POOL) {
      const led = { ...t, leader: true };
      expect(LEADER_POOL.some((u) => u.name === t.name), t.name).toBe(unitCost(led) <= leaderMax);
    }
  });

  it('offer units no warband fields beside the ones they do', () => {
    const fielded = new Set(Object.values(PRESET_ROSTERS).flatMap((r) => r.units.map((slot) => slot.unit)));
    const offered = new Set<string>();
    for (let seed = 0; seed < 200; seed++) for (const u of recruitOffer(3, makeRunRandom(seed, 1, 0))) offered.add(u.name);
    for (let seed = 0; seed < 50; seed++) for (const u of troopOffer(80, makeRunRandom(seed, 1, 1))) offered.add(u.name);
    expect([...offered].some((name) => fielded.has(name))).toBe(true);
    expect([...offered].some((name) => !fielded.has(name))).toBe(true);
  });

  it('leave the creatures of the sea out', () => {
    expect(SEA_CREATURES.length).toBeGreaterThan(20);
    for (const name of SEA_CREATURES) {
      expect(name in PRESET_UNITS, name).toBe(true);
      expect([...TROOP_POOL, ...LEADER_POOL].some((u) => u.name === name), name).toBe(false);
    }
  });
});
