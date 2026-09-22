import { z } from 'zod';
import {
  commandSchema,
  gameEventSchema,
  gameModeSchema,
  gameStateSchema,
  matchSetupSchema,
  ownerSchema,
  warbandSchema,
} from './schema.js';

/**
 * The wire protocol between a client and the authoritative game room (a
 * Cloudflare Durable Object). Two discriminated unions, one per direction, both
 * tagged by `t`. Everything crossing the boundary is one of these; the room
 * parses inbound frames with {@link parseClientMessage} and never trusts a raw
 * payload.
 *
 * A room is joined by its short code. It starts in a *lobby*: the host (seat 0)
 * picks the map and game mode, each player picks their own army (and King), and
 * the match starts once both are ready. After a finished game either player can
 * call a rematch, which returns the room to its lobby.
 */

// --- Client -> Server -----------------------------------------------------

/** Take a seat on connect. The room hands out the first free one (host first). */
export const joinMessageSchema = z.object({ t: z.literal('join') }).strict();

/** Lobby: bring this army (and King) to your own seat. `preset` labels it: a
 *  preset id, or `custom` for an army-builder roster. */
export const setArmyMessageSchema = z
  .object({
    t: z.literal('setArmy'),
    preset: z.string().min(1).max(64),
    warband: warbandSchema,
    king: z.number().int().min(0),
  })
  .strict();

/** Lobby, host only: pick the built-in map and the game mode. */
export const setMapMessageSchema = z
  .object({ t: z.literal('setMap'), mapId: z.string().min(1).max(64), mode: gameModeSchema })
  .strict();

/** Lobby: toggle ready. The match starts once both seats are ready. */
export const readyMessageSchema = z.object({ t: z.literal('ready'), ready: z.boolean() }).strict();

/** Submit an intent. The room validates legality and authority before applying. */
export const commandMessageSchema = z
  .object({ t: z.literal('command'), command: commandSchema })
  .strict();

/** After a finished game: return the room to its lobby for another one. */
export const rematchMessageSchema = z.object({ t: z.literal('rematch') }).strict();

/** Ask for a fresh snapshot (the game state, or the lobby between games). */
export const resyncMessageSchema = z.object({ t: z.literal('resync') }).strict();

export const clientMessageSchema = z.discriminatedUnion('t', [
  joinMessageSchema,
  setArmyMessageSchema,
  setMapMessageSchema,
  readyMessageSchema,
  commandMessageSchema,
  rematchMessageSchema,
  resyncMessageSchema,
]);

export type JoinMessage = z.infer<typeof joinMessageSchema>;
export type SetArmyMessage = z.infer<typeof setArmyMessageSchema>;
export type SetMapMessage = z.infer<typeof setMapMessageSchema>;
export type ReadyMessage = z.infer<typeof readyMessageSchema>;
export type CommandMessage = z.infer<typeof commandMessageSchema>;
export type RematchMessage = z.infer<typeof rematchMessageSchema>;
export type ResyncMessage = z.infer<typeof resyncMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// --- Room creation (HTTP, client -> worker) ----------------------------------

/** Reply to `POST /api/rooms`: the new room's join code. */
export const createRoomResponseSchema = z.object({ code: z.string() }).strict();
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;

// --- Server -> Client -----------------------------------------------------

/** Presence of the two seats: which are filled by a live connection. Index by
 *  owner (0/1). AI-controlled seats report `true` (the server plays them). */
export const seatPresenceSchema = z.tuple([z.boolean(), z.boolean()]);
export type SeatPresence = z.infer<typeof seatPresenceSchema>;

/** One seat in the lobby: whether someone holds it, their army pick, and ready. */
export const lobbySeatSchema = z
  .object({
    present: z.boolean(),
    preset: z.string(),
    warband: warbandSchema,
    king: z.number().int().min(0),
    ready: z.boolean(),
  })
  .strict();

