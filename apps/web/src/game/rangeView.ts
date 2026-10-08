import { makeHexGrid, shotCellsWithin, unitById, vecKey, type GameState, type Owner, type Vec } from '@fansong/engine';
import type { HexOverlay } from '../three/BoardView.js';

const RANGE_COLOR = 0xffc24a; // every hex a shot from there reaches
const RANGE_TARGET_COLOR = 0xff3b30; // of those, the ones an enemy stands on

/** The range shown when no shooter is in question: a typical bow's. */
export const DEFAULT_SHOT_RANGE = 5;

/** Who would be shooting from a hex, for {@link shotRangeOverlays}. */
export interface RangeShooter {
  owner: Owner;
  range: number;
  /** The unit that would walk there, when there is one. */
  unitId?: string;
}

/**
 * The shooter the pointer's hex asks about: a living unit standing on `cell`
 * (its range from where it is), else the unit `actingId` names, as if it had
 * walked to `cell`, else nobody in particular on the side to act. One with no
 * ranged attack of its own is shown {@link DEFAULT_SHOT_RANGE}, so the key
 * always answers "what could a shooter reach from here".
 */
export function rangeShooter(state: GameState, cell: Vec, actingId: string | null): RangeShooter {
  const key = vecKey(cell);
  const onCell = state.units.find((u) => !u.dead && vecKey(u.pos) === key);
  const acting = actingId ? unitById(state, actingId) : undefined;
  const unit = onCell ?? (acting && !acting.dead ? acting : undefined);
  if (!unit) return { owner: state.active, range: DEFAULT_SHOT_RANGE };
  return { owner: unit.owner, range: unit.traits.ranged >= 1 ? unit.traits.ranged : DEFAULT_SHOT_RANGE, unitId: unit.id };
}

/**
 * The tinted hexes that show what a shooter standing on `cell` could shoot at
 * (see {@link rangeShooter} and the engine's `shotCells`): its whole reach, and
 * brighter over each enemy caught in it. Empty when the hex can't be stood on,
 * or a shooter would be locked in melee there.
 */
export function shotRangeOverlays(state: GameState, cell: Vec, actingId: string | null): HexOverlay[] {
  const board = makeHexGrid(state.board);
  if (!board.inBounds(cell) || board.isBlocked(cell)) return [];
  const shooter = rangeShooter(state, cell, actingId);
  const cells = shotCellsWithin(state, board, cell, shooter.range, shooter.owner, shooter.unitId);
  if (cells.length === 0) return [];
  const enemies = new Set(state.units.filter((u) => !u.dead && u.owner !== shooter.owner).map((u) => vecKey(u.pos)));
  return [
    { cells: cells.filter((c) => !enemies.has(vecKey(c))), color: RANGE_COLOR, opacity: 0.32 },
    { cells: cells.filter((c) => enemies.has(vecKey(c))), color: RANGE_TARGET_COLOR, opacity: 0.6 },
  ];
}
