import { unitCost } from '../cost.js';
import {
  applyAdvance,
  applyWound,
  availableAdvances,
  availableWounds,
  canAdvance,
  GROWTH_TRAITS,
} from './advance.js';
import { isBossRound } from './encounter.js';
import type { RunRandom } from './rng.js';
import { enlist, isWounded, mendOldest, rosterUnit, TROOP_POOL } from './roster.js';
import { RUN_TUNING } from './tuning.js';
import type {
  Advance,
  AftermathLine,
  BattleReport,
  Injury,
  RewardOption,
  RunState,
  RunUnit,
  UnitReport,
} from './types.js';

/** What a mission pays, and what follows a battle: after a win XP and levels, injuries, gold, then that pay; after a retreat, only the injuries. */

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

/** The faces of the injury d6: up to `dead` it dies, up to `wound` it is wounded, up to `sitsOut` it sits out. */
export interface InjuryTable {
  dead: number;
  wound: number;
  sitsOut: number;
}

/** What a fallen unit's d6 means; `table` is the harsher one for a unit left behind in a retreat. */
export function injuryFor(die: number, table: InjuryTable = RUN_TUNING.injury): Injury {
  const { dead, wound, sitsOut } = table;
  return die <= dead ? 'dead' : die <= wound ? 'wound' : die <= sitsOut ? 'sitsOut' : 'recovered';
}

/**
 * Throw `u`'s injury die on `table` and apply it (mutates `u` and `line`): a
 * wound with nothing left to wound becomes sitting out. Returns whether it died.
 */
function sufferInjury(u: RunUnit, line: AftermathLine, rnd: RunRandom, table: InjuryTable): boolean {
  line.die = rnd.d6();
  let injury = injuryFor(line.die, table);
  if (injury === 'wound') {
    const wounds = availableWounds(u.unit);
    if (wounds.length === 0) injury = 'sitsOut';
    else {
      line.wound = rnd.pick(wounds);
      u.unit = applyWound(u.unit, line.wound);
      u.wounds = [...(u.wounds ?? []), line.wound];
    }
  }
  if (injury === 'sitsOut') u.sitsOut = true;
  line.injury = injury;
  return injury === 'dead';
}

/** A fielded unit's line of the aftermath, before anything has happened to it. */
function aftermathLine(u: RunUnit, r: UnitReport): AftermathLine {
  const line: AftermathLine = { unitId: u.id, name: u.unit.name, fate: r.fate, kills: r.kills, xp: 0, look: u.unit.look ?? u.unit.name };
  if (u.unit.tint) line.tint = u.unit.tint;
  return line;
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
    const line = aftermathLine(u, r);
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
    if (sufferInjury(u, line, rnd, RUN_TUNING.injury)) lose();
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

/**
 * Settle a battle the player retreated from (mutates `s`): nobody earns XP or
 * gold. A unit that walked off by the flag, or fled the field, is untouched; a
 * turncoat is gone; one that fell rolls for injury as ever; one left behind
 * rolls on the harsher `leftBehind` table. The round is logged as lost by
 * retreat. Units that sat the battle out are fit again.
 */
export function applyRetreat(s: RunState, report: BattleReport, rnd: RunRandom): void {
  const battle = s.battle!;
  for (const u of s.roster) delete u.sitsOut;

  const lines: AftermathLine[] = [];
  let losses = 0;
  for (const unitId of battle.fielded!) {
    const u = rosterUnit(s, unitId);
    const r = report.units[unitId]!;
    const line = aftermathLine(u, r);
    lines.push(line);
    u.kills += r.kills;
    const table = r.fate === 'fell' ? RUN_TUNING.injury : r.fate === 'leftBehind' ? RUN_TUNING.leftBehind : undefined;
    if (r.fate === 'turned' || (table && sufferInjury(u, line, rnd, table))) {
      s.roster = s.roster.filter((x) => x !== u);
      losses++;
    }
  }

  s.aftermath = { gold: 0, units: lines, retreated: true };
  s.log.push({
    round: s.round,
    mode: battle.mode,
    enemy: battle.enemy.name,
    boss: isBossRound(s.round),
    won: false,
    retreated: true,
    kills: lines.reduce((sum, l) => sum + l.kills, 0),
    losses,
    gold: 0,
  });
}

/** Every advance at least one roster unit could take. */
export function rosterAdvances(s: RunState): Advance[] {
  const all: Advance[] = [...GROWTH_TRAITS.map((trait): Advance => ({ kind: 'trait', trait })), { kind: 'combat' }, { kind: 'quality' }];
  return all.filter((a) => s.roster.some((u) => canAdvance(u.unit, a)));
}

/** What a mission of `threat` pays in `round`, in gold's worth: more for a harder one, and a boss's is a prize. */
export function rewardValue(round: number, threat: number): number {
  const { base, perRound, slope, min, boss } = RUN_TUNING.mission.reward;
  const share = isBossRound(round) ? boss : Math.max(min, 1 + slope * (threat - 1));
  return Math.round((base + perRound * round) * share);
}

/** What `advance` is worth in gold to this roster: its shop price for the middle one of the units that could take it. */
function boostValue(s: RunState, advance: Advance): number {
  const { upgradeMultiplier, minUpgrade } = RUN_TUNING.shop;
  const prices = s.roster
    .filter((u) => canAdvance(u.unit, advance))
    .map((u) => Math.max(minUpgrade, Math.ceil((unitCost(applyAdvance(u.unit, advance)) - unitCost(u.unit)) * upgradeMultiplier)))
    .sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)] ?? minUpgrade;
}

