import { describe, expect, it } from 'vitest';
import {
  createDemoGame,
  createGame,
  getLegalCommands,
  makeHexGrid,
  reduce,
  unitById,
  type Command,
  type GameState,
  type UnitSpec,
  type Vec,
} from '@fansong/engine';
import { chooseCommand } from '../src/index.js';
import { activationOrder, exposure, MoveSetup, threat, withUnitAt } from '../src/tactics.js';

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
    // Two equal foes; the second one has the map edge at its back. (Strong enough that a blow is worth it, outnumbered as it is.)
    const s = activate(game([U('a', 1, 4, { combat: 5 })], [U('mid', 2, 4), U('edge', 0, 4)]), 'p0u0');
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
  it('the King in reach of a foe wherever it goes does not back onto the edge of the map', () => {
    const s = activate(
      game([U('k', 2, 4, { king: true }), U('guard', 6, 0)], [U('raider', 4, 4), U('k', 11, 7, { king: true })], 'kill-the-king'),
      'p0u0',
    );
    const cmd = chooseCommand(s);
    const board = makeHexGrid(s.board);
    const to = cmd.type === 'Move' ? cmd.to : { x: 2, y: 4 };
    expect(board.distance(to, { x: 4, y: 4 })).toBeGreaterThan(1);
    expect(board.cellsWithin(to, 1).length).toBe(6);
  });
});

describe('AI setup moves', () => {
  const board = makeHexGrid({ width: 12, height: 8, blocked: [] });
  /** As {@link activate}, with the unit marked as having gone this round, as it is in play. */
  const moving = (s: GameState, unitId: string): GameState =>
    activate({ ...s, units: s.units.map((u) => (u.id === unitId ? { ...u, activatedThisRound: true } : u)) }, unitId);

  it('steps behind the foe a friend is fighting, to give the friend the pincer', () => {
    const foe = { x: 7, y: 4 };
    let tried = 0;
    // Wherever the friend stands, the hex straight across the foe from it closes the pincer.
    for (const friend of board.neighbors(foe)) {
      const s = moving(game([U('a', 5, 4), U('friend', friend.x, friend.y)], [U('foe', foe.x, foe.y)]), 'p0u0');
      const across = board.stepAway(friend, foe);
      if (!getLegalCommands(s).some((c) => c.type === 'Move' && c.to.x === across.x && c.to.y === across.y)) continue;
      tried++;
      // The friend's blow is what the move improves: the threat is higher there than beside the foe anywhere else.
      const flank = threat(withUnitAt(s, 'p0u0', across), board, 0);
      for (const beside of board.neighbors(foe)) {
        if (beside.x === across.x && beside.y === across.y) continue;
        if (beside.x === friend.x && beside.y === friend.y) continue;
        expect(flank).toBeGreaterThan(threat(withUnitAt(s, 'p0u0', beside), board, 0));
      }
      expect(chooseCommand(s)).toEqual({ type: 'Move', unitId: 'p0u0', to: across });
    }
    expect(tried).toBeGreaterThanOrEqual(4);
  });

  it('does not stop alone where three foes can charge it when a hex as near is covered by friends', () => {
    const strong = { combat: 4 };
    const foes = [U('x', 10, 2, strong), U('y', 10, 3, strong), U('z', 10, 4, strong)];
    const s = moving(game([U('a', 3, 3), U('f1', 8, 5), U('f2', 8, 6)], foes), 'p0u0');
    const near = (v: Vec) => Math.min(...foes.map((f) => board.distance(v, f.pos)));
    // Out on its own, two hexes from the foes: where the AI went before it weighed its exposure.
    const alone = { x: 8, y: 1 };
    expect(getLegalCommands(s)).toContainEqual({ type: 'Move', unitId: 'p0u0', to: alone });
    expect(foes.every((f) => board.distance(alone, f.pos) <= 6)).toBe(true);

    const to = moveTo(chooseCommand(s));
    expect(near(to)).toBe(near(alone));
    expect(board.distance(to, { x: 8, y: 5 })).toBe(1);
    expect(exposure(withUnitAt(s, 'p0u0', to), board, 0)).toBeLessThan(exposure(withUnitAt(s, 'p0u0', alone), board, 0));
  });

  it('a shooter still keeps its standoff', () => {
    /** How far from the nearest of two foes of `combat` the archer ends its move. */
    const standoff = (combat: number, actions: number): number => {
      const foes = [U('x', 11, 3, { combat }), U('y', 11, 5, { combat })];
      const s = moving(game([U('archer', 2, 4, { ranged: 6 }), U('friend', 2, 6)], foes), 'p0u0');
      return Math.min(...foes.map((f) => board.distance(moveTo(chooseCommand({ ...s, actionsRemaining: actions })), f.pos)));
    };
    // Into range and out of contact, as ever.
    for (const combat of [3, 4]) {
      for (const actions of [1, 2]) {
        expect(standoff(combat, actions)).toBeGreaterThanOrEqual(2);
        expect(standoff(combat, actions)).toBeLessThanOrEqual(6);
      }
    }
    // Foes it could not stand up to, whose charge reaches as far as its shot: it comes into range with a shot to
    // follow, and with one action it stops a hex outside their reach instead.
    expect(standoff(5, 2)).toBe(6);
    expect(standoff(5, 1)).toBe(7);
  });

  it('scores a move as the whole board scored again would, for every hex it could go to', () => {
    let checked = 0;
    let changed = 0;
    for (const seed of [1, 2, 3]) {
      let s = createDemoGame(seed);
      for (let step = 0; s.phase !== 'gameOver' && step < 300; step++) {
        const moves = getLegalCommands(s).filter((c) => c.type === 'Move') as Extract<Command, { type: 'Move' }>[];
        if (moves.length > 0 && step % 4 === 0) {
          const grid = makeHexGrid(s.board);
          const mover = unitById(s, s.activeUnitId!)!;
          const setup = new MoveSetup(s, grid, mover);
          const before = { threat: threat(s, grid, mover.owner), exposure: exposure(s, grid, mover.owner) };
          for (const move of moves) {
            const moved = withUnitAt(s, mover.id, move.to);
            const delta = setup.delta(move.to);
            expect(delta.threat).toBeCloseTo(threat(moved, grid, mover.owner) - before.threat, 9);
            expect(delta.exposure).toBeCloseTo(exposure(moved, grid, mover.owner) - before.exposure, 9);
            expect(setup.risk(move.to)).toBeGreaterThanOrEqual(0);
            checked++;
            if (Math.abs(delta.threat) > 1e-9 || Math.abs(delta.exposure) > 1e-9) changed++;
          }
        }
        s = reduce(s, chooseCommand(s)).state;
      }
    }
    expect(checked).toBeGreaterThan(300);
    // Most moves in a game change what one side or the other can do: the term is not idle.
    expect(changed).toBeGreaterThan(checked / 2);
  });

  it('leaves the state it scores untouched', () => {
    const s = moving(game([U('a', 5, 4), U('friend', 8, 4)], [U('foe', 7, 4)]), 'p0u0');
    const copy = structuredClone(s);
    expect(withUnitAt(s, 'p0u0', { x: 6, y: 4 }).units[0]!.pos).toEqual({ x: 6, y: 4 });
    chooseCommand(s);
    expect(s).toEqual(copy);
  });
});

