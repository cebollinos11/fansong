import { makeHexGrid, vecKey, type Board, type Vec } from './board.js';
import { canStrikeBack, computeCombatResult, highGroundBonus, COVER_PENALTY, isGruesome, rangePenalty } from './combat.js';
import {
  carryFlags,
  checkRoundLimit,
  dropFallenCarriers,
  fallenKingOwner,
  finishGame,
  flagsAfterMove,
  scoreZones,
} from './mode.js';
import { resolveCombatMorale } from './morale.js';
import { rollD6, rollDice } from './rng.js';
import {
  adjacentEnemies,
  inMelee,
  isOccupied,
  livingCount,
  occupiedKeys,
  outnumberedPenalty,
  playerHasAvailable,
  unitAvailable,
  unitById,
  walkRules,
} from './query.js';
import type { CombatResult, Command, GameEvent, GameState, Owner, ReduceResult, Unit } from './types.js';

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
      handleAttack(s, events, command.attackerId, command.targetId);
      break;
    case 'Shoot':
      handleShoot(s, events, command.attackerId, command.targetId);
      break;
    case 'Guard':
      handleGuard(s, events, command.unitId);
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
  let successes = 0;
  for (const d of dice) if (d >= unit.quality) successes++;
  const failures = diceCount - successes;
  events.push({ type: 'DiceRolled', unitId, quality: unit.quality, dice, successes, failures });

  // The twist: 2+ failures = turnover. The activation ends immediately and the
  // player is benched for the rest of the round. (With 1 die you can never
  // reach 2 failures, so a single die can never turn over.)
  if (failures >= TURNOVER_FAILURES) {
    s.benched[s.active] = true;
    events.push({ type: 'Turnover', player: s.active, unitId });
    s.activeUnitId = null;
    s.actionsRemaining = 0;
    advanceTurn(s, events);
    return;
  }

  // Successful activation: successes become action points.
  let actions = successes;
  if (unit.knockedDown && actions > 0) {
    // Standing up costs one action.
    unit.knockedDown = false;
    actions -= 1;
    events.push({ type: 'UnitStoodUp', unitId });
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
  if (!board.inBounds(to)) throw new Error('destination out of bounds');
  if (board.isBlocked(to)) throw new Error('destination blocked');
  if (board.distance(unit.pos, to) > unit.move) throw new Error('destination beyond move range');
  // Walks stop on entering contact with an enemy and never pass through one.
  const rules = walkRules(s, unit, board);
  if (!board.reachableWithin(unit.pos, unit.move, rules).has(vecKey(to))) {
    throw new Error('destination unreachable within move range');
  }
  if (isOccupied(s, to, unit.id)) throw new Error('destination occupied');
  const path = board.pathWithin(unit.pos, to, unit.move, rules)!;

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

function handleAttack(s: GameState, events: GameEvent[], attackerId: string, targetId: string): void {
  requirePhase(s, 'acting');
  const attacker = activeUnit(s);
  if (attacker.id !== attackerId) throw new Error(`unit '${attackerId}' is not the activating unit`);
  if (s.actionsRemaining <= 0) throw new Error('no actions remaining');

  const target = unitById(s, targetId);
  if (!target) throw new Error(`unknown target '${targetId}'`);
  if (target.dead) throw new Error('target already dead');
  if (target.owner === attacker.owner) throw new Error('cannot attack a friendly unit');

  const board = makeHexGrid(s.board);
  if (board.distance(attacker.pos, target.pos) !== 1) throw new Error('target not adjacent');

  // Guard reaction: a guarding defender strikes first. If the riposte kills or
  // knocks the attacker down, the incoming attack is prevented entirely.
  if (target.guarding && target.traits.guard) {
    const prevented = resolveRiposte(s, events, target, attacker, board);
    if (prevented) {
      s.actionsRemaining -= 1; // the attack action is spent even though it was repelled
      if (checkGameOver(s, events)) return;
      endActivation(s, events);
      return;
    }
  }

  const atk = rollD6(s.rngState);
  const def = rollD6(atk.state);
  s.rngState = def.state;
  const attackBonus = highGroundBonus(board, attacker, target);
  const defenseBonus = highGroundBonus(board, target, attacker);
  const attackOutnumbered = outnumberedPenalty(s, attacker, board);
  const defenseOutnumbered = outnumberedPenalty(s, target, board);
  const attackScore = attacker.combat + atk.die + attackBonus - attackOutnumbered;
  const defenseScore = target.combat + def.die + defenseBonus - defenseOutnumbered;
  const attackerRecoil = recoilHex(s, board, attacker, target);
  const targetRecoil = recoilHex(s, board, target, attacker);
  const result = computeCombatResult(
    { score: attackScore, die: atk.die, knockedDown: attacker.knockedDown, canRecoil: attackerRecoil !== null },
    { score: defenseScore, die: def.die, knockedDown: target.knockedDown, canRecoil: targetRecoil !== null },
  );
  const gruesome = gruesomeKill(result, attackScore, defenseScore);

  events.push({
    type: 'AttackResolved',
    attackerId,
    targetId,
    attackDie: atk.die,
    defenseDie: def.die,
    attackScore,
    defenseScore,
    ...(attackBonus ? { attackBonus } : {}),
    ...(defenseBonus ? { defenseBonus } : {}),
    ...(attackOutnumbered ? { attackOutnumbered } : {}),
    ...(defenseOutnumbered ? { defenseOutnumbered } : {}),
    result,
    ...(gruesome ? { gruesome } : {}),
  });

  let attackerEnded = false;
  switch (result) {
    case 'defenderKilled':
      strike(s, target, attacker.id, events, board, gruesome);
      break;
    case 'defenderKnockedDown':
      target.knockedDown = true;
      events.push({ type: 'UnitKnockedDown', unitId: target.id });
      break;
    case 'defenderRecoiled':
      recoil(s, events, target, targetRecoil!);
      break;
    case 'attackerKilled':
      strike(s, attacker, target.id, events, board, gruesome);
      attackerEnded = true;
      break;
    case 'attackerKnockedDown':
      attacker.knockedDown = true;
      events.push({ type: 'UnitKnockedDown', unitId: attacker.id });
      attackerEnded = true; // a knocked-down attacker's activation ends
      break;
    case 'attackerRecoiled':
      recoil(s, events, attacker, attackerRecoil!); // still standing, so it may act again
      break;
    case 'clash':
      break;
  }

  s.actionsRemaining -= 1;

  if (checkGameOver(s, events)) return;
  if (attackerEnded || s.actionsRemaining <= 0) endActivation(s, events);
}

// --- Shoot ----------------------------------------------------------------

function handleShoot(s: GameState, events: GameEvent[], attackerId: string, targetId: string): void {
  requirePhase(s, 'acting');
  const attacker = activeUnit(s);
  if (attacker.id !== attackerId) throw new Error(`unit '${attackerId}' is not the activating unit`);
  if (s.actionsRemaining <= 0) throw new Error('no actions remaining');
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

  const atk = rollD6(s.rngState);
  const def = rollD6(atk.state);
  s.rngState = def.state;
  const attackBonus = highGroundBonus(board, attacker, target);
  const defenseBonus = highGroundBonus(board, target, attacker);
  const range = rangePenalty(attacker.traits.ranged, d);
  const cover = board.inCover(attacker.pos, target.pos, (v) => occ.has(vecKey(v))) ? COVER_PENALTY : 0;
  const attackScore = attacker.combat + atk.die + attackBonus - range - cover;
  const defenseScore = target.combat + def.die + defenseBonus;

  const targetRecoil = recoilHex(s, board, target, attacker);
  let result = computeCombatResult(
    { score: attackScore, die: atk.die, knockedDown: attacker.knockedDown, canRecoil: false },
    { score: defenseScore, die: def.die, knockedDown: target.knockedDown, canRecoil: targetRecoil !== null },
  );
  // A shot only ever harms the target — the shooter takes no return damage.
  if (!result.startsWith('defender')) result = 'clash';
  const gruesome = gruesomeKill(result, attackScore, defenseScore);

  events.push({
    type: 'ShotResolved',
    attackerId,
    targetId,
    attackDie: atk.die,
    defenseDie: def.die,
    attackScore,
    defenseScore,
    ...(attackBonus ? { attackBonus } : {}),
    ...(defenseBonus ? { defenseBonus } : {}),
    ...(range ? { rangePenalty: range } : {}),
    ...(cover ? { coverPenalty: cover } : {}),
    result,
    ...(gruesome ? { gruesome } : {}),
  });

  if (result === 'defenderKilled') strike(s, target, attacker.id, events, board, gruesome);
  else if (result === 'defenderKnockedDown') {
    target.knockedDown = true;
    events.push({ type: 'UnitKnockedDown', unitId: target.id });
  } else if (result === 'defenderRecoiled') recoil(s, events, target, targetRecoil!);

  s.actionsRemaining -= 1;
  if (checkGameOver(s, events)) return;
  if (s.actionsRemaining <= 0) endActivation(s, events);
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

/**
 * A guarding unit's pre-emptive strike against an incoming melee attacker. The
 * guard is treated as the aggressor; only defender-side (attacker-harming)
 * outcomes matter — the guard never wounds itself parrying. Returns whether the
 * attack is prevented (attacker killed or knocked down).
 */
function resolveRiposte(s: GameState, events: GameEvent[], guard: Unit, attacker: Unit, board: Board): boolean {
  const gd = rollD6(s.rngState);
  const ad = rollD6(gd.state);
  s.rngState = ad.state;
  const guardBonus = highGroundBonus(board, guard, attacker);
  const attackerBonus = highGroundBonus(board, attacker, guard);
  const guardOutnumbered = outnumberedPenalty(s, guard, board);
  const attackerOutnumbered = outnumberedPenalty(s, attacker, board);
  const guardScore = guard.combat + gd.die + guardBonus - guardOutnumbered;
  const attackerScore = attacker.combat + ad.die + attackerBonus - attackerOutnumbered;
  const attackerRecoil = recoilHex(s, board, attacker, guard);
  // A knocked-down guard's riposte only lands on a natural 6.
  const result = canStrikeBack(guard.knockedDown, gd.die)
    ? computeCombatResult(
        { score: guardScore, die: gd.die, knockedDown: guard.knockedDown, canRecoil: false },
        { score: attackerScore, die: ad.die, knockedDown: attacker.knockedDown, canRecoil: attackerRecoil !== null },
      )
    : 'clash';
  const prevented = result.startsWith('defender');
  const gruesome = gruesomeKill(result, guardScore, attackerScore);

  events.push({
    type: 'GuardRiposte',
    guardId: guard.id,
    attackerId: attacker.id,
    guardDie: gd.die,
    attackerDie: ad.die,
    guardScore,
    attackerScore,
    ...(guardBonus ? { guardBonus } : {}),
    ...(attackerBonus ? { attackerBonus } : {}),
    ...(guardOutnumbered ? { guardOutnumbered } : {}),
    ...(attackerOutnumbered ? { attackerOutnumbered } : {}),
    result,
    ...(gruesome ? { gruesome } : {}),
    prevented,
  });

  if (result === 'defenderKilled') {
    strike(s, attacker, guard.id, events, board, gruesome);
  } else if (result === 'defenderKnockedDown' && !attacker.knockedDown) {
    attacker.knockedDown = true;
    events.push({ type: 'UnitKnockedDown', unitId: attacker.id });
  } else if (result === 'defenderRecoiled') recoil(s, events, attacker, attackerRecoil!);
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
  for (const hacker of adjacentEnemies(s, mover, board)) {
    if (hacker.knockedDown) continue;
    const atk = rollD6(s.rngState);
    const def = rollD6(atk.state);
    s.rngState = def.state;
    const attackBonus = highGroundBonus(board, hacker, mover);
    const defenseBonus = highGroundBonus(board, mover, hacker);
    const attackOutnumbered = outnumberedPenalty(s, hacker, board);
    const defenseOutnumbered = outnumberedPenalty(s, mover, board);
    const attackScore = hacker.combat + atk.die + attackBonus - attackOutnumbered;
    const defenseScore = mover.combat + def.die + defenseBonus - defenseOutnumbered;
    let result = computeCombatResult(
      { score: attackScore, die: atk.die, knockedDown: false, canRecoil: false },
      // A leaver always has somewhere to "recoil": the way it was going.
      { score: defenseScore, die: def.die, knockedDown: mover.knockedDown, canRecoil: true },
    );
    if (!result.startsWith('defender')) result = 'clash';
    const gruesome = gruesomeKill(result, attackScore, defenseScore);

    events.push({
      type: 'FreeHackResolved',
      attackerId: hacker.id,
      targetId: mover.id,
      attackDie: atk.die,
      defenseDie: def.die,
      attackScore,
      defenseScore,
      ...(attackBonus ? { attackBonus } : {}),
      ...(defenseBonus ? { defenseBonus } : {}),
      ...(attackOutnumbered ? { attackOutnumbered } : {}),
      ...(defenseOutnumbered ? { defenseOutnumbered } : {}),
      result,
      ...(gruesome ? { gruesome } : {}),
    });

    if (result === 'defenderKilled') {
      strike(s, mover, hacker.id, events, board, gruesome); // dead, or Tough-saved onto the ground
      return false;
    }
    if (result === 'defenderKnockedDown') {
      mover.knockedDown = true;
      events.push({ type: 'UnitKnockedDown', unitId: mover.id });
      return false;
    }
  }
  return true;
}

/** Whether `result` is a kill that tripled the loser, given the aggressor's and the defender's scores. */
function gruesomeKill(result: CombatResult, aggressorScore: number, defenderScore: number): boolean {
  if (result === 'defenderKilled') return isGruesome(aggressorScore, defenderScore);
  if (result === 'attackerKilled') return isGruesome(defenderScore, aggressorScore);
  return false;
}

/** Where `unit` recoils when beaten by `by`: the hex directly away, or null if off-board, impassable or occupied. */
function recoilHex(s: GameState, board: Board, unit: Unit, by: Unit): Vec | null {
  const to = board.stepAway(by.pos, unit.pos);
  return board.inBounds(to) && !board.isBlocked(to) && !isOccupied(s, to, unit.id) ? to : null;
}

function recoil(s: GameState, events: GameEvent[], unit: Unit, to: Vec): void {
  const from = { ...unit.pos };
  unit.pos = { x: to.x, y: to.y };
  carryFlags(s, unit);
  events.push({ type: 'UnitRecoiled', unitId: unit.id, from, to: { x: to.x, y: to.y } });
}

/**
 * A killing blow from combat: apply it (honouring Tough), and if the unit
 * actually dies, resolve the morale fallout — after a `gruesome` kill nearby
 * friends test nerve, and the warband may rout. Tough saves that downgrade the
 * blow to a knockdown are not a death, so they raise no morale check.
 */
function strike(
  s: GameState,
  unit: Unit,
  byId: string | null,
  events: GameEvent[],
  board: Board,
  gruesome: boolean,
): boolean {
  const died = resolveKill(unit, byId, events);
  if (died) resolveCombatMorale(s, events, unit, board, gruesome);
  return died;
}

/**
 * Apply a killing blow, honouring Tough: a tough unit that is not already
 * knocked down is knocked down instead (its one free save). Returns whether the
 * unit actually died. Morale-free — callers that represent a *combat* death use
 * {@link strike}.
 */
function resolveKill(unit: Unit, byId: string | null, events: GameEvent[]): boolean {
  if (unit.traits.tough && !unit.knockedDown) {
    unit.knockedDown = true;
    events.push({ type: 'ToughnessSaved', unitId: unit.id });
    events.push({ type: 'UnitKnockedDown', unitId: unit.id });
    return false;
  }
  kill(unit, byId, events);
  return true;
}

function kill(unit: Unit, byId: string | null, events: GameEvent[]): void {
  unit.dead = true;
  unit.knockedDown = false;
  events.push({ type: 'UnitKilled', unitId: unit.id, byId });
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
  s.round += 1;
  for (const u of s.units) u.activatedThisRound = false;
  s.benched = [false, false];
  s.initiativeLeader = other(s.initiativeLeader);
  s.active = s.initiativeLeader;
  s.phase = 'awaitingActivation';
  events.push({ type: 'RoundEnded', round: s.round, nextLeader: s.initiativeLeader });
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
