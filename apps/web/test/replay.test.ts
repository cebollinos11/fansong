import { chooseCommand } from '@fansong/ai';
import type { MatchSetup } from '@fansong/content';
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
    expect(() => parseReplay(JSON.stringify({ version: 2, config: {}, commands: [] }))).toThrow(/version/);
    expect(() => parseReplay(JSON.stringify({ version: 1, commands: [] }))).toThrow(/config/);
    expect(() =>
      parseReplay(JSON.stringify({ version: 1, config: {}, commands: [{ type: 'Nope' }] })),
    ).toThrow(/command/);
  });
});
