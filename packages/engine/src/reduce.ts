import { makeSquareGrid } from './board.js';
import { computeCombatResult } from './combat.js';
import { rollD6, rollDice } from './rng.js';
import { isOccupied, livingCount, playerHasAvailable, unitAvailable, unitById } from './query.js';
import type { Command, GameEvent, GameState, Owner, ReduceResult, Unit } from './types.js';

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

  const board = makeSquareGrid(s.board);
  if (!board.inBounds(to)) throw new Error('destination out of bounds');
  if (board.isBlocked(to)) throw new Error('destination blocked');
  if (board.distance(unit.pos, to) > unit.move) throw new Error('destination beyond move range');
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

  const board = makeSquareGrid(s.board);
  if (board.distance(attacker.pos, target.pos) !== 1) throw new Error('target not adjacent');

  const atk = rollD6(s.rngState);
  const def = rollD6(atk.state);
  s.rngState = def.state;
  const attackScore = attacker.combat + atk.die;
  const defenseScore = target.combat + def.die;
  const result = computeCombatResult(attackScore, defenseScore, target.knockedDown, attacker.knockedDown);

  events.push({
    type: 'AttackResolved',
    attackerId,
    targetId,
    attackDie: atk.die,
    defenseDie: def.die,
    attackScore,
    defenseScore,
    result,
  });

  let attackerEnded = false;
  switch (result) {
    case 'defenderKilled':
      kill(target, attacker.id, events);
      break;
    case 'defenderKnockedDown':
      target.knockedDown = true;
      events.push({ type: 'UnitKnockedDown', unitId: target.id });
      break;
    case 'attackerKilled':
      kill(attacker, target.id, events);
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
  const winner: Owner = p0 > 0 ? 0 : 1;
  s.winner = winner;
  s.phase = 'gameOver';
  s.activeUnitId = null;
  s.actionsRemaining = 0;
  events.push({ type: 'GameOver', winner });
  return true;
}
