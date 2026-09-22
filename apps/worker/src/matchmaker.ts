import type { GameMode, Owner } from '@fansong/engine';
import { DEFAULT_MAP_ID, defaultKing, getPreset, type MatchSetup, type Seat, type Warband } from '@fansong/content';

/**
 * Matchmaking, as a pure state machine — no Cloudflare, no clock, no network —
 * so pairing is fully unit-tested. The Durable Object wrapper only supplies a
 * room-id source and forwards requests here.
 *
 * Two modes:
 *  - **pve**: an instant match against the in-room heuristic AI (seat 1).
 *  - **pvp**: the first player "hosts" — they bring their army and the seed,
 *    take seat 0, and wait; the next player to queue for the same map and game
 *    mode drops into seat 1 of that same room, bringing their own army. One host
 *    is paired per incoming opponent (FIFO within each map + mode).
 */

/**
 * The match a requester asks for. A pvp joiner's map and game mode pick which
 * host it pairs with; its seed is ignored (it plays the host's), but its own
 * army (side 0) and King take seat 1.
 */
interface MatchFields {
  seed: number;
  /** Explicit army-builder rosters; override `presets` when given. */
  warbands?: [Warband, Warband];
  /** Built-in map id; omitted = the legacy default board. */
  mapId?: string;
  /** Game mode (named apart from the queue `mode`); omitted = annihilation. */
  gameMode?: GameMode;
  /**
   * Kill-the-king: King index into each side's units. In pvp only index 0 (the
   * requester's own army) is honoured.
   */
  kings?: [number, number];
}

export interface MatchmakePvE extends MatchFields {
  mode: 'pve';
  /** [human warband, AI warband]. */
  presets: [string, string];
}

export interface MatchmakePvP extends MatchFields {
  mode: 'pvp';
  /** [own army, a stand-in for the opponent until one joins]. */
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
   * `accepts` vets a joined setup before a host is taken (e.g. the joiner's army
   * must fit the map's seat-1 deploy zone); a host it rejects stays queued.
   */
  constructor(
    private readonly newRoomId: () => string,
    seedQueue: PendingRoom[] = [],
    private readonly accepts: (setup: MatchSetup) => boolean = () => true,
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
    // Join the oldest host playing the same map and mode, as seat 1, bringing
    // our own army into the host's setup.
    const key = matchKey(req.mapId, req.gameMode);
    for (let i = 0; i < this.queue.length; i++) {
      const waiting = this.queue[i]!;
      if (matchKey(waiting.setup.mapId, waiting.setup.mode) !== key) continue;
      const setup = joinedSetup(waiting.setup, req);
      if (!this.accepts(setup)) continue;
      this.queue.splice(i, 1);
      return { roomId: waiting.roomId, seat: 1, setup, status: 'matched' };
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

  /** Number of hosts currently waiting for an opponent (across every map and mode). */
  pendingCount(): number {
    return this.queue.length;
  }
}

/**
 * Which pvp hosts a request can pair with: same map and same game mode. An
 * omitted map is the default one and an omitted mode is annihilation, so hosts
 * queued before maps existed (no map/mode keys) still pair with plain requests.
 */
function matchKey(mapId: string | undefined, mode: GameMode | undefined): string {
  return `${mapId ?? DEFAULT_MAP_ID}|${mode ?? 'annihilation'}`;
}

/**
 * The room's {@link MatchSetup} for a request. Map, mode, King picks and explicit
 * warbands are copied only when given, so a plain request yields exactly the
 * pre-map setup.
 *
 * In pvp the host never chooses the opponent's King: seat 1 gets its army's
 * `defaultKing` (an unknown preset falls back to 0; the setup is rejected anyway).
 */
export function setupFor(req: MatchmakeRequest, seats: [Seat, Seat]): MatchSetup {
  const setup: MatchSetup = { presets: [req.presets[0], req.presets[1]], seats, seed: req.seed };
  if (req.warbands !== undefined) setup.warbands = [req.warbands[0], req.warbands[1]];
  if (req.mapId !== undefined) setup.mapId = req.mapId;
  if (req.gameMode !== undefined) setup.mode = req.gameMode;
  if (req.kings !== undefined) {
    const opponent = setup.warbands?.[1] ?? getPreset(req.presets[1]);
    const seat1 = req.mode === 'pvp' ? (opponent ? defaultKing(opponent.units) : 0) : req.kings[1];
    setup.kings = [req.kings[0], seat1];
  }
  return setup;
}

/**
 * The final setup once a pvp joiner takes seat 1 of `host`: the host's setup
 * with the joiner's own army (its side 0) and King in seat 1. Armies stay as
 * preset ids when both sides are presets; otherwise both are written out.
 */
export function joinedSetup(host: MatchSetup, req: MatchmakePvP): MatchSetup {
  const { warbands: _, ...rest } = host;
  const setup: MatchSetup = { ...rest, presets: [host.presets[0], req.presets[0]] };
  const hostArmy = host.warbands?.[0] ?? getPreset(host.presets[0]);
  const joinArmy = req.warbands?.[0] ?? getPreset(req.presets[0]);
  if ((host.warbands || req.warbands) && hostArmy && joinArmy) setup.warbands = [hostArmy, joinArmy];
  if (host.kings) setup.kings = [host.kings[0], req.kings?.[0] ?? (joinArmy ? defaultKing(joinArmy.units) : 0)];
  return setup;
}
