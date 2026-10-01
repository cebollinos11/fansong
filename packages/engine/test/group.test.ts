import { describe, expect, it } from 'vitest';
import { makeHexGrid } from '../src/board.js';
import { isLegalCommand } from '../src/apply.js';
import { getLegalCommands } from '../src/legal.js';
import { GROUP_MAX, groupFor } from '../src/query.js';
import { reduce } from '../src/reduce.js';
import { hashGameState } from '../src/replay.js';
import { createGame, type UnitSpec } from '../src/setup.js';
import type { Command, GameState } from '../src/types.js';

/** A numbered copy of one roster line: its own name, the shared look. Quality 1 = every die succeeds. */
const bones = (n: number, x: number, y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name: n === 1 ? 'Bones' : `Bones ${n}`,
  look: 'Bones',
  quality: 1,
  combat: 3,
  pos: { x, y },
  ...extra,
});

/** Three Bones in a column (0,0)-(0,2), a fourth out of reach at (0,5), and a stranger beside them. */
function game(p0: UnitSpec[] = [bones(1, 0, 0), bones(2, 0, 1), bones(3, 0, 2), bones(4, 0, 5)]): GameState {
  return createGame({
    seed: 1,
    board: { width: 12, height: 8 },
    warbands: [
      [...p0, { name: 'Stranger', quality: 1, combat: 3, pos: { x: 1, y: 0 } }],
      [
        { name: 'Foe', quality: 1, combat: 3, pos: { x: 11, y: 0 } },
        { name: 'Foe2', quality: 1, combat: 2, pos: { x: 11, y: 7 } },
      ],
    ],
  });
}

const ids = (g: GameState, unitId: string) =>
  groupFor(g, g.units.find((u) => u.id === unitId)!, makeHexGrid(g.board)).map((u) => u.id);

const groupPick = (unitId: string, diceCount = 2): Command => ({ type: 'ChooseActivation', unitId, diceCount, group: true });

describe('who forms a group', () => {
  it('takes like units within two hexes, the picked one first, then nearest', () => {
    const g = game();
    expect(ids(g, 'p0u0')).toEqual(['p0u0', 'p0u1', 'p0u2']);
    expect(ids(g, 'p0u2')).toEqual(['p0u2', 'p0u1', 'p0u0']);
  });

  it('leaves out a unit with no one like it nearby', () => {
    const g = game();
    expect(ids(g, 'p0u3')).toEqual([]); // the far Bones
    expect(ids(g, 'p0u4')).toEqual([]); // the Stranger
  });

  it('needs the same stats, traits, sprite and tint', () => {
    const differing: Partial<UnitSpec>[] = [{ quality: 2 }, { combat: 4 }, { fast: true }, { look: 'Ghoul' }, { tint: '#ff0000' }];
    for (const extra of differing) {
      const g = game([bones(1, 0, 0), bones(2, 0, 1, extra)]);
      expect(ids(g, 'p0u0')).toEqual([]);
    }
    const tinted = game([bones(1, 0, 0, { tint: '#ff0000' }), bones(2, 0, 1, { tint: '#ff0000' })]);
    expect(ids(tinted, 'p0u0')).toEqual(['p0u0', 'p0u1']);
  });

  it('leaves knocked-down units out, and lets none call a group', () => {
    const g = game();
    g.units[1]!.knockedDown = true;
    expect(ids(g, 'p0u0')).toEqual(['p0u0', 'p0u2']);
    expect(ids(g, 'p0u1')).toEqual([]);
    expect(isLegalCommand(g, groupPick('p0u1'))).toBe(false);
    expect(() => reduce(g, groupPick('p0u1'))).toThrow();
  });

  it('skips members that already activated and caps the group', () => {
    const g = game();
    g.units[1]!.activatedThisRound = true;
    expect(ids(g, 'p0u0')).toEqual(['p0u0', 'p0u2']);

    const crowd = game([bones(1, 1, 1), bones(2, 0, 0), bones(3, 0, 1), bones(4, 0, 2), bones(5, 1, 2), bones(6, 2, 1), bones(7, 2, 2)]);
    expect(ids(crowd, 'p0u0')).toHaveLength(GROUP_MAX);
  });
});

