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

/** A group activation reaches this many hexes from the unit picked to activate. */
export const GROUP_RADIUS = 2;

/** Most units one group activation can hold, the picked unit included. */
export const GROUP_MAX = 5;

/**
 * Whether two units are "the same unit" for a group activation: the same
 * Quality, Combat and traits, drawn with the same sprite and tint. Names may
 * differ (a roster numbers its copies).
 */
export function sameProfile(a: Unit, b: Unit): boolean {
  if (a.quality !== b.quality || a.combat !== b.combat) return false;
  if ((a.look ?? a.name) !== (b.look ?? b.name) || a.tint !== b.tint) return false;
  for (const key of Object.keys(a.traits) as (keyof UnitTraits)[]) {
    if (a.traits[key] !== b.traits[key]) return false;
  }
  return true;
}

/**
 * The group `unit` would activate with: itself first, then every friend like
 * it (see {@link sameProfile}) still to activate within {@link GROUP_RADIUS},
 * nearest first (ties in unit order), up to {@link GROUP_MAX} in all. A
 * knocked-down unit neither calls a group nor joins one: it has to get up on
 * a roll of its own. Empty when the unit has no one to group with.
 */
export function groupFor(state: GameState, unit: Unit, board: Board): Unit[] {
  if (!unitAvailable(unit) || unit.knockedDown) return [];
  const near = state.units
    .filter((u) => u.id !== unit.id && u.owner === unit.owner && unitAvailable(u) && !u.knockedDown && sameProfile(u, unit))
    .map((u) => ({ u, d: board.distance(u.pos, unit.pos) }))
    .filter((e) => e.d <= GROUP_RADIUS)
    .sort((a, b) => a.d - b.d)
    .slice(0, GROUP_MAX - 1);
  return near.length === 0 ? [] : [unit, ...near.map((e) => e.u)];
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
 * most one standing foe). A Whirling unit on its feet is never outnumbered.
 */
export function outnumberedPenalty(state: GameState, unit: Unit, board: Board): number {
  if (unit.traits.whirling && !unit.knockedDown) return 0;
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
 * Whether `unit` leaves contact without drawing a free hack: an airborne flyer
 * lifts out of reach, and a Slippery unit ducks away — unless, like the flyer,
 * it is weighed down with a flag.
 */
export function slipsAway(state: GameState, unit: Unit): boolean {
  if (airborne(state, unit)) return true;
  return unit.traits.slippery && !state.mode?.flags?.some((f) => f.carrier === unit.id);
}

/** Most activation dice any unit may roll. */
export const MAX_DICE = 3;

/** Most activation dice a Dumb unit may roll. */
export const DUMB_MAX_DICE = 2;

/** Most activation dice `unit` may roll: {@link MAX_DICE}, or {@link DUMB_MAX_DICE} if it is Dumb. */
export function maxActivationDice(unit: { traits: Pick<UnitTraits, 'dumb'> }): number {
  return unit.traits.dumb ? DUMB_MAX_DICE : MAX_DICE;
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

/**
 * Whether `unit` may war cry: a living Leader on its feet that hasn't cried yet
 * this round, whose side isn't benched — after a turnover no friend can
 * activate again this round, so there is no one left to inspire. (Being the
 * activating unit, with an action to spend, is checked by the caller.)
 */
export function canWarCry(state: GameState, unit: Unit): boolean {
  return unit.traits.leader && !unit.dead && !unit.knockedDown && !unit.warCried && !state.benched[unit.owner];
}
