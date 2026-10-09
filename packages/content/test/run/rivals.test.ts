import { describe, expect, it } from 'vitest';
import {
  enemyPoints,
  generateEncounter,
  isBossRound,
  newRun,
  presetUnit,
  RIVAL_FACTION,
  RUN_TUNING,
  runStep,
  scheduleRivals,
  warbandCost,
  type Warband,
} from '../../src/index.js';
import { autoUntil } from './helpers.js';

/** A past warband of `count` copies of a preset unit. */
function past(name: string, unit: string, count: number): Warband {
  return { name, units: Array.from({ length: count }, (_, i) => ({ ...presetUnit(unit)!, name: `${unit} ${i + 1}` })) };
}

const PAST = [past('A', 'Wolf', 3), past('B', 'Wolf', 6), past('C', 'Wolf', 10), past('D', 'Wolf', 14), past('E', 'Wolf', 20)];

describe('scheduleRivals', () => {
  it('puts each past warband in a regular round whose budget fits its cost, one to a round, up to the cap', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rivals = scheduleRivals(seed, PAST);
      expect(rivals.length).toBeLessThanOrEqual(RUN_TUNING.rivals.max);
      expect(new Set(rivals.map((r) => r.round)).size).toBe(rivals.length);
      for (const { round, warband } of rivals) {
        expect(round).toBeGreaterThanOrEqual(RUN_TUNING.rivals.fromRound);
        expect(isBossRound(round)).toBe(false);
        const ratio = warbandCost(warband) / enemyPoints(round);
        expect(ratio).toBeGreaterThanOrEqual(RUN_TUNING.rivals.band.min);
        expect(ratio).toBeLessThanOrEqual(RUN_TUNING.rivals.band.max);
      }
      expect(scheduleRivals(seed, PAST)).toEqual(rivals);
    }
  });

  it('leaves out warbands too small to field, and needs none', () => {
    expect(scheduleRivals(1, [])).toEqual([]);
    expect(scheduleRivals(1, [past('Tiny', 'Wolf', RUN_TUNING.enemy.minUnits - 1)])).toEqual([]);
  });
});

describe('a run with rivals', () => {
  it('offers a past warband as one of its round\'s missions, in the mode and match seed that round would have had', () => {
    const s = newRun(5, PAST);
    const rival = s.rivals![0]!;
    // Walk the run to the rival's round, losing nothing: jump the round counter at the shop.
    let at = autoUntil(s, 'briefing');
    at = { ...at, phase: 'shop', round: rival.round - 1, offer: { kind: 'shop', recruits: [], upgrades: [], rerolls: 0 } };
    at = runStep(at, { type: 'leaveShop' });
    const offer = at.offer!;
    if (offer.kind !== 'missions') throw new Error('no missions on offer');
    const index = offer.missions.findIndex((m) => m.faction === RIVAL_FACTION);
    expect(offer.missions.filter((m) => m.faction === RIVAL_FACTION)).toHaveLength(1);
    expect(offer.missions).toHaveLength(RUN_TUNING.mission.count);
    expect(offer.missions[index]!.enemy).toEqual(rival.warband);
    expect(offer.missions[index]!.threat).toBeCloseTo(warbandCost(rival.warband) / enemyPoints(rival.round), 10);
    const plain = generateEncounter(5, rival.round, at.roster.length);
    expect(offer.seed).toBe(plain.seed);
    expect(offer.mode).toBe(plain.mode);
    // The other missions are the ones the round would have had anyway.
    const others = offer.missions.filter((m) => m.faction !== RIVAL_FACTION).map((m) => m.enemy);
    for (const enemy of others) expect(plain.enemies.map((e) => e.warband)).toContainEqual(enemy);
    at = runStep(at, { type: 'pickMission', index });
    expect(at.battle!.faction).toBe(RIVAL_FACTION);
    expect(at.battle!.enemy).toEqual(rival.warband);
  });

  it('is the same run as one without rivals up to then', () => {
    expect(newRun(9, PAST).offer).toEqual(newRun(9).offer);
  });
});
