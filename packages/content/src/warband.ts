import { statErrors, unitCost, type Profile } from './cost.js';

/** A named unit profile within a warband roster. */
export interface WarbandUnit extends Profile {
  name: string;
}

/** A roster: a name plus its units. Points are derived, never stored. */
export interface Warband {
  name: string;
  units: WarbandUnit[];
}

/** Constraints a legal warband must satisfy. */
export interface WarbandRules {
  /** Maximum total point cost. */
  budget: number;
  /** Fewest units allowed. */
  minUnits: number;
  /** Most units allowed. */
  maxUnits: number;
}

/** Default constraints for a standard FanSong skirmish. */
export const DEFAULT_RULES: WarbandRules = {
  budget: 200,
  minUnits: 3,
  maxUnits: 12,
};

/** Sum of every unit's {@link unitCost}. Ignores legality — see {@link validateWarband}. */
export function warbandCost(w: Warband): number {
  return w.units.reduce((sum, u) => sum + unitCost(u), 0);
}

export interface ValidationResult {
  ok: boolean;
  cost: number;
  errors: string[];
}

/**
 * Check a warband against its rules. Reports *all* problems (bad stats, roster
 * size, over budget) at once so a builder UI can surface them together.
 */
export function validateWarband(w: Warband, rules: WarbandRules = DEFAULT_RULES): ValidationResult {
  const errors: string[] = [];

  if (w.units.length < rules.minUnits)
    errors.push(`too few units: ${w.units.length} < ${rules.minUnits}`);
  if (w.units.length > rules.maxUnits)
    errors.push(`too many units: ${w.units.length} > ${rules.maxUnits}`);

  for (const unit of w.units) {
    for (const e of statErrors(unit)) errors.push(`${unit.name}: ${e}`);
  }

  // Cost is only meaningful when every stat is in range; otherwise unitCost can
  // return a misleading number, so gate the budget check on clean stats.
  const cost = errors.length === 0 ? warbandCost(w) : NaN;
  if (Number.isFinite(cost) && cost > rules.budget)
    errors.push(`over budget: ${cost} > ${rules.budget}`);

  return { ok: errors.length === 0, cost: Number.isFinite(cost) ? cost : warbandCostSafe(w), errors };
}

/** Best-effort cost even when some stats are invalid, for display alongside errors. */
function warbandCostSafe(w: Warband): number {
  return w.units.reduce((sum, u) => (statErrors(u).length === 0 ? sum + unitCost(u) : sum), 0);
}
