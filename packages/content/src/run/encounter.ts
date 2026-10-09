import type { GameMode } from '@fansong/engine';
import { unitCost } from '../cost.js';
import { defaultKing } from '../deploy.js';
import type { MapDef } from '../map.js';
import { generateRandomMap, type TerrainSettings } from '../mapGen.js';
import { PRESET_ROSTERS, presetUnit } from '../presets.js';
import { warbandCost, type Warband, type WarbandUnit } from '../warband.js';
import { advanceCost, applyAdvance, availableAdvances } from './advance.js';
import { makeRunRandom, RUN_STREAM, type RunRandom } from './rng.js';
import { uniquelyNamed } from './roster.js';
import { RUN_TUNING } from './tuning.js';
import type { Advance, RunBattle } from './types.js';

/**
 * What a round throws at the player. Difficulty is the enemy's point budget, a
 * fixed curve of the round that ignores how strong the player has grown, so
 * every upgrade counts; later rounds also get veterans, rougher maps and, every
 * few rounds, a boss. A regular round offers several enemies to choose between,
 * each bought with its own share of that budget.
 *
 * A round's encounter comes from the run's seed and the round alone, whatever
 * the player did before it: the same seed always meets the same enemies on the
 * same ground. (Only the board's size follows the number of units on it.) A
 * round fought again after a retreat is rolled anew, by how many retreats it has seen.
 */

/** The `faction` of a battle against a past run's warband. */
export const RIVAL_FACTION = 'rival';

export function isBossRound(round: number): boolean {
  return round % RUN_TUNING.enemy.bossEvery === 0;
}

/** The enemy's point budget in `round`, for a mission `threat` times as hard as the round's usual. */
export function enemyPoints(round: number, threat = 1): number {
  const { start, perRound, bossBonus } = RUN_TUNING.enemy;
  const points = start * (1 + perRound) ** (round - 1);
  return Math.round(points * (isBossRound(round) ? 1 + bossBonus : 1) * threat);
}

/** How many skulls a mission of `threat` shows, from 1 to `mission.skulls`. */
export function missionSkulls(threat: number): number {
  const { threat: band, skulls } = RUN_TUNING.mission;
  const t = (threat - band.min) / (band.max - band.min);
  return Math.max(1, Math.min(skulls, 1 + Math.round(t * (skulls - 1))));
}

/** The mode `round` is played in. */
export function rollMode(round: number, rnd: RunRandom): GameMode {
  const { annihilationThrough, regular, boss } = RUN_TUNING.modes;
  if (isBossRound(round)) return boss;
  if (round <= annihilationThrough) return 'annihilation';
  return rnd.pick(regular);
}

export interface Enemy {
  /** Key of the {@link PRESET_ROSTERS} entry it was built from. */
  faction: string;
  warband: Warband;
  /** Boss rounds: index into the warband of its champion, the enemy King. */
  king?: number;
  /** The warband's cost over the round's budget. */
  threat: number;
}

/** A round's battle but for the player's side of it: one mode and one battlefield, and the enemies to choose between, easiest first. */
export interface Encounter {
  mode: GameMode;
  map: MapDef;
  /** The match's RNG seed. */
  seed: number;
  enemies: Enemy[];
}

/**
 * A boss's champion: `leader` at the champion's Quality and Combat, with extra
 * traits (more on each later boss) as far as `budget` allows.
 */
function champion(leader: WarbandUnit, round: number, budget: number, rnd: RunRandom): WarbandUnit {
  const spec = RUN_TUNING.champion;
  const base: WarbandUnit = { ...leader, quality: spec.quality, combat: Math.max(leader.combat, spec.minCombat) };
  // A leader too dear to promote on this budget fights as it is.
  let unit = unitCost(base) <= budget ? base : leader;
  const bossNumber = Math.floor(round / RUN_TUNING.enemy.bossEvery);
  for (let i = 0; i < spec.traits + spec.traitsPerBoss * (bossNumber - 1); i++) {
    const traits = availableAdvances(unit).filter((a) => a.kind === 'trait' && unitCost(applyAdvance(unit, a)) <= budget);
    if (traits.length === 0) break;
    unit = applyAdvance(unit, rnd.pick(traits));
  }
  return unit;
}

/**
 * The enemy warband of `round`: a preset faction's leader (its costliest unit,
 * if it has none; neither, before `leaderFromRound`), then units bought from that faction's roster in its own
 * proportions until the budget or the unit cap stops it. It always fields
 * `minUnits`: if the budget can't pay for that many, the cheapest troops make
 * up the number, the one way a warband costs more than {@link enemyPoints}. From
 * `veteranFromRound` on, a growing share of the budget is kept back, and it
 * and whatever else is left over buy advances for random units. On a
 * boss round the leader is a {@link champion} and the rest is its escort.
 * `threat` scales the budget; `faction` names the roster instead of rolling it.
 */
