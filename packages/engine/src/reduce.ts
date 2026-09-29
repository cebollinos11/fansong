import { makeHexGrid, vecKey, type Board, type Vec } from './board.js';
import {
  AIMED_SHOT_PENALTY,
  armorHeld,
  bigMeleeBonus,
  bigTargetBonus,
  canStrikeBack,
  computeCombatResult,
  flyingMeleeBonus,
  flyingTargetBonus,
  highGroundBonus,
  COVER_PENALTY,
  isGruesome,
  masteryStruck,
  mountedMeleeBonus,
  opportunistBonus,
  sharpshooterBonus,
  POWER_BLOW_PENALTY,
  PRESSED_COST,
  rangePenalty,
  type CombatSide,
} from './combat.js';
import {
  captureIfHome,
  carryFlags,
  checkRoundLimit,
  dropFallenCarriers,
  fallenKingOwner,
  finishGame,
  flagsAfterMove,
  regrabOnStandUp,
  scoreZones,
} from './mode.js';
import { resolveCombatMorale, type FreeHacks } from './morale.js';
import { rollD6, rollDice } from './rng.js';
import {
  adjacentEnemies,
  airborne,
  canWarCry,
  inMelee,
  isOccupied,
  livingCount,
  occupiedKeys,
  outnumberedPenalty,
  playerHasAvailable,
  unitAvailable,
  unitById,
  unitMove,
  walkRules,
} from './query.js';
import type {
  AttackCommand,
  CombatResult,
  Command,
  GameEvent,
  GameState,
  Owner,
  ReduceResult,
  ShootCommand,
  Unit,
} from './types.js';

/** Turnover happens at 2 or more failed activation dice. */
export const TURNOVER_FAILURES = 2;

/**
 * The whole game: `reduce(state, command) -> { state, events }`, a pure
 * function. `state` is never mutated; a deep clone is advanced and returned.
 */
export function reduce(state: GameState, command: Command): ReduceResult {
  const s: GameState = structuredClone(state);
  const events: GameEvent[] = [];

  switch (command.type) {
    case 'ChooseActivation':
      handleChoose(s, events, command.unitId, command.diceCount);
      break;
    case 'Move':
      handleMove(s, events, command.unitId, command.to);
      break;
    case 'Attack':
      handleAttack(s, events, command);
      break;
    case 'Shoot':
      handleShoot(s, events, command);
      break;
    case 'Guard':
      handleGuard(s, events, command.unitId);
      break;
    case 'WarCry':
      handleWarCry(s, events, command.unitId);
      break;
    case 'EndActivation':
      handleEndActivation(s, events);
      break;
  }

  return { state: s, events };
}

const other = (p: Owner): Owner => (p === 0 ? 1 : 0);

function requirePhase(s: GameState, phase: GameState['phase']): void {
  if (s.phase !== phase) {
    throw new Error(`illegal command: expected phase '${phase}' but state is '${s.phase}'`);
  }
}

function activeUnit(s: GameState): Unit {
  const u = s.activeUnitId ? unitById(s, s.activeUnitId) : undefined;
  if (!u) throw new Error('no unit is currently activating');
  return u;
}

// --- Activation -----------------------------------------------------------

function handleChoose(s: GameState, events: GameEvent[], unitId: string, diceCount: number): void {
  requirePhase(s, 'awaitingActivation');
  const unit = unitById(s, unitId);
  if (!unit) throw new Error(`unknown unit '${unitId}'`);
  if (unit.owner !== s.active) throw new Error(`unit '${unitId}' is not the active player's`);
  if (!unitAvailable(unit)) throw new Error(`unit '${unitId}' is not available to activate`);
  if (s.benched[s.active]) throw new Error(`player ${s.active} is benched this round`);
  if (diceCount < 1 || diceCount > 3) throw new Error(`diceCount must be 1..3, got ${diceCount}`);

  unit.activatedThisRound = true;
  // Activating drops any Guard stance held from a previous round.
  unit.guarding = false;
  events.push({ type: 'ActivationChosen', player: s.active, unitId, diceCount });

  const { dice, state: rngState } = rollDice(s.rngState, diceCount);
  s.rngState = rngState;
  // An inspired unit's first die is a sure 6 (still drawn, so the RNG stream
  // doesn't depend on who is inspired). The inspiration is spent on this roll.
  const inspired = unit.inspired;
  if (inspired) {
    dice[0] = 6;
    unit.inspired = false;
  }
  let successes = 0;
  for (const d of dice) if (d >= unit.quality) successes++;
  const failures = diceCount - successes;
  events.push({
    type: 'DiceRolled',
    unitId,
    quality: unit.quality,
    dice,
    successes,
    failures,
    ...(inspired ? { inspired: true as const } : {}),
  });

  // The twist: 2+ failures = turnover. The player is benched for the rest of the
  // round, but the unit still takes the actions its successes earned first (3
  // dice with 1 success). (With 1 die you can never reach 2 failures, so a
  // single die can never turn over.)
  if (failures >= TURNOVER_FAILURES) {
    s.benched[s.active] = true;
    events.push({ type: 'Turnover', player: s.active, unitId });
    if (successes === 0) {
      s.activeUnitId = null;
      s.actionsRemaining = 0;
      advanceTurn(s, events);
      return;
    }
  }

  // Successes become action points.
  let actions = successes;
  if (unit.knockedDown && actions > 0) {
    // Standing up costs one action.
    unit.knockedDown = false;
    actions -= 1;
    events.push({ type: 'UnitStoodUp', unitId });
    regrabOnStandUp(s, events, unit);
  }

  s.activationCount += 1;
  s.activeUnitId = unitId;
  s.actionsRemaining = actions;

  if (actions <= 0) {
    endActivation(s, events);
    return;
  }
  s.phase = 'acting';
}