/** The room between games. `problem` says why these picks can't start a match
 *  (e.g. an army too big for the map's deploy zone), or is null. */
export const lobbySchema = z
  .object({
    mapId: z.string(),
    mode: gameModeSchema,
    seats: z.tuple([lobbySeatSchema, lobbySeatSchema]),
    problem: z.string().nullable(),
  })
  .strict();

export type LobbySeat = z.infer<typeof lobbySeatSchema>;
export type Lobby = z.infer<typeof lobbySchema>;

/** The lobby, re-sent to everyone on every change while no game is running. */
export const lobbyMessageSchema = z
  .object({ t: z.literal('lobby'), seat: ownerSchema, lobby: lobbySchema })
  .strict();

/** A game started (or you rejoined one): your seat, the match config, the full
 *  current state, and who else is present. */
export const welcomeMessageSchema = z
  .object({
    t: z.literal('welcome'),
    seat: ownerSchema,
    setup: matchSetupSchema,
    state: gameStateSchema,
    presence: seatPresenceSchema,
  })
  .strict();

/** An applied command: the new authoritative state plus the events it produced
 *  (for animation) and which seat played it. Broadcast to every connection. */
export const deltaMessageSchema = z
  .object({
    t: z.literal('delta'),
    by: ownerSchema,
    command: commandSchema,
    events: z.array(gameEventSchema),
    state: gameStateSchema,
  })
  .strict();

/** A full-state snapshot with no events, in reply to `resync`. */
export const syncMessageSchema = z
  .object({ t: z.literal('sync'), state: gameStateSchema })
  .strict();

/** Presence changed (a seat connected or dropped). */
export const presenceMessageSchema = z
  .object({ t: z.literal('presence'), presence: seatPresenceSchema })
  .strict();

/** A rejected message: bad frame, wrong seat, illegal move, not your turn — or
 *  a fatal one (no such room, room full) after which the room closes the socket. */
export const errorMessageSchema = z
  .object({ t: z.literal('error'), code: z.string(), message: z.string() })
  .strict();

export const serverMessageSchema = z.discriminatedUnion('t', [
  lobbyMessageSchema,
  welcomeMessageSchema,
  deltaMessageSchema,
  syncMessageSchema,
  presenceMessageSchema,
  errorMessageSchema,
]);

export type LobbyMessage = z.infer<typeof lobbyMessageSchema>;
export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>;
export type DeltaMessage = z.infer<typeof deltaMessageSchema>;
export type SyncMessage = z.infer<typeof syncMessageSchema>;
export type PresenceMessage = z.infer<typeof presenceMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Stable error codes so clients can branch without string-matching prose. */
export const ErrorCode = {
  BadFrame: 'bad_frame',
  NoSuchRoom: 'no_such_room',
  RoomFull: 'room_full',
  NotJoined: 'not_joined',
  NotHost: 'not_host',
  UnknownMap: 'unknown_map',
  NotInLobby: 'not_in_lobby',
  NoGame: 'no_game',
  NotYourTurn: 'not_your_turn',
  IllegalCommand: 'illegal_command',
  GameOver: 'game_over',
  GameNotOver: 'game_not_over',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// --- Parsing / serialisation helpers --------------------------------------

/** Parse and validate a raw inbound client frame (a JSON string or object). */
export function parseClientMessage(raw: unknown): ClientMessage {
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  return clientMessageSchema.parse(value);
}

/** Parse and validate a raw inbound server frame (a JSON string or object). */
export function parseServerMessage(raw: unknown): ServerMessage {
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  return serverMessageSchema.parse(value);
}

/** Non-throwing variants for hot paths that prefer a result to a try/catch. */
export function safeParseClientMessage(raw: unknown): z.SafeParseReturnType<unknown, ClientMessage> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return clientMessageSchema.safeParse(Symbol('unparseable'));
    }
  }
  return clientMessageSchema.safeParse(value);
}

/** Serialise any server message to a JSON wire frame. */
export function encode(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}
