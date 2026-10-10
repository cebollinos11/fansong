import { unitCost } from '../cost.js';
import { applyAdvance, applyWound, availableAdvances, availableWounds } from './advance.js';
import type { RunRandom } from './rng.js';
import { enlist, rosterUnit, TROOP_POOL } from './roster.js';
import { RUN_TUNING } from './tuning.js';
import type { RunOffer, RunState } from './types.js';

/**
 * What a mystery node turns out to be: one event, with two or three ways to
 * take it. Which event it is, and what it holds, is rolled on arrival; a
 * choice that throws dice throws them when it is made. A choice is final: the
 * offer then carries its `result`, and the run moves on.
 */

export type RunEvent = Extract<RunOffer, { kind: 'event' }>;
export type RunEventId = RunEvent['event'];

/** One way to take an event, as it is offered. */
export interface EventChoice {
  label: string;
  /** What it costs and what it may bring. */
  detail: string;
  /** Whether it is done to (or by) one roster unit, named with the choice. */
  needsUnit?: true;
}

/** What a choice did: a line to tell the player, or `battle` when it leads to a fight. */
export type EventOutcome = { text: string } | { battle: true };

interface EventDef {
  title: string;
  /** What the warband comes upon, told to the player. */
  text: (e: RunEvent) => string;
  /** What this meeting holds (mutates `e`), rolled on arrival. */
  setup: (e: RunEvent, s: RunState, rnd: RunRandom) => void;
  choices: (e: RunEvent, s: RunState) => EventChoice[];
  /** Take choice `index` (mutates `s`); throws if it can't be taken. */
  apply: (e: RunEvent, s: RunState, index: number, unitId: string | undefined, rnd: RunRandom) => EventOutcome;
}

function pay(s: RunState, price: number): void {
  if (price > s.gold) throw new Error(`that costs ${price} gold, and there is only ${s.gold}`);
  s.gold -= price;
}

function room(s: RunState): void {
  if (s.roster.length >= RUN_TUNING.rosterCap) throw new Error('the roster is full');
}

const byRound = (v: { base: number; perRound: number }, round: number) => v.base + v.perRound * round;

/** A trait's key as a word or two: `badBalance` → "Bad Balance". */
const traitWord = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/** What slipping past an ambush costs at `round`. */
export function ambushToll(round: number): number {
  return byRound(RUN_TUNING.events.ambush.toll, round);
}

