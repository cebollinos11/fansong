import type { BoardData, Vec } from './board.js';

/** Two players: 0 and 1. */
export type Owner = 0 | 1;

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
  /** Max Chebyshev cells moved per Move action. */
  move: number;
  pos: Vec;
  dead: boolean;
  knockedDown: boolean;
  /** True once the unit has activated this round (success or turnover). */
  activatedThisRound: boolean;
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

export interface EndActivation {
  type: 'EndActivation';
}

export type Command = ChooseActivation | MoveCommand | AttackCommand | EndActivation;

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
      result: CombatResult;
    }
  | { type: 'UnitKnockedDown'; unitId: string }
  | { type: 'UnitKilled'; unitId: string; byId: string | null }
  | { type: 'ActivationEnded'; unitId: string }
  | { type: 'RoundEnded'; round: number; nextLeader: Owner }
  | { type: 'GameOver'; winner: Owner };

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}
