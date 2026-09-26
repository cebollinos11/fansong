import { describe, expect, it } from 'vitest';
import { createGame, reduce, type GameState } from '@fansong/engine';
import { splitRoundStart } from '../src/game/roundStart.js';

/** Two units far apart; p0's is Reassembling (or not) and lies knocked down. */
function board(reassembling: boolean): GameState {
  const s = createGame({
    seed: 5,
    board: { width: 8, height: 2 },
    warbands: [
      [{ name: 'Bones', quality: 3, combat: 3, reassembling, pos: { x: 0, y: 0 } }],
      [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 7, y: 0 } }],
    ],
  });
  s.units.find((u) => u.id === 'p0u0')!.knockedDown = true;
  return s;
}

/** End the round with a bare EndActivation, every unit already spent. */
function endRound(s: GameState) {
  for (const u of s.units) u.activatedThisRound = true;
  s.active = 1;
  s.activeUnitId = 'p1u0';
  s.phase = 'acting';
  s.actionsRemaining = 1;
  return reduce(s, { type: 'EndActivation' });
}

describe('splitRoundStart', () => {
  it('plays the Reassembling stand-ups after the round ends, with the unit still down in between', () => {
    const t = endRound(board(true));
    const parts = splitRoundStart(t);

    expect(parts).toHaveLength(2);
    const [ending, standing] = parts as [(typeof parts)[0], (typeof parts)[0]];
    expect(ending.events.at(-1)?.type).toBe('RoundEnded');
    expect(ending.events.some((e) => e.type === 'UnitStoodUp')).toBe(false);
    expect(ending.state.units.find((u) => u.id === 'p0u0')!.knockedDown).toBe(true);
    expect(standing.events).toEqual([{ type: 'UnitStoodUp', unitId: 'p0u0', reassembled: true }]);
    expect(standing.state).toBe(t.state);
    // The rebuilt state is a copy; the final one is left alone.
    expect(t.state.units.find((u) => u.id === 'p0u0')!.knockedDown).toBe(false);
  });

  it('leaves a round with nobody reassembling in one piece', () => {
    const t = endRound(board(false));
    expect(splitRoundStart(t)).toEqual([t]);
  });
});
