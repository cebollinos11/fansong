import {
  unitById,
  type CombatResult,
  type GameEvent,
  type GameOverReason,
  type GameState,
  type Owner,
  type Vec,
} from '@fansong/engine';

/**
 * The battle log, built from engine events. Presentation only.
 *
 * Events are grouped by round, then by activation: each activation is one
 * {@link LogGroup} holding the unit, its dice and what it did. A blow and the
 * knockdown, push or death it causes read as a single fight line, and a chain
 * of moves reads as one. Lines are kept as structured parts (unit references,
 * emphasised bits) so the view can colour names by owner and link them to the
 * board.
 */

/**
 * How a log line is emphasised: `objective` for scoring and flag events, `end`
 * for the game-over line, `danger` for deaths, routs and turnovers. Absent for
 * ordinary play.
 */
export type LogTone = 'objective' | 'end' | 'danger';

/** What a line is about, for the log's filter. */
export type LogCategory = 'combat' | 'objective' | 'other';

export interface UnitRef {
  id: string;
  name: string;
  owner: Owner;
}

/**
 * A piece of a log line: plain text, a unit (coloured by owner, links to the
 * board), a player, or an emphasised bit styled by `cls`.
 */
export type LogPart = string | { unit: UnitRef } | { player: Owner } | { em: string; cls?: string };

export interface DiceRoll {
  dice: number[];
  quality: number;
  successes: number;
  failures: number;
  /** The first die is the inspired, guaranteed 6. */
  inspired: boolean;
}

export interface LogItem {
  id: number;
  icon: string;
  parts: LogPart[];
  /** A few words for the one-line summary of a collapsed activation; absent when not worth summarising. */
  brief?: LogPart[];
  /** How the line came about (a fight's score breakdown), shown on demand. */
  detail?: string[];
  tone?: LogTone;
  category: LogCategory;
  /** The units the line is about, highlighted on the board while it is hovered. */
  unitIds: string[];
  /** The route walked, traced on the board while the line is hovered. */
  path?: Vec[];
  /** Set on a move line, so a chained move by the same unit extends it. */
  mover?: string;
}

export interface LogGroup {
  id: number;
  /** The activating unit; absent for events outside any activation (round-end scoring, the end of the game). */
  unit?: UnitRef;
  diceCount?: number;
  roll?: DiceRoll;
  /** Set on every member of a group activation: how many units shared the roll. */
  groupOf?: number;
  /** The dice turned over: the side is benched for the round. */
  turnover?: boolean;
  items: LogItem[];
  /** Still taking events (the activation has not ended). */
  open: boolean;
}

export interface LogRound {
  round: number;
  /** Who acts first this round; unknown for the round the log started in. */
  leader?: Owner;
  groups: LogGroup[];
}

export interface BattleLog {
  rounds: LogRound[];
  /** The newest emphasised line, as plain text — what the HUD's transient callout shows. */
  callout: { id: number; text: string; tone: LogTone } | null;
  nextId: number;
}

/** Most activations kept; older rounds are dropped whole. */
const MAX_GROUPS = 200;

export function emptyLog(round = 1): BattleLog {
  return { rounds: [{ round, groups: [] }], callout: null, nextId: 0 };
}

function ref(state: GameState, id: string): UnitRef {
  const u = unitById(state, id);
  return u ? { id, name: u.name, owner: u.owner } : { id, name: id, owner: 0 };
}

const unit = (r: UnitRef): LogPart => ({ unit: r });

/** Conquest zones are lettered A, B, C — matching the mode HUD. */
function zoneLetter(zone: number): string {
  return String.fromCharCode(65 + zone);
}

const GAME_OVER_REASONS: Record<GameOverReason, string> = {
  annihilation: 'last side standing',
  score: 'target score reached',
  roundLimit: 'the round limit was reached',
  king: 'the King has fallen',
  flag: 'flag captured',
};

/** A line flattened to text (the HUD callout, tooltips, tests). */
export function partsText(parts: readonly LogPart[]): string {
  return parts
    .map((p) => (typeof p === 'string' ? p : 'unit' in p ? p.unit.name : 'player' in p ? `P${p.player}` : p.em))
    .join('');
}

