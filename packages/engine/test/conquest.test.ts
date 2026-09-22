import { describe, expect, it } from 'vitest';
import {
  createGame,
  reduce,
  ROUND_LIMIT,
  scoreZones,
  scoringZones,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
} from '../src/index.js';

const U = (name: string, x: number, y: number): UnitSpec => ({ name, quality: 3, combat: 3, pos: { x, y } });

const ZONES: [{ x: number; y: number }[], { x: number; y: number }[], { x: number; y: number }[]] = [
  [{ x: 1, y: 2 }],
  [
    { x: 4, y: 2 },
    { x: 4, y: 3 },
  ],
  [{ x: 7, y: 2 }],
];

const config = (w0: UnitSpec[], w1: UnitSpec[]): GameConfig => ({
  seed: 9,
  board: { width: 9, height: 6 },
  warbands: [w0, w1],
  mode: 'conquest',
  objectives: { conquest: ZONES },
});

/** Everyone activates with one die (never turns over) and ends at once: rounds pass with no movement. */
function passRounds(s: GameState, maxSteps = 600): { state: GameState; events: GameEvent[] } {
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

describe('conquest', () => {
  it('scores the three zones separately, naming each zone', () => {
    const s = structuredClone(createGame(config([U('a', 1, 2), U('b', 4, 3)], [U('c', 7, 2), U('d', 0, 0)])));
    expect(scoringZones(s)).toEqual(ZONES);
    const events: GameEvent[] = [];
    expect(scoreZones(s, events)).toBe(false);
    expect(s.mode!.scores).toEqual([2, 1]);
    expect(events).toEqual([
      { type: 'ScoreChanged', player: 0, points: 1, scores: [1, 0], zone: 0 },
      { type: 'ScoreChanged', player: 0, points: 1, scores: [2, 0], zone: 1 },
      { type: 'ScoreChanged', player: 1, points: 1, scores: [2, 1], zone: 2 },
    ]);
  });

  it('a contested or empty zone scores nothing', () => {
    const s = structuredClone(createGame(config([U('a', 4, 2)], [U('c', 4, 3)])));
    const events: GameEvent[] = [];
    scoreZones(s, events);
    expect(events).toEqual([]);
    expect(s.mode!.scores).toEqual([0, 0]);
  });

  it('first to 8 wins; two zones held scores 2 per round', () => {
    const { state, events } = passRounds(createGame(config([U('a', 1, 2), U('b', 7, 2)], [U('c', 0, 0)])));
    expect(state.phase).toBe('gameOver');
    expect(state.winner).toBe(0);
    expect(state.mode!.scores).toEqual([8, 0]);
    expect(state.round).toBe(4);
    expect(events.filter((e) => e.type === 'ScoreChanged')).toHaveLength(8);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'score' });
  });

  it('zone order never decides a simultaneous finish: higher score wins, a tie goes to the tiebreak', () => {
    // 7–6, player 1 holds zone 0 and player 0 zone 2: 8–7 → player 0, though player 1 scored first.
    let s = structuredClone(createGame(config([U('a', 7, 2)], [U('c', 1, 2)])));
    s.mode!.scores = [7, 6];
    let events: GameEvent[] = [];
    expect(scoreZones(s, events)).toBe(true);
    expect(s.mode!.scores).toEqual([8, 7]);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'score' });

    // 7–6, player 1 takes zones 0 and 1, player 0 zone 2 → 8–8 on the same boundary.
    s = structuredClone(createGame(config([U('a', 7, 2), U('b', 4, 2)], [U('c', 1, 2), U('d', 4, 3), U('e', 0, 0)])));
    s.mode!.scores = [7, 6];
    s.units[4]!.pos = { x: 4, y: 2 }; // e joins zone 1 → player 1 holds it 2–1
    events = [];
    expect(scoreZones(s, events)).toBe(true);
    expect(s.mode!.scores).toEqual([8, 8]);
    // 8–8: tiebreak → player 1 has more living units.
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'score' });
  });

  it('runs to the round cap when nobody reaches 8 and the higher score wins', () => {
    // Player 0 holds zone 0, player 1 zones 1 and 2 — but rewound so 12 rounds won't reach 8.
    const s = structuredClone(createGame(config([U('a', 1, 2)], [U('c', 4, 2), U('d', 7, 2)])));
    s.round = ROUND_LIMIT - 1;
    s.mode!.scores = [3, 4];
    const { state, events } = passRounds(s);
    expect(state.round).toBe(ROUND_LIMIT);
    expect(state.mode!.scores).toEqual([5, 8]);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'score' });

    const t = structuredClone(createGame(config([U('a', 1, 2)], [U('c', 4, 2)])));
    t.round = ROUND_LIMIT - 1;
    t.mode!.scores = [5, 3];
    const r = passRounds(t);
    expect(r.state.mode!.scores).toEqual([7, 5]);
    expect(r.events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'roundLimit' });
  });
});
