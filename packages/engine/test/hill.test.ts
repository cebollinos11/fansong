import { describe, expect, it } from 'vitest';
import {
  createGame,
  reduce,
  ROUND_LIMIT,
  scoreZones,
  scoringZones,
  standingInZone,
  zoneController,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
} from '../src/index.js';

const U = (name: string, x: number, y: number): UnitSpec => ({ name, quality: 3, combat: 3, pos: { x, y } });

const HILL = [
  { x: 3, y: 2 },
  { x: 4, y: 2 },
];

const config = (w0: UnitSpec[], w1: UnitSpec[]): GameConfig => ({
  seed: 5,
  board: { width: 8, height: 6 },
  warbands: [w0, w1],
  mode: 'king-of-the-hill',
  objectives: { hill: HILL },
});

/** Everyone activates with one die (never turns over) and ends at once: rounds pass with no movement. */
function passRounds(s: GameState, maxSteps = 400): { state: GameState; events: GameEvent[] } {
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

describe('king-of-the-hill', () => {
  it('counts standing units in the zone and finds its controller', () => {
    const s = structuredClone(createGame(config([U('a', 3, 2), U('b', 4, 2)], [U('c', 0, 0)])));
    expect(scoringZones(s)).toEqual([HILL]);
    expect(standingInZone(s, HILL)).toEqual([2, 0]);
    expect(zoneController(s, HILL)).toBe(0);

    // Knocked-down and dead units don't hold ground.
    s.units[0]!.knockedDown = true;
    s.units[2]!.pos = { x: 4, y: 3 };
    expect(standingInZone(s, HILL)).toEqual([1, 0]);
    s.units[2]!.pos = { x: 3, y: 2 };
    expect(standingInZone(s, HILL)).toEqual([1, 1]);
    expect(zoneController(s, HILL)).toBeUndefined();
    s.units[1]!.dead = true;
    expect(zoneController(s, HILL)).toBe(1);
  });

  it('has no scoring zones outside king-of-the-hill', () => {
    const plain = createGame({ ...config([U('a', 3, 2)], [U('c', 0, 0)]), mode: undefined });
    expect(scoringZones(plain)).toEqual([]);
    expect(scoreZones(structuredClone(plain), [])).toBe(false);
  });

  it('scores 1 point for the controller at each round boundary', () => {
    const s = structuredClone(createGame(config([U('a', 3, 2)], [U('c', 0, 0)])));
    const events: GameEvent[] = [];
    expect(scoreZones(s, events)).toBe(false);
    expect(s.mode!.scores).toEqual([1, 0]);
    expect(events).toEqual([{ type: 'ScoreChanged', player: 0, points: 1, scores: [1, 0] }]);

    // Contested: nobody scores, no event.
    s.units[1]!.pos = { x: 4, y: 2 };
    const none: GameEvent[] = [];
    scoreZones(s, none);
    expect(none).toEqual([]);
    expect(s.mode!.scores).toEqual([1, 0]);
  });

  it('scores before RoundEnded, not at the start of round 1, and wins at 5 points', () => {
    const g = createGame(config([U('a', 3, 2)], [U('c', 0, 0)]));
    expect(g.mode!.scores).toEqual([0, 0]);
    const { state, events } = passRounds(g);
    expect(state.phase).toBe('gameOver');
    expect(state.winner).toBe(0);
    expect(state.mode!.scores).toEqual([5, 0]);
    // Scored at the end of rounds 1–5; the fifth point ends it before round 6 begins.
    expect(state.round).toBe(5);
    expect(events.filter((e) => e.type === 'ScoreChanged')).toHaveLength(5);
    expect(events.filter((e) => e.type === 'RoundEnded')).toHaveLength(4);
    const firstScore = events.findIndex((e) => e.type === 'ScoreChanged');
    const firstRound = events.findIndex((e) => e.type === 'RoundEnded');
    expect(firstScore).toBeLessThan(firstRound);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'score' });
  });

  it('player 1 can take the hill too', () => {
    const { state } = passRounds(createGame(config([U('a', 0, 0)], [U('c', 4, 2)])));
    expect(state.winner).toBe(1);
    expect(state.mode!.scores).toEqual([0, 5]);
  });

  it('a contested hill runs to the round cap and goes to the tiebreak', () => {
    const { state, events } = passRounds(createGame(config([U('a', 3, 2)], [U('c', 4, 2)])));
    expect(state.round).toBe(ROUND_LIMIT);
    expect(events.some((e) => e.type === 'ScoreChanged')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'roundLimit' });
  });

  it('the final round boundary is scored before the game is called on points', () => {
    // A game rewound to round 12 at 3–4: holding the hill through it levels the score.
    let s = structuredClone(createGame(config([U('a', 3, 2)], [U('c', 0, 0)])));
    s.round = ROUND_LIMIT;
    s.mode!.scores = [3, 4];
    let r = passRounds(s);
    expect(r.state.mode!.scores).toEqual([4, 4]);
    expect(r.state.round).toBe(ROUND_LIMIT);
    // 4–4 → tiebreak: equal forces, so the perfect-tie fallback (player 1).
    expect(r.events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'roundLimit' });

    s = structuredClone(createGame(config([U('a', 3, 2)], [U('c', 0, 0)])));
    s.round = ROUND_LIMIT;
    s.mode!.scores = [4, 3];
    r = passRounds(s);
    expect(r.events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'score' });
  });
});
