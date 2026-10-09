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

export type RunPhase = 'draft' | 'briefing' | 'battle' | 'aftermath' | 'reward' | 'shop' | 'over';

/** One choice of the reward pick. */
export type RewardOption =
  | { kind: 'recruit'; unit: WarbandUnit }
  /** An advance for a unit of the player's choice. */
  | { kind: 'boost'; advance: Advance }
  | { kind: 'gold'; amount: number }
  /** Mends the oldest lasting wound of a unit of the player's choice. */
  | { kind: 'mend' };

/** What the player is choosing from right now. A shop slot is `null` once bought. */
export type RunOffer =
  | { kind: 'draft'; stage: 'leader' | 'troop'; units: WarbandUnit[] }
  | { kind: 'reward'; options: RewardOption[] }
  | { kind: 'shop'; recruits: (WarbandUnit | null)[]; upgrades: (Advance | null)[]; rerolls: number };

/** A level a unit has earned and not yet spent: pick one of `choices`. */
export interface LevelUp {
  unitId: string;
  choices: Advance[];
}

/** The round's battle: rolled on entering the briefing, and kept as is if the battle restarts. */
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

/** How a fielded unit ended a battle. */
export type UnitFate = 'survived' | 'fell' | 'fled' | 'turned';

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
  injury?: Injury;
  wound?: Wound;
}

export interface Aftermath {
  gold: number;
  units: AftermathLine[];
}

/** One line of the run's history. */
export interface RoundSummary {
  round: number;
  mode: GameMode;
  /** The enemy warband's name. */
  enemy: string;
  boss: boolean;
  won: boolean;
  kills: number;
  /** Roster units lost for good: dead of their injuries, or turned. */
  losses: number;
  gold: number;
}

export interface RunState {
  version: 1;
  seed: number;
  /** The battle about to be, or being, fought. Starts at 1. */
  round: number;
  phase: RunPhase;
  roster: RunUnit[];
  gold: number;
  /** Random steps taken this round, so rerolls stay seeded. */
  rolls: number;
  /** Number the next roster unit's id takes. */
  nextId: number;
  offer?: RunOffer;
  /** Levels earned and not yet spent. */
  pending?: LevelUp[];
  battle?: RunBattle;
  /** The last won battle's results, kept until the next battle. */
  aftermath?: Aftermath;
  log: RoundSummary[];
  /** Past runs' warbands this run meets, by round, picked when it began. */
  rivals?: RunRival[];
}

export type RunAction =
  /** Draft: take `offer.units[index]`. */
  | { type: 'draftPick'; index: number }
  /** Briefing: leave a unit out of the battle, or put it back. */
  | { type: 'bench'; unitId: string; benched: boolean }
  /** Briefing of a boss round: make a unit the King. */
  | { type: 'setKing'; unitId: string }
  | { type: 'startBattle' }
  /** Battle: hand in the finished match. */
  | { type: 'battleResult'; replay: Replay }
  /** Aftermath: spend the first pending level of `unitId` on `choices[index]`. */
  | { type: 'advance'; unitId: string; index: number }
  /** Aftermath: go on to the reward. */
  | { type: 'continue' }
  /** Reward: take `options[index]`; a boost or a mending names its unit. */
  | { type: 'reward'; index: number; unitId?: string }
  | { type: 'buyRecruit'; index: number }
  | { type: 'buyUpgrade'; index: number; unitId: string }
  /** Shop: mend a unit's oldest lasting wound. */
  | { type: 'heal'; unitId: string }
  | { type: 'reroll' }
  | { type: 'sell'; unitId: string }
  /** Shop: on to the next round's briefing. */
  | { type: 'leaveShop' };
