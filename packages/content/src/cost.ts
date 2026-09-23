/**
 * Point-buy costing. A unit's cost is derived purely from the three stats the
 * engine actually simulates — Quality, Combat, and Move — so a point total is
 * an honest measure of battlefield value with no unimplemented "paper" traits.
 *
 * The formula is original to FanSong (game mechanics aren't copyrightable, but
 * the numbers here are ours) and deliberately additive so a builder UI can show
 * each stat's contribution and so costs are trivial to reason about in tests.
 */

/** The stats a costed unit profile is built from. See engine `Unit`. */
export interface Profile {
  /** Activation target: a die succeeds when `die >= quality`. Lower is better. */
  quality: number;
  /** Melee value added to the d6 in opposed rolls. Higher is better. */
  combat: number;
  /** Max hex cells per Move action. Higher is better. */
  move: number;
  /** Ranged attack range in cells (0/omitted = melee only). */
  ranged?: number;
  /** Tough: first would-be kill downgraded to a knockdown. */
  tough?: boolean;
  /** Guard: may riposte the first melee attacker. */
  guard?: boolean;
  /** Big: +1 in melee against smaller foes, and +1 to anyone shooting it. */
  big?: boolean;
}

/** Inclusive `[min, max]` legal range for each stat. */
export const STAT_BOUNDS = {
  quality: [2, 6] as const,
  combat: [1, 6] as const,
  move: [1, 8] as const,
  ranged: [0, 8] as const,
};

/** The Move value a profile is costed against as "free"; deviations adjust cost. */
export const BASELINE_MOVE = 3;

/** Weights of the additive cost formula. Exported so a UI can itemise a cost. */
export const COST_WEIGHTS = {
  /** Flat floor so even a minimal model costs something. */
  base: 4,
  /** Each point of Quality *better* than the worst (6) is worth this much. */
  perQuality: 4,
  /** Each point of Combat is worth this much. */
  perCombat: 5,
  /**
   * Each cell of Move away from {@link BASELINE_MOVE} is worth this much. On the
   * hex board a cell of extra reach opens a disc of `3r(r+1)` cells (smaller than
   * a square king-move window), so mobility is priced a touch below a point of
   * Combat.
   */
  perMove: 2,
  /** Each cell of ranged reach is worth this much (attacking without reprisal). */
  perRanged: 3,
  /** Flat surcharge for the Tough trait (a free save against the first kill). */
  tough: 12,
  /** Flat surcharge for the Guard trait (a defensive riposte). */
  guard: 10,
  /**
   * Flat surcharge for the Big trait. It is worth about a point of Combat in
   * melee (and only against smaller foes), but it hands every shooter a point
   * back, so it is priced well under {@link COST_WEIGHTS.perCombat}.
   */
  big: 3,
};

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
  if (!inRange(p.move, STAT_BOUNDS.move))
    errors.push(`move ${p.move} out of range ${STAT_BOUNDS.move.join('..')}`);
  if (!inRange(p.ranged ?? 0, STAT_BOUNDS.ranged))
    errors.push(`ranged ${p.ranged} out of range ${STAT_BOUNDS.ranged.join('..')}`);
  return errors;
}

/**
 * Point cost of a single unit profile. Assumes valid stats; callers that accept
 * untrusted profiles should run {@link statErrors} first. Always >= 1.
 */
export function unitCost(p: Profile): number {
  const { base, perQuality, perCombat, perMove, perRanged, tough, guard, big } = COST_WEIGHTS;
  const qualityMax = STAT_BOUNDS.quality[1]; // worst quality = cheapest
  const cost =
    base +
    (qualityMax - p.quality) * perQuality +
    p.combat * perCombat +
    (p.move - BASELINE_MOVE) * perMove +
    (p.ranged ?? 0) * perRanged +
    (p.tough ? tough : 0) +
    (p.guard ? guard : 0) +
    (p.big ? big : 0);
  return Math.max(1, cost);
}
