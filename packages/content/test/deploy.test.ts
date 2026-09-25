import { describe, expect, it } from 'vitest';
import { createGame, reduce, getLegalCommands, vecKey } from '@fansong/engine';
import { buildMatch, DEFAULT_BOARD, layOutWarband } from '../src/deploy.js';
import { PRESETS } from '../src/presets.js';

const board = DEFAULT_BOARD;

describe('layOutWarband', () => {
  it('places player 0 on the left edge and player 1 on the right edge', () => {
    const p0 = layOutWarband(PRESETS['iron-wardens']!.units, 0, board);
    const p1 = layOutWarband(PRESETS['ashfang-raiders']!.units, 1, board);
    expect(p0.every((s) => s.pos.x === 0)).toBe(true); // one column fits
    expect(p1.every((s) => s.pos.x === board.width - 1)).toBe(true);
  });

  it('keeps every model in bounds with no two sharing a cell', () => {
    // A deliberately overflowing roster to exercise column wrapping.
    const units = Array.from({ length: board.height + 3 }, (_, i) => ({
      name: `U${i}`,
      quality: 4,
      combat: 2,
    }));
    const specs = layOutWarband(units, 0, board);
    const seen = new Set<string>();
    for (const s of specs) {
      expect(s.pos.x).toBeGreaterThanOrEqual(0);
      expect(s.pos.x).toBeLessThan(board.width);
      expect(s.pos.y).toBeGreaterThanOrEqual(0);
      expect(s.pos.y).toBeLessThan(board.height);
      const key = vecKey(s.pos);
      expect(seen.has(key), `collision at ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('wraps overflow into a second column inward from the edge', () => {
    const units = Array.from({ length: board.height + 1 }, (_, i) => ({
      name: `U${i}`,
      quality: 4,
      combat: 2,
    }));
    const p0 = layOutWarband(units, 0, board);
    const p1 = layOutWarband(units, 1, board);
    expect(p0.some((s) => s.pos.x === 1)).toBe(true);
    expect(p1.some((s) => s.pos.x === board.width - 2)).toBe(true);
  });
});

describe('buildMatch', () => {
  it('produces a config that createGame accepts and can start reducing', () => {
    const config = buildMatch(PRESETS['iron-wardens']!, PRESETS['free-company']!, {
      seed: 7,
      board,
    });
    const state = createGame(config);
    expect(state.units).toHaveLength(
      PRESETS['iron-wardens']!.units.length + PRESETS['free-company']!.units.length,
    );
    // No two units start stacked, and there is a legal opening move.
    expect(new Set(state.units.map((u) => vecKey(u.pos))).size).toBe(state.units.length);
    expect(getLegalCommands(state).length).toBeGreaterThan(0);
    // One reduce step keeps the game well-formed.
    const next = reduce(state, getLegalCommands(state)[0]!);
    expect(next.state.units).toHaveLength(state.units.length);
  });

  it('honours the requested initiative leader', () => {
    const config = buildMatch(PRESETS['iron-wardens']!, PRESETS['free-company']!, {
      seed: 1,
      board,
      initiativeLeader: 1,
    });
    expect(createGame(config).initiativeLeader).toBe(1);
  });
});
