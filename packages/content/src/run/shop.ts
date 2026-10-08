import { unitCost } from '../cost.js';
import type { WarbandUnit } from '../warband.js';
import { advanceCost, applyAdvance, canAdvance } from './advance.js';
import { recruitOffer } from './draft.js';
import { rosterAdvances } from './progress.js';
import type { RunRandom } from './rng.js';
import { enlist, mendOldest, rosterUnit } from './roster.js';
import { RUN_TUNING } from './tuning.js';
import type { Advance, RunOffer, RunState } from './types.js';

/** The gold shop between battles: recruits, upgrades, mending, a paid reroll, and selling units. */

type Shop = Extract<RunOffer, { kind: 'shop' }>;

/** Fresh stock: recruits, and upgrades at least one roster unit could take. */
export function shopStock(s: RunState, rnd: RunRandom, rerolls = 0): Shop {
  const { recruits, upgrades } = RUN_TUNING.shop;
  return {
    kind: 'shop',
    recruits: recruitOffer(recruits, rnd),
    upgrades: rnd.sample(rosterAdvances(s), upgrades),
    rerolls,
  };
}

/** A recruit costs its points in gold. */
export function recruitPrice(unit: WarbandUnit): number {
  return unitCost(unit);
}

/** An upgrade costs the points it adds to that unit, marked up. */
export function upgradePrice(unit: WarbandUnit, advance: Advance): number {
  const { upgradeMultiplier, minUpgrade } = RUN_TUNING.shop;
  return Math.max(minUpgrade, Math.ceil(advanceCost(unit, advance) * upgradeMultiplier));
}

/** What the next reroll costs after `rerolls` already bought this visit. */
export function rerollPrice(rerolls: number): number {
  return RUN_TUNING.shop.reroll + RUN_TUNING.shop.rerollStep * rerolls;
}

/** What selling `unit` pays. */
export function sellPrice(unit: WarbandUnit): number {
  return Math.floor(unitCost(unit) * RUN_TUNING.shop.sellShare);
}

function shopOf(s: RunState): Shop {
  if (s.offer?.kind !== 'shop') throw new Error('the shop is not open');
  return s.offer;
}

function pay(s: RunState, price: number): void {
  if (price > s.gold) throw new Error(`that costs ${price} gold, and there is only ${s.gold}`);
  s.gold -= price;
}

/** Buy the recruit in slot `index` (mutates `s`). */
export function buyRecruit(s: RunState, index: number): void {
  const shop = shopOf(s);
  const unit = shop.recruits[index];
  if (!unit) throw new Error(`no recruit in slot ${index}`);
  if (s.roster.length >= RUN_TUNING.rosterCap) throw new Error('the roster is full');
  pay(s, recruitPrice(unit));
  enlist(s, unit);
  shop.recruits[index] = null;
}

/** Buy the upgrade in slot `index` for `unitId` (mutates `s`). */
export function buyUpgrade(s: RunState, index: number, unitId: string): void {
  const shop = shopOf(s);
  const advance = shop.upgrades[index];
  if (!advance) throw new Error(`no upgrade in slot ${index}`);
  const u = rosterUnit(s, unitId);
  if (!canAdvance(u.unit, advance)) throw new Error(`${u.unit.name} cannot take that upgrade`);
  pay(s, upgradePrice(u.unit, advance));
  u.unit = applyAdvance(u.unit, advance);
  shop.upgrades[index] = null;
}

/** Pay to mend `unitId`'s oldest lasting wound (mutates `s`). */
export function healUnit(s: RunState, unitId: string): void {
  shopOf(s);
  const u = rosterUnit(s, unitId);
  if (!u.wounds?.length) throw new Error(`${u.unit.name} has no lasting wound`);
  pay(s, RUN_TUNING.shop.heal);
  mendOldest(u);
}

/** Pay for fresh stock (mutates `s`). */
export function rerollShop(s: RunState, rnd: RunRandom): void {
  const shop = shopOf(s);
  pay(s, rerollPrice(shop.rerolls));
  s.offer = shopStock(s, rnd, shop.rerolls + 1);
}

/** Sell `unitId` (mutates `s`). The last unit can't be sold. */
export function sellUnit(s: RunState, unitId: string): void {
  shopOf(s);
  const u = rosterUnit(s, unitId);
  if (s.roster.length <= 1) throw new Error('the last unit cannot be sold');
  s.gold += sellPrice(u.unit);
  s.roster = s.roster.filter((x) => x !== u);
}
