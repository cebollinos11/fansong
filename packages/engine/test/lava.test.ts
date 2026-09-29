import { describe, expect, it } from 'vitest';
import { makeHexGrid, vecKey, type HexTerrain } from '../src/board.js';
import {
  combatOdds,
  createGame,
  getLegalCommands,
  reduce,
  type CombatResult,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
} from '../src/index.js';

type Attack = Extract<GameEvent, { type: 'AttackResolved' }>;

const lava: HexTerrain = { feature: 'lava' };

/** Striker (p0u0) at 2,2 against Target (p1u0) at 3,2; a push sends Target to 4,3. */
function config(seed: number, terrain: Record<string, HexTerrain>, target: Partial<UnitSpec> = {}): GameConfig {
  return {
    seed,
    board: { width: 7, height: 5, terrain },
    warbands: [
      [{ name: 'Striker', quality: 3, combat: 4, pos: { x: 2, y: 2 } }],
      [{ name: 'Target', quality: 3, combat: 3, pos: { x: 3, y: 2 }, ...target }],
    ],
  };
}

/** Mid-activation for `p0u0`, with the RNG untouched so only the attack roll consumes it. */
function acting(c: GameConfig): GameState {
  const s = createGame(c);
  s.active = 0;
  s.activeUnitId = 'p0u0';
  s.phase = 'acting';
  s.actionsRemaining = 1;
  s.units[0]!.activatedThisRound = true;
  return s;
}

const attack = (s: GameState) => reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });

/** The first attack under `make(seed)` that resolves as `result`. */
function attackFor(make: (seed: number) => GameConfig, result: CombatResult) {
  for (let seed = 1; seed <= 500; seed++) {
    const out = attack(acting(make(seed)));
    if ((out.events.find((e) => e.type === 'AttackResolved') as Attack).result === result) return out;
  }
  throw new Error(`no seed gives ${result}`);
}

describe('lava on the board', () => {
  const board = makeHexGrid({ width: 5, height: 3, blocked: [], terrain: { '2,0': lava, '2,1': lava, '2,2': lava } });

  it('is deadly but not blocked, and does not block sight or give cover', () => {
    expect(board.isDeadly({ x: 2, y: 1 })).toBe(true);
    expect(board.isBlocked({ x: 2, y: 1 })).toBe(false);
    expect(board.isDeadly({ x: 1, y: 1 })).toBe(false);
    expect(board.lineOfSight({ x: 0, y: 1 }, { x: 4, y: 1 })).toBe(true);
    expect(board.inCover({ x: 0, y: 1 }, { x: 2, y: 1 })).toBe(false);
  });

  it('is never walked into or across, but a phasing flyer crosses it', () => {
    const walk = board.reachableWithin({ x: 0, y: 1 }, 6);
    expect(walk.has('2,1')).toBe(false);
    expect(walk.has('4,1')).toBe(false); // a wall of lava cuts the board in two
    const fly = board.reachableWithin({ x: 0, y: 1 }, 6, { phaseThrough: true });
    expect(fly.has('2,1')).toBe(true);
    expect(fly.has('4,1')).toBe(true);
  });
});

describe('moving onto lava', () => {
  const game = (flying: boolean) => {
    const s = createGame({
      seed: 1,
      board: { width: 6, height: 5, terrain: { '1,2': lava } },
      warbands: [
        [{ name: 'Mover', quality: 3, combat: 3, pos: { x: 0, y: 2 }, flying }],
        [{ name: 'Far', quality: 3, combat: 3, pos: { x: 5, y: 4 } }],
      ],
    });
    s.active = 0;
    s.activeUnitId = 'p0u0';
    s.phase = 'acting';
    s.actionsRemaining = 1;
    return s;
  };
  const movesTo = (s: GameState) =>
    getLegalCommands(s).flatMap((c) => (c.type === 'Move' ? [vecKey(c.to)] : []));

  it('a unit on foot cannot move there', () => {
    expect(movesTo(game(false))).not.toContain('1,2');
    expect(() => reduce(game(false), { type: 'Move', unitId: 'p0u0', to: { x: 1, y: 2 } })).toThrow();
  });

  it('a flyer can land on it', () => {
    expect(movesTo(game(true))).toContain('1,2');
    const { state } = reduce(game(true), { type: 'Move', unitId: 'p0u0', to: { x: 1, y: 2 } });
    expect(state.units[0]!.pos).toEqual({ x: 1, y: 2 });
  });
});

