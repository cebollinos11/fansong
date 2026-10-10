import { describe, expect, it } from 'vitest';
import {
  ambushToll,
  availableAdvances,
  enemyPoints,
  eventChoices,
  eventText,
  eventTitle,
  generateRoute,
  legalRunActions,
  makeRunRandom,
  RUN_EVENT_IDS,
  RUN_TUNING,
  runActionError,
  runBattleConfig,
  runStep,
  stageEvent,
  unitCost,
  validateArmy,
  warbandCost,
  type RunEventId,
  type RunState,
} from '../../src/index.js';
import { atStep, autoUntil, checkState, playBattle, retreating } from './helpers.js';
import { recordReplay } from '@fansong/engine';

const { events: TUNING, banners: BANNERS, rosterCap } = RUN_TUNING;

/** A drafted run arrived at a mystery node (whatever it rolled), and that node. */
function atMystery(from = 1): { s: RunState; nodeId: number } {
  for (let seed = from; seed < from + 300; seed++) {
    const node = generateRoute(seed, 1).nodes.find((n) => n.kind === 'mystery');
    if (node) return { s: runStep(atStep(seed, node.step, { node: node.id }), { type: 'travel', nodeId: node.id }), nodeId: node.id };
  }
  throw new Error('no route has a mystery');
}

/** The same run, but the mystery is `event`, as it would have been rolled; with `gold` in hand. */
function staged(event: RunEventId, gold = 100, rolls = 0): RunState {
  const { s } = atMystery();
  const run: RunState = { ...s, gold };
  return { ...run, offer: stageEvent(event, run, makeRunRandom(run.seed, run.round, 40 + rolls)) };
}

const offerOf = (s: RunState) => {
  if (s.offer?.kind !== 'event') throw new Error('no event on offer');
  return s.offer;
};
const choose = (s: RunState, index: number, unitId?: string) => runStep(s, unitId === undefined ? { type: 'eventChoice', index } : { type: 'eventChoice', index, unitId });

/** A settled event leads on up the road, and nowhere else. */
function settled(before: RunState, after: RunState, choice: number): void {
  expect(after.phase).toBe('stop');
  expect(offerOf(after).result).toMatchObject({ choice });
  expect(offerOf(after).result!.text.length).toBeGreaterThan(10);
  expect(legalRunActions(after)).toEqual([{ type: 'leaveStop' }]);
  expect(runActionError(after, { type: 'eventChoice', index: 0 })).toMatch(/already settled/);
  checkState(after);
  const on = runStep(after, { type: 'leaveStop' });
  expect([on.phase, on.round, on.route!.at]).toEqual(['map', before.round + 1, before.route!.going]);
}

describe('a mystery node', () => {
  it('turns out to be one of the events, the same one for the same seed, and must be settled before the road goes on', () => {
    const seen = new Set<string>();
    for (let from = 1; from < 400; from += 13) {
      const { s } = atMystery(from);
      const e = offerOf(s);
      seen.add(e.event);
      expect(s.phase).toBe('stop');
      expect(RUN_EVENT_IDS).toContain(e.event);
      expect(e.result).toBeUndefined();
      expect(atMystery(from).s).toEqual(s);
      checkState(s);
      expect(runActionError(s, { type: 'leaveStop' })).toMatch(/still to be settled/);
      expect(runActionError(s, { type: 'eventChoice', index: 9 })).toMatch(/no choice/);
      // Every event can be taken some way, whatever the purse.
      expect(legalRunActions({ ...s, gold: 0 }).length).toBeGreaterThan(0);
      expect(legalRunActions(s).every((a) => a.type === 'eventChoice')).toBe(true);
    }
    expect([...seen].sort()).toEqual([...RUN_EVENT_IDS].sort());
  });

  it('tells each event in words of its own, with two or three ways to take it', () => {
    const texts = new Set<string>();
    for (const event of RUN_EVENT_IDS) {
      const s = staged(event);
      const e = offerOf(s);
      const choices = eventChoices(e, s);
      expect(choices.length, event).toBeGreaterThanOrEqual(2);
      expect(choices.length, event).toBeLessThanOrEqual(3);
      for (const c of choices) expect(c.label.length > 3 && c.detail.length > 3).toBe(true);
      expect(eventTitle(e)).toMatch(/^The /);
      expect(eventText(e).length).toBeGreaterThan(60);
      expect(eventText(e)).not.toMatch(/undefined|NaN/);
      expect(JSON.stringify(choices)).not.toMatch(/undefined|NaN/);
      texts.add(eventText(e));
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }
    expect(texts.size).toBe(RUN_EVENT_IDS.length);
  });
});

