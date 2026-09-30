import { describe, expect, it } from 'vitest';
import {
  createGame,
  makeHexGrid,
  type Command,
  type GameState,
  type UnitSpec,
  type Vec,
} from '@fansong/engine';
import { chooseCommand } from '../src/index.js';

const U = (name: string, x: number, y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 3,
  combat: 3,
  pos: { x, y },
  ...extra,
});

const game = (w0: UnitSpec[], w1: UnitSpec[], mode?: 'kill-the-king'): GameState =>
  createGame({ seed: 3, board: { width: 12, height: 8 }, warbands: [w0, w1], ...(mode ? { mode } : {}) });

/** Put `unitId` mid-activation with `actions` actions left (no dice, so no luck involved). */
function activate(s: GameState, unitId: string, actions = 1): GameState {
  return { ...s, phase: 'acting', activeUnitId: unitId, actionsRemaining: actions, activationCount: 1 };
}

const moveTo = (cmd: Command): Vec => {
  expect(cmd.type).toBe('Move');
  return (cmd as Extract<Command, { type: 'Move' }>).to;
};

const dice = (cmd: Command): number => {
  expect(cmd.type).toBe('ChooseActivation');
  return (cmd as Extract<Command, { type: 'ChooseActivation' }>).diceCount;
};

describe('AI dice policy', () => {
  it('a shaky unit rolls one die while friends still wait on it', () => {
    // Quality 4: two dice turn over one time in four, benching the other five.
    const w0 = [0, 1, 2, 3, 4, 5].map((y) => U(`q4-${y}`, 0, y, { quality: 4 }));
    expect(dice(chooseCommand(game(w0, [U('foe', 11, 7)])))).toBe(1);
  });

  it('a reliable unit rolls two', () => {
    const w0 = [0, 1, 2, 3, 4, 5].map((y) => U(`q3-${y}`, 0, y));
    expect(dice(chooseCommand(game(w0, [U('foe', 11, 7)])))).toBe(2);
  });

  it('the last unit to act rolls all three: a turnover benches no one', () => {
    const s = game([U('done', 0, 0, { quality: 4 }), U('last', 0, 2, { quality: 4 })], [U('foe', 11, 7)]);
    const spent = { ...s, units: s.units.map((u) => (u.id === 'p0u0' ? { ...u, activatedThisRound: true } : u)) };
    expect(dice(chooseCommand(spent))).toBe(3);
  });
});

describe('AI combat judgement', () => {
  it('strikes the foe it can push off the edge of the map', () => {
    // Two equal foes; the second one has the map edge at its back.
    const s = activate(game([U('a', 1, 4)], [U('mid', 2, 4), U('edge', 0, 4)]), 'p0u0');
    expect(chooseCommand(s)).toMatchObject({ type: 'Attack', targetId: 'p1u1' });
  });

  it('charges the foe a friend is already fighting, to gang up on it', () => {
    // Two lone foes the same distance away; a friend is already in contact with the second.
    const s = activate(game([U('a', 5, 4), U('friend', 9, 1)], [U('lone', 2, 1), U('engaged', 8, 1)]), 'p0u0', 2);
    const board = makeHexGrid(s.board);
    expect(board.distance(moveTo(chooseCommand(s)), { x: 8, y: 1 })).toBe(1);
  });
});

describe('AI King safety', () => {
  it('the King backs away from a foe without backing onto the edge of the map', () => {
    const s = activate(
      game([U('k', 2, 4, { king: true }), U('guard', 6, 0)], [U('raider', 4, 4), U('k', 11, 7, { king: true })], 'kill-the-king'),
      'p0u0',
    );
    const to = moveTo(chooseCommand(s));
    const board = makeHexGrid(s.board);
    expect(board.distance(to, { x: 4, y: 4 })).toBeGreaterThan(2);
    expect(board.cellsWithin(to, 1).length).toBe(6);
  });
});
