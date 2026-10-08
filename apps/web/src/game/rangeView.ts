import { makeHexGrid, shotCells, unitById, vecKey, type GameState, type Vec } from '@fansong/engine';
import type { HexOverlay } from '../three/BoardView.js';

const RANGE_COLOR = 0xffc24a; // every hex a shot from there reaches
const RANGE_TARGET_COLOR = 0xff3b30; // of those, the ones an enemy stands on

/**
 * The shooter whose range the pointer's hex asks about: a living unit standing
 * on `cell` (its range from where it is), else the unit `actingId` names, as
 * if it had walked to `cell`. Null when that unit has no ranged attack.
 */
export function rangeShooter(state: GameState, cell: Vec, actingId: string | null) {
  const key = vecKey(cell);
  const onCell = state.units.find((u) => !u.dead && vecKey(u.pos) === key);
  const unit = onCell ?? (actingId ? unitById(state, actingId) : undefined);
  return unit && !unit.dead && unit.traits.ranged >= 1 ? unit : null;
}

/**
 * The tinted hexes that show what a shooter standing on `cell` could shoot at
 * (see {@link rangeShooter} and the engine's `shotCells`): its whole reach, and
 * brighter over each enemy caught in it. Empty when there is no shooter, the
 * hex can't be stood on, or it would be locked in melee there.
 */
export function shotRangeOverlays(state: GameState, cell: Vec, actingId: string | null): HexOverlay[] {
  const shooter = rangeShooter(state, cell, actingId);
  const board = makeHexGrid(state.board);
  if (!shooter || !board.inBounds(cell) || board.isBlocked(cell)) return [];
  const cells = shotCells(state, shooter, board, cell);
  if (cells.length === 0) return [];
  const enemies = new Set(state.units.filter((u) => !u.dead && u.owner !== shooter.owner).map((u) => vecKey(u.pos)));
  return [
    { cells: cells.filter((c) => !enemies.has(vecKey(c))), color: RANGE_COLOR, opacity: 0.32 },
    { cells: cells.filter((c) => enemies.has(vecKey(c))), color: RANGE_TARGET_COLOR, opacity: 0.6 },
  ];
}
