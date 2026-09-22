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

const BASES: [Vec, Vec] = [
  { x: 1, y: 4 },
  { x: 10, y: 4 },
];

const flagGame = (w0: UnitSpec[], w1: UnitSpec[], blocked: string[] = []): GameState =>
  createGame({
    seed: 3,
    board: { width: 12, height: 8, blocked },
    warbands: [w0, w1],
    mode: 'capture-the-flag',
    objectives: { flags: BASES },
  });

/** Put `unitId` mid-activation with one action left (no dice, so no luck involved). */
function activate(s: GameState, unitId: string): GameState {
  return { ...s, phase: 'acting', activeUnitId: unitId, actionsRemaining: 1, activationCount: 1 };
}

/** Rewrite the flag state (the carrier's flag `at` follows the carrier). */
function withFlags(s: GameState, flags: [{ at: Vec; carrier: string | null }, { at: Vec; carrier: string | null }]): GameState {
  return { ...s, mode: { ...s.mode!, flags } };
}

const moveTo = (cmd: Command): Vec => {
  expect(cmd.type).toBe('Move');
  return (cmd as Extract<Command, { type: 'Move' }>).to;
};

describe('AI in capture-the-flag', () => {
  it('makes for the enemy flag rather than the nearest enemy', () => {
    // The enemy stands south; the enemy flag is east.
    const s = activate(flagGame([U('a', 5, 4)], [U('b', 5, 7)]), 'p0u0');
    const board = makeHexGrid(s.board);
    expect(board.distance(moveTo(chooseCommand(s)), BASES[1])).toBeLessThan(board.distance({ x: 5, y: 4 }, BASES[1]));
  });

  it('grabs the enemy flag when it can reach it, even with a foe to hit', () => {
    const s = activate(flagGame([U('a', 8, 4)], [U('b', 8, 5)]), 'p0u0');
    expect(moveTo(chooseCommand(s))).toEqual(BASES[1]);
  });

  it('the carrier runs for home instead of fighting', () => {
    let s = flagGame([U('a', 6, 4)], [U('b', 6, 5)]);
    s = withFlags(s, [{ at: BASES[0], carrier: null }, { at: { x: 6, y: 4 }, carrier: 'p0u0' }]);
    const board = makeHexGrid(s.board);
    const to = moveTo(chooseCommand(activate(s, 'p0u0')));
    expect(board.distance(to, BASES[0])).toBeLessThan(board.distance({ x: 6, y: 4 }, BASES[0]));
  });

  it('the carrier steps onto its base to capture', () => {
    let s = flagGame([U('a', 3, 4)], [U('b', 11, 0)]);
    s = withFlags(s, [{ at: BASES[0], carrier: null }, { at: { x: 3, y: 4 }, carrier: 'p0u0' }]);
    expect(moveTo(chooseCommand(activate(s, 'p0u0')))).toEqual(BASES[0]);
  });

  it('the carrier is the first unit activated', () => {
    let s = flagGame([U('a', 5, 1), U('b', 6, 4)], [U('c', 5, 2)]);
    s = withFlags(s, [{ at: BASES[0], carrier: null }, { at: { x: 6, y: 4 }, carrier: 'p0u1' }]);
    expect(chooseCommand(s)).toMatchObject({ type: 'ChooseActivation', unitId: 'p0u1' });
  });

  it('returns its own dropped flag when it can reach it', () => {
    let s = flagGame([U('a', 4, 2)], [U('b', 11, 7)]);
    s = withFlags(s, [{ at: { x: 5, y: 2 }, carrier: null }, { at: BASES[1], carrier: null }]);
    expect(moveTo(chooseCommand(activate(s, 'p0u0')))).toEqual({ x: 5, y: 2 });
  });

  it('attacks the enemy carrier before any other foe', () => {
    // Both enemies are adjacent; the carrier is the stronger one.
    let s = flagGame([U('a', 5, 4)], [U('weak', 5, 3, { combat: 1 }), U('carrier', 5, 5, { combat: 4 })]);
    s = withFlags(s, [{ at: { x: 5, y: 5 }, carrier: 'p1u1' }, { at: BASES[1], carrier: null }]);
    expect(chooseCommand(activate(s, 'p0u0'))).toMatchObject({ type: 'Attack', targetId: 'p1u1' });
  });

  it('walks around a wall rather than into it', () => {
    // A wall straight east of the unit, open at the top row: walking distance, not hex distance.
    const wall = [1, 2, 3, 4, 5, 6, 7].map((y) => `7,${y}`);
    let s = flagGame([U('a', 6, 4)], [U('b', 11, 7)], wall);
    s = withFlags(s, [{ at: BASES[0], carrier: null }, { at: BASES[1], carrier: null }]);
    const to = moveTo(chooseCommand(activate(s, 'p0u0')));
    expect(to.y).toBeLessThan(4);
  });
});
