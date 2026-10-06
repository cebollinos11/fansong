import type { BoardData, Vec } from './board.js';
import type { GameLimits, ModeState } from './mode.js';
import type { BASE_MOVE, SPEED_STEP } from './query.js';

/** Two players: 0 and 1. */
export type Owner = 0 | 1;

/**
 * Optional special abilities a unit may carry. Kept as an always-present record
 * (defaults meaning "none") so the wire schema and cost model can treat every
 * unit uniformly. Each is priced in `packages/content` and understood by the AI.
 */
export interface UnitTraits {
  /** Slow: moves {@link SPEED_STEP} fewer hexes per Move action than {@link BASE_MOVE}. */
  slow: boolean;
  /** Fast: moves {@link SPEED_STEP} more hexes per Move action than {@link BASE_MOVE}. Never with {@link slow}. */
  fast: boolean;
  /**
   * Maximum range of a ranged (Shoot) attack, in cells. `0` = melee only. A
   * ranged unit can shoot a non-adjacent enemy within range and line of sight,
   * and takes no return damage — but cannot shoot with a standing enemy in contact.
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
   * that attack is prevented (a push a friend braces does not prevent it). The stance holds until the unit next activates,
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
  /**
   * Opportunist: quick to strike a foe who is down. It scores +1 in every melee
   * against a knocked-down opponent — attacking, defending, riposting or hacking
   * at a leaver alike — and +1 shooting a knocked-down target.
   */
  opportunist: boolean;
  /**
   * Savage: every kill it deals counts as a gruesome kill, whatever the scores
   * — a blow, a shot, a riposte, a free hack or a shove off the map alike — so
   * its victim's friends must test for fear.
   */
  savage: boolean;
  /**
   * Leader: once a round, while on its feet, it may spend an action on a
   * {@link WarCryCommand war cry} that inspires every friend that isn't a Leader
   * for the rest of the round (see {@link Unit.inspired}). When a Leader is
   * killed, every standing friend with line of sight to it must pass a nerve
   * check or flee.
   */
  leader: boolean;
  /**
   * Armored: a combat it loses by exactly 1 point — a blow, a shot, a riposte or
   * a free hack — does it no harm, whether it is standing or knocked down: the
   * blow is turned aside and the roll counts as a clash (see `armorHeld` in
   * combat.ts), reported by an `ArmorHeld` event.
   */
  armored: boolean;
  /** Sharpshooter: a deadly eye. It scores +1 on every shot it takes (see `sharpshooterBonus` in combat.ts). */
  sharpshooter: boolean;
  /**
   * Combat Mastery: a melee it ties against a foe without Combat Mastery kills
   * that foe — a blow attacking or defending, a riposte or a free hack, on either
   * side of it (see `masteryStruck` in combat.ts). Two masters tie as anyone
   * does. Knocked down, it needs the natural 6 any fallen unit needs to strike
   * back. It is an ordinary kill: Tough saves against it, and it is not gruesome
   * unless the master is Savage. Reported by a `MasteryStruck` event.
   */
  mastery: boolean;
  /**
   * Shieldwall: +1 defending against a melee attack while it stands next to a
   * standing friend (see `shieldwallBonus` in combat.ts). Not against a riposte
   * or a free hack, and not while it is knocked down.
   */
  shieldwall: boolean;
  /**
   * Rusher: +1 on the first attack it makes after a Move that brought it into
   * contact with its target, in the same activation (see {@link GameState.rushed}).
   */
  rusher: boolean;
  /**
   * Slippery: leaving contact draws no free hack, on a Move or in flight from a
   * failed nerve check — unless it is carrying a flag (see `slipsAway` in query.ts).
   */
  slippery: boolean;
  /** Whirling: it is never outnumbered in melee while on its feet (see `outnumberedPenalty` in query.ts). */
  whirling: boolean;
  /**
   * Immovable: it is never pushed. A push result — from a blow, a riposte or a
   * shot — leaves it standing where it is, reported by a `UnitHeldGround` event.
   * Never with {@link badBalance}.
   */
  immovable: boolean;
  /**
   * Woodwise: standing in a forest hex (and not airborne) it scores +1 on every
   * combat roll — melee on either side, a shot it takes and a shot taken at it
   * (see `woodwiseBonus` in combat.ts).
   */
  woodwise: boolean;
  /**
   * Trample: a foe it pushes in melee goes two hexes instead of one. A standing
   * friend of the foe on the second hex stops it after one; the map edge or lava
   * there kills it; anything else there leaves it knocked down on the first hex.
   */
  trample: boolean;
  /** Dumb: it may roll at most {@link DUMB_MAX_DICE} activation dice (see `maxActivationDice` in query.ts). */
  dumb: boolean;
  /**
   * Disloyal: a natural 1 on a nerve check makes it change sides instead of
   * fleeing (see `defect` in morale.ts). It keeps the trait, so it can turn again.
   */
  disloyal: boolean;
  /** Bad Balance: a push that moves it also knocks it down where it lands. Never with {@link immovable}. */
  badBalance: boolean;
  /**
   * Magic User: on its feet and out of contact with a standing foe, it may take
   * a **spell turn** instead of a normal activation (see
   * {@link ChooseActivation.spell}): the successes of the roll are the power of
   * one Transfix spell (see {@link CastCommand}).
   */
  magicUser: boolean;
}

