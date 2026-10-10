import { createGame, gameMode } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import {
  availableAdvances,
  buildMatch,
  enemyPoints,
  generateBattle,
  isBossRound,
  missionSkulls,
  scoutEnemy,
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
const { min: MIN, max: MAX } = RUN_TUNING.mission.threat;

/** A battle node as a route might hold it: its id and budget follow from the seed, its faction and mode are left to the roll. */
const nodeOf = (seed: number) => ({ id: seed % 7, budget: MIN + ((seed % 11) / 10) * (MAX - MIN) });

describe('enemyPoints', () => {
  it('starts below the draft budget and climbs, with a bump on boss rounds', () => {
    expect(enemyPoints(1)).toBe(RUN_TUNING.enemy.start);
    const regular = ROUNDS.filter((r) => !isBossRound(r));
    regular.slice(1).forEach((r, i) => expect(enemyPoints(r)).toBeGreaterThan(enemyPoints(regular[i]!)));
    // A boss round is worth more than its place on the curve between its neighbours.
    for (const r of ROUNDS.filter(isBossRound))
      expect(enemyPoints(r) ** 2).toBeGreaterThan(enemyPoints(r - 1) * enemyPoints(r + 1) * (1 + RUN_TUNING.enemy.bossBonus));
  });

  it("scales with a battle's threat, which its skulls count", () => {
    // (Rounded once, from the unrounded curve.)
    expect(Math.abs(enemyPoints(4, 1.25) - enemyPoints(4) * 1.25)).toBeLessThanOrEqual(1);
    expect(enemyPoints(4, 2)).toBeGreaterThan(enemyPoints(4, 1.25));
    expect(missionSkulls(MIN)).toBe(1);
    expect(missionSkulls(MIN - 1)).toBe(1);
    expect(missionSkulls(MAX)).toBe(RUN_TUNING.mission.skulls);
    expect(missionSkulls(MAX + 1)).toBe(RUN_TUNING.mission.skulls);
    expect(missionSkulls((MIN + MAX) / 2)).toBe((RUN_TUNING.mission.skulls + 1) / 2);
  });
});

describe('generateBattle', () => {
  it('is the same for the same seed, round and node, whatever the roster size does to the board', () => {
    const node = { id: 3, budget: 1.1 };
    const a = generateBattle(42, 3, node, 4);
    expect(generateBattle(42, 3, node, 4)).toEqual(a);
    const b = generateBattle(42, 3, node, 11);
    expect(b.enemy).toEqual(a.enemy);
    expect(b.mode).toBe(a.mode);
    expect(b.seed).toBe(a.seed);
    expect(generateBattle(43, 3, node, 4)).not.toEqual(a);
    expect(generateBattle(42, 4, node, 4)).not.toEqual(a);
    // Another node of the same step is another battle, and so is the same node after a retreat.
    expect(generateBattle(42, 3, { ...node, id: 4 }, 4).seed).not.toBe(a.seed);
    expect(generateBattle(42, 3, node, 4, undefined, 1).seed).not.toBe(a.seed);
  });

  it('fights the faction, budget and mode its node rolled, and is what a scout of the node reports', () => {
    for (const faction of Object.keys(PRESET_ROSTERS)) {
      const battle = generateBattle(7, 9, { id: 2, budget: 1.2, faction, mode: 'conquest' }, 5);
      expect(scoutEnemy(7, 9, { id: 2, budget: 1.2, faction, mode: 'conquest' })).toEqual(battle.enemy);
      expect(battle.enemy.faction).toBe(faction);
      expect(battle.mode).toBe('conquest');
      expect(battle.enemy.threat).toBeGreaterThan(1.05);
      expect(battle.enemy.threat).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(validateMap(battle.map, 'conquest').errors).toEqual([]);
    }
    // A faction no roster answers to (a rival's place, after a retreat) is rolled anew.
    expect(Object.keys(PRESET_ROSTERS)).toContain(generateBattle(7, 9, { id: 2, faction: 'rival' }, 5).enemy.faction);
  });

  it('fields a past warband in the place of the rolled enemy', () => {
    const rival = generateBattle(1, 6, { id: 0 }, 5).enemy.warband;
    const plain = generateBattle(7, 9, { id: 2, budget: 1.2 }, 5);
    const battle = generateBattle(7, 9, { id: 2, budget: 1.2 }, 5, rival);
    expect(battle.enemy).toEqual({ faction: 'rival', warband: rival, threat: warbandCost(rival) / enemyPoints(9) });
    expect(battle.mode).toBe(plain.mode);
  });

  it('fields legal enemy warbands of at least three units, within their budgets where they can, on a valid map', () => {
    const factions = new Set<string>();
    const modes = new Set<string>();
    const threats: number[] = [];
    for (const seed of SEEDS)
      for (const round of ROUNDS) {
        const at = `seed ${seed} round ${round}`;
        const node = nodeOf(seed);
        const battle = generateBattle(seed, round, node, 3 + (seed % 10));
        modes.add(battle.mode);
        const { enemy } = battle;
        const asked = isBossRound(round) ? 1 : node.budget;
        expect(enemy.threat).toBeCloseTo(warbandCost(enemy.warband) / enemyPoints(round), 10);
        if (round === 12) threats.push(enemy.threat);

        factions.add(enemy.faction);
        expect(validateArmy(enemy.warband).errors, at).toEqual([]);
        expect(enemy.warband.name).toBe(PRESET_ROSTERS[enemy.faction]!.name);
        const cost = warbandCost(enemy.warband);
        const units = enemy.warband.units;
        // Only a warband made up to its fewest units may cost more than its budget.
        expect(units.length, at).toBeGreaterThanOrEqual(RUN_TUNING.enemy.minUnits);
        if (units.length > RUN_TUNING.enemy.minUnits) expect(cost, at).toBeLessThanOrEqual(enemyPoints(round, asked));
        // It spends most of its budget, unless it is a full warband with nothing left to learn.
        const maxed = units.length === RUN_TUNING.enemy.maxUnits && units.every((u) => availableAdvances(u).length === 0);
        // (On a small budget, what is left is less than the faction's cheapest unit.)
        const least = enemyPoints(round, asked);
        if (!maxed) expect(cost, at).toBeGreaterThanOrEqual(Math.min(least * 0.7, least - 40));
        expect(units.length, at).toBeLessThanOrEqual(RUN_TUNING.enemy.maxUnits);
        expect(new Set(units.map((u) => u.name)).size, at).toBe(units.length);

        if (isBossRound(round)) {
          const king = units[enemy.king!]!;
          expect(king.quality, at).toBe(RUN_TUNING.champion.quality);
          expect(king.combat, at).toBeGreaterThanOrEqual(RUN_TUNING.champion.minCombat);
          expect(battle.mode).toBe('kill-the-king');
        } else {
          expect(enemy.king).toBeUndefined();
          expect(RUN_TUNING.modes.regular).toContain(battle.mode);
          if (round <= RUN_TUNING.modes.annihilationThrough) expect(battle.mode).toBe('annihilation');
        }

        expect(validateMap(battle.map, battle.mode).errors, at).toEqual([]);
        expect(battle.map.width).toBeLessThanOrEqual(RUN_TUNING.map.width.max);
        expect(battle.map.height).toBeLessThanOrEqual(RUN_TUNING.map.height.max);
      }
    // Where a budget buys what it is given, the battles run from easy to hard.
    expect(Math.min(...threats)).toBeLessThan(0.85);
    expect(Math.max(...threats)).toBeGreaterThan(1.2);
    // Over this many rolls, every faction and every mode turns up.
    expect([...factions].sort()).toEqual(Object.keys(PRESET_ROSTERS).sort());
    expect([...modes].sort()).toEqual([...RUN_TUNING.modes.regular, RUN_TUNING.modes.boss].sort());
  });

  it('sends a patrol without its leader, or its costliest unit, before the leader round', () => {
    const heads = (round: number) =>
      SEEDS.map((seed) => generateBattle(seed, round, nodeOf(seed), 4).enemy).filter((enemy) => {
        const pool = PRESET_ROSTERS[enemy.faction]!.units.map((slot) => ({ name: slot.unit, ...PRESET_UNITS[slot.unit]! }));
        const dearest = Math.max(...pool.map((u) => unitCost(u)));
        const head = pool.find((u) => u.leader) ?? pool.find((u) => unitCost(u) === dearest)!;
        // The fallback for a budget that buys nobody else aside, the head stays home.
        return enemy.warband.units.length > 1 && enemy.warband.units.some((u) => u.name === head.name);
      }).length;
    for (let round = 1; round < RUN_TUNING.enemy.leaderFromRound; round++) expect(heads(round), `round ${round}`).toBe(0);
    expect(heads(RUN_TUNING.enemy.leaderFromRound)).toBe(SEEDS.length);
  });

  it('deploys into a playable game', () => {
    for (const round of [1, 3, 5, 7, 9, 14, 16]) {
      const { enemy, seed, map, mode } = generateBattle(99, round, { id: 1 }, 6);
      const kings: [number, number] | undefined = enemy.king === undefined ? undefined : [0, enemy.king];
      const state = createGame(buildMatch(enemy.warband, enemy.warband, { seed, map, mode, kings }));
      expect(gameMode(state)).toBe(mode);
      if (kings) expect(state.mode!.kings![1]).toBe(`p1u${enemy.king}`);
    }
  });

  it('gives later rounds veterans and rougher, unmirrored ground', () => {
    // A unit is a veteran when it costs more than the preset unit it is a copy of.
    const veterans = (round: number) =>
      SEEDS.flatMap((seed) => generateBattle(seed, round, nodeOf(seed), 4).enemy.warband.units).filter(
        (u) => unitCost(u) !== unitCost(PRESET_UNITS[u.name.replace(/ \d+$/, '')]!),
      ).length;
    for (let round = 1; round < RUN_TUNING.enemy.veteranFromRound; round++) expect(veterans(round)).toBe(0);
    expect(veterans(RUN_TUNING.enemy.veteranFromRound)).toBeGreaterThan(0);
    expect(veterans(15)).toBeGreaterThan(veterans(RUN_TUNING.enemy.veteranFromRound));

    const ground = (round: number) => generateBattle(5, round, { id: 0 }, 8).map;
    const features = (round: number) => ground(round).hexes.filter((h) => h.feature).length / ground(round).hexes.length;
    expect(features(16)).toBeGreaterThan(features(1));
    expect(ground(1).hexes.some((h) => h.feature === 'lava')).toBe(false);
  });
});
