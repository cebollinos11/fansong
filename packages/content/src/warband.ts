import { statErrors, unitCost, type Profile } from './cost.js';

/** A named unit profile within a warband roster. */
export interface WarbandUnit extends Profile {
  name: string;
  /**
   * Cosmetic: the preset unit this one is drawn as (e.g. `"Longbow"`). Omitted =
   * drawn by its own name. Free — it has no cost and no rules effect.
   */
  look?: string;
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

/**
 * Constraints for an army-builder army: no point limit, just a sane roster size.
 * Whether it fits a map's deploy zone is checked when the match is built.
 */
export const ARMY_RULES: WarbandRules = {
  budget: Infinity,
  minUnits: 1,
  maxUnits: 30,
};

/** Length limits on army-builder names (they cross the wire in online play). */
export const NAME_LIMITS = { warband: 40, unit: 32 } as const;

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

/**
 * Check an army-builder army: {@link validateWarband} under {@link ARMY_RULES}
 * (so no point limit), plus non-empty, bounded names.
 */
export function validateArmy(w: Warband): ValidationResult {
  const result = validateWarband(w, ARMY_RULES);
  const errors: string[] = [];
  if (w.name.trim() === '') errors.push('the army needs a name');
  if (w.name.length > NAME_LIMITS.warband) errors.push(`army name is over ${NAME_LIMITS.warband} characters`);
  w.units.forEach((u, i) => {
    if (u.name.trim() === '') errors.push(`unit ${i + 1} needs a name`);
    if (u.name.length > NAME_LIMITS.unit) errors.push(`${u.name}: name is over ${NAME_LIMITS.unit} characters`);
  });
  if (errors.length === 0) return result;
  return { ok: false, cost: result.cost, errors: [...errors, ...result.errors] };
}

/**
 * Structurally parse an untrusted warband (a saved army, an imported file).
 * Throws a friendly `Error` unless it has a name and a list of units with a
 * name and numeric stats; unknown keys are dropped (a legacy numeric `move`
 * becomes Slow or Fast). Stat ranges and roster
 * size are left to {@link validateArmy}.
 */
export function parseWarband(raw: unknown): Warband {
  if (!isRecord(raw)) throw new Error('Not an army.');
  if (typeof raw.name !== 'string') throw new Error('The army has no name.');
  if (!Array.isArray(raw.units)) throw new Error('The army has no unit list.');
  const units = raw.units.map((u: unknown, i): WarbandUnit => {
    if (!isRecord(u) || typeof u.name !== 'string') throw new Error(`Unit ${i + 1} has no name.`);
    const num = (k: string): number => {
      const v = u[k];
      if (typeof v !== 'number') throw new Error(`${u.name as string}: ${k} is not a number.`);
      return v;
    };
    const unit: WarbandUnit = { name: u.name, quality: num('quality'), combat: num('combat') };
    if (u.ranged !== undefined) unit.ranged = num('ranged');
    if (u.slow === true) unit.slow = true;
    if (u.fast === true) unit.fast = true;
    // Armies saved before Slow/Fast carried a raw Move against a baseline of 3.
    if (u.slow === undefined && u.fast === undefined && typeof u.move === 'number') {
      if (u.move < 3) unit.slow = true;
      if (u.move > 3) unit.fast = true;
    }
    if (u.tough === true) unit.tough = true;
    if (u.guard === true) unit.guard = true;
    if (u.big === true) unit.big = true;
    if (u.flying === true) unit.flying = true;
    if (u.reassembling === true) unit.reassembling = true;
    if (typeof u.look === 'string') unit.look = u.look;
    return unit;
  });
  return { name: raw.name, units };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
