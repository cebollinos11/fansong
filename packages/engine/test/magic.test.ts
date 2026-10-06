import { describe, expect, it } from 'vitest';
import {
  createGame,
  getLegalCommands,
  makeHexGrid,
  reduce,
  resolveCombatMorale,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Unit,
  type UnitSpec,
} from '../src/index.js';

/**
 * The Magic User trait and its one spell, Transfix: the spell turn, the
 * target's roll to resist, and everything being transfixed does to a unit.
 *
 * Scenes are laid out down one column: on a flat-top grid `(x, y)` and
 * `(x, y+n)` are `n` hexes apart in a straight line. Quality 1 never fails a
 * die and Quality 7 never passes one, which pins the dice where a test needs.
 */

const SEEDS = 400;

function config(p0: UnitSpec[], p1: UnitSpec[], seed = 1): GameConfig {
  return { seed, board: { width: 7, height: 10 }, warbands: [p0, p1] };
}

function unit(s: GameState, id: string): Unit {
  return s.units.find((u) => u.id === id)!;
}

/** A state already mid-activation for `activeUnitId`, with `actions` in hand. */
function acting(s: GameState, activeUnitId = 'p0u0', actions = 1): GameState {
  const u = unit(s, activeUnitId);
  s.active = u.owner;
  s.activeUnitId = activeUnitId;
  s.phase = 'acting';
  s.actionsRemaining = actions;
  u.activatedThisRound = true;
  return s;
}

function ofType<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const mage: UnitSpec = { name: 'Mage', quality: 1, combat: 2, pos: { x: 3, y: 0 }, magicUser: true };
const spellTurn = (diceCount: number): Command => ({ type: 'ChooseActivation', unitId: 'p0u0', diceCount, spell: true });
const cast: Command = { type: 'Cast', casterId: 'p0u0', targetId: 'p1u0' };

const spellChoices = (s: GameState) =>
  getLegalCommands(s).flatMap((c) => (c.type === 'ChooseActivation' && c.spell ? [c.diceCount] : []));

