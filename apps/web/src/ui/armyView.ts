import { BASE_MOVE, SPEED_STEP } from '@fansong/engine';
import {
  ARMY_RULES,
  PRESET_IDS,
  PRESETS,
  SHOOTER_KINDS,
  SHOOTER_NAMES,
  SHOOTER_RANGE,
  STAT_BOUNDS,
  type ShooterKind,
  type Warband,
  unitCost,
  type WarbandUnit,
} from '@fansong/content';
import { UNIT_SPRITES } from '../three/unitSprites.js';

/**
 * Pure helpers behind the army builder screen, kept apart from React so they
 * can be tested directly. An army is an ordinary {@link Warband}; the builder
 * only ever edits a copy and hands the result back.
 */

/** The builder's one rule, in words. */
export const ARMY_RULES_TEXT = `No point limit — ${ARMY_RULES.minUnits} to ${ARMY_RULES.maxUnits} units. Points are shown so you can agree on a size.`;

/** The numeric stats the builder edits, in column order. */
export const EDITABLE_STATS = ['quality', 'combat'] as const;
export type EditableStat = (typeof EDITABLE_STATS)[number];

export const STAT_LABELS: Record<EditableStat, { short: string; title: string }> = {
  quality: { short: 'Q', title: 'Quality — activation dice succeed on this or higher (lower is better)' },
  combat: { short: 'C', title: 'Combat — added to the d6 in fights (higher is better)' },
};

/** Every look a unit can take: the sprites of the preset units, by preset unit name. */
export const LOOKS: readonly string[] = Object.keys(UNIT_SPRITES);

