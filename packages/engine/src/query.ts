import { vecKey, type Board, type Vec, type WalkRules } from './board.js';
import type { GameState, Owner, Unit, UnitTraits } from './types.js';

/** Hexes per Move action of every unit that is neither Slow nor Fast. */
export const BASE_MOVE = 5;

/** How far the Slow and Fast traits shift a unit's Move from {@link BASE_MOVE}. */
export const SPEED_STEP = 2;

/** Max hexes `unit` walks per Move action: {@link BASE_MOVE}, shifted by Slow or Fast. */
export function unitMove(unit: { traits: Pick<UnitTraits, 'slow' | 'fast'> }): number {
  return BASE_MOVE + (unit.traits.fast ? SPEED_STEP : 0) - (unit.traits.slow ? SPEED_STEP : 0);
}

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

/** Living enemies of `unit` adjacent to it (in contact), in unit order. */
export function adjacentEnemies(state: GameState, unit: Unit, board: Board): Unit[] {
  return state.units.filter((u) => !u.dead && u.owner !== unit.owner && board.distance(u.pos, unit.pos) === 1);
}

/**
 * Outnumbering: a combatant fighting in melee takes −1 for each *standing* enemy
 * in contact with it beyond the first. Returns that penalty (0 when facing at
 * most one standing foe).
 */
export function outnumberedPenalty(state: GameState, unit: Unit, board: Board): number {
  const standing = adjacentEnemies(state, unit, board).filter((u) => !u.knockedDown).length;
  return Math.max(0, standing - 1);
}

/**
 * Whether `unit` is flying right now: a flyer, unless it is weighed down with a
 * flag (capture-the-flag) — a carrier goes on foot like anyone else.
 */
export function airborne(state: GameState, unit: Unit): boolean {
  return unit.traits.flying && !state.mode?.flags?.some((f) => f.carrier === unit.id);
}

/**
 * How `unit` may walk: never through an enemy's hex, and a walk that enters a
 * hex in contact with any living enemy stops there. Leaving contact from the
 * start hex is allowed (it provokes free hacks — see `reduce`).
 */
export function walkRules(state: GameState, unit: Unit, board: Board): WalkRules {
  // A flyer moves over everything — terrain and friend and foe — and is only
  // bound by where it may *land* (the caller's occupancy/terrain check on the
  // destination). So no hex bars it and none halts it; it phases through.
  if (airborne(state, unit)) return { phaseThrough: true };
  const enemyHexes = new Set<string>();
  const contact = new Set<string>();
  for (const e of state.units) {
    if (e.dead || e.owner === unit.owner) continue;
    enemyHexes.add(vecKey(e.pos));
    for (const n of board.neighbors(e.pos)) contact.add(vecKey(n));
  }
  return {
    passable: (v) => !enemyHexes.has(vecKey(v)),
    stops: (v) => contact.has(vecKey(v)),
  };
}

/** Every hex `unit` can reach with one Move action (ignoring occupancy of the destination). */
export function moveReach(state: GameState, unit: Unit, board: Board): Set<string> {
  return board.reachableWithin(unit.pos, unitMove(unit), walkRules(state, unit, board));
}
