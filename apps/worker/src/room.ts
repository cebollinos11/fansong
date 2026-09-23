import { isLegalCommand, reduce, type Command, type GameMode, type GameState, type Owner } from '@fansong/engine';
import {
  createMatchFromPresets,
  DEFAULT_MAP_ID,
  DEFAULT_SETUP,
  defaultKing,
  getMap,
  getPreset,
  type MatchSetup,
  type Warband,
} from '@fansong/content';
import {
  ErrorCode,
  encode,
  safeParseClientMessage,
  type Lobby,
  type ServerMessage,
  type SeatPresence,
} from '@fansong/protocol';

/**
 * A single sink for outbound frames — a WebSocket in production, a fake in
 * tests. The room speaks only this interface, so its entire behaviour (seats,
 * the lobby, authority, legality, presence) is exercised headlessly by Vitest
 * with zero Cloudflare runtime.
 */
export interface RoomConnection {
  readonly id: string;
  send(frame: string): void;
}

/**
 * Why `setup` cannot start a room, or `null` if it can. It is the exact build
 * the room runs (`createMatchFromPresets` against the built-in maps — the worker
 * never sees a browser's custom maps), so this rejects unknown maps, a mode the
 * map has no objectives for, an illegal or oversized army and out-of-range King
 * picks up front, instead of a room that throws when the game starts.
 */
