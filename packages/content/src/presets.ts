import type { Warband } from './warband.js';

/**
 * Original preset warbands. Names, themes, and stat lines are FanSong's own —
 * no trademarked names or published profiles. Each is built to be legal under
 * {@link DEFAULT_RULES} (<= 200 pts); the preset test asserts that invariant.
 *
 * Design intent (so the AI-vs-AI matchups stay interesting):
 *  - iron-wardens : slow, tough, disciplined — wins by grinding; a Tough bulwark.
 *  - ashfang-raiders : fast and fragile — wins by reaching you first (melee only).
 *  - free-company : a balanced generalist baseline with a ranged skirmisher.
 *  - hollow-watch : a defensive garrison showcasing all three M5 traits
 *    (Ranged bows, a Tough shield-warden, and a Guard captain).
 */
export const PRESETS: Record<string, Warband> = {
  'iron-wardens': {
    name: 'Iron Wardens',
    units: [
      { name: 'Warden-Captain', quality: 2, combat: 4, move: 3 },
      { name: 'Ironguard', quality: 3, combat: 4, move: 3 },
      { name: 'Bulwark', quality: 3, combat: 3, move: 3, tough: true },
      { name: 'Sentinel', quality: 3, combat: 3, move: 3 },
      { name: 'Halberdier', quality: 4, combat: 3, move: 3 },
      { name: 'Levy', quality: 4, combat: 2, move: 3 },
    ],
  },
  'ashfang-raiders': {
    name: 'Ashfang Raiders',
    units: [
      { name: 'Raid-Leader', quality: 2, combat: 3, move: 4 },
      { name: 'Marauder', quality: 3, combat: 3, move: 4 },
      { name: 'Reaver', quality: 3, combat: 3, move: 4 },
      { name: 'Wolf-Prowler', quality: 3, combat: 2, move: 5 },
      { name: 'Outrider', quality: 3, combat: 2, move: 5 },
      { name: 'Whelp', quality: 4, combat: 2, move: 4 },
    ],
  },
  'free-company': {
    name: 'Free Company',
    units: [
      { name: 'Sergeant', quality: 3, combat: 4, move: 3 },
      { name: 'Swordsman', quality: 3, combat: 3, move: 3 },
      { name: 'Pikeman', quality: 3, combat: 3, move: 3 },
      { name: 'Slinger', quality: 3, combat: 2, move: 4, ranged: 3 },
      { name: 'Halberd-Recruit', quality: 4, combat: 3, move: 3 },
      { name: 'Recruit', quality: 4, combat: 2, move: 3 },
    ],
  },
  'hollow-watch': {
    name: 'Hollow Watch',
    units: [
      { name: 'Watch-Captain', quality: 2, combat: 4, move: 3, guard: true },
      { name: 'Shield-Warden', quality: 3, combat: 3, move: 3, tough: true },
      { name: 'Longbow', quality: 3, combat: 2, move: 3, ranged: 4 },
      { name: 'Crossbow', quality: 4, combat: 2, move: 3, ranged: 3 },
      { name: 'Sentry', quality: 4, combat: 3, move: 3 },
    ],
  },
};

/** Stable list of preset ids, for CLI help and menus. */
export const PRESET_IDS = Object.keys(PRESETS);

/** Look up a preset by id, or `undefined` if unknown. */
export function getPreset(id: string): Warband | undefined {
  return PRESETS[id];
}
