import { chooseCommand } from '@fansong/ai';
import { getMap, mapToBoard, type MatchSetup } from '@fansong/content';
import { hashGameState, runReplay } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { LocalMatchClient } from '../src/game/client.js';
import { parseReplay, replayToJson } from '../src/game/replay-io.js';

// Hotseat = two human seats, so no AiDriver timer ever schedules; we can drive
// the whole game synchronously through `send` and inspect the recording.
const SETUP: MatchSetup = {
  presets: ['hollow-watch', 'free-company'],
  seats: ['human', 'human'],
  seed: 11,
};

function playOut(client: LocalMatchClient): void {
  let steps = 0;
  while (client.getState().phase !== 'gameOver' && steps < 5000) {
    client.send(chooseCommand(client.getState()));
    steps++;
  }
}

describe('LocalMatchClient replay recording', () => {
  it('records a command list that reproduces the exact final state', () => {
    const client = new LocalMatchClient(SETUP);
    playOut(client);
    const replay = client.getReplay();
    const live = client.getState();
    client.dispose();

    expect(live.phase).toBe('gameOver');
    expect(replay.commands.length).toBeGreaterThan(0);
    const run = runReplay(replay);
    expect(hashGameState(run.final)).toBe(hashGameState(live));
  });

  it('carries the chosen map in the replay config', () => {
    const client = new LocalMatchClient({ ...SETUP, mapId: 'rocky-pass' });
    playOut(client);
    const replay = client.getReplay();
    const live = client.getState();
    client.dispose();

    expect(replay.config.board).toEqual(mapToBoard(getMap('rocky-pass')!));
    const run = runReplay(parseReplay(replayToJson(replay)));
    expect(hashGameState(run.final)).toBe(hashGameState(live));
  });
});

describe('replay-io', () => {
  it('round-trips through JSON', () => {
    const client = new LocalMatchClient(SETUP);
    playOut(client);
    const replay = client.getReplay();
    client.dispose();

    const restored = parseReplay(replayToJson(replay));
    expect(restored).toEqual(replay);
    expect(hashGameState(runReplay(restored).final)).toBe(hashGameState(runReplay(replay).final));
  });

  it('rejects malformed replays', () => {
    expect(() => parseReplay('not json')).toThrow();
    expect(() => parseReplay(JSON.stringify({ version: 99, config: {}, commands: [] }))).toThrow(/version/);
    expect(() => parseReplay(JSON.stringify({ version: 2, commands: [] }))).toThrow(/config/);
    expect(() =>
      parseReplay(JSON.stringify({ version: 2, config: {}, commands: [{ type: 'Nope' }] })),
    ).toThrow(/config/);
  });

  it('rejects a config that would have the engine walk an unbounded board', () => {
    const hostile = {
      version: 2,
      config: {
        seed: 1,
        board: { width: 1_000_000, height: 1_000_000 },
        warbands: [
          [{ name: 'Runner', quality: 3, combat: 3, move: 1_000_000, pos: { x: 0, y: 0 } }],
          [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 5, y: 5 } }],
        ],
      },
      commands: [{ type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 }],
    };
    expect(() => parseReplay(JSON.stringify(hostile))).toThrow(/config/);
  });
});
