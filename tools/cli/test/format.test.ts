import { describe, expect, it } from 'vitest';
import { createGame, reduce, type GameConfig } from '@fansong/engine';
import { formatEvent, renderBoard, renderRoster } from '../src/format.js';

function game(board: GameConfig['board']) {
  return createGame({
    seed: 1,
    board,
    warbands: [
      [{ name: 'Archer', quality: 4, combat: 3, pos: { x: 0, y: 0 } }],
      [{ name: 'Brute', quality: 4, combat: 3, pos: { x: 3, y: 2 } }],
    ],
  });
}

describe('renderBoard', () => {
  it('renders a flat board with units and legacy blocked hexes', () => {
    const out = renderBoard(game({ width: 4, height: 3, blocked: ['2,1'] }));
    expect(out).toBe(
      [
        '  0 1 2 3',
        'A   ·',
        '  ·   ·',
        '·   #',
        '  ·   ·',
        '·   ·',
        '  ·   b',
        '',
      ].join('\n'),
    );
  });

  it('shows features as glyphs and elevation as a trailing digit', () => {
    const out = renderBoard(
      game({
        width: 4,
        height: 3,
        terrain: {
          '1,0': { feature: 'rock' },
          '2,0': { feature: 'building', elevation: 1 },
          '1,1': { feature: 'forest', elevation: 2 },
          '0,2': { elevation: 3 },
          // A unit standing on raised ground keeps its glyph and shows the height.
          '0,0': { elevation: 1 },
        },
      }),
    );
    expect(out).toBe(
      [
        '  0 1 2 3',
        'A1  B1',
        '  ^   ·',
        '·   ·',
        '  T2  ·',
        '·3  ·',
        '  ·   b',
        '',
      ].join('\n'),
    );
  });
});

describe('formatEvent', () => {
  it('prints a retreat: the call, a unit leaving, and how the game ended', () => {
    const state = createGame({
      seed: 1,
      board: { width: 8, height: 6 },
      warbands: [
        [{ name: 'Chief', quality: 2, combat: 3, leader: true, pos: { x: 2, y: 2 } }],
        [{ name: 'Brute', quality: 4, combat: 3, pos: { x: 7, y: 2 } }],
      ],
      retreatZones: [[{ x: 0, y: 2 }], []],
    });
    const acting = { ...state, phase: 'acting' as const, activeUnitId: 'p0u0', actionsRemaining: 3 };
    const called = reduce(acting, { type: 'Retreat', unitId: 'p0u0' });
    expect(called.events.map((e) => formatEvent(called.state, e))).toEqual(['  ⚑ Chief[p0u0] sounds the retreat: the flag goes up at (0,2)']);
    const left = reduce(called.state, { type: 'Move', unitId: 'p0u0', to: { x: 0, y: 2 } });
    expect(left.events.slice(1).map((e) => formatEvent(left.state, e))).toEqual([
      '    ⚑ Chief[p0u0] leaves the field by the retreat flag',
      '### GAME OVER — P1 wins (retreat) ###',
    ]);
    expect(renderRoster(left.state)).toBe('P0: Chief⚑\nP1: Brute');
  });
});
