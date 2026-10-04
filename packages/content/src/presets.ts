import type { Warband, WarbandUnit } from './warband.js';

/**
 * Original preset warbands. Names, themes, and stat lines are FanSong's own —
 * no trademarked names or published profiles. Each is built to be legal under
 * {@link DEFAULT_RULES}; the preset test asserts that invariant.
 *
 * Four warbands, each in three sizes: small (3 units, about 120 points), medium
 * (about 250) and large (about 400). Between them they field every trait, which
 * the preset test also asserts.
 *
 * Design intent (so the matchups stay interesting):
 *  - iron-wardens : a shield wall that grinds forward and is hard to shift —
 *    Shieldwall foot and Guard, Armored veterans around an Armored Leader and a
 *    Slow, Big, Tough, Immovable bulwark, covered by long bows and a Slow
 *    Sharpshooter crossbow.
 *  - ashfang-raiders : fast and fragile — wins on first contact (melee only):
 *    Rusher foot, a Big but Dumb brute, Fast outriders that Trample, and
 *    Disloyal Opportunist goblins, behind a Savage Leader.
 *  - bonefield-legion : a Reassembling undead host that wins by attrition — you
 *    must kill them, not just knock them over. Badly balanced foot and bows, Fast
 *    riders, a Whirling twin-blade and a Flying, Armored ghost, under a
 *    Slow Leader with Combat Mastery.
 *  - wild-menagerie : leaderless beasts — Flying hunters (one Savage), Fast
 *    wolves, Slippery rats, Woodwise forest ambushers (a Trampling boar
 *    and a web-spitting spider) and Big, Tough brutes.
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
  Longbow: { quality: 3, combat: 2, shooter: 'long' },
  Levy: { quality: 4, combat: 2, shieldwall: true },

  // Ashfang Raiders
  'Raid-Leader': { quality: 3, combat: 4, leader: true, savage: true },
  Outrider: { quality: 3, combat: 3, fast: true, trample: true },
  Reaver: { quality: 4, combat: 4, big: true, rusher: true, dumb: true },
  Marauder: { quality: 4, combat: 3, rusher: true },
  'Wolf-Prowler': { quality: 4, combat: 2, fast: true, opportunist: true, disloyal: true },
  Whelp: { quality: 4, combat: 2, opportunist: true, disloyal: true },

  // Bonefield Legion
  'Death Knight': { quality: 3, combat: 4, slow: true, leader: true, mastery: true, reassembling: true },
  Deathblade: { quality: 4, combat: 3, fast: true, whirling: true, reassembling: true },
  'Skeleton Rider': { quality: 4, combat: 3, fast: true, reassembling: true },
  'Skeleton Archer': { quality: 4, combat: 2, shooter: 'normal', reassembling: true },
  Ghost: { quality: 4, combat: 2, flying: true, armored: true },
  'Skeleton Infantry': { quality: 4, combat: 3, reassembling: true, badBalance: true },

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
  'iron-wardens-small': {
    name: 'Iron Wardens (Small)',
    units: [
      { unit: 'Warden-Captain' },
      { unit: 'Ironguard' },
      { unit: 'Crossbow' },
    ],
  },
  'iron-wardens-medium': {
    name: 'Iron Wardens (Medium)',
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
  'iron-wardens-large': {
    name: 'Iron Wardens (Large)',
    units: [
      { unit: 'Warden-Captain' },
      { unit: 'Sentinel', count: 2 },
      { unit: 'Bulwark' },
      { unit: 'Ironguard', count: 2 },
      { unit: 'Halberdier', count: 2 },
      { unit: 'Crossbow' },
      { unit: 'Longbow', count: 2 },
      { unit: 'Levy' },
    ],
  },
  'ashfang-raiders-small': {
    name: 'Ashfang Raiders (Small)',
    units: [
      { unit: 'Raid-Leader' },
      { unit: 'Outrider' },
      { unit: 'Whelp' },
    ],
  },
  'ashfang-raiders-medium': {
    name: 'Ashfang Raiders (Medium)',
    units: [
      { unit: 'Raid-Leader' },
      { unit: 'Outrider' },
      { unit: 'Reaver' },
      { unit: 'Marauder', count: 2 },
      { unit: 'Wolf-Prowler' },
      { unit: 'Whelp', count: 2 },
    ],
  },
  'ashfang-raiders-large': {
    name: 'Ashfang Raiders (Large)',
    units: [
      { unit: 'Raid-Leader' },
      { unit: 'Outrider', count: 3 },
      { unit: 'Reaver', count: 2 },
      { unit: 'Marauder', count: 3 },
      { unit: 'Wolf-Prowler', count: 3 },
    ],
  },
  'bonefield-legion-small': {
    name: 'Bonefield Legion (Small)',
    units: [
      { unit: 'Death Knight' },
      { unit: 'Skeleton Rider' },
      { unit: 'Skeleton Infantry' },
    ],
  },
  'bonefield-legion-medium': {
    name: 'Bonefield Legion (Medium)',
    units: [
      { unit: 'Death Knight' },
      { unit: 'Deathblade' },
      { unit: 'Skeleton Rider' },
      { unit: 'Skeleton Infantry', count: 3 },
      { unit: 'Skeleton Archer', count: 2 },
    ],
  },
  'bonefield-legion-large': {
    name: 'Bonefield Legion (Large)',
    units: [
      { unit: 'Death Knight' },
      { unit: 'Deathblade', count: 2 },
      { unit: 'Skeleton Rider', count: 3 },
      { unit: 'Ghost' },
      { unit: 'Skeleton Infantry', count: 3 },
      { unit: 'Skeleton Archer', count: 2 },
    ],
  },
  'wild-menagerie-small': {
    name: 'Wild Menagerie (Small)',
    units: [
      { unit: 'Wild Wyvern' },
      { unit: 'Giant Spider' },
      { unit: 'Wolf' },
    ],
  },
  'wild-menagerie-medium': {
    name: 'Wild Menagerie (Medium)',
    units: [
      { unit: 'Wild Wyvern' },
      { unit: 'Bear' },
      { unit: 'Boar' },
      { unit: 'Giant Spider' },
      { unit: 'Wolf', count: 2 },
      { unit: 'Giant Rat', count: 2 },
    ],
  },
  'wild-menagerie-large': {
    name: 'Wild Menagerie (Large)',
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
