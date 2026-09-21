/**
 * Game modes. The mode decides how a match is won; the map's objectives decide
 * which modes it can host. `annihilation` is the original rule set and the
 * default — a config without a mode plays exactly as before.
 */
export type GameMode =
  | 'annihilation'
  | 'capture-the-flag'
  | 'king-of-the-hill'
  | 'conquest'
  | 'kill-the-king';

/** Every mode, in a fixed display order. */
export const GAME_MODES: ReadonlyArray<GameMode> = [
  'annihilation',
  'kill-the-king',
  'king-of-the-hill',
  'conquest',
  'capture-the-flag',
];
