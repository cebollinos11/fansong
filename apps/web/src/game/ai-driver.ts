import { chooseCommand } from '@fansong/ai';
import type { MatchController } from './controller.js';
import { isAiSeat, type MatchSetup } from '@fansong/content';

/**
 * Drives AI-controlled seats. After every transition it checks whether the
 * player now to act is an AI seat and, if so, schedules a single
 * `chooseCommand` → `apply` on a timer (for pacing / animation breathing room).
 * It reuses the exact same heuristic AI as the headless CLI and the test bot —
 * the UI adds no intelligence of its own.
 */
export class AiDriver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly controller: MatchController,
    private readonly setup: MatchSetup,
    /** Delay before the AI plays each move, in ms. */
    private readonly stepDelayMs = 550,
  ) {}

  /** Begin driving; also kicks the first move if the AI leads. */
  start(): void {
    this.unsubscribe = this.controller.subscribe(() => this.maybeSchedule());
    this.maybeSchedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private maybeSchedule(): void {
    if (this.stopped || this.timer !== null) return;
    const state = this.controller.getState();
    if (state.phase === 'gameOver') return;
    if (!isAiSeat(this.setup, state.active)) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      const s = this.controller.getState();
      if (s.phase === 'gameOver' || !isAiSeat(this.setup, s.active)) return;
      this.controller.apply(chooseCommand(s));
      // The subscription fired by apply() will schedule the next move if needed.
    }, this.stepDelayMs);
  }
}
