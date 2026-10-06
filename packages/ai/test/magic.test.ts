import { describe, expect, it } from 'vitest';
import { createGame, getLegalCommands, reduce, type GameConfig, type GameEvent, type GameState, type UnitSpec } from '@fansong/engine';
import { chooseCommand } from '../src/index.js';

/** The AI with Magic Users: it casts when a spell is worth it, struggles free when held, and its games still end. */

const fighter = (x: number, y: number): UnitSpec => ({ name: 'Fighter', quality: 3, combat: 3, pos: { x, y } });
const mage = (x: number, y: number): UnitSpec => ({ name: 'Mage', quality: 3, combat: 2, pos: { x, y }, magicUser: true });

function warbands(seed: number): GameConfig {
  return {
    seed,
    board: { width: 12, height: 10 },
    warbands: [
      [fighter(1, 2), fighter(1, 4), fighter(1, 6), mage(0, 3), mage(0, 5)],
      [fighter(10, 2), fighter(10, 4), fighter(10, 6), mage(11, 3), mage(11, 5)],
    ],
  };
}

function play(state: GameState, onEvent: (e: GameEvent) => void = () => {}): GameState {
  for (let steps = 0; state.phase !== 'gameOver' && steps < 20_000; steps++) {
    const command = chooseCommand(state);
    expect(getLegalCommands(state)).toContainEqual(command);
    const out = reduce(state, command);
    out.events.forEach(onEvent);
    state = out.state;
  }
  return state;
}

describe('AI with Magic Users', () => {
  it('takes a spell turn at a foe a friend can follow up on, and casts the spell it rolled', () => {
    const s = createGame({ seed: 3, board: { width: 9, height: 9 }, warbands: [[mage(1, 4), fighter(2, 6)], [fighter(4, 4)]] });
    const pick = chooseCommand(s);
    expect(pick).toMatchObject({ type: 'ChooseActivation', unitId: 'p0u0', spell: true });
    const acting: GameState = { ...s, phase: 'acting', activeUnitId: 'p0u0', actionsRemaining: 1, spell: { power: 2 } };
    expect(chooseCommand(acting)).toEqual({ type: 'Cast', casterId: 'p0u0', targetId: 'p1u0' });
  });

  it('rolls a held unit free before a foe beside it can strike', () => {
    const s = createGame({ seed: 3, board: { width: 9, height: 9 }, warbands: [[fighter(3, 4), fighter(0, 0)], [fighter(4, 4), mage(8, 8)]] });
    s.units[0]!.transfixedBy = 'p1u1';
    expect(chooseCommand(s)).toMatchObject({ type: 'ChooseActivation', unitId: 'p0u0' });
  });

  it('plays whole games out, casting and breaking free along the way', () => {
    let casts = 0;
    let held = 0;
    let freed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const final = play(createGame(warbands(seed)), (e) => {
        if (e.type === 'SpellCast') casts++;
        if (e.type === 'SpellCast' && e.transfixed) held++;
        if (e.type === 'TransfixBroken') freed++;
      });
      expect(final.phase).toBe('gameOver');
      expect(final.units.every((u) => u.dead || u.transfixedBy === undefined || !final.units.find((c) => c.id === u.transfixedBy)!.dead)).toBe(true);
    }
    expect(casts).toBeGreaterThan(10);
    expect(held).toBeGreaterThan(5);
    expect(freed).toBeGreaterThan(0);
  });
});
