import { describe, expect, it } from 'vitest';
import {
  legalRunActions,
  newRun,
  playerWarband,
  rosterCost,
  RUN_TUNING,
  runStep,
  TROOP_POOL,
  uniquelyNamed,
  unitCost,
  validateArmy,
  type RunState,
} from '../../src/index.js';

/** Draft by always taking offer `pick(n)` of the `n` shown, checking each offer on the way. */
function draft(seed: number, pick: (offers: number, step: number) => number): RunState {
  let s = newRun(seed);
  for (let step = 0; s.phase === 'draft'; step++) {
    const offer = s.offer!;
    if (offer.kind !== 'draft') throw new Error('not a draft offer');
    expect(offer.stage).toBe(step === 0 ? 'leader' : 'troop');
    expect(offer.units.length).toBeGreaterThan(0);
    expect(offer.units.length).toBeLessThanOrEqual(RUN_TUNING.draft.offers);
    expect(new Set(offer.units.map((u) => u.name)).size).toBe(offer.units.length);
    const left = RUN_TUNING.draft.budget - rosterCost(s);
    for (const u of offer.units) {
      expect(unitCost(u)).toBeLessThanOrEqual(left);
      expect(Boolean(u.leader)).toBe(step === 0);
    }
    expect(legalRunActions(s)).toHaveLength(offer.units.length);
    s = runStep(s, { type: 'draftPick', index: pick(offer.units.length, step) });
  }
  return s;
}

describe('the draft', () => {
  it('builds a legal warband of one leader within the budget, spending it down', () => {
    const cheapest = Math.min(...TROOP_POOL.map(unitCost));
    for (let seed = 0; seed < 60; seed++) {
      for (const pick of [() => 0, (n: number) => n - 1, (n: number, step: number) => (seed + step) % n]) {
        const s = draft(seed, pick);
        expect(s.phase).toBe('map');
        expect(s.offer).toBeUndefined();
        expect(s.route?.act).toBe(1);
        expect(s.roster.filter((u) => u.unit.leader)).toHaveLength(1);
        expect(s.roster.length).toBeLessThanOrEqual(RUN_TUNING.rosterCap);
        expect(rosterCost(s)).toBeLessThanOrEqual(RUN_TUNING.draft.budget);
        if (s.roster.length < RUN_TUNING.rosterCap) expect(RUN_TUNING.draft.budget - rosterCost(s)).toBeLessThan(cheapest);
        expect(validateArmy(playerWarband(s)).errors).toEqual([]);
        expect(new Set(s.roster.map((u) => u.id)).size).toBe(s.roster.length);
        expect(new Set(s.roster.map((u) => u.unit.name)).size).toBe(s.roster.length);
      }
    }
  });

  it('numbers a second copy of a unit and keeps its look', () => {
    const wolf = { name: 'Wolf', quality: 4, combat: 2 };
    expect(uniquelyNamed(wolf, ['Bear'])).toEqual(wolf);
    expect(uniquelyNamed(wolf, ['Wolf'])).toEqual({ ...wolf, name: 'Wolf 2', look: 'Wolf' });
    expect(uniquelyNamed({ ...wolf, look: 'Dog' }, ['Wolf', 'Wolf 2']).name).toBe('Wolf 3');
    expect(uniquelyNamed({ ...wolf, look: 'Dog' }, ['Wolf']).look).toBe('Dog');
  });

  it('rejects a pick that was not offered', () => {
    expect(() => runStep(newRun(1), { type: 'draftPick', index: 3 })).toThrow();
    expect(() => runStep(newRun(1), { type: 'startBattle' })).toThrow();
  });
});
