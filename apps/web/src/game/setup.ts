import {
  buildMatch,
  DEFAULT_BOARD,
  getPreset,
  validateWarband,
  type Warband,
} from '@fansong/content';
import { createGame, type GameState } from '@fansong/engine';
import type { MatchSetup } from './types.js';

/** Resolve a preset id to a validated warband, or throw if unknown/illegal. */
export function resolveWarband(id: string): Warband {
  const wb = getPreset(id);
  if (!wb) throw new Error(`unknown preset "${id}"`);
  const check = validateWarband(wb);
  if (!check.ok) throw new Error(`preset "${id}" is illegal: ${check.errors.join('; ')}`);
  return wb;
}

/**
 * Turn a UI {@link MatchSetup} into an engine {@link GameState}, reusing the same
 * `buildMatch` deployment the CLI uses. The UI never lays units out itself.
 */
export function createMatch(setup: MatchSetup): GameState {
  const p0 = resolveWarband(setup.presets[0]);
  const p1 = resolveWarband(setup.presets[1]);
  const config = buildMatch(p0, p1, { seed: setup.seed, board: DEFAULT_BOARD });
  return createGame(config);
}
