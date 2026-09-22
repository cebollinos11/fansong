import { describe, expect, it } from 'vitest';
import { createDemoGame, createGame, getLegalCommands, reduce, type Command } from '@fansong/engine';
import {
  boardDataSchema,
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

describe('boardDataSchema terrain', () => {
  const terrainGame = () =>
    createGame({
      seed: 5,
      board: {
        width: 6,
        height: 5,
        terrain: {
          '1,1': { elevation: 2 },
          '2,2': { elevation: 1, feature: 'forest' },
          '3,3': { feature: 'rock' },
          '4,1': { feature: 'building', elevation: 3 },
        },
      },
      warbands: [
        [{ name: 'A', quality: 3, combat: 3, pos: { x: 0, y: 0 } }],
        [{ name: 'B', quality: 3, combat: 3, pos: { x: 5, y: 4 } }],
      ],
    });

  it('round-trips a state whose board has terrain', () => {
    const state = terrainGame();
    expect(state.board.terrain).toBeDefined();
    const wire = JSON.parse(JSON.stringify(state)) as unknown;
    expect(gameStateSchema.parse(wire)).toEqual(state);
  });

  it('keeps a flat board free of a terrain key', () => {
    const parsed = gameStateSchema.parse(JSON.parse(JSON.stringify(createDemoGame(1))));
    expect('terrain' in parsed.board).toBe(false);
  });

  it('rejects malformed terrain', () => {
    const board = { width: 4, height: 4, blocked: [] as string[] };
    const bad = [
      { '1,1': { elevation: 4 } },
      { '1,1': { elevation: -1 } },
      { '1,1': { elevation: 1.5 } },
      { '1,1': { feature: 'lava' } },
      { '1,1': { elevation: 1, extra: true } },
      { 'a,b': { elevation: 1 } },
    ];
    for (const terrain of bad) expect(boardDataSchema.safeParse({ ...board, terrain }).success).toBe(false);
    expect(boardDataSchema.safeParse({ ...board, terrain: { '0,3': { feature: 'forest' } } }).success).toBe(true);
  });
});

describe('mode state', () => {
  const modeGame = () =>
    createGame({
      seed: 5,
      board: { width: 6, height: 5 },
      warbands: [
        [{ name: 'A', quality: 3, combat: 3, pos: { x: 0, y: 0 } }],
        [{ name: 'B', quality: 3, combat: 3, pos: { x: 5, y: 4 } }],
      ],
      mode: 'conquest',
      objectives: { conquest: [[{ x: 1, y: 1 }], [{ x: 2, y: 2 }, { x: 3, y: 2 }], [{ x: 4, y: 3 }]] },
    });

  it('round-trips a state carrying mode state', () => {
    const state = modeGame();
    expect(state.mode).toBeDefined();
    expect(gameStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('round-trips kill-the-king state with its Kings', () => {
    const state = createGame({
      seed: 5,
      board: { width: 6, height: 5 },
      warbands: [
        [{ name: 'A', quality: 3, combat: 3, pos: { x: 0, y: 0 }, king: true }],
        [{ name: 'B', quality: 3, combat: 3, pos: { x: 5, y: 4 }, king: true }],
      ],
      mode: 'kill-the-king',
    });
    expect(state.mode?.kings).toEqual(['p0u0', 'p1u0']);
    expect(gameStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(gameStateSchema.safeParse({ ...state, mode: { ...state.mode, kings: ['p0u0'] } }).success).toBe(false);
  });

  it('rejects annihilation or malformed scores as mode state', () => {
    const state = modeGame();
    const bad = [
      { ...state.mode, mode: 'annihilation' },
      { ...state.mode, scores: [0] },
      { ...state.mode, objectives: { hill: [{ x: 0.5, y: 0 }] } },
    ];
    for (const mode of bad) expect(gameStateSchema.safeParse({ ...state, mode }).success).toBe(false);
  });

  it('accepts the score and reasoned game-over events', () => {
    expect(gameEventSchema.safeParse({ type: 'ScoreChanged', player: 1, points: 2, scores: [0, 2] }).success).toBe(true);
    expect(gameEventSchema.safeParse({ type: 'GameOver', winner: 0, reason: 'roundLimit' }).success).toBe(true);
    expect(gameEventSchema.safeParse({ type: 'GameOver', winner: 0, reason: 'bored' }).success).toBe(false);
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

  it('accepts an optional map id and rejects an empty or non-string one', () => {
    const base = { presets: ['a', 'b'], seats: ['human', 'ai'], seed: 1 };
    const ok = matchSetupSchema.safeParse({ ...base, mapId: 'rocky-pass' });
    expect(ok.success && ok.data.mapId).toBe('rocky-pass');
    expect(matchSetupSchema.safeParse({ ...base, mapId: '' }).success).toBe(false);
    expect(matchSetupSchema.safeParse({ ...base, mapId: 3 }).success).toBe(false);
  });
});
