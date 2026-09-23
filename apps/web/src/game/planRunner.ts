import { isLegalCommand, type Command, type GameState } from '@fansong/engine';
import type { MatchClient } from './client.js';

/**
 * How a chain ended. `sent` counts the commands that actually reached the client,
 * so the caller can say what the unit managed before it was stopped.
 */
export type PlanOutcome =
  | { done: true; sent: number }
  | { done: false; sent: number; reason: 'interrupted' | 'illegal' | 'cancelled' | 'timeout' };

/** How long one step may take to come back before the chain gives up. */
const STEP_TIMEOUT_MS = 8000;
/** How often to look again while waiting on a step that hasn't landed yet. */
const POLL_MS = 50;

export interface PlanRunnerDeps {
  client: Pick<MatchClient, 'send' | 'getState'>;
  /** Resolves when the board has finished showing the last transition. */
  whenIdle: () => Promise<void>;
  /** Injected by tests; defaults to a real timer. */
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Plays a multi-action plan as what it is: a handful of ordinary commands, sent
 * one at a time.
 *
 * It cannot simply loop over `client.send` — the online client round-trips each
 * command to the server, and the board needs to animate each leg before the next
 * begins. So every step waits for the client's state to actually advance and for
 * the board to fall idle, and is re-checked for legality before it is sent.
 *
 * That re-check is also the abort: when a free hack cuts a walk short, or the
 * last action runs out, the activation ends underneath the chain, and the rest of
 * it is quietly dropped instead of being forced through.
 */
export class PlanRunner {
  private readonly client: Pick<MatchClient, 'send' | 'getState'>;
  private readonly whenIdle: () => Promise<void>;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private active = false;
  private cancelled = false;

  constructor(deps: PlanRunnerDeps) {
    this.client = deps.client;
    this.whenIdle = deps.whenIdle;
    this.delay = deps.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? (() => Date.now());
  }

  get running(): boolean {
    return this.active;
  }

  /** Stop before the next step. Whatever has already been sent stands. */
  cancel(): void {
    this.cancelled = true;
  }

  async run(steps: Command[]): Promise<PlanOutcome> {
    if (this.active) return { done: false, sent: 0, reason: 'cancelled' };
    this.active = true;
    this.cancelled = false;
    try {
      return await this.play(steps);
    } finally {
      this.active = false;
    }
  }

  private async play(steps: Command[]): Promise<PlanOutcome> {
    let before = this.client.getState();
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (this.cancelled) return { done: false, sent: i, reason: 'cancelled' };
      if (i > 0 && !(await this.settle(before))) return { done: false, sent: i, reason: 'timeout' };
      if (this.cancelled) return { done: false, sent: i, reason: 'cancelled' };

      const state = this.client.getState();
      // The activation ended under us: a free hack stopped the walk, the last
      // action was spent, an objective was scored, or the game is over.
      if (state.phase !== 'acting' || state.activeUnitId !== actorOf(step)) {
        return { done: false, sent: i, reason: 'interrupted' };
      }
      if (!isLegalCommand(state, step)) return { done: false, sent: i, reason: 'illegal' };

      before = state;
      this.client.send(step);
    }
    // Wait out the last step's animation, but don't judge the state afterwards:
    // a chain that spends its final action legitimately ends the activation.
    await this.settle(before);
    return { done: true, sent: steps.length };
  }

  /**
   * Wait for the command just sent to take effect and finish playing.
   *
   * The local client reduces synchronously, so the board is already busy and one
   * pass through `whenIdle` covers it. The online client only sends, and the new
   * state arrives later as a server delta — hence the poll. `reduce` returns a
   * fresh state object every time, so identity is a sound test for "has it moved
   * on?", and without it a chain would be fired at the server in one burst.
   */
  private async settle(before: GameState): Promise<boolean> {
    const deadline = this.now() + STEP_TIMEOUT_MS;
    while (this.now() < deadline) {
      await this.whenIdle();
      if (this.client.getState() !== before) return true;
      if (this.cancelled) return false;
      await this.delay(POLL_MS);
    }
    return false;
  }
}

/** The unit a step belongs to, so a chain notices when the activation moves on. */
function actorOf(step: Command): string | null {
  switch (step.type) {
    case 'Move':
    case 'Guard':
      return step.unitId;
    case 'Attack':
    case 'Shoot':
      return step.attackerId;
    default:
      return null;
  }
}
