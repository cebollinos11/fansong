import { BREAK_FREE_COST, spellRange, type CombatScoring, type GameEvent } from '@fansong/engine';

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

/**
 * What each modifier on a roll card is and when it applies, keyed by its label.
 * The card shows the amount; this says why it is there. Situational rules like
 * Pincer and Outnumbered belong to no unit, so the card is the only place a
 * player meets them.
 */
const MODIFIER_HELP: Record<string, string> = {
  Combat: "The unit's own Combat score, before any situational bonus or penalty",
  'High ground': 'Standing on a higher hex than its foe. Lost while knocked down',
  Size: 'A Big unit fighting a smaller foe in melee',
  Swoop: 'A flyer striking a foe on the ground. Lost while knocked down',
  Opportunist: 'An Opportunist fighting or shooting a knocked-down foe',
  Pincer:
    'A standing friend holds the hex directly opposite the foe, catching it between them. Any unit on its feet gets it: a rule of the game, not a trait',
  Rusher: "A Rusher's first attack after a Move that brought it into contact with this foe",
  Woodwise: 'A Woodwise unit standing in a forest hex, on every combat roll',
  Transfixed: 'The target is held by a Transfix spell: easy to hit, and any blow that beats it kills',
  Shieldwall: 'A Shieldwall unit defending against an attack while next to a standing friend',
  Outnumbered: 'One less for each standing enemy in contact beyond the first. A Whirling unit on its feet is never outnumbered',
  'Big target': 'Shooting at a Big unit: it is easier to hit',
  'Flying target': 'Shooting at a flyer in the air: it has nowhere to take cover',
  Sharpshooter: 'A Sharpshooter adds this to every shot it takes',
  'Long range': "The target is beyond short range, the first half of the shooter's reach",
  Cover: 'The target is in cover: in a forest, or only partly visible past a blocker',
  'Aimed at': 'An aimed shot spends two actions to make its target defend worse',
  'Power blow': 'A power blow spends two actions to make its target defend worse',
};

