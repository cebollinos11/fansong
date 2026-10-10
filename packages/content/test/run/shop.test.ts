import { describe, expect, it } from 'vitest';
import {
  EAGER_CADET,
  advanceCost,
  applyAdvance,
  applyWound,
  legalRunActions,
  makeRunRandom,
  recruitPrice,
  rerollPrice,
  RUN_TUNING,
  runStep,
  sellPrice,
  shopStock,
  unitCost,
  upgradePrice,
  type RunOffer,
  type RunState,
} from '../../src/index.js';
import { inBattle } from './helpers.js';

type Shop = Extract<RunOffer, { kind: 'shop' }>;

/** A run standing in the shop with `gold` to spend. */
function inShop(seed: number, gold: number): RunState {
  const s = inBattle(seed);
  delete s.battle;
  s.phase = 'shop';
  s.gold = gold;
  s.offer = shopStock(s, makeRunRandom(seed, 1, 50), true);
  return s;
}
const shop = (s: RunState) => s.offer as Shop;

describe('the shop', () => {
  it('stocks recruits and upgrades someone can take', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = inShop(seed, 1000);
      expect(shop(s).recruits).toHaveLength(RUN_TUNING.shop.recruits);
      expect(shop(s).upgrades).toHaveLength(RUN_TUNING.shop.upgrades);
      expect(new Set(shop(s).recruits.map((u) => u!.name)).size).toBe(RUN_TUNING.shop.recruits);
      shop(s).upgrades.forEach((_, index) =>
        expect(legalRunActions(s).some((a) => a.type === 'buyUpgrade' && a.index === index)).toBe(true),
      );
      // With no gold, nothing can be bought.
      expect(legalRunActions({ ...s, gold: 0 }).map((a) => a.type).filter((t) => t !== 'sell')).toEqual(['leaveShop']);
    }
  });

  it('offers a free Eager Cadet when the gold buys none of the recruits', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = inShop(seed, 0);
      const { recruits } = shop(s);
      expect(recruits).toHaveLength(RUN_TUNING.shop.recruits + 1);
      expect(recruits.at(-1)).toEqual(EAGER_CADET);
      expect(recruitPrice(recruits.at(-1)!)).toBe(0);
      const next = runStep(s, { type: 'buyRecruit', index: recruits.length - 1 });
      expect(next.gold).toBe(0);
      expect(next.roster.at(-1)!.unit).toMatchObject({ name: 'Eager Cadet', quality: 4, combat: 2 });

      const cheapest = Math.min(...recruits.slice(0, -1).map((u) => recruitPrice(u!)));
      expect(shop(inShop(seed, cheapest)).recruits).toHaveLength(RUN_TUNING.shop.recruits);
    }
  });

  it('sells a recruit for its points, once', () => {
    const s = inShop(1, 1000);
    const unit = shop(s).recruits[1]!;
    const next = runStep(s, { type: 'buyRecruit', index: 1 });
    expect(next.gold).toBe(1000 - unitCost(unit));
    expect(recruitPrice(unit)).toBe(unitCost(unit));
    expect(next.roster.at(-1)!.unit).toMatchObject({ quality: unit.quality, combat: unit.combat });
    expect(next.roster.at(-1)).toMatchObject({ xp: 0, level: 0, kills: 0 });
    expect(shop(next).recruits[1]).toBeNull();
    expect(() => runStep(next, { type: 'buyRecruit', index: 1 })).toThrow();
    // The state handed in is left as it was.
    expect(s.gold).toBe(1000);
    expect(shop(s).recruits[1]).toEqual(unit);
  });

  it('never goes into debt, and never over the roster cap', () => {
    const poor = inShop(1, recruitPrice(shop(inShop(1, 0)).recruits[0]!) - 1);
    expect(() => runStep(poor, { type: 'buyRecruit', index: 0 })).toThrow(/gold/);
    const full = inShop(1, 1000);
    while (full.roster.length < RUN_TUNING.rosterCap) full.roster.push({ ...full.roster[0]!, id: `x${full.roster.length}` });
    expect(() => runStep(full, { type: 'buyRecruit', index: 0 })).toThrow(/full/);
  });

  it('prices an upgrade off the points it adds to that unit', () => {
    const s = inShop(2, 1000);
    const buy = legalRunActions(s).find((a) => a.type === 'buyUpgrade');
    if (buy?.type !== 'buyUpgrade') throw new Error('no upgrade to buy');
    const unit = s.roster.find((u) => u.id === buy.unitId)!.unit;
    const advance = shop(s).upgrades[buy.index]!;
    const price = upgradePrice(unit, advance);
    expect(price).toBe(Math.max(RUN_TUNING.shop.minUpgrade, Math.ceil(advanceCost(unit, advance) * RUN_TUNING.shop.upgradeMultiplier)));
    const next = runStep(s, buy);
    expect(next.gold).toBe(1000 - price);
    expect(next.roster.find((u) => u.id === buy.unitId)!.unit).toEqual(applyAdvance(unit, advance));
    expect(shop(next).upgrades[buy.index]).toBeNull();
    expect(() => runStep(s, { ...buy, unitId: 'nobody' })).toThrow();
  });

  it('heals the oldest wound for a fee', () => {
    const s = inShop(3, RUN_TUNING.shop.heal);
    const hurt = s.roster[0]!;
    const whole = hurt.unit;
    expect(() => runStep(s, { type: 'heal', unitId: hurt.id })).toThrow();
    hurt.unit = applyWound(applyWound(whole, { kind: 'combat' }), { kind: 'trait', trait: 'slow' });
    hurt.wounds = [{ kind: 'combat' }, { kind: 'trait', trait: 'slow' }];
    const next = runStep(s, { type: 'heal', unitId: hurt.id });
    expect(next.gold).toBe(0);
    expect(next.roster[0]!.wounds).toEqual([{ kind: 'trait', trait: 'slow' }]);
    expect(next.roster[0]!.unit.combat).toBe(whole.combat);
    expect(() => runStep(next, { type: 'heal', unitId: hurt.id })).toThrow(/gold/);
  });

  it('rerolls for a rising price, the same way every time', () => {
    const s = inShop(4, 100);
    const once = runStep(s, { type: 'reroll' });
    expect(once).toEqual(runStep(s, { type: 'reroll' }));
    expect(once.gold).toBe(100 - rerollPrice(0));
    expect(once.rolls).toBe(s.rolls + 1);
    expect(shop(once).rerolls).toBe(1);
    expect(shop(once).recruits).not.toEqual(shop(s).recruits);
    const twice = runStep(once, { type: 'reroll' });
    expect(twice.gold).toBe(once.gold - rerollPrice(1));
    expect(rerollPrice(1)).toBeGreaterThan(rerollPrice(0));
    expect(shop(twice).recruits).not.toEqual(shop(once).recruits);
    expect(() => runStep({ ...s, gold: rerollPrice(0) - 1 }, { type: 'reroll' })).toThrow(/gold/);
  });

  it('buys a unit back for part of its points, but not the last one', () => {
    let s = inShop(5, 0);
    const sold = s.roster[0]!;
    s = runStep(s, { type: 'sell', unitId: sold.id });
    expect(s.gold).toBe(sellPrice(sold.unit));
    expect(sellPrice(sold.unit)).toBe(Math.floor(unitCost(sold.unit) * RUN_TUNING.shop.sellShare));
    expect(s.roster.map((u) => u.id)).not.toContain(sold.id);
    while (s.roster.length > 1) s = runStep(s, { type: 'sell', unitId: s.roster[0]!.id });
    expect(() => runStep(s, { type: 'sell', unitId: s.roster[0]!.id })).toThrow(/last/);
  });
});
