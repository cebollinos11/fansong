import { describe, expect, it } from 'vitest';
import { createGame } from '../src/setup.js';
import { reduce } from '../src/reduce.js';
import type { GameState } from '../src/types.js';

/** Quality 7 = every die fails; Quality 1 = every die succeeds. */
function twoOnTwo(): GameState {
  return createGame({
    seed: 1,
    board: { width: 10, height: 4 },
    warbands: [
      [
        { name: 'AlphaFail', quality: 7, combat: 3, pos: { x: 0, y: 0 } },
        { name: 'AlphaSure', quality: 1, combat: 3, pos: { x: 0, y: 2 } },
      ],
      [
        { name: 'BetaSure', quality: 1, combat: 3, pos: { x: 9, y: 0 } },
        { name: 'BetaSure2', quality: 1, combat: 3, pos: { x: 9, y: 2 } },
      ],
    ],
  });
}

describe('the turnover twist', () => {
  it('benches the player on 2 failures and hands off to the opponent', () => {
    const g = twoOnTwo();
    const { state, events } = reduce(g, { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 });

    expect(events.some((e) => e.type === 'Turnover')).toBe(true);
    expect(state.benched[0]).toBe(true);
    expect(state.active).toBe(1); // handed off
    expect(state.phase).toBe('awaitingActivation');
    // The unit still counts as activated (it did activate — and failed).
    expect(state.units.find((u) => u.id === 'p0u0')!.activatedThisRound).toBe(true);
  });

  it('cannot turn over with a single die (needs 2 failures)', () => {
    const g = twoOnTwo();
    const { state, events } = reduce(g, { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 });

    expect(events.some((e) => e.type === 'Turnover')).toBe(false);
    expect(state.benched[0]).toBe(false);
    // 1 die, all failures -> 0 successes -> activation ends with no actions.
    expect(events.some((e) => e.type === 'ActivationEnded')).toBe(true);
    expect(state.active).toBe(1);
  });

  it('lets the opponent continue solo after a turnover', () => {
    const g = twoOnTwo();
    // P0 turns over and is benched.
    let s = reduce(g, { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 }).state;
    expect(s.active).toBe(1);

    // P1 activates one unit (guaranteed success), then ends.
    s = reduce(s, { type: 'ChooseActivation', unitId: 'p1u0', diceCount: 1 }).state;
    expect(s.phase).toBe('acting');
    s = reduce(s, { type: 'EndActivation' }).state;

    // P0 is benched, so P1 keeps the initiative (solo continuation).
    expect(s.active).toBe(1);
    expect(s.phase).toBe('awaitingActivation');
    expect(s.round).toBe(1);
  });

  it('ends the round once every non-benched unit has activated', () => {
    const g = twoOnTwo();
    let s = reduce(g, { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 }).state; // P0 benched
    s = reduce(s, { type: 'ChooseActivation', unitId: 'p1u0', diceCount: 1 }).state;
    s = reduce(s, { type: 'EndActivation' }).state;
    s = reduce(s, { type: 'ChooseActivation', unitId: 'p1u1', diceCount: 1 }).state;
    const res = reduce(s, { type: 'EndActivation' });

    // P1 activated last (twice, solo) -> P1 goes second next round, P0 leads.
    expect(res.events.some((e) => e.type === 'RoundEnded')).toBe(true);
    expect(res.state.round).toBe(2);
    expect(res.state.initiativeLeader).toBe(0);
    expect(res.state.active).toBe(0);
    expect(res.state.benched).toEqual([false, false]);
  });
});