/** What a roll card's modifier is and when it applies, for its hover tooltip; undefined for an unknown label. */
export function modifierHelp(label: string): string | undefined {
  return MODIFIER_HELP[label];
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
  /** What the roll is, when it is not an ordinary activation: a spell turn, a struggle to break free, a spell resisted. */
  title?: string;
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

type Extras = [label: string, value: number | undefined][];
type Mods<K extends string> = { readonly [k in K]?: number };

// The modifiers each side of a melee or a shot can carry, named as the cards
// show them. Fed by a resolved event, or by `combatScoring` before the blow, so
// the preview and the roll can't disagree about what a modifier is called.
function meleeAttackExtras(m: Mods<'attackBonus' | 'attackBig' | 'attackFly' | 'attackOpportunist' | 'attackPincer' | 'attackRusher' | 'attackWoodwise' | 'attackTransfixed' | 'attackOutnumbered'>): Extras {
  return [['High ground', m.attackBonus], ['Size', m.attackBig], ['Swoop', m.attackFly], ['Opportunist', m.attackOpportunist], ['Pincer', m.attackPincer], ['Rusher', m.attackRusher], ['Woodwise', m.attackWoodwise], ['Transfixed', m.attackTransfixed], ['Outnumbered', minus(m.attackOutnumbered)]];
}

function meleeDefenseExtras(m: Mods<'defenseBonus' | 'defenseBig' | 'defenseOpportunist' | 'defenseShieldwall' | 'defenseWoodwise' | 'defenseOutnumbered' | 'powerPenalty'>): Extras {
  return [['High ground', m.defenseBonus], ['Size', m.defenseBig], ['Opportunist', m.defenseOpportunist], ['Shieldwall', m.defenseShieldwall], ['Woodwise', m.defenseWoodwise], ['Outnumbered', minus(m.defenseOutnumbered)], ['Power blow', minus(m.powerPenalty)]];
}

function shotAttackExtras(m: Mods<'attackBonus' | 'bigTarget' | 'flyingTarget' | 'attackOpportunist' | 'attackSharpshooter' | 'attackWoodwise' | 'attackTransfixed' | 'rangePenalty' | 'coverPenalty'>): Extras {
  return [['High ground', m.attackBonus], ['Big target', m.bigTarget], ['Flying target', m.flyingTarget], ['Opportunist', m.attackOpportunist], ['Sharpshooter', m.attackSharpshooter], ['Woodwise', m.attackWoodwise], ['Transfixed', m.attackTransfixed], ['Long range', minus(m.rangePenalty)], ['Cover', minus(m.coverPenalty)]];
}

function shotDefenseExtras(m: Mods<'defenseBonus' | 'defenseWoodwise' | 'aimPenalty'>): Extras {
  return [['High ground', m.defenseBonus], ['Woodwise', m.defenseWoodwise], ['Aimed at', minus(m.aimPenalty)]];
}

/** A score before its die: the unit's Combat, then each modifier that applies, as a roll card lists them. */
export interface ScorePreview {
  mods: RollModifier[];
  /** What the die is added to. */
  total: number;
}

/**
 * Both sides' scores before the dice, for an attack or shot still being planned
 * (see `combatScoring`), and a guarding target's riposte, which comes first.
 */
export function previewScores(scoring: CombatScoring): {
  attack: ScorePreview;
  defense: ScorePreview;
  riposte?: { guard: ScorePreview; attacker: ScorePreview };
} {
  if (scoring.kind === 'shot') {
    return {
      attack: preview(scoring.attackBase, shotAttackExtras(scoring.mods)),
      defense: preview(scoring.defenseBase, shotDefenseExtras(scoring.mods)),
    };
  }
  const { riposte } = scoring;
  return {
    attack: preview(scoring.attackBase, meleeAttackExtras(scoring.mods)),
    defense: preview(scoring.defenseBase, meleeDefenseExtras(scoring.mods)),
    ...(riposte
      ? {
          riposte: {
            guard: preview(riposte.attackBase, meleeAttackExtras(riposte.mods)),
            attacker: preview(riposte.defenseBase, meleeDefenseExtras(riposte.mods)),
          },
        }
      : {}),
  };
}

function preview(total: number, extras: Extras): ScorePreview {
  const { mods } = side('', '', 0, total, extras, 'tie');
  return { mods, total };
}

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
    a = side(e.guardId, 'Riposte', e.guardDie, e.guardScore, [['High ground', e.guardBonus], ['Size', e.guardBig], ['Swoop', e.guardFly], ['Opportunist', e.guardOpportunist], ['Pincer', e.guardPincer], ['Woodwise', e.guardWoodwise], ['Outnumbered', minus(e.guardOutnumbered)]], oa);
    b = side(e.attackerId, 'Attack', e.attackerDie, e.attackerScore, [['High ground', e.attackerBonus], ['Size', e.attackerBig], ['Opportunist', e.attackerOpportunist], ['Woodwise', e.attackerWoodwise], ['Outnumbered', minus(e.attackerOutnumbered)]], ob);
  } else if (e.type === 'ShotResolved') {
    const [oa, ob] = outcomes(e.attackScore, e.defenseScore);
    a = side(e.attackerId, e.aimPenalty ? 'Aimed shot' : 'Shoot', e.attackDie, e.attackScore, shotAttackExtras(e), oa);
    b = side(e.targetId, 'Defend', e.defenseDie, e.defenseScore, shotDefenseExtras(e), ob);
  } else {
    const hack = e.type === 'FreeHackResolved';
    const power = e.type === 'AttackResolved' ? e.powerPenalty : undefined;
    const [oa, ob] = outcomes(e.attackScore, e.defenseScore);
    a = side(e.attackerId, hack ? 'Free hack' : power ? 'Power blow' : 'Attack', e.attackDie, e.attackScore, meleeAttackExtras(e), oa);
    b = side(e.targetId, hack ? 'Leaving' : 'Defend', e.defenseDie, e.defenseScore, meleeDefenseExtras(e), ob);
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
    if (after.some((x) => x.type === 'UnitHeldGround' && x.unitId === loser.unitId)) {
      return { text: 'Immovable!', detail: `${odd} — it does not give way`, on: [loser.unitId], tone: 'save' };
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
    // Bad Balance, or a Trample that drove it up against something: it lands flat.
    if (after.some((x) => x.type === 'UnitKnockedDown' && x.unitId === loser.unitId)) {
      return { text: 'Pushed over', detail: `${odd} — pushed back and knocked down`, on: [loser.unitId], tone: 'down' };
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
 * in a group activation. `kind` says what the roll is for when it is not an
 * ordinary activation: a Magic User's spell turn, or a transfixed unit's
 * struggle to break free.
 */
export function describeActivation(
  e: Extract<GameEvent, { type: 'DiceRolled' }>,
  after: readonly GameEvent[] = [],
  groupOf = 0,
  kind: 'spell' | 'breakFree' | null = null,
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
  const left = e.successes - BREAK_FREE_COST;
  // A spell with no one in its reach ends the activation there and then.
  const fizzled = after[0]?.type === 'ActivationEnded';
  const earned =
    kind === 'spell'
      ? e.successes === 0
        ? 'No power: the spell fails'
        : `Power ${e.successes} · reach ${spellRange(e.successes)} hexes${fizzled ? ' · no one in reach' : ''}`
      : kind === 'breakFree'
        ? left >= 0
          ? `Breaks free${left > 0 ? ` · ${left} ${left === 1 ? 'action' : 'actions'}` : ''}`
          : `Still held (needs ${BREAK_FREE_COST})`
        : stood
          ? `Stands up (−1) · ${actions} ${plural}`
          : actions > 0
            ? `${actions} ${plural}${each}`
            : 'No actions';
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
  const title = kind === 'spell' ? 'Spell turn' : kind === 'breakFree' ? 'Break free' : undefined;
  return { kind: 'activation', unitId: e.unitId, quality: e.quality, dice, inspired, summary, turnover, verdict, ...(title ? { title } : {}) };
}

/**
 * A Transfix spell's target rolling to resist it: one die per point of power
 * against its Quality, drawn as an activation roll is. Any failure holds it.
 */
export function describeResist(e: Extract<GameEvent, { type: 'SpellCast' }>): ActivationRoll {
  return {
    kind: 'activation',
    unitId: e.targetId,
    quality: e.quality,
    dice: e.dice.map((value) => ({ value, success: value >= e.quality })),
    inspired: false,
    title: 'Resist the spell',
    summary: e.transfixed ? `${e.failures} ${e.failures === 1 ? 'fail' : 'fails'} — held by the spell` : 'Every die passes — resisted',
    turnover: false,
    verdict: e.transfixed
      ? { text: 'Transfixed!', detail: 'helpless until it breaks free', on: [e.targetId], tone: 'down' }
      : { text: 'Resisted', detail: 'the spell slides off', on: [e.targetId], tone: 'save' },
  };
}

/** Describe a nerve check; `after` tells a runner leaving the field from one running for its edge, and from a Disloyal unit changing sides. */
export function describeNerve(
  e: Extract<GameEvent, { type: 'NerveCheck' }>,
  after: readonly GameEvent[] = [],
  transfixed = false,
): NerveRoll {
  const gone = after.some((x) => x.type === 'UnitRouted' && x.unitId === e.unitId);
  const turned = after.some((x) => x.type === 'UnitDefected' && x.unitId === e.unitId);
  const ran = after.some((x) => x.type === 'UnitFled' && x.unitId === e.unitId);
  const failed = turned ? 'Changes sides!' : gone ? (transfixed ? 'Held fast: lost!' : 'Flees the field!') : ran || !transfixed ? 'Flees!' : 'Held fast: lost!';
  const summary = e.passed ? 'Holds firm' : e.inspirationLost ? `${failed} Inspiration lost` : failed;
  return { kind: 'nerve', unitId: e.unitId, quality: e.quality, die: e.die, passed: e.passed, summary };
}

/** Signed modifier text: "+3", "−1", "+0". */
export function signed(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}
