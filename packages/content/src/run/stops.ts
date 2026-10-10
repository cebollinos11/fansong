import { applyAdvance, availableAdvances } from './advance.js';
import { rollLevelUps } from './progress.js';
import type { RunRandom } from './rng.js';
import { isWounded, mendOldest, rosterUnit } from './roster.js';
import { RUN_TUNING } from './tuning.js';
import type { RunOffer, RunState } from './types.js';

/**
 * The safe places on the route. A camp rests the warband or drills it; a
 * training ground teaches one unit something new for nothing. Neither is a
 * fight, so neither pays XP for kills, gold or a reward: the price of a stop
 * is the battle not fought, while the enemy grows all the same.
 */

type Camp = Extract<RunOffer, { kind: 'camp' }>;
type Training = Extract<RunOffer, { kind: 'training' }>;

function campOf(s: RunState): Camp {
  if (s.offer?.kind !== 'camp') throw new Error('the warband is not in camp');
  return s.offer;
}

function trainingOf(s: RunState): Training {
  if (s.offer?.kind !== 'training') throw new Error('there is no training ground here');
  return s.offer;
}

/** Whether a rest would do the warband any good: someone is wounded, or sitting out. */
export function restHelps(s: RunState): boolean {
  return s.roster.some((u) => isWounded(u) || u.sitsOut);
}

/**
 * Spend the night at camp (mutates `s`), one way or the other. `rest`: every
 * lasting wound is mended and whoever was sitting out is fit again. `drill`:
 * every unit earns `camp.drillXp` XP, and the levels that brings are put up
 * for choosing. One night, one choice.
 */
export function makeCamp(s: RunState, choice: 'rest' | 'drill', rnd: RunRandom): void {
  const camp = campOf(s);
  if (camp.taken) throw new Error('the night is already spent');
  if (choice === 'rest') {
    for (const u of s.roster) {
      while (isWounded(u)) mendOldest(u);
      delete u.sitsOut;
    }
  } else {
    for (const u of s.roster) u.xp += RUN_TUNING.camp.drillXp;
    rollLevelUps(s, rnd);
  }
  camp.taken = choice;
}

/**
 * Send `unitId` to train (mutates `s`): it is offered `training.choices`
 * advances it lacks, and the pick of unit is final. Throws for a unit with
 * nothing left to learn.
 */
export function trainUnit(s: RunState, unitId: string, rnd: RunRandom): void {
  const training = trainingOf(s);
  if (training.unitId !== undefined) throw new Error('a unit is already training');
  const u = rosterUnit(s, unitId);
  const advances = availableAdvances(u.unit);
  if (advances.length === 0) throw new Error(`${u.unit.name} has nothing left to learn`);
  training.unitId = unitId;
  training.choices = rnd.sample(advances, RUN_TUNING.training.choices);
}

/** Take advance `index` of those the training unit was offered (mutates `s`). It costs nothing, and no level. */
export function takeTraining(s: RunState, index: number): void {
  const training = trainingOf(s);
  const advance = training.choices?.[index];
  if (training.unitId === undefined || !advance) throw new Error(`no training ${index} on offer`);
  const u = rosterUnit(s, training.unitId);
  u.unit = applyAdvance(u.unit, advance);
}

/** What a retreat banner costs at a market. */
export function bannerPrice(): number {
  return RUN_TUNING.market.banner;
}

/** Buy a retreat banner at a market (mutates `s`). Throws in the field shop, short of gold, or with every banner the run may hold. */
export function buyBanner(s: RunState): void {
  if (s.offer?.kind !== 'shop' || !s.offer.market) throw new Error('only a market sells banners');
  if (s.banners >= RUN_TUNING.banners.max) throw new Error(`a warband carries at most ${RUN_TUNING.banners.max} banners`);
  const price = bannerPrice();
  if (price > s.gold) throw new Error(`that costs ${price} gold, and there is only ${s.gold}`);
  s.gold -= price;
  s.banners++;
}

