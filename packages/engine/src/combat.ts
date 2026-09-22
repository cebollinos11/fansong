import type { Vec } from './board.js';
import type { CombatResult, Unit } from './types.js';

/**
 * Resolve an opposed melee once scores are known. Pure and rng-free so the
 * outcome table can be unit-tested directly.
 *
 * - attacker doubles the defender -> defender killed
 * - attacker beats the defender    -> defender knocked down (killed if already down)
 * - defender doubles the attacker  -> attacker killed
 * - defender beats the attacker    -> attacker knocked down (killed if already down)
 * - tie                            -> clash (no effect)
 *
 * A knocked-down defender only hurts the attacker on a natural 6 (see
 * {@link canStrikeBack}); any other defender win is a clash.
 */
export function computeCombatResult(
  attackScore: number,
  defenseScore: number,
  defenderKnockedDown: boolean,
  attackerKnockedDown: boolean,
  defenseDie: number,
): CombatResult {
  if (attackScore >= defenseScore * 2) return 'defenderKilled';
  if (attackScore > defenseScore) return defenderKnockedDown ? 'defenderKilled' : 'defenderKnockedDown';
  if (!canStrikeBack(defenderKnockedDown, defenseDie)) return 'clash';
  if (defenseScore >= attackScore * 2) return 'attackerKilled';
  if (defenseScore > attackScore) return attackerKnockedDown ? 'attackerKilled' : 'attackerKnockedDown';
  return 'clash';
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
