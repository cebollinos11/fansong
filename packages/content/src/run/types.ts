import type { GameMode, Owner, Replay } from '@fansong/engine';
import type { MapDef } from '../map.js';
import type { MatchSetup } from '../match.js';
import type { Warband, WarbandUnit } from '../warband.js';

/** A favorable trait a unit can gain as it grows. */
export type GrowthTrait =
  | 'fast'
  | 'tough'
  | 'guard'
  | 'armored'
  | 'opportunist'
  | 'savage'
  | 'sharpshooter'
  | 'shieldwall'
  | 'rusher'
  | 'slippery'
  | 'whirling'
  | 'immovable'
  | 'woodwise'
  | 'trample';

/** An unfavorable trait a lasting wound can leave. */
export type WoundTrait = 'slow' | 'dumb' | 'badBalance';

/** One step of growth: a trait the unit lacks, Combat +1 or Quality −1 (better). */
export type Advance = { kind: 'trait'; trait: GrowthTrait } | { kind: 'combat' } | { kind: 'quality' };

/** A lasting wound: Combat −1, Quality +1 (worse) or an unfavorable trait. */
export type Wound = { kind: 'trait'; trait: WoundTrait } | { kind: 'combat' } | { kind: 'quality' };

/** A unit of the run's roster. */
export interface RunUnit {
  /** Stable for the whole run, unlike its place in the roster. */
  id: string;
  unit: WarbandUnit;
  xp: number;
  /** Advances taken from XP so far. */
  level: number;
  kills: number;
  /** Hurt last battle: misses the next one. */
  sitsOut?: boolean;
  /** Left out of battles by the player. */
  benched?: boolean;
  /** Lasting wounds it still carries, oldest first. */
  wounds?: Wound[];
}

/** `map`: choosing where on the act's route to go next. */
export type RunPhase = 'draft' | 'map' | 'briefing' | 'battle' | 'aftermath' | 'reward' | 'shop' | 'over';

/** One thing a won mission pays. */
export type RewardOption =
  | { kind: 'recruit'; unit: WarbandUnit }
  /** An advance for a unit of the player's choice. */
  | { kind: 'boost'; advance: Advance }
  | { kind: 'gold'; amount: number }
  /** Mends the oldest lasting wound of a unit of the player's choice. */
  | { kind: 'mend' };

/** What a place on the route is. A `battle`, an `elite` and the act's `boss` are fights; the rest are stops. */
export type NodeKind = 'battle' | 'elite' | 'market' | 'camp' | 'training' | 'mystery' | 'boss';

/** One place on an act's route. A fight shows who waits there, how hard they are and what winning pays. */
export interface RouteNode {
  /** Its index in `Route.nodes`. */
  id: number;
  /** The step of the run it is reached at: the `round` it is played in. */
  step: number;
  /** Where it sits across the map, from 0. */
  lane: number;
  kind: NodeKind;
  /** The nodes of the next step it leads to. */
  next: number[];
  /** Fights: the enemy's budget, as a share of the step's usual. */
  threat?: number;
  /** Fights: the preset roster the enemy is built from, or `RIVAL_FACTION`. */
  faction?: string;
  mode?: GameMode;
  /** Fights: the kind of thing winning pays, if the roster can take it by then. */
  rewardKind?: RewardOption['kind'];
  /** A past run's warband waits here. */
  rival?: true;
}

/** An act's map: its nodes, bottom row first and the boss last, and where on it the run stands. */
export interface Route {
  /** 1 for the first act. */
  act: number;
  nodes: RouteNode[];
  /** The node last finished; `null` before the act's first. */
  at: number | null;
  /** Every node finished in this act, in order: the road taken. */
  path: number[];
  /** The node being played, from the moment it is travelled to until it is finished or fled. */
  going?: number;
  /** Nodes retreated from: they can't be entered again. */
  closed: number[];
}

/** What the player is choosing from, or is owed, right now. A shop slot is `null` once bought. */
export type RunOffer =
  | { kind: 'draft'; stage: 'leader' | 'troop'; units: WarbandUnit[] }
  /** The won battle's pay, held from the win until it is claimed. */
  | { kind: 'reward'; rewards: RewardOption[]; value: number }
  /** A shop: the small one in the field after a battle, or (`market`) a market's full one, which also rerolls its stock and buys units back. */
  | { kind: 'shop'; recruits: (WarbandUnit | null)[]; upgrades: (Advance | null)[]; rerolls: number; market?: true };

/** A level a unit has earned and not yet spent: pick one of `choices`. */
export interface LevelUp {
  unitId: string;
  choices: Advance[];
}

/** The battle of the node travelled to, kept as is if the battle restarts. */
export interface RunBattle {
  mode: GameMode;
  /** The preset roster the enemy was built from, or `RIVAL_FACTION` for a past run's warband. */
  faction: string;
  enemy: Warband;
  /** Boss rounds: index into `enemy.units` of the enemy King. */
  enemyKing?: number;
  map: MapDef;
  /** The match's RNG seed. */
  seed: number;
  /** How hard it is: the enemy's cost over the step's budget. */
  threat: number;
  /** What winning pays, all of it. At most one part needs a unit to go to. */
  rewards: RewardOption[];
  /** What `rewards` are worth in gold: paid instead if they can no longer be taken. */
  rewardValue: number;
  /** Boss rounds: the roster unit the player made King (default: the costliest fielded). */
  playerKing?: string;
  /** Set when the battle starts: the roster ids fielded, in warband order (unit `p0u{i}` is `fielded[i]`). */
  fielded?: string[];
  /** Set when the battle starts: the match to play. Its `mapId` resolves through `runMapLookup`. */
  setup?: MatchSetup;
}

