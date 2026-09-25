import { describe, expect, it } from 'vitest';
import {
  createGame,
  makeHexGrid,
  type BoardData,
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

const kingGame = (w0: UnitSpec[], w1: UnitSpec[], board: Partial<BoardData> = {}): GameState =>
  createGame({
    seed: 3,
    board: { width: 12, height: 8, ...board },
    warbands: [w0, w1],
    mode: 'kill-the-king',
  });

/** Put `unitId` mid-activation with one action left (no dice, so no luck involved). */
function activate(s: GameState, unitId: string): GameState {
  return { ...s, phase: 'acting', activeUnitId: unitId, actionsRemaining: 1, activationCount: 1 };
}

const moveTo = (cmd: Command): Vec => {
  expect(cmd.type).toBe('Move');
  return (cmd as Extract<Command, { type: 'Move' }>).to;
};

describe('AI in kill-the-king', () => {
  it('attacks the enemy King over a weaker, downed foe', () => {
    const s = activate(
      kingGame([U('a', 5, 4, { king: true }), U('b', 5, 3)], [U('k', 5, 2, { king: true, combat: 5 }), U('w', 4, 3, { combat: 1 })]),
      'p0u1',
    );
    const downed = { ...s, units: s.units.map((u) => (u.id === 'p1u1' ? { ...u, knockedDown: true } : u)) };
    expect(chooseCommand(downed)).toEqual({ type: 'Attack', attackerId: 'p0u1', targetId: 'p1u0' });
  });

  it('shoots the enemy King rather than the nearest foe', () => {
    const s = activate(
      kingGame([U('k', 0, 0, { king: true }), U('archer', 5, 4, { ranged: 4 })], [U('w', 5, 2, { combat: 1 }), U('k', 8, 4, { king: true })]),
      'p0u1',
    );
    const cmd = chooseCommand(s);
    expect(cmd.type).toBe('Shoot');
    expect((cmd as Extract<Command, { type: 'Shoot' }>).targetId).toBe('p1u1');
  });

  it('heads for the enemy King rather than the nearest enemy', () => {
    const s = activate(kingGame([U('k', 0, 0, { king: true }), U('a', 5, 4)], [U('w', 5, 7), U('k', 10, 4, { king: true })]), 'p0u1');
    const board = makeHexGrid(s.board);
    const to = moveTo(chooseCommand(s));
    expect(board.distance(to, { x: 10, y: 4 })).toBeLessThan(board.distance({ x: 5, y: 4 }, { x: 10, y: 4 }));
  });

  it('turns back to protect its own King from a nearby threat', () => {
    // An enemy is closing on our King (west); the enemy King is far east.
    const s = activate(
      kingGame([U('k', 1, 4, { king: true }), U('a', 5, 4)], [U('raider', 2, 2), U('k', 11, 4, { king: true })]),
      'p0u1',
    );
    const board = makeHexGrid(s.board);
    const to = moveTo(chooseCommand(s));
    expect(board.distance(to, { x: 2, y: 2 })).toBeLessThan(board.distance({ x: 5, y: 4 }, { x: 2, y: 2 }));
  });

  it('the King steps away from an adjacent enemy instead of trading blows', () => {
    const s = activate(kingGame([U('k', 5, 4, { king: true }), U('a', 0, 0)], [U('b', 5, 3), U('k', 11, 7, { king: true })]), 'p0u0');
    const to = moveTo(chooseCommand(s));
    const board = makeHexGrid(s.board);
    expect(board.distance(to, { x: 5, y: 3 })).toBeGreaterThan(1);
  });

  it('the King stays put and guards when enemies are far away', () => {
    const game = (king: Partial<UnitSpec>) =>
      activate(kingGame([U('k', 1, 4, { king: true, ...king }), U('a', 2, 4)], [U('b', 11, 4), U('k', 11, 7, { king: true })]), 'p0u0');
    expect(chooseCommand(game({ guard: true }))).toEqual({ type: 'Guard', unitId: 'p0u0' });
    expect(chooseCommand(game({})).type).toBe('EndActivation');
  });

  it('the King still attacks the enemy King when it can', () => {
    const s = activate(kingGame([U('k', 5, 4, { king: true })], [U('k', 5, 3, { king: true })]), 'p0u0');
    expect(chooseCommand(s)).toEqual({ type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
  });

  it('prefers high ground among equally close hexes', () => {
    // Several hexes one (Slow, 3-hex) Move away get equally close to the target; one is raised.
    const start = { x: 2, y: 4 };
    const target = { x: 10, y: 4 };
    const base = kingGame([U('k', 0, 0, { king: true }), U('a', start.x, start.y, { slow: true })], [U('k', target.x, target.y, { king: true })]);
    const board = makeHexGrid(base.board);
    const reach = board.cellsWithin(start, 3);
    const closest = Math.min(...reach.map((c) => board.distance(c, target)));
    const opts = reach.filter((c) => board.distance(c, target) === closest);
    expect(opts.length).toBeGreaterThanOrEqual(2);
    const raised = opts[opts.length - 1]!;
    const s = activate(kingGame(
      [U('k', 0, 0, { king: true }), U('a', start.x, start.y, { slow: true })],
      [U('k', target.x, target.y, { king: true })],
      { terrain: { [`${raised.x},${raised.y}`]: { elevation: 1 } } },
    ), 'p0u1');
    expect(moveTo(chooseCommand(s))).toEqual(raised);
  });

  it('a shooter picks a standoff hex with a clear line of sight', () => {
    // A rock screen north-west of the enemy King hides the first-listed standoff hexes.
    const rocks = ['5,3', '5,4', '6,3', '6,4', '7,3'];
    const terrain = Object.fromEntries(rocks.map((k) => [k, { feature: 'rock' as const }]));
    const s = kingGame([U('k', 0, 0, { king: true }), U('archer', 3, 4, { ranged: 4 })], [U('k', 8, 4, { king: true })], { terrain });
    const board = makeHexGrid(s.board);
    const to = moveTo(chooseCommand(activate(s, 'p0u1')));
    const d = board.distance(to, { x: 8, y: 4 });
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(4);
    expect(board.lineOfSight(to, { x: 8, y: 4 })).toBe(true);
  });

  it('plays the same outside kill-the-king (no King plan without Kings)', () => {
    const plain = createGame({ seed: 3, board: { width: 12, height: 8 }, warbands: [[U('a', 5, 4)], [U('b', 5, 7)]] });
    const s = activate(plain, 'p0u0');
    expect(chooseCommand(s).type).toBe('Move');
  });
});