// --- Move -----------------------------------------------------------------

function handleMove(s: GameState, events: GameEvent[], unitId: string, to: { x: number; y: number }): void {
  requirePhase(s, 'acting');
  const unit = activeUnit(s);
  if (unit.id !== unitId) throw new Error(`unit '${unitId}' is not the activating unit`);
  if (s.actionsRemaining <= 0) throw new Error('no actions remaining');

  const board = makeHexGrid(s.board);
  const move = unitMove(unit);
  if (!board.inBounds(to)) throw new Error('destination out of bounds');
  if (board.isBlocked(to)) throw new Error('destination blocked');
  if (board.distance(unit.pos, to) > move) throw new Error('destination beyond move range');
  // Walks stop on entering contact with an enemy and never pass through one.
  const rules = walkRules(s, unit, board);
  if (!board.reachableWithin(unit.pos, move, rules).has(vecKey(to))) {
    throw new Error('destination unreachable within move range');
  }
  if (isOccupied(s, to, unit.id)) throw new Error('destination occupied');
  const path = board.pathWithin(unit.pos, to, move, rules)!;

  s.actionsRemaining -= 1;
  // Leaving contact: each standing enemy in contact takes a free hack first. A
  // leaver that is cut down or knocked down goes nowhere, and its activation ends.
  if (!resolveFreeHacks(s, events, unit, board)) {
    if (checkGameOver(s, events)) return;
    endActivation(s, events);
    return;
  }

  const from = { ...unit.pos };
  unit.pos = { x: to.x, y: to.y };
  events.push({ type: 'UnitMoved', unitId, from, to: { x: to.x, y: to.y }, path });
  if (flagsAfterMove(s, events, unitId)) return;

  if (s.actionsRemaining <= 0) endActivation(s, events);
}

// --- Attack ---------------------------------------------------------------

function handleAttack(s: GameState, events: GameEvent[], command: AttackCommand): void {
  const { attackerId, targetId } = command;
  requirePhase(s, 'acting');
  const attacker = activeUnit(s);
  if (attacker.id !== attackerId) throw new Error(`unit '${attackerId}' is not the activating unit`);
  // A power blow buys the defender's penalty with a second action.
  const cost = command.power ? PRESSED_COST : 1;
  const powerPenalty = command.power ? POWER_BLOW_PENALTY : 0;
  if (s.actionsRemaining < cost) throw new Error('not enough actions remaining');

  const target = unitById(s, targetId);
  if (!target) throw new Error(`unknown target '${targetId}'`);
  if (target.dead) throw new Error('target already dead');
  if (target.owner === attacker.owner) throw new Error('cannot attack a friendly unit');

  const board = makeHexGrid(s.board);
  if (board.distance(attacker.pos, target.pos) !== 1) throw new Error('target not adjacent');
  // Spent up front: the actions go even if the attack is repelled, and a push
  // can end the game (a carrier shoved home) before the blow is settled.
  s.actionsRemaining -= cost;

  // Guard reaction: a guarding defender strikes first. If the riposte kills or
  // knocks the attacker down, the incoming attack is prevented entirely.
  if (target.guarding && target.traits.guard) {
    // The guard strikes before the blow lands, so a power blow's penalty never
    // reaches the riposte — only the swing it was bought for.
    const prevented = resolveRiposte(s, events, target, attacker, board);
    // The attacker can also fall to a fleeing master's tie in the rout a
    // guard's death sets off (see `resolveFreeHacks`).
    const attackerDown = prevented || attacker.dead || attacker.knockedDown;
    // A master who ties the riposte cuts the guard down: that was the blow.
    if (attackerDown || target.dead) {
      if (checkGameOver(s, events)) return;
      if (attackerDown || s.actionsRemaining <= 0) endActivation(s, events);
      return;
    }
  }

  const roll = rollMelee(s, board, attacker, target, powerPenalty);
  const { attackDie, defenseDie, attackScore, defenseScore } = roll;
  const attackerPush = pushOutcome(s, board, attacker, target);
  const targetPush = pushOutcome(s, board, target, attacker);
  const attackSide: CombatSide = {
    score: attackScore,
    die: attackDie,
    knockedDown: attacker.knockedDown,
    canRecoil: canBePushed(attackerPush),
    armored: attacker.traits.armored,
    mastery: attacker.traits.mastery,
  };
  const defenseSide: CombatSide = {
    score: defenseScore,
    die: defenseDie,
    knockedDown: target.knockedDown,
    canRecoil: canBePushed(targetPush),
    armored: target.traits.armored,
    mastery: target.traits.mastery,
  };
  const result = computeCombatResult(attackSide, defenseSide);
  const gruesome = gruesomeKill(result, attacker, target, attackScore, defenseScore, attackerPush, targetPush);

  events.push({
    type: 'AttackResolved',
    attackerId,
    targetId,
    attackDie,
    defenseDie,
    attackScore,
    defenseScore,
    ...shown({ ...roll.mods, powerPenalty }),
    result,
    ...(gruesome ? { gruesome } : {}),
  });
  armorEvent(events, armorHeld(attackSide, defenseSide), attacker, target);
  masteryEvent(events, masteryStruck(attackSide, defenseSide), attacker, target);

  let attackerEnded = false;
  switch (result) {
    case 'defenderKilled':
    case 'defenderKnockedDown':
    case 'defenderRecoiled':
      hitDefender(s, events, result, target, attacker.id, board, gruesome, targetPush);
      break;
    case 'attackerKilled':
      strike(s, attacker, target.id, events, board, gruesome);
      attackerEnded = true;
      break;
    case 'attackerKnockedDown':
      knockDown(s, events, attacker, target.id, board);
      attackerEnded = true; // a knocked-down attacker's activation ends
      break;
    case 'attackerRecoiled':
      push(s, events, attacker, attackerPush, target.id, board, gruesome);
      // Pushed back or braced it is still standing, so it may act again; pushed
      // off the map it is dead (or, Tough, knocked down at the edge), and pushed
      // into lava it is dead for sure.
      attackerEnded = attacker.dead || attacker.knockedDown;
      break;
    case 'clash':
      break;
  }

  if (checkGameOver(s, events)) return;
  // A rout the blow set off can bring the attacker down too (see `resolveFreeHacks`).
  attackerEnded ||= attacker.dead || attacker.knockedDown;
  if (attackerEnded || s.actionsRemaining <= 0) endActivation(s, events);
}

