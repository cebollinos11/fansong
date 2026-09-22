import {
  getLegalCommands,
  isLegalCommand,
  type Command,
  type GameState,
  type Owner,
} from '@fansong/engine';
import type { ClientMessage, SeatPresence, ServerMessage } from '@fansong/protocol';
import type { MatchSetup } from '@fansong/content';
import type { Transition } from './controller.js';
import type { ClientStatus, MatchClient } from './client.js';

/**
 * The online counterpart of {@link LocalMatchClient}: one game played in an
 * {@link OnlineRoom}. It holds a *mirror* of the authoritative {@link GameState}
 * that lives in the room's Durable Object and never reduces a command itself —
 * it sends the command through the room's socket and applies the `delta` the
 * server broadcasts back, so the server stays the one source of truth and two
 * clients can never diverge. Legality is still checked locally (via the same
 * `getLegalCommands`) purely to gate the UI; the server re-checks.
 */
export class OnlineMatchClient implements MatchClient {
  readonly setup: MatchSetup;
  readonly controlledSeats: readonly Owner[];
  private readonly seat: Owner;
  private state: GameState;
  private readonly subs = new Set<(t: Transition) => void>();
  private readonly statusSubs = new Set<(s: ClientStatus) => void>();
  private currentStatus: ClientStatus;

  constructor(
    welcome: Extract<ServerMessage, { t: 'welcome' }>,
    private readonly sendRaw: (msg: ClientMessage) => void,
  ) {
    this.seat = welcome.seat;
    this.setup = welcome.setup;
    this.controlledSeats = [welcome.seat];
    this.state = welcome.state;
    this.currentStatus = statusFor(welcome.presence);
  }

  /** A game frame from the room's socket. */
  handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.state = msg.state;
        this.setStatus(statusFor(msg.presence));
        this.emit({ state: this.state, events: [] });
        break;
      case 'delta':
        this.state = msg.state;
        this.emit({ state: this.state, events: msg.events, command: msg.command });
        break;
      case 'sync':
        this.state = msg.state;
        this.emit({ state: this.state, events: [] });
        break;
      case 'presence':
        this.setStatus(statusFor(msg.presence));
        break;
      case 'error':
        // Legality/authority is enforced server-side; a rejected command lands
        // here. The UI only ever sends moves it derived as legal, so this is a
        // guard (e.g. a race with the opponent) — resync to be safe.
        this.sendRaw({ t: 'resync' });
        break;
      case 'lobby':
        break; // the room handles going back to the lobby
    }
  }

  /** The room's socket closed under this game. */
  disconnected(reason: string): void {
    this.setStatus({ phase: 'disconnected', reason });
  }

  getState(): GameState {
    return this.state;
  }

  legalCommands(): Command[] {
    // Only surface moves for the seat this client controls (defensive; the
    // engine already only emits commands for the active player).
    if (this.state.active !== this.seat) return [];
    return getLegalCommands(this.state);
  }

  send(command: Command): void {
    // Gate on local legality for snappy UI; the server is the real authority.
    if (this.state.active !== this.seat) return;
    if (!isLegalCommand(this.state, command)) return;
    this.sendRaw({ t: 'command', command });
  }

  subscribe(sub: (t: Transition) => void): () => void {
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  onStatus(cb: (s: ClientStatus) => void): () => void {
    this.statusSubs.add(cb);
    return () => this.statusSubs.delete(cb);
  }

  status(): ClientStatus {
    return this.currentStatus;
  }

  getReplay(): null {
    // Online play is server-authoritative and driven by deltas; the client never
    // holds the authoritative command list, so it doesn't produce replays.
    return null;
  }

  dispose(): void {
    // The socket belongs to the room, which outlives any one game.
    this.subs.clear();
    this.statusSubs.clear();
  }

  private emit(t: Transition): void {
    for (const sub of this.subs) sub(t);
  }

  private setStatus(s: ClientStatus): void {
    this.currentStatus = s;
    for (const cb of this.statusSubs) cb(s);
  }
}

/** Both seats present ⇒ ready; otherwise the opponent has dropped out. */
function statusFor(presence: SeatPresence): ClientStatus {
  return presence[0] && presence[1] ? { phase: 'ready', presence } : { phase: 'waiting' };
}
