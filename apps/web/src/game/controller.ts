import {
  getLegalCommands,
  reduce,
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
  command: Command;
}

export type Subscriber = (t: Transition) => void;

/**
 * The single point through which the UI touches the engine. It owns the current
 * `GameState`, exposes the legal moves, applies a `Command` (validating it
 * against `getLegalCommands` first), and notifies subscribers with the resulting
 * events so views can animate. It holds **no game rules** — every decision is
 * delegated to `@fansong/engine`.
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
    return this.legalCommands().some((c) => commandsEqual(c, command));
  }

  /**
   * Validate a command against the engine's legal set, apply it via `reduce`,
   * advance the held state, and broadcast the transition. Returns the events, or
   * throws if the command is not currently legal (the UI should only ever send
   * commands it derived from {@link legalCommands}).
   */
  apply(command: Command): GameEvent[] {
    if (!this.isLegal(command)) {
      throw new Error(`illegal command: ${describe(command)}`);
    }
    const { state, events } = reduce(this.state, command);
    this.state = state;
    for (const sub of this.subscribers) sub({ state, events, command });
    return events;
  }

  subscribe(sub: Subscriber): () => void {
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }
}

/** Structural equality for commands, so the UI can match one against the legal list. */
export function commandsEqual(a: Command, b: Command): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'ChooseActivation':
      return b.type === 'ChooseActivation' && a.unitId === b.unitId && a.diceCount === b.diceCount;
    case 'Move':
      return b.type === 'Move' && a.unitId === b.unitId && a.to.x === b.to.x && a.to.y === b.to.y;
    case 'Attack':
      return b.type === 'Attack' && a.attackerId === b.attackerId && a.targetId === b.targetId;
    case 'EndActivation':
      return b.type === 'EndActivation';
  }
}

function describe(command: Command): string {
  return JSON.stringify(command);
}