// --- Shoot ----------------------------------------------------------------

function handleShoot(s: GameState, events: GameEvent[], command: ShootCommand): void {
  const { attackerId, targetId } = command;
  requirePhase(s, 'acting');
  const attacker = activeUnit(s);
  if (attacker.id !== attackerId) throw new Error(`unit '${attackerId}' is not the activating unit`);
  // An aimed shot spends a second action to steady the aim.
  const cost = command.aimed ? PRESSED_COST : 1;
  const aimPenalty = command.aimed ? AIMED_SHOT_PENALTY : 0;
  if (s.actionsRemaining < cost) throw new Error('not enough actions remaining');
  if (attacker.traits.ranged < 1) throw new Error('unit has no ranged attack');
  const board = makeHexGrid(s.board);
  if (inMelee(s, attacker, board)) throw new Error('cannot shoot while in melee');

  const target = unitById(s, targetId);
  if (!target) throw new Error(`unknown target '${targetId}'`);
  if (target.dead) throw new Error('target already dead');
  if (target.owner === attacker.owner) throw new Error('cannot shoot a friendly unit');

  const d = board.distance(attacker.pos, target.pos);
  if (d < 2) throw new Error('target too close to shoot');
  if (d > attacker.traits.ranged) throw new Error('target beyond ranged range');
  const occ = occupiedKeys(s);
  if (!board.lineOfSight(attacker.pos, target.pos, (v) => occ.has(vecKey(v))))
    throw new Error('no line of sight to target');

  // Spent up front, as the shot's push can end the game (a carrier shoved home).
  s.actionsRemaining -= cost;
  const { attackDie, defenseDie } = rollPair(s);
  const { attackBase, defenseBase, mods } = shotScoring(s, board, attacker, target, aimPenalty);
  const { attackBonus, defenseBonus, rangePenalty: range, coverPenalty: cover, bigTarget, flyingTarget } = mods;
  const { attackOpportunist, attackSharpshooter } = mods;
  const attackScore = attackBase + attackDie;
  const defenseScore = defenseBase + defenseDie;

  const targetPush = pushOutcome(s, board, target, attacker);
  // A shot only ever harms the target — the shooter takes no return damage.
  const shotSide: CombatSide = { score: attackScore, die: attackDie, knockedDown: attacker.knockedDown, canRecoil: false };
  const targetSide: CombatSide = {
    score: defenseScore,
    die: defenseDie,
    knockedDown: target.knockedDown,
    canRecoil: canBePushed(targetPush),
    armored: target.traits.armored,
  };
  const result = defenderOnly(computeCombatResult(shotSide, targetSide));
  const gruesome = gruesomeKill(result, attacker, target, attackScore, defenseScore, null, targetPush);

  events.push({
    type: 'ShotResolved',
    attackerId,
    targetId,
    attackDie,
    defenseDie,
    attackScore,
    defenseScore,
    ...shown({ attackBonus, defenseBonus, rangePenalty: range, coverPenalty: cover, bigTarget, flyingTarget, attackOpportunist, attackSharpshooter, aimPenalty }),
    result,
    ...(gruesome ? { gruesome } : {}),
  });
  // A shooter that loses the roll takes no harm anyway, so only the target's armor counts.
  armorEvent(events, targetOnly(armorHeld(shotSide, targetSide)), attacker, target);

  hitDefender(s, events, result, target, attacker.id, board, gruesome, targetPush);

  if (checkGameOver(s, events)) return;
  if (s.actionsRemaining <= 0) endActivation(s, events);
}

/** A shot's scores before the dice, and the modifiers behind them (see {@link handleShoot}). */
function shotScoring(s: GameState, board: Board, attacker: Unit, target: Unit, aimPenalty: number) {
  const occ = occupiedKeys(s);
  const mods = {
    attackBonus: highGroundBonus(board, attacker, target),
    defenseBonus: highGroundBonus(board, target, attacker),
    rangePenalty: rangePenalty(attacker.traits.ranged, board.distance(attacker.pos, target.pos)),
    coverPenalty: board.inCover(attacker.pos, target.pos, (v) => occ.has(vecKey(v))) ? COVER_PENALTY : 0,
    // A Big target is hard to miss, whoever is shooting at it.
    bigTarget: bigTargetBonus(target),
    // An airborne flyer has no cover in the open sky — easy to shoot down.
    flyingTarget: flyingTargetBonus(s, target),
    attackOpportunist: opportunistBonus(attacker, target),
    attackSharpshooter: sharpshooterBonus(attacker),
  };
  return {
    attackBase:
      attacker.combat +
      mods.attackBonus +
      mods.bigTarget +
      mods.flyingTarget +
      mods.attackOpportunist +
      mods.attackSharpshooter -
      mods.rangePenalty -
      mods.coverPenalty,
    defenseBase: target.combat + mods.defenseBonus - aimPenalty,
    mods,
  };
}

// --- Guard ----------------------------------------------------------------

