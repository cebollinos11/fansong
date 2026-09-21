import { describe, expect, it } from 'vitest';
import { createGame } from '../src/setup.js';
import { reduce } from '../src/reduce.js';
import { getLegalCommands } from '../src/legal.js';
import type { GameState } from '../src/types.js';

function meleeSetup(): GameState {
  // Two units one cell apart so an attack is legal immediately.
  // Attacker combat 11 vs defender combat 0: min attack score (12) always
  // reaches double the max defence score (6), so the attack always kills.
  return createGame({
    seed: 3,
    board: { width: 6, height: 3 },
    warbands: [
      [{ name: 'Attacker', quality: 1, combat: 11, pos: { x: 1, y: 1 } }],
      [{ name: 'Victim', quality: 1, combat: 0, pos: { x: 2, y: 1 } }],
    ],
  });
}

describe('reduce + legal moves', () => {
  it('offers 1..3 dice per available unit when awaiting activation', () => {
    const g = meleeSetup();
    const cmds = getLegalCommands(g);
    // Only P0's single unit, three dice choices.
    expect(cmds.every((c) => c.type === 'ChooseActivation')).toBe(true);
    expect(cmds).toHaveLength(3);
  });

  it('spends an action to move within range and rejects out-of-range moves', () => {
    const g = createGame({
      seed: 3,
      board: { width: 8, height: 3 },
      warbands: [
        [{ name: 'Runner', quality: 1, combat: 3, move: 3, pos: { x: 0, y: 1 } }],
        [{ name: 'Far', quality: 1, combat: 3, pos: { x: 7, y: 1 } }],
      ],
    });
    const acting = reduce(g, { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 }).state;
    expect(acting.phase).toBe('acting');
    expect(acting.actionsRemaining).toBe(1);

    const moved = reduce(acting, { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 1 } }).state;
    expect(moved.units.find((u) => u.id === 'p0u0')!.pos).toEqual({ x: 3, y: 1 });
    // One action used -> activation auto-ends.
    expect(moved.activeUnitId).toBeNull();

    expect(() => reduce(acting, { type: 'Move', unitId: 'p0u0', to: { x: 4, y: 1 } })).toThrow();
  });

  it('resolves an attack and can kill, then flags game over', () => {
    const g = meleeSetup();
    const acting = reduce(g, { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 }).state;
    const res = reduce(acting, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });

    expect(res.events.some((e) => e.type === 'AttackResolved')).toBe(true);
    expect(res.state.units.find((u) => u.id === 'p1u0')!.dead).toBe(true);
    expect(res.state.phase).toBe('gameOver');
    expect(res.state.winner).toBe(0);
    expect(res.events.some((e) => e.type === 'GameOver')).toBe(true);
  });

  it('never lets an illegal command through', () => {
    const g = meleeSetup();
    // Wrong player's unit.
    expect(() => reduce(g, { type: 'ChooseActivation', unitId: 'p1u0', diceCount: 2 })).toThrow();
    // Attacking before an activation is chosen.
    expect(() => reduce(g, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' })).toThrow();
  });
});
