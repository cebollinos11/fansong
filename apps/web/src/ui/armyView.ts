import { BASE_MOVE, DUMB_MAX_DICE, SPEED_STEP } from '@fansong/engine';
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

export const STAT_LABELS: Record<EditableStat, { title: string }> = {
  quality: { title: 'Quality — activation dice succeed on this or higher (lower is better)' },
  combat: { title: 'Combat — added to the d6 in fights (higher is better)' },
};

/** Every look a unit can take: the sprites of the preset units, by preset unit name. */
export const LOOKS: readonly string[] = Object.keys(UNIT_SPRITES);

/** The folk a look belongs to, by the Wesnoth folder its sprite comes from; anything else is a beast. */
const LOOK_FOLK: readonly [RegExp, string][] = [
  [/^human-/, 'Humans'],
  [/^elves-/, 'Elves'],
  [/^dwarves\//, 'Dwarves'],
  [/^(orcs|goblins)\//, 'Orcs and goblins'],
  [/^(trolls|ogres)\//, 'Trolls and ogres'],
  [/^undead/, 'Undead'],
  [/^drakes\//, 'Drakes'],
  [/^saurians\//, 'Saurians'],
  [/^(merfolk|nagas)\//, 'Merfolk and nagas'],
  [/^dunefolk\//, 'Dunefolk'],
];

/** {@link LOOKS} sorted into folk, for the look picker. */
export const LOOK_GROUPS: readonly { label: string; looks: readonly string[] }[] = [...LOOK_FOLK.map(([, label]) => label), 'Beasts and monsters']
  .map((label) => ({
    label,
    looks: LOOKS.filter((l) => (LOOK_FOLK.find(([folder]) => folder.test(UNIT_SPRITES[l]!))?.[1] ?? 'Beasts and monsters') === label),
  }))
  .filter((g) => g.looks.length > 0);

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

/** A copy of `unit` tinted `tint`, or untinted (the key dropped) for `undefined`. */
export function withTint(unit: WarbandUnit, tint: string | undefined): WarbandUnit {
  const { tint: _old, ...rest } = unit;
  return tint === undefined ? rest : { ...rest, tint };
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
  'opportunist',
  'savage',
  'leader',
  'armored',
  'sharpshooter',
  'mastery',
  'shieldwall',
  'rusher',
  'slippery',
  'whirling',
  'immovable',
  'woodwise',
  'trample',
  'dumb',
  'disloyal',
  'badBalance',
] as const;
export type ToggleTrait = (typeof TOGGLE_TRAITS)[number];

/** A Shooter trait as the trait editor names it; a unit has at most one. */
export type ShooterTrait = `shooter-${ShooterKind}`;
export const SHOOTER_TRAITS: readonly ShooterTrait[] = SHOOTER_KINDS.map((k) => `shooter-${k}` as const);

/** Anything the trait editor can add or remove: an on/off trait or one of the Shooter traits. */
export type TraitKey = ToggleTrait | ShooterTrait;

/** Every trait the editor offers, in display order: movement, then shooting, then the rest. */
export const EDITOR_TRAITS: readonly TraitKey[] = ['slow', 'fast', ...SHOOTER_TRAITS, ...TOGGLE_TRAITS.slice(2)];

function isShooterTrait(t: TraitKey): t is ShooterTrait {
  return t.startsWith('shooter-');
}

function shooterKind(t: ShooterTrait): ShooterKind {
  return t.slice('shooter-'.length) as ShooterKind;
}

const SHOOTER_INFO = Object.fromEntries(
  SHOOTER_KINDS.map((k) => [`shooter-${k}`, { label: SHOOTER_NAMES[k], desc: `shoots ${SHOOTER_RANGE[k]} hexes, taking no return damage` }]),
) as Record<ShooterTrait, { label: string; desc: string }>;

/** Each trait's name and, briefly, what it does, for the trait editor's chips and menu. */
export const TRAIT_INFO: Record<TraitKey, { label: string; desc: string }> = {
  ...SHOOTER_INFO,
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
  opportunist: { label: 'Opportunist', desc: '+1 in melee or shooting against a knocked-down foe' },
  savage: { label: 'Savage', desc: "every kill it deals is gruesome, so the victim's friends must test for fear" },
  leader: {
    label: 'Leader',
    desc: 'once a round, war cries to inspire every friend still to activate within 5 hexes and in sight; friends who see it fall must test nerve. Costs as two traits',
  },
  armored: { label: 'Armored', desc: 'a combat it loses by exactly 1 point does it no harm, even knocked down' },
  sharpshooter: { label: 'Sharpshooter', desc: '+1 to every shot it takes (only matters with a Shooter trait)' },
  mastery: { label: 'Combat Mastery', desc: 'a melee it ties against a foe without Combat Mastery kills that foe. Costs as two traits' },
  shieldwall: { label: 'Shieldwall', desc: '+1 defending against a melee attack while next to a standing friend' },
  rusher: { label: 'Rusher', desc: '+1 on the first attack after a Move that brought it into contact with its target' },
  slippery: { label: 'Slippery', desc: 'leaving contact draws no free hacks, unless it carries a flag' },
  whirling: { label: 'Whirling', desc: 'never outnumbered in melee while on its feet. Costs as two traits' },
  immovable: { label: 'Immovable', desc: 'never pushed: a push leaves it standing where it is. Costs as two traits' },
  woodwise: { label: 'Woodwise', desc: '+1 on every combat roll, melee or shot, while standing in a forest hex' },
  trample: { label: 'Trample', desc: 'a foe it pushes in melee goes two hexes, and falls if the second is blocked' },
  dumb: { label: 'Dumb', desc: `rolls at most ${DUMB_MAX_DICE} activation dice. A drawback: lowers its cost` },
  disloyal: { label: 'Disloyal', desc: 'a natural 1 on a nerve check makes it change sides. A drawback: lowers its cost' },
  badBalance: { label: 'Bad Balance', desc: 'a push that moves it also knocks it down. A drawback: lowers its cost' },
};

/** A trait's tooltip: its name and what it does. */
export function traitTitle(trait: TraitKey): string {
  return `${TRAIT_INFO[trait].label} — ${TRAIT_INFO[trait].desc}`;
}

/** Whether `unit` has `trait`. */
export function hasTrait(unit: WarbandUnit, trait: TraitKey): boolean {
  return isShooterTrait(trait) ? unit.shooter === shooterKind(trait) : !!unit[trait];
}

/** The traits `unit` has, in display order. */
export function traitsOf(unit: WarbandUnit): TraitKey[] {
  return EDITOR_TRAITS.filter((t) => hasTrait(unit, t));
}

/** The trait adding `trait` to `unit` would displace (Slow and Fast, Immovable and Bad Balance, or another Shooter trait), if any. */
export function traitReplaced(unit: WarbandUnit, trait: TraitKey): TraitKey | undefined {
  if (trait === 'slow' && unit.fast) return 'fast';
  if (trait === 'fast' && unit.slow) return 'slow';
  if (trait === 'immovable' && unit.badBalance) return 'badBalance';
  if (trait === 'badBalance' && unit.immovable) return 'immovable';
  if (isShooterTrait(trait) && unit.shooter && unit.shooter !== shooterKind(trait)) return `shooter-${unit.shooter}`;
  return undefined;
}

/**
 * The fields switching `trait` on or off changes: `false` for an on/off trait
 * switched off, `shooter: undefined` for melee only. Slow and Fast exclude each
 * other, as do Immovable and Bad Balance, so switching one on switches the other off.
 */
export function traitPatch(unit: WarbandUnit, trait: TraitKey, on: boolean): Partial<WarbandUnit> {
  if (isShooterTrait(trait)) {
    return { shooter: on ? shooterKind(trait) : hasTrait(unit, trait) ? undefined : unit.shooter };
  }
  const patch: Partial<WarbandUnit> = { [trait]: on };
  if (on && trait === 'slow') patch.fast = false;
  if (on && trait === 'fast') patch.slow = false;
  if (on && trait === 'immovable') patch.badBalance = false;
  if (on && trait === 'badBalance') patch.immovable = false;
  return patch;
}

/** A copy of `unit` with a trait switched on or off (off drops the key); see {@link traitPatch}. */
export function withTrait(unit: WarbandUnit, trait: TraitKey, on: boolean): WarbandUnit {
  const next: Record<string, unknown> = { ...unit };
  for (const [k, v] of Object.entries(traitPatch(unit, trait, on))) {
    if (v === undefined || v === false) delete next[k];
    else next[k] = v;
  }
  return next as unknown as WarbandUnit;
}

/**
 * What switching `trait` on would change `unit`'s cost by, in points — it
 * scales with the unit's Quality, and a trait replacing another counts both.
 */
export function traitCost(unit: WarbandUnit, trait: TraitKey): number {
  return unitCost(withTrait(unit, trait, true)) - unitCost(unit);
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
