import { describe, expect, it } from 'vitest';
import {
  createGame,
  livingCount,
  makeHexGrid,
  resolveCombatMorale,
  MORALE_RADIUS,
  type FreeHacks,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Unit,
} from '../src/index.js';

function unit(s: GameState, id: string): Unit {
  return s.units.find((u) => u.id === id)!;
}

/** Morale checks are computed against the board (adjacency/radius). */
function boardOf(s: GameState) {
  return makeHexGrid(s.board);
}

function nerveTargets(events: GameEvent[]): string[] {
  return events.filter((e) => e.type === 'NerveCheck').map((e) => (e as { unitId: string }).unitId).sort();
}

// --- Fear ---------------------------------------------------------------------

describe('fear (nearby-casualty nerve check)', () => {
  // P0 clustered around a casualty; one friend sits outside the radius. A lone
  // P1 unit far away keeps the game two-sided.
  const config: GameConfig = {
    seed: 3,
    board: { width: 14, height: 14 },
    warbands: [
      [
        { name: 'Victim', quality: 4, combat: 3, pos: { x: 5, y: 5 } },
        { name: 'Near1', quality: 4, combat: 3, pos: { x: 5, y: 4 } }, // hex dist 1
        { name: 'Near2', quality: 4, combat: 3, pos: { x: 5, y: 1 } }, // hex dist 4 = radius
        { name: 'Far', quality: 4, combat: 3, pos: { x: 5, y: 10 } }, // hex dist 5 > radius
      ],
      [{ name: 'Enemy', quality: 3, combat: 3, pos: { x: 13, y: 13 } }],
    ],
  };

  it('tests exactly the living friends within the morale radius', () => {
    const s = createGame(config);
    unit(s, 'p0u0').dead = true; // the casualty
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), true);
    expect(nerveTargets(events)).toEqual(['p0u1', 'p0u2']); // Near1, Near2 — not Far, not the victim
  });

  it('a failed nerve check sends the friend running, never down', () => {
    const s = createGame(config);
    unit(s, 'p0u0').dead = true;
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), true);
    expect(events.some((e) => e.type === 'NerveCheck' && !e.passed)).toBe(true);
    for (const e of events) {
      if (e.type === 'NerveCheck' && !e.passed) {
        expect(unit(s, e.unitId).knockedDown).toBe(false);
        expect(events.some((x) => x.type === 'UnitFled' && x.unitId === e.unitId)).toBe(true);
      }
    }
    expect(events.some((e) => e.type === 'UnitKnockedDown')).toBe(false);
  });

  it('skips friends that are already knocked down', () => {
    const s = createGame(config);
    unit(s, 'p0u0').dead = true;
    unit(s, 'p0u1').knockedDown = true; // Near1 already down
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), true);
    expect(nerveTargets(events)).toEqual(['p0u2']);
  });

  it('an ordinary (non-gruesome) kill shakes no one', () => {
    const s = createGame(config);
    unit(s, 'p0u0').dead = true;
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), false);
    expect(nerveTargets(events)).toEqual([]);
  });

  it('MORALE_RADIUS is the published hex reach', () => {
    expect(MORALE_RADIUS).toBe(4);
  });
});

// --- Rout ---------------------------------------------------------------------

describe('rout (warband collapse)', () => {
  function bigConfig(): GameConfig {
    return {
      seed: 9,
      board: { width: 14, height: 14 },
      warbands: [
        Array.from({ length: 6 }, (_, i) => ({
          name: `Grunt${i}`,
          quality: 4,
          combat: 3,
          pos: { x: i, y: 0 },
        })),
        [{ name: 'Enemy', quality: 3, combat: 3, pos: { x: 13, y: 13 } }],
      ],
    };
  }

  it('breaks when the warband hits a third of its starting size, and tests every survivor', () => {
    const s = createGame(bigConfig());
    expect(s.startCount[0]).toBe(6);
    // Knock the warband down to 2 living (threshold = floor(6/3) = 2).
    for (const id of ['p0u0', 'p0u1', 'p0u2', 'p0u3']) unit(s, id).dead = true;
    expect(livingCount(s, 0)).toBe(2);

    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), false);

    expect(events.some((e) => e.type === 'WarbandBroken' && e.player === 0)).toBe(true);
    expect(s.broken[0]).toBe(true);
    // Both survivors were tested; each failure ran for its edge, still in the game.
    expect(nerveTargets(events)).toEqual(['p0u4', 'p0u5']);
    expect(events.some((e) => e.type === 'NerveCheck' && !e.passed)).toBe(true);
    for (const e of events) {
      if (e.type === 'NerveCheck' && !e.passed) {
        expect(unit(s, e.unitId).dead).toBe(false);
        expect(unit(s, e.unitId).pos.x).toBe(0);
        expect(events.some((x) => x.type === 'UnitFled' && x.unitId === e.unitId)).toBe(true);
      }
    }
  });

  it('breaks only once', () => {
    const s = createGame(bigConfig());
    for (const id of ['p0u0', 'p0u1', 'p0u2', 'p0u3']) unit(s, id).dead = true;
    const first: GameEvent[] = [];
    resolveCombatMorale(s, first, unit(s, 'p0u0'), boardOf(s), false);
    expect(first.some((e) => e.type === 'WarbandBroken')).toBe(true);

    const second: GameEvent[] = [];
    resolveCombatMorale(s, second, unit(s, 'p0u0'), boardOf(s), false);
    expect(second.some((e) => e.type === 'WarbandBroken')).toBe(false);
  });

  it('does not break while above the threshold', () => {
    const s = createGame(bigConfig());
    for (const id of ['p0u0', 'p0u1', 'p0u2']) unit(s, id).dead = true; // 3 living > 2
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), false);
    expect(events.some((e) => e.type === 'WarbandBroken')).toBe(false);
    expect(s.broken[0]).toBe(false);
  });
});

