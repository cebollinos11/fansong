import { describe, expect, it } from 'vitest';
import {
  createGame,
  getLegalCommands,
  makeHexGrid,
  reduce,
  vecKey,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
  type Vec,
} from '../src/index.js';

type Hack = Extract<GameEvent, { type: 'FreeHackResolved' }>;

const config = (seed: number, p0: UnitSpec[], p1: UnitSpec[], width = 9, height = 5): GameConfig => ({
  seed,
  board: { width, height },
  warbands: [p0, p1],
});

/** Mid-activation for `p0u0`, with the RNG untouched so only this action consumes it. */
function acting(c: GameConfig, actions = 1): GameState {
  const s = createGame(c);
  s.active = 0;
  s.activeUnitId = 'p0u0';
  s.phase = 'acting';
  s.actionsRemaining = actions;
  s.units[0]!.activatedThisRound = true;
  return s;
}

const moveTargets = (s: GameState): Set<string> =>
  new Set(
    getLegalCommands(s)
      .filter((c): c is Extract<Command, { type: 'Move' }> => c.type === 'Move')
      .map((c) => vecKey(c.to)),
  );

const move = (s: GameState, to: Vec) => reduce(s, { type: 'Move', unitId: 'p0u0', to });
const hacks = (events: GameEvent[]) => events.filter((e): e is Hack => e.type === 'FreeHackResolved');

describe('moving into contact', () => {
  const mover: UnitSpec = { name: 'Mover', quality: 3, combat: 3, move: 3, pos: { x: 2, y: 2 } };
  const enemy: UnitSpec = { name: 'Enemy', quality: 3, combat: 3, pos: { x: 4, y: 2 } };

  it('stops a walk on the first hex in contact with an enemy', () => {
    const s = acting(config(1, [mover], [enemy]));
    const board = makeHexGrid(s.board);
    const targets = moveTargets(s);
    // Stepping into contact is fine...
    expect(targets.has('3,2')).toBe(true);
    // ...but every walk to (5,2) crosses contact, although open ground reaches it.
    expect(board.reachableWithin(mover.pos, 3).has('5,2')).toBe(true);
    expect(targets.has('5,2')).toBe(false);
  });

  it('never walks through an enemy', () => {
    const s = acting(config(1, [mover], [enemy]));
    expect(moveTargets(s).has(vecKey(enemy.pos))).toBe(false);
    expect(() => move(s, { x: 5, y: 2 })).toThrow(/unreachable/);
  });

  it('still lets a walk pass by friends', () => {
    const friend: UnitSpec = { name: 'Friend', quality: 3, combat: 3, pos: { x: 3, y: 2 } };
    const far: UnitSpec = { name: 'Far', quality: 3, combat: 3, pos: { x: 8, y: 0 } };
    const s = acting(config(1, [mover, friend], [far]));
    expect(moveTargets(s).has('4,2')).toBe(true);
  });

  it('reports the hexes walked, a legal path from origin to destination', () => {
    const s = acting(config(1, [mover], [enemy]));
    const board = makeHexGrid(s.board);
    for (const to of [{ x: 3, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 3 }]) {
      const e = move(s, to).events.find((x) => x.type === 'UnitMoved');
      if (e?.type !== 'UnitMoved') throw new Error('no move');
      const path = e.path!;
      expect(path[0]).toEqual(mover.pos);
      expect(path.at(-1)).toEqual(to);
      expect(path.length - 1).toBeLessThanOrEqual(mover.move!);
      for (let i = 1; i < path.length; i++) expect(board.distance(path[i - 1]!, path[i]!)).toBe(1);
    }
  });
});

describe('free hacks (leaving contact)', () => {
  const mover: UnitSpec = { name: 'Mover', quality: 3, combat: 3, move: 3, pos: { x: 2, y: 2 } };
  const enemy: UnitSpec = { name: 'Enemy', quality: 3, combat: 3, pos: { x: 3, y: 2 } };
  const away = { x: 0, y: 2 };

  const leave = (seed: number, p1: UnitSpec[] = [enemy]) => move(acting(config(seed, [mover], p1), 2), away);

  function seedFor(result: string): number {
    for (let seed = 1; seed <= 500; seed++) if (hacks(leave(seed).events)[0]?.result === result) return seed;
    throw new Error(`no seed gives ${result}`);
  }

  it('gives each standing enemy in contact one hack, before the move', () => {
    const { events } = leave(1);
    const hs = hacks(events);
    expect(hs).toHaveLength(1);
    expect(hs[0]!).toMatchObject({ attackerId: 'p1u0', targetId: 'p0u0' });
    const iHack = events.indexOf(hs[0]!);
    const iMove = events.findIndex((e) => e.type === 'UnitMoved');
    if (iMove >= 0) expect(iMove).toBeGreaterThan(iHack);
  });

  it('never hurts the hacker', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { state, events } = leave(seed);
      for (const h of hacks(events)) expect(h.result.startsWith('attacker')).toBe(false);
      const hacker = state.units.find((u) => u.id === 'p1u0')!;
      expect(hacker.dead || hacker.knockedDown).toBe(false);
      expect(hacker.pos).toEqual(enemy.pos);
    }
  });

  it('an even-die win knocks the leaver down where it stands and ends its activation', () => {
    const { state, events } = leave(seedFor('defenderKnockedDown'));
    const u = state.units.find((x) => x.id === 'p0u0')!;
    expect(u.knockedDown).toBe(true);
    expect(u.pos).toEqual(mover.pos);
    expect(events.some((e) => e.type === 'UnitMoved')).toBe(false);
    expect(state.activeUnitId).toBeNull();
    expect(state.phase).not.toBe('acting');
  });

  it('an odd-die win lets the leaver slip away', () => {
    const { state, events } = leave(seedFor('defenderRecoiled'));
    const u = state.units.find((x) => x.id === 'p0u0')!;
    expect(u.knockedDown).toBe(false);
    expect(u.pos).toEqual(away);
    expect(events.some((e) => e.type === 'UnitRecoiled')).toBe(false);
    expect(state.actionsRemaining).toBe(1);
  });

  it('a clash lets the leaver go', () => {
    const { state } = leave(seedFor('clash'));
    expect(state.units[0]!.pos).toEqual(away);
  });

  it('a knocked-down enemy gets no hack', () => {
    const s = acting(config(1, [mover], [enemy]), 2);
    s.units[1]!.knockedDown = true;
    const { state, events } = move(s, away);
    expect(hacks(events)).toHaveLength(0);
    expect(state.units[0]!.pos).toEqual(away);
  });

  it('a unit not in contact moves freely', () => {
    const far: UnitSpec = { ...enemy, pos: { x: 8, y: 2 } };
    expect(hacks(move(acting(config(1, [mover], [far])), away).events)).toHaveLength(0);
  });

  it('two enemies in contact both hack, and the leaver is outnumbered', () => {
    const second: UnitSpec = { name: 'Second', quality: 3, combat: 3, pos: { x: 2, y: 3 } };
    for (let seed = 1; seed <= 50; seed++) {
      const hs = hacks(leave(seed, [enemy, second]).events);
      expect(hs[0]!.defenseOutnumbered).toBe(1);
      expect(hs[0]!.defenseScore).toBe(3 + hs[0]!.defenseDie - 1);
      // The second hack only happens if the first let the leaver go.
      if (hs[0]!.result === 'clash' || hs[0]!.result === 'defenderRecoiled') expect(hs).toHaveLength(2);
      else expect(hs).toHaveLength(1);
    }
  });
});
