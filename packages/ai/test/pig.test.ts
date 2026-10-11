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

/** A game with no clock, or one called after `roundLimit` rounds. */
const pigGame = (w0: UnitSpec[], w1: UnitSpec[], roundLimit?: number): GameState =>
  createGame({
    seed: 3,
    board: { width: 12, height: 8 },
    warbands: [w0, w1],
    mode: 'golden-pig',
    objectives: { extraction: GOAL },
    ...(roundLimit === undefined ? {} : { limits: { roundLimit } }),
  });

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
  it('the Pig walks toward the goal behind its escort', () => {
    const s = activate(pigGame([PIG(2, 4), U('a', 6, 4)], [U('d', 10, 0)]), 'p0u0');
    expect(moveTo(chooseCommand(s)).x).toBe(5);
  });

  it('the Pig does not walk ahead of its escort', () => {
    // Its escort is behind it or level with it: a hex nearer the goal counts for nothing yet.
    const behind = activate(pigGame([PIG(4, 4), U('a', 3, 4)], [U('d', 10, 0)]), 'p0u0');
    expect(chooseCommand(behind)).toEqual({ type: 'EndActivation' });
    const level = activate(pigGame([PIG(4, 4), U('a', 4, 5)], [U('d', 10, 0)]), 'p0u0');
    expect(chooseCommand(level)).toEqual({ type: 'EndActivation' });
  });

  it('the Pig stops short of where a foe could charge it', () => {
    // The foe charges a Move and a hex: six hexes. Three hexes on would be five from it.
    const s = activate(pigGame([PIG(2, 4), U('a', 9, 0)], [U('d', 10, 4)]), 'p0u0');
    const board = makeHexGrid(s.board);
    const to = moveTo(chooseCommand(s));
    expect(to.x).toBeGreaterThan(2);
    expect(board.distance(to, { x: 10, y: 4 })).toBeGreaterThan(6);
  });

  it('the Pig with no round to spare goes on, ahead of its escort and into reach of a foe', () => {
    // Three Moves from the goal with three rounds to play: there is no round to wait in.
    const alone = activate(pigGame([PIG(2, 4), U('a', 1, 4)], [U('d', 10, 0)], 3), 'p0u0');
    expect(moveTo(chooseCommand(alone)).x).toBe(5);
    const reach = activate(pigGame([PIG(2, 4), U('a', 9, 0)], [U('d', 10, 4)], 3), 'p0u0');
    expect(moveTo(chooseCommand(reach)).x).toBe(5);
    // With a round in hand it still waits for its escort.
    const spare = activate(pigGame([PIG(2, 4), U('a', 1, 4)], [U('d', 10, 0)], 4), 'p0u0');
    expect(chooseCommand(spare)).toEqual({ type: 'EndActivation' });
  });

  it('the Pig holds beside an equal foe rather than trade blows, and strikes a weak one', () => {
    const equal = activate(pigGame([PIG(5, 4), U('a', 9, 0)], [U('d', 6, 4)]), 'p0u0', 2);
    expect(chooseCommand(equal)).toEqual({ type: 'EndActivation' });
    const weak = activate(pigGame([PIG(5, 4), U('a', 9, 0)], [U('d', 6, 4, { combat: 1 })]), 'p0u0', 2);
    expect(chooseCommand(weak).type).toBe('Attack');
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

  it('an escort strikes the foe beside the Pig at odds it would refuse anywhere else', () => {
    // Between two foes, the one it can strike the stronger: no blow worth making, but for the Pig.
    const foes = [U('near', 2, 4, { combat: 4 }), U('far', 4, 4)];
    const s = activate(pigGame([PIG(1, 4), U('a', 3, 4)], foes), 'p0u1');
    expect(chooseCommand(s)).toEqual({ type: 'Attack', attackerId: 'p0u1', targetId: 'p1u0' });
    const elsewhere = [U('near', 2, 6, { combat: 4 }), U('far', 4, 6)];
    const away = activate(pigGame([PIG(1, 0), U('a', 3, 6)], elsewhere), 'p0u1');
    expect(chooseCommand(away)).toEqual({ type: 'EndActivation' });
  });

  it('an escort turns back on a foe closing on the Pig', () => {
    const s = activate(pigGame([PIG(1, 4), U('a', 5, 4)], [U('raider', 2, 2), U('far', 11, 7)]), 'p0u1');
    const board = makeHexGrid(s.board);
    const to = moveTo(chooseCommand(s));
    expect(board.distance(to, { x: 2, y: 2 })).toBeLessThan(board.distance({ x: 5, y: 4 }, { x: 2, y: 2 }));
  });
});
