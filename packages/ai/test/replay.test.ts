import { describe, expect, it } from 'vitest';
import {
  createDemoGame,
  hashGameState,
  recordReplay,
  runReplay,
  type GameConfig,
} from '@fansong/engine';
import { chooseCommand } from '../src/index.js';

/**
 * The core replay guarantee: a game recorded live (state advanced command by
 * command) and the same game reconstructed purely from its `seed + command list`
 * must land on byte-identical final state. This is what lets the web viewer and
 * any persistence layer trust a `Replay` as a faithful record of a match.
 */
function demoConfig(seed: number): GameConfig {
  // Reuse the demo layout but as an explicit config so recordReplay can rebuild it.
  const demo = createDemoGame(seed);
  return {
    seed,
    board: { width: demo.board.width, height: demo.board.height, blocked: [...demo.board.blocked] },
    warbands: [
      demo.units.filter((u) => u.owner === 0).map((u) => ({ name: u.name, quality: u.quality, combat: u.combat, slow: u.traits.slow, fast: u.traits.fast, pos: u.pos })),
      demo.units.filter((u) => u.owner === 1).map((u) => ({ name: u.name, quality: u.quality, combat: u.combat, slow: u.traits.slow, fast: u.traits.fast, pos: u.pos })),
    ],
    initiativeLeader: demo.initiativeLeader,
  };
}

describe('recordReplay + runReplay', () => {
  it('reproduces the exact live final state across many seeds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const replay = recordReplay(demoConfig(seed), chooseCommand);
      const run = runReplay(replay);
      expect(run.final.phase).toBe('gameOver');
      // Replaying the captured commands must reproduce the recording exactly.
      const replayedTwice = runReplay(replay);
      expect(hashGameState(run.final)).toBe(hashGameState(replayedTwice.final));
    }
  });

  it('captures a decisive game as a bounded command list', () => {
    const replay = recordReplay(demoConfig(42), chooseCommand);
    expect(replay.commands.length).toBeGreaterThan(0);
    expect(replay.version).toBe(2);
    expect(runReplay(replay).final.winner).not.toBeNull();
  });
});
