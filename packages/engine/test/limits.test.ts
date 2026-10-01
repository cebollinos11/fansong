import { describe, expect, it } from 'vitest';
import {
  createGame,
  hashGameState,
  reduce,
  roundLimitOf,
  targetScoreOf,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
} from '../src/index.js';

const U = (name: string, x: number, y: number): UnitSpec => ({ name, quality: 3, combat: 3, pos: { x, y } });

const ZONES: [{ x: number; y: number }[], { x: number; y: number }[], { x: number; y: number }[]] = [
  [{ x: 1, y: 2 }],
  [{ x: 4, y: 2 }],
  [{ x: 7, y: 2 }],
];

const config = (extra: Partial<GameConfig>): GameConfig => ({
  seed: 9,
  board: { width: 9, height: 6 },
  warbands: [[U('a', 0, 0)], [U('b', 8, 5)]],
  ...extra,
});

/** Everyone activates with one die and ends at once: rounds pass with no movement. */
function passRounds(s: GameState, maxSteps = 800): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < maxSteps && s.phase !== 'gameOver'; i++) {
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

describe('custom limits', () => {
  it('leave a default game untouched', () => {
    const plain = createGame(config({}));
    expect(plain.limits).toBeUndefined();
    expect(hashGameState(createGame(config({ limits: {} })))).toBe(hashGameState(plain));
  });

  it('a round limit ends annihilation and the tiebreak picks the winner', () => {
    const s = createGame(config({ limits: { roundLimit: 3 } }));
    expect(roundLimitOf(s)).toBe(3);
    const { state, events } = passRounds(s);
    expect(state.round).toBe(3);
    expect(state.winner).toBe(1); // perfect tie → player 1
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'roundLimit' });
  });

  it('a round limit ends capture-the-flag, which has none by default', () => {
    const flags = { flags: [{ x: 0, y: 0 }, { x: 8, y: 5 }] as [{ x: number; y: number }, { x: number; y: number }] };
    const none = createGame(config({ mode: 'capture-the-flag', objectives: flags }));
    expect(roundLimitOf(none)).toBeUndefined();
    const { state, events } = passRounds(createGame(config({ mode: 'capture-the-flag', objectives: flags, limits: { roundLimit: 2 } })));
    expect(state.round).toBe(2);
    expect(events.at(-1)).toMatchObject({ type: 'GameOver', reason: 'roundLimit' });
  });

  it('conquest honours a custom target score', () => {
    const w: [UnitSpec[], UnitSpec[]] = [[U('a', 1, 2), U('b', 4, 2), U('c', 7, 2)], [U('d', 0, 5)]];
    const s = createGame(config({ warbands: w, mode: 'conquest', objectives: { conquest: ZONES }, limits: { targetScore: 3 } }));
    expect(targetScoreOf(s)).toBe(3);
    const { state, events } = passRounds(s);
    expect(state.round).toBe(1); // 3 zones held → 3 points as round 1 ends
    expect(state.mode!.scores).toEqual([3, 0]);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'score' });
  });

  it('"no round limit" lifts a mode default, and a custom cap replaces it', () => {
    const base = { mode: 'conquest', objectives: { conquest: ZONES } } as const;
    expect(roundLimitOf(createGame(config(base)))).toBe(12);
    expect(roundLimitOf(createGame(config({ ...base, limits: { roundLimit: null } })))).toBeUndefined();
    expect(roundLimitOf(createGame(config({ ...base, limits: { roundLimit: 5 } })))).toBe(5);
  });

  it('drops a target score in modes that have none and rejects out-of-range values', () => {
    expect(createGame(config({ limits: { targetScore: 4 } })).limits).toBeUndefined();
    expect(() => createGame(config({ limits: { roundLimit: 0 } }))).toThrow(/round limit/);
    expect(() => createGame(config({ limits: { roundLimit: 51 } }))).toThrow(/round limit/);
    expect(() =>
      createGame(config({ mode: 'conquest', objectives: { conquest: ZONES }, limits: { targetScore: 1.5 } })),
    ).toThrow(/target score/);
  });
});
