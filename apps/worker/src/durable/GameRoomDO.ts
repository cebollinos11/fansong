import { encode, ErrorCode } from '@fansong/protocol';
import { newRoomSnapshot, RoomEngine, type RoomConnection, type RoomSnapshot } from '../room.js';
import type { Env } from '../env.js';

/** How long an empty room is kept before its storage is wiped. */
const IDLE_MS = 24 * 60 * 60 * 1000;

/**
 * Durable Object for one game room, addressed by its join code. It is a thin
 * transport adapter: it owns a single {@link RoomEngine} (all the lobby and game
 * logic) and only shuttles bytes between WebSockets and that engine. The room
 * only exists once the worker has `POST …/create`d it; a socket to any other
 * code is told there is no such room and closed.
 *
 * The room is kept in memory in the live DO and mirrored to storage after every
 * frame, so a cold restart resumes the same lobby or game. Once nobody has been
 * connected for a day, an alarm deletes it.
 */
export class GameRoomDO implements DurableObject {
  private engine: RoomEngine | null = null;
  private nextConnId = 0;
  /** Live sockets, so the idle alarm knows whether anyone is still here. */
  private readonly sockets = new Set<WebSocket>();

  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname.endsWith('/create')) {
      return this.handleCreate();
    }
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    return this.handleUpgrade();
  }

  async alarm(): Promise<void> {
    if (this.sockets.size > 0) {
      await this.state.storage.setAlarm(Date.now() + IDLE_MS);
      return;
    }
    this.engine = null;
    await this.state.storage.deleteAll();
  }

  // --- creation -------------------------------------------------------------

  /** Open a fresh room under this code; 409 if the code is already taken. */
  private async handleCreate(): Promise<Response> {
    if (await this.ensureEngine()) return new Response('room exists', { status: 409 });
    const snapshot = newRoomSnapshot();
    await this.state.storage.put('room', snapshot);
    this.engine = new RoomEngine(snapshot);
    await this.state.storage.setAlarm(Date.now() + IDLE_MS);
    return new Response('created', { status: 201 });
  }

  private async ensureEngine(): Promise<RoomEngine | null> {
    if (this.engine) return this.engine;
    const snapshot = await this.state.storage.get<RoomSnapshot>('room');
    if (!snapshot) return null;
    this.engine = new RoomEngine(snapshot);
    return this.engine;
  }

  private async persist(): Promise<void> {
    if (this.engine) await this.state.storage.put('room', this.engine.snapshot());
  }

  // --- websockets -----------------------------------------------------------

  private async handleUpgrade(): Promise<Response> {
    const engine = await this.ensureEngine();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    if (!engine) {
      // Say why before closing, so the client can tell "wrong code" from a network error.
      server.send(encode({ t: 'error', code: ErrorCode.NoSuchRoom, message: 'no room with that code' }));
      server.close(1000, 'no such room');
      return new Response(null, { status: 101, webSocket: client });
    }

    const conn: RoomConnection = {
      id: `c${this.nextConnId++}`,
      send: (frame) => {
        try {
          server.send(frame);
        } catch {
          /* socket already closing; drop the frame */
        }
      },
    };
    this.sockets.add(server);
    engine.onConnect(conn);

    server.addEventListener('message', (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : '';
      engine.onMessage(conn, data);
      void this.persist();
    });
    const drop = (): void => {
      if (!this.sockets.delete(server)) return;
      engine.onDisconnect(conn);
      void this.persist();
      if (this.sockets.size === 0) void this.state.storage.setAlarm(Date.now() + IDLE_MS);
    };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client });
  }
}
