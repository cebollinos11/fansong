import { describe, expect, it } from 'vitest';
import {
  awardPoints,
  checkRoundLimit,
  createGame,
  createModeState,
  gameMode,
  MODE_RULES,
  reduce,
  ROUND_LIMIT,
  roundLimitWinner,
  tiebreakWinner,
  type GameConfig,
  type GameEvent,
  type GameState,
} from '../src/index.js';

const base: GameConfig = {
  seed: 3,
  board: { width: 6, height: 5 },
  warbands: [
    [
      { name: 'A', quality: 3, combat: 3, pos: { x: 0, y: 0 } },
      { name: 'A2', quality: 3, combat: 3, pos: { x: 0, y: 2 } },
    ],
    [
      { name: 'B', quality: 3, combat: 3, pos: { x: 5, y: 4 } },
      { name: 'B2', quality: 3, combat: 3, pos: { x: 5, y: 2 } },
    ],
  ],
};

const hill = { mode: 'king-of-the-hill' as const, objectives: { hill: [{ x: 2, y: 2 }, { x: 3, y: 2 }] } };

describe('mode model', () => {
  it('omits mode state for annihilation, explicit or default', () => {
    const plain = createGame(base);
    expect('mode' in plain).toBe(false);
    expect(JSON.stringify(createGame({ ...base, mode: 'annihilation', objectives: { hill: [{ x: 1, y: 1 }] } }))).toBe(
      JSON.stringify(plain),
    );
    expect(gameMode(plain)).toBe('annihilation');
  });

  it('attaches mode state with zero scores and only the objectives the mode uses', () => {
    const g = createGame({
      ...base,
      mode: 'king-of-the-hill',
      objectives: { hill: [{ x: 2, y: 2 }], flags: [{ x: 0, y: 0 }, { x: 5, y: 4 }] },
    });
    expect(g.mode).toEqual({ mode: 'king-of-the-hill', objectives: { hill: [{ x: 2, y: 2 }] }, scores: [0, 0] });
    expect(gameMode(g)).toBe('king-of-the-hill');
    const k = createGame({
      ...base,
      mode: 'kill-the-king',
      warbands: [[base.warbands[0][0]!, { ...base.warbands[0][1]!, king: true }], [{ ...base.warbands[1][0]!, king: true }, base.warbands[1][1]!]],
    });
    expect(k.mode).toEqual({ mode: 'kill-the-king', objectives: {}, scores: [0, 0], kings: ['p0u1', 'p1u0'] });
  });

  it('rejects a mode whose objectives are missing', () => {
    expect(() => createModeState('king-of-the-hill', {})).toThrow(/hill/);
    expect(() => createModeState('king-of-the-hill', { hill: [] })).toThrow(/hill/);
    expect(() => createModeState('conquest', { conquest: [[{ x: 1, y: 1 }], [], [{ x: 2, y: 2 }]] })).toThrow(/conquest/);
    expect(() => createModeState('capture-the-flag', undefined)).toThrow(/flag/);
  });

  it('copies objectives so the config is never aliased', () => {
    const objectives = { hill: [{ x: 2, y: 2 }] };
    const g = createGame({ ...base, mode: 'king-of-the-hill', objectives });
    objectives.hill[0]!.x = 4;
    expect(g.mode!.objectives.hill).toEqual([{ x: 2, y: 2 }]);
  });

  it('defines targets and a 12-round cap for the zone modes only', () => {
    expect(MODE_RULES['king-of-the-hill']).toMatchObject({ targetScore: 5, roundLimit: ROUND_LIMIT });
    expect(MODE_RULES.conquest).toMatchObject({ targetScore: 8, roundLimit: ROUND_LIMIT });
    expect(MODE_RULES.annihilation.roundLimit).toBeUndefined();
    expect(ROUND_LIMIT).toBe(12);
  });
});

describe('scoring', () => {
  it('awards points and ends the game at the target score', () => {
    const s: GameState = structuredClone(createGame({ ...base, ...hill }));
    const events: GameEvent[] = [];
    expect(awardPoints(s, events, 1, 4)).toBe(false);
    expect(s.mode!.scores).toEqual([0, 4]);
    expect(events).toEqual([{ type: 'ScoreChanged', player: 1, points: 4, scores: [0, 4] }]);
    expect(awardPoints(s, events, 1, 1)).toBe(true);
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBe(1);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'score' });
  });

  it('never scores in annihilation', () => {
    const s = structuredClone(createGame(base));
    const events: GameEvent[] = [];
    expect(awardPoints(s, events, 0, 3)).toBe(false);
    expect(events).toEqual([]);
    expect('mode' in s).toBe(false);
  });
});

