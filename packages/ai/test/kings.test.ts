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

/** Put `unitId` mid-activation with `actions` actions left (no dice, so no luck involved). */
function activate(s: GameState, unitId: string, actions = 1): GameState {
  return { ...s, phase: 'acting', activeUnitId: unitId, actionsRemaining: actions, activationCount: 1 };
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

  it('strikes the foe that threatens its King rather than a like foe that does not', () => {
    const board = makeHexGrid({ width: 12, height: 8, blocked: [] });
    const at = { x: 5, y: 4 };
    const beside = board.neighbors(at);
    // Two like foes on opposite sides of the unit, and our King beside one of them only.
    for (const raider of [beside[0]!, beside[3]!]) {
      const other = board.stepAway(raider, at);
      const king = board.stepAway(at, raider);
      expect(board.distance(king, other)).toBeGreaterThan(1);
      for (const foes of [
        [U('raider', raider.x, raider.y), U('other', other.x, other.y)],
        [U('other', other.x, other.y), U('raider', raider.x, raider.y)],
      ]) {
        const s = activate(
          kingGame([U('k', king.x, king.y, { king: true }), U('a', at.x, at.y, { combat: 4 })], [U('k', 11, 7, { king: true }), ...foes]),
          'p0u1',
        );
        const cmd = chooseCommand(s);
        expect(cmd.type).toBe('Attack');
        const target = s.units.find((u) => u.id === (cmd as Extract<Command, { type: 'Attack' }>).targetId)!;
        expect(target.name).toBe('raider');
      }
    }
  });

  it('the King does not trade blows with a foe on its feet, however weak', () => {
    const game = (king: Partial<UnitSpec>, foe: Partial<UnitSpec>) =>
      activate(
        kingGame([U('k', 5, 4, { king: true, ...king }), U('a', 0, 0)], [U('b', 5, 3, foe), U('k', 11, 7, { king: true })]),
        'p0u0',
      );
    expect(chooseCommand(game({}, {})).type).toBe('EndActivation');
    expect(chooseCommand(game({ combat: 5 }, { combat: 1 })).type).toBe('EndActivation');
    expect(chooseCommand(game({ guard: true }, {}))).toEqual({ type: 'Guard', unitId: 'p0u0' });
    // A foe on the ground cannot hit back: that one it finishes.
    const s = game({}, {});
    const downed = { ...s, units: s.units.map((u) => (u.id === 'p1u0' ? { ...u, knockedDown: true } : u)) };
    expect(chooseCommand(downed)).toEqual({ type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
  });

  it('the King steps out of the reach of a foe that could charge it', () => {
    // Six hexes off: a Move and a blow away, and further than the ladder ever looked.
    const foe = { x: 11, y: 4 };
    const s = activate(
      kingGame([U('k', 5, 4, { king: true }), U('a', 0, 0)], [U('b', foe.x, foe.y), U('k', 19, 7, { king: true })], { width: 20 }),
      'p0u0',
    );
    const board = makeHexGrid(s.board);
    expect(board.distance({ x: 5, y: 4 }, foe)).toBe(6);
    expect(board.distance(moveTo(chooseCommand(s)), foe)).toBeGreaterThan(6);
  });

  it('strikes at the enemy King even at odds it would refuse against anyone else', () => {
    const game = (king: boolean) =>
      activate(kingGame([U('k', 0, 0, { king: true }), U('a', 5, 4, { combat: 2 })], [U('big', 5, 3, { combat: 5, king }), U('other', 11, 7, { king: !king })]), 'p0u1');
    expect(chooseCommand(game(false)).type).toBe('EndActivation');
    expect(chooseCommand(game(true))).toEqual({ type: 'Attack', attackerId: 'p0u1', targetId: 'p1u0' });
  });

  it('takes the hex that flanks the enemy King a friend is fighting', () => {
    const board = makeHexGrid({ width: 12, height: 8, blocked: [] });
    const king = { x: 6, y: 4 };
    const friend = board.neighbors(king)[0]!;
    /** Straight across the King from the friend: the hex that closes the pincer. */
    const flank = board.stepAway(friend, king);
    const s = activate(
      kingGame([U('k', 0, 0, { king: true }), U('a', 3, 3), U('friend', friend.x, friend.y)], [U('k', king.x, king.y, { king: true }), U('far', 11, 7)]),
      'p0u1',
    );
    expect(chooseCommand(s)).toEqual({ type: 'Move', unitId: 'p0u1', to: flank });
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
