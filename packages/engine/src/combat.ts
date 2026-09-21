import type { CombatResult } from './types.js';

/**
 * Resolve an opposed melee once scores are known. Pure and rng-free so the
 * outcome table can be unit-tested directly.
 *
 * - attacker doubles the defender -> defender killed
 * - attacker beats the defender    -> defender knocked down (killed if already down)
 * - defender doubles the attacker  -> attacker killed
 * - defender beats the attacker    -> attacker knocked down (killed if already down)
 * - tie                            -> clash (no effect)
 */
export function computeCombatResult(
  attackScore: number,
  defenseScore: number,
  defenderKnockedDown: boolean,
  attackerKnockedDown: boolean,
): CombatResult {
  if (attackScore >= defenseScore * 2) return 'defenderKilled';
  if (attackScore > defenseScore) return defenderKnockedDown ? 'defenderKilled' : 'defenderKnockedDown';
  if (defenseScore >= attackScore * 2) return 'attackerKilled';
  if (defenseScore > attackScore) return attackerKnockedDown ? 'attackerKilled' : 'attackerKnockedDown';
  return 'clash';
}
