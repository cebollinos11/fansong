import type { GameMode } from '@fansong/engine';
import {
  applyAdvance,
  canAdvance,
  defaultKing,
  fieldedUnits,
  isBossRound,
  isWounded,
  missionSkulls,
  rewardNeedsUnit,
  RIVAL_FACTION,
  playerWarband,
  recruitPrice,
  rerollPrice,
  rosterCost,
  runActionError,
  RUN_TUNING,
  runVictorious,
  sellPrice,
  unitCost,
  upgradePrice,
  type Advance,
  type AftermathLine,
  type MapDef,
  type RewardOption,
  type RunAction,
  type RunMission,
  type RunState,
  type RunUnit,
  type WarbandUnit,
  type Wound,
} from '@fansong/content';
import type { RunRecord } from '../game/runStore.js';
import { TRAIT_INFO, traitsOf, type TraitKey } from './armyView.js';
import { MODE_LABELS } from './editorView.js';
import { ANNIHILATION_GOAL, GOALS } from './modeView.js';

/**
 * The run screens' view-model, kept apart from React so it can be tested
 * directly. It holds no rules: what a run allows comes from `runActionError`,
 * and every button the screens draw is a {@link Choice} made here.
 */

/** A button: the action it takes, and why it can't be taken now (`null` if it can). */
export interface Choice {
  action: RunAction;
  error: string | null;
}

function choice(s: RunState, action: RunAction): Choice {
  return { action, error: runActionError(s, action) };
}

/** How long after a step the run's buttons ignore clicks (ms): a double click's second click falls inside it. */
export const REPEAT_GUARD_MS = 400;

/**
 * A gate for the run's buttons: called with the time of a click, it says
 * whether the click counts, which it doesn't within `ms` of the last that did.
 */
export function repeatGuard(ms: number = REPEAT_GUARD_MS): (now: number) => boolean {
  let last = -Infinity;
  return (now) => {
    if (now - last < ms) return false;
    last = now;
    return true;
  };
}

/** A name and a line on what it does, for a chip or an option. */
export interface Info {
  label: string;
  help: string;
}

/** What an advance is called. */
export function advanceInfo(advance: Advance): Info {
  if (advance.kind === 'combat') return { label: 'Combat +1', help: 'one more added to the d6 in every fight' };
  if (advance.kind === 'quality') return { label: 'Quality −1', help: 'its activation dice succeed on one pip less' };
  return { label: TRAIT_INFO[advance.trait].label, help: TRAIT_INFO[advance.trait].desc };
}

/** What `advance` would do to `unit`, in numbers: "Combat 3 → 4", "Quality 4+ → 3+", or the trait gained. */
export function advanceChange(unit: WarbandUnit, advance: Advance): string {
  const after = applyAdvance(unit, advance);
  if (advance.kind === 'combat') return `Combat ${unit.combat} → ${after.combat}`;
  if (advance.kind === 'quality') return `Quality ${unit.quality}+ → ${after.quality}+`;
  return `Gains ${TRAIT_INFO[advance.trait].label}`;
}

/** What a lasting wound is called. */
export function woundInfo(wound: Wound): Info {
  if (wound.kind === 'combat') return { label: 'Combat −1', help: 'a lasting wound: one less added to the d6 in every fight' };
  if (wound.kind === 'quality') return { label: 'Quality +1', help: 'a lasting wound: its activation dice need one pip more' };
  return { label: TRAIT_INFO[wound.trait].label, help: `a lasting wound: ${TRAIT_INFO[wound.trait].desc}` };
}

/** A roster unit as its card shows it. */
export interface UnitView {
  id: string;
  unit: WarbandUnit;
  cost: number;
  level: number;
  maxLevel: number;
  xp: number;
  /** Total XP its next level takes, or `null` at the cap. */
  nextXp: number | null;
  kills: number;
  traits: TraitKey[];
  /** The lasting wounds it carries, oldest first. */
  wounds: Info[];
  sitsOut: boolean;
  benched: boolean;
}

export function unitView(u: RunUnit): UnitView {
  const levels = RUN_TUNING.xp.levels;
  return {
    id: u.id,
    unit: u.unit,
    cost: unitCost(u.unit),
    level: u.level,
    maxLevel: levels.length,
    xp: u.xp,
    nextXp: levels[u.level] ?? null,
    kills: u.kills,
    traits: traitsOf(u.unit),
    wounds: (u.wounds ?? []).map(woundInfo),
    sitsOut: !!u.sitsOut,
    benched: !!u.benched,
  };
}

