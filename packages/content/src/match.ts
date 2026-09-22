import { createGame, type GameConfig, type GameMode, type GameState, type Owner } from '@fansong/engine';
import { DEFAULT_BOARD, buildMatch, type BoardSize } from './deploy.js';
import type { MapDef } from './map.js';
import { getMap } from './mapRegistry.js';
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
  /**
   * Map to play on (a built-in id from `listMaps`, or a custom map id the caller
   * can resolve). Omitted = the legacy flat {@link DEFAULT_BOARD}, which is
   * identical to the `open-field` map.
   */
  mapId?: string;
  /**
   * Game mode. Omitted = annihilation (the state then carries no mode data).
   * Every mode but annihilation and kill-the-king needs a `mapId` whose map
   * provides that mode's objectives.
   */
  mode?: GameMode;
  /**
   * Kill-the-king: index into each preset's units of the player's King.
   * Omitted = each side's `defaultKing`. Ignored in other modes.
   */
  kings?: [number, number];
}

/** Resolves a map id to its definition (built-ins by default). */
export type MapLookup = (id: string) => MapDef | undefined;

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

/** Resolve a setup's `mapId` via `lookup`, or throw if it names no known map. */
export function resolveMap(id: string, lookup: MapLookup = getMap): MapDef {
  const map = lookup(id);
  if (!map) throw new Error(`unknown map "${id}"`);
  return map;
}

/**
 * The engine {@link GameConfig} a {@link MatchSetup} deploys to — the seed +
 * board (with the map's terrain) + laid-out warbands. This is exactly what
 * {@link createMatchFromPresets} builds its state from, so recording it alongside
 * a game's command list yields a replay that reproduces the match, map included.
 *
 * `board` only applies when the setup names no map. `lookup` resolves
 * `setup.mapId` (built-in maps by default; pass one that also knows custom maps).
 */
export function configFromSetup(
  setup: MatchSetup,
  board: BoardSize = DEFAULT_BOARD,
  lookup: MapLookup = getMap,
): GameConfig {
  const p0 = resolveWarband(setup.presets[0]);
  const p1 = resolveWarband(setup.presets[1]);
  const mode = { mode: setup.mode, kings: setup.kings };
  if (setup.mapId !== undefined)
    return buildMatch(p0, p1, { seed: setup.seed, map: resolveMap(setup.mapId, lookup), ...mode });
  return buildMatch(p0, p1, { seed: setup.seed, board, ...mode });
}

/**
 * Turn a {@link MatchSetup} into an engine {@link GameState}, reusing the same
 * `buildMatch` deployment the CLI uses. No caller lays units out itself.
 */
export function createMatchFromPresets(
  setup: MatchSetup,
  board: BoardSize = DEFAULT_BOARD,
  lookup: MapLookup = getMap,
): GameState {
  return createGame(configFromSetup(setup, board, lookup));
}
