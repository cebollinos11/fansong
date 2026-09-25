import {
  applyCommand,
  commandsEqual,
  getLegalCommands,
  isLegalCommand,
  type Command,
  type GameEvent,
  type GameState,
} from '@fansong/engine';

/**
 * A snapshot handed to subscribers after every applied command: the new state
 * plus the events that command produced (for animation) and the command itself.
 */
export interface Transition {
  state: GameState;
  events: GameEvent[];
  /**
   * The command that produced this transition. Absent for a state *reset* with
   * no single originating command — e.g. an online client receiving its initial
   * `welcome` snapshot or a `sync` after a resync.
   */
  command?: Command;
}

export type Subscriber = (t: Transition) => void;

/**
 * The single point through which the UI touches the engine. It owns the current
 * `GameState`, exposes the legal moves, applies a `Command` (validated by the
 * engine's {@link applyCommand} guard first), and notifies subscribers with the
 * resulting events so views can animate. It holds **no game rules** — every
 * decision is delegated to `@fansong/engine`. The same validate-then-reduce
 * seam a Durable Object will drive server-side (M4) lives in the engine, so the
 * client and the server agree on legality by construction.
 */
export class MatchController {
  private state: GameState;
  private readonly subscribers = new Set<Subscriber>();

  constructor(initial: GameState) {
    this.state = initial;
  }

  getState(): GameState {
    return this.state;
  }

  /** Every legal command for the player currently to act. */
  legalCommands(): Command[] {
    return getLegalCommands(this.state);
  }

  /** Whether a command is currently legal (structural match against the list). */
  isLegal(command: Command): boolean {
    return isLegalCommand(this.state, command);
  }

  /**
   * Validate a command against the engine's legal set, apply it via `reduce`,
   * advance the held state, and broadcast the transition. Returns the events, or
   * throws if the command is not currently legal (the UI should only ever send
   * commands it derived from {@link legalCommands}).
   */
  apply(command: Command): GameEvent[] {
    const { state, events } = applyCommand(this.state, command);
    this.state = state;
    for (const sub of this.subscribers) sub({ state, events, command });
    return events;
  }

  /**
   * Adopt a state that did not come from {@link apply} — the dev sandbox's
   * edits, undo, or a result it reduced itself — and broadcast it like any
   * other transition. No rules are checked: the caller vouches for the state.
   */
  replace(state: GameState, events: GameEvent[] = [], command?: Command): void {
    this.state = state;
    for (const sub of this.subscribers) sub({ state, events, command });
  }

  subscribe(sub: Subscriber): () => void {
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }
}

/** Re-exported from the engine, where command equality now lives. */
export { commandsEqual };
