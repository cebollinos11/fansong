import { vecKey, type Board, type Vec } from './board.js';
import type { GameState, Owner, Unit } from './types.js';

export function unitById(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function aliveUnits(state: GameState, owner?: Owner): Unit[] {
  return state.units.filter((u) => !u.dead && (owner === undefined || u.owner === owner));
}

export function enemiesOf(state: GameState, owner: Owner): Unit[] {
  return aliveUnits(state, owner === 0 ? 1 : 0);
}

/** Set of "x,y" keys occupied by a living unit. */
export function occupiedKeys(state: GameState, ignoreId?: string): Set<string> {
  const set = new Set<string>();
  for (const u of state.units) {
    if (u.dead || u.id === ignoreId) continue;
    set.add(vecKey(u.pos));
  }
  return set;
}

export function isOccupied(state: GameState, v: Vec, ignoreId?: string): boolean {
  return state.units.some((u) => !u.dead && u.id !== ignoreId && u.pos.x === v.x && u.pos.y === v.y);
}

/** Is `unit` adjacent to a living enemy (i.e. locked in melee)? Adjacency is a
 * board question (distance 1), so it never assumes a grid geometry. */
export function inMelee(state: GameState, unit: Unit, board: Board): boolean {
  return state.units.some(
    (u) => !u.dead && u.owner !== unit.owner && board.distance(u.pos, unit.pos) === 1,
  );
}

/** A unit that can still be activated this round. */
export function unitAvailable(u: Unit): boolean {
  return !u.dead && !u.activatedThisRound;
}

/** Does player `p` have a legal activation available (not benched, has a fresh unit)? */
export function playerHasAvailable(state: GameState, p: Owner): boolean {
  if (state.benched[p]) return false;
  return state.units.some((u) => u.owner === p && unitAvailable(u));
}

export function livingCount(state: GameState, owner: Owner): number {
  return state.units.reduce((n, u) => (!u.dead && u.owner === owner ? n + 1 : n), 0);
}