describe('the sellsword', () => {
  it('is a strong recruit at a cut price', () => {
    for (let rolls = 0; rolls < 20; rolls++) {
      const e = offerOf(staged('sellsword', 100, rolls));
      expect(unitCost(e.unit!)).toBeGreaterThanOrEqual(TUNING.sellsword.minCost);
      expect(e.price).toBe(Math.ceil(unitCost(e.unit!) * TUNING.sellsword.priceShare));
    }
  });

  it('hire: pays the price and enlists the unit', () => {
    const s = staged('sellsword');
    const e = offerOf(s);
    const hired = choose(s, 0);
    expect(hired.gold).toBe(s.gold - e.price!);
    expect(hired.roster).toHaveLength(s.roster.length + 1);
    expect(hired.roster.at(-1)).toMatchObject({ unit: { quality: e.unit!.quality, combat: e.unit!.combat }, xp: 0, level: 0 });
    expect(validateArmy({ name: 'x', units: hired.roster.map((u) => u.unit) }).errors).toEqual([]);
    settled(s, hired, 0);
    // Not without the gold, and not into a full roster.
    expect(runActionError({ ...s, gold: e.price! - 1 }, { type: 'eventChoice', index: 0 })).toMatch(/costs/);
    const full: RunState = { ...s, roster: Array.from({ length: rosterCap }, (_, i) => ({ ...s.roster[0]!, id: `f${i}`, unit: { ...s.roster[0]!.unit, name: `F${i}` } })) };
    expect(runActionError(full, { type: 'eventChoice', index: 0 })).toMatch(/roster is full/);
    expect(legalRunActions(full)).toEqual([{ type: 'eventChoice', index: 1 }]);
  });

  it('walk on: nothing changes', () => {
    const s = staged('sellsword');
    const passed = choose(s, 1);
    expect([passed.gold, passed.roster]).toEqual([s.gold, s.roster]);
    settled(s, passed, 1);
  });
});

describe('the old shrine', () => {
  it('kneel: the unit named gains a trait it lacked and takes a lasting wound', () => {
    const s = staged('shrine');
    const outcomes = new Set<string>();
    for (const u of s.roster) {
      // It is done to one unit: the choice has to name it.
      expect(legalRunActions(s)).toContainEqual({ type: 'eventChoice', index: 0, unitId: u.id });
      const knelt = choose(s, 0, u.id);
      const after = knelt.roster.find((x) => x.id === u.id)!;
      const gained = availableAdvances(u.unit).filter((a) => a.kind === 'trait' && after.unit[a.trait] === true);
      expect(gained, u.unit.name).toHaveLength(1);
      expect(after.wounds).toHaveLength(1);
      const wound = after.wounds![0]!;
      if (wound.kind === 'combat') expect(after.unit.combat).toBe(u.unit.combat - 1);
      else if (wound.kind === 'quality') expect(after.unit.quality).toBe(u.unit.quality + 1);
      else expect(after.unit[wound.trait]).toBe(true);
      outcomes.add(wound.kind);
      expect(knelt.roster.filter((x) => x.id !== u.id)).toEqual(s.roster.filter((x) => x.id !== u.id));
      expect(validateArmy({ name: 'x', units: knelt.roster.map((x) => x.unit) }).errors).toEqual([]);
      settled(s, knelt, 0);
      // The same dice for the same choice.
      expect(choose(s, 0, u.id)).toEqual(knelt);
    }
    expect(runActionError(s, { type: 'eventChoice', index: 0 })).toMatch(/someone has to kneel/);
    expect(runActionError(s, { type: 'eventChoice', index: 0, unitId: 'nobody' })).not.toBeNull();
  });

  it('walk on: nothing changes', () => {
    const s = staged('shrine');
    const passed = choose(s, 1);
    expect(passed.roster).toEqual(s.roster);
    settled(s, passed, 1);
  });
});