describe('group activation', () => {
  it('is offered after the solo choices, only to units with a group', () => {
    const legal = getLegalCommands(game());
    const of = (unitId: string) => legal.filter((c) => c.type === 'ChooseActivation' && c.unitId === unitId);
    expect(of('p0u0')).toEqual([
      { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 },
      { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 },
      { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 3 },
      { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1, group: true },
      { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2, group: true },
      { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 3, group: true },
    ]);
    expect(of('p0u3')).toHaveLength(3);
    expect(isLegalCommand(game(), groupPick('p0u3'))).toBe(false);
  });

  it('rolls once and gives every member the successes, holding the turn until the last is done', () => {
    const first = reduce(game(), groupPick('p0u0', 2));
    expect(first.events.filter((e) => e.type === 'DiceRolled')).toHaveLength(1);
    expect(first.events[0]).toEqual({ type: 'ActivationChosen', player: 0, unitId: 'p0u0', diceCount: 2, group: ['p0u0', 'p0u1', 'p0u2'] });
    let s = first.state;
    for (const id of ['p0u0', 'p0u1', 'p0u2']) expect(s.units.find((u) => u.id === id)!.activatedThisRound).toBe(true);
    expect(s.units.find((u) => u.id === 'p0u3')!.activatedThisRound).toBe(false);

    for (const id of ['p0u0', 'p0u1', 'p0u2']) {
      expect(s.active).toBe(0);
      expect(s.phase).toBe('acting');
      expect(s.activeUnitId).toBe(id);
      expect(s.actionsRemaining).toBe(2);
      s = reduce(s, { type: 'EndActivation' }).state;
    }
    expect(s.active).toBe(1);
    expect(s.phase).toBe('awaitingActivation');
    expect(s.group).toBeUndefined();
  });

  it('announces each member as it takes over', () => {
    const s = reduce(game(), groupPick('p0u0')).state;
    const { events } = reduce(s, { type: 'EndActivation' });
    expect(events).toEqual([
      { type: 'ActivationEnded', unitId: 'p0u0' },
      { type: 'GroupMemberActivated', unitId: 'p0u1', actions: 2 },
    ]);
  });

  it('wastes the whole group on a roll with no successes, and turns over on two failures', () => {
    const g = game();
    for (const u of g.units) if (u.owner === 0) u.quality = 7;
    const { state, events } = reduce(g, groupPick('p0u0', 2));
    expect(events.some((e) => e.type === 'Turnover')).toBe(true);
    expect(state.benched[0]).toBe(true);
    expect(state.active).toBe(1);
    expect(state.group).toBeUndefined();
    for (const id of ['p0u0', 'p0u1', 'p0u2']) expect(state.units.find((u) => u.id === id)!.activatedThisRound).toBe(true);
  });

  it('still lets every member spend what a turnover roll earned', () => {
    // Quality 4: hunt for a seed whose 3 dice come up 2 failures and 1 success.
    const roll = (seed: number) => {
      const g = game();
      g.rngState = seed;
      for (const u of g.units) if (u.owner === 0) u.quality = 4;
      return reduce(g, groupPick('p0u0', 3));
    };
    let res = roll(1);
    for (let seed = 2; !res.events.some((e) => e.type === 'DiceRolled' && e.successes === 1); seed++) res = roll(seed);

    let s = res.state;
    expect(s.benched[0]).toBe(true);
    for (const id of ['p0u0', 'p0u1', 'p0u2']) {
      expect(s.activeUnitId).toBe(id);
      expect(s.actionsRemaining).toBe(1);
      s = reduce(s, { type: 'EndActivation' }).state;
    }
    expect(s.active).toBe(1);
  });

  it('ends at once on a single die that misses, without stepping through the members', () => {
    const g = game();
    for (const u of g.units) if (u.owner === 0) u.quality = 7;
    const { state, events } = reduce(g, groupPick('p0u0', 1));
    expect(events.map((e) => e.type)).toEqual(['ActivationChosen', 'DiceRolled', 'ActivationEnded']);
    expect(state.benched[0]).toBe(false);
    expect(state.active).toBe(1);
    expect(state.group).toBeUndefined();
    expect(state.activationCount).toBe(1);
    for (const id of ['p0u0', 'p0u1', 'p0u2']) expect(state.units.find((u) => u.id === id)!.activatedThisRound).toBe(true);
  });

  it('makes a member knocked down while it waits pay an action to stand', () => {
    let s = reduce(game(), groupPick('p0u0', 2)).state;
    s = { ...s, units: s.units.map((u) => (u.id === 'p0u1' ? { ...u, knockedDown: true } : u)) };
    const next = reduce(s, { type: 'EndActivation' });
    expect(next.events.some((e) => e.type === 'UnitStoodUp' && e.unitId === 'p0u1')).toBe(true);
    expect(next.state.activeUnitId).toBe('p0u1');
    expect(next.state.actionsRemaining).toBe(1);
  });

  it('rolls the sure 6 only when every member is inspired, and spends the inspiration regardless', () => {
    const rolled = (inspired: string[]) => {
      const g = game();
      for (const u of g.units) {
        if (u.owner === 0) u.quality = 7; // only the sure 6 could succeed... and 6 < 7, so read the event instead
        u.inspired = inspired.includes(u.id);
      }
      return reduce(g, groupPick('p0u0', 1));
    };
    const all = rolled(['p0u0', 'p0u1', 'p0u2']);
    const some = rolled(['p0u0', 'p0u1']);
    const dice = (r: typeof all) => r.events.find((e) => e.type === 'DiceRolled');
    expect(dice(all)).toMatchObject({ inspired: true });
    expect((dice(all) as { dice: number[] }).dice[0]).toBe(6);
    expect(dice(some)).not.toHaveProperty('inspired');
    for (const r of [all, some]) {
      for (const id of ['p0u0', 'p0u1', 'p0u2']) expect(r.state.units.find((u) => u.id === id)!.inspired).toBe(false);
    }
  });

  it('lets the player reorder members until the active one acts', () => {
    let s = reduce(game(), groupPick('p0u0', 2)).state;
    expect(getLegalCommands(s).filter((c) => c.type === 'SwitchGroupMember')).toEqual([
      { type: 'SwitchGroupMember', unitId: 'p0u1' },
      { type: 'SwitchGroupMember', unitId: 'p0u2' },
    ]);

    const switched = reduce(s, { type: 'SwitchGroupMember', unitId: 'p0u2' });
    expect(switched.events).toEqual([{ type: 'GroupMemberActivated', unitId: 'p0u2', actions: 2 }]);
    s = switched.state;
    expect(s.activeUnitId).toBe('p0u2');
    expect(s.actionsRemaining).toBe(2);
    expect(s.group!.pending.map((p) => p.unitId)).toEqual(['p0u0', 'p0u1']);

    // Once it has moved, it is committed.
    const move = getLegalCommands(s).find((c) => c.type === 'Move')!;
    s = reduce(s, move).state;
    expect(getLegalCommands(s).some((c) => c.type === 'SwitchGroupMember')).toBe(false);
    expect(() => reduce(s, { type: 'SwitchGroupMember', unitId: 'p0u0' })).toThrow();
  });

  it('ends the game at once when a member wins it mid-group', () => {
    const g = createGame({
      seed: 1,
      board: { width: 6, height: 4 },
      warbands: [
        [bones(1, 0, 0), bones(2, 0, 1)],
        [{ name: 'Foe', quality: 1, combat: 0, pos: { x: 1, y: 0 } }],
      ],
    });
    g.units[0]!.combat = g.units[1]!.combat = 20;
    const s = reduce(g, groupPick('p0u0', 2)).state;
    const end = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' }).state;
    expect(end.phase).toBe('gameOver');
    expect(end.group).toBeUndefined();
  });

  it('ends the round after the last member when no one else can act', () => {
    const g = game();
    for (const u of g.units) if (!['p0u0', 'p0u1', 'p0u2'].includes(u.id)) u.activatedThisRound = true;
    let s = reduce(g, groupPick('p0u0', 1)).state;
    s = reduce(s, { type: 'EndActivation' }).state;
    s = reduce(s, { type: 'EndActivation' }).state;
    expect(s.round).toBe(1);
    s = reduce(s, { type: 'EndActivation' }).state;
    expect(s.round).toBe(2);
  });

  it('leaves a solo activation, and its state hash, as it was', () => {
    const g = game();
    const { state, events } = reduce(g, { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 });
    expect(events[0]).toEqual({ type: 'ActivationChosen', player: 0, unitId: 'p0u0', diceCount: 2 });
    expect(state.group).toBeUndefined();
    expect('group' in state).toBe(false);
    expect(state.units.find((u) => u.id === 'p0u1')!.activatedThisRound).toBe(false);
    expect(hashGameState(state)).toBe(hashGameState({ ...state }));
  });
});
