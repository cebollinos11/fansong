import type { GameConfig, Owner, UnitSpec, Vec } from '@fansong/engine';
import type { Warband, WarbandUnit } from './warband.js';

export interface BoardSize {
  width: number;
  height: number;
}

export interface MatchOptions {
  seed: number;
  board: BoardSize;
  /** Player who leads round 1 (default 0). */
  initiativeLeader?: Owner;
}

/** Default battlefield for a two-warband skirmish. */
export const DEFAULT_BOARD: BoardSize = { width: 12, height: 10 };

/**
 * Deterministic deployment: line a warband up in its home column(s). Player 0
 * deploys from the left edge rightward, player 1 from the right edge leftward.
 * Each column holds up to `board.height` models, vertically centred; overflow
 * wraps into the next column inward. No two placements collide.
 */
export function layOutWarband(units: WarbandUnit[], owner: Owner, board: BoardSize): UnitSpec[] {
  const perColumn = Math.max(1, board.height);
  const specs: UnitSpec[] = [];

  units.forEach((unit, i) => {
    const column = Math.floor(i / perColumn);
    const rowIndex = i % perColumn;
    // How many models share this column, to centre them vertically.
    const inColumn = Math.min(perColumn, units.length - column * perColumn);
    const top = Math.floor((board.height - inColumn) / 2);

    const x = owner === 0 ? column : board.width - 1 - column;
    const y = top + rowIndex;
    const pos: Vec = { x, y };

    specs.push({
      name: unit.name,
      quality: unit.quality,
      combat: unit.combat,
      move: unit.move,
      pos,
      // Carry the special-ability traits through to the engine profile.
      ranged: unit.ranged,
      tough: unit.tough,
      guard: unit.guard,
    });
  });

  return specs;
}

/**
 * Build an engine {@link GameConfig} from two warbands. Feed the result to
 * `createGame`. The same helper backs the CLI harness today and any future UI.
 */
export function buildMatch(p0: Warband, p1: Warband, opts: MatchOptions): GameConfig {
  return {
    seed: opts.seed,
    board: { width: opts.board.width, height: opts.board.height },
    warbands: [layOutWarband(p0.units, 0, opts.board), layOutWarband(p1.units, 1, opts.board)],
    initiativeLeader: opts.initiativeLeader ?? 0,
  };
}