export function itemText(item: LogItem): string {
  return `${item.icon} ${partsText(item.parts)}`;
}

// --- Fights ------------------------------------------------------------------

/** One side of a roll: its die, final score and the signed modifiers behind it. */
interface FightSide {
  unit: UnitRef;
  die: number;
  score: number;
  mods: [string, number | undefined][];
}

type FightKind = 'attack' | 'power' | 'shot' | 'aimed' | 'hack' | 'riposte';

const FIGHT_VERB: Record<FightKind, string> = {
  attack: 'attacks',
  power: 'lands a power blow on',
  shot: 'shoots',
  aimed: 'takes an aimed shot at',
  hack: 'takes a free hack at',
  riposte: 'ripostes',
};

const FIGHT_ICON: Record<FightKind, string> = {
  attack: '⚔',
  power: '⚔',
  shot: '➶',
  aimed: '➶',
  hack: '⚔',
  riposte: '🛡',
};

/** A fight still gathering the consequences that follow its roll. */
interface Fight {
  item: LogItem;
  kind: FightKind;
  aggressor: FightSide;
  defender: FightSide;
  result: CombatResult;
  gruesome: boolean;
  prevented: boolean;
  tough: boolean;
  pushedOff: boolean;
  /** The loser went into lava: pushed in, or knocked out of the air over it. */
  lava: boolean;
  recoiled: boolean;
  /** The loser was pushed back and knocked down where it landed (Bad Balance, or a blocked Trample). */
  floored: boolean;
  /** The loser is Immovable: the push did not shift it. */
  held: boolean;
  supportedBy: UnitRef | null;
  armor: UnitRef | null;
  /** Whose Combat Mastery turned the tie into a kill. */
  mastery: UnitRef | null;
}

