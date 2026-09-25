import type { Warband } from './warband.js';

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
export const PRESETS: Record<string, Warband> = {
  'iron-wardens': {
    name: 'Iron Wardens',
    units: [
      { name: 'Warden-Captain', quality: 2, combat: 4 },
      { name: 'Ironguard', quality: 3, combat: 3 },
      { name: 'Bulwark', quality: 3, combat: 3, slow: true, tough: true, big: true },
      { name: 'Sentinel', quality: 3, combat: 3 },
      { name: 'Halberdier', quality: 4, combat: 3 },
      { name: 'Levy', quality: 4, combat: 2 },
    ],
  },
  'ashfang-raiders': {
    name: 'Ashfang Raiders',
    units: [
      { name: 'Raid-Leader', quality: 2, combat: 4, fast: true },
      { name: 'Marauder', quality: 3, combat: 3 },
      { name: 'Reaver', quality: 3, combat: 3 },
      { name: 'Wolf-Prowler', quality: 3, combat: 3, fast: true },
      { name: 'Outrider', quality: 3, combat: 3, fast: true },
      { name: 'Whelp', quality: 4, combat: 2 },
    ],
  },
  'free-company': {
    name: 'Free Company',
    units: [
      { name: 'Sergeant', quality: 3, combat: 4 },
      { name: 'Swordsman', quality: 3, combat: 3 },
      { name: 'Pikeman', quality: 3, combat: 3 },
      { name: 'Slinger', quality: 3, combat: 2, fast: true, shooter: 'short' },
      { name: 'Halberd-Recruit', quality: 4, combat: 3 },
      { name: 'Recruit', quality: 4, combat: 3 },
    ],
  },
  'hollow-watch': {
    name: 'Hollow Watch',
    units: [
      { name: 'Watch-Captain', quality: 2, combat: 4, guard: true },
      { name: 'Shield-Warden', quality: 3, combat: 3, tough: true },
      { name: 'Longbow', quality: 3, combat: 2, shooter: 'long' },
      { name: 'Crossbow', quality: 4, combat: 3, shooter: 'short' },
      { name: 'Sentry', quality: 3, combat: 3 },
    ],
  },
  'thorn-patrol': {
    name: 'Thorn Patrol',
    units: [
      { name: 'Thorn-Bow', quality: 3, combat: 2, shooter: 'normal' },
      { name: 'Thorn-Blade', quality: 3, combat: 4 },
      { name: 'Thorn-Spear', quality: 3, combat: 3 },
    ],
  },
  'sky-talons': {
    name: 'Sky Talons',
    units: [
      { name: 'Sky-Talon', quality: 3, combat: 3, fast: true, flying: true },
      { name: 'Storm-Talon', quality: 3, combat: 3, fast: true, flying: true },
      { name: 'Talon-Falconer', quality: 3, combat: 2, shooter: 'short' },
      { name: 'Skywatch', quality: 3, combat: 3 },
      { name: 'Fledgling', quality: 4, combat: 2, fast: true },
    ],
  },
  'bonefield-legion': {
    name: 'Bonefield Legion',
    units: [
      { name: 'Bone-Sergeant', quality: 3, combat: 3, reassembling: true, look: 'Skeleton Infantry' },
      { name: 'Skeleton Infantry', quality: 4, combat: 3, reassembling: true },
      { name: 'Bone-Legionary', quality: 4, combat: 3, reassembling: true, look: 'Skeleton Infantry' },
      { name: 'Skeleton Archer', quality: 4, combat: 2, shooter: 'short', reassembling: true },
      { name: 'Bone-Fletcher', quality: 4, combat: 2, shooter: 'short', reassembling: true, look: 'Skeleton Archer' },
    ],
  },
  'grave-knights': {
    name: 'Grave Knights',
    units: [
      { name: 'Skeleton Rider', quality: 4, combat: 3, reassembling: true },
      { name: 'Deathblade', quality: 4, combat: 3, reassembling: true },
      { name: 'Death Knight', quality: 4, combat: 3, reassembling: true },
    ],
  },
  'wild-menagerie': {
    name: 'Wild Menagerie',
    units: [
      { name: 'Falcon', quality: 4, combat: 2, fast: true, flying: true },
      { name: 'Giant Scorpion', quality: 4, combat: 3, fast: true, guard: true },
      { name: 'Crocodile', quality: 4, combat: 3, fast: true, tough: true },
      { name: 'Wolf', quality: 4, combat: 2, fast: true },
      { name: 'Boar', quality: 4, combat: 3, fast: true },
      { name: 'Giant Rat', quality: 5, combat: 2, fast: true },
    ],
  },
  'monstrous-horde': {
    name: 'Monstrous Horde',
    units: [
      { name: 'Wild Wyvern', quality: 3, combat: 4, fast: true, flying: true },
      { name: 'Bear', quality: 4, combat: 4, big: true },
      { name: 'Yeti', quality: 3, combat: 5, big: true },
      { name: 'Giant Spider', quality: 3, combat: 3, shooter: 'short', big: true },
    ],
  },
};

/** Stable list of preset ids, for CLI help and menus. */
export const PRESET_IDS = Object.keys(PRESETS);

/** Look up a preset by id, or `undefined` if unknown. */
export function getPreset(id: string): Warband | undefined {
  return PRESETS[id];
}
