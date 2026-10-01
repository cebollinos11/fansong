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
  /** Short role heading: Attack / Power blow / Defend / Shoot / Aimed shot / Riposte / Free hack / Leaving. */
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
  /** A gruesome kill: stamped across the view as a headline rather than shown as an ordinary verdict. */
  gruesome?: true;
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
  /** `inspired` marks the die a war cry made a sure 6. */
  dice: { value: number; success: boolean; inspired?: true }[];
  /** Whether the unit rolled inspired (its first die a sure 6). */
  inspired: boolean;
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

type Combat = Extract<GameEvent, { type: 'AttackResolved' | 'ShotResolved' | 'GuardRiposte' | 'FreeHackResolved' }>;

/**
 * One side of the roll. `extras` are the situational modifiers the engine
 * reported (absent or 0 = not shown); Combat is whatever remains of the total.
 */
function side(
  unitId: string,
  role: string,
  die: number,
  total: number,
  extras: [label: string, value: number | undefined][],
  outcome: RollSide['outcome'],
): RollSide {
  const shown = extras.filter((x): x is [string, number] => !!x[1]).map(([label, value]) => ({ label, value }));
  const combat = total - die - shown.reduce((sum, m) => sum + m.value, 0);
  const mods: RollModifier[] = [{ label: 'Combat', value: combat }, ...shown];
  return { unitId, role, die, mods, total, outcome };
}

const minus = (n: number | undefined) => (n ? -n : undefined);

function outcomes(a: number, b: number): [RollSide['outcome'], RollSide['outcome']] {
  if (a > b) return ['win', 'lose'];
  if (b > a) return ['lose', 'win'];
  return ['tie', 'tie'];
}

/**
 * Describe an attack, shot, riposte or free hack. `after` is the rest of the
 * event batch, scanned for an armor save that turned a 1-point loss into a
 * clash, for Combat Mastery turning a tie into a kill, for a Tough save that
 * turns the would-be kill into a knockdown, and for where a push ended (braced
 * by a friend, off the map).
 */
export function describeCombat(e: Combat, after: readonly GameEvent[] = []): OpposedRoll {
  let a: RollSide;
  let b: RollSide;
  if (e.type === 'GuardRiposte') {
    const [oa, ob] = outcomes(e.guardScore, e.attackerScore);
    a = side(e.guardId, 'Riposte', e.guardDie, e.guardScore, [['High ground', e.guardBonus], ['Size', e.guardBig], ['Swoop', e.guardFly], ['Mounted', e.guardMounted], ['Opportunist', e.guardOpportunist], ['Outnumbered', minus(e.guardOutnumbered)]], oa);
    b = side(e.attackerId, 'Attack', e.attackerDie, e.attackerScore, [['High ground', e.attackerBonus], ['Size', e.attackerBig], ['Mounted', e.attackerMounted], ['Opportunist', e.attackerOpportunist], ['Outnumbered', minus(e.attackerOutnumbered)]], ob);
  } else if (e.type === 'ShotResolved') {
    const [oa, ob] = outcomes(e.attackScore, e.defenseScore);
    a = side(e.attackerId, e.aimPenalty ? 'Aimed shot' : 'Shoot', e.attackDie, e.attackScore, [['High ground', e.attackBonus], ['Big target', e.bigTarget], ['Flying target', e.flyingTarget], ['Opportunist', e.attackOpportunist], ['Sharpshooter', e.attackSharpshooter], ['Long range', minus(e.rangePenalty)], ['Cover', minus(e.coverPenalty)]], oa);
    b = side(e.targetId, 'Defend', e.defenseDie, e.defenseScore, [['High ground', e.defenseBonus], ['Aimed at', minus(e.aimPenalty)]], ob);
  } else {
    const hack = e.type === 'FreeHackResolved';
    const power = e.type === 'AttackResolved' ? e.powerPenalty : undefined;
    const [oa, ob] = outcomes(e.attackScore, e.defenseScore);
    a = side(e.attackerId, hack ? 'Free hack' : power ? 'Power blow' : 'Attack', e.attackDie, e.attackScore, [['High ground', e.attackBonus], ['Size', e.attackBig], ['Swoop', e.attackFly], ['Mounted', e.attackMounted], ['Opportunist', e.attackOpportunist], ['Outnumbered', minus(e.attackOutnumbered)]], oa);
    b = side(e.targetId, hack ? 'Leaving' : 'Defend', e.defenseDie, e.defenseScore, [['High ground', e.defenseBonus], ['Size', e.defenseBig], ['Mounted', e.defenseMounted], ['Opportunist', e.defenseOpportunist], ['Outnumbered', minus(e.defenseOutnumbered)], ['Power blow', minus(power)]], ob);
  }

  // A higher total that did nothing: a shot never hurts the shooter, a unit
  // leaving contact can't hit back, a guard never wounds itself parrying, and a
  // knocked-down unit only strikes back on a natural 6. (A win the loser's
  // armor turned aside still reads as a win; the verdict says why.)
  const armored = armorSave(after);
  const master = masteryStrike(after);
  if (armored) {
    const loser = armored === a.unitId ? a : b;
    loser.note = 'Armor holds';
  } else if (master) {
    // A tie, but the master's is the side that counts.
    const [winner, loser] = master === a.unitId ? [a, b] : [b, a];
    winner.outcome = 'win';
    loser.outcome = 'lose';
    winner.note = 'Combat Mastery';
  } else if (e.result === 'clash' && b.outcome === 'win') {
    b.outcome = 'tie';
    a.outcome = 'tie';
    b.note =
      e.type === 'ShotResolved'
        ? 'No return fire'
        : e.type === 'FreeHackResolved'
          ? "Leaving: can't strike back"
          : e.type === 'GuardRiposte'
            ? 'Guard is unhurt'
            : 'Down: only a 6 strikes back';
  }
  if (!armored && e.type === 'GuardRiposte' && e.result === 'clash' && a.total > b.total) {
    a.outcome = 'tie';
    b.outcome = 'tie';
    a.note = 'Down: only a 6 strikes back';
  }

  return { kind: 'opposed', a, b, verdict: combatVerdict(e, a, b, after) };
}

