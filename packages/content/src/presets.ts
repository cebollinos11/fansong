import type { Warband } from './warband.js';

/**
 * Original preset warbands. Names, themes, and stat lines are FanSong's own —
 * no trademarked names or published profiles. Each is built to be legal under
 * {@link DEFAULT_RULES} (<= 200 pts); the preset test asserts that invariant.
 *
 * Design intent (so the AI-vs-AI matchups stay interesting):
 *  - iron-wardens : slow, tough, disciplined — wins by grinding.
 *  - ashfang-raiders : fast and fragile — wins by reaching you first.
 *  - free-company : a balanced generalist baseline.
 */
export const PRESETS: Record<string, Warband> = {
  'iron-wardens': {
    name: 'Iron Wardens',
    units: [
      { name: 'Warden-Captain', quality: 2, combat: 4, move: 3 },
      { name: 'Ironguard', quality: 3, combat: 4, move: 3 },
      { name: 'Bulwark', quality: 3, combat: 3, move: 3 },
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
      { name: 'Footpad', quality: 3, combat: 2, move: 4 },
      { name: 'Halberd-Recruit', quality: 4, combat: 3, move: 3 },
      { name: 'Recruit', quality: 4, combat: 2, move: 3 },
    ],
  },
};

/** Stable list of preset ids, for CLI help and menus. */
export const PRESET_IDS = Object.keys(PRESETS);

/** Look up a preset by id, or `undefined` if unknown. */
export function getPreset(id: string): Warband | undefined {
  return PRESETS[id];
}
