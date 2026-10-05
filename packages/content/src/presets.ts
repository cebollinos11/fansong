import type { Warband, WarbandUnit } from './warband.js';

/**
 * Original preset warbands. Names, themes, and stat lines are FanSong's own —
 * no trademarked names or published profiles. Each is built to be legal under
 * {@link DEFAULT_RULES}; the preset test asserts that invariant.
 *
 * Eleven warbands, each a different family at one size: small (3 or 4 units,
 * about 120 points), medium (about 250) or large (about 400). The id ends in the
 * size. Between them they field every trait, which the preset test also asserts.
 *
 * Design intent (so the matchups stay interesting):
 *  - iron-wardens-medium : a shield wall that grinds forward and is hard to
 *    shift — Shieldwall foot and Guard, Armored veterans around an Armored Leader
 *    and a Slow, Big, Tough, Immovable bulwark, covered by a Slow Sharpshooter
 *    crossbow.
 *  - ashfang-raiders-medium : orcs who win on first contact (melee only) —
 *    Rusher foot and Big but Dumb brutes behind a Savage Leader.
 *  - goblin-rabble-medium : a fast, cheap swarm that won't stay loyal — Fast
 *    riders that Trample and Disloyal Opportunist wolf riders and spearmen,
 *    under a Fast Leader.
 *  - free-company-medium : sellswords and hired locals — a Leader sergeant,
 *    Rusher swordsmen who may change sides, Guard pikes, Slippery slingers, a
 *    Woodwise woodsman and raw recruits.
 *  - night-haunt-medium : spirits that strike from nowhere — a Flying Leader,
 *    Slippery Opportunist shadows, Flying Armored ghosts and Fast bats.
 *  - greenwood-elves-medium : skilled and at home in the forest — every elf is
 *    Woodwise; long bows (one a Sharpshooter), blades and a Fast scout.
 *  - bonefield-legion-large : a Reassembling undead host that wins by attrition —
 *    you must kill them, not just knock them over. Badly balanced foot and bows,
 *    Fast riders and Whirling twin-blades, under a Slow Leader with Combat Mastery.
 *  - wild-menagerie-large : leaderless beasts — Flying hunters (one Savage), Fast
 *    wolves, Slippery rats, Woodwise forest ambushers (a Trampling boar and a
 *    web-spitting spider) and Big, Tough brutes.
 *  - gryphon-eyrie-small : a Flying, Armored gryphon rider leading two falcons.
 *  - wolf-pack-small : a Fast alpha and two Opportunist wolves that circle the
 *    fallen.
 *  - hogwallow-farm-small : a farmer and three pigs — a Trampling, Woodwise old
 *    boar and two Fast, Slippery piglets.
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
  'Warden-Captain': { quality: 3, combat: 4, leader: true, armored: true },
  Sentinel: { quality: 3, combat: 3, guard: true, armored: true },
  Bulwark: { quality: 4, combat: 4, slow: true, tough: true, big: true, immovable: true },
  Ironguard: { quality: 4, combat: 3, guard: true, shieldwall: true },
  Halberdier: { quality: 4, combat: 3, shieldwall: true },
  Crossbow: { quality: 4, combat: 3, shooter: 'long', sharpshooter: true, slow: true },
  Levy: { quality: 4, combat: 2, shieldwall: true },

  // Ashfang Raiders
  'Raid-Leader': { quality: 3, combat: 4, leader: true, savage: true },
  Reaver: { quality: 4, combat: 4, big: true, rusher: true, dumb: true },
  Marauder: { quality: 4, combat: 3, rusher: true },

  // Goblin Rabble
  'Goblin Boss': { quality: 3, combat: 3, leader: true, fast: true, look: 'Outrider', tint: '#c9a227' },
  Outrider: { quality: 3, combat: 3, fast: true, trample: true },
  'Wolf-Prowler': { quality: 4, combat: 2, fast: true, opportunist: true, disloyal: true },
  Whelp: { quality: 4, combat: 2, opportunist: true, disloyal: true },

  // Free Company
  Sergeant: { quality: 3, combat: 4, leader: true },
  Swordsman: { quality: 4, combat: 3, rusher: true, disloyal: true },
  Pikeman: { quality: 4, combat: 3, guard: true },
  Slinger: { quality: 4, combat: 2, shooter: 'short', slippery: true },
  Woodsman: { quality: 4, combat: 2, shooter: 'normal', woodwise: true, look: 'Halberd-Recruit' },
  Recruit: { quality: 5, combat: 2 },

  // Bonefield Legion
  'Death Knight': { quality: 3, combat: 4, slow: true, leader: true, mastery: true, reassembling: true },
  Deathblade: { quality: 4, combat: 3, fast: true, whirling: true, reassembling: true },
  'Skeleton Rider': { quality: 4, combat: 3, fast: true, reassembling: true },
  'Skeleton Archer': { quality: 4, combat: 2, shooter: 'normal', reassembling: true },
  'Skeleton Infantry': { quality: 4, combat: 3, reassembling: true, badBalance: true },

  // Night Haunt
  Nightgaunt: { quality: 3, combat: 4, leader: true, flying: true },
  Shadow: { quality: 3, combat: 3, slippery: true, opportunist: true },
  Ghost: { quality: 4, combat: 2, flying: true, armored: true },
  'Vampire Bat': { quality: 4, combat: 1, fast: true, flying: true },

  // Greenwood Elves
  'Elvish Captain': { quality: 3, combat: 3, leader: true, woodwise: true, look: 'Elvish Fighter', tint: '#d9b44a' },
  'Elvish Fighter': { quality: 3, combat: 3, woodwise: true },
  'Elvish Archer': { quality: 3, combat: 2, shooter: 'long', woodwise: true, look: 'Elvish Fighter', tint: '#5e8f3a' },
  'Elvish Marksman': { quality: 3, combat: 2, shooter: 'long', sharpshooter: true, woodwise: true, look: 'Elvish Fighter', tint: '#3f6f8f' },
  'Elvish Scout': { quality: 3, combat: 2, fast: true, woodwise: true, look: 'Elvish Fighter', tint: '#8a6a3e' },

  // Gryphon Eyrie
  'Gryphon Rider': { quality: 3, combat: 4, leader: true, flying: true, armored: true },

  // Wolf Pack
  'Pack Alpha': { quality: 3, combat: 4, leader: true, fast: true, look: 'Wolf', tint: '#3a3a44' },
  'Grey Wolf': { quality: 4, combat: 3, fast: true, opportunist: true, look: 'Wolf' },

  // Hogwallow Farm
  Farmer: { quality: 3, combat: 3, leader: true, look: 'Levy' },
  Tusker: { quality: 4, combat: 4, trample: true, woodwise: true, look: 'Boar' },
  Truffle: { quality: 4, combat: 2, fast: true, slippery: true, look: 'Piglet' },
  Hamlet: { quality: 4, combat: 2, fast: true, slippery: true, look: 'Piglet' },

  // Wild Menagerie
  Yeti: { quality: 3, combat: 5, big: true },
  'Wild Wyvern': { quality: 3, combat: 4, flying: true, savage: true },
  'Giant Spider': { quality: 3, combat: 3, shooter: 'short', woodwise: true },
  Bear: { quality: 4, combat: 4, big: true, tough: true },
  Boar: { quality: 4, combat: 4, trample: true, woodwise: true },
  'Giant Scorpion': { quality: 4, combat: 3, guard: true, armored: true },
  Crocodile: { quality: 4, combat: 5, slow: true, tough: true, dumb: true },
  Falcon: { quality: 4, combat: 2, fast: true, flying: true },
  Wolf: { quality: 4, combat: 2, fast: true },
  'Giant Rat': { quality: 5, combat: 2, fast: true, slippery: true },
};

/** Which units each preset warband fields, in menu order. */
export const PRESET_ROSTERS: Record<string, PresetRoster> = {
  'iron-wardens-medium': {
    name: 'Iron Wardens',
    units: [
      { unit: 'Warden-Captain' },
      { unit: 'Sentinel' },
      { unit: 'Bulwark' },
      { unit: 'Ironguard' },
      { unit: 'Halberdier' },
      { unit: 'Crossbow' },
      { unit: 'Levy' },
    ],
  },
  'ashfang-raiders-medium': {
    name: 'Ashfang Raiders',
    units: [
      { unit: 'Raid-Leader' },
      { unit: 'Reaver', count: 2 },
      { unit: 'Marauder', count: 4 },
    ],
  },
  'goblin-rabble-medium': {
    name: 'Goblin Rabble',
    units: [
      { unit: 'Goblin Boss' },
      { unit: 'Outrider', count: 2 },
      { unit: 'Wolf-Prowler', count: 3 },
      { unit: 'Whelp', count: 4 },
    ],
  },
  'free-company-medium': {
    name: 'Free Company',
    units: [
      { unit: 'Sergeant' },
      { unit: 'Swordsman', count: 2 },
      { unit: 'Pikeman', count: 2 },
      { unit: 'Slinger', count: 2 },
      { unit: 'Woodsman' },
      { unit: 'Recruit', count: 2 },
    ],
  },
  'night-haunt-medium': {
    name: 'Night Haunt',
    units: [
      { unit: 'Nightgaunt' },
      { unit: 'Shadow', count: 2 },
      { unit: 'Ghost', count: 2 },
      { unit: 'Vampire Bat', count: 3 },
    ],
  },
  'greenwood-elves-medium': {
    name: 'Greenwood Elves',
    units: [
      { unit: 'Elvish Captain' },
      { unit: 'Elvish Fighter', count: 2 },
      { unit: 'Elvish Archer', count: 2 },
      { unit: 'Elvish Marksman' },
      { unit: 'Elvish Scout' },
    ],
  },
  'bonefield-legion-large': {
    name: 'Bonefield Legion',
    units: [
      { unit: 'Death Knight' },
      { unit: 'Deathblade', count: 2 },
      { unit: 'Skeleton Rider', count: 3 },
      { unit: 'Skeleton Infantry', count: 4 },
      { unit: 'Skeleton Archer', count: 2 },
    ],
  },
  'wild-menagerie-large': {
    name: 'Wild Menagerie',
    units: [
      { unit: 'Wild Wyvern' },
      { unit: 'Yeti' },
      { unit: 'Bear' },
      { unit: 'Boar' },
      { unit: 'Giant Spider' },
      { unit: 'Giant Scorpion' },
      { unit: 'Crocodile' },
      { unit: 'Falcon' },
      { unit: 'Wolf', count: 2 },
      { unit: 'Giant Rat', count: 2 },
    ],
  },
  'gryphon-eyrie-small': {
    name: 'Gryphon Eyrie',
    units: [
      { unit: 'Gryphon Rider' },
      { unit: 'Falcon', count: 2 },
    ],
  },
  'wolf-pack-small': {
    name: 'Wolf Pack',
    units: [
      { unit: 'Pack Alpha' },
      { unit: 'Grey Wolf', count: 2 },
    ],
  },
  'hogwallow-farm-small': {
    name: 'Hogwallow Farm',
    units: [
      { unit: 'Farmer' },
      { unit: 'Tusker' },
      { unit: 'Truffle' },
      { unit: 'Hamlet' },
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
