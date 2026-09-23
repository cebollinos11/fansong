import { describe, expect, it } from 'vitest';
import { createGame, reduce, type GameConfig, type GameEvent, type GameState } from '../src/index.js';

/**
 * Two units far apart so nobody fights; p0's is Reassembling. Tests drive the
 * round to its end and inspect what stands back up at the top of the next one.
 */
function board(reassembling: boolean): GameState {
  const config: GameConfig = {
    seed: 5,
    board: { width: 8, height: 2 },
    warbands: [
      [{ name: 'Bones', quality: 3, combat: 3, reassembling, pos: { x: 0, y: 0 } }],
      [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 7, y: 0 } }],
    ],
  };
  return createGame(config);
}

/**
 * Force the current round to end with `p0u0` knocked down, without any dice: both
 * units are marked as already-activated (so neither is available), then a bare
 * EndActivation drops through `advanceTurn` into `endRound`.
 */
function endRoundWith(s: GameState): { state: GameState; events: GameEvent[] } {
  for (const u of s.units) u.activatedThisRound = true;
  const foe = s.units.find((u) => u.id === 'p1u0')!;
  s.active = foe.owner;
  s.activeUnitId = foe.id;
  s.phase = 'acting';
  s.actionsRemaining = 1;
  return reduce(s, { type: 'EndActivation' });
}

describe('Reassembling trait', () => {
  it('stands a knocked-down reassembling unit up for free at the start of the round', () => {
    const s = board(true);
    s.units.find((u) => u.id === 'p0u0')!.knockedDown = true;

    const { state, events } = endRoundWith(s);

    expect(state.round).toBe(2);
    expect(state.units.find((u) => u.id === 'p0u0')!.knockedDown).toBe(false);
    // It has spent no action and is free to act this round.
    expect(state.units.find((u) => u.id === 'p0u0')!.activatedThisRound).toBe(false);

    const stood = events.find(
      (e): e is Extract<GameEvent, { type: 'UnitStoodUp' }> => e.type === 'UnitStoodUp' && e.unitId === 'p0u0',
    );
    expect(stood?.reassembled).toBe(true);

    // The free stand-up happens after the round has turned over.
    const roundIdx = events.findIndex((e) => e.type === 'RoundEnded');
    const stoodIdx = events.findIndex((e) => e.type === 'UnitStoodUp');
    expect(roundIdx).toBeGreaterThanOrEqual(0);
    expect(stoodIdx).toBeGreaterThan(roundIdx);
  });

  it('leaves a knocked-down unit down when it lacks the trait', () => {
    const s = board(false);
    s.units.find((u) => u.id === 'p0u0')!.knockedDown = true;

    const { state, events } = endRoundWith(s);

    expect(state.units.find((u) => u.id === 'p0u0')!.knockedDown).toBe(true);
    expect(events.some((e) => e.type === 'UnitStoodUp')).toBe(false);
  });

  it('does not raise a reassembling unit that is standing or dead', () => {
    const s = board(true);
    const bones = s.units.find((u) => u.id === 'p0u0')!;
    bones.dead = true;
    bones.knockedDown = true; // dead trumps knocked down

    const { events } = endRoundWith(s);
    expect(events.some((e) => e.type === 'UnitStoodUp')).toBe(false);
  });
});
