import type { Warband, WarbandUnit } from './warband.js';

/**
 * Original preset warbands. Names, themes, and stat lines are FanSong's own —
 * no trademarked names or published profiles. Each is built to be legal under
 * {@link DEFAULT_RULES}; the preset test asserts that invariant.
 *
 * Design intent (so the AI-vs-AI matchups stay interesting):
 * *  - iron-wardens : tough, disciplined — wins by grinding; a shield wall of
 *    Guard foot around a Slow, Big, Tough, Guard bulwark that towers over the
 *    rank and file (and draws every arrow).
 *  - ashfang-raiders : fast and fragile — wins by reaching you first (melee only):
 *    Mounted wolves and outriders, Opportunists who pile onto the fallen, and a
 *    Slow raid-leader bringing up the rear.
 *  - free-company : a balanced generalist baseline — a Tough, Guard sergeant,
 *    foot, a fast slinger and a long-ranged bowman.
 *  - hollow-watch : a defensive garrison — long bows and crossbows behind a
 *    Tough, Guard shield-warden and Guard sentries.
 *  - thorn-patrol : a minimum-size (3-unit) band — one long bow, two foot — for
 *    quick games and small boards.
 *  - sky-talons : an all-air wing — two Flying gryphons (one Big) and a Flying
 *    falcon that vault terrain and gang up in melee, backed by a falconer's bow.
 *  - bonefield-legion : a Reassembling undead host — a Slow mass of middling foot
 *    and bows that refuse to stay down, standing back up for free every round.
 *    Wins by attrition: you must kill them, not just knock them over.
 *  - grave-knights : the skeletal elite, all Reassembling — a Mounted rider, a
 *    fast Opportunist twin-blade, and a Slow, Guard crowned commander.
 *  - wild-menagerie : wandering beasts — a Flying falcon, a Big, Guard-pincered
 *    scorpion, a Slow, Tough, hard-biting crocodile, and a pack of animals.
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
  'Warden-Captain': { quality: 3, combat: 4 },
  Ironguard: { quality: 4, combat: 3, guard: true },
  Bulwark: { quality: 4, combat: 4, slow: true, tough: true, guard: true, big: true },
  Sentinel: { quality: 3, combat: 3, guard: true },
  Halberdier: { quality: 4, combat: 3 },
  Levy: { quality: 4, combat: 2 },

  // Ashfang Raiders
  'Raid-Leader': { quality: 2, combat: 4, slow: true },
  Marauder: { quality: 3, combat: 3 },
  Reaver: { quality: 4, combat: 3, big: true, opportunist: true },
  'Wolf-Prowler': { quality: 4, combat: 2, fast: true, mounted: true },
  Outrider: { quality: 3, combat: 2, fast: true, mounted: true },
  Whelp: { quality: 4, combat: 1, opportunist: true },

  // Free Company
  Sergeant: { quality: 3, combat: 4, tough: true, guard: true },
  Swordsman: { quality: 4, combat: 3 },
  Pikeman: { quality: 4, combat: 3, opportunist: true },
  Slinger: { quality: 3, combat: 2, shooter: 'normal', fast: true },
  Bowman: { quality: 4, combat: 3, shooter: 'long', look: 'Halberd-Recruit' },
  Recruit: { quality: 4, combat: 3 },

  // Hollow Watch
  'Watch-Captain': { quality: 2, combat: 4 },
  'Shield-Warden': { quality: 3, combat: 3, tough: true, guard: true },
  Longbow: { quality: 3, combat: 2, shooter: 'long' },
  Crossbow: { quality: 4, combat: 4, shooter: 'long' },
  Sentry: { quality: 4, combat: 3, guard: true },

  // Thorn Patrol
  'Thorn-Bow': { quality: 3, combat: 2, shooter: 'long' },
  'Thorn-Blade': { quality: 3, combat: 4 },
  'Thorn-Spear': { quality: 3, combat: 3, opportunist: true },

  // Sky Talons
  'Sky-Talon': { quality: 3, combat: 3, flying: true },
  'Storm-Talon': { quality: 3, combat: 4, big: true, flying: true },
  'Talon-Falconer': { quality: 3, combat: 2, shooter: 'normal' },

  // Bonefield Legion
  'Skeleton Infantry': { quality: 4, combat: 3, slow: true, reassembling: true },
  'Skeleton Archer': { quality: 4, combat: 2, shooter: 'normal', slow: true, reassembling: true },

  // Grave Knights
  'Skeleton Rider': { quality: 4, combat: 3, reassembling: true, mounted: true },
  Deathblade: { quality: 4, combat: 3, fast: true, reassembling: true, opportunist: true },
  'Death Knight': { quality: 3, combat: 4, slow: true, guard: true, reassembling: true },

  // Wild Menagerie
  Falcon: { quality: 4, combat: 2, fast: true, flying: true },
  'Giant Scorpion': { quality: 4, combat: 3, fast: true, guard: true, big: true },
  Crocodile: { quality: 4, combat: 5, slow: true, tough: true },
  Wolf: { quality: 4, combat: 2, fast: true },
  Boar: { quality: 4, combat: 4 },
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
      { unit: 'Bowman' },
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
      { unit: 'Falcon' },
    ],
  },
  'bonefield-legion': {
    name: 'Bonefield Legion',
    units: [
      { unit: 'Skeleton Infantry', count: 5 },
      { unit: 'Skeleton Archer', count: 3 },
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