describe('the ambush', () => {
  it('pay the toll: gold for a quiet road, if the purse can bear it', () => {
    const s = staged('ambush');
    const toll = ambushToll(s.round);
    expect(offerOf(s).price).toBe(toll);
    const paid = choose(s, 1);
    expect([paid.gold, paid.roster, paid.battle]).toEqual([s.gold - toll, s.roster, undefined]);
    settled(s, paid, 1);
    expect(runActionError({ ...s, gold: toll - 1 }, { type: 'eventChoice', index: 1 })).toMatch(/costs/);
    expect(legalRunActions({ ...s, gold: toll - 1 })).toEqual([{ type: 'eventChoice', index: 0 }]);
  });

  it('fight through: a battle against a weak warband, for XP and gold but no reward', () => {
    let won = 0;
    let fled = 0;
    for (let rolls = 0; rolls < 12 && (won === 0 || fled === 0); rolls++) {
      const base = staged('ambush', 100, rolls);
      const s: RunState = { ...base, seed: base.seed + rolls * 1000 };
      const briefing = choose(s, 0);
      expect([briefing.phase, briefing.offer]).toEqual(['briefing', undefined]);
      expect(briefing.battle).toMatchObject({ plain: true, rewards: [], rewardValue: 0 });
      expect(briefing.battle!.elite).toBeUndefined();
      // Weaker than anything else on the road at this step.
      expect(warbandCost(briefing.battle!.enemy)).toBeLessThanOrEqual(Math.max(enemyPoints(s.round, TUNING.ambush.threat), 60));
      expect(briefing.route!.going).toBe(s.route!.going);
      checkState(briefing);
      const battle = runStep(briefing, { type: 'startBattle' });

      const after = runStep(battle, { type: 'battleResult', replay: playBattle(battle) });
      if (after.phase === 'aftermath') {
        won++;
        // XP and gold as for any win, and nothing owed on top.
        expect(after.aftermath).toMatchObject({ plain: true });
        expect(after.aftermath!.gold).toBeGreaterThan(0);
        expect(after.gold).toBe(s.gold + after.aftermath!.gold);
        expect(after.offer).toBeUndefined();
        expect(after.roster.some((u) => u.xp > 0)).toBe(true);
        checkState(after);
        const shop = autoUntil(after, 'shop', 'reward');
        expect(shop.phase).toBe('shop');
        expect((shop.offer as { market?: true }).market).toBeUndefined();
        const on = runStep(shop, { type: 'leaveShop' });
        expect([on.phase, on.round, on.route!.at]).toEqual(['map', s.round + 1, s.route!.going]);
      } else expect(after.phase).toBe('over');

      // Fled, the mystery's node closes like any other.
      const replay = recordReplay(runBattleConfig(battle), retreating());
      const ran = runStep(battle, { type: 'battleResult', replay });
      if (ran.aftermath?.retreated) {
        fled++;
        const others = s.route!.nodes[s.route!.at!]!.next.filter((id) => id !== s.route!.going);
        expect(ran.route!.closed).toEqual(others.length > 0 ? [s.route!.going] : []);
        expect(autoUntil(ran, 'map').round).toBe(s.round);
      }
    }
    expect([won > 0, fled > 0]).toEqual([true, true]);
  });
});

