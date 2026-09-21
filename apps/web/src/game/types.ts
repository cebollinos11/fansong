import type { Owner } from '@fansong/engine';

/** Who controls a given player seat. */
export type Seat = 'human' | 'ai';

export interface MatchSetup {
  /** Preset id for each player (keys of PRESETS). */
  presets: [string, string];
  /** Who controls each seat. Hotseat = [human, human]; vs-AI = [human, ai]. */
  seats: [Seat, Seat];
  seed: number;
}

export const DEFAULT_SETUP: MatchSetup = {
  presets: ['iron-wardens', 'ashfang-raiders'],
  seats: ['human', 'ai'],
  seed: 42,
};

export function isAiSeat(setup: MatchSetup, owner: Owner): boolean {
  return setup.seats[owner] === 'ai';
}
