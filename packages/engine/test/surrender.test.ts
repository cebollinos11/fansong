import { describe, expect, it } from 'vitest';
import {
  createGame,
  DEFAULT_SURRENDER,
  hashGameState,
  livingPoints,
  reduce,
  surrenderedSide,
  surrenderingSide,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
  type Vec,
} from '../src/index.js';

const U = (name: string, x: number, y: number, points: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 3,
  combat: 3,
  pos: { x, y },
  points,
  ...extra,
});

/** 100 points a side: player 0 fields 50 + 50, player 1 fields 20 + 80. */
const config = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: 9,
  board: { width: 9, height: 6 },
  warbands: [
    [U('a', 0, 0, 50), U('b', 0, 2, 50)],
    [U('c', 8, 5, 20), U('d', 8, 3, 80)],
  ],
  surrender: DEFAULT_SURRENDER,
  ...extra,
});

/** `state` with the named units dead, as if cut down earlier in the round. */
function without(state: GameState, ...ids: string[]): GameState {
  const s = structuredClone(state);
  for (const id of ids) s.units.find((u) => u.id === id)!.dead = true;
  return s;
}

/** Everyone activates with one die and ends at once, until the round turns or the game ends. */
function passRound(s: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const round = s.round;
  for (let i = 0; i < 200 && s.phase !== 'gameOver' && s.round === round; i++) {
    const cmd =
      s.phase === 'awaitingActivation'
        ? ({
            type: 'ChooseActivation',
            unitId: s.units.find((u) => u.owner === s.active && !u.activatedThisRound && !u.dead)!.id,
            diceCount: 1,
          } as const)
        : ({ type: 'EndActivation' } as const);
    const r = reduce(s, cmd);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

describe('forced surrender', () => {
  it('ends the game as the new round begins when a side is far enough behind', () => {
    const s = without(createGame(config()), 'p1u1');
    expect(livingPoints(s)).toEqual([100, 20]);
    expect(surrenderingSide(s)).toBe(1);
    const { state, events } = passRound(s);
    expect(state.phase).toBe('gameOver');
    expect(state.winner).toBe(0);
    expect(state.round).toBe(2);
    expect(events.at(-2)).toMatchObject({ type: 'RoundEnded', round: 2 });
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'surrender' });
    // The finished state can still be told from any other ending.
    expect(surrenderedSide(state)).toBe(1);
    expect(surrenderingSide(state)).toBeUndefined();
    expect(surrenderedSide(s)).toBeUndefined();
  });

  it('does not end the game mid-round, however lopsided', () => {
    let s = without(createGame(config()), 'p1u1');
    const first = s.units.find((u) => u.owner === s.active && !u.dead)!.id;
    s = reduce(s, { type: 'ChooseActivation', unitId: first, diceCount: 1 }).state;
    if (s.phase === 'acting') s = reduce(s, { type: 'EndActivation' }).state;
    expect(s.round).toBe(1);
    expect(s.phase).not.toBe('gameOver');
    expect(surrenderingSide(s)).toBe(1);
  });

  it('needs the other side to hold three times as much', () => {
    // 20 of 100 left, but the foe holds only 50.
    const s = without(createGame(config()), 'p1u1', 'p0u1');
    expect(surrenderingSide(s)).toBeUndefined();
    const { state } = passRound(s);
    expect(state.phase).not.toBe('gameOver');
    expect(state.round).toBe(2);
  });

  it('needs the side to be down to 30% of its own start', () => {
    // 40 of 100 left, against 200.
    const s = without(
      createGame(config({ warbands: [[U('a', 0, 0, 100), U('b', 0, 2, 100)], [U('c', 8, 5, 40), U('d', 8, 3, 60)]] })),
      'p1u1',
    );
    expect(livingPoints(s)).toEqual([200, 40]);
    expect(surrenderingSide(s)).toBeUndefined();
    expect(passRound(s).state.phase).not.toBe('gameOver');
  });

  it('fires at exactly 30% and exactly three times', () => {
    const s = without(
      createGame(config({ warbands: [[U('a', 0, 0, 90)], [U('c', 8, 5, 30), U('d', 8, 3, 70)]] })),
      'p1u1',
    );
    expect(surrenderingSide(s)).toBe(1);
  });

  it('is absent from a game set up without it, which then never surrenders', () => {
    const bare = (spec: UnitSpec): UnitSpec => {
      const { points: _points, ...rest } = spec;
      return rest;
    };
    const off = config({ surrender: undefined });
    const plain = createGame(off);
    expect('surrender' in plain).toBe(false);
    expect(plain.units.every((u) => !('points' in u))).toBe(true);
    const unpriced = createGame({ ...off, warbands: [off.warbands[0].map(bare), off.warbands[1].map(bare)] });
    expect(hashGameState(plain)).toBe(hashGameState(unpriced));

    const s = without(plain, 'p1u1');
    expect(surrenderingSide(s)).toBeUndefined();
    const { state } = passRound(s);
    expect(state.phase).not.toBe('gameOver');
  });

  it('records the thresholds and each side\'s starting points, and needs every unit priced', () => {
    expect(createGame(config()).surrender).toEqual({ ownShare: 0.3, ratio: 3, start: [100, 100] });
    expect(() => createGame(config({ warbands: [[U('a', 0, 0, 50)], [{ name: 'c', quality: 3, combat: 3, pos: { x: 8, y: 5 } }]] }))).toThrow(/point cost/);
    expect(() => createGame(config({ warbands: [[U('a', 0, 0, 50)], [U('c', 8, 5, 0)]] }))).toThrow(/point cost/);
  });

  it('never forces a side that can still sound the retreat, or has', () => {
    const zone: Vec[] = [{ x: 8, y: 0 }, { x: 8, y: 1 }];
    const led = (leader: boolean): GameConfig =>
      config({ warbands: [[U('a', 0, 0, 50), U('b', 0, 2, 50)], [U('c', 8, 5, 20, { leader }), U('d', 8, 3, 80)]], retreatZones: [[], zone] });

    // A living Leader and somewhere to go: it may yet retreat.
    const can = without(createGame(led(true)), 'p1u1');
    expect(surrenderingSide(can)).toBeUndefined();
    expect(passRound(can).state.phase).not.toBe('gameOver');

    // No Leader left to call it.
    expect(surrenderingSide(without(createGame(led(false)), 'p1u1'))).toBe(1);

    // It has called it.
    const called = without(createGame(led(false)), 'p1u1');
    called.retreat = { owner: 1, hex: zone[0]! };
    expect(surrenderingSide(called)).toBeUndefined();

    // The other side called it: this one has no retreat left.
    const foeCalled = without(createGame(led(true)), 'p1u1');
    foeCalled.retreat = { owner: 0, hex: { x: 0, y: 5 } };
    expect(surrenderingSide(foeCalled)).toBe(1);
  });

  it('a side safe from surrender can still win by the other\'s', () => {
    const s = without(createGame(config({ retreatZones: [[{ x: 0, y: 5 }], []], warbands: [[U('a', 0, 0, 50, { leader: true }), U('b', 0, 2, 50)], [U('c', 8, 5, 20), U('d', 8, 3, 80)]] })), 'p1u1');
    expect(passRound(s).state.winner).toBe(0);
  });

  it('counts a turncoat for its new side', () => {
    const s = createGame(config({ warbands: [[U('a', 0, 0, 50), U('b', 0, 2, 50)], [U('c', 8, 5, 30), U('d', 8, 3, 70)]] }));
    expect(surrenderingSide(s)).toBeUndefined();
    const turned = structuredClone(s);
    turned.units.find((u) => u.id === 'p1u1')!.owner = 0;
    expect(livingPoints(turned)).toEqual([170, 30]);
    expect(surrenderingSide(turned)).toBe(1);
    expect(turned.surrender!.start).toEqual([100, 100]);
  });

  it('counts a knocked-down unit in full', () => {
    const s = createGame(config());
    s.units.find((u) => u.id === 'p1u1')!.knockedDown = true;
    expect(livingPoints(s)).toEqual([100, 100]);
  });

  it('gives way to the round limit at the same boundary', () => {
    const s = without(createGame(config({ limits: { roundLimit: 1 } })), 'p1u1');
    const { state, events } = passRound(s);
    expect(events.at(-1)).toMatchObject({ type: 'GameOver', reason: 'roundLimit' });
    expect(surrenderedSide(state)).toBeUndefined();
  });

  it('gives way to zone scoring at the same boundary', () => {
    // The side about to surrender holds the hill, and wins on it first.
    const s = without(
      createGame(config({ mode: 'king-of-the-hill', objectives: { hill: [{ x: 8, y: 5 }] }, limits: { targetScore: 1 } })),
      'p1u1',
    );
    expect(surrenderingSide(s)).toBe(1);
    const { events } = passRound(s);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'score' });
  });
});
