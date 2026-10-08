import type { GameMode } from '@fansong/engine';
import {
  applyAdvance,
  canAdvance,
  defaultKing,
  enemyCost,
  fieldedUnits,
  isBossRound,
  isWounded,
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
  type RunAction,
  type RunState,
  type RunUnit,
  type WarbandUnit,
  type Wound,
} from '@fansong/content';
import type { RunRecord } from '../game/runStore.js';
import { TRAIT_INFO, traitsOf, type TraitKey } from './armyView.js';
import { MODE_LABELS } from './editorView.js';
import { ANNIHILATION_GOAL, GOALS } from './modeView.js';
import { unitKinds } from './unitKinds.js';

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
}

const TITLES: Record<RunState['phase'], string> = {
  draft: 'Draft your warband',
  briefing: 'Briefing',
  battle: 'Battle',
  aftermath: 'Victory',
  reward: 'Spoils',
  shop: 'Camp',
  over: 'The run is over',
};

export function runHeader(s: RunState): RunHeader {
  const boss = (s.phase === 'briefing' || s.phase === 'battle') && isBossRound(s.round);
  return {
    title: boss ? 'Boss battle' : TITLES[s.phase],
    round: s.round,
    gold: s.gold,
    seed: s.seed,
    boss,
    roster: `${s.roster.length}/${RUN_TUNING.rosterCap} units · ${rosterCost(s)} pts`,
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
  'kill-the-king': GOALS['kill-the-king'],
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
  enemy: {
    name: string;
    points: number;
    count: number;
    /** Its units folded into kinds, as the setup screens show a warband. */
    kinds: { unit: WarbandUnit; count: number; traits: TraitKey[] }[];
    /** Boss rounds: the enemy King. */
    king?: WarbandUnit;
  };
  /** The battlefield, with this mode's objectives only. */
  map: MapDef;
  units: BriefingUnit[];
  /** "5 units · 118 pts take the field". */
  fielded: string;
  start: Choice;
}

export function briefingView(s: RunState): BriefingView | null {
  const battle = s.battle;
  if (s.phase !== 'briefing' || !battle) return null;
  const boss = battle.mode === 'kill-the-king';
  const fielded = fieldedUnits(s);
  const warband = playerWarband(s);
  const kingId = boss ? (fielded.find((u) => u.id === battle.playerKing) ?? fielded[defaultKing(warband.units)])?.id : undefined;
  const king = battle.enemyKing === undefined ? undefined : battle.enemy.units[battle.enemyKing];
  return {
    mode: MODE_LABELS[battle.mode],
    goal: MODE_GOALS[battle.mode] ?? ANNIHILATION_GOAL,
    boss,
    enemy: {
      name: battle.enemy.name,
      points: enemyCost(battle),
      count: battle.enemy.units.length,
      kinds: unitKinds(battle.enemy.units).map((k) => ({ ...k, traits: traitsOf(k.unit) })),
      ...(king ? { king } : {}),
    },
    map: battlefield(battle.map, battle.mode),
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
    start: choice(s, { type: 'startBattle' }),
  };
}

/** How a fielded unit came out of the battle, in words, and how bad it is. */
export function fateText(line: AftermathLine): { text: string; tone: 'ok' | 'hurt' | 'lost' } {
  if (line.fate === 'turned') return { text: 'Changed sides, and is gone', tone: 'lost' };
  if (line.fate === 'fled') return { text: 'Fled the field, and came back unhurt', tone: 'ok' };
  if (line.fate === 'survived') return { text: 'Came through standing', tone: 'ok' };
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

export interface AftermathView {
  gold: number;
  lines: { unitId: string; name: string; kills: number; xp: number; text: string; tone: 'ok' | 'hurt' | 'lost' }[];
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
    gold: s.aftermath.gold,
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

export interface RewardOptionView {
  title: string;
  detail: string;
  /** A recruit on offer. */
  recruit?: OfferView;
  /** Taken as it is: a purse, a recruit. */
  take?: Choice;
  /** Given to a unit: every unit that can have it. */
  targets?: Target[];
}

export function rewardView(s: RunState): RewardOptionView[] | null {
  if (s.phase !== 'reward' || s.offer?.kind !== 'reward') return null;
  return s.offer.options.map((option, index): RewardOptionView => {
    const giveTo = (change: (u: RunUnit) => string): Target[] =>
      s.roster
        .map((u) => ({ unitId: u.id, unit: u.unit, change: change(u), give: choice(s, { type: 'reward', index, unitId: u.id }) }))
        .filter((t) => t.give.error === null);
    switch (option.kind) {
      case 'gold':
        return { title: `${option.amount} gold`, detail: 'A purse to spend in camp', take: choice(s, { type: 'reward', index }) };
      case 'recruit':
        return { title: option.unit.name, detail: 'Joins your warband', recruit: offerView(option.unit), take: choice(s, { type: 'reward', index }) };
      case 'mend':
        return {
          title: 'A healer',
          detail: "Mends one unit's oldest lasting wound",
          targets: giveTo((u) => (u.wounds?.[0] ? `Mends ${woundInfo(u.wounds[0]).label}` : '')),
        };
      case 'boost': {
        const info = advanceInfo(option.advance);
        return { title: info.label, detail: `For one unit: ${info.help}`, targets: giveTo((u) => advanceChange(u.unit, option.advance)) };
      }
    }
  });
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
      r.won ? `won, ${r.kills} ${r.kills === 1 ? 'kill' : 'kills'}${r.losses > 0 ? `, ${r.losses} lost` : ''}, ${r.gold} gold` : 'lost'
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
  return {
    headline: victorious ? `A victorious run, ended in round ${s.round}` : `Your warband fell in round ${s.round}`,
    summary: `${wins} ${wins === 1 ? 'battle' : 'battles'} won · ${kills} ${kills === 1 ? 'kill' : 'kills'} · seed ${s.seed}`,
    victorious,
  };
}

/** A remembered run in a line: "6 battles won · fell in round 7 · seed 42". */
export function recordLine(r: RunRecord): string {
  const how = r.end === 'lost' ? `fell in round ${r.round}` : `given up in round ${r.round}`;
  return `${r.wins} ${r.wins === 1 ? 'battle' : 'battles'} won · ${how} · seed ${r.seed}`;
}

/** The menu's run button: a new run, or the one to pick back up. */
export function runMenuItem(saved: RunState | null): { title: string; detail: string } {
  return saved
    ? { title: 'Continue run', detail: `Round ${saved.round} · seed ${saved.seed}` }
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
