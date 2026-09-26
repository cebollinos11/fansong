import { describe, expect, it } from 'vitest';
import {
  airborne,
  createGame,
  dropFallenCarriers,
  flagAtBase,
  flagCarriedBy,
  flyingTargetBonus,
  makeHexGrid,
  reduce,
  walkRules,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
} from '../src/index.js';

const U = (name: string, x: number, y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 2,
  combat: 3,
  pos: { x, y },
  ...extra,
});

const BASE0 = { x: 0, y: 3 };
const BASE1 = { x: 7, y: 3 };

const config = (w0: UnitSpec[], w1: UnitSpec[]): GameConfig => ({
  seed: 3,
  board: { width: 8, height: 6 },
  warbands: [w0, w1],
  mode: 'capture-the-flag',
  objectives: { flags: [BASE0, BASE1] },
});

/** A copy of `g` with `unitId` mid-activation holding `actions` action points. */
function acting(g: GameState, unitId: string, actions = 3): GameState {
  const s = structuredClone(g);
  const u = s.units.find((x) => x.id === unitId)!;
  s.phase = 'acting';
  s.active = u.owner;
  s.activeUnitId = unitId;
  s.actionsRemaining = actions;
  u.activatedThisRound = true;
  return s;
}

function run(s: GameState, cmds: Command[]): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (const c of cmds) {
    const r = reduce(s, c);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const move = (unitId: string, x: number, y: number): Command => ({ type: 'Move', unitId, to: { x, y } });
const flagEvents = (es: GameEvent[]) => es.filter((e) => e.type.startsWith('Flag'));

describe('capture-the-flag', () => {
  it('starts with both flags at their bases, uncarried', () => {
    const g = createGame(config([U('a', 1, 1)], [U('b', 6, 1)]));
    expect(g.mode?.flags).toEqual([
      { at: BASE0, carrier: null },
      { at: BASE1, carrier: null },
    ]);
    expect(flagAtBase(g, 0)).toBe(true);
    expect(flagAtBase(g, 1)).toBe(true);
    expect(flagCarriedBy(g, 'p0u0')).toBeUndefined();
  });

  it('picks up the enemy flag by ending a move on it, and the flag follows its carrier', () => {
    const g = createGame(config([U('a', 6, 3)], [U('b', 6, 0)]));
    const { state, events } = run(acting(g, 'p0u0'), [move('p0u0', 7, 3), move('p0u0', 6, 3)]);
    expect(flagEvents(events)).toEqual([{ type: 'FlagPickedUp', player: 1, unitId: 'p0u0' }]);
    expect(flagCarriedBy(state, 'p0u0')).toBe(1);
    expect(flagAtBase(state, 1)).toBe(false);
    expect(state.mode?.flags?.[1]).toEqual({ at: { x: 6, y: 3 }, carrier: 'p0u0' });
  });

  it('only the destination counts — passing over a flag does not pick it up', () => {
    const g = createGame(config([U('a', 5, 3)], [U('b', 6, 0)]));
    const s = acting(g, 'p0u0');
    s.mode!.objectives.flags![1] = { x: 6, y: 3 };
    s.mode!.flags![1].at = { x: 6, y: 3 };
    const { state, events } = run(s, [move('p0u0', 7, 3)]);
    expect(flagEvents(events)).toEqual([]);
    expect(state.mode?.flags?.[1].carrier).toBeNull();
  });

  it('moving onto your own flag at base does nothing', () => {
    const g = createGame(config([U('a', 1, 3)], [U('b', 6, 0)]));
    const { state, events } = run(acting(g, 'p0u0'), [move('p0u0', 0, 3)]);
    expect(flagEvents(events)).toEqual([]);
    expect(flagAtBase(state, 0)).toBe(true);
  });

  it('a carrier ending a move on its own base captures and wins at once', () => {
    const g = createGame(config([U('a', 1, 3)], [U('b', 6, 0)]));
    const s = acting(g, 'p0u0');
    s.mode!.flags![1] = { at: { x: 1, y: 3 }, carrier: 'p0u0' };
    const { state, events } = run(s, [move('p0u0', 0, 3)]);
    expect(events.map((e) => e.type)).toEqual(['UnitMoved', 'FlagCaptured', 'GameOver']);
    expect(events[1]).toEqual({ type: 'FlagCaptured', player: 0, unitId: 'p0u0' });
    expect(events[2]).toEqual({ type: 'GameOver', winner: 0, reason: 'flag' });
    expect(state.phase).toBe('gameOver');
    expect(state.winner).toBe(0);
    expect(state.mode?.scores).toEqual([1, 0]);
  });

  it('captures even while its own flag is away from home', () => {
    const g = createGame(config([U('a', 1, 3)], [U('b', 2, 0)]));
    const s = acting(g, 'p0u0');
    s.mode!.flags![1] = { at: { x: 1, y: 3 }, carrier: 'p0u0' };
    s.mode!.flags![0] = { at: { x: 2, y: 0 }, carrier: 'p1u0' };
    const { state } = run(s, [move('p0u0', 0, 3)]);
    expect(state.winner).toBe(0);
  });

  it('a knocked-down or slain carrier drops the flag on its hex', () => {
    const g = createGame(config([U('a', 1, 1)], [U('b', 4, 2)]));
    const s = structuredClone(g);
    s.mode!.flags![0] = { at: { x: 4, y: 2 }, carrier: 'p1u0' };
    s.units[1]!.knockedDown = true;
    const events: GameEvent[] = [];
    dropFallenCarriers(s, events);
    expect(events).toEqual([{ type: 'FlagDropped', player: 0, unitId: 'p1u0', at: { x: 4, y: 2 } }]);
    expect(s.mode?.flags?.[0]).toEqual({ at: { x: 4, y: 2 }, carrier: null });
    // Nothing more to drop.
    dropFallenCarriers(s, events);
    expect(events).toHaveLength(1);
  });

  it('drops the flag when combat fells the carrier', () => {
    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = createGame({ ...config([U('a', 3, 2, { combat: 5 })], [U('b', 4, 2, { combat: 1 }), U('c', 7, 5)]), seed });
      const s = acting(g, 'p0u0', 1);
      s.mode!.flags![0] = { at: { x: 4, y: 2 }, carrier: 'p1u0' };
      const { state, events } = run(s, [{ type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' }]);
      const target = state.units.find((u) => u.id === 'p1u0')!;
      const drop = events.find((e) => e.type === 'FlagDropped');
      if (target.dead || target.knockedDown) {
        hits++;
        expect(drop).toEqual({ type: 'FlagDropped', player: 0, unitId: 'p1u0', at: { x: 4, y: 2 } });
        // Dropped before the activation hands over.
        expect(events.findIndex((e) => e.type === 'FlagDropped')).toBeLessThan(
          events.findIndex((e) => e.type === 'ActivationEnded'),
        );
        expect(state.mode?.flags?.[0].carrier).toBeNull();
      } else {
        expect(drop).toBeUndefined();
        expect(state.mode?.flags?.[0].carrier).toBe('p1u0');
      }
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('a friendly unit returns its own dropped flag; an enemy picks it back up', () => {
    const g = createGame(config([U('a', 3, 2)], [U('b', 5, 2)]));
    const dropped = structuredClone(g);
    dropped.mode!.flags![0] = { at: { x: 4, y: 2 }, carrier: null };

    const back = run(acting(dropped, 'p0u0'), [move('p0u0', 4, 2)]);
    expect(flagEvents(back.events)).toEqual([{ type: 'FlagReturned', player: 0, unitId: 'p0u0' }]);
    expect(flagAtBase(back.state, 0)).toBe(true);

    const again = run(acting(dropped, 'p1u0'), [move('p1u0', 4, 2)]);
    expect(flagEvents(again.events)).toEqual([{ type: 'FlagPickedUp', player: 0, unitId: 'p1u0' }]);
    expect(flagCarriedBy(again.state, 'p1u0')).toBe(0);
  });

  it('a carrier can return its own dropped flag on the way home', () => {
    const g = createGame(config([U('a', 3, 2)], [U('b', 6, 0)]));
    const s = acting(g, 'p0u0');
    s.mode!.flags![1] = { at: { x: 3, y: 2 }, carrier: 'p0u0' };
    s.mode!.flags![0] = { at: { x: 2, y: 2 }, carrier: null };
    const { state, events } = run(s, [move('p0u0', 2, 2)]);
    expect(flagEvents(events)).toEqual([{ type: 'FlagReturned', player: 0, unitId: 'p0u0' }]);
    expect(flagAtBase(state, 0)).toBe(true);
    expect(state.mode?.flags?.[1]).toEqual({ at: { x: 2, y: 2 }, carrier: 'p0u0' });
  });

  it('a downed carrier takes its dropped flag back as it stands up', () => {
    let stood = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = createGame({ ...config([U('a', 1, 1)], [U('b', 4, 2)]), seed });
      const s = structuredClone(g);
      s.phase = 'awaitingActivation';
      s.active = 1;
      s.units[1]!.knockedDown = true;
      s.mode!.flags![0] = { at: { x: 4, y: 2 }, carrier: null };
      const { state, events } = run(s, [{ type: 'ChooseActivation', unitId: 'p1u0', diceCount: 1 }]);
      if (state.units[1]!.knockedDown) {
        expect(flagEvents(events)).toEqual([]);
        continue;
      }
      stood++;
      expect(flagEvents(events)).toEqual([{ type: 'FlagPickedUp', player: 0, unitId: 'p1u0' }]);
      expect(events.findIndex((e) => e.type === 'FlagPickedUp')).toBe(
        events.findIndex((e) => e.type === 'UnitStoodUp') + 1,
      );
      expect(state.mode?.flags?.[0]).toEqual({ at: { x: 4, y: 2 }, carrier: 'p1u0' });
    }
    expect(stood).toBeGreaterThan(0);
  });

  it('a carrier pushed onto its own base captures', () => {
    let pushed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = createGame({ ...config([U('a', 3, 2)], [U('b', 4, 2), U('c', 7, 5)]), seed });
      const s = acting(g, 'p1u0', 1);
      // Put p0's base right behind its carrier, so a recoil lands on it.
      const board = makeHexGrid(s.board);
      s.mode!.objectives.flags![0] = board.stepAway({ x: 4, y: 2 }, { x: 3, y: 2 });
      s.mode!.flags![0].at = { ...s.mode!.objectives.flags![0] };
      s.mode!.flags![1] = { at: { x: 3, y: 2 }, carrier: 'p0u0' };
      const { state, events } = run(s, [{ type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' }]);
      if (!events.some((e) => e.type === 'UnitRecoiled' && e.unitId === 'p0u0')) continue;
      pushed++;
      const types = events.map((e) => e.type);
      expect(types.slice(types.indexOf('UnitRecoiled'))).toEqual(['UnitRecoiled', 'FlagCaptured', 'GameOver']);
      expect(state.winner).toBe(0);
      expect(state.mode?.scores).toEqual([1, 0]);
      expect(state.actionsRemaining).toBe(0);
    }
    expect(pushed).toBeGreaterThan(0);
  });

  it('a flyer carrying a flag is grounded until it drops it', () => {
    const g = createGame(config([U('a', 3, 2, { flying: true })], [U('b', 5, 2)]));
    const s = structuredClone(g);
    const flyer = s.units[0]!;
    const board = makeHexGrid(s.board);
    expect(airborne(s, flyer)).toBe(true);
    expect(flyingTargetBonus(s, flyer)).toBeGreaterThan(0);

    s.mode!.flags![1] = { at: { x: 3, y: 2 }, carrier: 'p0u0' };
    expect(airborne(s, flyer)).toBe(false);
    expect(walkRules(s, flyer, board).phaseThrough).toBeFalsy();
    expect(flyingTargetBonus(s, flyer)).toBe(0);

    flyer.knockedDown = true;
    dropFallenCarriers(s, []);
    flyer.knockedDown = false;
    expect(airborne(s, flyer)).toBe(true);
  });

  it('a grounded carrier takes free hacks leaving contact', () => {
    const g = createGame(config([U('a', 3, 2, { flying: true })], [U('b', 4, 2)]));
    const s = acting(g, 'p0u0');
    s.mode!.flags![1] = { at: { x: 3, y: 2 }, carrier: 'p0u0' };
    const { events } = run(s, [move('p0u0', 1, 2)]);
    expect(events[0]).toMatchObject({ type: 'FreeHackResolved', attackerId: 'p1u0', targetId: 'p0u0' });
  });
});
