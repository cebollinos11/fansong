import { describe, expect, it } from 'vitest';
import {
  createGame,
  livingCount,
  makeHexGrid,
  resolveCombatMorale,
  MORALE_RADIUS,
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
        { name: 'Near2', quality: 4, combat: 3, pos: { x: 5, y: 3 } }, // hex dist 2
        { name: 'Far', quality: 4, combat: 3, pos: { x: 5, y: 9 } }, // hex dist 4 > radius
      ],
      [{ name: 'Enemy', quality: 3, combat: 3, pos: { x: 13, y: 13 } }],
    ],
  };

  it('tests exactly the living friends within the morale radius', () => {
    const s = createGame(config);
    unit(s, 'p0u0').dead = true; // the casualty
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s));
    expect(nerveTargets(events)).toEqual(['p0u1', 'p0u2']); // Near1, Near2 — not Far, not the victim
  });

  it('a failed nerve check knocks the friend down', () => {
    const s = createGame(config);
    unit(s, 'p0u0').dead = true;
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s));
    for (const e of events) {
      if (e.type === 'NerveCheck' && !e.passed) {
        expect(unit(s, e.unitId).knockedDown).toBe(true);
      }
    }
  });

  it('skips friends that are already knocked down', () => {
    const s = createGame(config);
    unit(s, 'p0u0').dead = true;
    unit(s, 'p0u1').knockedDown = true; // Near1 already down
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s));
    expect(nerveTargets(events)).toEqual(['p0u2']);
  });

  it('MORALE_RADIUS is the published hex reach', () => {
    expect(MORALE_RADIUS).toBe(2);
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
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s));

    expect(events.some((e) => e.type === 'WarbandBroken' && e.player === 0)).toBe(true);
    expect(s.broken[0]).toBe(true);
    // Both survivors were tested; each failure routed and is now dead.
    expect(nerveTargets(events)).toEqual(['p0u4', 'p0u5']);
    for (const e of events) {
      if (e.type === 'NerveCheck' && !e.passed) {
        expect(unit(s, e.unitId).dead).toBe(true);
        expect(events.some((x) => x.type === 'UnitRouted' && x.unitId === e.unitId)).toBe(true);
      }
    }
  });

  it('breaks only once', () => {
    const s = createGame(bigConfig());
    for (const id of ['p0u0', 'p0u1', 'p0u2', 'p0u3']) unit(s, id).dead = true;
    const first: GameEvent[] = [];
    resolveCombatMorale(s, first, unit(s, 'p0u0'), boardOf(s));
    expect(first.some((e) => e.type === 'WarbandBroken')).toBe(true);

    const second: GameEvent[] = [];
    resolveCombatMorale(s, second, unit(s, 'p0u0'), boardOf(s));
    expect(second.some((e) => e.type === 'WarbandBroken')).toBe(false);
  });

  it('does not break while above the threshold', () => {
    const s = createGame(bigConfig());
    for (const id of ['p0u0', 'p0u1', 'p0u2']) unit(s, id).dead = true; // 3 living > 2
    const events: GameEvent[] = [];
    resolveCombatMorale(s, events, unit(s, 'p0u0'), boardOf(s));
    expect(events.some((e) => e.type === 'WarbandBroken')).toBe(false);
    expect(s.broken[0]).toBe(false);
  });
});
