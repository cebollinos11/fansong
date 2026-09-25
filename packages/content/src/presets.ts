import type { Warband, WarbandUnit } from './warband.js';

/**
 * Original preset warbands. Names, themes, and stat lines are FanSong's own —
 * no trademarked names or published profiles. Each is built to be legal under
 * {@link DEFAULT_RULES}; the preset test asserts that invariant.
 *
 * Design intent (so the AI-vs-AI matchups stay interesting):
 * *  - iron-wardens : tough, disciplined — wins by grinding; a Slow, Big, Tough
 *    bulwark that towers over the rank and file (and draws every arrow).
 *  - ashfang-raiders : fast and fragile — wins by reaching you first (melee only).
 *  - free-company : a balanced generalist baseline with a ranged skirmisher.
 *  - hollow-watch : a defensive garrison showcasing all three M5 traits
 *    (Shooter bows, a Tough shield-warden, and a Guard captain).
 *  - thorn-patrol : a minimum-size (3-unit) band — one bow, two foot — for
 *    quick games and small boards.
 *  - sky-talons : a pair of Flying gryphons that vault terrain and gang up in
 *    melee, screened by a bow and two foot — fast, but wary of enemy archery.
 *  - bonefield-legion : a Reassembling undead host — cheap, middling foot and
 *    bows that refuse to stay down, standing back up for free every round. Wins
 *    by attrition: you must kill them, not just knock them over.
 *  - grave-knights : the skeletal elite — a mounted rider, a twin-blade, and a
 *    crowned commander, all Reassembling, all on the same average stat line.
 *  - wild-menagerie : wandering beasts — a Flying falcon, a Guard-pincered
 *    scorpion, a tough crocodile, and fast, fragile pack animals.
 *  - monstrous-horde : the big brutes — a bear, a yeti and a giant (web-spitting)
 *    spider, led into the sky by a Flying wyvern.
 */

/** A preset unit's profile. Its name is its key in {@link PRESET_UNITS}. */
export type PresetUnit = Omit<WarbandUnit, 'name'>;

/** One line of a preset roster: a unit from {@link PRESET_UNITS}, and how many of it (default 1). */
export interface RosterSlot {
  unit: string;
  count?: number;
}

/** A preset warband as written: a name plus lines naming shared units. */
export interface PresetRoster {
  name: string;
  units: RosterSlot[];
}

/**
 * Every preset unit, defined once by name. A warband takes a unit by naming it
 * in its roster, so a unit several warbands share is changed in one place.
 */
export const PRESET_UNITS: Record<string, PresetUnit> = {
  // Iron Wardens
  'Warden-Captain': { quality: 2, combat: 4 },
  Ironguard: { quality: 3, combat: 3 },
  Bulwark: { quality: 3, combat: 3, slow: true, tough: true, big: true },
  Sentinel: { quality: 3, combat: 3 },
  Halberdier: { quality: 4, combat: 3 },
  Levy: { quality: 4, combat: 2 },

  // Ashfang Raiders
  'Raid-Leader': { quality: 2, combat: 4, fast: true },
  Marauder: { quality: 3, combat: 3 },
  Reaver: { quality: 3, combat: 3 },
  'Wolf-Prowler': { quality: 3, combat: 3, fast: true },
  Outrider: { quality: 3, combat: 3, fast: true },
  Whelp: { quality: 4, combat: 2 },

  // Free Company
  Sergeant: { quality: 3, combat: 4 },
  Swordsman: { quality: 3, combat: 3 },
  Pikeman: { quality: 3, combat: 3 },
  Slinger: { quality: 3, combat: 2, fast: true, shooter: 'short' },
  'Halberd-Recruit': { quality: 4, combat: 3 },
  Recruit: { quality: 4, combat: 3 },

  // Hollow Watch
  'Watch-Captain': { quality: 2, combat: 4, guard: true },
  'Shield-Warden': { quality: 3, combat: 3, tough: true },
  Longbow: { quality: 3, combat: 2, shooter: 'long' },
  Crossbow: { quality: 4, combat: 3, shooter: 'short' },
  Sentry: { quality: 3, combat: 3 },

  // Thorn Patrol
  'Thorn-Bow': { quality: 3, combat: 2, shooter: 'normal' },
  'Thorn-Blade': { quality: 3, combat: 4 },
  'Thorn-Spear': { quality: 3, combat: 3 },

  // Sky Talons
  'Sky-Talon': { quality: 3, combat: 3, fast: true, flying: true },
  'Storm-Talon': { quality: 3, combat: 3, fast: true, flying: true },
  'Talon-Falconer': { quality: 3, combat: 2, shooter: 'short' },
  Skywatch: { quality: 3, combat: 3 },
  Fledgling: { quality: 4, combat: 2, fast: true },

  // Bonefield Legion
  'Bone-Sergeant': { quality: 3, combat: 3, reassembling: true, look: 'Skeleton Infantry' },
  'Skeleton Infantry': { quality: 4, combat: 3, reassembling: true },
  'Bone-Legionary': { quality: 4, combat: 3, reassembling: true, look: 'Skeleton Infantry' },
  'Skeleton Archer': { quality: 4, combat: 2, shooter: 'short', reassembling: true },
  'Bone-Fletcher': { quality: 4, combat: 2, shooter: 'short', reassembling: true, look: 'Skeleton Archer' },

  // Grave Knights
  'Skeleton Rider': { quality: 4, combat: 3, reassembling: true },
  Deathblade: { quality: 4, combat: 3, reassembling: true },
  'Death Knight': { quality: 4, combat: 3, reassembling: true },

  // Wild Menagerie
  Falcon: { quality: 4, combat: 2, fast: true, flying: true },
  'Giant Scorpion': { quality: 4, combat: 3, fast: true, guard: true },
  Crocodile: { quality: 4, combat: 3, fast: true, tough: true },
  Wolf: { quality: 4, combat: 2, fast: true },
  Boar: { quality: 4, combat: 3, fast: true },
  'Giant Rat': { quality: 5, combat: 2, fast: true },

  // Monstrous Horde
  'Wild Wyvern': { quality: 3, combat: 4, fast: true, flying: true },
  Bear: { quality: 4, combat: 4, big: true },
  Yeti: { quality: 3, combat: 5, big: true },
  'Giant Spider': { quality: 3, combat: 3, shooter: 'short', big: true },
};

