import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createGame,
  getLegalCommands,
  hashGameState,
  makeSquareGrid,
  reduce,
  recordReplay,
  runReplay,
  type Command,
  type GameConfig,
  type GameState,
  type Replay,
} from '../src/index.js';

const goldenPath = fileURLToPath(new URL('./fixtures/golden-replay.json', import.meta.url));
const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as { replay: Replay; finalHash: string };

// A tiny deterministic duel used for the pure-mechanics assertions.
const duel: GameConfig = {
  seed: 7,
  board: { width: 5, height: 3 },
  warbands: [
    [{ name: 'A', quality: 3, combat: 4, pos: { x: 0, y: 1 } }],
    [{ name: 'B', quality: 3, combat: 3, pos: { x: 4, y: 1 } }],
  ],
};

/**
 * A tiny greedy chooser used only by these tests — engine-only (no AI package),
 * deterministic, and guaranteed to close and fight so the duel terminates:
 * attack if able, else step toward the nearest enemy, else activate, else end.
 */
function greedy(state: GameState): Command {
  const legal = getLegalCommands(state);
  const board = makeSquareGrid(state.board);
  const attack = legal.find((c) => c.type === 'Attack');
  if (attack) return attack;
  const enemies = state.units.filter((u) => !u.dead && u.owner !== state.active);
  const moves = legal.filter((c): c is Extract<Command, { type: 'Move' }> => c.type === 'Move');
  if (moves.length > 0) {
    let best = moves[0]!;
    let bestDist = Infinity;
    for (const m of moves) {
      const d = Math.min(...enemies.map((e) => board.distance(m.to, e.pos)));
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
    return best;
  }
  const activate = legal.find((c) => c.type === 'ChooseActivation');
  return activate ?? legal[0]!;
}

function scriptedDuel(): Replay {
  return recordReplay(duel, greedy, 500);
}

describe('runReplay', () => {
  it('reproduces a frame per command plus the initial frame', () => {
    const replay = scriptedDuel();
    const run = runReplay(replay);
    expect(run.frames).toHaveLength(replay.commands.length);
    expect(run.events).toHaveLength(replay.commands.length);
    // The initial frame is the untouched fresh game.
    expect(hashGameState(run.initial)).toBe(hashGameState(createGame(duel)));
    // The final frame is the last command's state.
    expect(run.final).toBe(run.frames[run.frames.length - 1]);
  });

  it('is deterministic — the same replay yields the same final hash every run', () => {
    const replay = scriptedDuel();
    expect(hashGameState(runReplay(replay).final)).toBe(hashGameState(runReplay(replay).final));
  });

  it('matches applying the same commands by hand through reduce', () => {
    const replay = scriptedDuel();
    let state = createGame(replay.config);
    for (const c of replay.commands) state = reduce(state, c).state;
    expect(hashGameState(runReplay(replay).final)).toBe(hashGameState(state));
  });

  it('handles an empty replay (final === initial)', () => {
    const run = runReplay({ version: 1, config: duel, commands: [] });
    expect(run.frames).toHaveLength(0);
    expect(run.final).toBe(run.initial);
  });
});

describe('hashGameState', () => {
  it('changes when any field of the state changes', () => {
    const state = createGame(duel);
    const moved = structuredClone(state);
    moved.units[0]!.pos = { x: 2, y: 1 };
    expect(hashGameState(moved)).not.toBe(hashGameState(state));
  });
});

describe('golden replay', () => {
  it('reproduces the pinned final state (guards against accidental rule changes)', () => {
    const run = runReplay(golden.replay);
    expect(hashGameState(run.final)).toBe(golden.finalHash);
  });

  it('runs to a decisive finish', () => {
    const run = runReplay(golden.replay);
    expect(run.final.phase).toBe('gameOver');
    expect(run.final.winner).not.toBeNull();
  });
});
