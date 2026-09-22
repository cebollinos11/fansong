import type { Env } from './env.js';
import { newRoomCode, normalizeRoomCode } from '@fansong/protocol';

export { GameRoomDO } from './durable/GameRoomDO.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/**
 * The Worker: a stateless HTTP/WebSocket front door. It holds no game state — it
 * only routes to room Durable Objects, one per join code. `POST /api/rooms`
 * opens a room under a fresh code; `GET /api/room/:code` upgrades to that
 * room's socket. All authority and rules live in the DO (and, under it, the engine).
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === '/api/health') {
      return json({ ok: true }, 200);
    }
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      // A clash with a live room is rare; just draw another code.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newRoomCode();
        const res = await roomStub(env, code).fetch('https://room/create', { method: 'POST' });
        if (res.status === 201) return json({ code }, 201);
      }
      return json({ error: 'could not allocate a room code' }, 503);
    }

    const room = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]+)$/);
    if (room) {
      const code = normalizeRoomCode(room[1]!);
      // Forward the upgrade straight to the room DO.
      return roomStub(env, code).fetch(new Request(`https://room/${code}`, req));
    }

    return json({ error: 'not found' }, 404);
  },
};

function roomStub(env: Env, code: string): DurableObjectStub {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}
