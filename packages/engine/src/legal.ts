import { makeSquareGrid, vecKey, type Vec } from './board.js';
import { enemiesOf, inMelee, isOccupied, occupiedKeys, unitAvailable, unitById } from './query.js';
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
    for (const u of state.units) {
      if (u.owner !== state.active || !unitAvailable(u)) continue;
      for (const diceCount of DICE_CHOICES) {
        commands.push({ type: 'ChooseActivation', unitId: u.id, diceCount });
      }
    }
    return commands;
  }

  // phase === 'acting'
  const commands: Command[] = [{ type: 'EndActivation' }];
  const unit = state.activeUnitId ? unitById(state, state.activeUnitId) : undefined;
  if (!unit || unit.dead || state.actionsRemaining <= 0) return commands;

  const board = makeSquareGrid(state.board);

  // Attacks: any adjacent living enemy.
  for (const enemy of enemiesOf(state, unit.owner)) {
    if (board.distance(unit.pos, enemy.pos) === 1) {
      commands.push({ type: 'Attack', attackerId: unit.id, targetId: enemy.id });
    }
  }

  // Shots: a ranged unit not itself in melee may fire on a non-adjacent enemy
  // within range and clear line of sight (intervening units block the lane).
  if (unit.traits.ranged >= 1 && !inMelee(state, unit)) {
    const occ = occupiedKeys(state);
    const seeThrough = (v: Vec) => occ.has(vecKey(v));
    for (const enemy of enemiesOf(state, unit.owner)) {
      const d = board.distance(unit.pos, enemy.pos);
      if (d >= 2 && d <= unit.traits.ranged && board.lineOfSight(unit.pos, enemy.pos, seeThrough)) {
        commands.push({ type: 'Shoot', attackerId: unit.id, targetId: enemy.id });
      }
    }
  }

  // Guard: a guard-capable unit may assume a defensive stance (ends its activation).
  if (unit.traits.guard) {
    commands.push({ type: 'Guard', unitId: unit.id });
  }

  // Moves: every empty, unblocked, in-bounds cell within move range.
  const r = unit.move;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const to: Vec = { x: unit.pos.x + dx, y: unit.pos.y + dy };
      if (!board.inBounds(to) || board.isBlocked(to)) continue;
      if (board.distance(unit.pos, to) > r) continue;
      if (isOccupied(state, to)) continue;
      commands.push({ type: 'Move', unitId: unit.id, to });
    }
  }

  return commands;
}
