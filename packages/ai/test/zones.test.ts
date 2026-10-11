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

const hillGame = (w0: UnitSpec[], w1: UnitSpec[], hill: Vec[] = HILL): GameState =>
  createGame({
    seed: 3,
    board: { width: 12, height: 8 },
    warbands: [w0, w1],
    mode: 'king-of-the-hill',
    objectives: { hill },
  });

const conquestGame = (w0: UnitSpec[], w1: UnitSpec[], zones: [Vec[], Vec[], Vec[]]): GameState =>
  createGame({
    seed: 3,
    board: { width: 12, height: 8 },
    warbands: [w0, w1],
    mode: 'conquest',
    objectives: { conquest: zones },
  });

/** Put `unitId` mid-activation with `actions` actions left (no dice, so no luck involved). */
function activate(s: GameState, unitId: string, actions = 1): GameState {
  return { ...s, phase: 'acting', activeUnitId: unitId, actionsRemaining: actions, activationCount: 1 };
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

  it('a spare on a held hill stays to keep it', () => {
    // Two on the hill against none: one would do, but the other is its margin.
    const s = activate(hillGame([U('a', 5, 1), U('b', 6, 1)], [U('c', 5, 5)]), 'p0u0');
    expect(chooseCommand(s).type).toBe('EndActivation');
  });

  it('a unit beyond the hill garrison goes hunting', () => {
    // The hill wants one to hold it and two spares; the fourth, furthest away, hunts.
    const s = activate(
      hillGame([U('a', 5, 1), U('b', 6, 1), U('c', 4, 2), U('d', 0, 7)], [U('e', 5, 7)]),
      'p0u3',
    );
    const cmd = chooseCommand(s);
    expect(cmd.type).toBe('Move');
    const board = makeHexGrid(s.board);
    const to = (cmd as Extract<Command, { type: 'Move' }>).to;
    expect(board.distance(to, { x: 5, y: 7 })).toBeLessThan(board.distance({ x: 0, y: 7 }, { x: 5, y: 7 }));
  });

  it('conquest: units split between the empty zones instead of crowding one', () => {
    const zones: [Vec[], Vec[], Vec[]] = [[{ x: 3, y: 3 }], [{ x: 4, y: 3 }], [{ x: 11, y: 7 }]];
    const s = createGame({
      seed: 1,
      board: { width: 12, height: 8 },
      // Both stand closest to zone 0; one of them should make for zone 1 instead.
      warbands: [[U('a', 2, 3), U('b', 2, 4)], [U('c', 11, 0)]],
      mode: 'conquest',
      objectives: { conquest: zones },
    });
    const board = makeHexGrid(s.board);
    const dest = (id: string) => (chooseCommand(activate(s, id)) as Extract<Command, { type: 'Move' }>).to;
    const targets = [dest('p0u0'), dest('p0u1')].map((to) => zones.findIndex((z) => board.distance(to, z[0]!) === 0));
    expect(targets.sort()).toEqual([0, 1]);
  });

  it('still attacks an adjacent enemy from the hill when the blow is a good one', () => {
    const s = activate(hillGame([U('a', 5, 1, { combat: 5 })], [U('b', 5, 2, { combat: 2 })]), 'p0u0');
    expect(chooseCommand(s).type).toBe('Attack');
  });

  it('a unit holding the hill at bad odds guards or holds rather than strike', () => {
    // Alone on the hill: a lost exchange would cost the hill as well.
    const foe = [U('b', 5, 2, { combat: 4 }), U('far', 11, 7)];
    const s = activate(hillGame([U('a', 5, 1, { guard: true })], foe), 'p0u0');
    expect(chooseCommand(s)).toEqual({ type: 'Guard', unitId: 'p0u0' });
    const plain = activate(hillGame([U('a', 5, 1)], foe), 'p0u0');
    expect(chooseCommand(plain).type).toBe('EndActivation');
    // Even against an equal it does not stake the hill on the exchange.
    const equal = activate(hillGame([U('a', 5, 1)], [U('b', 5, 2), U('far', 11, 7)]), 'p0u0');
    expect(chooseCommand(equal).type).toBe('EndActivation');
  });

  it('a unit sent to the hill takes the hex in it that flanks a foe a friend is fighting', () => {
    const board = makeHexGrid({ width: 12, height: 8, blocked: [] });
    const foe = { x: 6, y: 4 };
    const friend = board.neighbors(foe)[0]!;
    /** Straight across the foe from the friend: the hex that closes the pincer. */
    const flank = board.stepAway(friend, foe);
    /** A hex of the hill as near the mover, out of contact with the foe. */
    const start = { x: 3, y: 3 };
    const quiet = board
      .cellsWithin(start, board.distance(start, flank))
      .find((v) => board.distance(v, foe) > 1 && board.distance(v, start) === board.distance(start, flank))!;
    for (const hill of [
      [flank, quiet],
      [quiet, flank],
    ]) {
      const s = activate(hillGame([U('a', start.x, start.y), U('friend', friend.x, friend.y)], [U('foe', foe.x, foe.y), U('far', 11, 7)], hill), 'p0u0');
      expect(chooseCommand(s)).toEqual({ type: 'Move', unitId: 'p0u0', to: flank });
    }
  });

  it('a holder does not leave the hill, even for a foe it could charge from off it', () => {
    const s = activate(hillGame([U('a', 5, 1, { combat: 5 })], [U('b', 5, 3, { combat: 1 }), U('far', 11, 7)]), 'p0u0', 2);
    const cmd = chooseCommand(s);
    if (cmd.type === 'Move') expect(inZone(HILL, cmd.to)).toBe(true);
    expect(['Move', 'EndActivation', 'Guard']).toContain(cmd.type);
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

  it('conquest: a unit holding a zone alone at bad odds guards or holds rather than strike', () => {
    // Alone in its zone: a lost exchange would cost the zone as well.
    const zones: [Vec[], Vec[], Vec[]] = [HILL, [{ x: 0, y: 7 }], [{ x: 11, y: 0 }]];
    const foe = [U('b', 5, 2, { combat: 4 }), U('far', 11, 7)];
    const s = activate(conquestGame([U('a', 5, 1, { guard: true })], foe, zones), 'p0u0');
    expect(chooseCommand(s)).toEqual({ type: 'Guard', unitId: 'p0u0' });
    const plain = activate(conquestGame([U('a', 5, 1)], foe, zones), 'p0u0');
    expect(chooseCommand(plain).type).toBe('EndActivation');
    // A good blow from the zone is still struck.
    const strong = activate(conquestGame([U('a', 5, 1, { combat: 5 })], [U('b', 5, 2, { combat: 2 }), U('far', 11, 7)], zones), 'p0u0');
    expect(chooseCommand(strong).type).toBe('Attack');
  });

  it('conquest: a unit sent to a zone takes the hex in it that flanks a foe a friend is fighting', () => {
    const board = makeHexGrid({ width: 12, height: 8, blocked: [] });
    const foe = { x: 6, y: 4 };
    const friend = board.neighbors(foe)[0]!;
    /** Straight across the foe from the friend: the hex that closes the pincer. */
    const flank = board.stepAway(friend, foe);
    /** A hex of the zone as near the mover, out of contact with the foe. */
    const start = { x: 3, y: 3 };
    const quiet = board
      .cellsWithin(start, board.distance(start, flank))
      .find((v) => board.distance(v, foe) > 1 && board.distance(v, start) === board.distance(start, flank))!;
    // The other two zones are held, so the mover is the spare for this one.
    const held: Vec[][] = [[{ x: 0, y: 7 }], [{ x: 11, y: 0 }]];
    for (const zone of [
      [flank, quiet],
      [quiet, flank],
    ]) {
      const s = activate(
        conquestGame(
          [U('a', start.x, start.y), U('friend', friend.x, friend.y), U('h1', 0, 7), U('h2', 11, 0)],
          [U('foe', foe.x, foe.y), U('far', 11, 7)],
          [zone, held[0]!, held[1]!],
        ),
        'p0u0',
      );
      expect(chooseCommand(s)).toEqual({ type: 'Move', unitId: 'p0u0', to: flank });
    }
  });

  it('conquest: a holder does not leave its zone, even for a foe it could charge from outside it', () => {
    const zones: [Vec[], Vec[], Vec[]] = [HILL, [{ x: 0, y: 7 }], [{ x: 11, y: 0 }]];
    const s = activate(conquestGame([U('a', 5, 1, { combat: 5 })], [U('b', 5, 3, { combat: 1 }), U('far', 11, 7)], zones), 'p0u0', 2);
    const cmd = chooseCommand(s);
    if (cmd.type === 'Move') expect(inZone(HILL, cmd.to)).toBe(true);
    expect(['Move', 'EndActivation', 'Guard']).toContain(cmd.type);
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