/** A unit's level and XP in a line: "Level 2 · 9/12 XP", or "Level 4 · 21 XP" at the cap. */
export function levelLine(v: UnitView): string {
  return v.nextXp === null ? `Level ${v.level} · ${v.xp} XP` : `Level ${v.level} · ${v.xp}/${v.nextXp} XP`;
}

/** The strip along the top of every run screen. */
export interface RunHeader {
  title: string;
  round: number;
  gold: number;
  seed: number;
  boss: boolean;
  /** The roster's size, cap and points, e.g. "5/12 units · 118 pts". */
  roster: string;
  /** Retreat banners in hand. */
  banners: number;
  /** Whether the run has beaten its victory round: from there it only goes on. */
  victorious: boolean;
}

/** What a retreat banner is, for the header's tooltip. */
export const BANNER_HELP = `A retreat banner lets your Leader sound the retreat in a battle: the banner is spent on the call, and if the battle is then lost the run goes on, the round fought again against someone new. Each boss beaten adds one, up to ${RUN_TUNING.banners.max}`;

/** The briefing's word on the way out of the battle ahead, by the banners in hand. */
export function retreatNote(banners: number): string {
  return banners > 0
    ? `${banners} retreat ${banners === 1 ? 'banner' : 'banners'} in hand: if the battle turns, your Leader can sound the retreat (one action), which spends it. Units that reach the flag leave unhurt, and if the battle is lost the round is fought again.`
    : 'No retreat banner left: lose this battle and the run is over.';
}

const TITLES: Record<RunState['phase'], string> = {
  draft: 'Draft your warband',
  mission: 'Choose your battle',
  briefing: 'Briefing',
  battle: 'Battle',
  aftermath: 'Victory',
  reward: 'Spoils',
  shop: 'Camp',
  over: 'The run is over',
};

/**
 * Whether the run has only just been won: the battle of its victory round is
 * the last one in its history, and the next round hasn't begun.
 */
function justWon(s: RunState): boolean {
  const last = s.log.at(-1);
  return s.phase !== 'over' && !!last?.won && last.round === s.round && last.round === RUN_TUNING.victoryRound;
}

export function runHeader(s: RunState): RunHeader {
  const boss = (s.phase === 'mission' || s.phase === 'briefing' || s.phase === 'battle') && isBossRound(s.round);
  return {
    title: boss
      ? 'Boss battle'
      : s.phase === 'aftermath' && s.aftermath?.retreated
        ? 'Retreat'
        : s.phase === 'aftermath' && justWon(s)
          ? 'The run is won'
          : TITLES[s.phase],
    round: s.round,
    gold: s.gold,
    seed: s.seed,
    boss,
    roster: `${s.roster.length}/${RUN_TUNING.rosterCap} units · ${rosterCost(s)} pts`,
    banners: s.banners,
    victorious: runVictorious(s),
  };
}

/** A unit on offer: a draft pick, a recruit. */
export interface OfferView {
  unit: WarbandUnit;
  cost: number;
  traits: TraitKey[];
}

function offerView(unit: WarbandUnit): OfferView {
  return { unit, cost: unitCost(unit), traits: traitsOf(unit) };
}

export interface DraftView {
  stage: 'leader' | 'troop';
  prompt: string;
  /** Points of the draft budget still to spend. */
  left: number;
  budget: number;
  offers: (OfferView & { pick: Choice })[];
}

export function draftView(s: RunState): DraftView | null {
  if (s.phase !== 'draft' || s.offer?.kind !== 'draft') return null;
  const { budget } = RUN_TUNING.draft;
  return {
    stage: s.offer.stage,
    prompt: s.offer.stage === 'leader' ? 'Choose who leads' : 'Choose who joins',
    left: budget - rosterCost(s),
    budget,
    offers: s.offer.units.map((unit, index) => ({ ...offerView(unit), pick: choice(s, { type: 'draftPick', index }) })),
  };
}

