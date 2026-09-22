import type { GameState } from '@fansong/engine';
import { gameStateSchema, matchSetupSchema } from '@fansong/protocol';
import type { MatchSetup } from '@fansong/content';
import { RoomEngine, setupError, type RoomConnection } from '../room.js';
import type { Env } from '../env.js';

/**
 * Durable Object for one game room. It is a thin transport adapter: it owns a
 * single {@link RoomEngine} (all the game logic and authority) and only shuttles
 * bytes between WebSockets and that engine. The DO is created empty and seeded
 * via an internal `POST …/init` from the matchmaker. A pvp host's room is seeded
 * `pending` (seat 1 is a stand-in army); a second init with `final: true` swaps
 * in the joiner's army once one is matched, fixing the setup both players share.
 *
 * State is kept in memory in the live DO and mirrored to storage after every
 * applied frame, so a cold restart resumes the same authoritative `GameState`.
 */
export class GameRoomDO implements DurableObject {
  private engine: RoomEngine | null = null;
  private nextConnId = 0;
  /** Live connections, so message/close events can find their RoomConnection. */
  private readonly conns = new Map<WebSocket, RoomConnection>();

  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname.endsWith('/init')) {
      return this.handleInit(req);
    }
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    return this.handleUpgrade();
  }

  // --- seeding --------------------------------------------------------------

  private async handleInit(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as
      | { setup?: unknown; pending?: boolean; final?: boolean }
      | null;
    const parsed = matchSetupSchema.safeParse(body?.setup);
    if (!parsed.success) {
      return new Response('invalid setup', { status: 400 });
    }
    const problem = setupError(parsed.data);
    if (problem) return new Response(`invalid setup: ${problem}`, { status: 400 });
    if (body?.final) {
      const engine = await this.ensureEngine();
      if (!engine || !engine.finalize(parsed.data)) return new Response('room is not awaiting an opponent', { status: 409 });
      await this.state.storage.put({ setup: engine.setup, pending: false });
      await this.persist();
      return new Response('ok');
    }
    // Idempotent: only the first init seeds the room.
    const existing = await this.state.storage.get<MatchSetup>('setup');
    if (!existing) {
      const pending = body?.pending === true;
      await this.state.storage.put({ setup: parsed.data, pending });
      this.engine = new RoomEngine(parsed.data, undefined, { pending });
      await this.persist();
    }
    return new Response('ok');
  }

  private async ensureEngine(): Promise<RoomEngine | null> {
    if (this.engine) return this.engine;
    const setup = await this.state.storage.get<MatchSetup>('setup');
    if (!setup) return null;
    const stored = await this.state.storage.get<unknown>('state');
    const resumed = stored ? (gameStateSchema.parse(stored) as GameState) : undefined;
    const pending = (await this.state.storage.get<boolean>('pending')) ?? false;
    this.engine = new RoomEngine(setup, resumed, { pending });
    return this.engine;
  }

  private async persist(): Promise<void> {
    if (this.engine) await this.state.storage.put('state', this.engine.getState());
  }

  // --- websockets -----------------------------------------------------------

  private async handleUpgrade(): Promise<Response> {
    const engine = await this.ensureEngine();
    if (!engine) return new Response('room not initialised', { status: 409 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

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
    this.conns.set(server, conn);
    engine.onConnect(conn);

    server.addEventListener('message', (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : '';
      engine.onMessage(conn, data);
      void this.persist();
    });
    const drop = (): void => {
      engine.onDisconnect(conn);
      this.conns.delete(server);
      void this.persist();
    };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client });
  }
}