describe('AI whole activations', () => {
  const board = makeHexGrid({ width: 12, height: 8, blocked: [] });
  const foe = { x: 7, y: 4 };
  const friend = board.neighbors(foe)[0]!;
  /** Straight across the foe from the friend: the hex that closes the pincer. */
  const flank = board.stepAway(friend, foe);
  /** In contact with the foe, one step from the flank. */
  const start = board.neighbors(foe).find((v) => board.distance(v, flank) === 1 && board.distance(v, friend) > 1)!;
  /** Slippery, so that stepping round the foe draws no free hack. */
  const scene = (combat: number, foeCombat: number, actions: number): GameState =>
    activate(game([U('a', start.x, start.y, { combat, slippery: true }), U('friend', friend.x, friend.y)], [U('foe', foe.x, foe.y, { combat: foeCombat })]), 'p0u0', actions);

  it('a unit facing a blow at bad odds, with a flank one move away, moves there and strikes from it', () => {
    const s = scene(3, 5, 2);
    expect(getLegalCommands(s)).toContainEqual({ type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    const move = chooseCommand(s);
    expect(move).toEqual({ type: 'Move', unitId: 'p0u0', to: flank });
    expect(chooseCommand(reduce(s, move).state)).toMatchObject({ type: 'Attack', targetId: 'p1u0' });
  });

  it('with one action it takes the flank for its friend rather than strike at bad odds', () => {
    expect(chooseCommand(scene(3, 5, 1))).toEqual({ type: 'Move', unitId: 'p0u0', to: flank });
  });

  it('a unit with a good blow still strikes, flank or no flank', () => {
    for (const actions of [1, 2]) expect(chooseCommand(scene(5, 3, actions))).toMatchObject({ type: 'Attack', targetId: 'p1u0' });
  });

  it('a unit that cannot leave holds rather than strike a blow it would lose by', () => {
    const s = activate(game([U('a', start.x, start.y)], [U('foe', foe.x, foe.y, { combat: 5 })]), 'p0u0');
    expect(chooseCommand(s)).toEqual({ type: 'EndActivation' });
    // On guard, if it knows how: its riposte is what the foe then has to get past.
    const guard = activate(game([U('a', start.x, start.y, { guard: true })], [U('foe', foe.x, foe.y, { combat: 5 })]), 'p0u0');
    expect(chooseCommand(guard)).toEqual({ type: 'Guard', unitId: 'p0u0' });
  });
});

describe('AI activation order', () => {
  const board = makeHexGrid({ width: 12, height: 8, blocked: [] });
  const who = (cmd: Command): string => {
    expect(cmd.type).toBe('ChooseActivation');
    return (cmd as Extract<Command, { type: 'ChooseActivation' }>).unitId;
  };

  it('the unit that can flank goes before the friend already in contact', () => {
    // Listed first and already fighting: the friend is who went first before the order weighed a setup.
    for (const combat of [2, 3, 4]) {
      const s = game([U('friend', 8, 4), U('flanker', 4, 4)], [U('foe', 7, 4, { combat })]);
      const order = activationOrder(s, board, 0);
      const friend = order.get('p0u0')!;
      const flanker = order.get('p0u1')!;
      // What the flanker gives is what the friend waits for.
      expect(flanker.gift).toBeGreaterThan(0);
      expect(friend.wait).toBeGreaterThan(0);
      expect(flanker.wait).toBe(0);
      expect(friend.gift).toBe(0);
      expect(who(chooseCommand(s))).toBe('p0u1');
    }
  });

  it('with no setup on offer the order is as before: the unit in contact, then the nearest', () => {
    // The far units cannot reach the foe this turn, so no one has anything to give or to wait for. The fighter's blow is a strong one: the lookahead sends a walk of several hexes ahead of a blow worth less than it.
    const s = game([U('far', 0, 0), U('near', 2, 4), U('fighter', 11, 4, { combat: 5 })], [U('foe', 10, 4, { combat: 2 })]);
    const order = activationOrder(s, board, 0);
    for (const standing of order.values()) {
      expect(standing.gift).toBe(0);
      expect(standing.wait).toBe(0);
    }
    expect(order.get('p0u2')!.own).toBeGreaterThan(0);
    expect(who(chooseCommand(s))).toBe('p0u2');
    const spent = { ...s, units: s.units.map((u) => (u.id === 'p0u2' ? { ...u, activatedThisRound: true } : u)) };
    expect(who(chooseCommand(spent))).toBe('p0u1');
  });

  it('a unit locked in a melee of its own has nothing to give', () => {
    const s = game([U('friend', 8, 4), U('locked', 5, 4)], [U('foe', 7, 4), U('pin', 4, 4)]);
    expect(activationOrder(s, board, 0).get('p0u1')!.gift).toBe(0);
  });
});

describe('AI with a side down to its last unit', () => {
  const board = makeHexGrid({ width: 12, height: 8, blocked: [] });

  it('of two last units, equals two hexes apart, the one acting closes and strikes', () => {
    const s = game([U('a', 4, 4)], [U('b', 6, 4)]);
    for (const id of ['p0u0', 'p1u0']) {
      const acting = { ...activate(s, id, 2), active: id === 'p0u0' ? 0 : 1 } as GameState;
      const move = chooseCommand(acting);
      expect(board.distance(moveTo(move), unitById(s, id === 'p0u0' ? 'p1u0' : 'p0u0')!.pos)).toBe(1);
      expect(chooseCommand(reduce(acting, move).state).type).toBe('Attack');
    }
  });

  it('of two last units in contact, the one with the worse of the exchange leaves the blow to the other', () => {
    const s = game([U('a', 4, 4)], [U('b', 5, 4, { combat: 4 })]);
    expect(chooseCommand(activate(s, 'p0u0')).type).toBe('EndActivation');
    expect(chooseCommand({ ...activate(s, 'p1u0'), active: 1 }).type).toBe('Attack');
  });

  it('a warband closes on the last foe, where with more foes about it would keep out of its reach', () => {
    const last = game([U('a', 4, 4), U('friend', 0, 0)], [U('brute', 7, 4, { combat: 5 })]);
    expect(board.distance(moveTo(chooseCommand(activate(last, 'p0u0'))), { x: 7, y: 4 })).toBe(1);
    const more = game([U('a', 4, 4), U('friend', 0, 0)], [U('brute', 7, 4, { combat: 5 }), U('far', 11, 7)]);
    const cmd = chooseCommand(activate(more, 'p0u0'));
    if (cmd.type === 'Move') expect(board.distance(cmd.to, { x: 7, y: 4 })).toBeGreaterThan(1);
  });
});

describe('AI lookahead over the rest of the turn', () => {
  it('a blow on offer at a weak foe is struck before a friend steps forward', () => {
    // a and b both stand beside the weak x; c is three hexes from y and has only a step forward to make.
    // One command at a time, c goes first for the charge it sets up. Planning the two activations
    // together, the blow comes first: played out 1,200 times each way, that wins 81% against 77%.
    const s = game(
      [U('a', 6, 2, { combat: 4 }), U('b', 6, 3, { combat: 4 }), U('c', 3, 5)],
      [U('x', 7, 2, { combat: 2 }), U('y', 6, 5, { combat: 2 }), U('z', 8, 4, { combat: 4 })],
    );
    const cmd = chooseCommand({ ...s, active: 0 });
    expect(cmd.type).toBe('ChooseActivation');
    expect(['p0u0', 'p0u1']).toContain((cmd as Extract<Command, { type: 'ChooseActivation' }>).unitId);
  });
});