/** How each mode a run can roll is won, for the briefing. */
const MODE_GOALS: Partial<Record<GameMode, string>> = {
  annihilation: ANNIHILATION_GOAL,
  'kill-the-king': `${GOALS['kill-the-king']} before yours falls`,
  'king-of-the-hill': 'Hold the hill when a round ends to score; the first to the target wins',
  conquest: 'Hold the three zones when a round ends to score; the first to the target wins',
};

/**
 * The battlefield as the briefing draws it. A run's map is laid out for every
 * mode, so the picture keeps only what this battle is fought over.
 */
function battlefield(map: MapDef, mode: GameMode): MapDef {
  const { hill, conquest } = map.objectives;
  if (mode === 'king-of-the-hill' && hill) return { ...map, objectives: { hill } };
  if (mode === 'conquest' && conquest) return { ...map, objectives: { conquest } };
  return { ...map, objectives: {} };
}

/** One thing a mission pays, as its card lists it. */
export interface RewardLine {
  title: string;
  detail: string;
  /** A recruit: the unit that joins. */
  recruit?: OfferView;
}

export function rewardLine(option: RewardOption): RewardLine {
  switch (option.kind) {
    case 'gold':
      return { title: `${option.amount} gold`, detail: 'A purse to spend in camp' };
    case 'recruit':
      return { title: option.unit.name, detail: 'Joins your warband', recruit: offerView(option.unit) };
    case 'mend':
      return { title: 'A healer', detail: "Mends one unit's oldest lasting wound" };
    case 'boost': {
      const info = advanceInfo(option.advance);
      return { title: info.label, detail: `For one unit of your choice: ${info.help}` };
    }
  }
}

/**
 * An enemy warband as it is shown before the battle: only the shapes of its
 * units, blacked out, and how dangerous it is. Who they are is learnt on the field.
 */
export interface EnemyShadow {
  /** A unit each, in the warband's order, to draw as silhouettes. */
  units: { look: string; king: boolean }[];
  count: number;
  /** How hard the battle is, out of `maxSkulls`. */
  skulls: number;
  maxSkulls: number;
  /** A word for that: "Light", "Deadly", or "Boss". */
  threat: string;
  /** Whether it is the warband a past run ended with. */
  rival: boolean;
}

function enemyShadow(m: Pick<RunMission, 'enemy' | 'enemyKing' | 'threat' | 'faction'>): EnemyShadow {
  const maxSkulls = RUN_TUNING.mission.skulls;
  // A boss is the round's whole budget and a champion: every skull, whatever its threat says.
  const boss = m.enemyKing !== undefined;
  const skulls = boss ? maxSkulls : missionSkulls(m.threat);
  return {
    units: m.enemy.units.map((u, i) => ({ look: u.look ?? u.name, king: i === m.enemyKing })),
    count: m.enemy.units.length,
    skulls,
    maxSkulls,
    threat: boss ? 'Boss' : threatLabel(skulls, maxSkulls),
    rival: m.faction === RIVAL_FACTION,
  };
}

/** What a difficulty in skulls is called. */
export function threatLabel(skulls: number, maxSkulls: number = RUN_TUNING.mission.skulls): string {
  const names = ['Easy pickings', 'Light', 'An even fight', 'Hard', 'Deadly'];
  return names[Math.round(((skulls - 1) / Math.max(1, maxSkulls - 1)) * (names.length - 1))]!;
}

export interface MissionsView {
  mode: string;
  goal: string;
  boss: boolean;
  /** The battlefield every mission of the round is fought on, with this mode's objectives only. */
  map: MapDef;
  lava: boolean;
  missions: { enemy: EnemyShadow; rewards: RewardLine[]; pick: Choice }[];
}

export function missionsView(s: RunState): MissionsView | null {
  if (s.phase !== 'mission' || s.offer?.kind !== 'missions') return null;
  const { mode, map, missions } = s.offer;
  return {
    mode: MODE_LABELS[mode],
    goal: MODE_GOALS[mode] ?? ANNIHILATION_GOAL,
    boss: isBossRound(s.round),
    map: battlefield(map, mode),
    lava: map.hexes.some((hex) => hex.feature === 'lava'),
    missions: missions.map((m, index) => ({ enemy: enemyShadow(m), rewards: m.rewards.map(rewardLine), pick: choice(s, { type: 'pickMission', index }) })),
  };
}