// --- Flight -------------------------------------------------------------------

describe('flight (a failed nerve check)', () => {
  /**
   * One P0 casualty at (6,5) beside a friend that always fails its check
   * (Quality 7 needs more than a d6), and P1 foes placed as each test needs.
   */
  function flightGame(friend: { x: number; y: number }, foes: { x: number; y: number }[]) {
    const s = createGame({
      seed: 5,
      board: { width: 12, height: 10 },
      warbands: [
        [
          { name: 'Victim', quality: 4, combat: 3, pos: { x: 6, y: 5 } },
          { name: 'Coward', quality: 7, combat: 3, pos: friend },
        ],
        foes.map((pos, i) => ({ name: `Foe${i}`, quality: 3, combat: 3, pos })),
      ],
    });
    unit(s, 'p0u0').dead = true;
    return s;
  }

  function fled(events: GameEvent[]) {
    return events.filter((e): e is Extract<GameEvent, { type: 'UnitFled' }> => e.type === 'UnitFled');
  }

  it('runs to the nearest free hex on its own edge, by the shortest way', () => {
    const s = flightGame({ x: 6, y: 4 }, [{ x: 11, y: 9 }]);
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), true);
    const [run] = fled(events);
    expect(run).toMatchObject({ unitId: 'p0u1', from: { x: 6, y: 4 } });
    expect(run!.to.x).toBe(0);
    expect(run!.path).toHaveLength(7); // six columns away: six steps
    expect(unit(s, 'p0u1').pos).toEqual(run!.to);
    expect(unit(s, 'p0u1').knockedDown).toBe(false);
  });

  it('player 1 runs for the right-hand edge', () => {
    const s = createGame({
      seed: 5,
      board: { width: 12, height: 10 },
      warbands: [
        [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 0, y: 0 } }],
        [
          { name: 'Victim', quality: 4, combat: 3, pos: { x: 6, y: 5 } },
          { name: 'Coward', quality: 7, combat: 3, pos: { x: 6, y: 4 } },
        ],
      ],
    });
    unit(s, 'p1u0').dead = true;
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p1u0'), boardOf(s), true);
    expect(unit(s, 'p1u1').pos.x).toBe(11);
  });

  it('already on its own edge, it leaves the field', () => {
    const s = flightGame({ x: 0, y: 5 }, [{ x: 11, y: 9 }]);
    unit(s, 'p0u0').pos = { x: 1, y: 5 }; // fell within reach of the edge
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), true);
    expect(unit(s, 'p0u1').dead).toBe(true);
    expect(events).toContainEqual({ type: 'UnitRouted', unitId: 'p0u1' });
    expect(fled(events)).toEqual([]);
  });

  it('takes the free hacks of the foes it turns from before it moves', () => {
    const s = flightGame({ x: 6, y: 4 }, [{ x: 7, y: 4 }]);
    const runners: string[] = [];
    const hacks: FreeHacks = (u) => {
      runners.push(u.id);
      expect(u.pos).toEqual({ x: 6, y: 4 }); // struck where it stands
      return true;
    };
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), true, hacks);
    expect(runners).toEqual(['p0u1']);
    expect(unit(s, 'p0u1').pos.x).toBe(0);
  });

  it('a hack that floors or kills the runner stops it where it stands', () => {
    const s = flightGame({ x: 6, y: 4 }, [{ x: 7, y: 4 }]);
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), true, () => false);
    expect(unit(s, 'p0u1').pos).toEqual({ x: 6, y: 4 });
    expect(fled(events)).toEqual([]);
  });

  it('gives foes a wide berth, never passing next to one', () => {
    // A foe squarely in the way at (3,4): the runner goes round it.
    const s = flightGame({ x: 6, y: 4 }, [{ x: 3, y: 4 }]);
    const board = boardOf(s);
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), board, true);
    const [run] = fled(events);
    expect(run!.to.x).toBe(0);
    for (const hex of run!.path.slice(1)) expect(board.distance(hex, { x: 3, y: 4 })).toBeGreaterThan(1);
  });

  it('hemmed in with nowhere nearer its edge to go, it holds where it is', () => {
    // Foes all round it at two hexes: every neighbour touches one.
    const s = flightGame({ x: 6, y: 4 }, [
      { x: 4, y: 3 },
      { x: 4, y: 5 },
      { x: 6, y: 2 },
      { x: 6, y: 6 },
      { x: 8, y: 3 },
      { x: 8, y: 5 },
    ]);
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), true);
    expect(unit(s, 'p0u1').pos).toEqual({ x: 6, y: 4 });
    expect(unit(s, 'p0u1').dead).toBe(false);
    expect(fled(events)).toEqual([]);
  });

  it('a knocked-down unit caught in a rout scrambles up and runs', () => {
    const s = createGame({
      seed: 5,
      board: { width: 12, height: 10 },
      warbands: [
        [
          { name: 'Victim', quality: 4, combat: 3, pos: { x: 6, y: 5 } },
          { name: 'Gone', quality: 4, combat: 3, pos: { x: 6, y: 7 } },
          { name: 'Coward', quality: 7, combat: 3, pos: { x: 6, y: 4 } },
        ],
        [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 11, y: 9 } }],
      ],
    });
    unit(s, 'p0u0').dead = true;
    unit(s, 'p0u1').dead = true; // 1 of 3 left: the warband breaks
    unit(s, 'p0u2').knockedDown = true;
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s), false);
    expect(events).toContainEqual({ type: 'UnitStoodUp', unitId: 'p0u2' });
    expect(unit(s, 'p0u2').knockedDown).toBe(false);
    expect(unit(s, 'p0u2').pos.x).toBe(0);
  });
});
