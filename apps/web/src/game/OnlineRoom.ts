import type { GameMode, Owner } from '@fansong/engine';
import type { Warband } from '@fansong/content';
import { encode, ErrorCode, parseServerMessage, type ClientMessage, type Lobby } from '@fansong/protocol';
import { OnlineMatchClient } from './OnlineMatchClient.js';

/** What a room is showing right now. `game` counts games, so each one remounts. */
export type RoomView =
  | { phase: 'connecting' }
  | { phase: 'lobby'; seat: Owner; lobby: Lobby }
  | { phase: 'playing'; client: OnlineMatchClient; game: number }
  | { phase: 'closed'; reason: string };

/**
 * One socket to a room, joined by its code, for as long as the player stays in
 * it: through the lobby, each game, and each rematch back to the lobby. It turns
 * server frames into a {@link RoomView}, and while a game runs it hands the game
 * frames to that game's {@link OnlineMatchClient}.
 */
export class OnlineRoom {
  private ws: WebSocket | null;
  private current: RoomView = { phase: 'connecting' };
  private readonly subs = new Set<(v: RoomView) => void>();
  private games = 0;
  private disposed = false;

  constructor(
    readonly code: string,
    url: string,
  ) {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('open', () => this.sendRaw({ t: 'join' }));
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (typeof ev.data === 'string') this.handleFrame(ev.data);
    });
    ws.addEventListener('close', () => this.lost('connection closed'));
    ws.addEventListener('error', () => this.lost("couldn't reach the game server"));
  }

  view(): RoomView {
    return this.current;
  }

  onView(cb: (v: RoomView) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  /** Lobby: bring this army (and King) to your seat. */
  setArmy(preset: string, warband: Warband, king: number): void {
    this.sendRaw({ t: 'setArmy', preset, warband, king });
  }

  /** Lobby, host only: pick the map and game mode. */
  setMap(mapId: string, mode: GameMode): void {
    this.sendRaw({ t: 'setMap', mapId, mode });
  }

  setReady(ready: boolean): void {
    this.sendRaw({ t: 'ready', ready });
  }

  /** After a finished game: back to the lobby for another. */
  rematch(): void {
    this.sendRaw({ t: 'rematch' });
  }

  dispose(): void {
    this.disposed = true;
    this.endGame();
    this.ws?.close();
    this.ws = null;
    this.subs.clear();
  }

  private handleFrame(raw: string): void {
    let msg;
    try {
      msg = parseServerMessage(raw);
    } catch {
      return; // ignore anything that isn't a valid server frame
    }
    const view = this.current;
    switch (msg.t) {
      case 'lobby':
        this.endGame();
        this.setView({ phase: 'lobby', seat: msg.seat, lobby: msg.lobby });
        break;
      case 'welcome':
        if (view.phase === 'playing') {
          view.client.handle(msg);
        } else {
          const client = new OnlineMatchClient(msg, (m) => this.sendRaw(m));
          this.setView({ phase: 'playing', client, game: ++this.games });
        }
        break;
      case 'error':
        if (msg.code === ErrorCode.NoSuchRoom) this.close(`There's no room with the code ${this.code}.`);
        else if (msg.code === ErrorCode.RoomFull) this.close(`Room ${this.code} already has two players.`);
        else if (view.phase === 'playing') view.client.handle(msg);
        break;
      default:
        if (view.phase === 'playing') view.client.handle(msg);
    }
  }

  /** The socket went away: a running game shows it in its HUD; otherwise the room closes. */
  private lost(reason: string): void {
    if (this.disposed || this.current.phase === 'closed') return;
    if (this.current.phase === 'playing') this.current.client.disconnected(reason);
    else this.setView({ phase: 'closed', reason });
  }

  private close(reason: string): void {
    this.setView({ phase: 'closed', reason });
    this.ws?.close();
  }

  private endGame(): void {
    if (this.current.phase === 'playing') this.current.client.dispose();
  }

  private setView(v: RoomView): void {
    this.current = v;
    for (const cb of this.subs) cb(v);
  }

  private sendRaw(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }
}