function handleGuard(s: GameState, events: GameEvent[], unitId: string): void {
  requirePhase(s, 'acting');
  const unit = activeUnit(s);
  if (unit.id !== unitId) throw new Error(`unit '${unitId}' is not the activating unit`);
  if (!unit.traits.guard) throw new Error('unit cannot Guard');

  unit.guarding = true;
  events.push({ type: 'GuardDeclared', unitId });
  endActivation(s, events);
}

// --- War cry --------------------------------------------------------------

function handleWarCry(s: GameState, events: GameEvent[], unitId: string): void {
  requirePhase(s, 'acting');
  const unit = activeUnit(s);
  if (unit.id !== unitId) throw new Error(`unit '${unitId}' is not the activating unit`);
  if (!canWarCry(s, unit)) throw new Error('unit cannot war cry (not a Leader, knocked down, already cried this round, or its side is benched)');
  if (s.actionsRemaining <= 0) throw new Error('no actions remaining');

  s.actionsRemaining -= 1;
  unit.warCried = true;
  // Only a friend still to activate can use it; everyone else has had their roll.
  const inspired: string[] = [];
  for (const u of s.units) {
    if (u.owner !== unit.owner || u.dead || u.traits.leader || u.activatedThisRound) continue;
    u.inspired = true;
    inspired.push(u.id);
  }
  events.push({ type: 'WarCry', unitId, inspired });
  if (s.actionsRemaining <= 0) endActivation(s, events);
}

/**
 * A guarding unit's pre-emptive strike against an incoming melee attacker. The
 * guard is treated as the aggressor; only defender-side (attacker-harming)
 * outcomes matter — the guard never wounds itself parrying. Returns whether the
 * attack is prevented (the attacker killed, knocked down or pushed back).
 */
function resolveRiposte(s: GameState, events: GameEvent[], guard: Unit, attacker: Unit, board: Board): boolean {
  const roll = rollMelee(s, board, guard, attacker);
  const { attackDie: guardDie, defenseDie: attackerDie, attackScore: guardScore, defenseScore: attackerScore } = roll;
  const {
    attackBonus: guardBonus,
    defenseBonus: attackerBonus,
    attackOutnumbered: guardOutnumbered,
    defenseOutnumbered: attackerOutnumbered,
    attackBig: guardBig,
    defenseBig: attackerBig,
    attackFly: guardFly,
    attackMounted: guardMounted,
    defenseMounted: attackerMounted,
    attackOpportunist: guardOpportunist,
    defenseOpportunist: attackerOpportunist,
  } = roll.mods;
  const attackerPush = pushOutcome(s, board, attacker, guard);
  // A knocked-down guard's riposte only lands on a natural 6. And a guard never
  // wounds itself parrying, so only attacker-harming outcomes stand: losing the
  // exchange merely lets the blow in, and is reported — like a shot that draws
  // no return fire — as a clash.
  const guardSide: CombatSide = {
    score: guardScore,
    die: guardDie,
    knockedDown: guard.knockedDown,
    canRecoil: false,
    mastery: guard.traits.mastery,
  };
  const attackerSide: CombatSide = {
    score: attackerScore,
    die: attackerDie,
    knockedDown: attacker.knockedDown,
    canRecoil: canBePushed(attackerPush),
    armored: attacker.traits.armored,
    mastery: attacker.traits.mastery,
  };
  const lands = canStrikeBack(guard.knockedDown, guardDie);
  // The one way a guard *is* hurt parrying: an attacker's Combat Mastery on a tie.
  const master = masteryStruck(guardSide, attackerSide);
  const result = defenderOnly(lands || master ? computeCombatResult(guardSide, attackerSide) : 'clash', master);
  // An attacker braced by a friend is not driven back, so its blow still lands.
  const prevented = result.startsWith('defender') && !(result === 'defenderRecoiled' && attackerPush.kind === 'supported');
  const gruesome = gruesomeKill(result, guard, attacker, guardScore, attackerScore, null, attackerPush);

  events.push({
    type: 'GuardRiposte',
    guardId: guard.id,
    attackerId: attacker.id,
    guardDie,
    attackerDie,
    guardScore,
    attackerScore,
    ...shown({
      guardBonus,
      attackerBonus,
      guardOutnumbered,
      attackerOutnumbered,
      guardBig,
      attackerBig,
      guardFly,
      guardMounted,
      attackerMounted,
      guardOpportunist,
      attackerOpportunist,
    }),
    result,
    ...(gruesome ? { gruesome } : {}),
    prevented,
  });
  // A guard never wounds itself parrying, so only the attacker's armor counts.
  if (lands) armorEvent(events, targetOnly(armorHeld(guardSide, attackerSide)), guard, attacker);
  masteryEvent(events, master, guard, attacker);

  if (result === 'attackerKilled') strike(s, guard, attacker.id, events, board, gruesome);
  else hitDefender(s, events, result, attacker, guard.id, board, gruesome, attackerPush);
  return prevented;
}

// --- Free hacks -------------------------------------------------------------

/**
 * A unit leaving contact takes a free hack from every *standing* enemy in
 * contact with it, in unit order. Each is an opposed roll where only the leaver
 * can be hurt: a double kills it (or a Tough save knocks it down), an even-die
 * win knocks it down — either stops the move — and an odd-die win (a "recoil")
 * just lets it slip away. Returns whether the leaver may carry on moving.
 */
