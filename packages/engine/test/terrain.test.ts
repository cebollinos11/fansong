import { describe, expect, it } from 'vitest';
import { makeHexGrid } from '../src/board.js';
import { createDemoGame, createGame, normalizeTerrain, type GameConfig } from '../src/setup.js';

const base: GameConfig = {
  seed: 1,
  board: { width: 6, height: 5 },
  warbands: [
    [{ name: 'A', quality: 3, combat: 3, pos: { x: 0, y: 0 } }],
    [{ name: 'B', quality: 3, combat: 3, pos: { x: 5, y: 4 } }],
  ],
};

describe('board terrain', () => {
  it('reports elevation and feature per hex, defaulting to flat and empty', () => {
    const g = makeHexGrid({
      width: 6,
      height: 5,
      blocked: [],
      terrain: { '1,1': { elevation: 2 }, '2,2': { feature: 'forest', elevation: 1 }, '3,3': { feature: 'rock' } },
    });
    expect(g.elevation({ x: 1, y: 1 })).toBe(2);
    expect(g.elevation({ x: 2, y: 2 })).toBe(1);
    expect(g.elevation({ x: 0, y: 0 })).toBe(0);
    expect(g.feature({ x: 2, y: 2 })).toBe('forest');
    expect(g.feature({ x: 1, y: 1 })).toBeUndefined();
  });

  it('treats rock and building as impassable, forest as passable', () => {
    const g = makeHexGrid({
      width: 6,
      height: 5,
      blocked: ['0,4'],
      terrain: { '1,1': { feature: 'rock' }, '2,1': { feature: 'building' }, '3,1': { feature: 'forest' } },
    });
    expect(g.isBlocked({ x: 1, y: 1 })).toBe(true);
    expect(g.isBlocked({ x: 2, y: 1 })).toBe(true);
    expect(g.isBlocked({ x: 3, y: 1 })).toBe(false);
    expect(g.isBlocked({ x: 0, y: 4 })).toBe(true); // legacy blocked still works
    // Impassable hexes are not neighbours.
    const ns = g.neighbors({ x: 1, y: 2 }).map((v) => `${v.x},${v.y}`);
    expect(ns).not.toContain('1,1');
  });

  it('a default game carries no terrain key (state shape unchanged)', () => {
    expect('terrain' in createGame(base).board).toBe(false);
    expect('terrain' in createDemoGame(3).board).toBe(false);
    // All-default terrain entries collapse away too.
    const flat = createGame({ ...base, board: { ...base.board, terrain: { '1,1': { elevation: 0 } } } });
    expect('terrain' in flat.board).toBe(false);
  });

  it('copies terrain into state, normalised and detached from the config', () => {
    const terrain = { '3,2': { feature: 'forest' as const }, '1,0': { elevation: 3 }, '2,2': {} };
    const s = createGame({ ...base, board: { ...base.board, terrain } });
    expect(s.board.terrain).toEqual({ '1,0': { elevation: 3 }, '3,2': { feature: 'forest' } });
    expect(Object.keys(s.board.terrain!)).toEqual(['1,0', '3,2']);
    terrain['1,0'].elevation = 1;
    expect(s.board.terrain!['1,0']!.elevation).toBe(3);
  });

  it('normalizeTerrain returns undefined for empty input', () => {
    expect(normalizeTerrain(undefined)).toBeUndefined();
    expect(normalizeTerrain({})).toBeUndefined();
  });
});
