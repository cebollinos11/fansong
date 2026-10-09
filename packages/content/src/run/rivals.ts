import { warbandCost, type Warband } from '../warband.js';
import { enemyPoints, isBossRound } from './encounter.js';
import { makeRunRandom, RUN_STREAM } from './rng.js';
import { RUN_TUNING } from './tuning.js';
import type { RunRival } from './types.js';

/**
 * Which of `past` (warbands earlier runs ended with) this run meets again, and
 * when: up to `rivals.max` of them, each in the regular round whose enemy budget
 * is nearest its cost, one to a round, within `rivals.band`. Too few units or a
 * cost no round fits leaves one out. Seeded by the run's seed alone.
 */
export function scheduleRivals(seed: number, past: readonly Warband[]): RunRival[] {
  const { max, fromRound, band } = RUN_TUNING.rivals;
  const rnd = makeRunRandom(seed, 0, 0, RUN_STREAM.rivals);
  const fit = past.filter((w) => w.units.length >= RUN_TUNING.enemy.minUnits);
  const rivals: RunRival[] = [];
  for (const warband of rnd.sample(fit, fit.length)) {
    if (rivals.length >= max) break;
    const cost = warbandCost(warband);
    let best: { round: number; off: number } | null = null;
    for (let round = fromRound; enemyPoints(round) * band.min <= cost; round++) {
      const ratio = cost / enemyPoints(round);
      if (isBossRound(round) || ratio > band.max || rivals.some((r) => r.round === round)) continue;
      const off = Math.abs(Math.log(ratio));
      if (!best || off < best.off) best = { round, off };
    }
    if (best) rivals.push({ round: best.round, warband: { name: warband.name, units: warband.units.map((u) => ({ ...u })) } });
  }
  return rivals.sort((a, b) => a.round - b.round);
}
