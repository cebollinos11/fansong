import type { Vec } from './board.js';
import type { CombatResult, Unit } from './types.js';

/** One combatant's side of an opposed roll. */
export interface CombatSide {
  score: number;
  /** The natural (unmodified) d6. */
  die: number;
  knockedDown: boolean;
  /**
   * Whether a push can resolve without a fall: the hex directly behind it (away
   * from the opponent) is free, holds a standing friend to brace it, or is off
   * the map. False when terrain, an enemy or a knocked-down friend blocks it.
   */
  canRecoil: boolean;
}

/**
 * Resolve an opposed melee once scores are known. Pure and rng-free so the
 * outcome table can be unit-tested directly.
 *
 * - winner doubles the loser -> loser killed (see {@link isGruesome} for triples)
 * - winner beats the loser   -> loser already down: killed; else the winner's
 *                               natural die decides: odd = pushed one hex, even =
 *                               knocked down (a loser pushed into a blocked hex
 *                               falls; see `canRecoil` and the push in `reduce.ts`)
 * - tie                      -> clash (no effect)
 *
 * Modifiers (outnumbering, range, cover) can push a score to 0 or below, so a
 * kill needs a strict win *and* a double: any win over a score of 0 or less kills.
 *
 * A knocked-down defender only hurts the attacker on a natural 6 (see
 * {@link canStrikeBack}); any other defender win is a clash.
 */
export function computeCombatResult(attack: CombatSide, defense: CombatSide): CombatResult {
  if (attack.score > defense.score) {
    return attack.score >= defense.score * 2 ? 'defenderKilled' : `defender${beaten(defense, attack.die)}`;
  }
  if (!canStrikeBack(defense.knockedDown, defense.die)) return 'clash';
  if (defense.score > attack.score) {
    return defense.score >= attack.score * 2 ? 'attackerKilled' : `attacker${beaten(attack, defense.die)}`;
  }
  return 'clash';
}

/**
 * A gruesome kill: the winner's score is at least **triple** the loser's. Such a
 * death shakes the victim's friends (see `morale.ts`); an ordinary kill does not.
 */
export function isGruesome(winnerScore: number, loserScore: number): boolean {
  return winnerScore > loserScore && winnerScore >= loserScore * 3;
}

/**
 * What a **power blow** or an **aimed shot** costs: both actions of a two-action
 * activation, instead of the one an ordinary blow or shot costs.
 */
export const PRESSED_COST = 2;

/** How much worse a defender fights a power blow (a two-action melee attack). */
export const POWER_BLOW_PENALTY = 1;

/** How much worse a target defends against an aimed shot (a two-action shot). */
export const AIMED_SHOT_PENALTY = 1;

/** How much a Big model's size is worth in a melee against a smaller foe. */
export const BIG_MELEE_BONUS = 1;

/** How much easier a Big model is to hit with a shot. */
export const BIG_TARGET_BONUS = 1;

/** How much a flyer's swoop is worth in a melee it presses against a grounded foe. */
export const FLYING_MELEE_BONUS = 1;

/** How much a standing rider's horse is worth in a melee against a foe on foot. */
export const MOUNTED_MELEE_BONUS = 1;

/** How much easier an airborne flyer is to shoot: a target with no cover in the open sky. */
export const FLYING_TARGET_BONUS = 1;

/** Shooting penalty for a target beyond short range. */
export const LONG_RANGE_PENALTY = 1;

/** Shooting penalty for a target in partial cover (see `Board.inCover`). */
export const COVER_PENALTY = 1;

/** A shooter's short range: the first half of its reach, rounded up. */
export function shortRange(ranged: number): number {
  return Math.ceil(ranged / 2);
}

/** Range penalty for a shot at `distance` by a unit with reach `ranged`: 0 within short range, else {@link LONG_RANGE_PENALTY}. */
export function rangePenalty(ranged: number, distance: number): number {
  return distance > shortRange(ranged) ? LONG_RANGE_PENALTY : 0;
}

