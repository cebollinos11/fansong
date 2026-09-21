import { describe, expect, it } from 'vitest';
import { createGame, type GameConfig } from '@fansong/engine';
import { renderBoard } from '../src/format.js';

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