function resolveFreeHacks(s: GameState, events: GameEvent[], mover: Unit, board: Board): boolean {
  // A flyer lifts straight up out of contact — no ground blade can catch it.
  if (airborne(s, mover)) return true;
  for (const hacker of adjacentEnemies(s, mover, board)) {
    // A hacker already cut down, or put to flight, by an earlier hack's rout has no swing.
    if (hacker.knockedDown || hacker.dead || board.distance(hacker.pos, mover.pos) !== 1) continue;
    const roll = rollMelee(s, board, hacker, mover);
    const { attackDie, defenseDie, attackScore, defenseScore } = roll;
    // Only the leaver can be hurt — unless it is a master who ties the hacker.
    const hackSide: CombatSide = {
      score: attackScore,
      die: attackDie,
      knockedDown: false,
      canRecoil: false,
      mastery: hacker.traits.mastery,
    };
    // A leaver always has somewhere to "recoil": the way it was going.
    const leaverSide: CombatSide = {
      score: defenseScore,
      die: defenseDie,
      knockedDown: mover.knockedDown,
      canRecoil: true,
      armored: mover.traits.armored,
      mastery: mover.traits.mastery,
    };
    const master = masteryStruck(hackSide, leaverSide);
    const result = defenderOnly(computeCombatResult(hackSide, leaverSide), master);
    const gruesome = gruesomeKill(result, hacker, mover, attackScore, defenseScore, null, null);

    events.push({
      type: 'FreeHackResolved',
      attackerId: hacker.id,
      targetId: mover.id,
      attackDie,
      defenseDie,
      attackScore,
      defenseScore,
      ...shown(roll.mods),
      result,
      ...(gruesome ? { gruesome } : {}),
    });
    armorEvent(events, targetOnly(armorHeld(hackSide, leaverSide)), hacker, mover);
    masteryEvent(events, master, hacker, mover);
    // A master slipping away cuts down the hacker, and carries on — unless the
    // rout that death sets off wins the game or brings the master down too.
    if (result === 'attackerKilled') {
      strike(s, hacker, mover.id, events, board, gruesome);
      if (mover.dead || mover.knockedDown || checkGameOver(s, events)) return false;
      continue;
    }

    // A kill (or a Tough save onto the ground) and a knockdown both stop the
    // move; a recoil is just the leaver slipping away, so it carries on.
    hitDefender(s, events, result, mover, hacker.id, board, gruesome, null);
    if (result === 'defenderKilled' || result === 'defenderKnockedDown') return false;
  }
  return true;
}

// --- The shared shape of one opposed roll ---------------------------------

/**
 * The situational modifiers already folded into an opposed melee's scores. They
 * ride along so the event can report *why* a score is what it is.
 */
interface MeleeMods {
  attackBonus: number;
  defenseBonus: number;
  attackOutnumbered: number;
  defenseOutnumbered: number;
  attackBig: number;
  defenseBig: number;
  /** The aggressor's flying swoop (a flyer striking a grounded foe). Only ever the aggressor's — flying is pressed, not defended with. */
  attackFly: number;
  attackMounted: number;
  defenseMounted: number;
  attackOpportunist: number;
  defenseOpportunist: number;
}

/** One opposed melee: both dice, both scores, and the modifiers behind them. */
interface MeleeRoll {
  attackDie: number;
  defenseDie: number;
  attackScore: number;
  defenseScore: number;
  mods: MeleeMods;
}

/** Roll the aggressor's die then the defender's, advancing `s.rngState`. */
function rollPair(s: GameState): { attackDie: number; defenseDie: number } {
  const atk = rollD6(s.rngState);
  const def = rollD6(atk.state);
  s.rngState = def.state;
  return { attackDie: atk.die, defenseDie: def.die };
}

/**
 * Roll one opposed melee exchange (mutates `s.rngState`). Each side scores its
 * Combat plus its die, any high ground and any edge its size, flight, mount or opportunism gives it, less what
 * it is outnumbered by; `defensePenalty` (a power blow's) comes off the defender
 * on top. Every melee
 * in the game — an ordinary blow, a guard's riposte, a free hack — is scored
 * exactly this way, so none of them can drift from the others.
 */
function rollMelee(
  s: GameState,
  board: Board,
  aggressor: Unit,
  defender: Unit,
  defensePenalty = 0,
): MeleeRoll {
  const { attackDie, defenseDie } = rollPair(s);
  const { attackBase, defenseBase, mods } = meleeScoring(s, board, aggressor, defender, defensePenalty);
  return { attackDie, defenseDie, attackScore: attackBase + attackDie, defenseScore: defenseBase + defenseDie, mods };
}

/** An opposed melee's scores before the dice (see {@link rollMelee}), and the modifiers behind them. */
function meleeScoring(
  s: GameState,
  board: Board,
  aggressor: Unit,
  defender: Unit,
  defensePenalty = 0,
): { attackBase: number; defenseBase: number; mods: MeleeMods } {
  const mods: MeleeMods = {
    attackBonus: highGroundBonus(board, aggressor, defender),
    defenseBonus: highGroundBonus(board, defender, aggressor),
    attackOutnumbered: outnumberedPenalty(s, aggressor, board),
    defenseOutnumbered: outnumberedPenalty(s, defender, board),
    attackBig: bigMeleeBonus(aggressor, defender),
    defenseBig: bigMeleeBonus(defender, aggressor),
    attackFly: flyingMeleeBonus(s, aggressor, defender),
    attackMounted: mountedMeleeBonus(aggressor, defender),
    defenseMounted: mountedMeleeBonus(defender, aggressor),
    attackOpportunist: opportunistBonus(aggressor, defender),
    defenseOpportunist: opportunistBonus(defender, aggressor),
  };
  return {
    attackBase:
      aggressor.combat +
      mods.attackBonus +
      mods.attackBig +
      mods.attackFly +
      mods.attackMounted +
      mods.attackOpportunist -
      mods.attackOutnumbered,
    defenseBase:
      defender.combat +
      mods.defenseBonus +
      mods.defenseBig +
      mods.defenseMounted +
      mods.defenseOpportunist -
      mods.defenseOutnumbered -
      defensePenalty,
    mods,
  };
}

// --- Odds -------------------------------------------------------------------

