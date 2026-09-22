import type { GameEvent } from '@fansong/engine';

/**
 * Presentation of dice rolls: turns engine roll events into what the board's
 * roll overlay shows — each die, the modifiers added to it, the total, and the
 * verdict. Pure (no DOM), so every wording and outcome rule is unit-testable.
 */

/** A flat modifier added to a die, e.g. "+3 Combat". */
export interface RollModifier {
  label: string;
  value: number;
}

/** One side of an opposed roll: its die, modifiers and total. */
export interface RollSide {
  unitId: string;
  /** Short role heading: Attack / Defend / Shoot / Riposte. */
  role: string;
  die: number;
  mods: RollModifier[];
  total: number;
  outcome: 'win' | 'lose' | 'tie';
  /** A rule note under the total, e.g. why a higher total did no harm. */
  note?: string;
}

/** Big floating text naming what the roll did. */
export interface RollVerdict {
  text: string;
  /** The reason, e.g. "9 doubles 4". */
  detail?: string;
  /** Unit(s) it floats over: the one affected, or both on a clash. */
  on: string[];
  tone: 'kill' | 'down' | 'neutral' | 'save';
}

export interface OpposedRoll {
  kind: 'opposed';
  /** Who rolls on the left of the pair; `a` is the aggressor. */
  a: RollSide;
  b: RollSide;
  verdict: RollVerdict;
}

/** An activation roll: several dice each tested against Quality. */
export interface ActivationRoll {
  kind: 'activation';
  unitId: string;
  quality: number;
  dice: { value: number; success: boolean }[];
  /** Result line under the dice, e.g. "2 actions". */
  summary: string;
  turnover: boolean;
  verdict: RollVerdict | null;
}

/** A single nerve die against Quality, after a nearby death or a rout. */
export interface NerveRoll {
  kind: 'nerve';
  unitId: string;
  quality: number;
  die: number;
  passed: boolean;
  /** What failing did: knocked down (fear) or fled (rout). */
  summary: string;
}

type Combat = Extract<GameEvent, { type: 'AttackResolved' | 'ShotResolved' | 'GuardRiposte' }>;

function side(
  unitId: string,
  role: string,
  die: number,
  total: number,
  bonus: number | undefined,
  outcome: RollSide['outcome'],
): RollSide {
  const mods: RollModifier[] = [{ label: 'Combat', value: total - die - (bonus ?? 0) }];
  if (bonus) mods.push({ label: 'High ground', value: bonus });
  return { unitId, role, die, mods, total, outcome };
}

function outcomes(a: number, b: number): [RollSide['outcome'], RollSide['outcome']] {
  if (a > b) return ['win', 'lose'];
  if (b > a) return ['lose', 'win'];
  return ['tie', 'tie'];
}

/**
 * Describe an attack, shot or riposte. `after` is the rest of the event batch,
 * scanned for a Tough save that turns the would-be kill into a knockdown.
 */
export function describeCombat(e: Combat, after: readonly GameEvent[] = []): OpposedRoll {
  let a: RollSide;
  let b: RollSide;
  if (e.type === 'GuardRiposte') {
    const [oa, ob] = outcomes(e.guardScore, e.attackerScore);
    a = side(e.guardId, 'Riposte', e.guardDie, e.guardScore, e.guardBonus, oa);
    b = side(e.attackerId, 'Attack', e.attackerDie, e.attackerScore, e.attackerBonus, ob);
  } else {
    const [oa, ob] = outcomes(e.attackScore, e.defenseScore);
    a = side(e.attackerId, e.type === 'ShotResolved' ? 'Shoot' : 'Attack', e.attackDie, e.attackScore, e.attackBonus, oa);
    b = side(e.targetId, 'Defend', e.defenseDie, e.defenseScore, e.defenseBonus, ob);
  }

  // A higher total that did nothing: a shot never hurts the shooter, and a
  // knocked-down unit only strikes back on a natural 6.
  if (e.result === 'clash' && b.outcome === 'win') {
    b.outcome = 'tie';
    a.outcome = 'tie';
    b.note = e.type === 'ShotResolved' ? 'No return fire' : 'Down: only a 6 strikes back';
  }
  if (e.type === 'GuardRiposte' && e.result === 'clash' && a.total > b.total) {
    a.outcome = 'tie';
    b.outcome = 'tie';
    a.note = 'Down: only a 6 strikes back';
  }
  // A guard never wounds itself parrying: losing its riposte just lets the attack in.
  if (e.type === 'GuardRiposte' && b.outcome === 'win') b.note = 'Guard is unhurt';

  return { kind: 'opposed', a, b, verdict: combatVerdict(e, a, b, after) };
}

