import type { BoardData, Vec } from './board.js';
import type { ModeState } from './mode.js';

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
   * guarding, every melee attacker it faces is met with a pre-emptive strike (a
   * "riposte"); if the riposte kills, knocks down or pushes back the attacker,
   * that attack is prevented. The stance holds until the unit next activates,
   * gets knocked down, or is pushed back — and losing a riposte never costs the
   * guard anything.
   */
  guard: boolean;
  /**
   * Big: a head taller than the rank and file. It fights every melee against a
   * non-Big opponent at +1 — attacking, defending, riposting or hacking at a
   * leaver alike — and, being an unmissable target, is shot at by *anyone* at
   * +1. Two Big models fighting each other are evenly matched, so neither gets
   * the melee bonus.
   */
  big: boolean;
  /**
   * Flying: it moves through every hex — terrain and units alike — and only has
   * to *land* on a legal, empty one, so nothing on the ground can block or slow
   * it; leaving contact never draws a free hack. Airborne it swoops: +1 in melee
   * when it strikes a grounded (non-flying) foe. That same open air is its
   * weakness — anyone shooting an airborne flyer aims at +1. Both edges lapse
   * while it is knocked down: a grounded flyer neither swoops nor floats.
   */
  flying: boolean;
  /**
   * Reassembling: bones that will not stay down. At the start of every round,
   * before either player acts, a reassembling unit that is knocked down stands
   * back up for free — no action spent, no die rolled. It saves nothing against
   * a killing blow (see {@link tough} for that); it only refuses to lie there
   * once it has merely been knocked over.
   */
  reassembling: boolean;
}

export interface Unit {
  id: string;
  owner: Owner;
  name: string;
  /**
   * Cosmetic: which unit this one is drawn as (a preset unit's name, e.g. an
   * army-builder unit that "looks like" a Longbow). Omitted = drawn by `name`.
   * No rule reads it.
   */
  look?: string;
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
  /**
   * Objective-mode state (mode, objectives, scores). Omitted for annihilation,
   * so a default game's state shape — and every replay hash — is unchanged.
   */
  mode?: ModeState;
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
  /**
   * A **power blow**: put the weight of two actions behind one swing. It costs
   * {@link PRESSED_COST} actions instead of one and the defender fights it at
   * {@link POWER_BLOW_PENALTY}. Omitted = an ordinary one-action attack.
   */
  power?: true;
}

