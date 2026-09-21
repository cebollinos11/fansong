import { describe, expect, it } from 'vitest';
import { createGame } from '../src/setup.js';
import { reduce } from '../src/reduce.js';
import type { GameState } from '../src/types.js';

/** One reliable unit each, far apart so nobody ever fights. */
function duel(): GameState {
  return createGame({
    seed: 5,
    board: { width: 8, height: 2 },
    warbands: [
      [{ name: 'Ash', quality: 1, combat: 3, pos: { x: 0, y: 0 } }],
      [{ name: 'Bee', quality: 1, combat: 3, pos: { x: 7, y: 0 } }],
    ],
  });
}

/** Play one full round where each player activates their single unit and ends. */
function playRound(start: GameState): GameState {
  const leader = start.active;
  const opp = leader === 0 ? 1 : 0;
  let s = reduce(start, { type: 'ChooseActivation', unitId: `p${leader}u0`, diceCount: 1 }).state;
  s = reduce(s, { type: 'EndActivation' }).state;
  s = reduce(s, { type: 'ChooseActivation', unitId: `p${opp}u0`, diceCount: 1 }).state;
  s = reduce(s, { type: 'EndActivation' }).state;
  return s;
}

describe('round structure and initiative', () => {
  it('starts with P0 leading round 1', () => {
    const g = duel();
    expect(g.round).toBe(1);
    expect(g.initiativeLeader).toBe(0);
    expect(g.active).toBe(0);
  });

  it('alternates the leader each round (whoever went second leads next)', () => {
    let s = duel();
    expect(s.initiativeLeader).toBe(0);

    s = playRound(s);
    expect(s.round).toBe(2);
    expect(s.initiativeLeader).toBe(1);
    expect(s.active).toBe(1);

    s = playRound(s);
    expect(s.round).toBe(3);
    expect(s.initiativeLeader).toBe(0);
    expect(s.active).toBe(0);
  });

  it('resets activation flags at the start of each round', () => {
    // Mid-round, the mover is flagged as activated.
    const mid = reduce(duel(), { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 }).state;
    expect(mid.units.find((u) => u.id === 'p0u0')!.activatedThisRound).toBe(true);

    // After a full round rolls over, every flag is cleared again.
    const next = playRound(duel());
    expect(next.units.every((u) => !u.activatedThisRound)).toBe(true);
  });
});
