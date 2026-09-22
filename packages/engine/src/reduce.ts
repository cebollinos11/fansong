import { makeHexGrid, vecKey, type Board } from './board.js';
import { computeCombatResult, highGroundBonus } from './combat.js';
import { checkRoundLimit, finishGame } from './mode.js';
import { resolveCombatMorale } from './morale.js';
import { rollD6, rollDice } from './rng.js';
import { inMelee, isOccupied, livingCount, occupiedKeys, playerHasAvailable, unitAvailable, unitById } from './query.js';
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
  if (!board.reachableWithin(unit.pos, unit.move).has(vecKey(to))) {
    throw new Error('destination unreachable within move range');
  }
  if (isOccupied(s, to, unit.id)) throw new Error('destination occupied');

  const from = { ...unit.pos };
  unit.pos = { x: to.x, y: to.y };
  s.actionsRemaining -= 1;
  events.push({ type: 'UnitMoved', unitId, from, to: { x: to.x, y: to.y } });

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
  const attackScore = attacker.combat + atk.die + attackBonus;
  const defenseScore = target.combat + def.die + defenseBonus;
  const result = computeCombatResult(attackScore, defenseScore, target.knockedDown, attacker.knockedDown);

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
    result,
  });

  let attackerEnded = false;
  switch (result) {
    case 'defenderKilled':
      strike(s, target, attacker.id, events, board);
      break;
    case 'defenderKnockedDown':
      target.knockedDown = true;
      events.push({ type: 'UnitKnockedDown', unitId: target.id });
      break;
    case 'attackerKilled':
      strike(s, attacker, target.id, events, board);
      attackerEnded = true;
      break;
    case 'attackerKnockedDown':
      attacker.knockedDown = true;
      events.push({ type: 'UnitKnockedDown', unitId: attacker.id });
      attackerEnded = true; // a knocked-down attacker's activation ends
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
  const attackScore = attacker.combat + atk.die + attackBonus;
  const defenseScore = target.combat + def.die + defenseBonus;

  // A shot only ever harms the target — the shooter takes no return damage.
  let result: CombatResult = 'clash';
  if (attackScore >= defenseScore * 2) result = 'defenderKilled';
  else if (attackScore > defenseScore) result = target.knockedDown ? 'defenderKilled' : 'defenderKnockedDown';

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
    result,
  });

  if (result === 'defenderKilled') strike(s, target, attacker.id, events, board);
  else if (result === 'defenderKnockedDown') {
    target.knockedDown = true;
    events.push({ type: 'UnitKnockedDown', unitId: target.id });
  }

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
  const guardScore = guard.combat + gd.die + guardBonus;
  const attackerScore = attacker.combat + ad.die + attackerBonus;
  const result = computeCombatResult(guardScore, attackerScore, attacker.knockedDown, guard.knockedDown);
  const prevented = result === 'defenderKilled' || result === 'defenderKnockedDown';

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
    result,
    prevented,
  });

  if (result === 'defenderKilled') {
    strike(s, attacker, guard.id, events, board);
  } else if (result === 'defenderKnockedDown' && !attacker.knockedDown) {
    attacker.knockedDown = true;
    events.push({ type: 'UnitKnockedDown', unitId: attacker.id });
  }
  return prevented;
}

/**
 * A killing blow from combat: apply it (honouring Tough), and if the unit
 * actually dies, resolve the morale fallout — nearby friends test nerve, and the
 * warband may rout. Tough saves that downgrade the blow to a knockdown are not a
 * death, so they raise no morale check.
 */
function strike(s: GameState, unit: Unit, byId: string | null, events: GameEvent[], board: Board): boolean {
  const died = resolveKill(unit, byId, events);
  if (died) resolveCombatMorale(s, events, unit, board);
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
  if (checkRoundLimit(s, events)) return;
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
  const p0 = livingCount(s, 0);
  const p1 = livingCount(s, 1);
  if (p0 > 0 && p1 > 0) return false;
  finishGame(s, events, p0 > 0 ? 0 : 1, 'annihilation');
  return true;
}
