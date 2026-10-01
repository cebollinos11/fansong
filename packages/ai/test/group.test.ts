import { describe, expect, it } from 'vitest';
import { createGame, reduce, type GameState, type UnitSpec } from '@fansong/engine';
import { chooseCommand } from '../src/index.js';

const U = (name: string, x: number, y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 3,
  combat: 3,
  pos: { x, y },
  ...extra,
});

const game = (w0: UnitSpec[], w1: UnitSpec[], mode?: 'capture-the-flag'): GameState =>
  createGame({ seed: 3, board: { width: 12, height: 8 }, warbands: [w0, w1], ...(mode ? { mode, objectives: { flags: [{ x: 0, y: 4 }, { x: 11, y: 4 }] } } : {}) });

const spears = [U('Spear', 2, 3, { look: 'Spear' }), U('Spear 2', 2, 4, { look: 'Spear' }), U('Spear 3', 2, 5, { look: 'Spear' })];

describe('AI group activation', () => {
  it('activates like units together rather than one at a time', () => {
    const first = chooseCommand(game(spears, [U('foe', 9, 4)]));
    expect(first).toMatchObject({ type: 'ChooseActivation', group: true });
  });

  it('still activates a unit alone when it has no one to group with', () => {
    const first = chooseCommand(game([U('a', 2, 3), U('b', 2, 4)], [U('foe', 9, 4)]));
    expect(first.type).toBe('ChooseActivation');
    expect(first).not.toHaveProperty('group');
  });

  it('plays every member in the order the engine lines them up', () => {
    let s = game(spears, [U('foe', 9, 4)]);
    const acted: string[] = [];
    while (s.active === 0 && s.phase !== 'gameOver') {
      const c = chooseCommand(s);
      expect(c.type).not.toBe('SwitchGroupMember');
      s = reduce(s, c).state;
      if (s.activeUnitId && acted.at(-1) !== s.activeUnitId) acted.push(s.activeUnitId);
    }
    expect(new Set(acted).size).toBe(acted.length);
  });

  it('groups in capture-the-flag too', () => {
    const first = chooseCommand(game(spears, [U('foe', 9, 4)], 'capture-the-flag'));
    expect(first).toMatchObject({ type: 'ChooseActivation', group: true });
  });
});