/** Which units each preset warband fields, in menu order. */
export const PRESET_ROSTERS: Record<string, PresetRoster> = {
  'iron-wardens': {
    name: 'Iron Wardens',
    units: [
      { unit: 'Warden-Captain' },
      { unit: 'Ironguard' },
      { unit: 'Bulwark' },
      { unit: 'Sentinel' },
      { unit: 'Halberdier' },
      { unit: 'Levy' },
    ],
  },
  'ashfang-raiders': {
    name: 'Ashfang Raiders',
    units: [
      { unit: 'Raid-Leader' },
      { unit: 'Marauder' },
      { unit: 'Reaver' },
      { unit: 'Wolf-Prowler' },
      { unit: 'Outrider' },
      { unit: 'Whelp' },
    ],
  },
  'free-company': {
    name: 'Free Company',
    units: [
      { unit: 'Sergeant' },
      { unit: 'Swordsman' },
      { unit: 'Pikeman' },
      { unit: 'Slinger' },
      { unit: 'Halberd-Recruit' },
      { unit: 'Recruit' },
    ],
  },
  'hollow-watch': {
    name: 'Hollow Watch',
    units: [
      { unit: 'Watch-Captain' },
      { unit: 'Shield-Warden' },
      { unit: 'Longbow' },
      { unit: 'Crossbow' },
      { unit: 'Sentry' },
    ],
  },
  'thorn-patrol': {
    name: 'Thorn Patrol',
    units: [
      { unit: 'Thorn-Bow' },
      { unit: 'Thorn-Blade' },
      { unit: 'Thorn-Spear' },
    ],
  },
  'sky-talons': {
    name: 'Sky Talons',
    units: [
      { unit: 'Sky-Talon' },
      { unit: 'Storm-Talon' },
      { unit: 'Talon-Falconer' },
      { unit: 'Skywatch' },
      { unit: 'Fledgling' },
    ],
  },
  'bonefield-legion': {
    name: 'Bonefield Legion',
    units: [
      { unit: 'Bone-Sergeant' },
      { unit: 'Skeleton Infantry' },
      { unit: 'Bone-Legionary' },
      { unit: 'Skeleton Archer' },
      { unit: 'Bone-Fletcher' },
    ],
  },
  'grave-knights': {
    name: 'Grave Knights',
    units: [
      { unit: 'Skeleton Rider' },
      { unit: 'Deathblade' },
      { unit: 'Death Knight' },
    ],
  },
  'wild-menagerie': {
    name: 'Wild Menagerie',
    units: [
      { unit: 'Falcon' },
      { unit: 'Giant Scorpion' },
      { unit: 'Crocodile' },
      { unit: 'Wolf' },
      { unit: 'Boar' },
      { unit: 'Giant Rat' },
    ],
  },
  'monstrous-horde': {
    name: 'Monstrous Horde',
    units: [
      { unit: 'Wild Wyvern' },
      { unit: 'Bear' },
      { unit: 'Yeti' },
      { unit: 'Giant Spider' },
    ],
  },
};

/**
 * Expand a roster into a playable warband, looking each line's unit up by
 * reference. A line with a count of `n` fields `n` copies: the first keeps the
 * unit's name, the rest are numbered (`Wolf 2`, `Wolf 3`, …) and drawn as it.
 * Throws if a line names a unit `lookup` doesn't know.
 */
export function expandRoster(
  roster: PresetRoster,
  lookup: (ref: string) => WarbandUnit | undefined,
): Warband {
  const units: WarbandUnit[] = [];
  for (const slot of roster.units) {
    const unit = lookup(slot.unit);
    if (!unit) throw new Error(`${roster.name}: no unit "${slot.unit}"`);
    for (let k = 1; k <= (slot.count ?? 1); k++) {
      units.push(k === 1 ? { ...unit } : { ...unit, name: `${unit.name} ${k}`, look: unit.look ?? unit.name });
    }
  }
  return { name: roster.name, units };
}

/** A preset unit as a warband unit, or `undefined` if there is none by that name. */
export function presetUnit(name: string): WarbandUnit | undefined {
  const profile = PRESET_UNITS[name];
  return profile && { name, ...profile };
}

/** Every preset warband, expanded from {@link PRESET_ROSTERS}. */
export const PRESETS: Record<string, Warband> = Object.fromEntries(
  Object.entries(PRESET_ROSTERS).map(([id, roster]) => [id, expandRoster(roster, presetUnit)]),
);

/** Stable list of preset ids, for CLI help and menus. */
export const PRESET_IDS = Object.keys(PRESETS);

/** Look up a preset by id, or `undefined` if unknown. */
export function getPreset(id: string): Warband | undefined {
  return PRESETS[id];
}