/** "Knight: rolled 4 + 3 combat +1 high ground −1 outnumbered = 7". */
function breakdown(side: FightSide): string {
  const mods = side.mods.filter((m): m is [string, number] => !!m[1]);
  const base = side.score - side.die - mods.reduce((sum, [, n]) => sum + n, 0);
  const notes = mods.map(([label, n]) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${label}`);
  return `${side.unit.name}: rolled ${side.die} + ${base} combat${notes.length ? ` ${notes.join(' ')}` : ''} = ${side.score}`;
}

const bonus = (label: string, n: number | undefined): [string, number | undefined] => [label, n];
const penalty = (label: string, n: number | undefined): [string, number | undefined] => [label, n ? -n : n];

function fightFor(state: GameState, e: GameEvent, item: LogItem): Fight | null {
  const base = { item, gruesome: false, prevented: false, tough: false, pushedOff: false, lava: false, recoiled: false, floored: false, held: false, supportedBy: null, armor: null, mastery: null };
  switch (e.type) {
    case 'AttackResolved':
    case 'FreeHackResolved': {
      const power = e.type === 'AttackResolved' ? e.powerPenalty : undefined;
      return {
        ...base,
        kind: e.type === 'FreeHackResolved' ? 'hack' : power ? 'power' : 'attack',
        result: e.result,
        gruesome: !!e.gruesome,
        aggressor: {
          unit: ref(state, e.attackerId),
          die: e.attackDie,
          score: e.attackScore,
          mods: [
            bonus('high ground', e.attackBonus),
            bonus('size', e.attackBig),
            bonus('flying', e.attackFly),
            bonus('mounted', e.attackMounted),
            bonus('opportunist', e.attackOpportunist),
            bonus('pincer', e.attackPincer),
            bonus('rusher', e.type === 'AttackResolved' ? e.attackRusher : undefined),
            bonus('woodwise', e.attackWoodwise),
            penalty('outnumbered', e.attackOutnumbered),
          ],
        },
        defender: {
          unit: ref(state, e.targetId),
          die: e.defenseDie,
          score: e.defenseScore,
          mods: [
            bonus('high ground', e.defenseBonus),
            bonus('size', e.defenseBig),
            bonus('mounted', e.defenseMounted),
            bonus('opportunist', e.defenseOpportunist),
            bonus('shieldwall', e.type === 'AttackResolved' ? e.defenseShieldwall : undefined),
            bonus('woodwise', e.defenseWoodwise),
            penalty('outnumbered', e.defenseOutnumbered),
            penalty('power blow', power),
          ],
        },
      };
    }
    case 'ShotResolved':
      return {
        ...base,
        kind: e.aimPenalty ? 'aimed' : 'shot',
        result: e.result,
        gruesome: !!e.gruesome,
        aggressor: {
          unit: ref(state, e.attackerId),
          die: e.attackDie,
          score: e.attackScore,
          mods: [
            bonus('high ground', e.attackBonus),
            bonus('big target', e.bigTarget),
            bonus('flying target', e.flyingTarget),
            bonus('opportunist', e.attackOpportunist),
            bonus('sharpshooter', e.attackSharpshooter),
            bonus('woodwise', e.attackWoodwise),
            penalty('long range', e.rangePenalty),
            penalty('cover', e.coverPenalty),
          ],
        },
        defender: {
          unit: ref(state, e.targetId),
          die: e.defenseDie,
          score: e.defenseScore,
          mods: [bonus('high ground', e.defenseBonus), bonus('woodwise', e.defenseWoodwise), penalty('aimed at', e.aimPenalty)],
        },
      };
    case 'GuardRiposte':
      return {
        ...base,
        kind: 'riposte',
        result: e.result,
        gruesome: !!e.gruesome,
        prevented: e.prevented,
        aggressor: {
          unit: ref(state, e.guardId),
          die: e.guardDie,
          score: e.guardScore,
          mods: [
            bonus('high ground', e.guardBonus),
            bonus('size', e.guardBig),
            bonus('flying', e.guardFly),
            bonus('mounted', e.guardMounted),
            bonus('opportunist', e.guardOpportunist),
            bonus('pincer', e.guardPincer),
            bonus('woodwise', e.guardWoodwise),
            penalty('outnumbered', e.guardOutnumbered),
          ],
        },
        defender: {
          unit: ref(state, e.attackerId),
          die: e.attackerDie,
          score: e.attackerScore,
          mods: [
            bonus('high ground', e.attackerBonus),
            bonus('size', e.attackerBig),
            bonus('mounted', e.attackerMounted),
            bonus('opportunist', e.attackerOpportunist),
            bonus('woodwise', e.attackerWoodwise),
            penalty('outnumbered', e.attackerOutnumbered),
          ],
        },
      };
    default:
      return null;
  }
}

/**
 * Fold a consequence of the latest roll into its fight line. Returns false when
 * the event is not about that fight, so it gets a line of its own.
 */
function absorb(f: Fight, e: GameEvent, state: GameState): boolean {
  const involved = (id: string) => id === f.aggressor.unit.id || id === f.defender.unit.id;
  switch (e.type) {
    case 'ArmorHeld':
      if (!involved(e.unitId)) return false;
      f.armor = ref(state, e.unitId);
      return true;
    case 'MasteryStruck':
      if (!involved(e.unitId)) return false;
      f.mastery = ref(state, e.unitId);
      return true;
    case 'ToughnessSaved':
      if (!involved(e.unitId)) return false;
      f.tough = true;
      return true;
    case 'UnitKilled':
      // Already said by the result.
      return involved(e.unitId);
    case 'UnitPushedOff':
      if (!involved(e.unitId)) return false;
      f.pushedOff = true;
      return true;
    case 'UnitPushedIntoLava':
    case 'UnitFellIntoLava':
      if (!involved(e.unitId)) return false;
      f.lava = true;
      return true;
    case 'UnitRecoiled':
      if (!involved(e.unitId)) return false;
      f.recoiled = true;
      return true;
    case 'UnitSupported':
      if (!involved(e.unitId)) return false;
      f.supportedBy = ref(state, e.supporterId);
      f.item.unitIds.push(e.supporterId);
      return true;
    case 'UnitHeldGround':
      if (!involved(e.unitId)) return false;
      f.held = true;
      return true;
    case 'UnitKnockedDown':
      // Already said by the result (or by a Tough save) — unless it was only pushed.
      if (!involved(e.unitId)) return false;
      if (f.recoiled && f.result.endsWith('Recoiled')) f.floored = true;
      return true;
    default:
      return false;
  }
}

/** Write a fight's line once all its consequences are in. */
function finishFight(f: Fight): void {
  const { item, aggressor, defender, result } = f;
  const victim = result.startsWith('attacker') ? aggressor.unit : result.startsWith('defender') ? defender.unit : null;
  let label: string;
  let short: string;
  let cls: string | undefined;
  let braced = false;
  if (result.endsWith('Killed')) {
    [label, short, cls] = f.tough ? ['knocked down (Tough)', 'down', 'down'] : ['killed', 'killed', 'kill'];
    if (f.mastery) label += ' by Combat Mastery';
  } else if (result.endsWith('KnockedDown')) {
    [label, short, cls] = f.lava ? ['knocked into the lava — killed', 'killed', 'kill'] : ['knocked down', 'down', 'down'];
  } else if (result.endsWith('Recoiled')) {
    if (f.lava) {
      [label, short, cls] = ['pushed into the lava — killed', 'killed', 'kill'];
    } else if (f.pushedOff) {
      [label, short, cls] = f.tough
        ? ['pushed off the edge, knocked down (Tough)', 'down', 'down']
        : ['pushed off the edge — killed', 'killed', 'kill'];
    } else if (f.supportedBy) {
      [label, short, cls] = ['braced by ', 'held', undefined];
      braced = true;
    } else if (f.held) {
      [label, short, cls] = ['holds its ground (Immovable)', 'held', undefined];
    } else if (f.floored) {
      [label, short, cls] = ['pushed back and knocked down', 'down', 'down'];
    } else if (!f.recoiled && f.kind === 'hack') {
      [label, short, cls] = ['slips away', 'slipped', undefined];
    } else {
      [label, short, cls] = ['pushed back', 'pushed', 'push'];
    }
  } else if (f.armor) {
    [label, short, cls] = ['armor holds', 'clash', undefined];
  } else if (f.kind === 'riposte') {
    [label, short, cls] = ['attack goes through', 'through', undefined];
  } else {
    [label, short, cls] = ['clash', 'clash', undefined];
  }

  const outcome: LogPart[] = [];
  // Name the loser only when it is not the one being struck.
  if (victim && victim.id !== defender.unit.id) outcome.push(unit(victim), ' ');
  outcome.push(cls ? { em: label, cls } : label);
  if (braced && f.supportedBy) outcome.push(unit(f.supportedBy));
  if (f.gruesome) outcome.push(' ', { em: 'gruesome!', cls: 'kill' });
  if (f.prevented) outcome.push(' · attack stopped');

  item.parts = [
    unit(aggressor.unit),
    ` ${FIGHT_VERB[f.kind]} `,
    unit(defender.unit),
    ' ',
    { em: `${aggressor.score}–${defender.score}`, cls: 'score' },
    ' → ',
    ...outcome,
  ];
  item.brief = [`${FIGHT_ICON[f.kind]} `, unit(victim ?? defender.unit), ` ${short}`];
  item.detail = [breakdown(aggressor), breakdown(defender)];
  if (f.mastery) item.detail.push(`Combat Mastery: ${f.mastery.name}'s tie kills a foe without it.`);
  if (f.gruesome) item.detail.push('Gruesome: a lopsided or savage kill that shakes nearby friends.');
  if (cls === 'kill') item.tone = 'danger';
}

// --- Building ------------------------------------------------------------------

/** Copy the parts of the log an append may touch: the newest round, its newest group and that group's items. */
function cloneTail(log: BattleLog): BattleLog {
  const rounds = [...log.rounds];
  const r = rounds.at(-1)!;
  const groups = [...r.groups];
  const g = groups.at(-1);
  if (g) {
    groups[groups.length - 1] = {
      ...g,
      items: g.items.map((i) => ({ ...i, parts: [...i.parts], unitIds: [...i.unitIds] })),
    };
  }
  rounds[rounds.length - 1] = { ...r, groups };
  return { ...log, rounds };
}

/** Append one transition's events (read against `state`, the state after them). */
export function appendEvents(prev: BattleLog, state: GameState, events: readonly GameEvent[]): BattleLog {
  const log = cloneTail(prev);
  let fight: Fight | null = null;

  const round = () => log.rounds.at(-1)!;
  const current = () => round().groups.at(-1);
  /** The open activation, or a loose group for events outside one. */
  const group = (): LogGroup => {
    const g = current();
    if (g && (g.open || !g.unit)) return g;
    const loose: LogGroup = { id: log.nextId++, items: [], open: false };
    round().groups.push(loose);
    return loose;
  };
  const add = (item: Omit<LogItem, 'id'>): LogItem => {
    const full = { ...item, id: log.nextId++ };
    group().items.push(full);
    if (full.tone === 'objective' || full.tone === 'end') {
      log.callout = { id: full.id, text: itemText(full), tone: full.tone };
    }
    return full;
  };
  const closeFight = () => {
    if (fight) finishFight(fight);
    fight = null;
  };

  for (const e of events) {
    if (fight && absorb(fight, e, state)) continue;
    closeFight();

    const f = fightFor(state, e, { id: -1, icon: '', parts: [], category: 'combat', unitIds: [] });
    if (f) {
      f.item.icon = FIGHT_ICON[f.kind];
      f.item.unitIds = [f.aggressor.unit.id, f.defender.unit.id];
      f.item = add(f.item);
      fight = f;
      continue;
    }

    switch (e.type) {
      case 'ActivationChosen': {
        const g = current();
        if (g) g.open = false;
        round().groups.push({
          id: log.nextId++,
          unit: ref(state, e.unitId),
          diceCount: e.diceCount,
          ...(e.group ? { groupOf: e.group.length } : {}),
          items: [],
          open: true,
        });
        break;
      }
      case 'GroupMemberActivated': {
        // The next member of a group: its own entry, under the roll they share.
        const groups = round().groups;
        const g = current();
        const shared = [...groups].reverse().find((x) => x.groupOf);
        if (g?.open && g.unit && g.items.length === 0) {
          // The member in hand stepped back before doing anything; this one takes its entry.
          g.unit = ref(state, e.unitId);
          break;
        }
        if (g) g.open = false;
        groups.push({
          id: log.nextId++,
          unit: ref(state, e.unitId),
          diceCount: shared?.diceCount,
          roll: shared?.roll,
          groupOf: shared?.groupOf,
          items: [],
          open: true,
        });
        break;
      }
      case 'DiceRolled': {
        const roll: DiceRoll = {
          dice: e.dice,
          quality: e.quality,
          successes: e.successes,
          failures: e.failures,
          inspired: !!e.inspired,
        };
        const g = current();
        if (g?.open && g.unit?.id === e.unitId) g.roll = roll;
        break;
      }
      case 'Turnover': {
        const g = current();
        if (g?.open) g.turnover = true;
        add({
          icon: '✖',
          parts: ['Turnover — ', { player: e.player }, ' is benched for the round'],
          brief: ['✖ turnover'],
          tone: 'danger',
          category: 'other',
          unitIds: [e.unitId],
        });
        break;
      }
      case 'ActivationEnded': {
        const g = current();
        if (g?.unit) g.open = false;
        break;
      }
      case 'UnitMoved': {
        const path = e.path ?? [e.from, e.to];
        const last = group().items.at(-1);
        // A chain of moves (one plan, several commands) reads as one walk.
        if (last?.mover === e.unitId && last.path) {
          last.path = [...last.path, ...path.slice(1)];
        } else {
          add({ icon: '➜', parts: [], category: 'other', unitIds: [e.unitId], path, mover: e.unitId });
        }
        const item = group().items.at(-1)!;
        const hexes = item.path!.length - 1;
        const n = `${hexes} ${hexes === 1 ? 'hex' : 'hexes'}`;
        item.parts = [unit(ref(state, e.unitId)), ` moves ${n}`];
        item.brief = [`➜ ${n}`];
        break;
      }
      case 'UnitStoodUp':
        add({
          icon: '⤒',
          parts: [unit(ref(state, e.unitId)), e.reassembled ? ' reassembles and stands up' : ' stands up'],
          brief: ['⤒ stands'],
          category: 'other',
          unitIds: [e.unitId],
        });
        break;
      case 'GuardDeclared':
        add({
          icon: '🛡',
          parts: [unit(ref(state, e.unitId)), ' raises guard'],
          brief: ['🛡 guard'],
          category: 'other',
          unitIds: [e.unitId],
        });
        break;
      case 'WarCry': {
        const inspired = e.inspired.map((id) => ref(state, id));
        const parts: LogPart[] = [unit(ref(state, e.unitId)), ' lets out a war cry'];
        inspired.forEach((r, i) => parts.push(i === 0 ? ', inspiring ' : ', ', unit(r)));
        add({
          icon: '📣',
          parts,
          brief: ['📣 war cry'],
          category: 'other',
          unitIds: [e.unitId, ...e.inspired],
        });
        break;
      }
      case 'LeaderFallen':
        add({
          icon: '☠',
          parts: [unit(ref(state, e.unitId)), ', a Leader, has fallen!'],
          brief: ['☠ ', unit(ref(state, e.unitId))],
          tone: 'danger',
          category: 'combat',
          unitIds: [e.unitId],
        });
        break;
      case 'NerveCheck':
        break; // implied by the knockdown or rout it produces
      case 'WarbandBroken':
        add({
          icon: '⚠',
          parts: [{ player: e.player }, "'s warband breaks!"],
          brief: ['⚠ broken'],
          tone: 'danger',
          category: 'combat',
          unitIds: [],
        });
        break;
      case 'UnitRouted':
        add({
          icon: '🏳',
          parts: [unit(ref(state, e.unitId)), ' flees the field'],
          brief: ['🏳 ', unit(ref(state, e.unitId))],
          tone: 'danger',
          category: 'combat',
          unitIds: [e.unitId],
        });
        break;
      case 'UnitDefected':
        add({
          icon: '🗡',
          parts: [unit(ref(state, e.unitId)), ' changes sides, joining ', { player: e.to }],
          brief: ['🗡 ', unit(ref(state, e.unitId))],
          tone: 'danger',
          category: 'combat',
          unitIds: [e.unitId],
        });
        break;
      case 'UnitHeldGround':
        add({ icon: '⛨', parts: [unit(ref(state, e.unitId)), ' holds its ground (Immovable)'], category: 'combat', unitIds: [e.unitId] });
        break;
      case 'UnitFled':
        add({
          icon: '🏃',
          parts: [unit(ref(state, e.unitId)), ' breaks and runs'],
          brief: ['🏃 ', unit(ref(state, e.unitId))],
          category: 'combat',
          unitIds: [e.unitId],
          path: e.path,
        });
        break;
      // Consequences with no fight line to join (none are expected; kept so nothing is lost).
      case 'ArmorHeld':
        add({ icon: '🛡', parts: [unit(ref(state, e.unitId)), "'s armor turns the blow aside"], category: 'combat', unitIds: [e.unitId] });
        break;
      case 'MasteryStruck':
        add({ icon: '⚔', parts: [unit(ref(state, e.unitId)), "'s mastery turns the tie into a kill"], category: 'combat', unitIds: [e.unitId] });
        break;
      case 'ToughnessSaved':
        add({ icon: '🛡', parts: [unit(ref(state, e.unitId)), ' shrugs off the blow (Tough)'], category: 'combat', unitIds: [e.unitId] });
        break;
      case 'UnitKnockedDown':
        add({ icon: '↓', parts: [unit(ref(state, e.unitId)), ' is knocked down'], category: 'combat', unitIds: [e.unitId] });
        break;
      case 'UnitRecoiled':
        add({ icon: '↩', parts: [unit(ref(state, e.unitId)), ' is pushed back'], category: 'combat', unitIds: [e.unitId] });
        break;
      case 'UnitSupported':
        add({
          icon: '⛨',
          parts: [unit(ref(state, e.unitId)), ' holds, braced by ', unit(ref(state, e.supporterId))],
          category: 'combat',
          unitIds: [e.unitId, e.supporterId],
        });
        break;
      case 'UnitPushedOff':
        add({ icon: '↩', parts: [unit(ref(state, e.unitId)), ' is pushed off the edge'], category: 'combat', unitIds: [e.unitId] });
        break;
      case 'UnitPushedIntoLava':
        add({ icon: '🔥', parts: [unit(ref(state, e.unitId)), ' is pushed into the lava'], category: 'combat', unitIds: [e.unitId] });
        break;
      case 'UnitFellIntoLava':
        add({ icon: '🔥', parts: [unit(ref(state, e.unitId)), ' falls into the lava'], category: 'combat', unitIds: [e.unitId] });
        break;
      case 'UnitKilled':
        add({
          icon: '💀',
          parts: [unit(ref(state, e.unitId)), ' is killed'],
          brief: ['💀 ', unit(ref(state, e.unitId))],
          tone: 'danger',
          category: 'combat',
          unitIds: [e.unitId],
        });
        break;
      case 'RoundEnded': {
        const g = current();
        if (g) g.open = false;
        log.rounds.push({ round: e.round, leader: e.nextLeader, groups: [] });
        break;
      }
      case 'ScoreChanged': {
        const what =
          e.zone !== undefined ? `zone ${zoneLetter(e.zone)}` : state.mode?.mode === 'king-of-the-hill' ? 'the hill' : null;
        add({
          icon: '★',
          parts: [
            { player: e.player },
            ` scores ${e.points}${what ? ` for holding ${what}` : ''} `,
            { em: `${e.scores[0]}–${e.scores[1]}`, cls: 'score' },
          ],
          brief: [`★ +${e.points}`],
          tone: 'objective',
          category: 'objective',
          unitIds: [],
        });
        break;
      }
      case 'FlagPickedUp':
        add({
          icon: '⚑',
          parts: [unit(ref(state, e.unitId)), ' seizes ', { player: e.player }, "'s flag"],
          brief: ['⚑ seized'],
          tone: 'objective',
          category: 'objective',
          unitIds: [e.unitId],
        });
        break;
      case 'FlagDropped':
        add({
          icon: '⚑',
          parts: [unit(ref(state, e.unitId)), ' drops ', { player: e.player }, "'s flag"],
          brief: ['⚑ dropped'],
          tone: 'objective',
          category: 'objective',
          unitIds: [e.unitId],
        });
        break;
      case 'FlagReturned':
        add({
          icon: '⚑',
          parts: [unit(ref(state, e.unitId)), ' returns ', { player: e.player }, "'s flag to base"],
          brief: ['⚑ returned'],
          tone: 'objective',
          category: 'objective',
          unitIds: [e.unitId],
        });
        break;
      case 'FlagCaptured':
        add({
          icon: '⚑',
          parts: [unit(ref(state, e.unitId)), ' carries the flag home — ', { player: e.player }, ' captures it!'],
          brief: ['⚑ captured'],
          tone: 'objective',
          category: 'objective',
          unitIds: [e.unitId],
        });
        break;
      case 'GameOver': {
        const g = current();
        if (g) g.open = false;
        add({
          icon: '🏆',
          parts: [
            'Game over — ',
            { player: e.winner },
            ' wins',
            ...(e.reason ? [` (${GAME_OVER_REASONS[e.reason]})`] : []),
          ],
          tone: 'end',
          category: 'objective',
          unitIds: [],
        });
        break;
      }
    }
  }
  closeFight();

  // Keep the log bounded, dropping the oldest rounds whole (never the current one).
  let count = log.rounds.reduce((n, r) => n + r.groups.length, 0);
  while (count > MAX_GROUPS && log.rounds.length > 1) count -= log.rounds.shift()!.groups.length;
  return log;
}

/** The whole log a list of transitions produces (a replay up to some step). */
export function buildLog(initialRound: number, steps: readonly { state: GameState; events: readonly GameEvent[] }[]): BattleLog {
  return steps.reduce((log, s) => appendEvents(log, s.state, s.events), emptyLog(initialRound));
}
