import { describe, expect, it } from 'vitest';
import { createGame, makeHexGrid, type Command, type GameState, type UnitSpec, type Vec } from '@fansong/engine';
import { chooseCommand } from '../src/index.js';

const U = (name: string, x: number, y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 3,
  combat: 3,
  pos: { x, y },
  ...extra,
});

const PIG = (x: number, y: number): UnitSpec => U('pig', x, y, { pig: true, slow: true, tough: true });

/** The goal: the right-hand edge column of the 12×8 board. Player 0 escorts. */
const GOAL = Array.from({ length: 8 }, (_, y) => ({ x: 11, y }));

const pigGame = (w0: UnitSpec[], w1: UnitSpec[]): GameState =>
  createGame({ seed: 3, board: { width: 12, height: 8 }, warbands: [w0, w1], mode: 'golden-pig', objectives: { extraction: GOAL } });

/** Put `unitId` mid-activation with `actions` left (no dice, so no luck involved). */
function activate(s: GameState, unitId: string, actions = 1): GameState {
  const owner = s.units.find((u) => u.id === unitId)!.owner;
  return { ...s, active: owner, phase: 'acting', activeUnitId: unitId, actionsRemaining: actions, activationCount: 1 };
}

const moveTo = (cmd: Command): Vec => {
  expect(cmd.type).toBe('Move');
  return (cmd as Extract<Command, { type: 'Move' }>).to;
};

describe('AI in extract the golden Pig', () => {
  it('the Pig walks toward the goal', () => {
    const s = activate(pigGame([PIG(2, 4), U('a', 1, 4)], [U('d', 10, 0)]), 'p0u0');
    expect(moveTo(chooseCommand(s)).x).toBe(5);
  });

  it('the Pig steps into the goal when it can reach it, even past a fight', () => {
    const s = activate(pigGame([PIG(9, 4), U('a', 1, 4)], [U('d', 9, 6)]), 'p0u0');
    expect(moveTo(chooseCommand(s)).x).toBe(11);
  });

  it('the Pig ends its activation once it stands in the goal', () => {
    const s = activate(pigGame([PIG(11, 4), U('a', 1, 4)], [U('d', 10, 4)]), 'p0u0', 2);
    expect(chooseCommand(s)).toEqual({ type: 'EndActivation' });
  });

  it('the Pig is activated first, on three dice, when one roll can take it home', () => {
    const s = pigGame([U('a', 1, 4), U('b', 1, 5), PIG(6, 4)], [U('d', 0, 0)]);
    expect(chooseCommand(s)).toEqual({ type: 'ChooseActivation', unitId: 'p0u2', diceCount: 3 });
  });

  it('a defender strikes the Pig rather than a weaker escort beside it', () => {
    const s = activate(pigGame([PIG(5, 3), U('weak', 5, 5, { combat: 1 })], [U('d', 5, 4)]), 'p1u0');
    expect(chooseCommand(s)).toEqual({ type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
  });

  it('a defender heads for the Pig rather than the nearest escort', () => {
    const s = activate(pigGame([PIG(2, 1), U('a', 6, 7)], [U('d', 8, 4)]), 'p1u0');
    const board = makeHexGrid(s.board);
    const to = moveTo(chooseCommand(s));
    expect(board.distance(to, { x: 2, y: 1 })).toBeLessThan(board.distance({ x: 8, y: 4 }, { x: 2, y: 1 }));
    expect(board.distance(to, { x: 6, y: 7 })).toBeGreaterThan(1);
  });

  it('an escort turns back on a foe closing on the Pig', () => {
    const s = activate(pigGame([PIG(1, 4), U('a', 5, 4)], [U('raider', 2, 2), U('far', 11, 7)]), 'p0u1');
    const board = makeHexGrid(s.board);
    const to = moveTo(chooseCommand(s));
    expect(board.distance(to, { x: 2, y: 2 })).toBeLessThan(board.distance({ x: 5, y: 4 }, { x: 2, y: 2 }));
  });
});
