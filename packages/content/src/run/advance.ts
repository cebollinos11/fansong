import { STAT_BOUNDS, statErrors, unitCost } from '../cost.js';
import type { WarbandUnit } from '../warband.js';
import type { Advance, GrowthTrait, Wound, WoundTrait } from './types.js';

/**
 * How a unit changes over a run: advances (from XP, rewards, the shop and enemy
 * veterans) and lasting wounds. Both only ever use what the engine already
 * plays — traits and Quality/Combat steps — and every result stays a legal
 * profile.
 *
 * The traits a unit can grow into leave out the ones that say what it *is*
 * (Leader, Big, Flying, Reassembling, Magic User, Combat Mastery, a Shooter trait).
 */
export const GROWTH_TRAITS: readonly GrowthTrait[] = [
  'fast',
  'tough',
  'guard',
  'armored',
  'opportunist',
  'savage',
  'sharpshooter',
  'shieldwall',
  'rusher',
  'slippery',
  'whirling',
  'immovable',
  'woodwise',
  'trample',
];

export const WOUND_TRAITS: readonly WoundTrait[] = ['slow', 'dumb', 'badBalance'];

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));

/** `unit` with `advance` taken. Unchecked: see {@link availableAdvances}. */
export function applyAdvance(unit: WarbandUnit, advance: Advance): WarbandUnit {
  if (advance.kind === 'combat') return { ...unit, combat: unit.combat + 1 };
  if (advance.kind === 'quality') return { ...unit, quality: unit.quality - 1 };
  return { ...unit, [advance.trait]: true };
}

/** Every advance `unit` can take: traits it lacks and can use, and stat steps within bounds. */
export function availableAdvances(unit: WarbandUnit): Advance[] {
  const all: Advance[] = GROWTH_TRAITS.filter(
    (trait) => !unit[trait] && (trait !== 'sharpshooter' || unit.shooter !== undefined),
  ).map((trait) => ({ kind: 'trait', trait }));
  all.push({ kind: 'combat' }, { kind: 'quality' });
  return all.filter((a) => statErrors(applyAdvance(unit, a)).length === 0);
}

export function sameAdvance(a: Advance, b: Advance): boolean {
  return a.kind === b.kind && (a.kind !== 'trait' || a.trait === (b as { trait?: GrowthTrait }).trait);
}

export function canAdvance(unit: WarbandUnit, advance: Advance): boolean {
  return availableAdvances(unit).some((a) => sameAdvance(a, advance));
}

/** Points `advance` adds to `unit`'s cost. */
export function advanceCost(unit: WarbandUnit, advance: Advance): number {
  return unitCost(applyAdvance(unit, advance)) - unitCost(unit);
}

/** `unit` with `wound` taken. Unchecked: see {@link availableWounds}. */
export function applyWound(unit: WarbandUnit, wound: Wound): WarbandUnit {
  if (wound.kind === 'combat') return { ...unit, combat: unit.combat - 1 };
  if (wound.kind === 'quality') return { ...unit, quality: unit.quality + 1 };
  return { ...unit, [wound.trait]: true };
}

/** Every lasting wound `unit` can take and stay a legal profile. */
export function availableWounds(unit: WarbandUnit): Wound[] {
  const all: Wound[] = WOUND_TRAITS.filter((trait) => !unit[trait]).map((trait) => ({ kind: 'trait', trait }));
  all.push({ kind: 'combat' }, { kind: 'quality' });
  return all.filter((w) => statErrors(applyWound(unit, w)).length === 0);
}

/**
 * `unit` with `wound` undone. A stat comes back a step but never past its
 * bounds (the unit may have advanced since it was hurt).
 */
export function mendWound(unit: WarbandUnit, wound: Wound): WarbandUnit {
  if (wound.kind === 'combat') return { ...unit, combat: clamp(unit.combat + 1, STAT_BOUNDS.combat) };
  if (wound.kind === 'quality') return { ...unit, quality: clamp(unit.quality - 1, STAT_BOUNDS.quality) };
  const mended = { ...unit };
  delete mended[wound.trait];
  return mended;
}
