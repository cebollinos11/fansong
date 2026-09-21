import type { BoardData, Vec } from './board.js';

/** Two players: 0 and 1. */
export type Owner = 0 | 1;

/**
 * Optional special abilities a unit may carry. Kept as an always-present record
 * (defaults meaning "none") so the wire schema and cost model can treat every
 * unit uniformly. Each is priced in `packages/content` and understood by the AI.
 */
export interface UnitTraits {
  /**
   * Maximum range of a ranged (Shoot) attack, in cells. `0` = melee only. A
   * ranged unit can shoot a non-adjacent enemy within range and line of sight,
   * and takes no return damage — but cannot shoot while itself in melee.
   */
  ranged: number;
  /**
   * Tough: the first would-be kill against this unit is downgraded to a
   * knockdown. A unit that is *already* knocked down dies normally.
   */
  tough: boolean;
  /**
   * Guard: this unit may take a Guard action to enter a defensive stance. While
   * guarding, the first melee attacker it faces is met with a pre-emptive strike
   * (a "riposte"); if the riposte kills or knocks the attacker down, the attack
   * is prevented. The stance clears when the unit next activates.
   */
  guard: boolean;
}

export interface Unit {
  id: string;
  owner: Owner;
  name: string;
  /**
   * Quality target number. A die is a success when `die >= quality`
   * (so *lower* Quality is better). Used for activation dice.
   */
  quality: number;
  /** Combat value, added to a d6 in opposed melee rolls. */
  combat: number;
  /** Max hex cells moved per Move action. */
  move: number;
  pos: Vec;
  dead: boolean;
  knockedDown: boolean;
  /** True once the unit has activated this round (success or turnover). */
  activatedThisRound: boolean;
  /** Special abilities (see {@link UnitTraits}). */
  traits: UnitTraits;
  /** Dynamic: in a Guard stance (set by a Guard action, cleared on next activation). */
  guarding: boolean;
}

export type Phase = 'awaitingActivation' | 'acting' | 'gameOver';

export interface GameState {
  board: BoardData;
  units: Unit[];
  round: number;
  /** Player who leads (activates first) this round. Flips each round. */
  initiativeLeader: Owner;
  /** Player whose turn it is to act right now. */
  active: Owner;
  /** Benched[p] = player p turned over and is done for the round. */
  benched: [boolean, boolean];
  /** Broken[p] = player p's warband has failed its rout check (a one-time collapse). */
  broken: [boolean, boolean];
  /** Living unit count each player started with, for the rout threshold. */
  startCount: [number, number];
  phase: Phase;
  /** Unit currently mid-activation (during 'acting'). */
  activeUnitId: string | null;
  /** Actions left in the current activation. */
  actionsRemaining: number;
  /** Global activation counter (monotonic; useful for logs/replays). */
  activationCount: number;
  rngState: number;
  winner: Owner | null;
}

// --- Commands -------------------------------------------------------------

export interface ChooseActivation {
  type: 'ChooseActivation';
  unitId: string;
  /** Dice committed to this activation (1–3). */
  diceCount: number;
}

export interface MoveCommand {
  type: 'Move';
  unitId: string;
  to: Vec;
}

export interface AttackCommand {
  type: 'Attack';
  attackerId: string;
  targetId: string;
}

export interface ShootCommand {
  type: 'Shoot';
  attackerId: string;
  targetId: string;
}

export interface GuardCommand {
  type: 'Guard';
  unitId: string;
}

export interface EndActivation {
  type: 'EndActivation';
}

export type Command =
  | ChooseActivation
  | MoveCommand
  | AttackCommand
  | ShootCommand
  | GuardCommand
  | EndActivation;

// --- Events ---------------------------------------------------------------

export type CombatResult =
  | 'defenderKilled'
  | 'defenderKnockedDown'
  | 'attackerKilled'
  | 'attackerKnockedDown'
  | 'clash';

export type GameEvent =
  | { type: 'ActivationChosen'; player: Owner; unitId: string; diceCount: number }
  | { type: 'DiceRolled'; unitId: string; quality: number; dice: number[]; successes: number; failures: number }
  | { type: 'Turnover'; player: Owner; unitId: string }
  | { type: 'UnitStoodUp'; unitId: string }
  | { type: 'UnitMoved'; unitId: string; from: Vec; to: Vec }
  | {
      type: 'AttackResolved';
      attackerId: string;
      targetId: string;
      attackDie: number;
      defenseDie: number;
      attackScore: number;
      defenseScore: number;
      /** High-ground bonus added to the attack score; present only when non-zero. */
      attackBonus?: number;
      /** High-ground bonus added to the defense score; present only when non-zero. */
      defenseBonus?: number;
      result: CombatResult;
    }
  | {
      type: 'ShotResolved';
      attackerId: string;
      targetId: string;
      attackDie: number;
      defenseDie: number;
      attackScore: number;
      defenseScore: number;
      /** High-ground bonus added to the attack score; present only when non-zero. */
      attackBonus?: number;
      /** High-ground bonus added to the defense score; present only when non-zero. */
      defenseBonus?: number;
      /** Only ever a defender-side outcome (a shooter takes no return damage). */
      result: CombatResult;
    }
  | { type: 'GuardDeclared'; unitId: string }
  | {
      type: 'GuardRiposte';
      guardId: string;
      attackerId: string;
      guardDie: number;
      attackerDie: number;
      guardScore: number;
      attackerScore: number;
      /** High-ground bonus added to the guard's score; present only when non-zero. */
      guardBonus?: number;
      /** High-ground bonus added to the attacker's score; present only when non-zero. */
      attackerBonus?: number;
      result: CombatResult;
      /** True if the riposte stopped the incoming attack (attacker killed/knocked down). */
      prevented: boolean;
    }
  | { type: 'ToughnessSaved'; unitId: string }
  | { type: 'NerveCheck'; unitId: string; quality: number; die: number; passed: boolean }
  | { type: 'WarbandBroken'; player: Owner }
  | { type: 'UnitRouted'; unitId: string }
  | { type: 'UnitKnockedDown'; unitId: string }
  | { type: 'UnitKilled'; unitId: string; byId: string | null }
  | { type: 'ActivationEnded'; unitId: string }
  | { type: 'RoundEnded'; round: number; nextLeader: Owner }
  | { type: 'GameOver'; winner: Owner };

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}