/** `value` clamped into `stat`'s legal range and rounded to a whole number. */
export function clampStat(stat: EditableStat, value: number): number {
  const [min, max] = STAT_BOUNDS[stat];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** A copy of `unit` with `stat` set (clamped). */
export function withStat(unit: WarbandUnit, stat: EditableStat, value: number): WarbandUnit {
  return { ...unit, [stat]: clampStat(stat, value) };
}

/** What the Shooter column means, in words. */
export const SHOOTER_TITLE = `Shooter — shoots at range, taking no return damage: ${SHOOTER_KINDS.map(
  (k) => `${SHOOTER_NAMES[k]} ${SHOOTER_RANGE[k]} hexes`,
).join(', ')}`;

/** The Shooter column's choices: melee only, then each Shooter trait with its range. */
export const SHOOTER_OPTIONS: readonly { value: ShooterKind | ''; label: string }[] = [
  { value: '', label: '—' },
  ...SHOOTER_KINDS.map((k) => ({ value: k, label: `${SHOOTER_NAMES[k]} · ${SHOOTER_RANGE[k]}` })),
];

/** A copy of `unit` with its Shooter trait set, or dropped for `undefined` (melee only). */
export function withShooter(unit: WarbandUnit, shooter: ShooterKind | undefined): WarbandUnit {
  const next = { ...unit };
  if (shooter) next.shooter = shooter;
  else delete next.shooter;
  return next;
}

/** The on/off traits the editors offer, in display order. */
export const TOGGLE_TRAITS = [
  'slow',
  'fast',
  'tough',
  'guard',
  'big',
  'flying',
  'reassembling',
  'mounted',
  'opportunist',
  'savage',
  'leader',
  'armored',
  'sharpshooter',
] as const;
export type ToggleTrait = (typeof TOGGLE_TRAITS)[number];

/** Each on/off trait's name and, briefly, what it does, for the trait editor's chips and menu. */
export const TRAIT_INFO: Record<ToggleTrait, { label: string; desc: string }> = {
  slow: { label: 'Slow', desc: `${BASE_MOVE - SPEED_STEP} hexes per Move action instead of ${BASE_MOVE}` },
  fast: { label: 'Fast', desc: `${BASE_MOVE + SPEED_STEP} hexes per Move action instead of ${BASE_MOVE}` },
  tough: { label: 'Tough', desc: 'the first would-be kill only knocks it down' },
  guard: { label: 'Guard', desc: 'may take a stance that ripostes the first melee attacker' },
  big: { label: 'Big', desc: '+1 in melee against smaller foes, but +1 to anyone shooting it' },
  flying: {
    label: 'Flying',
    desc: 'soars over terrain and units, draws no free hacks, +1 swooping into melee, but +1 to anyone shooting it airborne',
  },
  reassembling: { label: 'Reassembling', desc: 'stands back up for free at the start of each round if knocked down' },
  mounted: { label: 'Mounted', desc: '+1 in melee against foes on foot, lost while knocked down' },
  opportunist: { label: 'Opportunist', desc: '+1 in melee or shooting against a knocked-down foe' },
  savage: { label: 'Savage', desc: "every kill it deals is gruesome, so the victim's friends must test for fear" },
  leader: {
    label: 'Leader',
    desc: 'once a round, war cries to inspire every friend still to activate; friends who see it fall must test nerve. Costs as two traits',
  },
  armored: { label: 'Armored', desc: 'a combat it loses by exactly 1 point does it no harm, even knocked down' },
  sharpshooter: { label: 'Sharpshooter', desc: '+1 to every shot it takes (only matters with a Shooter trait)' },
};

/** A trait's tooltip: its name and what it does. */
export function traitTitle(trait: ToggleTrait): string {
  return `${TRAIT_INFO[trait].label} — ${TRAIT_INFO[trait].desc}`;
}

/**
 * What switching `trait` on would change `unit`'s cost by, in points — it
 * scales with the unit's Quality, and Slow or Fast replacing the other counts both.
 */
export function traitCost(unit: WarbandUnit, trait: ToggleTrait): number {
  return unitCost(withTrait(unit, trait, true)) - unitCost(unit);
}

/** The on/off traits `unit` has, in display order. */
export function traitsOf(unit: Partial<Record<ToggleTrait, boolean>>): ToggleTrait[] {
  return TOGGLE_TRAITS.filter((t) => unit[t]);
}

/**
 * A copy of `unit` with a trait switched on or off (off drops the key). Slow and
 * Fast exclude each other, so switching one on switches the other off.
 */
export function withTrait(unit: WarbandUnit, trait: ToggleTrait, on: boolean): WarbandUnit {
  const next = { ...unit };
  if (on) next[trait] = true;
  else delete next[trait];
  if (on && trait === 'slow') delete next.fast;
  if (on && trait === 'fast') delete next.slow;
  return next;
}

/** A plain rank-and-file unit to start from. */
export function blankUnit(units: readonly WarbandUnit[]): WarbandUnit {
  return { name: uniqueName('Soldier', units), quality: 4, combat: 3, look: 'Recruit' };
}

/** `base`, or `base 2`, `base 3`, … — the first not already used in `units`. */
export function uniqueName(base: string, units: readonly WarbandUnit[]): string {
  const taken = new Set(units.map((u) => u.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A copy of a preset's unit to add to an army, drawn as that unit. */
export function templateUnit(template: WarbandUnit, units: readonly WarbandUnit[]): WarbandUnit {
  return { ...template, name: uniqueName(template.name, units), look: template.look ?? template.name };
}

/** Every preset unit, grouped by preset, as templates for "Add unit". */
export function presetTemplates(): { preset: string; units: WarbandUnit[] }[] {
  return PRESET_IDS.map((id) => ({ preset: PRESETS[id]!.name, units: PRESETS[id]!.units }));
}

/** A new, empty-ish army. */
export function newArmy(): Warband {
  return { name: 'New army', units: [blankUnit([])] };
}

/** An army copied from a preset, each unit keeping its preset look. */
export function armyFromPreset(id: string): Warband {
  const preset = PRESETS[id]!;
  return { name: `${preset.name} (copy)`, units: preset.units.map((u) => ({ ...u, look: u.look ?? u.name })) };
}

/** A copy of `units` with the unit at `i` moved by `delta` places (clamped). Works on any list. */
export function moveUnit<T>(units: readonly T[], i: number, delta: number): T[] {
  const j = Math.min(units.length - 1, Math.max(0, i + delta));
  const next = [...units];
  const [u] = next.splice(i, 1);
  next.splice(j, 0, u!);
  return next;
}
