import { describe, expect, it } from 'vitest';
import { makeHexGrid, type BoardData, type Vec } from '../src/board.js';
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

describe('line of sight with terrain features', () => {
  const board = (terrain: BoardData['terrain'], blocked: string[] = []) =>
    makeHexGrid({ width: 9, height: 9, blocked, terrain });
  const a = { x: 0, y: 4 };
  const b = { x: 4, y: 4 };
  const mid = '2,4'; // straight down row 4 on the even columns' line

  it('rock and building block sight through them', () => {
    expect(board({}).lineOfSight(a, b)).toBe(true);
    expect(board({ [mid]: { feature: 'rock' } }).lineOfSight(a, b)).toBe(false);
    expect(board({ [mid]: { feature: 'building' } }).lineOfSight(a, b)).toBe(false);
  });

  it('forest blocks sight through it but not into or out of it', () => {
    const g = board({ [mid]: { feature: 'forest' } });
    expect(g.lineOfSight(a, b)).toBe(false);
    // A unit standing in the forest hex sees out, and is seen.
    expect(g.lineOfSight(a, { x: 2, y: 4 })).toBe(true);
    expect(g.lineOfSight({ x: 2, y: 4 }, b)).toBe(true);
    // Both ends in (separate) forest hexes, nothing between: still clear.
    const both = board({ '0,4': { feature: 'forest' }, '1,4': { feature: 'forest' } });
    expect(both.lineOfSight({ x: 0, y: 4 }, { x: 1, y: 4 })).toBe(true);
  });

  it('elevation alone never blocks sight', () => {
    expect(board({ [mid]: { elevation: 3 } }).lineOfSight(a, b)).toBe(true);
  });

  it('legacy blocked cells still block', () => {
    expect(board({}, [mid]).lineOfSight(a, b)).toBe(false);
  });

  it('is symmetric for every pair of hexes, including edge-grazing lines', () => {
    // A scatter of features on a 9x9 board; sight a->b must equal b->a everywhere.
    const g = board({
      '2,2': { feature: 'forest' },
      '3,5': { feature: 'rock' },
      '5,3': { feature: 'building' },
      '6,6': { feature: 'forest' },
      '4,1': { feature: 'forest' },
    });
    const cells: Vec[] = [];
    for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) cells.push({ x, y });
    for (const p of cells) {
      for (const q of cells) {
        expect(g.lineOfSight(p, q), `${p.x},${p.y} <-> ${q.x},${q.y}`).toBe(g.lineOfSight(q, p));
      }
    }
  });

  it('edge-grazing lines resolve deterministically', () => {
    // (0,2) -> (2,2) runs exactly along the edge between (1,1) and (1,2).
    // Exactly one of the two grazed hexes is on the drawn line, and repeat calls agree.
    const viaTop = board({ '1,1': { feature: 'rock' } });
    const viaBottom = board({ '1,2': { feature: 'rock' } });
    const p = { x: 0, y: 2 };
    const q = { x: 2, y: 2 };
    const results = [viaTop.lineOfSight(p, q), viaBottom.lineOfSight(p, q)];
    expect(results.filter((r) => !r)).toHaveLength(1);
    expect(viaTop.lineOfSight(p, q)).toBe(results[0]);
    expect(viaTop.lineOfSight(q, p)).toBe(results[0]);
    expect(viaBottom.lineOfSight(q, p)).toBe(results[1]);
  });
});
