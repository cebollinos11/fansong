import { unitCost } from '../cost.js';
import {
  applyAdvance,
  applyWound,
  availableAdvances,
  availableWounds,
  canAdvance,
  GROWTH_TRAITS,
} from './advance.js';
import { recruitOffer } from './draft.js';
import { isBossRound } from './encounter.js';
import type { RunRandom } from './rng.js';
import { enlist, isWounded, mendOldest, rosterUnit } from './roster.js';
import { RUN_TUNING } from './tuning.js';
import type {
  Advance,
  AftermathLine,
  BattleReport,
  Injury,
  RewardOption,
  RunState,
  UnitReport,
} from './types.js';

/** What follows a won battle: XP and levels, injuries, gold, then the reward pick. */

/** The level `xp` has earned: how many of the thresholds it has reached. */
export function levelFor(xp: number): number {
  return RUN_TUNING.xp.levels.filter((at) => xp >= at).length;
}

/** XP a unit costing `ownCost` earns from a won battle. */
export function xpFor(report: UnitReport, ownCost: number): number {
  const { fought, perKill, costlierKill } = RUN_TUNING.xp;
  return fought + report.kills * perKill + report.killCosts.filter((c) => c > ownCost).length * costlierKill;
}

/** Gold a won `round` pays. */
export function goldFor(round: number, report: BattleReport): number {
  const { perWin, perRound, killShare } = RUN_TUNING.gold;
  return perWin + perRound * round + Math.floor(killShare * report.enemyPointsKilled);
}

/** What a fallen unit's d6 means. */
export function injuryFor(die: number): Injury {
  const { dead, wound, sitsOut } = RUN_TUNING.injury;
  return die <= dead ? 'dead' : die <= wound ? 'wound' : die <= sitsOut ? 'sitsOut' : 'recovered';
}

/**
 * Offer each unit that has earned a level it hasn't spent its next choice of
 * advances (mutates `s`). One level at a time: a unit two levels up gets its
 * second choice after taking its first, so the two never clash. A unit with
 * nothing left to learn just counts as levelled.
 */
export function rollLevelUps(s: RunState, rnd: RunRandom): void {
  const pending = s.pending ?? [];
  for (const u of s.roster) {
    if (u.level >= levelFor(u.xp) || pending.some((p) => p.unitId === u.id)) continue;
    const advances = availableAdvances(u.unit);
    if (advances.length === 0) u.level = levelFor(u.xp);
    else pending.push({ unitId: u.id, choices: rnd.sample(advances, RUN_TUNING.xp.choices) });
  }
  if (pending.length > 0) s.pending = pending;
  else delete s.pending;
}

/**
 * Settle a won battle (mutates `s`): every fielded unit earns XP; a turncoat is
 * gone; each fallen unit rolls for injury; the win pays gold; the round is
 * logged; and the levels earned are put up for choosing. Units that sat the
 * battle out are fit again.
 */
export function applyAftermath(s: RunState, report: BattleReport, rnd: RunRandom): void {
  const battle = s.battle!;
  for (const u of s.roster) delete u.sitsOut;

  const lines: AftermathLine[] = [];
  let losses = 0;
  for (const unitId of battle.fielded!) {
    const u = rosterUnit(s, unitId);
    const r = report.units[unitId]!;
    const line: AftermathLine = { unitId, name: u.unit.name, fate: r.fate, kills: r.kills, xp: 0 };
    lines.push(line);
    const lose = () => {
      s.roster = s.roster.filter((x) => x !== u);
      losses++;
    };
    if (r.fate === 'turned') {
      lose();
      continue;
    }
    line.xp = xpFor(r, unitCost(u.unit));
    u.xp += line.xp;
    u.kills += r.kills;
    if (r.fate !== 'fell') continue;

    let injury = injuryFor(rnd.d6());
    if (injury === 'wound') {
      const wounds = availableWounds(u.unit);
      if (wounds.length === 0) injury = 'sitsOut';
      else {
        line.wound = rnd.pick(wounds);
        u.unit = applyWound(u.unit, line.wound);
        u.wounds = [...(u.wounds ?? []), line.wound];
      }
    }
    if (injury === 'dead') lose();
    if (injury === 'sitsOut') u.sitsOut = true;
    line.injury = injury;
  }

  const gold = goldFor(s.round, report);
  s.gold += gold;
  s.aftermath = { gold, units: lines };
  s.log.push({
    round: s.round,
    mode: battle.mode,
    enemy: battle.enemy.name,
    boss: isBossRound(s.round),
    won: true,
    kills: lines.reduce((sum, l) => sum + l.kills, 0),
    losses,
    gold,
  });
  rollLevelUps(s, rnd);
}

/** Every advance at least one roster unit could take. */
export function rosterAdvances(s: RunState): Advance[] {
  const all: Advance[] = [...GROWTH_TRAITS.map((trait): Advance => ({ kind: 'trait', trait })), { kind: 'combat' }, { kind: 'quality' }];
  return all.filter((a) => s.roster.some((u) => canAdvance(u.unit, a)));
}

/**
 * The reward pick: different kinds where it can — a recruit (if the roster has
 * room), a boost, a purse, a mending (if anyone is wounded) — topped up with
 * more boosts. Every option offered can be taken.
 */
export function rewardOffer(s: RunState, rnd: RunRandom): RewardOption[] {
  const { options, purse, pursePerRound } = RUN_TUNING.reward;
  const boosts = rnd.sample(rosterAdvances(s), options);
  const kinds: RewardOption['kind'][] = ['gold'];
  if (s.roster.length < RUN_TUNING.rosterCap) kinds.push('recruit');
  if (boosts.length > 0) kinds.push('boost');
  if (s.roster.some(isWounded)) kinds.push('mend');

  const out: RewardOption[] = [];
  for (const kind of rnd.sample(kinds, options)) {
    if (kind === 'gold') out.push({ kind, amount: purse + pursePerRound * s.round });
    else if (kind === 'recruit') out.push({ kind, unit: recruitOffer(1, rnd)[0]! });
    else if (kind === 'boost') out.push({ kind, advance: boosts.shift()! });
    else out.push({ kind });
  }
  while (out.length < options && boosts.length > 0) out.push({ kind: 'boost', advance: boosts.shift()! });
  return out;
}

/** Take a reward (mutates `s`); a boost or a mending goes to `unitId`. Throws if it can't be taken. */
export function applyReward(s: RunState, option: RewardOption, unitId?: string): void {
  if (option.kind === 'gold') {
    s.gold += option.amount;
  } else if (option.kind === 'recruit') {
    if (s.roster.length >= RUN_TUNING.rosterCap) throw new Error('the roster is full');
    enlist(s, option.unit);
  } else {
    if (unitId === undefined) throw new Error('this reward needs a unit');
    const u = rosterUnit(s, unitId);
    if (option.kind === 'mend') mendOldest(u);
    else {
      if (!canAdvance(u.unit, option.advance)) throw new Error(`${u.unit.name} cannot take that boost`);
      u.unit = applyAdvance(u.unit, option.advance);
    }
  }
}
