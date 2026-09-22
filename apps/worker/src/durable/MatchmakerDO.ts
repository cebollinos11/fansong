import { matchmakeRequestSchema } from '@fansong/protocol';
import { Matchmaker, setupFor, type MatchmakeRequest, type PendingRoom, type Ticket } from '../matchmaker.js';
import { setupError } from '../room.js';
import type { Env } from '../env.js';

/**
 * Durable Object for global matchmaking (addressed by a single fixed name, so
 * every player queues against the same instance). It wraps the pure
 * {@link Matchmaker}: it decides pairing, mints room ids, and — crucially —
 * seeds the target {@link GameRoomDO} with the finalised {@link MatchSetup}
 * *before* handing the client a ticket, so the room already exists when the
 * client connects. The waiting queue is persisted so an eviction between the
 * host's and the joiner's requests does not lose the pending game.
 */
export class MatchmakerDO implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname.endsWith('/matchmake')) {
      return this.handleMatchmake(req);
    }
    return new Response('not found', { status: 404 });
  }

  private async handleMatchmake(req: Request): Promise<Response> {
    const parsed = matchmakeRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response('invalid matchmake request', { status: 400 });
    }
    const body: MatchmakeRequest = parsed.data;
    // Reject a match that could never start (unknown preset/map, a mode the map
    // can't host) before it is queued or seeded.
    const problem = setupError(setupFor(body, ['human', body.mode === 'pve' ? 'ai' : 'human']));
    if (problem) return new Response(`invalid match: ${problem}`, { status: 400 });

    // Serialise all matchmaking through the DO's single-threaded event loop with
    // a storage transaction, so two simultaneous requests cannot both take the
    // same waiting host.
    const ticket = await this.state.blockConcurrencyWhile(async () => {
      const queue = (await this.state.storage.get<PendingRoom[]>('queue')) ?? [];
      const mm = new Matchmaker(() => crypto.randomUUID(), queue);
      const t = mm.request(body);
      await this.state.storage.put('queue', mm.snapshot());
      return t;
    });

    // Seed the room the first time we hand it out (the hosting/pve request).
    if (ticket.status === 'waiting' || ticket.setup.seats[1] === 'ai') {
      await this.seedRoom(ticket);
    }
    return Response.json(ticket satisfies Ticket);
  }

  /** Send the finalised setup to the room DO so it is ready before the connect. */
  private async seedRoom(ticket: Ticket): Promise<void> {
    const id = this.env.GAME_ROOM.idFromName(ticket.roomId);
    const stub = this.env.GAME_ROOM.get(id);
    await stub.fetch('https://room/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setup: ticket.setup }),
    });
  }
}