export interface BriefingUnit {
  view: UnitView;
  /** Whether it fights this battle. */
  fielded: boolean;
  /** Bench it or put it back; `null` for a unit sitting this battle out hurt. */
  bench: Choice | null;
  /** Boss rounds: whether it is the King. */
  king: boolean;
  /** Boss rounds: crown it instead; `null` for the King itself and for units not fighting. */
  crown: Choice | null;
}

export interface BriefingView {
  mode: string;
  goal: string;
  boss: boolean;
  /** The enemy, still only shapes: it is met on the field. */
  enemy: EnemyShadow;
  /** What winning pays. */
  rewards: RewardLine[];
  /** The battlefield, with this mode's objectives only. */
  map: MapDef;
  /** Whether the battlefield has lava on it. */
  lava: boolean;
  units: BriefingUnit[];
  /** "5 units · 118 pts take the field". */
  fielded: string;
  /** Whether this battle can be retreated from, and what that costs (see {@link retreatNote}). */
  retreat: { banners: number; note: string };
  start: Choice;
}

export function briefingView(s: RunState): BriefingView | null {
  const battle = s.battle;
  if (s.phase !== 'briefing' || !battle) return null;
  const boss = battle.mode === 'kill-the-king';
  const fielded = fieldedUnits(s);
  const warband = playerWarband(s);
  const kingId = boss ? (fielded.find((u) => u.id === battle.playerKing) ?? fielded[defaultKing(warband.units)])?.id : undefined;
  return {
    mode: MODE_LABELS[battle.mode],
    goal: MODE_GOALS[battle.mode] ?? ANNIHILATION_GOAL,
    boss,
    enemy: enemyShadow(battle),
    rewards: battle.rewards.map(rewardLine),
    map: battlefield(battle.map, battle.mode),
    lava: battle.map.hexes.some((hex) => hex.feature === 'lava'),
    units: s.roster.map((u) => {
      const fights = fielded.includes(u);
      return {
        view: unitView(u),
        fielded: fights,
        bench: u.sitsOut ? null : choice(s, { type: 'bench', unitId: u.id, benched: !u.benched }),
        king: u.id === kingId,
        crown: boss && fights && u.id !== kingId ? choice(s, { type: 'setKing', unitId: u.id }) : null,
      };
    }),
    fielded: `${fielded.length} ${fielded.length === 1 ? 'unit' : 'units'} · ${warband.units.reduce((sum, u) => sum + unitCost(u), 0)} pts take the field`,
    retreat: { banners: s.banners, note: retreatNote(s.banners) },
    start: choice(s, { type: 'startBattle' }),
  };
}

/** How a fielded unit came out of the battle, in words, and how bad it is. */
export function fateText(line: AftermathLine): { text: string; tone: 'ok' | 'hurt' | 'lost' } {
  if (line.fate === 'turned') return { text: 'Changed sides, and is gone', tone: 'lost' };
  if (line.fate === 'fled') return { text: 'Fled the field, and came back unhurt', tone: 'ok' };
  if (line.fate === 'survived') return { text: 'Came through standing', tone: 'ok' };
  if (line.fate === 'retreated') return { text: 'Reached the flag, and left unhurt', tone: 'ok' };
  if (line.fate === 'leftBehind') {
    switch (line.injury) {
      case 'dead':
        return { text: 'Left behind, and never came back', tone: 'lost' };
      case 'wound':
        return { text: `Left behind, and came back with a lasting wound${line.wound ? `: ${woundInfo(line.wound).label}` : ''}`, tone: 'hurt' };
      case 'sitsOut':
        return { text: 'Left behind, and came back hurt: sits out the next battle', tone: 'hurt' };
      default:
        return { text: 'Left behind, but slipped away unhurt', tone: 'ok' };
    }
  }
  switch (line.injury) {
    case 'dead':
      return { text: 'Fell, and died of its wounds', tone: 'lost' };
    case 'wound':
      return { text: `Fell, and carries a lasting wound${line.wound ? `: ${woundInfo(line.wound).label}` : ''}`, tone: 'hurt' };
    case 'sitsOut':
      return { text: 'Fell, and sits out the next battle', tone: 'hurt' };
    default:
      return { text: 'Fell, but recovered', tone: 'ok' };
  }
}

