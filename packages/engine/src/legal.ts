import { makeHexGrid, vecKey, type Vec } from './board.js';
import { PRESSED_COST } from './combat.js';
import { canWarCry, enemiesOf, groupFor, inMelee, isOccupied, maxActivationDice, moveReach, occupiedKeys, unitAvailable, unitById, unitMove } from './query.js';
import type { Command, GameState } from './types.js';

/** Dice a player may commit to an activation. */
export const DICE_CHOICES = [1, 2, 3] as const;

/**
 * Enumerate every legal command for the active player in the current state.
 * The AI, tests, and any UI all pick from this list, so ordering is kept
 * deterministic (unit order, then dice/coordinates ascending).
 */
export function getLegalCommands(state: GameState): Command[] {
  if (state.phase === 'gameOver') return [];

  if (state.phase === 'awaitingActivation') {
    if (state.benched[state.active]) return [];
    const commands: Command[] = [];
    const board = makeHexGrid(state.board);
    for (const u of state.units) {
      if (u.owner !== state.active || !unitAvailable(u)) continue;
      // A Dumb unit is offered fewer dice (and so is its group: they are all alike).
      const choices = DICE_CHOICES.filter((n) => n <= maxActivationDice(u));
      for (const diceCount of choices) {
        commands.push({ type: 'ChooseActivation', unitId: u.id, diceCount });
      }
      // With friends like it close by, the unit may activate them all on one roll.
      if (groupFor(state, u, board).length === 0) continue;
      for (const diceCount of choices) {
        commands.push({ type: 'ChooseActivation', unitId: u.id, diceCount, group: true });
      }
    }
    return commands;
  }

  // phase === 'acting'
  const commands: Command[] = [{ type: 'EndActivation' }];
  const unit = state.activeUnitId ? unitById(state, state.activeUnitId) : undefined;
  if (!unit || unit.dead || state.actionsRemaining <= 0) return commands;

  // Group activation: until the active member does something, any waiting
  // member may take its place, so the player sets the order they act in.
  if (state.group && state.actionsRemaining === state.group.allotted) {
    for (const p of state.group.pending) {
      if (!unitById(state, p.unitId)?.dead) commands.push({ type: 'SwitchGroupMember', unitId: p.unitId });
    }
  }

  const board = makeHexGrid(state.board);

  // A unit with two actions in hand may spend both on one pressed blow or shot:
  // a power blow / aimed shot, which its target defends at a penalty.
  const canPress = state.actionsRemaining >= PRESSED_COST;

  // Attacks: any adjacent living enemy, ordinarily or as a power blow.
  for (const enemy of enemiesOf(state, unit.owner)) {
    if (board.distance(unit.pos, enemy.pos) === 1) {
      commands.push({ type: 'Attack', attackerId: unit.id, targetId: enemy.id });
      if (canPress) commands.push({ type: 'Attack', attackerId: unit.id, targetId: enemy.id, power: true });
    }
  }

  // Shots: a ranged unit not itself in melee may fire on a non-adjacent enemy
  // within range and clear line of sight (intervening units block the lane).
  if (unit.traits.ranged >= 1 && !inMelee(state, unit, board)) {
    const occ = occupiedKeys(state);
    const seeThrough = (v: Vec) => occ.has(vecKey(v));
    for (const enemy of enemiesOf(state, unit.owner)) {
      const d = board.distance(unit.pos, enemy.pos);
      if (d >= 2 && d <= unit.traits.ranged && board.lineOfSight(unit.pos, enemy.pos, seeThrough)) {
        commands.push({ type: 'Shoot', attackerId: unit.id, targetId: enemy.id });
        if (canPress) commands.push({ type: 'Shoot', attackerId: unit.id, targetId: enemy.id, aimed: true });
      }
    }
  }

  // Guard: a guard-capable unit may assume a defensive stance (ends its activation).
  if (unit.traits.guard) {
    commands.push({ type: 'Guard', unitId: unit.id });
  }

  // War cry: a Leader on its feet, once a round, spends an action to inspire its friends.
  if (canWarCry(state, unit)) {
    commands.push({ type: 'WarCry', unitId: unit.id });
  }

  // Moves: every empty cell reachable within move range by walking around
  // impassable hexes. Friends don't block the path (only the destination); an
  // enemy's hex can't be crossed, and entering contact with an enemy ends the
  // walk. Enumerated in `cellsWithin` order so the command list stays deterministic.
  const reach = moveReach(state, unit, board);
  for (const to of board.cellsWithin(unit.pos, unitMove(unit))) {
    if (!reach.has(vecKey(to))) continue;
    // A flyer's reach includes hexes it only phased over; it still may not land
    // on impassable terrain (or an occupied hex). For a walker these never occur.
    if (board.isBlocked(to) || isOccupied(state, to)) continue;
    commands.push({ type: 'Move', unitId: unit.id, to });
  }

  return commands;
}
