import { createRoomResponseSchema, normalizeRoomCode } from '@fansong/protocol';
import { OnlineRoom } from '../game/OnlineRoom.js';

/** Where the worker lives. Override with `VITE_SERVER_URL` for a deployed worker. */
export function serverHttpBase(): string {
  return withScheme(import.meta.env.VITE_SERVER_URL || 'http://localhost:8787');
}

/** A bare host (`fansong.x.workers.dev`) would be fetched as a relative path; assume https. */
export function withScheme(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function serverWsBase(): string {
  return serverHttpBase().replace(/^http/, 'ws');
}

/** Ask the worker to open a fresh room; resolves to its join code. */
export async function createRoom(): Promise<string> {
  const res = await fetch(`${serverHttpBase()}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`couldn't create a room (${res.status})`);
  return createRoomResponseSchema.parse(await res.json()).code;
}

/** Open the socket to the room with this code (it joins on connect). */
export function joinRoom(code: string): OnlineRoom {
  const normalized = normalizeRoomCode(code);
  return new OnlineRoom(normalized, `${serverWsBase()}/api/room/${normalized}`);
}

/** A link that opens the app straight into this room. */
export function roomLink(code: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  return url.toString();
}

/** The room code in the page's `?room=` link, if any, removed from the address
 *  bar so leaving the room doesn't rejoin it on reload. */
export function takeRoomFromUrl(): string | null {
  const url = new URL(window.location.href);
  const code = normalizeRoomCode(url.searchParams.get('room') ?? '');
  if (!code) return null;
  url.searchParams.delete('room');
  window.history.replaceState(null, '', url.toString());
  return code;
}