export function setupError(setup: MatchSetup): string | null {
  try {
    createMatchFromPresets(setup);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** A seat's army pick in the lobby. */
export interface ArmyPick {
  /** A preset id, or `custom` for an army-builder roster. */
  preset: string;
  warband: Warband;
  king: number;
}

/** What survives a Durable Object restart: the lobby picks and any running game. */
export interface RoomSnapshot {
  mapId: string;
  mode: GameMode;
  picks: [ArmyPick, ArmyPick];
  game: { setup: MatchSetup; state: GameState } | null;
}

/** A fresh room: the default board in annihilation, each seat with a default preset. */
export function newRoomSnapshot(): RoomSnapshot {
  const pick = (seat: Owner): ArmyPick => {
    const preset = DEFAULT_SETUP.presets[seat];
    const warband = getPreset(preset)!;
    return { preset, warband, king: defaultKing(warband.units) };
  };
  return { mapId: DEFAULT_MAP_ID, mode: 'annihilation', picks: [pick(0), pick(1)], game: null };
}

/**
 * The match the lobby's picks describe. Both rosters are always written out;
 * the default map, annihilation and (outside kill-the-king) Kings stay implicit.
 */
export function lobbySetup(room: Pick<RoomSnapshot, 'mapId' | 'mode' | 'picks'>, seed: number): MatchSetup {
  const [a, b] = room.picks;
  const setup: MatchSetup = {
    presets: [a.preset, b.preset],
    warbands: [a.warband, b.warband],
    seats: ['human', 'human'],
    seed,
  };
  if (room.mapId !== DEFAULT_MAP_ID) setup.mapId = room.mapId;
  if (room.mode !== 'annihilation') setup.mode = room.mode;
  if (room.mode === 'kill-the-king') setup.kings = [a.king, b.king];
  return setup;
}

interface Member {
  conn: RoomConnection;
  seat: Owner | null;
}

/**
 * The authoritative game room, transport-agnostic. Between games it is a lobby:
 * the host (seat 0) picks map and mode, each player their own army, and once
 * both are ready the room builds the match. During a game it is the server-side
 * twin of the web client's `MatchController`: it owns the one true `GameState`,
 * and every command runs through the same `applyCommand` guard (validate against
 * `getLegalCommands`, then `reduce`) the CLI and UI use. No rules live here.
 */
export class RoomEngine {
  private readonly members = new Map<string, Member>();
  /** connId currently holding each seat (undefined = open). */
  private readonly seatHolder: (string | undefined)[] = [undefined, undefined];
  private readonly ready: [boolean, boolean] = [false, false];
  private readonly room: RoomSnapshot;

  /** `newSeed` picks each game's seed (injected so tests are deterministic). */
  constructor(
    snapshot: RoomSnapshot = newRoomSnapshot(),
    private readonly newSeed: () => number = () => Math.floor(Math.random() * 2 ** 31),
  ) {
    this.room = snapshot;
  }

  /** Everything worth persisting. */
  snapshot(): RoomSnapshot {
    return this.room;
  }

  /** The running (or just finished) game's state; null in the lobby. */
  getState(): GameState | null {
    return this.room.game?.state ?? null;
  }

  /** The running game's setup; null in the lobby. */
  get setup(): MatchSetup | null {
    return this.room.game?.setup ?? null;
  }

  /** Register a freshly opened connection. It holds no seat until it `join`s. */
  onConnect(conn: RoomConnection): void {
    this.members.set(conn.id, { conn, seat: null });
  }

  /** Drop a connection, freeing any seat it held and telling whoever is left. */
  onDisconnect(conn: RoomConnection): void {
    const member = this.members.get(conn.id);
    if (!member) return;
    this.members.delete(conn.id);
    if (member.seat === null || this.seatHolder[member.seat] !== conn.id) return;
    this.seatHolder[member.seat] = undefined;
    this.ready[member.seat] = false;
    if (this.room.game) this.broadcast({ t: 'presence', presence: this.presence() });
    else this.broadcastLobby();
  }

  /** Handle one raw inbound frame from `conn` (a JSON string). */
  onMessage(conn: RoomConnection, raw: string): void {
    const member = this.members.get(conn.id);
    if (!member) return; // frame from an unregistered socket; ignore.

    const parsed = safeParseClientMessage(raw);
    if (!parsed.success) {
      this.error(conn, ErrorCode.BadFrame, 'malformed message');
      return;
    }
    const msg = parsed.data;
    if (msg.t === 'join') {
      this.handleJoin(member);
      return;
    }
    if (member.seat === null) {
      this.error(conn, ErrorCode.NotJoined, 'join the room first');
      return;
    }
    const seat = member.seat;
    switch (msg.t) {
      case 'setArmy':
        if (!this.inLobby(conn)) break;
        this.room.picks[seat] = { preset: msg.preset, warband: msg.warband, king: msg.king };
        this.lobbyChanged();
        break;
      case 'setMap':
        if (!this.inLobby(conn)) break;
        if (seat !== 0) {
          this.error(conn, ErrorCode.NotHost, 'only the host picks the map');
          break;
        }
        if (!getMap(msg.mapId)) {
          this.error(conn, ErrorCode.UnknownMap, `unknown map "${msg.mapId}"`);
          break;
        }
        this.room.mapId = msg.mapId;
        this.room.mode = msg.mode;
        this.lobbyChanged();
        break;
      case 'ready':
        if (!this.inLobby(conn)) break;
        this.ready[seat] = msg.ready;
        if (!this.tryStart()) this.broadcastLobby();
        break;
      case 'command':
        this.handleCommand(conn, seat, msg.command);
        break;
      case 'rematch':
        if (!this.room.game) {
          this.error(conn, ErrorCode.NoGame, 'no game is running');
        } else if (this.room.game.state.phase !== 'gameOver') {
          this.error(conn, ErrorCode.GameNotOver, 'the game is still going');
        } else {
          this.room.game = null;
          this.lobbyChanged();
        }
        break;
      case 'resync':
        if (this.room.game) this.sendTo(conn, { t: 'sync', state: this.room.game.state });
        else this.sendTo(conn, { t: 'lobby', seat, lobby: this.lobby() });
        break;
    }
  }

  // --- seats ----------------------------------------------------------------

  /** Seat a connection in the first free seat (the host's first), then show it
   *  the room: the running game, or the lobby. */
  private handleJoin(member: Member): void {
    if (member.seat === null) {
      const free = ([0, 1] as const).find((s) => this.seatHolder[s] === undefined);
      if (free === undefined) {
        this.error(member.conn, ErrorCode.RoomFull, 'this room already has two players');
        return;
      }
      member.seat = free;
      this.seatHolder[free] = member.conn.id;
    }
    if (this.room.game) {
      this.sendTo(member.conn, this.welcome(member.seat));
      this.broadcastExcept(member.conn, { t: 'presence', presence: this.presence() });
    } else {
      this.broadcastLobby();
    }
  }

  /** A seat is "present" while a live socket holds it. */
  presence(): SeatPresence {
    return [this.seatHolder[0] !== undefined, this.seatHolder[1] !== undefined];
  }

  // --- lobby ----------------------------------------------------------------

  /** The lobby as the clients see it. */
  lobby(): Lobby {
    const { mapId, mode, picks } = this.room;
    const presence = this.presence();
    return {
      mapId,
      mode,
      seats: [
        { ...picks[0], present: presence[0], ready: this.ready[0] },
        { ...picks[1], present: presence[1], ready: this.ready[1] },
      ],
      problem: setupError(lobbySetup(this.room, 0)),
    };
  }

  private inLobby(conn: RoomConnection): boolean {
    if (!this.room.game) return true;
    this.error(conn, ErrorCode.NotInLobby, 'a game is running');
    return false;
  }

  /** Any change to the picks asks both players to confirm again. */
  private lobbyChanged(): void {
    this.ready[0] = this.ready[1] = false;
    this.broadcastLobby();
  }

  /** Start the game if both seats are held, ready, and the picks can start one. */
  private tryStart(): boolean {
    const [p0, p1] = this.presence();
    if (!p0 || !p1 || !this.ready[0] || !this.ready[1]) return false;
    const setup = lobbySetup(this.room, this.newSeed());
    if (setupError(setup) !== null) return false;
    this.room.game = { setup, state: createMatchFromPresets(setup) };
    this.ready[0] = this.ready[1] = false;
    for (const member of this.members.values()) {
      if (member.seat !== null) this.sendTo(member.conn, this.welcome(member.seat));
    }
    return true;
  }

  // --- game -----------------------------------------------------------------

  private handleCommand(conn: RoomConnection, seat: Owner, command: Command): void {
    const game = this.room.game;
    if (!game) {
      this.error(conn, ErrorCode.NoGame, 'no game is running');
      return;
    }
    if (game.state.phase === 'gameOver') {
      this.error(conn, ErrorCode.GameOver, 'the game is over');
      return;
    }
    if (game.state.active !== seat) {
      this.error(conn, ErrorCode.NotYourTurn, 'not your turn');
      return;
    }
    // Legality is checked here rather than through `applyCommand` so a rejected
    // command answers with a code instead of a throw. Enumerating the legal set
    // walks every unit's reach, so it is done once and `reduce` runs directly.
    if (!isLegalCommand(game.state, command)) {
      this.error(conn, ErrorCode.IllegalCommand, 'command is not legal in the current state');
      return;
    }
    const { state, events } = reduce(game.state, command);
    game.state = state;
    this.broadcast({ t: 'delta', by: seat, command, events, state });
  }

  // --- io -------------------------------------------------------------------

  private welcome(seat: Owner): ServerMessage {
    const game = this.room.game!;
    return { t: 'welcome', seat, setup: game.setup, state: game.state, presence: this.presence() };
  }

  /** The lobby to every seated member, each told their own seat. */
  private broadcastLobby(): void {
    const lobby = this.lobby();
    for (const { conn, seat } of this.members.values()) {
      if (seat !== null) this.sendTo(conn, { t: 'lobby', seat, lobby });
    }
  }

  private error(conn: RoomConnection, code: string, message: string): void {
    this.sendTo(conn, { t: 'error', code, message });
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
