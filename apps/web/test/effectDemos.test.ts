import { createGame, isLegalCommand, reduce, type GameState } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { EFFECT_DEMOS, stageDemo } from '../src/game/effectDemos.js';

const FIGHTER = { name: 'Fighter', quality: 3, combat: 3 };

function board(width: number, height: number): GameState {
  return createGame({
    seed: 7,
    board: { width, height },
    warbands: [[{ ...FIGHTER, pos: { x: 0, y: 0 } }], [{ ...FIGHTER, pos: { x: width - 1, y: height - 1 } }]],
  });
}

describe('effect demos', () => {
  for (const [width, height] of [
    [12, 10],
    [9, 7],
  ] as const) {
    for (const demo of EFFECT_DEMOS) {
      it(`${demo.id} plays its trait on a ${width}x${height} board`, () => {
        const { state, command } = stageDemo(board(width, height), demo.id);
        expect(isLegalCommand(state, command)).toBe(true);
        expect(demo.shows(reduce(state, command).events)).toBe(true);
      });
    }
  }

  it('stages one demo over another', () => {
    const first = stageDemo(board(12, 10), 'woodwise');
    const after = reduce(first.state, first.command).state;
    const { state, command } = stageDemo(after, 'disloyal');
    expect(EFFECT_DEMOS.find((d) => d.id === 'disloyal')!.shows(reduce(state, command).events)).toBe(true);
  });

  it('refuses a board too small to hold a scene', () => {
    expect(() => stageDemo(board(3, 3), 'pincer')).toThrow(/too small/);
  });
});
