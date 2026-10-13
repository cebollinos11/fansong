import { describe, expect, it } from 'vitest';
import { createGame, DEFAULT_SURRENDER, reduce, type GameConfig, type GameEvent } from '@fansong/engine';
import { gameConfigSchema, gameEventSchema, gameStateSchema } from '../src/schema.js';

const config: GameConfig = {
  seed: 5,
  board: { width: 14, height: 10 },
  warbands: [
    [{ name: 'Spear', quality: 3, combat: 3, pos: { x: 2, y: 3 }, points: 60 }],
    [
      { name: 'Foe', quality: 3, combat: 3, pos: { x: 13, y: 2 }, points: 15 },
      { name: 'Foe', quality: 3, combat: 3, pos: { x: 13, y: 4 }, points: 45 },
    ],
  ],
  surrender: { ...DEFAULT_SURRENDER },
};

const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe('forced surrender on the wire', () => {
  it('round-trips a config, every state and the ending of a surrender', () => {
    expect(gameConfigSchema.parse(wire(config))).toEqual(config);
    let state = createGame(config);
    expect(gameStateSchema.parse(wire(state))).toEqual(state);
    expect(state.units[0]!.points).toBe(60);
    expect(state.surrender).toEqual({ ownShare: 0.3, ratio: 3, start: [60, 60] });

    state = structuredClone(state);
    state.units[2]!.dead = true;
    const events: GameEvent[] = [];
    for (let i = 0; i < 20 && state.phase !== 'gameOver'; i++) {
      const r = reduce(
        state,
        state.phase === 'acting'
          ? { type: 'EndActivation' }
          : { type: 'ChooseActivation', unitId: state.units.find((u) => u.owner === state.active && !u.dead && !u.activatedThisRound)!.id, diceCount: 1 },
      );
      state = r.state;
      events.push(...r.events);
      expect(gameStateSchema.parse(wire(state))).toEqual(state);
    }
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'surrender' });
    for (const e of events) expect(gameEventSchema.parse(wire(e))).toEqual(e);
  });

  it('rejects thresholds and costs the rule could never use', () => {
    const bad = (extra: object) => gameConfigSchema.safeParse({ ...wire(config) as object, ...extra }).success;
    expect(bad({ surrender: { ownShare: 0, ratio: 3 } })).toBe(false);
    expect(bad({ surrender: { ownShare: 0.3, ratio: 0.5 } })).toBe(false);
    expect(bad({ surrender: { ownShare: 0.3, ratio: 3, start: [1, 1] } })).toBe(false);
    expect(bad({ warbands: [[{ ...config.warbands[0][0]!, points: 0 }], config.warbands[1]] })).toBe(false);
    expect(gameStateSchema.safeParse({ ...createGame(config), surrender: { ownShare: 0.3, ratio: 3 } }).success).toBe(false);
  });
});