export function generateEnemy(round: number, rnd: RunRandom, threat = 1, faction: string = rnd.pick(Object.keys(PRESET_ROSTERS))): Enemy {
  const { minUnits, maxUnits, leaderFromRound, veteranFromRound, veteranShare } = RUN_TUNING.enemy;
  const budget = enemyPoints(round, threat);
  const roster = PRESET_ROSTERS[faction]!;
  const slots = roster.units.map((slot) => ({ unit: presetUnit(slot.unit)!, count: slot.count ?? 1 }));
  const lead = slots.find((s) => s.unit.leader) ?? slots[defaultKing(slots.map((s) => s.unit))]!;
  const boss = isBossRound(round);

  // The first rounds meet a patrol out without its leader (or, for a faction that has none, its costliest unit).
  const led = boss || round >= leaderFromRound;
  const units: WarbandUnit[] = led ? [boss ? champion(lead.unit, round, budget, rnd) : { ...lead.unit }] : [];
  let left = budget - units.reduce((sum, u) => sum + unitCost(u), 0);

  // Later rounds keep some of the budget back, so it buys better units rather than only more of them.
  const kept = round < veteranFromRound ? 0 : Math.min(veteranShare.max, veteranShare.perRound * (round - veteranFromRound + 1));
  const reserve = Math.floor(budget * kept);
  const troops = slots.filter((s) => s !== lead);
  const cheapest = Math.min(...troops.map((s) => unitCost(s.unit)));
  while (units.length < maxUnits) {
    // Short of its fewest units, a pick must leave enough for the cheapest troops still owed.
    const short = units.length < minUnits;
    const room = short ? left - (minUnits - units.length - 1) * cheapest : left - reserve;
    let affordable = troops.filter((s) => unitCost(s.unit) <= room);
    if (affordable.length === 0) {
      if (!short) break;
      affordable = troops.filter((s) => unitCost(s.unit) === cheapest);
    }
    const unit = uniquelyNamed(rnd.weighted(affordable, (s) => s.count).unit, units.map((u) => u.name));
    units.push(unit);
    left -= unitCost(unit);
  }

  if (round >= veteranFromRound) {
    for (;;) {
      const steps: { index: number; advance: Advance; cost: number }[] = [];
      units.forEach((unit, index) => {
        for (const advance of availableAdvances(unit)) {
          const cost = advanceCost(unit, advance);
          if (cost > 0 && cost <= left) steps.push({ index, advance, cost });
        }
      });
      if (steps.length === 0) break;
      const step = rnd.pick(steps);
      units[step.index] = applyAdvance(units[step.index]!, step.advance);
      left -= step.cost;
    }
  }

  const warband: Warband = { name: roster.name, units };
  const enemy: Enemy = { faction, warband, threat: warbandCost(warband) / enemyPoints(round) };
  if (boss) enemy.king = 0;
  return enemy;
}

const lerp = ({ from, to }: { from: number; to: number }, t: number) => from + (to - from) * t;

/** How rough `round`'s ground is: denser and hillier as the run goes on. */
export function runTerrain(round: number): TerrainSettings {
  const m = RUN_TUNING.map;
  const t = Math.min(1, (round - 1) / m.rampRounds);
  return {
    hills: lerp(m.hills, t),
    features: {
      forest: lerp(m.forest, t),
      rock: lerp(m.rock, t),
      building: lerp(m.building, t),
      lava: round >= m.lavaFromRound ? lerp(m.lava, t) : 0,
    },
  };
}

/** The battlefield of `round` for `units` models in all: bigger for more of them, mirrored only early on. */
export function generateRunMap(round: number, units: number, seed: number): MapDef {
  const { width, height, asymmetricFromRound } = RUN_TUNING.map;
  const size = (axis: { base: number; unitsPerHex: number; max: number }) =>
    Math.min(axis.max, axis.base + Math.floor(units / axis.unitsPerHex));
  return generateRandomMap(size(width), size(height), seed, {
    symmetric: round < asymmetricFromRound,
    name: `Round ${round}`,
    terrain: runTerrain(round),
  });
}

/**
 * `round`'s battle but for the player's side of it, for a roster of
 * `playerUnits`: on a regular round `mission.count` enemies of different
 * factions and strengths, on a boss round the one boss. A `rival` (a past run's
 * warband) takes the first rolled enemy's place. The ground is sized for the
 * largest of them. `retreats` counts the times the player has already retreated
 * from this round: each meets a fresh encounter.
 */
export function generateEncounter(seed: number, round: number, playerUnits: number, rival?: Warband, retreats = 0): Encounter {
  const { count, threat } = RUN_TUNING.mission;
  const rnd = makeRunRandom(seed, round, retreats, RUN_STREAM.encounter);
  const mode = rollMode(round, rnd);
  const boss = isBossRound(round);
  const enemies = rnd
    .sample(Object.keys(PRESET_ROSTERS), boss ? 1 : count)
    .map((faction) => generateEnemy(round, rnd, boss ? 1 : threat.min + rnd.next() * (threat.max - threat.min), faction));
  if (rival) enemies[0] = { faction: RIVAL_FACTION, warband: rival, threat: warbandCost(rival) / enemyPoints(round) };
  enemies.sort((a, b) => a.threat - b.threat);
  const mapSeed = rnd.int(0, 2 ** 31 - 1);
  const largest = Math.max(...enemies.map((e) => e.warband.units.length));
  return { mode, map: generateRunMap(round, playerUnits + largest, mapSeed), seed: rnd.int(0, 2 ** 31 - 1), enemies };
}

/** Point cost of a battle's enemy warband. */
export function enemyCost(battle: Pick<RunBattle, 'enemy'>): number {
  return warbandCost(battle.enemy);
}