/** One of `items` worth about `value`: within reach of it if any is, else the dearest one under it (none if all cost more). */
function near<T>(items: readonly T[], worth: (item: T) => number, value: number, rnd: RunRandom): T | undefined {
  const under = items.filter((item) => worth(item) <= value * 1.1);
  const close = under.filter((item) => worth(item) >= value * 0.7);
  if (close.length > 0) return rnd.pick(close);
  const best = Math.max(...under.map(worth));
  const dearest = under.filter((item) => worth(item) === best);
  return dearest.length > 0 ? rnd.pick(dearest) : undefined;
}

/** The kinds of reward this roster can take: always a purse; a recruit if there is room, a boost if anyone can learn, a mending if anyone is wounded. */
export function rewardKinds(s: RunState): RewardOption['kind'][] {
  const kinds: RewardOption['kind'][] = ['gold'];
  if (s.roster.length < RUN_TUNING.rosterCap) kinds.push('recruit');
  if (rosterAdvances(s).length > 0) kinds.push('boost');
  if (s.roster.some(isWounded)) kinds.push('mend');
  return kinds;
}

/**
 * A mission's pay worth `value` in gold, of `kind` where something of that
 * kind fits: a recruit, boost or mending worth about that much, topped up with
 * gold if it falls short, or else the whole of it as a purse.
 */
export function missionRewards(s: RunState, kind: RewardOption['kind'], value: number, rnd: RunRandom): RewardOption[] {
  let main: RewardOption | undefined;
  let worth = 0;
  if (kind === 'recruit') {
    const unit = near(TROOP_POOL, unitCost, value, rnd);
    if (unit) [main, worth] = [{ kind, unit: { ...unit } }, unitCost(unit)];
  } else if (kind === 'boost') {
    const advance = near(rosterAdvances(s), (a) => boostValue(s, a), value, rnd);
    if (advance) [main, worth] = [{ kind, advance }, boostValue(s, advance)];
  } else if (kind === 'mend' && RUN_TUNING.shop.heal <= value * 1.1) {
    [main, worth] = [{ kind }, RUN_TUNING.shop.heal];
  }
  if (!main) return [{ kind: 'gold', amount: value }];
  const spare = value - worth;
  return spare >= RUN_TUNING.mission.reward.spareGold ? [main, { kind: 'gold', amount: spare }] : [main];
}


/** Whether a reward needs a unit to go to. */
export function rewardNeedsUnit(option: RewardOption): boolean {
  return option.kind === 'boost' || option.kind === 'mend';
}

/** Whether every part of a mission's pay can still be taken by this roster. */
export function rewardsClaimable(s: RunState, rewards: readonly RewardOption[]): boolean {
  return rewards.every((option) => {
    if (option.kind === 'gold') return true;
    if (option.kind === 'recruit') return s.roster.length < RUN_TUNING.rosterCap;
    if (option.kind === 'mend') return s.roster.some(isWounded);
    return s.roster.some((u) => canAdvance(u.unit, option.advance));
  });
}

/** Take one reward (mutates `s`); a boost or a mending goes to `unitId`. Throws if it can't be taken. */
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