describe('tiebreak', () => {
  it('prefers more living units, then standing units, then combat, then player 1', () => {
    const s = structuredClone(createGame(base));
    expect(tiebreakWinner(s)).toBe(1);
    s.units[3]!.dead = true;
    expect(tiebreakWinner(s)).toBe(0);
    s.units[3]!.dead = false;
    s.units[0]!.knockedDown = true;
    expect(tiebreakWinner(s)).toBe(1);
    s.units[0]!.knockedDown = false;
    s.units[1]!.combat = 4;
    expect(tiebreakWinner(s)).toBe(0);
  });

  it('calls a capped game on score first, tiebreak on a tie', () => {
    const s = structuredClone(createGame({ ...base, ...hill }));
    s.mode!.scores = [2, 1];
    expect(roundLimitWinner(s)).toBe(0);
    s.mode!.scores = [2, 2];
    s.units[0]!.dead = true;
    expect(roundLimitWinner(s)).toBe(1);
  });
});

describe('round limit', () => {
  it('only ends a capped mode once the final round is over', () => {
    const s = structuredClone(createGame({ ...base, ...hill }));
    const events: GameEvent[] = [];
    s.round = ROUND_LIMIT - 1;
    expect(checkRoundLimit(s, events)).toBe(false);
    s.round = ROUND_LIMIT;
    s.mode!.scores = [1, 3];
    expect(checkRoundLimit(s, events)).toBe(true);
    expect(s.winner).toBe(1);
    expect(events).toEqual([{ type: 'GameOver', winner: 1, reason: 'roundLimit' }]);

    const plain = structuredClone(createGame(base));
    plain.round = 40;
    expect(checkRoundLimit(plain, [])).toBe(false);
  });

  it('ends a king-of-the-hill game through reduce when round 12 ends', () => {
    // Two lone units far apart, both activating with one die (never turns over)
    // and ending at once, so rounds tick by with no fighting.
    let s = createGame({
      ...base,
      warbands: [[base.warbands[0][0]!], [base.warbands[1][0]!]],
      ...hill,
    });
    const all: GameEvent[] = [];
    for (let i = 0; i < 200 && s.phase !== 'gameOver'; i++) {
      const cmd =
        s.phase === 'awaitingActivation'
          ? ({ type: 'ChooseActivation', unitId: s.units.find((u) => u.owner === s.active)!.id, diceCount: 1 } as const)
          : ({ type: 'EndActivation' } as const);
      const r = reduce(s, cmd);
      s = r.state;
      all.push(...r.events);
    }
    expect(s.phase).toBe('gameOver');
    expect(s.round).toBe(ROUND_LIMIT);
    expect(all.filter((e) => e.type === 'RoundEnded')).toHaveLength(ROUND_LIMIT - 1);
    // 0–0 with equal forces: the perfect-tie fallback.
    expect(all.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'roundLimit' });
  });

  it('tags an annihilation win with a reason only in an objective mode', () => {
    const duel = (extra: Partial<GameConfig>): GameEvent | undefined => {
      let s = createGame({
        ...base,
        warbands: [
          [{ name: 'A', quality: 2, combat: 9, pos: { x: 2, y: 2 } }],
          [{ name: 'B', quality: 2, combat: 0, pos: { x: 3, y: 2 } }],
        ],
        ...extra,
      });
      for (let i = 0; i < 400 && s.phase !== 'gameOver'; i++) {
        let cmd;
        if (s.phase === 'awaitingActivation') {
          cmd = { type: 'ChooseActivation', unitId: s.units.find((u) => u.owner === s.active)!.id, diceCount: 1 } as const;
        } else if (s.active === 0) {
          cmd = { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' } as const;
        } else {
          cmd = { type: 'EndActivation' } as const;
        }
        const r = reduce(s, cmd);
        s = r.state;
        if (s.phase === 'gameOver') return r.events.at(-1);
      }
      return undefined;
    };
    expect(duel({})).toEqual({ type: 'GameOver', winner: 0 });
    expect(duel({ mode: 'king-of-the-hill', objectives: { hill: [{ x: 0, y: 0 }] } })).toEqual({
      type: 'GameOver',
      winner: 0,
      reason: 'annihilation',
    });
  });
});
