import { describe, expect, it } from 'vitest';
import { createGame, reduce, type Command, type GameState, type UnitSpec } from '@fansong/engine';
import { chooseCommand } from '../src/index.js';

const U = (name: string, x: number, y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 3,
  combat: 3,
  pos: { x, y },
  ...extra,
});

const game = (w0: UnitSpec[], w1: UnitSpec[]): GameState => createGame({ seed: 3, board: { width: 12, height: 8 }, warbands: [w0, w1] });

/** Put `unitId` mid-activation with `actions` actions (no dice, so no luck involved). */
function activate(s: GameState, unitId: string, actions = 2): GameState {
  const next = structuredClone(s);
  next.units.find((u) => u.id === unitId)!.activatedThisRound = true;
  return { ...next, phase: 'acting', activeUnitId: unitId, actionsRemaining: actions, activationCount: 1 };
}

const cry: Command = { type: 'WarCry', unitId: 'p0u0' };

describe('AI Leader', () => {
  it('war cries before anything else when two or more friends are still to activate', () => {
    // Even with a foe to hit, the cry comes first.
    const s = activate(game([U('cap', 5, 4, { leader: true }), U('a', 1, 1), U('b', 1, 6)], [U('foe', 5, 3)]), 'p0u0');
    expect(chooseCommand(s)).toEqual(cry);
    // Then it gets on with the fight.
    expect(chooseCommand(reduce(s, cry).state).type).toBe('Attack');
  });

  it('does not waste an action inspiring a single friend while there is fighting to do', () => {
    const s = activate(game([U('cap', 5, 4, { leader: true }), U('a', 1, 1)], [U('foe', 5, 3)]), 'p0u0');
    expect(chooseCommand(s).type).toBe('Attack');
  });

  it('activates its Leader first while the war cry would reach a quorum', () => {
    // The friend can already attack, which normally goes first.
    const s = game([U('a', 5, 4), U('b', 1, 6), U('cap', 0, 0, { leader: true })], [U('foe', 5, 3)]);
    const first = chooseCommand(s);
    expect(first.type === 'ChooseActivation' && first.unitId).toBe('p0u2');
  });
});