/** How one attack is likely to go, as probabilities summing to 1. */
export interface CombatOdds {
  /** The target is hurt: killed, knocked down or pushed back. */
  win: number;
  /**
   * Among {@link win}, the target is killed outright (before any Tough save) —
   * lava included: pushed into it, or knocked out of the air over it.
   */
  kill: number;
  /** The attacker is hurt instead — by the target, or by its guard's riposte. */
  lose: number;
  /** Nobody is hurt. */
  clash: number;
}

export interface CombatOddsOptions {
  /** Shoot rather than strike in melee. */
  ranged?: boolean;
  /** A power blow / aimed shot. */
  pressed?: boolean;
  /** Where the attacker strikes from (a charge's last hex); defaults to where it stands. */
  from?: Vec;
}

/**
 * The odds of one attack or shot by `attackerId` on `targetId`, over all 36
 * pairs of dice, scored exactly as {@link reduce} scores them. A guarding
 * target's riposte is counted first. Free hacks provoked on the way in are not:
 * they may stop the charge before it is made. Does not mutate `state`.
 */
export function combatOdds(
  state: GameState,
  attackerId: string,
  targetId: string,
  options: CombatOddsOptions = {},
): CombatOdds {
  const from = options.from;
  const s: GameState = from
    ? { ...state, units: state.units.map((u) => (u.id === attackerId ? { ...u, pos: { ...from } } : u)) }
    : state;
  const attacker = unitById(s, attackerId);
  const target = unitById(s, targetId);
  if (!attacker || !target) throw new Error('unknown combatant');
  const board = makeHexGrid(s.board);
  const penalty = options.pressed ? (options.ranged ? AIMED_SHOT_PENALTY : POWER_BLOW_PENALTY) : 0;
  const { attackBase, defenseBase } = options.ranged
    ? shotScoring(s, board, attacker, target, penalty)
    : meleeScoring(s, board, attacker, target, penalty);

  // Mastery only ever turns melee ties into kills; a shot knows nothing of it.
  const attackerMastery = !options.ranged && attacker.traits.mastery;
  const targetMastery = !options.ranged && target.traits.mastery;

  // A guard's riposte stops the blow whenever it harms the attacker, unless a
  // braced attacker merely holds its ground against the push. An attacker's
  // Combat Mastery tying the riposte cuts the guard down before any blow.
  let through = 1;
  let lose = 0;
  let slain = 0;
  if (!options.ranged && target.guarding && target.traits.guard) {
    const riposte = meleeScoring(s, board, target, attacker);
    const braced = pushOutcome(s, board, attacker, target).kind === 'supported';
    let stopped = 0;
    for (let g = 1; g <= 6; g++) {
      for (let a = 1; a <= 6; a++) {
        const guardSide: CombatSide = {
          score: riposte.attackBase + g,
          die: g,
          knockedDown: target.knockedDown,
          canRecoil: false,
          mastery: targetMastery,
        };
        const attackerSide: CombatSide = {
          score: riposte.defenseBase + a,
          die: a,
          knockedDown: attacker.knockedDown,
          canRecoil: true,
          armored: attacker.traits.armored,
          mastery: attackerMastery,
        };
        const master = masteryStruck(guardSide, attackerSide);
        if (!canStrikeBack(target.knockedDown, g) && !master) continue;
        const result = computeCombatResult(guardSide, attackerSide);
        if (result === 'attackerKilled' && master === 'defense') slain++;
        else if (result.startsWith('defender') && !(result === 'defenderRecoiled' && braced)) stopped++;
      }
    }
    lose = stopped / 36;
    slain /= 36;
    through = 1 - lose - slain;
  }

  // Lava turns a push, or a flyer's knockdown over it, into a kill.
  const pushedIn = pushOutcome(s, board, target, attacker).kind === 'lava';
  const fallsIn = board.isDeadly(target.pos) && airborne(s, target);
  let win = 0;
  let kill = 0;
  let hurt = 0;
  for (let a = 1; a <= 6; a++) {
    for (let d = 1; d <= 6; d++) {
      const result = computeCombatResult(
        {
          score: attackBase + a,
          die: a,
          knockedDown: attacker.knockedDown,
          canRecoil: true,
          armored: attacker.traits.armored,
          mastery: attackerMastery,
        },
        {
          score: defenseBase + d,
          die: d,
          knockedDown: target.knockedDown,
          canRecoil: true,
          armored: target.traits.armored,
          mastery: targetMastery,
        },
      );
      if (result.startsWith('defender')) {
        win++;
        if (
          result === 'defenderKilled' ||
          (result === 'defenderRecoiled' && pushedIn) ||
          (result === 'defenderKnockedDown' && fallsIn)
        )
          kill++;
      } else if (result.startsWith('attacker') && !options.ranged) hurt++;
    }
  }
  win = slain + (through * win) / 36;
  lose += (through * hurt) / 36;
  return { win, kill: slain + (through * kill) / 36, lose, clash: Math.max(0, 1 - win - lose) };
}

/**
 * An outcome for a combat where only the defender can be hurt (a shot, a
 * riposte, a free hack): anything that would harm the aggressor is reported as
 * the clash it effectively is, so no event ever names damage the rules never
 * dealt. The one exception is the defender's Combat Mastery (`master` is
 * `'defense'`), whose tie kills the aggressor all the same.
 */
function defenderOnly(result: CombatResult, master: 'attack' | 'defense' | null = null): CombatResult {
  if (result === 'attackerKilled' && master === 'defense') return result;
  return result.startsWith('defender') ? result : 'clash';
}

/** {@link armorHeld} for a roll where only the defender can be hurt: the aggressor's armor never has anything to stop. */
function targetOnly(held: 'attack' | 'defense' | null): 'defense' | null {
  return held === 'defense' ? held : null;
}

