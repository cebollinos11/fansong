import { describe, expect, it } from 'vitest';
import { createDemoGame, getLegalCommands, reduce, type Command } from '@fansong/engine';
import {
  commandSchema,
  gameEventSchema,
  gameStateSchema,
  matchSetupSchema,
} from '../src/schema.js';

describe('commandSchema', () => {
  it('accepts each legal command shape', () => {
    const cmds: Command[] = [
      { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 },
      { type: 'Move', unitId: 'p0u0', to: { x: 1, y: 2 } },
      { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' },
      { type: 'EndActivation' },
    ];
    for (const c of cmds) expect(commandSchema.parse(c)).toEqual(c);
  });

  it('rejects an out-of-range dice count (the untrusted trust boundary)', () => {
    expect(commandSchema.safeParse({ type: 'ChooseActivation', unitId: 'x', diceCount: 4 }).success).toBe(false);
    expect(commandSchema.safeParse({ type: 'ChooseActivation', unitId: 'x', diceCount: 0 }).success).toBe(false);
  });

  it('rejects unknown types and extra keys', () => {
    expect(commandSchema.safeParse({ type: 'Teleport', unitId: 'x' }).success).toBe(false);
    expect(
      commandSchema.safeParse({ type: 'EndActivation', sneaky: true }).success,
    ).toBe(false);
  });

  it('rejects a non-integer coordinate', () => {
    expect(commandSchema.safeParse({ type: 'Move', unitId: 'x', to: { x: 1.5, y: 0 } }).success).toBe(false);
  });

  it('accepts every command the engine itself enumerates as legal', () => {
    // Whatever getLegalCommands emits must pass the wire schema, or a real move
    // could be rejected at the boundary.
    let state = createDemoGame(7);
    for (let i = 0; i < 40 && state.phase !== 'gameOver'; i++) {
      const legal = getLegalCommands(state);
      for (const c of legal) expect(commandSchema.safeParse(c).success).toBe(true);
      state = reduce(state, legal[0]!).state;
    }
  });
});

describe('gameStateSchema', () => {
  it('round-trips a real engine state through JSON', () => {
    const state = createDemoGame(42);
    const wire = JSON.parse(JSON.stringify(state)) as unknown;
    expect(gameStateSchema.parse(wire)).toEqual(state);
  });

  it('round-trips a mid-game state', () => {
    let state = createDemoGame(3);
    for (let i = 0; i < 10 && state.phase !== 'gameOver'; i++) {
      state = reduce(state, getLegalCommands(state)[0]!).state;
    }
    const wire = JSON.parse(JSON.stringify(state)) as unknown;
    expect(gameStateSchema.parse(wire)).toEqual(state);
  });
});

describe('gameEventSchema', () => {
  it('accepts every event the engine actually produces over a game', () => {
    let state = createDemoGame(11);
    for (let i = 0; i < 60 && state.phase !== 'gameOver'; i++) {
      const { state: next, events } = reduce(state, getLegalCommands(state)[0]!);
      for (const e of events) expect(gameEventSchema.safeParse(e).success).toBe(true);
      state = next;
    }
  });
});

describe('matchSetupSchema', () => {
  it('accepts a well-formed setup and rejects a bad seat', () => {
    expect(
      matchSetupSchema.safeParse({ presets: ['a', 'b'], seats: ['human', 'ai'], seed: 1 }).success,
    ).toBe(true);
    expect(
      matchSetupSchema.safeParse({ presets: ['a', 'b'], seats: ['human', 'wizard'], seed: 1 }).success,
    ).toBe(false);
  });
});
