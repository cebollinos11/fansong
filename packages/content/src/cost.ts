import { unitMove } from '@fansong/engine';

/**
 * Point-buy costing. A unit's cost is derived purely from what the engine
 * actually simulates — Quality, Combat, Move and the special traits — so a point total is
 * an honest measure of battlefield value with no unimplemented "paper" traits.
 *
 * The formula is the official Song of Blades and Heroes one: Combat and the
 * special traits are summed, then scaled by a Quality multiplier (see {@link unitCost}).
 */

/** The stats a costed unit profile is built from. See engine `Unit`. */
export interface Profile {
  /** Activation target: a die succeeds when `die >= quality`. Lower is better. */
  quality: number;
  /** Melee value added to the d6 in opposed rolls. Higher is better. */
  combat: number;
  /** Slow: 2 fewer hexes per Move action than the engine's `BASE_MOVE` (see `unitMove`). */
  slow?: boolean;
  /** Fast: 2 more hexes per Move action than the engine's `BASE_MOVE` (see `unitMove`). */
  fast?: boolean;
  /** Shooter: which kind of Shooter trait the unit has, and so its range (see {@link SHOOTER_RANGE}). Omitted = melee only. */
  shooter?: ShooterKind;
  /** Tough: first would-be kill downgraded to a knockdown. */
  tough?: boolean;
  /** Guard: may riposte the first melee attacker. */
  guard?: boolean;
  /** Big: +1 in melee against smaller foes, and +1 to anyone shooting it. */
  big?: boolean;
  /** Flying: ignores terrain and units, draws no free hacks, +1 swooping into melee — but +1 to anyone shooting it airborne. */
  flying?: boolean;
  /** Reassembling: a knocked-down unit stands back up for free at the start of each round. */
  reassembling?: boolean;
  /** Mounted: +1 in melee against foes on foot, while not knocked down. */
  mounted?: boolean;
}

/** The kinds of Shooter trait: short range, plain Shooter, and long range. */
export const SHOOTER_KINDS = ['short', 'normal', 'long'] as const;
export type ShooterKind = (typeof SHOOTER_KINDS)[number];

/** Shooting range in hexes each Shooter trait gives. */
export const SHOOTER_RANGE: Record<ShooterKind, number> = { short: 3, normal: 5, long: 7 };

/** Each Shooter trait's name, as the rules and the UI call it. */
export const SHOOTER_NAMES: Record<ShooterKind, string> = {
  short: 'Shooter (short range)',
  normal: 'Shooter',
  long: 'Shooter (long range)',
};

/** Shooting range in hexes a profile gets from its Shooter trait (0 = melee only). */
export function profileRange(p: Pick<Profile, 'shooter'>): number {
  return p.shooter ? SHOOTER_RANGE[p.shooter] : 0;
}

/**
 * The Shooter trait whose range is nearest to `range` hexes (0 or less = none),
 * for carrying over units that stored a raw range. Ties go to the longer kind.
 */
export function shooterForRange(range: number): ShooterKind | undefined {
  if (!(range > 0)) return undefined;
  let best: ShooterKind = SHOOTER_KINDS[0];
  for (const k of SHOOTER_KINDS) {
    if (Math.abs(SHOOTER_RANGE[k] - range) <= Math.abs(SHOOTER_RANGE[best] - range)) best = k;
  }
  return best;
}

/** Inclusive `[min, max]` legal range for each stat. */
export const STAT_BOUNDS = {
  quality: [2, 6] as const,
  combat: [1, 6] as const,
};

/** Hexes per Move action a profile gets: the engine's `BASE_MOVE`, shifted by Slow or Fast. */
export function profileMove(p: Pick<Profile, 'slow' | 'fast'>): number {
  return unitMove({ traits: { slow: p.slow ?? false, fast: p.fast ?? false } });
}

/** Weights of the cost formula. Exported so a UI can itemise a cost. */
export const COST_WEIGHTS = {
  /** Each point of Combat is worth this much, before the Quality multiplier. */
  perCombat: 5,
  /**
   * Each favorable trait adds this much, before the Quality multiplier: Fast,
   * any one Shooter trait, Tough, Guard, Big, Flying, Reassembling and Mounted.
   */
  favorable: 3,
  /** Each unfavorable trait adds this much (a rebate), before the Quality multiplier: Slow. */
  unfavorable: -3,
  /** Quality is scored as `qualityBase - quality`, so Quality 2 multiplies by 5 and Quality 6 by 1. */
  qualityBase: 7,
};

/** How many of a profile's traits are favorable and how many unfavorable. */
export function traitCounts(p: Profile): { favorable: number; unfavorable: number } {
  const favorable = [p.fast, p.shooter !== undefined, p.tough, p.guard, p.big, p.flying, p.reassembling, p.mounted].filter(
    Boolean,
  ).length;
  const unfavorable = p.slow ? 1 : 0;
  return { favorable, unfavorable };
}

function inRange(value: number, [min, max]: readonly [number, number]): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Which stats of a profile are out of {@link STAT_BOUNDS}, as human-readable strings. */
export function statErrors(p: Profile): string[] {
  const errors: string[] = [];
  if (!inRange(p.quality, STAT_BOUNDS.quality))
    errors.push(`quality ${p.quality} out of range ${STAT_BOUNDS.quality.join('..')}`);
  if (!inRange(p.combat, STAT_BOUNDS.combat))
    errors.push(`combat ${p.combat} out of range ${STAT_BOUNDS.combat.join('..')}`);
  if (p.shooter !== undefined && !SHOOTER_KINDS.includes(p.shooter))
    errors.push(`unknown shooter trait ${String(p.shooter)}`);
  if (p.slow && p.fast) errors.push('cannot be both slow and fast');
  return errors;
}

/**
 * Point cost of a single unit profile, by the Song of Blades and Heroes formula
 * `(C * 5 + Special Abilities) * (7 - Q) / 2`, where Special Abilities sums
 * {@link COST_WEIGHTS.favorable} per favorable trait and
 * {@link COST_WEIGHTS.unfavorable} per unfavorable one. Halves round up.
 * Assumes valid stats; callers that accept untrusted profiles should run
 * {@link statErrors} first. Always >= 1.
 */
export function unitCost(p: Profile): number {
  const { perCombat, favorable, unfavorable, qualityBase } = COST_WEIGHTS;
  const traits = traitCounts(p);
  const abilities = traits.favorable * favorable + traits.unfavorable * unfavorable;
  const cost = Math.ceil(((p.combat * perCombat + abilities) * (qualityBase - p.quality)) / 2);
  return Math.max(1, cost);
}