export interface ShootCommand {
  type: 'Shoot';
  attackerId: string;
  targetId: string;
  /**
   * An **aimed shot**: the ranged twin of a power blow. It costs
   * {@link PRESSED_COST} actions instead of one and the target defends at
   * {@link AIMED_SHOT_PENALTY}. Omitted = an ordinary one-action shot.
   */
  aimed?: true;
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
  | 'defenderRecoiled'
  | 'attackerKilled'
  | 'attackerKnockedDown'
  | 'attackerRecoiled'
  | 'clash';

export type GameEvent =
  | { type: 'ActivationChosen'; player: Owner; unitId: string; diceCount: number }
  | { type: 'DiceRolled'; unitId: string; quality: number; dice: number[]; successes: number; failures: number }
  | { type: 'Turnover'; player: Owner; unitId: string }
  | { type: 'UnitStoodUp'; unitId: string; /** Stood for free at round start via the Reassembling trait, not by spending an action. */ reassembled?: boolean }
  | {
      type: 'UnitMoved';
      unitId: string;
      from: Vec;
      to: Vec;
      /** The hexes walked, `from` and `to` included (a shortest legal walk). */
      path?: Vec[];
    }
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
      /** Outnumbering penalty subtracted from the attack score; present only when non-zero. */
      attackOutnumbered?: number;
      /** Outnumbering penalty subtracted from the defense score; present only when non-zero. */
      defenseOutnumbered?: number;
      /** Big bonus added to the attack score (a Big attacker facing a non-Big foe); present only when non-zero. */
      attackBig?: number;
      /** Big bonus added to the defense score (a Big defender facing a non-Big foe); present only when non-zero. */
      defenseBig?: number;
      /** Flying bonus added to the attack score (an airborne flyer striking a grounded foe); present only when non-zero. */
      attackFly?: number;
      /** Power-blow penalty subtracted from the defense score; present only on a two-action attack. */
      powerPenalty?: number;
      result: CombatResult;
      /** Present when the kill tripled the loser's score (a gruesome kill, which spreads fear). */
      gruesome?: true;
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
      /** Long-range penalty subtracted from the attack score; present only when non-zero. */
      rangePenalty?: number;
      /** Cover penalty subtracted from the attack score; present only when non-zero. */
      coverPenalty?: number;
      /** Big-target bonus added to the attack score (the target is Big); present only when non-zero. */
      bigTarget?: number;
      /** Flying-target bonus added to the attack score (the target is an airborne flyer); present only when non-zero. */
      flyingTarget?: number;
      /** Aimed-shot penalty subtracted from the defense score; present only on a two-action shot. */
      aimPenalty?: number;
      /** Only ever a defender-side outcome (a shooter takes no return damage). */
      result: CombatResult;
      /** Present when the kill tripled the target's score (a gruesome kill, which spreads fear). */
      gruesome?: true;
    }
  | {
      /**
       * A free hack: `attackerId` strikes `targetId` as it leaves contact. Only
       * defender-side outcomes apply (the hacker is never hurt); a recoil means
       * the leaver slips away and carries on, a knockdown stops its move.
       */
      type: 'FreeHackResolved';
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
      /** Outnumbering penalty subtracted from the attack score; present only when non-zero. */
      attackOutnumbered?: number;
      /** Outnumbering penalty subtracted from the defense score; present only when non-zero. */
      defenseOutnumbered?: number;
      /** Big bonus added to the hacker's score (Big, and the leaver is not); present only when non-zero. */
      attackBig?: number;
      /** Big bonus added to the leaver's score (Big, and the hacker is not); present only when non-zero. */
      defenseBig?: number;
      /** Flying bonus added to the hacker's score (an airborne flyer hacking a grounded leaver); present only when non-zero. */
      attackFly?: number;
      result: CombatResult;
      /** Present when the kill tripled the leaver's score (a gruesome kill, which spreads fear). */
      gruesome?: true;
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
      /** Outnumbering penalty subtracted from the guard's score; present only when non-zero. */
      guardOutnumbered?: number;
      /** Outnumbering penalty subtracted from the attacker's score; present only when non-zero. */
      attackerOutnumbered?: number;
      /** Big bonus added to the guard's score (Big, and the attacker is not); present only when non-zero. */
      guardBig?: number;
      /** Big bonus added to the attacker's score (Big, and the guard is not); present only when non-zero. */
      attackerBig?: number;
      /** Flying bonus added to the guard's score (an airborne flyer riposting a grounded attacker); present only when non-zero. */
      guardFly?: number;
      result: CombatResult;
      /** Present when the riposte's kill tripled the attacker's score (a gruesome kill). */
      gruesome?: true;
      /** True if the riposte stopped the incoming attack (attacker killed, knocked down or pushed back). */
      prevented: boolean;
    }
  | { type: 'ToughnessSaved'; unitId: string }
  | { type: 'NerveCheck'; unitId: string; quality: number; die: number; passed: boolean }
  | { type: 'WarbandBroken'; player: Owner }
  | { type: 'UnitRouted'; unitId: string }
  | { type: 'UnitKnockedDown'; unitId: string }
  /** Pushed one hex directly away from the opponent that beat it. */
  | { type: 'UnitRecoiled'; unitId: string; from: Vec; to: Vec }
  | { type: 'UnitKilled'; unitId: string; byId: string | null }
  | { type: 'ActivationEnded'; unitId: string }
  | { type: 'RoundEnded'; round: number; nextLeader: Owner }
  /** `zone` (index into the conquest zones) is present only for conquest zone scoring. */
  | { type: 'ScoreChanged'; player: Owner; points: number; scores: [number, number]; zone?: number }
  /** Capture-the-flag: `player` is the flag's owner; `unitId` the enemy that took it. */
  | { type: 'FlagPickedUp'; player: Owner; unitId: string }
  /** Capture-the-flag: `player`'s flag falls from its knocked-down or slain carrier onto `at`. */
  | { type: 'FlagDropped'; player: Owner; unitId: string; at: Vec }
  /** Capture-the-flag: `unitId` returned its own side's (`player`'s) dropped flag to base. */
  | { type: 'FlagReturned'; player: Owner; unitId: string }
  /** Capture-the-flag: `player` carried the enemy flag home with `unitId` (and wins). */
  | { type: 'FlagCaptured'; player: Owner; unitId: string }
  /** `reason` is present only in an objective mode (see {@link ModeState}). */
  | { type: 'GameOver'; winner: Owner; reason?: GameOverReason };

/** Why a game ended: last side standing, target score, round cap, king slain, or flag captured. */
export type GameOverReason = 'annihilation' | 'score' | 'roundLimit' | 'king' | 'flag';

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}
