import { chooseCommand } from '@fansong/ai';
import { isLegalCommand, reduce, type Command, type GameState, type Owner, type Replay } from '@fansong/engine';
import type { MatchSetup } from '@fansong/content';
import type { ClientStatus, MatchClient } from './client.js';
import { MatchController, type Transition } from './controller.js';
import { forceOutcome, outcomeRule, type ForceStatus } from './sandbox.js';

/** How many steps back the sandbox can undo. */
export const SANDBOX_HISTORY = 200;

/** An outcome the sandbox will force on the next command that produces one. */
export interface ArmedOutcome {
  ruleId: string;
  /** Keep forcing it on every such command, instead of just the next one. */
  sticky: boolean;
}

/** What the sandbox panel shows about its own state (history, AI, forcing). */
export interface SandboxInfo {
  canUndo: boolean;
  canRedo: boolean;
  aiSeats: [boolean, boolean];
  armed: ArmedOutcome | null;
  /** The last forcing attempt, for the panel to report. */
  lastForce: { ruleId: string; status: ForceStatus } | null;
}

/**
 * A local match with the rules bendable: the game screen drives it like any
 * {@link MatchClient}, while the sandbox panel rewrites its state (spawning,
 * teleporting, forcing dice) through {@link edit}. Every change — a command or
 * an edit — can be undone. Either seat may be handed to the AI and taken back
 * at any time. It records no replay: an edited game isn't a function of its
 * seed and commands any more.
 */
export class SandboxClient implements MatchClient {
  readonly setup: MatchSetup;
  private readonly controller: MatchController;
  private past: GameState[] = [];
  private future: GameState[] = [];
  private aiSeats: [boolean, boolean] = [false, false];
  private armed: ArmedOutcome | null = null;
  private lastForce: SandboxInfo['lastForce'] = null;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly infoSubs = new Set<(info: SandboxInfo) => void>();
  private readonly unsubAi: () => void;
  private disposed = false;

  constructor(
    initial: GameState,
    setup: MatchSetup,
    /** Delay before the AI plays each move, in ms. */
    private readonly aiDelayMs = 550,
  ) {
    this.setup = { ...setup, seats: ['human', 'human'] };
    this.controller = new MatchController(initial);
    this.unsubAi = this.controller.subscribe(() => this.scheduleAi());
  }

  get controlledSeats(): readonly Owner[] {
    return ([0, 1] as const).filter((o) => !this.aiSeats[o]);
  }

  getState(): GameState {
    return this.controller.getState();
  }

  legalCommands(): Command[] {
    return this.controller.legalCommands();
  }

  /** Play a command, forcing its outcome if one is armed. Throws if it isn't legal. */
  send(command: Command): void {
    const before = this.controller.getState();
    if (!isLegalCommand(before, command)) throw new Error(`illegal command: ${JSON.stringify(command)}`);
    const rule = this.armed ? outcomeRule(this.armed.ruleId) : undefined;
    let result;
    if (rule) {
      const forced = forceOutcome(before, command, rule);
      result = forced.result;
      if (forced.status.kind !== 'notApplicable') {
        this.lastForce = { ruleId: rule.id, status: forced.status };
        if (!this.armed!.sticky) this.armed = null;
      }
    } else {
      result = reduce(before, command);
    }
    this.remember(before);
    this.controller.replace(result.state, result.events, command);
    this.emitInfo();
  }

  /** Rewrite the state (a sandbox edit). Throws, changing nothing, if `fn` does. */
  edit(fn: (s: GameState) => GameState): void {
    const before = this.controller.getState();
    const next = fn(before);
    if (next === before) return;
    this.remember(before);
    this.controller.replace(next);
    this.emitInfo();
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.controller.getState());
    this.controller.replace(prev);
    this.emitInfo();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.controller.getState());
    this.controller.replace(next);
    this.emitInfo();
  }

  setAi(owner: Owner, on: boolean): void {
    this.aiSeats[owner] = on;
    this.emitInfo();
    this.scheduleAi();
  }

  /** Have the AI play one command for whoever is to act. */
  aiStep(): void {
    const s = this.controller.getState();
    if (s.phase === 'gameOver' || this.legalCommands().length === 0) return;
    this.send(chooseCommand(s));
  }

  arm(armed: ArmedOutcome | null): void {
    this.armed = armed;
    this.emitInfo();
  }

  info(): SandboxInfo {
    return {
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      aiSeats: [...this.aiSeats],
      armed: this.armed,
      lastForce: this.lastForce,
    };
  }

  onInfo(cb: (info: SandboxInfo) => void): () => void {
    this.infoSubs.add(cb);
    return () => this.infoSubs.delete(cb);
  }

  subscribe(sub: (t: Transition) => void): () => void {
    return this.controller.subscribe(sub);
  }

  onStatus(_cb: (s: ClientStatus) => void): () => void {
    return () => {};
  }

  status(): ClientStatus {
    return { phase: 'ready', presence: null };
  }

  getReplay(): Replay | null {
    return null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.aiTimer !== null) clearTimeout(this.aiTimer);
    this.aiTimer = null;
    this.unsubAi();
    this.infoSubs.clear();
  }

  private remember(state: GameState): void {
    this.past.push(state);
    if (this.past.length > SANDBOX_HISTORY) this.past.shift();
    this.future = [];
  }

  private emitInfo(): void {
    const info = this.info();
    for (const cb of this.infoSubs) cb(info);
  }

  private scheduleAi(): void {
    if (this.disposed || this.aiTimer !== null) return;
    const s = this.controller.getState();
    if (s.phase === 'gameOver' || !this.aiSeats[s.active]) return;
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      const now = this.controller.getState();
      if (this.disposed || now.phase === 'gameOver' || !this.aiSeats[now.active]) return;
      if (this.legalCommands().length === 0) return; // a bent state the AI can't move on from
      this.send(chooseCommand(now));
    }, this.aiDelayMs);
  }
}
