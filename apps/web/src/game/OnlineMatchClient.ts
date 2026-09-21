import {
  getLegalCommands,
  isLegalCommand,
  type Command,
  type GameState,
  type Owner,
} from '@fansong/engine';
import {
  encode,
  parseServerMessage,
  type ClientMessage,
  type SeatPresence,
} from '@fansong/protocol';
import type { MatchSetup } from '@fansong/content';
import type { Transition } from './controller.js';
import type { ClientStatus, MatchClient } from './client.js';

/**
 * The online counterpart of {@link LocalMatchClient}. It holds a *mirror* of the
 * authoritative {@link GameState} that lives in the room's Durable Object: it
 * never reduces a command itself. Instead it sends the command to the server and
 * applies the `delta` the server broadcasts back — so the server stays the one
 * source of truth and two clients can never diverge. Legality is still checked
 * locally (via the same `getLegalCommands`) purely to gate the UI; the server
 * re-checks authoritatively.
 */
export class OnlineMatchClient implements MatchClient {
  readonly setup: MatchSetup;
  readonly controlledSeats: readonly Owner[];
  private readonly seat: Owner;
  private ws: WebSocket | null = null;
  private state: GameState;
  private readonly subs = new Set<(t: Transition) => void>();
  private readonly statusSubs = new Set<(s: ClientStatus) => void>();
  private currentStatus: ClientStatus = { phase: 'connecting' };
  private disposed = false;

  constructor(opts: { url: string; seat: Owner; setup: MatchSetup; initialState: GameState }) {
    this.seat = opts.seat;
    this.setup = opts.setup;
    this.controlledSeats = [opts.seat];
    this.state = opts.initialState;
    this.connect(opts.url);
  }

  private connect(url: string): void {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.sendRaw({ t: 'join', seat: this.seat });
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return;
      this.handleFrame(ev.data);
    });
    ws.addEventListener('close', () => {
      if (this.disposed) return;
      this.setStatus({ phase: 'disconnected', reason: 'connection closed' });
    });
    ws.addEventListener('error', () => {
      if (this.disposed) return;
      this.setStatus({ phase: 'disconnected', reason: 'connection error' });
    });
  }

  private handleFrame(raw: string): void {
    let msg;
    try {
      msg = parseServerMessage(raw);
    } catch {
      return; // ignore anything that isn't a valid server frame
    }
    switch (msg.t) {
      case 'welcome':
        this.state = msg.state;
        this.setReady(msg.presence);
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
        this.setReady(msg.presence);
        break;
      case 'error':
        // Legality/authority is enforced server-side; a rejected command lands
        // here. The UI only ever sends moves it derived as legal, so this is a
        // guard (e.g. a race with the opponent) — resync to be safe.
        this.sendRaw({ t: 'resync' });
        break;
    }
  }

  private setReady(presence: SeatPresence): void {
    // Both seats present ⇒ ready; otherwise still waiting for the opponent.
    const bothPresent = presence[0] && presence[1];
    this.setStatus(bothPresent ? { phase: 'ready', presence } : { phase: 'waiting' });
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
    this.disposed = true;
    this.ws?.close();
    this.ws = null;
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

  private sendRaw(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }
}
