import { createGame, type GameConfig } from './setup.js';
import { reduce } from './reduce.js';
import type { Command, GameEvent, GameState } from './types.js';

/**
 * Replays. A game is fully determined by `seed + command list` (the RNG state
 * lives inside GameState), so a {@link Replay} — the {@link GameConfig} plus the
 * commands that were applied — reproduces a match byte-for-byte with no other
 * inputs. This is the persistence format the web replay viewer loads and the
 * golden-replay test pins, and it depends on nothing but the pure engine.
 */

// Bumped to 2 for the hex board (M6): the state shape's coordinates are now hex
// offsets and rule outcomes differ, so v1 replays no longer reproduce.
export const REPLAY_VERSION = 2 as const;

export interface Replay {
  version: typeof REPLAY_VERSION;
  config: GameConfig;
  commands: Command[];
}

export interface ReplayRun {
  /** The freshly-created state before any command (frame 0). */
  initial: GameState;
  /** State after each command; `frames[i]` is the state after `commands[i]`. */
  frames: GameState[];
  /** Events produced by each command; `events[i]` came from `commands[i]`. */
  events: GameEvent[][];
  /** The final state (== `frames.at(-1)`, or `initial` for an empty replay). */
  final: GameState;
}

/**
 * Re-derive every state a replay passed through, purely from its config and
 * commands. Uses the raw {@link reduce} (a replay is trusted engine output, not
 * untrusted input); a corrupt or illegal command therefore throws, which is what
 * a golden test wants. The result exposes each intermediate frame so a viewer can
 * step forwards and backwards without re-running from the start every time.
 */
export function runReplay(replay: Replay): ReplayRun {
  const initial = createGame(replay.config);
  let state = initial;
  const frames: GameState[] = [];
  const events: GameEvent[][] = [];
  for (const command of replay.commands) {
    const result = reduce(state, command);
    state = result.state;
    frames.push(state);
    events.push(result.events);
  }
  return { initial, frames, events, final: frames.length > 0 ? frames[frames.length - 1]! : initial };
}

/**
 * Play a game to completion (or `maxSteps`) with a command-chooser and capture it
 * as a {@link Replay}. Pure given a pure `next` (e.g. the deterministic AI's
 * `chooseCommand`), so `recordReplay(config, chooseCommand)` is itself
 * reproducible. Kept chooser-agnostic so the engine never depends on the AI.
 */
export function recordReplay(
  config: GameConfig,
  next: (state: GameState) => Command,
  maxSteps = 10_000,
): Replay {
  let state = createGame(config);
  const commands: Command[] = [];
  let steps = 0;
  while (state.phase !== 'gameOver' && steps < maxSteps) {
    const command = next(state);
    commands.push(command);
    state = reduce(state, command).state;
    steps++;
  }
  return { version: REPLAY_VERSION, config, commands };
}

/**
 * Deterministic content hash of a game state, for golden tests and resync checks.
 * GameState is plain serialisable data with a stable key order (it is only ever
 * built by `createGame`/`reduce`), so `JSON.stringify` is a canonical encoding;
 * FNV-1a folds it to a short hex digest. Any accidental rule change shifts the
 * final state and therefore this digest.
 */
export function hashGameState(state: GameState): string {
  return fnv1a(JSON.stringify(state));
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in Uint32 range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
