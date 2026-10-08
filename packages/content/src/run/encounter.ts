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
 * few rounds, a boss.
 *
 * A round's encounter comes from the run's seed and the round alone, whatever
 * the player did before it: the same seed always meets the same enemies on the
 * same ground. (Only the board's size follows the number of units on it.)
 */

export function isBossRound(round: number): boolean {
  return round % RUN_TUNING.enemy.bossEvery === 0;
}

/** The enemy's point budget in `round`. */
export function enemyPoints(round: number): number {
  const { startShare, perRound, bossBonus } = RUN_TUNING.enemy;
  const points = RUN_TUNING.draft.budget * startShare * (1 + perRound) ** (round - 1);
  return Math.round(points * (isBossRound(round) ? 1 + bossBonus : 1));
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
 * if it has none; nobody, before `leaderFromRound`), then units bought from that faction's roster in its own
 * proportions until the budget or the unit cap stops it. From
 * `veteranFromRound` on, a growing share of the budget is kept back, and it
 * and whatever else is left over buy advances for random units. On a
 * boss round the leader is a {@link champion} and the rest is its escort. The
 * warband never costs more than {@link enemyPoints}.
 */
export function generateEnemy(round: number, rnd: RunRandom): Enemy {
  const { maxUnits, leaderFromRound, veteranFromRound, veteranShare } = RUN_TUNING.enemy;
  const budget = enemyPoints(round);
  const faction = rnd.pick(Object.keys(PRESET_ROSTERS));
  const roster = PRESET_ROSTERS[faction]!;
  const slots = roster.units.map((slot) => ({ unit: presetUnit(slot.unit)!, count: slot.count ?? 1 }));
  const lead = slots.find((s) => s.unit.leader) ?? slots[defaultKing(slots.map((s) => s.unit))]!;
  const boss = isBossRound(round);

  // The first rounds meet a patrol out without its leader.
  const led = boss || round >= leaderFromRound || !lead.unit.leader;
  const units: WarbandUnit[] = led ? [boss ? champion(lead.unit, round, budget, rnd) : { ...lead.unit }] : [];
  let left = budget - units.reduce((sum, u) => sum + unitCost(u), 0);

  // Later rounds keep some of the budget back, so it buys better units rather than only more of them.
  const kept = round < veteranFromRound ? 0 : Math.min(veteranShare.max, veteranShare.perRound * (round - veteranFromRound + 1));
  const reserve = Math.floor(budget * kept);
  const troops = slots.filter((s) => s !== lead);
  if (units.length === 0 && !troops.some((s) => unitCost(s.unit) <= left - reserve)) units.push({ ...lead.unit });
  while (units.length < maxUnits) {
    const affordable = troops.filter((s) => unitCost(s.unit) <= left - reserve);
    if (affordable.length === 0) break;
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

  const enemy: Enemy = { faction, warband: { name: roster.name, units } };
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

/** Everything about `round`'s battle but the player's side of it, for a roster of `playerUnits`. */
export function generateEncounter(seed: number, round: number, playerUnits: number): RunBattle {
  const rnd = makeRunRandom(seed, round, 0, RUN_STREAM.encounter);
  const mode = rollMode(round, rnd);
  const enemy = generateEnemy(round, rnd);
  const mapSeed = rnd.int(0, 2 ** 31 - 1);
  const battle: RunBattle = {
    mode,
    faction: enemy.faction,
    enemy: enemy.warband,
    map: generateRunMap(round, playerUnits + enemy.warband.units.length, mapSeed),
    seed: rnd.int(0, 2 ** 31 - 1),
  };
  if (enemy.king !== undefined) battle.enemyKing = enemy.king;
  return battle;
}

/** Point cost of a battle's enemy warband. */
export function enemyCost(battle: RunBattle): number {
  return warbandCost(battle.enemy);
}
