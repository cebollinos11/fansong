import type { Owner } from './types.js';

/**
 * Seeded, purely-functional RNG (mulberry32).
 *
 * The RNG *state* lives inside GameState so that a game is a deterministic
 * function of (seed + command list). Every draw returns the next state; nothing
 * is mutated in place.
 */

export interface RngDraw {
  /** A float in [0, 1). */
  value: number;
  /** The RNG state to thread into the next draw. */
  state: number;
}

/** Advance the RNG one step. */
export function rngNext(state: number): RngDraw {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: a };
}

export interface DieRoll {
  /** A d6 result in [1, 6]. */
  die: number;
  state: number;
}

/** Roll a single d6. */
export function rollD6(state: number): DieRoll {
  const { value, state: next } = rngNext(state);
  return { die: Math.floor(value * 6) + 1, state: next };
}

/** Roll `count` d6, returning all dice and the final RNG state. */
export function rollDice(state: number, count: number): { dice: number[]; state: number } {
  const dice: number[] = [];
  let s = state;
  for (let i = 0; i < count; i++) {
    const r = rollD6(s);
    dice.push(r.die);
    s = r.state;
  }
  return { dice, state: s };
}

/** Derive a well-mixed initial RNG state from a user-facing seed. */
export function seedRng(seed: number): number {
  // One mixing step so nearby seeds diverge immediately.
  return rngNext(seed | 0).state;
}

/**
 * The coin toss that decides who leads round 1: heads for player 0, tails for
 * player 1. Drawn from the game's own seed rather than its RNG state, so the
 * toss costs no draw (every roll in the game is unchanged), is the same for
 * everyone who holds the seed — both clients of an online room, and anyone
 * replaying the match — and is settled before the first unit moves.
 */
export function tossInitiative(seed: number): Owner {
  return rngNext(seedRng(seed)).value < 0.5 ? 0 : 1;
}