/** One face of the injury die: what that roll does to a fallen unit. */
export interface InjuryFace {
  die: number;
  label: string;
  tone: 'ok' | 'hurt' | 'lost';
}

/**
 * The six faces of the injury die, from {@link RUN_TUNING}'s odds: a fallen
 * unit's, or the harsher ones of a unit `leftBehind` in a retreat.
 */
export function injuryFaces(leftBehind = false): InjuryFace[] {
  const { dead, wound, sitsOut } = leftBehind ? RUN_TUNING.leftBehind : RUN_TUNING.injury;
  return [1, 2, 3, 4, 5, 6].map((die) =>
    die <= dead
      ? { die, label: 'Dies', tone: 'lost' }
      : die <= wound
        ? { die, label: 'Lasting wound', tone: 'hurt' }
        : die <= sitsOut
          ? { die, label: 'Sits out', tone: 'hurt' }
          : { die, label: 'Recovers', tone: 'ok' },
  );
}

/** A fallen unit's turn in the tending of the wounded: who, the die it rolled and what came of it. */
export interface InjuryCheck {
  unitId: string;
  name: string;
  look: string;
  tint?: string;
  die: number;
  /** Left behind in a retreat rather than fallen: its die is read on the harsher table. */
  leftBehind: boolean;
  /** Big word stamped on the card once the die lands. */
  verdict: string;
  /** What it means, under the verdict. */
  detail: string;
  tone: 'ok' | 'hurt' | 'lost';
}

/**
 * The units whose fate a die decides after the battle just fought, in the order
 * the dice are thrown: those that fell, and after a retreat those left behind.
 */
export function injuryChecks(s: RunState): InjuryCheck[] {
  if (s.phase !== 'aftermath' || !s.aftermath) return [];
  const checks: InjuryCheck[] = [];
  for (const line of s.aftermath.units) {
    if ((line.fate !== 'fell' && line.fate !== 'leftBehind') || line.die === undefined) continue;
    const leftBehind = line.fate === 'leftBehind';
    const base = { unitId: line.unitId, name: line.name, look: line.look ?? line.name, tint: line.tint, die: line.die, leftBehind };
    switch (line.injury) {
      case 'dead':
        checks.push({
          ...base,
          verdict: 'Dead',
          detail: leftBehind ? 'It was cut down as the field was lost. It is gone for good.' : 'Its wounds were too deep. It is gone for good.',
          tone: 'lost',
        });
        break;
      case 'wound': {
        const w = line.wound ? woundInfo(line.wound) : null;
        checks.push({ ...base, verdict: w ? `Wounded: ${w.label}` : 'Wounded', detail: w ? `It carries ${w.help}.` : 'It carries a lasting wound.', tone: 'hurt' });
        break;
      }
      case 'sitsOut':
        checks.push({ ...base, verdict: 'Sits out', detail: 'It needs rest, and misses the next battle.', tone: 'hurt' });
        break;
      default:
        checks.push({
          ...base,
          verdict: leftBehind ? 'Gets away' : 'Recovers',
          detail: leftBehind ? 'It slipped off the field after the others, unhurt.' : 'Patched up and fit to fight.',
          tone: 'ok',
        });
    }
  }
  return checks;
}

/** Names of the fielded units no die is thrown for: those that came through standing, fled and came back, or left by the retreat flag. */
export function standingUnits(s: RunState): { name: string; look: string; tint?: string }[] {
  if (!s.aftermath) return [];
  return s.aftermath.units
    .filter((l) => l.fate === 'survived' || l.fate === 'fled' || l.fate === 'retreated')
    .map((l) => ({ name: l.name, look: l.look ?? l.name, tint: l.tint }));
}

/** Why `name` can't be `unitId`'s new name, or `null` if it can. */
export function renameError(s: RunState, unitId: string, name: string): string | null {
  return runActionError(s, { type: 'rename', unitId, name });
}

export interface AftermathView {
  /**
   * Set after a battle the player retreated from: nothing was earned, and the
   * round comes round again. `left` are the banners still in hand.
   */
  retreat: { round: number; left: number } | null;
  /** Only after the battle that wins the run: what to say about it. */
  triumph: { headline: string; detail: string } | null;
  gold: number;
  lines: { unitId: string; name: string; kills: number; xp: number; text: string; tone: 'ok' | 'hurt' | 'lost' }[];
  /** What the mission pays, claimed next. */
  rewards: RewardLine[];
  /** Levels waiting to be spent: one choice of advances per unit at a time. */
  levelUps: { view: UnitView; options: { info: Info; change: string; take: Choice }[] }[];
  next: Choice;
}