export interface Unit {
  id: string;
  owner: Owner;
  name: string;
  /**
   * Cosmetic: which unit this one is drawn as (a preset unit's name, e.g. an
   * army-builder unit that "looks like" a Longbow). Omitted = drawn by `name`.
   * The only rule that reads it is group activation: units must look alike to
   * form a group (see `sameProfile`).
   */
  look?: string;
  /**
   * Cosmetic: a colour (`"#rrggbb"`) blended into the unit's sprite, sparing its
   * team colours. Omitted = untinted. Like `look`, read only by group activation.
   */
  tint?: string;
  /**
   * Quality target number. A die is a success when `die >= quality`
   * (so *lower* Quality is better). Used for activation dice.
   */
  quality: number;
  /** Combat value, added to a d6 in opposed melee rolls. */
  combat: number;
  pos: Vec;
  dead: boolean;
  knockedDown: boolean;
  /** True once the unit has activated this round (success or turnover). */
  activatedThisRound: boolean;
  /** Special abilities (see {@link UnitTraits}). */
  traits: UnitTraits;
  /** Dynamic: in a Guard stance (set by a Guard action, cleared on next activation). */
  guarding: boolean;
  /**
   * Dynamic: inspired by a Leader's war cry. The first die of its next
   * activation roll is a guaranteed 6. Spent on that roll; lost on a failed
   * nerve check; cleared at the end of the round.
   */
  inspired: boolean;
  /** Dynamic: this Leader has already war cried this round (cleared at the end of the round). */
  warCried: boolean;
  /**
   * Dynamic: held fast by a Transfix spell, cast by the unit with this id.
   * Omitted when free, so an ordinary state's shape (and every replay hash) is
   * unchanged. A transfixed unit is helpless (see `isDown` in query.ts): it
   * cannot move or act, is struck at `TRANSFIX_BONUS`, dies to any blow
   * that beats it, and is lost outright if it fails a nerve check. Its
   * activation is a roll to break free. It is freed at once when its caster is
   * killed, leaves the field, changes sides or is transfixed in turn.
   */
  transfixedBy?: string;
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
  /** Custom round limit / target score; omitted when the game plays its mode's defaults. */
  limits?: GameLimits;
  /**
   * The group activation in progress; omitted outside one, so an ordinary
   * state's shape (and every replay hash) is unchanged.
   */
  group?: GroupState;
  /**
   * Rusher: the enemies the activating unit's last Move brought it into contact
   * with. Its next attack on one of them gets the Rusher bonus, and any attack
   * or further Move clears it. Omitted when empty, so an ordinary state's shape
   * is unchanged.
   */
  rushed?: string[];
  /**
   * The spell turn in progress: the activating Magic User rolled `power`
   * successes and has yet to pick its target. Omitted outside one.
   */
  spell?: { power: number };
}