describe('Spell turn', () => {
  const foeAt = (y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({ name: 'Foe', quality: 7, combat: 3, pos: { x: 3, y }, ...extra });

  it('is offered on any dice that could reach a target: 3, 5 or 7 hexes', () => {
    expect(spellChoices(createGame(config([mage], [foeAt(3)])))).toEqual([1, 2, 3]);
    expect(spellChoices(createGame(config([mage], [foeAt(5)])))).toEqual([2, 3]);
    expect(spellChoices(createGame(config([mage], [foeAt(7)])))).toEqual([3]);
    expect(spellChoices(createGame(config([mage], [foeAt(8)])))).toEqual([]);
  });

  it('is not offered to a unit without the trait, a knocked-down caster or one in contact with a standing foe', () => {
    expect(spellChoices(createGame(config([{ ...mage, magicUser: false }], [foeAt(3)])))).toEqual([]);

    const down = createGame(config([mage], [foeAt(3)]));
    unit(down, 'p0u0').knockedDown = true;
    expect(spellChoices(down)).toEqual([]);

    const locked = createGame(config([mage], [foeAt(1), foeAt(4)]));
    expect(spellChoices(locked)).toEqual([]);
    // A foe lying at its feet locks no one in place.
    unit(locked, 'p1u0').knockedDown = true;
    expect(spellChoices(locked)).toEqual([1, 2, 3]);
  });

  it('needs a line of sight no unit stands in', () => {
    const blocker: UnitSpec = { name: 'Blocker', quality: 3, combat: 3, pos: { x: 3, y: 2 } };
    const s = createGame(config([mage, blocker], [foeAt(4)]));
    expect(spellChoices(s)).toEqual([]);
  });

  it('a Dumb caster rolls at most 2 dice', () => {
    expect(spellChoices(createGame(config([{ ...mage, dumb: true }], [foeAt(3)])))).toEqual([1, 2]);
  });

  it('puts every success into the spell: the only thing left to do is cast it', () => {
    const { state, events } = reduce(createGame(config([mage], [foeAt(7)])), spellTurn(3));
    expect(ofType(events, 'ActivationChosen')[0]!.spell).toBe(true);
    expect(state.spell).toEqual({ power: 3 });
    expect(getLegalCommands(state)).toEqual([{ type: 'EndActivation' }, cast]);
    expect(() => reduce(state, { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 1 } })).toThrow();
  });

  it('transfixes a target that fails any die of its roll to resist, and ends the activation', () => {
    const { state } = reduce(createGame(config([mage], [foeAt(7)])), spellTurn(3));
    const out = reduce(state, cast);
    const spell = ofType(out.events, 'SpellCast')[0]!;
    expect(spell).toMatchObject({ power: 3, quality: 7, failures: 3, transfixed: true });
    expect(spell.dice).toHaveLength(3);
    expect(unit(out.state, 'p1u0').transfixedBy).toBe('p0u0');
    expect(out.state.spell).toBeUndefined();
    expect(out.state.activeUnitId).toBeNull();
  });

  it('leaves alone a target that passes every die', () => {
    const { state } = reduce(createGame(config([mage], [foeAt(3, { quality: 1 })])), spellTurn(3));
    const out = reduce(state, cast);
    expect(ofType(out.events, 'SpellCast')[0]).toMatchObject({ failures: 0, transfixed: false });
    expect(unit(out.state, 'p1u0').transfixedBy).toBeUndefined();
  });

  it('breaks a guard stance', () => {
    const s = createGame(config([mage], [foeAt(3, { guard: true })]));
    unit(s, 'p1u0').guarding = true;
    const out = reduce(reduce(s, spellTurn(3)).state, cast);
    expect(unit(out.state, 'p1u0').guarding).toBe(false);
  });

  it('is wasted when the successes rolled fall short of every target', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createGame(config([{ ...mage, quality: 4 }], [foeAt(7)], seed));
      const { state, events } = reduce(s, spellTurn(3));
      const roll = ofType(events, 'DiceRolled')[0]!;
      if (roll.successes !== 2) continue;
      expect(state.spell).toBeUndefined();
      expect(state.activeUnitId).toBeNull();
      expect(unit(state, 'p0u0').activatedThisRound).toBe(true);
      return;
    }
    throw new Error('no seed rolls 2 successes');
  });

  it('still turns over on two failures, after the spell its one success bought', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createGame(config([{ ...mage, quality: 4 }], [foeAt(3)], seed));
      const { state, events } = reduce(s, spellTurn(3));
      if (ofType(events, 'DiceRolled')[0]!.successes !== 1) continue;
      expect(ofType(events, 'Turnover')).toHaveLength(1);
      expect(state.spell).toEqual({ power: 1 });
      const out = reduce(state, cast);
      expect(unit(out.state, 'p1u0').transfixedBy).toBe('p0u0');
      expect(out.state.benched[0]).toBe(true);
      return;
    }
    throw new Error('no seed rolls 1 success');
  });

  it('cast over another spell, takes the hold', () => {
    const s = createGame(config([mage, { ...mage, pos: { x: 2, y: 0 } }], [foeAt(3)]));
    unit(s, 'p1u0').transfixedBy = 'p0u1';
    const out = reduce(reduce(s, spellTurn(3)).state, cast);
    expect(unit(out.state, 'p1u0').transfixedBy).toBe('p0u0');
  });
});