/** The unit whose Combat Mastery turned this tie into a kill, if any: a `MasteryStruck` straight after the roll. */
function masteryStrike(after: readonly GameEvent[]): string | undefined {
  const next = after[0];
  return next?.type === 'MasteryStruck' ? next.unitId : undefined;
}

/** The unit whose armor turned this roll into a clash, if any: an `ArmorHeld` straight after the roll. */
function armorSave(after: readonly GameEvent[]): string | undefined {
  const next = after[0];
  return next?.type === 'ArmorHeld' ? next.unitId : undefined;
}

/** A gruesome kill's headline, with how the victim died underneath it. */
function gory(detail: string, victim: RollSide): RollVerdict {
  return { text: 'Gruesome Kill!', detail, on: [victim.unitId], tone: 'kill', gruesome: true };
}

function combatVerdict(e: Combat, a: RollSide, b: RollSide, after: readonly GameEvent[]): RollVerdict {
  const hitsB = e.result.startsWith('defender');
  const hitsA = e.type !== 'GuardRiposte' && e.result.startsWith('attacker');
  const armored = armorSave(after);
  if (armored) {
    const [winner, loser] = armored === a.unitId ? [b, a] : [a, b];
    return { text: 'Armor holds!', detail: `${winner.total} beats ${loser.total} by only 1`, on: [loser.unitId], tone: 'save' };
  }
  const master = masteryStrike(after);
  if (master) {
    const [winner, loser] = master === a.unitId ? [a, b] : [b, a];
    const ties = `${winner.total} ties ${loser.total}`;
    if (after.some((x) => x.type === 'ToughnessSaved' && x.unitId === loser.unitId)) {
      return { text: 'Tough!', detail: `${ties} — mastery's kill, knocked down instead`, on: [loser.unitId], tone: 'save' };
    }
    if (e.gruesome) return gory(`${ties} — a savage master's kill`, loser);
    return { text: 'Mastery!', detail: `${ties} — a master's tie kills`, on: [loser.unitId], tone: 'kill' };
  }
  if (!hitsA && !hitsB) {
    const detail = a.total === b.total ? `${a.total} ties ${b.total}` : undefined;
    const text =
      e.type === 'GuardRiposte'
        ? 'Attack goes through'
        : e.type === 'ShotResolved'
          ? 'Missed'
          : e.type === 'FreeHackResolved'
            ? 'Gets away'
            : 'Clash';
    return { text, ...(detail ? { detail } : {}), on: [a.unitId, b.unitId], tone: 'neutral' };
  }
  const [winner, loser] = hitsB ? [a, b] : [b, a];
  const killed = e.result === 'defenderKilled' || e.result === 'attackerKilled';
  const doubled = winner.total >= loser.total * 2;
  const detail = doubled ? `${winner.total} doubles ${loser.total}` : `${winner.total} beats ${loser.total}`;
  if (killed) {
    const saved = after.some((x) => x.type === 'ToughnessSaved' && x.unitId === loser.unitId);
    if (saved) return { text: 'Tough!', detail: `${detail} — knocked down instead`, on: [loser.unitId], tone: 'save' };
    if (e.gruesome) {
      // Gruesome without tripling: the winner is Savage, and every kill it deals is.
      const tripled = winner.total > loser.total && winner.total >= loser.total * 3;
      if (!tripled) return gory(`${detail} — a savage kill`, loser);
      return gory(`${winner.total} triples ${loser.total}`, loser);
    }
    const already = !doubled ? ' — already down' : '';
    return { text: 'Slain!', detail: `${detail}${already}`, on: [loser.unitId], tone: 'kill' };
  }
  if (e.type === 'FreeHackResolved' && e.result === 'defenderRecoiled') {
    // Pushed the way it was going anyway: the leaver slips away.
    return { text: 'Slips away', detail: `${detail} on an odd ${winner.die}`, on: [loser.unitId], tone: 'neutral' };
  }
  if (e.result === 'defenderRecoiled' || e.result === 'attackerRecoiled') {
    const odd = `${detail} on an odd ${winner.die}`;
    if (after.some((x) => x.type === 'UnitSupported' && x.unitId === loser.unitId)) {
      // The supporter gets its own "Supported" over its head; this names what it saved.
      return { text: 'Holds ground', detail: `${odd} — braced by a friend`, on: [loser.unitId], tone: 'save' };
    }
    if (after.some((x) => x.type === 'UnitPushedOff' && x.unitId === loser.unitId)) {
      const saved = after.some((x) => x.type === 'ToughnessSaved' && x.unitId === loser.unitId);
      return saved
        ? { text: 'Tough!', detail: `${odd} — off the edge, knocked down instead`, on: [loser.unitId], tone: 'save' }
        : e.gruesome
          ? gory(`${odd} — savagely shoved off the edge`, loser)
          : { text: 'Pushed off!', detail: `${odd} — off the edge of the map`, on: [loser.unitId], tone: 'kill' };
    }
    if (after.some((x) => x.type === 'UnitPushedIntoLava' && x.unitId === loser.unitId)) {
      return e.gruesome
        ? gory(`${odd} — savagely shoved into the lava`, loser)
        : { text: 'Into the lava!', detail: `${odd} — pushed into the lava`, on: [loser.unitId], tone: 'kill' };
    }
    return { text: 'Pushed back', detail: odd, on: [loser.unitId], tone: 'down' };
  }
  if (after.some((x) => x.type === 'UnitFellIntoLava' && x.unitId === loser.unitId)) {
    return e.gruesome
      ? gory(`${detail} — savagely knocked out of the air`, loser)
      : { text: 'Into the lava!', detail: `${detail} — knocked out of the air`, on: [loser.unitId], tone: 'kill' };
  }
  const cornered = winner.die % 2 === 1 ? ' — no room to fall back' : '';
  return { text: 'Knocked down', detail: `${detail}${cornered}`, on: [loser.unitId], tone: 'down' };
}

