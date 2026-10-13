import { describe, expect, it } from 'vitest';
import {
  LEADER_POOL,
  makeRunRandom,
  NAME_LIMITS,
  PRESET_ROSTERS,
  PRESET_UNITS,
  recruitOffer,
  SEA_CREATURES,
  statErrors,
  troopOffer,
  TROOP_POOL,
} from '../../src/index.js';

describe('the units a run drafts and recruits', () => {
  it('are every legal preset unit, fielded by a warband or not', () => {
    const names = Object.keys(PRESET_UNITS);
    expect(names.length).toBeGreaterThan(200);
    for (const name of names) {
      expect(statErrors(PRESET_UNITS[name]!), name).toEqual([]);
      expect(name.length, name).toBeLessThanOrEqual(NAME_LIMITS.unit);
    }
    expect(TROOP_POOL.length + LEADER_POOL.length).toBe(names.length - SEA_CREATURES.length);
    expect(TROOP_POOL.some((u) => u.leader)).toBe(false);
    expect(LEADER_POOL.every((u) => u.leader)).toBe(true);
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
