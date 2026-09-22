import type { Vec } from './board.js';
import type { CombatResult, Unit } from './types.js';

/** One combatant's side of an opposed roll. */
export interface CombatSide {
  score: number;
  /** The natural (unmodified) d6. */
  die: number;
  knockedDown: boolean;
  /** Whether the hex directly behind it (away from the opponent) is free to recoil into. */
  canRecoil: boolean;
}

/**
 * Resolve an opposed melee once scores are known. Pure and rng-free so the
 * outcome table can be unit-tested directly.
 *
 * - winner doubles the loser -> loser killed (see {@link isGruesome} for triples)
 * - winner beats the loser   -> loser already down: killed; else the winner's
 *                               natural die decides: odd = recoil one hex, even =
 *                               knocked down (a loser with no room to recoil falls)
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