describe('the buried cache', () => {
  it('take what shows: a little gold, safely', () => {
    const s = staged('cache');
    const { base, perRound } = TUNING.cache.gold;
    expect(offerOf(s).gold).toBe(base + perRound * s.round);
    const took = choose(s, 0);
    expect([took.gold, took.roster]).toEqual([s.gold + offerOf(s).gold!, s.roster]);
    expect(offerOf(took).die).toBeUndefined();
    settled(s, took, 0);
  });

  it('dig deeper: a d6 for three times the gold, or a cave-in that lays a unit up', () => {
    const { collapse, multiplier } = TUNING.cache;
    const dice = new Set<number>();
    for (let seed = 0; seed < 60; seed++) {
      const base = staged('cache');
      const s: RunState = { ...base, seed: base.seed + seed * 77 };
      const dug = choose(s, 1);
      const die = offerOf(dug).die!;
      dice.add(die);
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(6);
      const laidUp = dug.roster.filter((u) => u.sitsOut).length - s.roster.filter((u) => u.sitsOut).length;
      if (die <= collapse) expect([dug.gold, laidUp]).toEqual([s.gold, 1]);
      else expect([dug.gold, laidUp]).toEqual([s.gold + offerOf(s).gold! * multiplier, 0]);
      expect(dug.roster.map((u) => ({ ...u, sitsOut: undefined }))).toEqual(s.roster.map((u) => ({ ...u, sitsOut: undefined })));
      expect(offerOf(dug).result!.text).toContain(`The die shows ${die}`);
      if (seed < 3) settled(s, dug, 1);
      expect(choose(s, 1)).toEqual(dug);
    }
    expect([...dice].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('the deserters', () => {
  it('take them in: a free recruit, and Disloyal', () => {
    for (let rolls = 0; rolls < 15; rolls++) {
      const s = staged('deserters', 0, rolls);
      const e = offerOf(s);
      expect(e.unit!.disloyal).toBe(true);
      expect(unitCost({ ...e.unit!, disloyal: false })).toBeLessThanOrEqual(TUNING.deserters.maxCost);
      const joined = choose(s, 0);
      expect(joined.gold).toBe(0);
      expect(joined.roster).toHaveLength(s.roster.length + 1);
      expect(joined.roster.at(-1)!.unit).toMatchObject({ disloyal: true, quality: e.unit!.quality, combat: e.unit!.combat });
      expect(validateArmy({ name: 'x', units: joined.roster.map((u) => u.unit) }).errors).toEqual([]);
      if (rolls === 0) settled(s, joined, 0);
    }
    const s = staged('deserters');
    const full: RunState = { ...s, roster: Array.from({ length: rosterCap }, (_, i) => ({ ...s.roster[0]!, id: `f${i}`, unit: { ...s.roster[0]!.unit, name: `F${i}` } })) };
    expect(runActionError(full, { type: 'eventChoice', index: 0 })).toMatch(/roster is full/);
  });

  it('turn them in: a small bounty', () => {
    const s = staged('deserters', 3);
    const { base, perRound } = TUNING.deserters.gold;
    const paid = choose(s, 1);
    expect([paid.gold, paid.roster]).toEqual([3 + base + perRound * s.round, s.roster]);
    settled(s, paid, 1);
  });
});

describe('the fallen standard', () => {
  it('raise it: a retreat banner, unless the warband already carries all it may', () => {
    const s: RunState = { ...staged('standard'), banners: 1 };
    const raised = choose(s, 0);
    expect([raised.banners, raised.gold]).toEqual([2, s.gold]);
    settled(s, raised, 0);
    const laden: RunState = { ...s, banners: BANNERS.max };
    expect(runActionError(laden, { type: 'eventChoice', index: 0 })).toMatch(/at most/);
    expect(legalRunActions(laden)).toEqual([{ type: 'eventChoice', index: 1 }]);
  });

  it('sell it: gold, whatever the banners in hand', () => {
    for (const banners of [0, BANNERS.max]) {
      const s: RunState = { ...staged('standard'), banners };
      const sold = choose(s, 1);
      expect([sold.banners, sold.gold]).toEqual([banners, s.gold + TUNING.standard.gold]);
      settled(s, sold, 1);
    }
  });
});
