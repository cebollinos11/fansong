import { describe, expect, it } from 'vitest';
import { applyCommand, commandsEqual, isLegalCommand } from '../src/apply.js';
import { getLegalCommands } from '../src/legal.js';
import { reduce } from '../src/reduce.js';
import { createGame } from '../src/setup.js';
import type { GameState } from '../src/types.js';

function twoUnits(): GameState {
  return createGame({
    seed: 42,
    board: { width: 6, height: 3 },
    warbands: [
      [{ name: 'A', quality: 3, combat: 3, pos: { x: 0, y: 1 } }],
      [{ name: 'B', quality: 3, combat: 3, pos: { x: 5, y: 1 } }],
    ],
  });
}

describe('commandsEqual', () => {
  it('matches by structure, not identity', () => {
    expect(commandsEqual({ type: 'EndActivation' }, { type: 'EndActivation' })).toBe(true);
    expect(
      commandsEqual(
        { type: 'Move', unitId: 'p0u0', to: { x: 1, y: 2 } },
        { type: 'Move', unitId: 'p0u0', to: { x: 1, y: 2 } },
      ),
    ).toBe(true);
    expect(
      commandsEqual(
        { type: 'Move', unitId: 'p0u0', to: { x: 1, y: 2 } },
        { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 2 } },
      ),
    ).toBe(false);
    expect(
      commandsEqual({ type: 'EndActivation' }, { type: 'Attack', attackerId: 'a', targetId: 'b' }),
    ).toBe(false);
    expect(
      commandsEqual(
        { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 },
        { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 3 },
      ),
    ).toBe(false);
  });
});

describe('isLegalCommand', () => {
  it('accepts exactly the getLegalCommands set', () => {
    const s = twoUnits();
    for (const c of getLegalCommands(s)) expect(isLegalCommand(s, c)).toBe(true);
  });

  it('rejects a command not currently legal', () => {
    const s = twoUnits();
    // EndActivation is only legal while acting; at the start it is not.
    expect(isLegalCommand(s, { type: 'EndActivation' })).toBe(false);
  });
});

describe('applyCommand', () => {
  it('reduces a legal command identically to reduce()', () => {
    const s = twoUnits();
    const cmd = getLegalCommands(s)[0]!;
    expect(applyCommand(s, cmd)).toEqual(reduce(s, cmd));
  });

  it('throws on an illegal command instead of reducing it', () => {
    const s = twoUnits();
    expect(() => applyCommand(s, { type: 'EndActivation' })).toThrow(/illegal command/);
  });

  it('does not mutate the input state', () => {
    const s = twoUnits();
    const before = structuredClone(s);
    applyCommand(s, getLegalCommands(s)[0]!);
    expect(s).toEqual(before);
  });
});