export function aftermathView(s: RunState): AftermathView | null {
  if (s.phase !== 'aftermath' || !s.aftermath) return null;
  const levelUps: AftermathView['levelUps'] = [];
  for (const p of s.pending ?? []) {
    const u = s.roster.find((x) => x.id === p.unitId);
    if (!u) continue;
    levelUps.push({
      view: unitView(u),
      options: p.choices.map((advance, index) => ({
        info: advanceInfo(advance),
        change: advanceChange(u.unit, advance),
        take: choice(s, { type: 'advance', unitId: u.id, index }),
      })),
    });
  }
  return {
    retreat: s.aftermath.retreated ? { round: s.round, left: s.banners } : null,
    triumph: justWon(s)
      ? {
          headline: `Round ${RUN_TUNING.victoryRound} is beaten: the run is won`,
          detail: 'From here it goes on for as long as the warband lasts, against an enemy that keeps growing.',
        }
      : null,
    gold: s.aftermath.gold,
    rewards: s.offer?.kind === 'reward' ? s.offer.rewards.map(rewardLine) : [],
    lines: s.aftermath.units.map((line) => ({ unitId: line.unitId, name: line.name, kills: line.kills, xp: line.xp, ...fateText(line) })),
    levelUps,
    next: choice(s, { type: 'continue' }),
  };
}

/** A unit a reward or an upgrade can go to. */
export interface Target {
  unitId: string;
  unit: WarbandUnit;
  /** What it would do to this unit, e.g. "Combat 3 → 4". */
  change: string;
  /** Shop upgrades: what it costs this unit. */
  price?: number;
  give: Choice;
}

export interface RewardView {
  /** Everything the mission pays. */
  rewards: RewardLine[];
  /** Pay that goes to nobody in particular: take it as it is. */
  take?: Choice;
  /** Pay with a part for one unit: every unit that can have it. */
  targets?: Target[];
}

export function rewardView(s: RunState): RewardView | null {
  if (s.phase !== 'reward' || s.offer?.kind !== 'reward') return null;
  const { rewards } = s.offer;
  const lines = rewards.map(rewardLine);
  const given = rewards.find(rewardNeedsUnit);
  if (!given) return { rewards: lines, take: choice(s, { type: 'reward' }) };
  const change = (u: RunUnit): string =>
    given.kind === 'boost' ? advanceChange(u.unit, given.advance) : u.wounds?.[0] ? `Mends ${woundInfo(u.wounds[0]).label}` : '';
  return {
    rewards: lines,
    targets: s.roster
      .map((u) => ({ unitId: u.id, unit: u.unit, change: change(u), give: choice(s, { type: 'reward', unitId: u.id }) }))
      .filter((t) => t.give.error === null),
  };
}

export interface ShopView {
  gold: number;
  /** Recruits on the shelf; `null` where one was bought. */
  recruits: ((OfferView & { price: number; buy: Choice }) | null)[];
  /** Upgrades on the shelf, each with the units that can take it and what it costs them. */
  upgrades: ({ info: Info; targets: Target[] } | null)[];
  reroll: { price: number; buy: Choice };
  healPrice: number;
  units: {
    view: UnitView;
    sell: { price: number; sell: Choice };
    /** Only for a unit with a lasting wound. */
    heal: Choice | null;
  }[];
  /** Whether the roster has room for a recruit. */
  full: boolean;
  leave: Choice;
}

