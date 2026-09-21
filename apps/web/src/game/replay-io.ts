import { runReplay, type Replay } from '@fansong/engine';
import { commandSchema } from '@fansong/protocol';

/**
 * Save/load for replays. A replay is just `seed + command list` as JSON, so it is
 * small, portable, and reproduces the exact game via the pure engine. Loading
 * runs the untrusted file through the wire `commandSchema` and then `runReplay`,
 * so a malformed or hostile file is rejected before it reaches the viewer.
 */

export function replayToJson(replay: Replay): string {
  return JSON.stringify(replay, null, 2);
}

/** Trigger a browser download of a replay as a `.json` file. */
export function downloadReplay(replay: Replay, filename = 'fansong-replay.json'): void {
  const blob = new Blob([replayToJson(replay)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Parse and validate an untrusted replay file. Throws a friendly `Error` if the
 * text isn't a replay this engine can reproduce.
 */
export function parseReplay(text: string): Replay {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('Replay must be an object.');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) throw new Error('Unsupported replay version.');
  if (typeof obj.config !== 'object' || obj.config === null) throw new Error('Replay is missing its config.');
  if (!Array.isArray(obj.commands)) throw new Error('Replay is missing its command list.');

  const commands = obj.commands.map((c, i) => {
    const parsed = commandSchema.safeParse(c);
    if (!parsed.success) throw new Error(`Command ${i} is not a valid FanSong command.`);
    return parsed.data;
  });

  const replay: Replay = { version: 1, config: obj.config as Replay['config'], commands };
  // The ultimate validation: it must actually reproduce a game.
  try {
    runReplay(replay);
  } catch (e) {
    throw new Error(`Replay could not be reproduced: ${e instanceof Error ? e.message : String(e)}`);
  }
  return replay;
}
