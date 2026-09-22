import type { Owner } from '@fansong/engine';
import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import type { MatchmakeRequestBody } from '@fansong/protocol';
import { OnlineMatchClient } from '../game/OnlineMatchClient.js';

/** Where the worker lives. Override with `VITE_SERVER_URL` for a deployed worker. */
export function serverHttpBase(): string {
  return import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787';
}

function serverWsBase(): string {
  return serverHttpBase().replace(/^http/, 'ws');
}

/** `POST /api/matchmake` body, validated by the worker against the protocol schema. */
export type MatchmakeBody = MatchmakeRequestBody;

export interface Ticket {
  roomId: string;
  seat: Owner;
  setup: MatchSetup;
  status: 'matched' | 'waiting';
}

/** Ask the worker to place us in a match (queueing for PvP if needed). */
export async function matchmake(body: MatchmakeBody): Promise<Ticket> {
  const res = await fetch(`${serverHttpBase()}/api/matchmake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`matchmaking failed (${res.status})`);
  return (await res.json()) as Ticket;
}

/**
 * Matchmake, then open the authoritative room socket. The returned client holds
 * a provisional mirror of the state (built from the shared setup) that the
 * server's `welcome` immediately overwrites.
 */
export async function connectOnline(body: MatchmakeBody): Promise<OnlineMatchClient> {
  const ticket = await matchmake(body);
  const url = `${serverWsBase()}/api/room/${ticket.roomId}`;
  return new OnlineMatchClient({
    url,
    seat: ticket.seat,
    setup: ticket.setup,
    initialState: createMatchFromPresets(ticket.setup),
  });
}