export function shopView(s: RunState): ShopView | null {
  if (s.phase !== 'shop' || s.offer?.kind !== 'shop') return null;
  const shop = s.offer;
  return {
    gold: s.gold,
    recruits: shop.recruits.map((unit, index) =>
      unit ? { ...offerView(unit), price: recruitPrice(unit), buy: choice(s, { type: 'buyRecruit', index }) } : null,
    ),
    upgrades: shop.upgrades.map((advance, index) =>
      advance
        ? {
            info: advanceInfo(advance),
            targets: s.roster
              .filter((u) => canAdvance(u.unit, advance))
              .map((u) => ({
                unitId: u.id,
                unit: u.unit,
                change: advanceChange(u.unit, advance),
                price: upgradePrice(u.unit, advance),
                give: choice(s, { type: 'buyUpgrade', index, unitId: u.id }),
              })),
          }
        : null,
    ),
    reroll: { price: rerollPrice(shop.rerolls), buy: choice(s, { type: 'reroll' }) },
    healPrice: RUN_TUNING.shop.heal,
    units: s.roster.map((u) => ({
      view: unitView(u),
      sell: { price: sellPrice(u.unit), sell: choice(s, { type: 'sell', unitId: u.id }) },
      heal: isWounded(u) ? choice(s, { type: 'heal', unitId: u.id }) : null,
    })),
    full: s.roster.length >= RUN_TUNING.rosterCap,
    leave: choice(s, { type: 'leaveShop' }),
  };
}

/** The run's history, a line a round, newest last. */
export function historyLines(s: RunState): { round: number; won: boolean; text: string }[] {
  return s.log.map((r) => ({
    round: r.round,
    won: r.won,
    text: `${r.boss ? 'Boss · ' : ''}${MODE_LABELS[r.mode]} against ${r.enemy}: ${
      r.won
        ? `won, ${r.kills} ${r.kills === 1 ? 'kill' : 'kills'}${r.losses > 0 ? `, ${r.losses} lost` : ''}, ${r.gold} gold`
        : r.retreated
          ? `retreated${r.losses > 0 ? `, ${r.losses} lost` : ''}`
          : 'lost'
    }`,
  }));
}

export interface OverView {
  headline: string;
  /** "3 battles won · 14 kills · seed 42". */
  summary: string;
  victorious: boolean;
}

export function overView(s: RunState): OverView {
  const wins = s.log.filter((r) => r.won).length;
  const kills = s.log.reduce((sum, r) => sum + r.kills, 0);
  const victorious = runVictorious(s);
  const retreats = s.log.filter((r) => r.retreated).length;
  // A retreat that nobody came back from ends the run as surely as a lost battle.
  const nobodyLeft = s.log.at(-1)?.retreated === true;
  return {
    headline: victorious
      ? `A victorious run, ended in round ${s.round}`
      : nobodyLeft
        ? `Nobody came back from the retreat in round ${s.round}`
        : `Your warband fell in round ${s.round}`,
    summary: `${wins} ${wins === 1 ? 'battle' : 'battles'} won${retreats > 0 ? ` · ${retreats} ${retreats === 1 ? 'retreat' : 'retreats'}` : ''} · ${kills} ${kills === 1 ? 'kill' : 'kills'} · seed ${s.seed}`,
    victorious,
  };
}

/** A remembered run in a line: "6 battles won · fell in round 7 · seed 42". */
export function recordLine(r: RunRecord): string {
  const how = r.end === 'lost' ? `fell in round ${r.round}` : `given up in round ${r.round}`;
  const retreats = r.retreats ? ` · ${r.retreats} ${r.retreats === 1 ? 'retreat' : 'retreats'}` : '';
  return `${r.wins} ${r.wins === 1 ? 'battle' : 'battles'} won${retreats} · ${how} · seed ${r.seed}`;
}

/** The menu's run button: a new run, or the one to pick back up. */
export function runMenuItem(saved: RunState | null): { title: string; detail: string } {
  return saved
    ? { title: 'Continue run', detail: `Round ${saved.round} · seed ${saved.seed}${runVictorious(saved) ? ' · ♛ won' : ''}` }
    : { title: 'Run', detail: 'Draft a warband, fight until it falls' };
}

/** The warning on the way out of a run's battle: the run is kept, the battle is not. */
export const RUN_LEAVE_DETAIL = 'Your run is saved, but not this battle: it starts over from its first move when you come back.';

/**
 * The seed a new run starts from: the one typed, or `fallback` for an empty
 * box. `null` if what was typed is no whole number.
 */
export function runSeedFrom(text: string, fallback: number): number | null {
  if (text.trim() === '') return fallback;
  const n = Number(text.trim());
  return Number.isSafeInteger(n) && n >= 0 && n < 2 ** 31 ? n : null;
}

/** A seed for a run started without one: short enough to read out and type back in. */
export function freshRunSeed(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * 999_999);
}
