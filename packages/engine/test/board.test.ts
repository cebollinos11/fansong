import { describe, expect, it } from 'vitest';
import { makeSquareGrid } from '../src/board.js';

const grid = makeSquareGrid({ width: 8, height: 8, blocked: ['3,3'] });

describe('square grid board', () => {
  it('uses Chebyshev distance', () => {
    expect(grid.distance({ x: 0, y: 0 }, { x: 2, y: 1 })).toBe(2);
    expect(grid.distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
    expect(grid.distance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
  });

  it('reports bounds and blocked cells', () => {
    expect(grid.inBounds({ x: 0, y: 0 })).toBe(true);
    expect(grid.inBounds({ x: 8, y: 0 })).toBe(false);
    expect(grid.inBounds({ x: -1, y: 2 })).toBe(false);
    expect(grid.isBlocked({ x: 3, y: 3 })).toBe(true);
    expect(grid.isBlocked({ x: 3, y: 4 })).toBe(false);
  });

  it('gives 8-directional neighbours within bounds and skips blocked', () => {
    // Corner has 3 neighbours.
    expect(grid.neighbors({ x: 0, y: 0 })).toHaveLength(3);
    // Around (2,3): (3,3) is blocked, so 7 of the 8 remain.
    expect(grid.neighbors({ x: 2, y: 3 })).toHaveLength(7);
  });

  it('line of sight is clear across open ground and broken by terrain', () => {
    // Top row (y=0) is clear of the (3,3) blocker.
    expect(grid.lineOfSight({ x: 0, y: 0 }, { x: 7, y: 0 })).toBe(true);
    // The (3,3) blocker sits on the main diagonal and breaks sight.
    expect(grid.lineOfSight({ x: 0, y: 0 }, { x: 7, y: 7 })).toBe(false);
    // A wall mid-diagonal on a fresh grid.
    const walled = makeSquareGrid({ width: 5, height: 5, blocked: ['2,2'] });
    expect(walled.lineOfSight({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
  });
});
