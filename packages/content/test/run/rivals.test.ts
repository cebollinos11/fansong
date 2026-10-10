import { describe, expect, it } from 'vitest';
import {
  actOf,
  enemyPoints,
  generateRoute,
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
import { atStep } from './helpers.js';

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
        // Never the step under a boss: it is all camps and markets.
        expect(isBossRound(round + 1)).toBe(false);
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
  it("marks a battle node of its step for a past warband, and fields it there in the node's own mode", () => {
    let met = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rivals = newRun(seed, PAST).rivals!;
      for (const rival of rivals) {
        const route = generateRoute(seed, actOf(rival.round), rivals);
        const marked = route.nodes.filter((n) => n.rival && n.step === rival.round);
        // A step with no plain battle on it has nowhere for a rival to wait.
        expect(marked.length).toBe(route.nodes.some((n) => n.step === rival.round && (n.kind === 'battle' || n.rival)) ? 1 : 0);
        const node = marked[0];
        if (!node) continue;
        met++;
        expect(node).toMatchObject({ kind: 'battle', faction: RIVAL_FACTION, threat: warbandCost(rival.warband) / enemyPoints(rival.round) });
        // Take the mark away and the map is the one the run would have had anyway.
        const plain = generateRoute(seed, actOf(rival.round)).nodes[node.id]!;
        expect({ ...node, rival: undefined, faction: plain.faction, threat: plain.threat }).toEqual({ ...plain, rival: undefined });

        const there = runStep(atStep(seed, rival.round, { past: PAST, node: node.id }), { type: 'travel', nodeId: node.id });
        expect(there.battle).toMatchObject({ faction: RIVAL_FACTION, enemy: rival.warband, mode: node.mode, threat: node.threat });
      }
    }
    expect(met).toBeGreaterThan(5);
  });

  it('still waits at its node after a retreat from another node of the step', () => {
    const seed = 3;
    const rival = newRun(seed, PAST).rivals![0]!;
    const node = generateRoute(seed, actOf(rival.round), [rival]).nodes.find((n) => n.rival)!;
    const fledElsewhere = { ...atStep(seed, rival.round, { past: PAST, node: node.id }), retreats: 1 };
    expect(runStep(fledElsewhere, { type: 'travel', nodeId: node.id }).battle).toMatchObject({ faction: RIVAL_FACTION, enemy: rival.warband });
  });

  it('is the same run as one without rivals up to then', () => {
    expect(newRun(9, PAST).offer).toEqual(newRun(9).offer);
  });
});
