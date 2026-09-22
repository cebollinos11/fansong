import type { GameMode, Owner } from '@fansong/engine';
import type { MatchSetup, Seat } from '@fansong/content';

/**
 * Matchmaking, as a pure state machine — no Cloudflare, no clock, no network —
 * so pairing is fully unit-tested. The Durable Object wrapper only supplies a
 * room-id source and forwards requests here.
 *
 * Two modes:
 *  - **pve**: an instant match against the in-room heuristic AI (seat 1).
 *  - **pvp**: the first player "hosts" — they define both warbands and the seed,
 *    take seat 0, and wait; the next player to queue drops into seat 1 of that
 *    same room. One host is paired per incoming opponent (FIFO).
 */

/** The match a requester asks for (a pvp joiner's is ignored — it plays the host's). */
interface MatchFields {
  seed: number;
  /** Built-in map id; omitted = the legacy default board. */
  mapId?: string;
  /** Game mode (named apart from the queue `mode`); omitted = annihilation. */
  gameMode?: GameMode;
  /** Kill-the-king: King index into each preset's units. */
  kings?: [number, number];
}

export interface MatchmakePvE extends MatchFields {
  mode: 'pve';
  /** [human warband, AI warband]. */
  presets: [string, string];
}

export interface MatchmakePvP extends MatchFields {
  mode: 'pvp';
  /** The host defines both sides; the joiner takes seat 1 as configured here. */
  presets: [string, string];
}

export type MatchmakeRequest = MatchmakePvE | MatchmakePvP;

export interface Ticket {
  roomId: string;
  /** The seat this requester will play. */
  seat: Owner;
  /** The finalised, identical-for-both-players match configuration. */
  setup: MatchSetup;
  /** `matched` = play now; `waiting` = you are hosting, the opponent is pending. */
  status: 'matched' | 'waiting';
}

export interface PendingRoom {
  roomId: string;
  setup: MatchSetup;
}

export class Matchmaker {
  /** Hosts waiting for an opponent, oldest first. */
  private readonly queue: PendingRoom[];

  /**
   * `newRoomId` is injected so tests get deterministic ids. `seedQueue` restores
   * a persisted waiting list (the Durable Object rehydrates from storage).
   */
  constructor(
    private readonly newRoomId: () => string,
    seedQueue: PendingRoom[] = [],
  ) {
    this.queue = [...seedQueue];
  }

  /** The current waiting list, for persistence. */
  snapshot(): PendingRoom[] {
    return [...this.queue];
  }

  request(req: MatchmakeRequest): Ticket {
    if (req.mode === 'pve') return this.pve(req);
    return this.pvp(req);
  }

  private pve(req: MatchmakePvE): Ticket {
    const setup = setupFor(req, ['human', 'ai']);
    return { roomId: this.newRoomId(), seat: 0, setup, status: 'matched' };
  }

  private pvp(req: MatchmakePvP): Ticket {
    const waiting = this.queue.shift();
    if (waiting) {
      // Join the oldest host as seat 1, using the host's finalised setup.
      return { roomId: waiting.roomId, seat: 1, setup: waiting.setup, status: 'matched' };
    }
    // No host waiting: become one.
    const setup = setupFor(req, ['human', 'human']);
    const roomId = this.newRoomId();
    this.queue.push({ roomId, setup });
    return { roomId, seat: 0, setup, status: 'waiting' };
  }

  /** Remove a waiting host (e.g. the hosting client disconnected before a match).
   *  Returns true if a pending room was dropped. */
  cancel(roomId: string): boolean {
    const i = this.queue.findIndex((r) => r.roomId === roomId);
    if (i === -1) return false;
    this.queue.splice(i, 1);
    return true;
  }

  /** Number of hosts currently waiting for an opponent. */
  pendingCount(): number {
    return this.queue.length;
  }
}

/**
 * The room's {@link MatchSetup} for a request. Map, mode and King picks are
 * copied only when given, so a plain request yields exactly the pre-map setup.
 */
export function setupFor(req: MatchmakeRequest, seats: [Seat, Seat]): MatchSetup {
  const setup: MatchSetup = { presets: [req.presets[0], req.presets[1]], seats, seed: req.seed };
  if (req.mapId !== undefined) setup.mapId = req.mapId;
  if (req.gameMode !== undefined) setup.mode = req.gameMode;
  if (req.kings !== undefined) setup.kings = [req.kings[0], req.kings[1]];
  return setup;
}