/** Report whose armor turned the roll into a clash, if anyone's did. */
function armorEvent(events: GameEvent[], held: 'attack' | 'defense' | null, aggressor: Unit, defender: Unit): void {
  if (held) events.push({ type: 'ArmorHeld', unitId: (held === 'attack' ? aggressor : defender).id });
}

/** Report whose Combat Mastery turned a tie into a kill, if anyone's did. */
function masteryEvent(events: GameEvent[], master: 'attack' | 'defense' | null, aggressor: Unit, defender: Unit): void {
  if (master) events.push({ type: 'MasteryStruck', unitId: (master === 'attack' ? aggressor : defender).id });
}

/** Drop the zero modifiers, so an event only ever carries the ones that applied. */
function shown<K extends string>(mods: Record<K, number | undefined>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const key of Object.keys(mods) as K[]) {
    const value = mods[key];
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Apply a defender-side outcome to `victim` (mutates `s`): a killing blow
 * (honouring Tough and the morale that follows), a knockdown, or the push
 * `pushed` (null: the push does nothing, as for a leaver slipping away). Any
 * other `result` — including a clash — does nothing.
 */
function hitDefender(
  s: GameState,
  events: GameEvent[],
  result: CombatResult,
  victim: Unit,
  byId: string,
  board: Board,
  gruesome: boolean,
  pushed: Push | null,
): void {
  if (result === 'defenderKilled') strike(s, victim, byId, events, board, gruesome);
  else if (result === 'defenderKnockedDown') knockDown(s, events, victim, byId, board);
  else if (result === 'defenderRecoiled' && pushed) push(s, events, victim, pushed, byId, board, gruesome);
}

/**
 * Knock `unit` down (mutates `s`) — `byId` dealt the blow, or null. A flyer
 * brought down over lava falls into it instead and dies: no Tough save, and it
 * counts as a kill by `byId` (gruesome when a Savage struck it down).
 */
function knockDown(s: GameState, events: GameEvent[], unit: Unit, byId: string | null, board: Board): void {
  if (board.isDeadly(unit.pos)) {
    events.push({ type: 'UnitFellIntoLava', unitId: unit.id });
    const savage = byId !== null && (unitById(s, byId)?.traits.savage ?? false);
    strike(s, unit, byId, events, board, savage, true);
    return;
  }
  unit.knockedDown = true;
  unit.guarding = false; // flat on the ground is no stance to hold
  events.push({ type: 'UnitKnockedDown', unitId: unit.id });
}

/**
 * Whether `result` is a gruesome kill: one that tripled the loser, or any kill
 * by a Savage winner — a push off the map or into lava included (`aggressorPush` /
 * `defenderPush`: where a recoil would send each side; null when it can't kill).
 */
function gruesomeKill(
  result: CombatResult,
  aggressor: Unit,
  defender: Unit,
  aggressorScore: number,
  defenderScore: number,
  aggressorPush: Push | null,
  defenderPush: Push | null,
): boolean {
  switch (result) {
    case 'defenderKilled':
      return aggressor.traits.savage || isGruesome(aggressorScore, defenderScore);
    case 'attackerKilled':
      return defender.traits.savage || isGruesome(defenderScore, aggressorScore);
    case 'defenderRecoiled':
      return aggressor.traits.savage && pushKills(defenderPush);
    case 'attackerRecoiled':
      return defender.traits.savage && pushKills(aggressorPush);
    default:
      return false;
  }
}

/**
 * What pushing `unit` one hex directly away from `by` would do:
 * - `back`: the hex is free, so it recoils into it;
 * - `supported`: a standing friend holds that hex and braces it — it stays put, on its feet;
 * - `off`: the hex is off the map, so the push kills it;
 * - `lava`: the hex is empty lava and `unit` is not airborne, so the push kills
 *   it — and no Tough save helps (an airborne flyer just recoils over it);
 * - `blocked`: impassable terrain, an enemy or a knocked-down friend — it falls instead.
 */
type Push =
  | { kind: 'back'; to: Vec }
  | { kind: 'supported'; by: Unit }
  | { kind: 'off' }
  | { kind: 'lava'; to: Vec }
  | { kind: 'blocked' };

function pushOutcome(s: GameState, board: Board, unit: Unit, by: Unit): Push {
  const to = board.stepAway(by.pos, unit.pos);
  if (!board.inBounds(to)) return { kind: 'off' };
  if (board.isBlocked(to)) return { kind: 'blocked' };
  const there = s.units.find((u) => !u.dead && u.id !== unit.id && u.pos.x === to.x && u.pos.y === to.y);
  if (!there) return board.isDeadly(to) && !airborne(s, unit) ? { kind: 'lava', to } : { kind: 'back', to };
  return there.owner === unit.owner && !there.knockedDown ? { kind: 'supported', by: there } : { kind: 'blocked' };
}

/** Whether a push has somewhere to resolve other than a fall (see {@link pushOutcome}). */
const canBePushed = (p: Push) => p.kind !== 'blocked';

/** Whether a push is a killing one: off the map, or into lava. */
const pushKills = (p: Push | null) => p?.kind === 'off' || p?.kind === 'lava';

/**
 * Resolve a winning odd-die push on `unit` (mutates `s`): recoil into the free
 * hex, stand braced against a supporting friend, or go off the map or into lava
 * — a combat kill by `byId`, `gruesome` when a Savage did the shoving (at the
 * edge a Tough unit is knocked down instead; lava it does not survive).
 */
function push(
  s: GameState,
  events: GameEvent[],
  unit: Unit,
  p: Push,
  byId: string,
  board: Board,
  gruesome: boolean,
): void {
  if (p.kind === 'back') recoil(s, events, unit, p.to);
  else if (p.kind === 'supported') events.push({ type: 'UnitSupported', unitId: unit.id, supporterId: p.by.id });
  else if (p.kind === 'off') {
    events.push({ type: 'UnitPushedOff', unitId: unit.id });
    strike(s, unit, byId, events, board, gruesome);
  } else if (p.kind === 'lava') {
    // It keeps its last position in the state, so nothing (a dropped flag
    // included) ever lies on the lava; the event says where it went in.
    events.push({ type: 'UnitPushedIntoLava', unitId: unit.id, to: { x: p.to.x, y: p.to.y } });
    strike(s, unit, byId, events, board, gruesome, true);
  }
}

function recoil(s: GameState, events: GameEvent[], unit: Unit, to: Vec): void {
  const from = { ...unit.pos };
  unit.pos = { x: to.x, y: to.y };
  unit.guarding = false; // shoved out of position, stance broken
  carryFlags(s, unit);
  events.push({ type: 'UnitRecoiled', unitId: unit.id, from, to: { x: to.x, y: to.y } });
  // A carrier shoved onto its own base still gets the flag home.
  captureIfHome(s, events, unit);
}

/**
 * A killing blow from combat: apply it (honouring Tough, unless the death is
 * `certain` — lava), and if the unit actually dies, resolve the morale fallout —
 * after a `gruesome` kill nearby friends test nerve, and the warband may rout;
 * those that break and run take free hacks like any leaver. Tough saves that
 * downgrade the blow to a knockdown are not a death, so they raise no morale
 * check.
 */
function strike(
  s: GameState,
  unit: Unit,
  byId: string | null,
  events: GameEvent[],
  board: Board,
  gruesome: boolean,
  certain = false,
): void {
  if (!resolveKill(s, unit, byId, events, board, certain)) return;
  const hacks: FreeHacks = (runner) => resolveFreeHacks(s, events, runner, board);
  resolveCombatMorale(s, events, unit, board, gruesome, hacks);
}

/**
 * Apply a killing blow, honouring Tough: a tough unit that is not already
 * knocked down is knocked down instead (its one free save) — unless the death is
 * `certain`, or the unit hovers over lava, where being knocked down is death
 * anyway. Returns whether the unit actually died. Morale-free — callers that
 * represent a *combat* death use {@link strike}.
 */
function resolveKill(
  s: GameState,
  unit: Unit,
  byId: string | null,
  events: GameEvent[],
  board: Board,
  certain: boolean,
): boolean {
  if (unit.traits.tough && !unit.knockedDown && !certain && !board.isDeadly(unit.pos)) {
    events.push({ type: 'ToughnessSaved', unitId: unit.id });
    knockDown(s, events, unit, byId, board);
    return false;
  }
  unit.dead = true;
  unit.knockedDown = false;
  events.push({ type: 'UnitKilled', unitId: unit.id, byId });
  return true;
}

// --- Activation / round control ------------------------------------------

function handleEndActivation(s: GameState, events: GameEvent[]): void {
  requirePhase(s, 'acting');
  endActivation(s, events);
}

function endActivation(s: GameState, events: GameEvent[]): void {
  const endedId = s.activeUnitId;
  if (endedId) events.push({ type: 'ActivationEnded', unitId: endedId });
  s.activeUnitId = null;
  s.actionsRemaining = 0;
  advanceTurn(s, events);
}

/**
 * Decide who acts next after an activation ends (normally or via turnover).
 * Preference: hand off to the opponent; else the current player continues solo;
 * else the round ends.
 */
function advanceTurn(s: GameState, events: GameEvent[]): void {
  if (checkGameOver(s, events)) return;

  const current = s.active;
  const opp = other(current);

  if (playerHasAvailable(s, opp)) {
    s.active = opp;
    s.phase = 'awaitingActivation';
    return;
  }
  if (playerHasAvailable(s, current)) {
    // Solo continuation: opponent benched or exhausted.
    s.phase = 'awaitingActivation';
    return;
  }
  endRound(s, events);
}

function endRound(s: GameState, events: GameEvent[]): void {
  if (scoreZones(s, events) || checkRoundLimit(s, events)) return;
  // Whoever activated last this round goes second next round.
  const lastActivated = s.active;
  s.round += 1;
  for (const u of s.units) {
    u.activatedThisRound = false;
    // A war cry lasts the round it was cried in.
    u.inspired = false;
    u.warCried = false;
  }
  s.benched = [false, false];
  s.initiativeLeader = other(lastActivated);
  s.active = s.initiativeLeader;
  s.phase = 'awaitingActivation';
  events.push({ type: 'RoundEnded', round: s.round, nextLeader: s.initiativeLeader });
  // Reassembling bones haul themselves up before anyone acts: a free stand-up at
  // the top of the round, no action and no die spent.
  for (const u of s.units) {
    if (u.dead || !u.knockedDown || !u.traits.reassembling) continue;
    u.knockedDown = false;
    events.push({ type: 'UnitStoodUp', unitId: u.id, reassembled: true });
    regrabOnStandUp(s, events, u);
  }
}

function checkGameOver(s: GameState, events: GameEvent[]): boolean {
  if (s.phase === 'gameOver') return true;
  // Capture-the-flag: knocked-down and fallen carriers drop what they carry.
  dropFallenCarriers(s, events);
  // Kill-the-king: a fallen King loses at once, even with the warband intact.
  const kingless = fallenKingOwner(s);
  if (kingless !== undefined) {
    finishGame(s, events, other(kingless), 'king');
    return true;
  }
  const p0 = livingCount(s, 0);
  const p1 = livingCount(s, 1);
  if (p0 > 0 && p1 > 0) return false;
  finishGame(s, events, p0 > 0 ? 0 : 1, 'annihilation');
  return true;
}