describe('pushed into lava', () => {
  it('kills a unit on foot, credited to the pusher; it keeps its last position', () => {
    const { state, events } = attackFor((seed) => config(seed, { '4,3': lava }), 'defenderRecoiled');
    const target = state.units[1]!;
    expect(target.dead).toBe(true);
    expect(target.pos).toEqual({ x: 3, y: 2 });
    expect(events).toContainEqual({ type: 'UnitPushedIntoLava', unitId: 'p1u0', to: { x: 4, y: 3 } });
    expect(events).toContainEqual({ type: 'UnitKilled', unitId: 'p1u0', byId: 'p0u0' });
  });

  it('kills a Tough unit too: no save', () => {
    const { state, events } = attackFor((seed) => config(seed, { '4,3': lava }, { tough: true }), 'defenderRecoiled');
    expect(state.units[1]!.dead).toBe(true);
    expect(events.some((e) => e.type === 'ToughnessSaved')).toBe(false);
  });

  it('is gruesome when a Savage does the shoving', () => {
    const make = (seed: number) => {
      const c = config(seed, { '4,3': lava });
      c.warbands[0][0]!.savage = true;
      return c;
    };
    const { events } = attackFor(make, 'defenderRecoiled');
    expect((events.find((e) => e.type === 'AttackResolved') as Attack).gruesome).toBe(true);
  });

  it('a standing friend on the lava (a flyer) braces the pushed unit instead', () => {
    const make = (seed: number) => {
      const c = config(seed, { '4,3': lava });
      c.warbands[1].push({ name: 'Wing', quality: 3, combat: 3, pos: { x: 4, y: 3 }, flying: true });
      return c;
    };
    const { state, events } = attackFor(make, 'defenderRecoiled');
    expect(state.units.find((u) => u.id === 'p1u0')!.dead).toBe(false);
    expect(events).toContainEqual({ type: 'UnitSupported', unitId: 'p1u0', supporterId: 'p1u1' });
  });

  it('an airborne flyer is simply pushed over it, alive', () => {
    const { state, events } = attackFor((seed) => config(seed, { '4,3': lava }, { flying: true }), 'defenderRecoiled');
    const target = state.units[1]!;
    expect(target.dead).toBe(false);
    expect(target.pos).toEqual({ x: 4, y: 3 });
    expect(events.some((e) => e.type === 'UnitPushedIntoLava')).toBe(false);
  });
});

describe('a flyer over lava', () => {
  const overLava = (seed: number, extra: Partial<UnitSpec> = {}) =>
    config(seed, { '3,2': lava }, { flying: true, ...extra });

  it('can be attacked in melee from the hex beside it', () => {
    const cmds = getLegalCommands(acting(overLava(1)));
    expect(cmds).toContainEqual({ type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
  });

  it('falls in and dies when knocked down', () => {
    const { state, events } = attackFor((seed) => overLava(seed), 'defenderKnockedDown');
    expect(state.units[1]!.dead).toBe(true);
    expect(events.some((e) => e.type === 'UnitKnockedDown')).toBe(false);
    expect(events).toContainEqual({ type: 'UnitFellIntoLava', unitId: 'p1u0' });
    expect(events).toContainEqual({ type: 'UnitKilled', unitId: 'p1u0', byId: 'p0u0' });
  });

  it('gets no Tough save against a killing blow: knocked down there is death anyway', () => {
    const { state, events } = attackFor((seed) => overLava(seed, { tough: true }), 'defenderKilled');
    expect(state.units[1]!.dead).toBe(true);
    expect(events.some((e) => e.type === 'ToughnessSaved' || e.type === 'UnitFellIntoLava')).toBe(false);
  });

  it('a Tough flyer knocked down over lava dies all the same', () => {
    const { state } = attackFor((seed) => overLava(seed, { tough: true }), 'defenderKnockedDown');
    expect(state.units[1]!.dead).toBe(true);
  });

  it('is gruesome when a Savage knocks it in, in the event as in the morale', () => {
    const make = (seed: number) => {
      const c = overLava(seed);
      c.warbands[0][0]!.savage = true;
      return c;
    };
    const { events } = attackFor(make, 'defenderKnockedDown');
    expect((events.find((e) => e.type === 'AttackResolved') as Attack).gruesome).toBe(true);
    expect(events).toContainEqual({ type: 'UnitFellIntoLava', unitId: 'p1u0' });
  });

  it('is not gruesome when knocked in by anyone else', () => {
    const { events } = attackFor((seed) => overLava(seed), 'defenderKnockedDown');
    expect((events.find((e) => e.type === 'AttackResolved') as Attack).gruesome).toBeUndefined();
  });

  it('attacking out of the lava and being knocked down there kills the attacker', () => {
    const make = (seed: number) => {
      const c = config(seed, { '2,2': lava });
      c.warbands[0][0]!.flying = true;
      c.warbands[0][0]!.combat = 2;
      c.warbands[1][0]!.combat = 5;
      return c;
    };
    const { state, events } = attackFor(make, 'attackerKnockedDown');
    expect(state.units[0]!.dead).toBe(true);
    expect(events).toContainEqual({ type: 'UnitFellIntoLava', unitId: 'p0u0' });
    expect(events).toContainEqual({ type: 'UnitKilled', unitId: 'p0u0', byId: 'p1u0' });
  });
});

describe('odds with lava', () => {
  it('count a push into lava, and a flyer knocked down over it, as kills', () => {
    const plain = combatOdds(acting(config(1, {})), 'p0u0', 'p1u0');
    const backed = combatOdds(acting(config(1, { '4,3': lava })), 'p0u0', 'p1u0');
    expect(backed.win).toBeCloseTo(plain.win);
    expect(backed.kill).toBeGreaterThan(plain.kill);
    const hovering = combatOdds(acting(config(1, { '3,2': lava }, { flying: true })), 'p0u0', 'p1u0');
    const flying = combatOdds(acting(config(1, {}, { flying: true })), 'p0u0', 'p1u0');
    expect(hovering.kill).toBeGreaterThan(flying.kill);
  });

  it('count a flyer over lava with no room to be pushed as dead on any win: it falls in', () => {
    const c = config(1, { '3,2': lava }, { flying: true });
    c.warbands[0].push({ name: 'Wall', quality: 3, combat: 3, pos: { x: 4, y: 3 } });
    const odds = combatOdds(acting(c), 'p0u0', 'p1u0');
    expect(odds.win).toBeGreaterThan(0);
    expect(odds.kill).toBeCloseTo(odds.win);
  });
});
