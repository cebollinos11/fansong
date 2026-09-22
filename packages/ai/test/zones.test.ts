import { describe, expect, it } from 'vitest';
import {
  createGame,
  makeHexGrid,
  type Command,
  type GameConfig,
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

const HILL: Vec[] = [
  { x: 5, y: 1 },
  { x: 6, y: 1 },
];

const hillGame = (w0: UnitSpec[], w1: UnitSpec[]): GameState =>
  createGame({
    seed: 3,
    board: { width: 12, height: 8 },
    warbands: [w0, w1],
    mode: 'king-of-the-hill',
    objectives: { hill: HILL },
  });

/** Put `unitId` mid-activation with one action left (no dice, so no luck involved). */
function activate(s: GameState, unitId: string): GameState {
  return { ...s, phase: 'acting', activeUnitId: unitId, actionsRemaining: 1, activationCount: 1 };
}

const inZone = (zone: Vec[], v: Vec) => zone.some((h) => h.x === v.x && h.y === v.y);

describe('AI in the zone modes', () => {
  it('heads for the hill rather than toward the nearest enemy', () => {
    // The enemy sits south; the hill is north-east. Annihilation logic would walk south.
    const s = activate(hillGame([U('a', 2, 4)], [U('b', 2, 7)]), 'p0u0');
    const cmd = chooseCommand(s);
    expect(cmd.type).toBe('Move');
    const board = makeHexGrid(s.board);
    const to = (cmd as Extract<Command, { type: 'Move' }>).to;
    const dist = (v: Vec) => Math.min(...HILL.map((h) => board.distance(v, h)));
    expect(dist(to)).toBeLessThan(dist({ x: 2, y: 4 }));
  });

  it('steps onto the hill when it can reach it', () => {
    const s = activate(hillGame([U('a', 4, 3)], [U('b', 11, 7)]), 'p0u0');
    const cmd = chooseCommand(s);
    expect(cmd.type).toBe('Move');
    expect(inZone(HILL, (cmd as Extract<Command, { type: 'Move' }>).to)).toBe(true);
  });

  it('a lone holder sits tight instead of walking off the hill', () => {
    const s = activate(hillGame([U('a', 5, 1, { guard: true })], [U('b', 5, 5)]), 'p0u0');
    expect(chooseCommand(s)).toEqual({ type: 'Guard', unitId: 'p0u0' });
    const plain = activate(hillGame([U('a', 5, 1)], [U('b', 5, 5)]), 'p0u0');
    expect(chooseCommand(plain).type).toBe('EndActivation');
  });

  it('a spare unit on a securely held hill goes back to hunting', () => {
    // Two on the hill against none: either may leave without losing it.
    const s = activate(hillGame([U('a', 5, 1), U('b', 6, 1)], [U('c', 5, 5)]), 'p0u0');
    const cmd = chooseCommand(s);
    expect(cmd.type).toBe('Move');
    const board = makeHexGrid(s.board);
    expect(board.distance((cmd as Extract<Command, { type: 'Move' }>).to, { x: 5, y: 5 })).toBeLessThan(4);
  });

  it('still attacks an adjacent enemy from the hill', () => {
    const s = activate(hillGame([U('a', 5, 1)], [U('b', 5, 2)]), 'p0u0');
    expect(chooseCommand(s).type).toBe('Attack');
  });

  it('conquest: a unit makes for a zone its side does not already hold', () => {
    const zones: [Vec[], Vec[], Vec[]] = [[{ x: 1, y: 1 }], [{ x: 6, y: 4 }], [{ x: 10, y: 6 }]];
    const config: GameConfig = {
      seed: 1,
      board: { width: 12, height: 8 },
      // p0u0 already holds zone 0; p0u1 stands next to it, but zone 1 is the one left to take.
      warbands: [[U('a', 1, 1), U('b', 2, 2)], [U('c', 11, 0)]],
      mode: 'conquest',
      objectives: { conquest: zones },
    };
    const s = activate(createGame(config), 'p0u1');
    const cmd = chooseCommand(s);
    expect(cmd.type).toBe('Move');
    const board = makeHexGrid(s.board);
    const to = (cmd as Extract<Command, { type: 'Move' }>).to;
    expect(board.distance(to, zones[1][0]!)).toBeLessThan(board.distance({ x: 2, y: 2 }, zones[1][0]!));
  });

  it('prefers activating a unit that has a zone to reach over one already holding', () => {
    const s = hillGame([U('a', 5, 1), U('b', 1, 6)], [U('c', 11, 7)]);
    const cmd = chooseCommand(s);
    expect(cmd).toMatchObject({ type: 'ChooseActivation', unitId: 'p0u1' });
  });

  it('a unit one step from a zone is not mistaken for one that can attack', () => {
    // p0u0 is next to the hill with no enemy near; p0u1 is locked in melee.
    const s = hillGame([U('near-hill', 4, 1), U('in-melee', 1, 6)], [U('foe', 2, 6)]);
    expect(chooseCommand(s)).toMatchObject({ type: 'ChooseActivation', unitId: 'p0u1' });
  });

  it('a shooter near a zone but with no foe in range is not treated as able to shoot', () => {
    // The archer is 2 hexes from the hill (inside its shooting band) but no
    // enemy is in range; the swordsman is locked in melee and should go first.
    const s = hillGame(
      [U('archer', 3, 1, { ranged: 4 }), U('sword', 1, 6)],
      [U('foe', 2, 6), U('far', 11, 7)],
    );
    expect(chooseCommand(s)).toMatchObject({ type: 'ChooseActivation', unitId: 'p0u1' });
  });
});
