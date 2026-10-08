import { createGame, gameMode } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import {
  availableAdvances,
  buildMatch,
  enemyPoints,
  generateEncounter,
  isBossRound,
  PRESET_ROSTERS,
  PRESET_UNITS,
  RUN_TUNING,
  unitCost,
  validateArmy,
  validateMap,
  warbandCost,
} from '../../src/index.js';

const ROUNDS = Array.from({ length: 16 }, (_, i) => i + 1);
const SEEDS = Array.from({ length: 25 }, (_, i) => i * 7919 + 1);

describe('enemyPoints', () => {
  it('starts below the draft budget and climbs, with a bump on boss rounds', () => {
    expect(enemyPoints(1)).toBe(RUN_TUNING.enemy.start);
    const regular = ROUNDS.filter((r) => !isBossRound(r));
    regular.slice(1).forEach((r, i) => expect(enemyPoints(r)).toBeGreaterThan(enemyPoints(regular[i]!)));
    // A boss round is worth more than its place on the curve between its neighbours.
    for (const r of ROUNDS.filter(isBossRound))
      expect(enemyPoints(r) ** 2).toBeGreaterThan(enemyPoints(r - 1) * enemyPoints(r + 1) * (1 + RUN_TUNING.enemy.bossBonus));
  });
});

describe('generateEncounter', () => {
  it('is the same for the same seed and round, whatever the roster size does to the board', () => {
    const a = generateEncounter(42, 3, 4);
    expect(generateEncounter(42, 3, 4)).toEqual(a);
    const b = generateEncounter(42, 3, 11);
    expect(b.enemy).toEqual(a.enemy);
    expect(b.mode).toBe(a.mode);
    expect(b.seed).toBe(a.seed);
    expect(generateEncounter(43, 3, 4)).not.toEqual(a);
    expect(generateEncounter(42, 4, 4)).not.toEqual(a);
  });

  it('fields a legal enemy warband of at least three units, within the round budget where it can, on a valid map', () => {
    const factions = new Set<string>();
    const modes = new Set<string>();
    for (const seed of SEEDS)
      for (const round of ROUNDS) {
        const at = `seed ${seed} round ${round}`;
        const battle = generateEncounter(seed, round, 3 + (seed % 10));
        factions.add(battle.faction);
        modes.add(battle.mode);

        expect(validateArmy(battle.enemy).errors, at).toEqual([]);
        expect(battle.enemy.name).toBe(PRESET_ROSTERS[battle.faction]!.name);
        const cost = warbandCost(battle.enemy);
        // Only a warband made up to its fewest units may cost more than the budget.
        expect(battle.enemy.units.length, at).toBeGreaterThanOrEqual(RUN_TUNING.enemy.minUnits);
        if (battle.enemy.units.length > RUN_TUNING.enemy.minUnits) expect(cost, at).toBeLessThanOrEqual(enemyPoints(round));
        // It spends most of its budget, unless it is a full warband with nothing left to learn.
        const maxed = battle.enemy.units.length === RUN_TUNING.enemy.maxUnits && battle.enemy.units.every((u) => availableAdvances(u).length === 0);
        // (On a small budget, what is left is less than the faction's cheapest unit.)
        if (!maxed) expect(cost, at).toBeGreaterThanOrEqual(Math.min(enemyPoints(round) * 0.7, enemyPoints(round) - 40));
        expect(battle.enemy.units.length, at).toBeLessThanOrEqual(RUN_TUNING.enemy.maxUnits);
        expect(new Set(battle.enemy.units.map((u) => u.name)).size, at).toBe(battle.enemy.units.length);

        if (isBossRound(round)) {
          expect(battle.mode).toBe('kill-the-king');
          const king = battle.enemy.units[battle.enemyKing!]!;
          expect(king.quality, at).toBe(RUN_TUNING.champion.quality);
          expect(king.combat, at).toBeGreaterThanOrEqual(RUN_TUNING.champion.minCombat);
        } else {
          expect(battle.enemyKing).toBeUndefined();
          expect(RUN_TUNING.modes.regular).toContain(battle.mode);
          if (round <= RUN_TUNING.modes.annihilationThrough) expect(battle.mode).toBe('annihilation');
        }

        expect(validateMap(battle.map, battle.mode).errors, at).toEqual([]);
        expect(battle.map.width).toBeLessThanOrEqual(RUN_TUNING.map.width.max);
        expect(battle.map.height).toBeLessThanOrEqual(RUN_TUNING.map.height.max);
      }
    // Over this many rolls, every faction and every mode turns up.
    expect([...factions].sort()).toEqual(Object.keys(PRESET_ROSTERS).sort());
    expect([...modes].sort()).toEqual([...RUN_TUNING.modes.regular, RUN_TUNING.modes.boss].sort());
  });

  it('sends a patrol without its leader, or its costliest unit, before the leader round', () => {
    const heads = (round: number) =>
      SEEDS.map((seed) => generateEncounter(seed, round, 4)).filter((battle) => {
        const pool = PRESET_ROSTERS[battle.faction]!.units.map((slot) => ({ name: slot.unit, ...PRESET_UNITS[slot.unit]! }));
        const dearest = Math.max(...pool.map((u) => unitCost(u)));
        const head = pool.find((u) => u.leader) ?? pool.find((u) => unitCost(u) === dearest)!;
        // The fallback for a budget that buys nobody else aside, the head stays home.
        return battle.enemy.units.length > 1 && battle.enemy.units.some((u) => u.name === head.name);
      }).length;
    for (let round = 1; round < RUN_TUNING.enemy.leaderFromRound; round++) expect(heads(round), `round ${round}`).toBe(0);
    expect(heads(RUN_TUNING.enemy.leaderFromRound)).toBe(SEEDS.length);
  });

  it('deploys into a playable game', () => {
    for (const round of [1, 3, 5, 9, 10, 16]) {
      const battle = generateEncounter(99, round, 6);
      const kings: [number, number] | undefined = battle.enemyKing === undefined ? undefined : [0, battle.enemyKing];
      const state = createGame(buildMatch(battle.enemy, battle.enemy, { seed: battle.seed, map: battle.map, mode: battle.mode, kings }));
      expect(gameMode(state)).toBe(battle.mode);
      if (kings) expect(state.mode!.kings![1]).toBe(`p1u${battle.enemyKing}`);
    }
  });

  it('gives later rounds veterans and rougher, unmirrored ground', () => {
    // A unit is a veteran when it costs more than the preset unit it is a copy of.
    const veterans = (round: number) =>
      SEEDS.flatMap((seed) => generateEncounter(seed, round, 4).enemy.units).filter(
        (u) => unitCost(u) !== unitCost(PRESET_UNITS[u.name.replace(/ \d+$/, '')]!),
      ).length;
    for (let round = 1; round < RUN_TUNING.enemy.veteranFromRound; round++) expect(veterans(round)).toBe(0);
    expect(veterans(RUN_TUNING.enemy.veteranFromRound)).toBeGreaterThan(0);
    expect(veterans(12)).toBeGreaterThan(veterans(RUN_TUNING.enemy.veteranFromRound));

    const features = (round: number) => generateEncounter(5, round, 8).map.hexes.filter((h) => h.feature).length / generateEncounter(5, round, 8).map.hexes.length;
    expect(features(14)).toBeGreaterThan(features(1));
    expect(generateEncounter(5, 1, 8).map.hexes.some((h) => h.feature === 'lava')).toBe(false);
  });
});
