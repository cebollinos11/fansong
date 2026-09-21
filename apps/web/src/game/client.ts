import { REPLAY_VERSION } from '@fansong/engine';
import type { Command, GameState, Owner, Replay } from '@fansong/engine';
import type { SeatPresence } from '@fansong/protocol';
import { configFromSetup, createMatchFromPresets, isAiSeat, type MatchSetup } from '@fansong/content';
import { AiDriver } from './ai-driver.js';
import { MatchController, type Transition } from './controller.js';

/** Connection/readiness state, surfaced to the HUD. Local play is always ready. */
export type ClientStatus =
  | { phase: 'connecting' }
  | { phase: 'waiting' } // online: matched a room, waiting for the opponent to arrive
  | { phase: 'ready'; presence: SeatPresence | null }
  | { phase: 'disconnected'; reason: string };

/**
 * The one seam the game screen drives, whether the match is local or online. A
 * {@link LocalMatchClient} reduces commands in-process; an
 * {@link OnlineMatchClient} sends them to the authoritative Durable Object and
 * applies the deltas that come back. The screen never knows which it holds — it
 * reads `getState`/`legalCommands`, calls `send`, and animates from `subscribe`.
 */
export interface MatchClient {
  readonly setup: MatchSetup;
  /** Seats this local player may act for (local hotseat: both humans; online: just yours). */
  readonly controlledSeats: readonly Owner[];
  getState(): GameState;
  legalCommands(): Command[];
  /** Play a command: applied locally, or sent to the server and echoed back as a delta. */
  send(command: Command): void;
  subscribe(sub: (t: Transition) => void): () => void;
  onStatus(cb: (s: ClientStatus) => void): () => void;
  status(): ClientStatus;
  /**
   * The game so far as a replayable `seed + command list`, or `null` if this
   * client can't produce one. Only the local client records; online play is
   * driven by server deltas, so it opts out.
   */
  getReplay(): Replay | null;
  dispose(): void;
}

/** Human seats in a setup — the seats a local player operates. */
export function humanSeats(setup: MatchSetup): Owner[] {
  return ([0, 1] as const).filter((o) => !isAiSeat(setup, o));
}

/**
 * Local match: a {@link MatchController} plus an {@link AiDriver} for any AI seat.
 * This is the hotseat and local-vs-AI path; no network is involved. It exposes
 * the exact same surface as the online client so the UI is identical.
 */
export class LocalMatchClient implements MatchClient {
  readonly setup: MatchSetup;
  readonly controlledSeats: readonly Owner[];
  private readonly controller: MatchController;
  private readonly driver: AiDriver;
  /** Every command applied, in order — the command list half of a {@link Replay}. */
  private readonly recorded: Command[] = [];
  private readonly unrecord: () => void;

  constructor(setup: MatchSetup) {
    this.setup = setup;
    this.controller = new MatchController(createMatchFromPresets(setup));
    this.controlledSeats = humanSeats(setup);
    // Record every applied command (human and AI alike) for replay.
    this.unrecord = this.controller.subscribe(({ command }) => {
      if (command) this.recorded.push(command);
    });
    this.driver = new AiDriver(this.controller, setup);
    this.driver.start();
  }

  getState(): GameState {
    return this.controller.getState();
  }

  legalCommands(): Command[] {
    return this.controller.legalCommands();
  }

  send(command: Command): void {
    this.controller.apply(command);
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

  getReplay(): Replay {
    return { version: REPLAY_VERSION, config: configFromSetup(this.setup), commands: [...this.recorded] };
  }

  dispose(): void {
    this.unrecord();
    this.driver.stop();
  }
}
