import { describe, expect, it } from 'vitest';
import { createGame, reduce, type GameConfig, type GameEvent, type GameState } from '@fansong/engine';
import { commandSchema, gameConfigSchema, gameEventSchema, gameStateSchema } from '../src/schema.js';

const config: GameConfig = {
  seed: 5,
  board: { width: 14, height: 10 },
  warbands: [
    [
      { name: 'Chief', quality: 2, combat: 3, leader: true, pos: { x: 2, y: 2 } },
      { name: 'Spear', quality: 3, combat: 3, pos: { x: 2, y: 3 } },
    ],
    [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 13, y: 2 } }],
  ],
  retreatZones: [[{ x: 0, y: 2 }], []],
};

const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

/** The Leader mid-activation with actions in hand, the dice skipped. */
function acting(state: GameState): GameState {
  const s = structuredClone(state);
  s.units[0]!.activatedThisRound = true;
  return { ...s, phase: 'acting', activeUnitId: 'p0u0', actionsRemaining: 3 };
}

describe('retreat on the wire', () => {
  it('accepts the command, and nothing extra on it', () => {
    const c = { type: 'Retreat', unitId: 'p0u0' };
    expect(commandSchema.parse(c)).toEqual(c);
    expect(commandSchema.safeParse({ ...c, hex: { x: 0, y: 0 } }).success).toBe(false);
    expect(commandSchema.safeParse({ type: 'Retreat', unitId: '' }).success).toBe(false);
  });

  it('round-trips a config, every state and every event of a retreat', () => {
    expect(gameConfigSchema.parse(wire(config))).toEqual(config);
    let state = createGame(config);
    expect(gameStateSchema.parse(wire(state))).toEqual(state);
    const events: GameEvent[] = [];
    for (const command of [
      { type: 'Retreat', unitId: 'p0u0' },
      { type: 'Move', unitId: 'p0u0', to: { x: 0, y: 2 } },
    ] as const) {
      const r = reduce(acting(state), command);
      state = r.state;
      events.push(...r.events);
      expect(gameStateSchema.parse(wire(state))).toEqual(state);
    }
    expect(events.map((e) => e.type)).toEqual(['RetreatCalled', 'UnitMoved', 'UnitRetreated', 'GameOver']);
    for (const e of events) expect(gameEventSchema.parse(wire(e))).toEqual(e);
    expect(state.units[0]!.retreated).toBe(true);
    expect(gameStateSchema.safeParse({ ...state, units: [{ ...state.units[0]!, retreated: false }] }).success).toBe(false);
  });
});