const EVENTS: Record<RunEventId, EventDef> = {
  sellsword: {
    title: 'The sellsword',
    text: (e) => `A scarred veteran sits by the road with a blade across the knees, between masters and short of coin. ${e.unit!.name} will march with you for less than such a fighter is worth.`,
    setup: (e, _s, rnd) => {
      const { minCost, priceShare } = RUN_TUNING.events.sellsword;
      e.unit = { ...rnd.pick(TROOP_POOL.filter((u) => unitCost(u) >= minCost)) };
      e.price = Math.ceil(unitCost(e.unit) * priceShare);
    },
    choices: (e) => [
      { label: `Hire ${e.unit!.name}`, detail: `${e.price} gold, for a unit worth ${unitCost(e.unit!)} points` },
      { label: 'Walk on', detail: 'Keep your gold' },
    ],
    apply: (e, s, index) => {
      if (index === 1) return { text: 'You leave the sellsword to wait for a richer master.' };
      room(s);
      pay(s, e.price!);
      const u = enlist(s, e.unit!);
      return { text: `${u.unit.name} takes your coin and falls in with the warband.` };
    },
  },

  shrine: {
    title: 'The old shrine',
    text: () => 'A weathered stone stands in a hollow, worn smooth by hands long gone. Something still listens there. It gives, the tales say, and it takes: one who kneels rises changed both ways.',
    setup: () => {},
    choices: () => [
      { label: 'Let one unit kneel', detail: 'It gains a trait it lacks, and takes a lasting wound. Both are left to chance', needsUnit: true },
      { label: 'Walk on', detail: 'Leave the stone alone' },
    ],
    apply: (_e, s, index, unitId, rnd) => {
      if (index === 1) return { text: 'You leave the stone to its hollow.' };
      if (unitId === undefined) throw new Error('someone has to kneel');
      const u = rosterUnit(s, unitId);
      const gifts = availableAdvances(u.unit).filter((a) => a.kind === 'trait');
      if (gifts.length === 0) throw new Error(`${u.unit.name} has nothing left for the shrine to give`);
      const gift = rnd.pick(gifts);
      const gifted = applyAdvance(u.unit, gift);
      const wounds = availableWounds(gifted);
      if (wounds.length === 0) throw new Error(`${u.unit.name} has nothing left for the shrine to take`);
      const wound = rnd.pick(wounds);
      u.unit = applyWound(gifted, wound);
      u.wounds = [...(u.wounds ?? []), wound];
      const given = gift.kind === 'trait' ? traitWord(gift.trait) : '';
      const taken = wound.kind === 'trait' ? `is left ${traitWord(wound.trait)}` : wound.kind === 'combat' ? 'loses a point of Combat' : 'loses a step of Quality';
      return { text: `${u.unit.name} kneels, and rises ${given}. The stone takes its due: it ${taken}.` };
    },
  },

  ambush: {
    title: 'The ambush',
    text: (e) => `Shapes rise from the ditches on both sides of the road. They are not many, and they would sooner be paid than bled: ${e.price} gold, their leader calls, and you pass.`,
    setup: (e, s) => {
      e.price = ambushToll(s.round);
    },
    choices: (e) => [
      { label: 'Fight through', detail: 'A battle against a weak warband, for experience and gold but no reward' },
      { label: 'Pay the toll', detail: `${e.price} gold, and no fight` },
    ],
    apply: (e, s, index) => {
      if (index === 0) return { battle: true };
      pay(s, e.price!);
      return { text: 'The purse changes hands, and the road is yours again.' };
    },
  },

  cache: {
    title: 'The buried cache',
    text: (e) => `Fresh earth under a marked tree: someone hid their takings here, and never came back. A few coins show already, ${e.gold} gold for the picking up. There may be far more below, if the old cellar under it holds.`,
    setup: (e, s) => {
      e.gold = byRound(RUN_TUNING.events.cache.gold, s.round);
    },
    choices: (e) => {
      const { collapse, multiplier } = RUN_TUNING.events.cache;
      return [
        { label: 'Take what shows', detail: `${e.gold} gold, safely` },
        { label: 'Dig deeper', detail: `A d6: ${collapse} or less and the cellar falls in (no gold, and a unit sits out the next battle); over that, ${e.gold! * multiplier} gold` },
      ];
    },
    apply: (e, s, index, _unitId, rnd) => {
      const { collapse, multiplier } = RUN_TUNING.events.cache;
      if (index === 0) {
        s.gold += e.gold!;
        return { text: `You pocket the ${e.gold} gold and move on.` };
      }
      const die = rnd.d6();
      e.die = die;
      if (die > collapse) {
        s.gold += e.gold! * multiplier;
        return { text: `The die shows ${die}: the cellar holds, and gives up ${e.gold! * multiplier} gold.` };
      }
      const fit = s.roster.filter((u) => !u.sitsOut);
      const hurt = fit.length > 0 ? rnd.pick(fit) : undefined;
      if (hurt) hurt.sitsOut = true;
      return { text: `The die shows ${die}: the cellar falls in. ${hurt ? `${hurt.unit.name} is dug out bruised, and sits out the next battle` : 'Nobody is the worse for it'}, and the gold is gone.` };
    },
  },

  deserters: {
    title: 'The deserters',
    text: (e) => `A ragged figure steps out with open hands: ${e.unit!.name}, run from another banner and hungry enough to follow yours. Whoever ran once may run again. There is also a price on such heads.`,
    setup: (e, s, rnd) => {
      const { maxCost, gold } = RUN_TUNING.events.deserters;
      const pool = TROOP_POOL.filter((u) => !u.disloyal && unitCost(u) <= maxCost);
      e.unit = { ...rnd.pick(pool), disloyal: true };
      e.gold = byRound(gold, s.round);
    },
    choices: (e) => [
      { label: `Take ${e.unit!.name} in`, detail: `A free recruit worth ${unitCost(e.unit!)} points, and Disloyal: a failed nerve may turn it against you` },
      { label: 'Turn the deserter in', detail: `${e.gold} gold` },
    ],
    apply: (e, s, index) => {
      if (index === 1) {
        s.gold += e.gold!;
        return { text: `The bounty is paid: ${e.gold} gold.` };
      }
      room(s);
      const u = enlist(s, e.unit!);
      return { text: `${u.unit.name} swears to your banner, for what the oath is worth.` };
    },
  },

  standard: {
    title: 'The fallen standard',
    text: () => 'In the trampled grass of an old field lies a banner, its pole snapped, its silk still bright. Whoever carried it has no more use for it.',
    setup: (e) => {
      e.gold = RUN_TUNING.events.standard.gold;
    },
    choices: (e) => [
      { label: 'Raise it as your own', detail: `A retreat banner, if you carry fewer than ${RUN_TUNING.banners.max}` },
      { label: 'Sell the silk and gilt', detail: `${e.gold} gold` },
    ],
    apply: (e, s, index) => {
      if (index === 1) {
        s.gold += e.gold!;
        return { text: `A pedlar pays ${e.gold} gold for the cloth.` };
      }
      if (s.banners >= RUN_TUNING.banners.max) throw new Error(`a warband carries at most ${RUN_TUNING.banners.max} banners`);
      s.banners++;
      return { text: 'The banner goes up on a new pole: one more retreat in hand.' };
    },
  },
};


