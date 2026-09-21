import type { Env } from './env.js';

export { GameRoomDO } from './durable/GameRoomDO.js';
export { MatchmakerDO } from './durable/MatchmakerDO.js';

/** The single global matchmaker instance name. */
const MATCHMAKER_NAME = 'global';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/**
 * The Worker: a stateless HTTP/WebSocket front door. It holds no game state — it
 * only routes to Durable Objects. `POST /api/matchmake` queues a player and
 * returns a ticket; `GET /api/room/:id` upgrades to the authoritative room
 * socket. All authority and rules live in the DOs (and, under them, the engine).
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
    if (url.pathname === '/api/matchmake' && req.method === 'POST') {
      const id = env.MATCHMAKER.idFromName(MATCHMAKER_NAME);
      const res = await env.MATCHMAKER.get(id).fetch('https://mm/matchmake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await req.text(),
      });
      return withCors(res);
    }

    const room = url.pathname.match(/^\/api\/room\/([A-Za-z0-9._-]+)$/);
    if (room) {
      const roomId = room[1]!;
      const id = env.GAME_ROOM.idFromName(roomId);
      // Forward the upgrade (or any control request) straight to the room DO.
      return env.GAME_ROOM.get(id).fetch(new Request(`https://room/${roomId}`, req));
    }

    return json({ error: 'not found' }, 404);
  },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