function combatVerdict(e: Combat, a: RollSide, b: RollSide, after: readonly GameEvent[]): RollVerdict {
  const hitsB = e.result.startsWith('defender');
  const hitsA = e.type !== 'GuardRiposte' && e.result.startsWith('attacker');
  if (!hitsA && !hitsB) {
    const detail = a.total === b.total ? `${a.total} ties ${b.total}` : undefined;
    const text = e.type === 'GuardRiposte' ? 'Attack goes through' : e.type === 'ShotResolved' ? 'Missed' : 'Clash';
    return { text, ...(detail ? { detail } : {}), on: [a.unitId, b.unitId], tone: 'neutral' };
  }
  const [winner, loser] = hitsB ? [a, b] : [b, a];
  const killed = e.result === 'defenderKilled' || e.result === 'attackerKilled';
  const doubled = winner.total >= loser.total * 2;
  const detail = doubled ? `${winner.total} doubles ${loser.total}` : `${winner.total} beats ${loser.total}`;
  if (killed) {
    const saved = after.some((x) => x.type === 'ToughnessSaved' && x.unitId === loser.unitId);
    if (saved) return { text: 'Tough!', detail: `${detail} — knocked down instead`, on: [loser.unitId], tone: 'save' };
    const already = !doubled ? ' — already down' : '';
    return { text: 'Slain!', detail: `${detail}${already}`, on: [loser.unitId], tone: 'kill' };
  }
  if (e.result === 'defenderRecoiled' || e.result === 'attackerRecoiled') {
    return { text: 'Pushed back', detail: `${detail} on an odd ${winner.die}`, on: [loser.unitId], tone: 'down' };
  }
  const cornered = winner.die % 2 === 1 ? ' — no room to fall back' : '';
  return { text: 'Knocked down', detail: `${detail}${cornered}`, on: [loser.unitId], tone: 'down' };
}

/**
 * Describe an activation roll. `after` is the rest of the batch: a Turnover or
 * a stand-up changes the summary.
 */
export function describeActivation(
  e: Extract<GameEvent, { type: 'DiceRolled' }>,
  after: readonly GameEvent[] = [],
): ActivationRoll {
  const dice = e.dice.map((value) => ({ value, success: value >= e.quality }));
  const turnover = after.some((x) => x.type === 'Turnover' && x.unitId === e.unitId);
  const stood = after.some((x) => x.type === 'UnitStoodUp' && x.unitId === e.unitId);
  let summary: string;
  if (turnover) summary = `${e.failures} fails — turnover`;
  else {
    const actions = e.successes - (stood ? 1 : 0);
    const plural = actions === 1 ? 'action' : 'actions';
    summary = stood ? `Stands up (−1) · ${actions} ${plural}` : actions > 0 ? `${actions} ${plural}` : 'No actions';
  }
  const verdict: RollVerdict | null = turnover
    ? { text: 'Turnover!', detail: 'benched for the round', on: [e.unitId], tone: 'kill' }
    : null;
  return { kind: 'activation', unitId: e.unitId, quality: e.quality, dice, summary, turnover, verdict };
}

/** Describe a nerve check; `after` tells a rout (flees) from fear (knocked down). */
export function describeNerve(
  e: Extract<GameEvent, { type: 'NerveCheck' }>,
  after: readonly GameEvent[] = [],
): NerveRoll {
  const fled = after.some((x) => x.type === 'UnitRouted' && x.unitId === e.unitId);
  const summary = e.passed ? 'Holds firm' : fled ? 'Flees!' : 'Shaken — knocked down';
  return { kind: 'nerve', unitId: e.unitId, quality: e.quality, die: e.die, passed: e.passed, summary };
}

/** Signed modifier text: "+3", "−1", "+0". */
export function signed(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}
