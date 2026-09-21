import { describe, expect, it } from 'vitest';
import { makeHexGrid, vecKey, type Vec } from '../src/board.js';

const grid = makeHexGrid({ width: 14, height: 14, blocked: [] });

/** Every in-bounds cell of a board, for property sweeps. */
function allCells(w: number, h: number): Vec[] {
  const cells: Vec[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push({ x, y });
  return cells;
}

describe('hex grid board', () => {
  it('reports bounds and blocked cells', () => {
    const g = makeHexGrid({ width: 8, height: 8, blocked: ['3,3'] });
    expect(g.inBounds({ x: 0, y: 0 })).toBe(true);
    expect(g.inBounds({ x: 8, y: 0 })).toBe(false);
    expect(g.inBounds({ x: -1, y: 2 })).toBe(false);
    expect(g.isBlocked({ x: 3, y: 3 })).toBe(true);
    expect(g.isBlocked({ x: 3, y: 4 })).toBe(false);
  });

  it('uses hex (cube) distance', () => {
    // Both offset axes step by one hex per unit near the origin column parity.
    expect(grid.distance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
    expect(grid.distance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1); // east neighbour
    expect(grid.distance({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(1); // south neighbour
    expect(grid.distance({ x: 0, y: 0 }, { x: 2, y: 0 })).toBe(2);
    expect(grid.distance({ x: 0, y: 0 }, { x: 0, y: 2 })).toBe(2);
  });

  it('distance is symmetric everywhere', () => {
    const cells = allCells(14, 14);
    for (const a of cells) {
      for (const b of cells) {
        expect(grid.distance(a, b)).toBe(grid.distance(b, a));
      }
    }
  });

  it('gives 6 neighbours for an interior cell', () => {
    const n = grid.neighbors({ x: 5, y: 5 });
    expect(n).toHaveLength(6);
    for (const c of n) expect(grid.distance({ x: 5, y: 5 }, c)).toBe(1);
  });

  it('clips neighbours at the board edge and skips blocked cells', () => {
    const corner = grid.neighbors({ x: 0, y: 0 });
    expect(corner.length).toBeGreaterThanOrEqual(2);
    expect(corner.length).toBeLessThan(6);
    for (const c of corner) expect(grid.inBounds(c)).toBe(true);

    const walled = makeHexGrid({ width: 8, height: 8, blocked: ['5,5'] });
    // (5,5) is a distance-1 neighbour of (4,5) on flat-top odd-q, so it is excluded.
    const near = walled.neighbors({ x: 4, y: 5 });
    expect(near.some((c) => vecKey(c) === '5,5')).toBe(false);
  });

  it('adjacency and distance agree — every neighbour is at distance 1 and reciprocal', () => {
    for (const c of allCells(14, 14)) {
      for (const n of grid.neighbors(c)) {
        expect(grid.distance(c, n)).toBe(1);
        // Reciprocity round-trips the offset<->cube conversion.
        expect(grid.neighbors(n).some((m) => vecKey(m) === vecKey(c))).toBe(true);
      }
    }
  });

  it('cellsWithin counts match the hex-disc formula away from edges', () => {
    // A hex disc of radius r has 3r(r+1) cells around the centre.
    expect(grid.cellsWithin({ x: 7, y: 7 }, 1)).toHaveLength(6);
    expect(grid.cellsWithin({ x: 7, y: 7 }, 2)).toHaveLength(18);
    expect(grid.cellsWithin({ x: 7, y: 7 }, 3)).toHaveLength(36);
    for (const c of grid.cellsWithin({ x: 7, y: 7 }, 3)) {
      const d = grid.distance({ x: 7, y: 7 }, c);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(3);
    }
  });

  it('cellsWithin is clipped to the board near a corner', () => {
    const within = grid.cellsWithin({ x: 0, y: 0 }, 2);
    for (const c of within) expect(grid.inBounds(c)).toBe(true);
    expect(within.length).toBeLessThan(18);
  });

  it('line of sight is clear across open ground', () => {
    expect(grid.lineOfSight({ x: 0, y: 5 }, { x: 6, y: 5 })).toBe(true);
  });

  it('line of sight is broken by a wall of blocked terrain', () => {
    // Block the whole x=3 column: any west-to-east lane must cross it.
    const blocked = Array.from({ length: 8 }, (_, y) => `3,${y}`);
    const walled = makeHexGrid({ width: 8, height: 8, blocked });
    expect(walled.lineOfSight({ x: 0, y: 4 }, { x: 6, y: 4 })).toBe(false);
    // A lane entirely west of the wall is still clear.
    expect(walled.lineOfSight({ x: 0, y: 4 }, { x: 2, y: 4 })).toBe(true);
  });

  it('line of sight is broken by an intervening occupied cell but not the endpoints', () => {
    // A full occupied column between the endpoints blocks; endpoints never count.
    const occupied = (v: Vec) => v.x === 3;
    expect(grid.lineOfSight({ x: 0, y: 4 }, { x: 6, y: 4 }, occupied)).toBe(false);
    // Endpoints themselves being "occupied" must not break their own sight.
    const endpointsOnly = (v: Vec) => vecKey(v) === '0,4' || vecKey(v) === '2,4';
    expect(grid.lineOfSight({ x: 0, y: 4 }, { x: 2, y: 4 }, endpointsOnly)).toBe(true);
  });
});