/** Every event a mystery node may turn out to be. */
export const RUN_EVENT_IDS = Object.keys(EVENTS) as RunEventId[];

/** The event a mystery node holds, rolled on arrival. */
export function rollEvent(s: RunState, rnd: RunRandom): RunEvent {
  const e: RunEvent = { kind: 'event', event: rnd.pick(RUN_EVENT_IDS) };
  EVENTS[e.event].setup(e, s, rnd);
  return e;
}

/** A particular event as a mystery node would hold it, for the tests and the sandbox. */
export function stageEvent(event: RunEventId, s: RunState, rnd: RunRandom): RunEvent {
  const e: RunEvent = { kind: 'event', event };
  EVENTS[event].setup(e, s, rnd);
  return e;
}

/** An event's name. */
export function eventTitle(e: RunEvent): string {
  return EVENTS[e.event].title;
}

/** What the warband comes upon, in words. */
export function eventText(e: RunEvent): string {
  return EVENTS[e.event].text(e);
}

/** The ways the event can be taken. */
export function eventChoices(e: RunEvent, s: RunState): EventChoice[] {
  return EVENTS[e.event].choices(e, s);
}

/**
 * Take choice `index` of the event on offer (mutates `s`); one that needs a
 * unit names it. Throws if there is no such event or choice, if it was already
 * taken, or if it can't be afforded or done. A choice that leads to a fight
 * returns `battle` and leaves the offer as it was.
 */
export function resolveEvent(s: RunState, index: number, unitId: string | undefined, rnd: RunRandom): EventOutcome {
  if (s.offer?.kind !== 'event') throw new Error('nothing is happening here');
  const e = s.offer;
  if (e.result) throw new Error('that is already settled');
  const choice = eventChoices(e, s)[index];
  if (!choice) throw new Error(`no choice ${index}`);
  const outcome = EVENTS[e.event].apply(e, s, index, choice.needsUnit ? unitId : undefined, rnd);
  if ('text' in outcome) e.result = { choice: index, text: outcome.text };
  return outcome;
}