/** A past run's warband, met again as the enemy of `round`. */
export interface RunRival {
  round: number;
  warband: Warband;
}

/**
 * How a fielded unit ended a battle. `retreated`: it left by the retreat flag.
 * `leftBehind`: it was still on the field when a battle the player retreated
 * from ended.
 */
export type UnitFate = 'survived' | 'fell' | 'fled' | 'turned' | 'retreated' | 'leftBehind';

export interface UnitReport {
  kills: number;
  /** Point cost of each unit it killed. */
  killCosts: number[];
  fate: UnitFate;
}

/** What a finished (or abandoned) battle did, read back from its replay. */
export interface BattleReport {
  /** `null` if the replay stops before the game is over. */
  winner: Owner | null;
  /** Per fielded roster unit, by roster id. */
  units: Record<string, UnitReport>;
  /** Points of the enemy warband as fielded. */
  enemyPoints: number;
  /** Points of the enemy's own units killed or run off the field. */
  enemyPointsKilled: number;
  /** The player's Leader sounded the retreat in it (whoever then won). */
  retreated: boolean;
}

/** What became of a fallen unit. */
export type Injury = 'dead' | 'wound' | 'sitsOut' | 'recovered';

/** One fielded unit's line of the aftermath screen. */
export interface AftermathLine {
  unitId: string;
  name: string;
  fate: UnitFate;
  kills: number;
  xp: number;
  /** A fallen unit, or one left behind in a retreat: the d6 it rolled for its injury. */
  die?: number;
  injury?: Injury;
  wound?: Wound;
  /** What it was drawn as (`look ?? name`) and its tint, to show it even after it died. */
  look?: string;
  tint?: string;
}

export interface Aftermath {
  gold: number;
  units: AftermathLine[];
  /** The battle was given up by a retreat: nobody earned anything. */
  retreated?: true;
}

/** One line of the run's history. */
export interface RoundSummary {
  round: number;
  mode: GameMode;
  /** The enemy warband's name. */
  enemy: string;
  boss: boolean;
  won: boolean;
  /** Lost, but by a retreat: the run went on, at the same round. */
  retreated?: true;
  kills: number;
  /** Roster units lost for good: dead of their injuries, or turned. */
  losses: number;
  gold: number;
}

export interface RunState {
  version: 3;
  seed: number;
  /** The step along the route about to be, or being, played. Starts at 1; every node finished, fight or stop, moves it on. */
  round: number;
  phase: RunPhase;
  roster: RunUnit[];
  gold: number;
  /** Random steps taken this round, so rerolls stay seeded. */
  rolls: number;
  /** Number the next roster unit's id takes. */
  nextId: number;
  /** Retreat banners in hand: each lets the retreat be sounded in one battle, so that losing it does not end the run. */
  banners: number;
  /** Retreats made at this step so far, so a battle met after one is rolled anew. */
  retreats?: number;
  /** The act's map. Absent only during the draft. */
  route?: Route;
  offer?: RunOffer;
  /** Levels earned and not yet spent. */
  pending?: LevelUp[];
  battle?: RunBattle;
  /** The last won (or retreated-from) battle's results, kept until the next battle. */
  aftermath?: Aftermath;
  log: RoundSummary[];
  /** Past runs' warbands this run meets, by round, picked when it began. */
  rivals?: RunRival[];
}

export type RunAction =
  /** Draft: take `offer.units[index]`. */
  | { type: 'draftPick'; index: number }
  /** Map: go to an open node of the route. */
  | { type: 'travel'; nodeId: number }
  /** Briefing: leave a unit out of the battle, or put it back. */
  | { type: 'bench'; unitId: string; benched: boolean }
  /** Briefing of a boss round: make a unit the King. */
  | { type: 'setKing'; unitId: string }
  | { type: 'startBattle' }
  /** Battle: hand in the finished match. */
  | { type: 'battleResult'; replay: Replay }
  /** Aftermath: spend the first pending level of `unitId` on `choices[index]`. */
  | { type: 'advance'; unitId: string; index: number }
  /** Aftermath: go on to the reward (after a retreat, straight to the shop). */
  | { type: 'continue' }
  /** Reward: take the mission's pay; a boost or a mending names its unit. */
  | { type: 'reward'; unitId?: string }
  | { type: 'buyRecruit'; index: number }
  | { type: 'buyUpgrade'; index: number; unitId: string }
  /** Shop: mend a unit's oldest lasting wound. */
  | { type: 'heal'; unitId: string }
  | { type: 'reroll' }
  | { type: 'sell'; unitId: string }
  /** Shop: back to the map, a step on (after a retreat, at the same step, with the fled node closed). */
  | { type: 'leaveShop' }
  /** Any phase but the battle: give a roster unit a name of the player's own. */
  | { type: 'rename'; unitId: string; name: string };
