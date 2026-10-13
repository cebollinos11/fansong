import { finishGame } from './mode.js';
import type { GameEvent, GameState, Owner } from './types.js';

/**
 * Forced surrender: as a new round begins, a side far enough behind on points
 * gives the game up. Optional state, like terrain and modes: a game set up
 * without it carries nothing and never surrenders.
 */
export interface SurrenderRule {
  /** A side surrenders only with at most this share of its starting points still living. */
  ownShare: number;
  /** ...and only when the other side's living points are at least this many times its own. */
  ratio: number;
}

/** The thresholds a game uses unless told otherwise (measured: see SURRENDER_PLAN.md). */
export const DEFAULT_SURRENDER: Readonly<SurrenderRule> = { ownShare: 0.3, ratio: 3 };

/** Slack for the share comparison, so a product like `0.3 * 130` never misses by a rounding error. */
const EPSILON = 1e-9;

/**
 * Summed point cost of player 0's and player 1's living units, by current
 * owner: a turncoat counts for its new side, and a unit knocked down or
 * transfixed counts in full. Units without points count nothing.
 */
export function livingPoints(state: GameState): [number, number] {
  const points: [number, number] = [0, 0];
  for (const u of state.units) if (!u.dead) points[u.owner] += u.points ?? 0;
  return points;
}

/**
 * Whether `side` is safe from a forced surrender: it has sounded the retreat,
 * or still can (it has somewhere to plant the flag, a living Leader, and nobody
 * has called a retreat yet).
 */
function mayRetreat(state: GameState, side: Owner): boolean {
  if (state.retreat) return state.retreat.owner === side;
  if (!state.retreatZones || state.retreatZones[side].length === 0) return false;
  return state.units.some((u) => !u.dead && u.owner === side && u.traits.leader);
}

/**
 * The side that would surrender if the round ended now, or `undefined`: the
 * one holding at most {@link SurrenderRule.ownShare} of its starting points
 * while the other holds at least {@link SurrenderRule.ratio} times as many. A
 * side that has retreated, or still can, is never forced. Always `undefined` in
 * a game set up without the rule, or one already over.
 */
export function surrenderingSide(state: GameState): Owner | undefined {
  const rule = state.surrender;
  if (!rule || state.phase === 'gameOver') return undefined;
  const living = livingPoints(state);
  for (const side of [0, 1] as const) {
    const foe: Owner = side === 0 ? 1 : 0;
    if (living[side] <= 0 || living[side] > rule.ownShare * rule.start[side] + EPSILON) continue;
    if (living[foe] < rule.ratio * living[side]) continue;
    if (mayRetreat(state, side)) continue;
    return side;
  }
  return undefined;
}

/**
 * The side that was forced to surrender, in a game that ended that way; else
 * `undefined`. The state keeps no reason for its ending, but only a surrender
 * ends a game at the top of a round, before anyone has activated, with both
 * sides still on the field.
 */
export function surrenderedSide(state: GameState): Owner | undefined {
  if (!state.surrender || state.phase !== 'gameOver' || state.winner === null) return undefined;
  if (state.units.some((u) => u.activatedThisRound)) return undefined;
  const loser: Owner = state.winner === 0 ? 1 : 0;
  return state.units.some((u) => !u.dead && u.owner === loser) ? loser : undefined;
}

/**
 * Called as a new round begins (mutates `s`): a side that must surrender does,
 * and the other wins. Returns whether the game ended.
 */
export function checkSurrender(s: GameState, events: GameEvent[]): boolean {
  const loser = surrenderingSide(s);
  if (loser === undefined) return false;
  finishGame(s, events, loser === 0 ? 1 : 0, 'surrender');
  return true;
}