/**
 * Describe an activation roll. `after` is the rest of the batch: a Turnover or
 * a stand-up changes the summary. `groupOf` is how many units share the roll
 * in a group activation.
 */
export function describeActivation(
  e: Extract<GameEvent, { type: 'DiceRolled' }>,
  after: readonly GameEvent[] = [],
  groupOf = 0,
): ActivationRoll {
  const dice: ActivationRoll['dice'] = e.dice.map((value, i) =>
    e.inspired && i === 0 ? { value, success: true, inspired: true } : { value, success: value >= e.quality },
  );
  const inspired = e.inspired === true;
  const turnover = after.some((x) => x.type === 'Turnover' && x.unitId === e.unitId);
  const stood = after.some((x) => x.type === 'UnitStoodUp' && x.unitId === e.unitId);
  const actions = e.successes - (stood ? 1 : 0);
  const plural = actions === 1 ? 'action' : 'actions';
  const each = groupOf > 1 ? ` each, group of ${groupOf}` : '';
  const earned = stood ? `Stands up (−1) · ${actions} ${plural}` : actions > 0 ? `${actions} ${plural}${each}` : 'No actions';
  // A turnover with a success still acts first (3 dice, 1 success).
  let summary: string;
  if (turnover) summary = e.successes > 0 ? `${e.failures} fails — turnover · ${earned}` : `${e.failures} fails — turnover`;
  else summary = earned;
  const verdict: RollVerdict | null = turnover
    ? {
        text: 'Turnover!',
        detail: e.successes > 0 ? 'benched after this activation' : 'benched for the round',
        on: [e.unitId],
        tone: 'kill',
      }
    : null;
  return { kind: 'activation', unitId: e.unitId, quality: e.quality, dice, inspired, summary, turnover, verdict };
}

/** Describe a nerve check; `after` tells a runner leaving the field from one running for its edge. */
export function describeNerve(
  e: Extract<GameEvent, { type: 'NerveCheck' }>,
  after: readonly GameEvent[] = [],
): NerveRoll {
  const gone = after.some((x) => x.type === 'UnitRouted' && x.unitId === e.unitId);
  const failed = gone ? 'Flees the field!' : 'Flees!';
  const summary = e.passed ? 'Holds firm' : e.inspirationLost ? `${failed} Inspiration lost` : failed;
  return { kind: 'nerve', unitId: e.unitId, quality: e.quality, die: e.die, passed: e.passed, summary };
}

/** Signed modifier text: "+3", "−1", "+0". */
export function signed(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}
