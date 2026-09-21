import { createGame, type GameState, type Owner } from '@fansong/engine';
import { DEFAULT_BOARD, buildMatch, type BoardSize } from './deploy.js';
import { getPreset } from './presets.js';
import { validateWarband, type Warband } from './warband.js';

/** Who controls a given player seat. */
export type Seat = 'human' | 'ai';

/**
 * A complete, serializable description of a match: which preset each player
 * fields, who controls each seat, and the RNG seed. This is the single shared
 * "start a game" payload — the CLI, the web UI, and (M4) a Durable Object all
 * turn one of these into an engine {@link GameState} via
 * {@link createMatchFromPresets}, so none of them lays units out on its own.
 */
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

/** Whether the given seat is controlled by the AI. */
export function isAiSeat(setup: MatchSetup, owner: Owner): boolean {
  return setup.seats[owner] === 'ai';
}

/** Resolve a preset id to a validated warband, or throw if unknown/illegal. */
export function resolveWarband(id: string): Warband {
  const wb = getPreset(id);
  if (!wb) throw new Error(`unknown preset "${id}"`);
  const check = validateWarband(wb);
  if (!check.ok) throw new Error(`preset "${id}" is illegal: ${check.errors.join('; ')}`);
  return wb;
}

/**
 * Turn a {@link MatchSetup} into an engine {@link GameState}, reusing the same
 * `buildMatch` deployment the CLI uses. No caller lays units out itself.
 */
export function createMatchFromPresets(setup: MatchSetup, board: BoardSize = DEFAULT_BOARD): GameState {
  const p0 = resolveWarband(setup.presets[0]);
  const p1 = resolveWarband(setup.presets[1]);
  return createGame(buildMatch(p0, p1, { seed: setup.seed, board }));
}