describe('Transfixed', () => {
  const victim: UnitSpec = { name: 'Victim', quality: 3, combat: 3, pos: { x: 3, y: 3 } };
  const striker: UnitSpec = { name: 'Striker', quality: 3, combat: 3, pos: { x: 3, y: 2 } };
  const farMage: UnitSpec = { ...mage, pos: { x: 0, y: 0 } };

  /** `striker` (p0u0) next to a transfixed `victim` (p1u0), held by the mage p0u1. */
  function held(seed = 1, victimExtra: Partial<UnitSpec> = {}, strikerExtra: Partial<UnitSpec> = {}): GameState {
    const s = createGame(config([{ ...striker, ...strikerExtra }, farMage], [{ ...victim, ...victimExtra }], seed));
    unit(s, 'p1u0').transfixedBy = 'p0u1';
    return s;
  }

  const strike: Command = { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' };

  it('can only roll to break free, on 2 or 3 dice', () => {
    const s = held();
    s.active = 1;
    expect(getLegalCommands(s)).toEqual([
      { type: 'ChooseActivation', unitId: 'p1u0', diceCount: 2 },
      { type: 'ChooseActivation', unitId: 'p1u0', diceCount: 3 },
    ]);
  });

  it('breaks free on two successes, on its feet, with a third to spend', () => {
    const s = held(1, { quality: 1 });
    s.active = 1;
    unit(s, 'p1u0').knockedDown = true;
    const { state, events } = reduce(s, { type: 'ChooseActivation', unitId: 'p1u0', diceCount: 3 });
    expect(ofType(events, 'ActivationChosen')[0]!.breakFree).toBe(true);
    expect(ofType(events, 'TransfixBroken')).toEqual([{ type: 'TransfixBroken', unitId: 'p1u0', reason: 'brokeFree' }]);
    expect(unit(state, 'p1u0')).toMatchObject({ knockedDown: false });
    expect(unit(state, 'p1u0').transfixedBy).toBeUndefined();
    expect(state.activeUnitId).toBe('p1u0');
    expect(state.actionsRemaining).toBe(1);
  });

  it('breaks free on exactly two successes with nothing left over', () => {
    const s = held(1, { quality: 1 });
    s.active = 1;
    const { state } = reduce(s, { type: 'ChooseActivation', unitId: 'p1u0', diceCount: 2 });
    expect(unit(state, 'p1u0').transfixedBy).toBeUndefined();
    expect(state.activeUnitId).toBeNull();
  });

  it('stays held on fewer than two successes, and does nothing', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = held(seed, { quality: 4 });
      s.active = 1;
      const { state, events } = reduce(s, { type: 'ChooseActivation', unitId: 'p1u0', diceCount: 3 });
      if (ofType(events, 'DiceRolled')[0]!.successes !== 1) continue;
      expect(unit(state, 'p1u0').transfixedBy).toBe('p0u1');
      expect(state.activeUnitId).toBeNull();
      expect(ofType(events, 'Turnover')).toHaveLength(1);
      return;
    }
    throw new Error('no seed rolls 1 success');
  });

  it('is struck at +2, dies to any blow that beats it, and never hurts its attacker', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { state, events } = reduce(acting(held(seed)), strike);
      const attack = ofType(events, 'AttackResolved')[0]!;
      expect(attack.attackTransfixed).toBe(2);
      seen.add(attack.result);
      if (attack.attackScore > attack.defenseScore) expect(unit(state, 'p1u0').dead).toBe(true);
      else expect(attack.result).toBe('clash');
      expect(unit(state, 'p0u0')).toMatchObject({ dead: false, knockedDown: false, pos: { x: 3, y: 2 } });
    }
    expect([...seen].sort()).toEqual(['clash', 'defenderKilled']);
  });

  it('is shot at +2, and any shot that beats it kills', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = held(seed, {}, { pos: { x: 3, y: 0 }, ranged: 5 });
      const { state, events } = reduce(acting(s), { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
      const shot = ofType(events, 'ShotResolved')[0]!;
      expect(shot.attackTransfixed).toBe(2);
      expect(unit(state, 'p1u0').dead).toBe(shot.attackScore > shot.defenseScore);
    }
  });

  it('Armored still turns aside a loss by exactly 1', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { state, events } = reduce(acting(held(seed, { armored: true })), strike);
      const attack = ofType(events, 'AttackResolved')[0]!;
      if (attack.attackScore !== attack.defenseScore + 1) continue;
      expect(attack.result).toBe('clash');
      expect(ofType(events, 'ArmorHeld')).toHaveLength(1);
      expect(unit(state, 'p1u0').dead).toBe(false);
      return;
    }
    throw new Error('no seed loses by 1');
  });

  it('Tough still turns its first death into a knockdown, and it stays held', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { state, events } = reduce(acting(held(seed, { tough: true })), strike);
      if (ofType(events, 'AttackResolved')[0]!.result !== 'defenderKilled') continue;
      expect(ofType(events, 'ToughnessSaved')).toHaveLength(1);
      expect(unit(state, 'p1u0')).toMatchObject({ dead: false, knockedDown: true, transfixedBy: 'p0u1' });
      return;
    }
    throw new Error('no seed kills');
  });

  it('counts as no standing unit: it outnumbers no one and swings at no leaver', () => {
    const second: UnitSpec = { name: 'Second', quality: 3, combat: 3, pos: { x: 3, y: 1 } };
    const s = createGame(config([striker, farMage], [victim, second]));
    const outnumbered = (state: GameState) =>
      ofType(reduce(acting(structuredClone(state)), { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u1' }).events, 'AttackResolved')[0]!
        .attackOutnumbered;
    expect(outnumbered(s)).toBe(1);
    unit(s, 'p1u0').transfixedBy = 'p0u1';
    expect(outnumbered(s)).toBeUndefined();

    const leaving = held();
    const { events } = reduce(acting(leaving), { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 0 } });
    expect(ofType(events, 'FreeHackResolved')).toHaveLength(0);
  });

  it('gives an Opportunist its bonus', () => {
    const { events } = reduce(acting(held(1, {}, { opportunist: true })), strike);
    expect(ofType(events, 'AttackResolved')[0]!.attackOpportunist).toBe(1);
  });

  const friend: UnitSpec = { name: 'Friend', quality: 3, combat: 3, pos: { x: 3, y: 4 } };

  it('is no witness: a gruesome kill beside it tests no nerve of its own', () => {
    const s = createGame(config([striker, farMage], [{ ...victim, quality: 7 }, friend, { ...friend, pos: { x: 5, y: 9 } }, { ...friend, pos: { x: 6, y: 9 } }]));
    unit(s, 'p1u0').transfixedBy = 'p0u1';
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p1u1'), makeHexGrid(s.board), true);
    expect(ofType(events, 'NerveCheck').map((e) => e.unitId)).not.toContain('p1u0');
    expect(unit(s, 'p1u0').dead).toBe(false);
  });

  it('is lost for good when it fails the nerve check of a rout', () => {
    const s = createGame(config([striker, farMage], [{ ...victim, quality: 7 }, friend, { ...friend, pos: { x: 3, y: 5 } }]));
    unit(s, 'p1u0').transfixedBy = 'p0u1';
    unit(s, 'p1u1').dead = true;
    unit(s, 'p1u2').dead = true;
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p1u2'), makeHexGrid(s.board), false);
    expect(ofType(events, 'UnitRouted')).toEqual([{ type: 'UnitRouted', unitId: 'p1u0' }]);
    expect(ofType(events, 'UnitFled')).toHaveLength(0);
    expect(unit(s, 'p1u0').dead).toBe(true);
  });
});