/**
 * The Big bonus for one side of a melee: {@link BIG_MELEE_BONUS} when it is Big
 * and its opponent is not, else 0. Unlike high ground it does not care whether
 * the model is on its feet — a fallen giant is still a giant — and two Big
 * models cancel out. Applies to every melee: blows, ripostes and free hacks.
 */
export function bigMeleeBonus(unit: Pick<Unit, 'traits'>, opponent: Pick<Unit, 'traits'>): number {
  return unit.traits.big && !opponent.traits.big ? BIG_MELEE_BONUS : 0;
}

/**
 * The bonus a shot gets for its target's size: {@link BIG_TARGET_BONUS} against
 * a Big target, else 0. Size makes a model easier to hit whoever is shooting, so
 * — unlike the melee bonus — a Big shooter gets it too.
 */
export function bigTargetBonus(target: Pick<Unit, 'traits'>): number {
  return target.traits.big ? BIG_TARGET_BONUS : 0;
}

/**
 * A flyer's swoop: {@link FLYING_MELEE_BONUS} when `unit` is a flyer striking a
 * grounded (non-flying) opponent, else 0. Only the aggressor of a melee ever
 * gets it — flying is an edge you press, not one you defend with. And unlike
 * size, the edge is the flight itself, so — like high ground — a knocked-down
 * flyer, brought to earth, loses it.
 */
export function flyingMeleeBonus(
  unit: Pick<Unit, 'traits' | 'knockedDown'>,
  opponent: Pick<Unit, 'traits'>,
): number {
  if (unit.knockedDown) return 0;
  return unit.traits.flying && !opponent.traits.flying ? FLYING_MELEE_BONUS : 0;
}

/**
 * The bonus a shot gets for its target being an airborne flyer:
 * {@link FLYING_TARGET_BONUS} against a flyer that is not knocked down, else 0.
 * A flyer in the open sky has nowhere to take cover, so it is easy to hit whoever
 * is shooting; brought down to the ground it is an ordinary target again.
 */
export function flyingTargetBonus(target: Pick<Unit, 'traits' | 'knockedDown'>): number {
  return target.traits.flying && !target.knockedDown ? FLYING_TARGET_BONUS : 0;
}

/**
 * The Mounted bonus for one side of a melee: {@link MOUNTED_MELEE_BONUS} when it
 * is Mounted and its opponent is not, else 0. Like size it counts on both sides
 * of every melee — blows, ripostes and free hacks — and two riders cancel out;
 * but like flight it is the horse that gives it, so a knocked-down rider loses it.
 */
export function mountedMeleeBonus(
  unit: Pick<Unit, 'traits' | 'knockedDown'>,
  opponent: Pick<Unit, 'traits'>,
): number {
  if (unit.knockedDown) return 0;
  return unit.traits.mounted && !opponent.traits.mounted ? MOUNTED_MELEE_BONUS : 0;
}

function beaten(loser: CombatSide, winnerDie: number): 'Killed' | 'KnockedDown' | 'Recoiled' {
  if (loser.knockedDown) return 'Killed';
  return winnerDie % 2 === 1 && loser.canRecoil ? 'Recoiled' : 'KnockedDown';
}

/** Whether a unit can hurt its opponent: always when standing, only on a natural 6 when knocked down. */
export function canStrikeBack(knockedDown: boolean, die: number): boolean {
  return !knockedDown || die === 6;
}

/**
 * High-ground bonus for one side of a combat: +1 when the combatant is standing
 * (not knocked down) on a strictly higher hex than its opponent, else 0.
 * Applies to melee attacks, guard ripostes and shots alike.
 */
export function highGroundBonus(
  board: { elevation(v: Vec): number },
  unit: Pick<Unit, 'pos' | 'knockedDown'>,
  opponent: Pick<Unit, 'pos'>,
): number {
  if (unit.knockedDown) return 0;
  return board.elevation(unit.pos) > board.elevation(opponent.pos) ? 1 : 0;
}
