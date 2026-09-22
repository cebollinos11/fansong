import { applyCommand, isLegalCommand, type Command, type GameState, type Owner } from '@fansong/engine';
import { chooseCommand } from '@fansong/ai';
import { createMatchFromPresets, isAiSeat, type MatchSetup } from '@fansong/content';
import {
  ErrorCode,
  encode,
  safeParseClientMessage,
  type ServerMessage,
  type SeatPresence,
} from '@fansong/protocol';

/**
 * A single sink for outbound frames — a WebSocket in production, a fake in
 * tests. The room speaks only this interface, so its entire behaviour (seat
 * binding, authority, legality, AI turns, presence) is exercised headlessly by
 * Vitest with zero Cloudflare runtime.
 */
export interface RoomConnection {
  readonly id: string;
  send(frame: string): void;
}

/**
 * Why `setup` cannot start a room, or `null` if it can. It is the exact build
 * the room runs (`createMatchFromPresets` against the built-in maps — the worker
 * never sees a browser's custom maps), so this rejects unknown presets or maps,
 * a mode the map has no objectives for, and out-of-range King picks up front,
 * instead of a room that throws when its first socket connects.
 */
export function setupError(setup: MatchSetup): string | null {
  try {
    createMatchFromPresets(setup);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface Member {
  conn: RoomConnection;
  seat: Owner | null;
}

/**
 * The authoritative game room, transport-agnostic. It is the server-side twin of
 * the web client's `MatchController`: it owns the one true `GameState`, and every
 * command is run through the same `applyCommand` guard (validate against
 * `getLegalCommands`, then `reduce`) the CLI and UI use — so the server can never
 * accept a move the client's own legality check would have refused, and vice
 * versa. AI-controlled seats are played in-process with the same `chooseCommand`
 * heuristic as the CLI and the test bot. No rules live here; it only routes.
 */
export class RoomEngine {
  private state: GameState;
  private readonly members = new Map<string, Member>();
  /** connId currently bound to each human seat (undefined = open). */
  private readonly seatHolder: (string | undefined)[] = [undefined, undefined];
  private currentSetup: MatchSetup;
  private pendingOpponent: boolean;

  /**
   * `pending` marks a pvp host's room whose seat 1 army is still a stand-in: no
   * command is accepted until {@link finalize} swaps in the joiner's army.
   */
  constructor(setup: MatchSetup, initial?: GameState, opts: { pending?: boolean } = {}) {
    this.currentSetup = setup;
    this.pendingOpponent = opts.pending ?? false;
    this.state = initial ?? createMatchFromPresets(setup);
  }

  get setup(): MatchSetup {
    return this.currentSetup;
  }

  getState(): GameState {
    return this.state;
  }

  /** Whether seat 1's army is still a stand-in awaiting the joiner's. */
  isPending(): boolean {
    return this.pendingOpponent;
  }

  /**
   * Swap in the final setup once a pvp opponent is matched (their army in seat
   * 1), rebuild the untouched starting state, and re-welcome everyone seated so
   * the host sees the real opposing army. Only a pending room can be finalised
   * — no command has been played in one. Returns false (and changes nothing)
   * otherwise, or if the setup cannot start a match.
   */
  finalize(setup: MatchSetup): boolean {
    if (!this.pendingOpponent || setupError(setup) !== null) return false;
    this.currentSetup = setup;
    this.state = createMatchFromPresets(setup);
    this.pendingOpponent = false;
    for (const member of this.members.values()) {
      if (member.seat === null) continue;
      this.sendTo(member.conn, {
        t: 'welcome',
        seat: member.seat,
        setup: this.currentSetup,
        state: this.state,
        presence: this.presence(),
      });
    }
    return true;
  }

  /** Register a freshly opened connection. It holds no seat until it `join`s. */
  onConnect(conn: RoomConnection): void {
    this.members.set(conn.id, { conn, seat: null });
  }

  /** Drop a connection, freeing any seat it held and updating presence. */
  onDisconnect(conn: RoomConnection): void {
    const member = this.members.get(conn.id);
    if (!member) return;
    if (member.seat !== null && this.seatHolder[member.seat] === conn.id) {
      this.seatHolder[member.seat] = undefined;
    }
    this.members.delete(conn.id);
    this.broadcast({ t: 'presence', presence: this.presence() });
  }

  /** Handle one raw inbound frame from `conn` (a JSON string). */
  onMessage(conn: RoomConnection, raw: string): void {
    const member = this.members.get(conn.id);
    if (!member) return; // frame from an unregistered socket; ignore.

    const parsed = safeParseClientMessage(raw);
    if (!parsed.success) {
      this.sendTo(conn, { t: 'error', code: ErrorCode.BadFrame, message: 'malformed message' });
      return;
    }
    const msg = parsed.data;
    switch (msg.t) {
      case 'join':
        this.handleJoin(member, msg.seat);
        break;
      case 'command':
        this.handleCommand(member, msg.command);
        break;
      case 'resync':
        this.sendTo(conn, { t: 'sync', state: this.state });
        break;
    }
  }

  // --- join -----------------------------------------------------------------

  private handleJoin(member: Member, seat: Owner): void {
    if (isAiSeat(this.setup, seat)) {
      this.sendTo(member.conn, {
        t: 'error',
        code: ErrorCode.NotYourSeat,
        message: `seat ${seat} is AI-controlled`,
      });
      return;
    }
    const holder = this.seatHolder[seat];
    if (holder !== undefined && holder !== member.conn.id) {
      this.sendTo(member.conn, {
        t: 'error',
        code: ErrorCode.SeatTaken,
        message: `seat ${seat} is already held`,
      });
      return;
    }
    // Release any prior seat this connection held (a client re-joining a new seat).
    if (member.seat !== null && member.seat !== seat && this.seatHolder[member.seat] === member.conn.id) {
      this.seatHolder[member.seat] = undefined;
    }
    member.seat = seat;
    this.seatHolder[seat] = member.conn.id;

    this.sendTo(member.conn, {
      t: 'welcome',
      seat,
      setup: this.setup,
      state: this.state,
      presence: this.presence(),
    });
    // The joiner already has presence in its welcome; tell everyone else.
    this.broadcastExcept(member.conn, { t: 'presence', presence: this.presence() });

    // The AI may lead the round (or need to move before any human command),
    // e.g. when it holds initiative. Kick it once a human is present.
    this.drainAi();
  }

  // --- command --------------------------------------------------------------

  private handleCommand(member: Member, command: Command): void {
    if (member.seat === null) {
      this.sendTo(member.conn, { t: 'error', code: ErrorCode.NotJoined, message: 'join a seat first' });
      return;
    }
    if (this.state.phase === 'gameOver') {
      this.sendTo(member.conn, { t: 'error', code: ErrorCode.GameOver, message: 'the game is over' });
      return;
    }
    if (this.pendingOpponent) {
      this.sendTo(member.conn, {
        t: 'error',
        code: ErrorCode.WaitingForOpponent,
        message: 'waiting for an opponent to join',
      });
      return;
    }
    if (this.state.active !== member.seat) {
      this.sendTo(member.conn, { t: 'error', code: ErrorCode.NotYourTurn, message: 'not your turn' });
      return;
    }
    if (!isLegalCommand(this.state, command)) {
      this.sendTo(member.conn, {
        t: 'error',
        code: ErrorCode.IllegalCommand,
        message: 'command is not legal in the current state',
      });
      return;
    }

    this.applyAndBroadcast(member.seat, command);
    this.drainAi();
  }

  // --- AI seats -------------------------------------------------------------

  /**
   * While it is an AI seat's turn, play the heuristic move and broadcast it,
   * until control returns to a human or the game ends. Deterministic: the same
   * state always yields the same drained sequence, so a replay matches.
   */
  private drainAi(): void {
    let guard = 0;
    while (this.state.phase !== 'gameOver' && isAiSeat(this.setup, this.state.active)) {
      const seat = this.state.active;
      const command = chooseCommand(this.state);
      this.applyAndBroadcast(seat, command);
      if (++guard > 10_000) throw new Error('AI drain did not terminate');
    }
  }

  private applyAndBroadcast(seat: Owner, command: Command): void {
    const { state, events } = applyCommand(this.state, command);
    this.state = state;
    this.broadcast({ t: 'delta', by: seat, command, events, state });
  }

  // --- presence / io --------------------------------------------------------

  /** A seat is "present" if the server plays it (AI) or a live socket holds it. */
  presence(): SeatPresence {
    const filled = (seat: Owner): boolean => isAiSeat(this.setup, seat) || this.seatHolder[seat] !== undefined;
    return [filled(0), filled(1)];
  }

  private sendTo(conn: RoomConnection, msg: ServerMessage): void {
    conn.send(encode(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const frame = encode(msg);
    for (const { conn } of this.members.values()) conn.send(frame);
  }

  private broadcastExcept(except: RoomConnection, msg: ServerMessage): void {
    const frame = encode(msg);
    for (const { conn } of this.members.values()) {
      if (conn.id !== except.id) conn.send(frame);
    }
  }
}