/** A group activation in progress: the members still to act behind the active one. */
export interface GroupState {
  /** Members waiting their turn, next first, each with the actions the shared roll left it. */
  pending: { unitId: string; actions: number }[];
  /**
   * Actions the active member started with. While `actionsRemaining` still
   * equals it the member has done nothing, and may hand over to another.
   */
  allotted: number;
}

// --- Commands -------------------------------------------------------------

export interface ChooseActivation {
  type: 'ChooseActivation';
  unitId: string;
  /** Dice committed to this activation (1–3). */
  diceCount: number;
  /**
   * A **group activation**: the unit's group (see `groupFor`) shares this one
   * roll, and every member acts on it before the turn passes. Omitted = the
   * unit activates alone.
   */
  group?: true;
  /**
   * A Magic User's **spell turn**: the roll's successes are not actions but the
   * power of one spell, cast with a {@link CastCommand}. Never with `group`.
   */
  spell?: true;
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

/**
 * A Leader's **war cry**: one action, once a round, not while knocked down.
 * Every living friend that isn't a Leader and has yet to activate this round
 * becomes {@link Unit.inspired inspired}.
 */
export interface WarCryCommand {
  type: 'WarCry';
  unitId: string;
}

/**
 * Cast **Transfix** on an enemy, on a spell turn. The spell reaches
 * `SPELL_RANGES[power - 1]` hexes along a clear line of sight (as a shot needs).
 * The target rolls one die per point of power against its Quality, and is
 * {@link Unit.transfixedBy transfixed} if any of them fails.
 */
export interface CastCommand {
  type: 'Cast';
  casterId: string;
  targetId: string;
}

export interface EndActivation {
  type: 'EndActivation';
}

/**
 * In a group activation, let the waiting member `unitId` act now instead of
 * the active one, which goes back to waiting. Only legal while the active
 * member has done nothing yet.
 */
export interface SwitchGroupMember {
  type: 'SwitchGroupMember';
  unitId: string;
}

export type Command =
  | ChooseActivation
  | MoveCommand
  | AttackCommand
  | ShootCommand
  | GuardCommand
  | WarCryCommand
  | CastCommand
  | EndActivation
  | SwitchGroupMember;

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
  | {
      type: 'ActivationChosen';
      player: Owner;
      unitId: string;
      diceCount: number;
      /** Present on a group activation: every member sharing the roll, `unitId` first. */
      group?: string[];
      /** Present on a Magic User's spell turn. */
      spell?: true;
      /** Present when the unit is transfixed: the roll is its attempt to break free. */
      breakFree?: true;
    }
  | {
      type: 'DiceRolled';
      unitId: string;
      quality: number;
      dice: number[];
      successes: number;
      failures: number;
      /** Present when the unit was inspired: its first die is the guaranteed 6. */
      inspired?: true;
    }
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
      /** Opportunist bonus added to the attack score (an Opportunist striking a knocked-down foe); present only when non-zero. */
      attackOpportunist?: number;
      /** Opportunist bonus added to the defense score (an Opportunist facing a knocked-down attacker); present only when non-zero. */
      defenseOpportunist?: number;
      /** Pincer bonus added to the attack score (a friend stands directly opposite the target); present only when non-zero. */
      attackPincer?: number;
      /** Rusher bonus added to the attack score (it moved into contact with the target this activation); present only when non-zero. */
      attackRusher?: number;
      /** Shieldwall bonus added to the defense score (the target stands next to a standing friend); present only when non-zero. */
      defenseShieldwall?: number;
      /** Woodwise bonus added to the attack score (a Woodwise attacker standing in forest); present only when non-zero. */
      attackWoodwise?: number;
      /** Woodwise bonus added to the defense score (a Woodwise defender standing in forest); present only when non-zero. */
      defenseWoodwise?: number;
      /** Bonus added to the attack score for striking a transfixed target; present only when non-zero. */
      attackTransfixed?: number;
      /** Power-blow penalty subtracted from the defense score; present only on a two-action attack. */
      powerPenalty?: number;
      result: CombatResult;
      /** Present when the blow made a gruesome kill (see `gruesomeKill` in reduce.ts), which spreads fear: it tripled the loser's score, or the winner is Savage. */
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
      /** Opportunist bonus added to the attack score (an Opportunist shooting a knocked-down target); present only when non-zero. */
      attackOpportunist?: number;
      /** Sharpshooter bonus added to the attack score (the shooter is a Sharpshooter); present only when non-zero. */
      attackSharpshooter?: number;
      /** Woodwise bonus added to the attack score (a Woodwise shooter standing in forest); present only when non-zero. */
      attackWoodwise?: number;
      /** Woodwise bonus added to the defense score (a Woodwise target standing in forest); present only when non-zero. */
      defenseWoodwise?: number;
      /** Bonus added to the attack score for shooting a transfixed target; present only when non-zero. */
      attackTransfixed?: number;
      /** Aimed-shot penalty subtracted from the defense score; present only on a two-action shot. */
      aimPenalty?: number;
      /** Only ever a defender-side outcome (a shooter takes no return damage). */
      result: CombatResult;
      /** Present when the shot made a gruesome kill, which spreads fear: it tripled the target's score, or the shooter is Savage. */
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
      /** Opportunist bonus added to the hacker's score (an Opportunist hacking a knocked-down leaver); present only when non-zero. */
      attackOpportunist?: number;
      /** Opportunist bonus added to the leaver's score (never in practice: a knocked-down hacker draws no hack); present only when non-zero. */
      defenseOpportunist?: number;
      /** Pincer bonus added to the hacker's score (a friend stands directly opposite the leaver); present only when non-zero. */
      attackPincer?: number;
      /** Woodwise bonus added to the hacker's score (a Woodwise hacker standing in forest); present only when non-zero. */
      attackWoodwise?: number;
      /** Woodwise bonus added to the leaver's score (a Woodwise leaver standing in forest); present only when non-zero. */
      defenseWoodwise?: number;
      result: CombatResult;
      /** Present when the hack made a gruesome kill, which spreads fear: it tripled the leaver's score, or the hacker is Savage. */
      gruesome?: true;
    }
  | { type: 'GuardDeclared'; unitId: string }
  /**
   * A Magic User cast Transfix at `targetId` with `power` successes. The target
   * rolled `dice` against its `quality`; any of its `failures` leaves it `transfixed`.
   */
  | {
      type: 'SpellCast';
      casterId: string;
      targetId: string;
      power: number;
      quality: number;
      dice: number[];
      failures: number;
      transfixed: boolean;
    }
  /**
   * `unitId` is no longer transfixed: it `brokeFree` on its own activation roll
   * (and is on its feet), or its `casterLost` its hold — killed, gone from the
   * field, turned coat or transfixed in turn.
   */
  | { type: 'TransfixBroken'; unitId: string; reason: 'brokeFree' | 'casterLost' }
  /** A Leader war cried; `inspired` lists the friends it inspired. */
  | { type: 'WarCry'; unitId: string; inspired: string[] }
  /** A Leader was killed; the nerve checks of the friends who saw it fall follow. */
  | { type: 'LeaderFallen'; unitId: string }
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
      /** Opportunist bonus added to the guard's score (an Opportunist riposting a knocked-down attacker); present only when non-zero. */
      guardOpportunist?: number;
      /** Opportunist bonus added to the attacker's score (an Opportunist attacking a knocked-down guard); present only when non-zero. */
      attackerOpportunist?: number;
      /** Pincer bonus added to the guard's score (a friend stands directly opposite the attacker); present only when non-zero. */
      guardPincer?: number;
      /** Woodwise bonus added to the guard's score (a Woodwise guard standing in forest); present only when non-zero. */
      guardWoodwise?: number;
      /** Woodwise bonus added to the attacker's score (a Woodwise attacker standing in forest); present only when non-zero. */
      attackerWoodwise?: number;
      result: CombatResult;
      /** Present when the riposte made a gruesome kill: it tripled the attacker's score, or the guard is Savage. */
      gruesome?: true;
      /** True if the riposte stopped the incoming attack (attacker killed, knocked down or pushed back — not when a friend braced it). */
      prevented: boolean;
    }
  | { type: 'ToughnessSaved'; unitId: string }
  /**
   * An Armored unit lost the combat just before this event by exactly 1 point,
   * and its armor turned the blow aside: the roll's result is a clash.
   */
  | { type: 'ArmorHeld'; unitId: string }
  /**
   * Straight after a melee roll that tied: `unitId`'s Combat Mastery turned the
   * tie into a kill of its opponent (the kill itself follows).
   */
  | { type: 'MasteryStruck'; unitId: string }
  | {
      type: 'NerveCheck';
      unitId: string;
      quality: number;
      die: number;
      passed: boolean;
      /** Present when a failed check cost the unit its inspiration. */
      inspirationLost?: true;
    }
  | { type: 'WarbandBroken'; player: Owner }
  /** Fled off its own edge of the map after failing a nerve check: out of the game. */
  | { type: 'UnitRouted'; unitId: string }
  /** Ran for its own edge after failing a nerve check, along `path` (both ends included). */
  | { type: 'UnitFled'; unitId: string; from: Vec; to: Vec; path: Vec[] }
  | { type: 'UnitKnockedDown'; unitId: string }
  /** Pushed one hex directly away from the opponent that beat it. */
  | { type: 'UnitRecoiled'; unitId: string; from: Vec; to: Vec }
  /** A push that would have driven `unitId` back into its standing friend `supporterId`: braced, it holds its ground. */
  | { type: 'UnitSupported'; unitId: string; supporterId: string }
  /** A push that an Immovable `unitId` simply did not give way to: it holds its ground, on its feet. */
  | { type: 'UnitHeldGround'; unitId: string }
  /**
   * A Disloyal unit rolled a natural 1 on the nerve check just before this event
   * and changed sides: it now belongs to `to`, and has activated for the round.
   */
  | { type: 'UnitDefected'; unitId: string; to: Owner }
  /** Pushed off the edge of the map; the kill (or a Tough save) follows. */
  | { type: 'UnitPushedOff'; unitId: string }
  /**
   * Pushed into lava at `to`; the kill follows, and no Tough save helps. The
   * unit's position stays where it stood: it never lives on the lava hex.
   */
  | { type: 'UnitPushedIntoLava'; unitId: string; to: Vec }
  /** A flyer knocked down over lava falls into it rather than lying there; the kill follows. */
  | { type: 'UnitFellIntoLava'; unitId: string }
  | { type: 'UnitKilled'; unitId: string; byId: string | null }
  | { type: 'ActivationEnded'; unitId: string }
  /** In a group activation, `unitId` takes its turn with the `actions` the shared roll gave it. */
  | { type: 'GroupMemberActivated'; unitId: string; actions: number }
  | { type: 'RoundEnded'; round: number; nextLeader: Owner }
  /** `zone` (index into the conquest zones) is present only for conquest zone scoring. */
  | { type: 'ScoreChanged'; player: Owner; points: number; scores: [number, number]; zone?: number }
  /** Capture-the-flag: `player` is the flag's owner; `unitId` the enemy that took it. */
  | { type: 'FlagPickedUp'; player: Owner; unitId: string }
  /** Capture-the-flag: `player`'s flag falls from its knocked-down or slain carrier onto `at`. */
  | { type: 'FlagDropped'; player: Owner; unitId: string; at: Vec }
  /** Capture-the-flag: `unitId` returned its own side's (`player`'s) flag to base: it stepped onto it where it lay, or was carrying it when it changed sides. */
  | { type: 'FlagReturned'; player: Owner; unitId: string }
  /** Capture-the-flag: `player` carried the enemy flag home with `unitId` (and wins). */
  | { type: 'FlagCaptured'; player: Owner; unitId: string }
  /** `reason` is present only in an objective mode (see {@link ModeState}) or when a round limit ends the game. */
  | { type: 'GameOver'; winner: Owner; reason?: GameOverReason };

/** Why a game ended: last side standing, target score, round cap, king slain, flag captured, golden Pig fallen, or golden Pig extracted. */
export type GameOverReason = 'annihilation' | 'score' | 'roundLimit' | 'king' | 'flag' | 'pig' | 'extracted';

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}
