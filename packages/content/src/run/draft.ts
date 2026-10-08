import { unitCost } from '../cost.js';
import type { WarbandUnit } from '../warband.js';
import type { RunRandom } from './rng.js';
import { LEADER_POOL, RECRUIT_POOL, TROOP_POOL } from './roster.js';
import { RUN_TUNING } from './tuning.js';

/**
 * The draft: a leader, then troops one pick at a time until the budget can buy
 * no more. Every offer is of different preset units the remaining points can pay for.
 */

/** The leaders a new run chooses between. */
export function leaderOffer(rnd: RunRandom): WarbandUnit[] {
  const { budget, offers } = RUN_TUNING.draft;
  return rnd.sample(LEADER_POOL.filter((u) => unitCost(u) <= budget), offers);
}

/** The troops the next pick chooses between with `points` left: empty once nothing is affordable. */
export function troopOffer(points: number, rnd: RunRandom): WarbandUnit[] {
  return rnd.sample(TROOP_POOL.filter((u) => unitCost(u) <= points), RUN_TUNING.draft.offers);
}

/** `count` different recruits for a reward or the shop. */
export function recruitOffer(count: number, rnd: RunRandom): WarbandUnit[] {
  return rnd.sample(RECRUIT_POOL, count);
}