describe('A caster losing its hold', () => {
  const victim: UnitSpec = { name: 'Victim', quality: 3, combat: 3, pos: { x: 3, y: 5 } };
  const freed = (events: GameEvent[]) => ofType(events, 'TransfixBroken');
  const lost = [{ type: 'TransfixBroken', unitId: 'p0u0', reason: 'casterLost' }];

  it('frees its victims when it is killed, without standing them up', () => {
    const killer: UnitSpec = { name: 'Killer', quality: 3, combat: 6, pos: { x: 3, y: 5 } };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createGame(config([{ ...victim, pos: { x: 0, y: 0 } }, killer], [{ ...mage, pos: { x: 3, y: 6 }, combat: 1 }], seed));
      Object.assign(unit(s, 'p0u0'), { transfixedBy: 'p1u0', knockedDown: true });
      const { state, events } = reduce(acting(s, 'p0u1'), { type: 'Attack', attackerId: 'p0u1', targetId: 'p1u0' });
      if (!unit(state, 'p1u0').dead) continue;
      expect(freed(events)).toEqual(lost);
      expect(unit(state, 'p0u0').transfixedBy).toBeUndefined();
      expect(unit(state, 'p0u0').knockedDown).toBe(true);
      return;
    }
    throw new Error('no seed kills the caster');
  });

  it('frees its victims when it is transfixed itself', () => {
    const s = createGame(config([mage, { ...victim, pos: { x: 0, y: 0 } }], [{ ...mage, quality: 7, pos: { x: 3, y: 3 } }]));
    unit(s, 'p0u1').transfixedBy = 'p1u0';
    const out = reduce(reduce(s, spellTurn(3)).state, cast);
    expect(unit(out.state, 'p1u0').transfixedBy).toBe('p0u0');
    expect(freed(out.events)).toEqual([{ type: 'TransfixBroken', unitId: 'p0u1', reason: 'casterLost' }]);
    expect(unit(out.state, 'p0u1').transfixedBy).toBeUndefined();
  });

  it('frees its victims when it flees the field', () => {
    // Player 1 runs for the right-hand edge: a caster already on it is gone.
    const friend: UnitSpec = { name: 'Friend', quality: 3, combat: 3, pos: { x: 5, y: 3 } };
    const s = createGame(config([victim], [{ ...mage, quality: 7, pos: { x: 6, y: 3 } }, friend]));
    unit(s, 'p0u0').transfixedBy = 'p1u0';
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p1u1'), makeHexGrid(s.board), true);
    expect(unit(s, 'p1u0').dead).toBe(true);
    expect(freed(events)).toEqual(lost);
  });

  it('frees its victims when it changes sides', () => {
    const friend: UnitSpec = { name: 'Friend', quality: 3, combat: 3, pos: { x: 4, y: 3 } };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createGame(config([victim], [{ ...mage, quality: 7, disloyal: true, pos: { x: 3, y: 3 } }, friend], seed));
      unit(s, 'p0u0').transfixedBy = 'p1u0';
      const events: GameEvent[] = [];
      resolveCombatMorale(s, events, unit(s, 'p1u1'), makeHexGrid(s.board), true);
      if (ofType(events, 'UnitDefected').length === 0) continue;
      expect(freed(events)).toEqual(lost);
      return;
    }
    throw new Error('no seed rolls the natural 1');
  });
});
