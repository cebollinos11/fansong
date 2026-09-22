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
 */

// --- Client -> Server -----------------------------------------------------

/** Claim a seat on (re)connect. The seat is assigned by matchmaking; the client
 *  echoes it so the room can bind this socket to a player (and reject spoofs of
 *  a seat already held by another live socket). */
export const joinMessageSchema = z
  .object({ t: z.literal('join'), seat: ownerSchema })
  .strict();

/** Submit an intent. The room validates legality and authority before applying. */
export const commandMessageSchema = z
  .object({ t: z.literal('command'), command: commandSchema })
  .strict();

/** Ask for a fresh full-state snapshot (e.g. after a reconnect or a dropped frame). */
export const resyncMessageSchema = z.object({ t: z.literal('resync') }).strict();

export const clientMessageSchema = z.discriminatedUnion('t', [
  joinMessageSchema,
  commandMessageSchema,
  resyncMessageSchema,
]);

export type JoinMessage = z.infer<typeof joinMessageSchema>;
export type CommandMessage = z.infer<typeof commandMessageSchema>;
export type ResyncMessage = z.infer<typeof resyncMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// --- Matchmaking (HTTP, client -> worker) -----------------------------------

/**
 * Body of `POST /api/matchmake`. `mode` is the *queue* (pve = vs the in-room AI,
 * pvp = host or join a human); the match itself is described by `presets` (or
 * explicit army-builder `warbands`, which override them), `seed` and the
 * optional map / game mode / King picks, which the worker copies into the room's
 * `MatchSetup` (only when present, so default setups stay byte-identical).
 * `mapId` must name a built-in map — the worker cannot see a browser's custom
 * maps. A pvp request only pairs with a host queued for the same map and game
 * mode. In pvp each player brings their own army as side 0 (with its King as
 * `kings[0]`): the host's side 1 is only a stand-in until an opponent joins,
 * whose own army then takes seat 1; the host's seed is kept.
 */
export const matchmakeRequestSchema = z
  .object({
    mode: z.enum(['pve', 'pvp']),
    presets: z.tuple([z.string().min(1).max(64), z.string().min(1).max(64)]),
    warbands: z.tuple([warbandSchema, warbandSchema]).optional(),
    seed: z.number().int(),
    mapId: z.string().min(1).max(64).optional(),
    gameMode: gameModeSchema.optional(),
    kings: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  })
  .strict();

export type MatchmakeRequestBody = z.infer<typeof matchmakeRequestSchema>;

// --- Server -> Client -----------------------------------------------------

/** Presence of the two seats: which are filled by a live connection. Index by
 *  owner (0/1). AI-controlled seats report `true` (the server plays them). */
export const seatPresenceSchema = z.tuple([z.boolean(), z.boolean()]);
export type SeatPresence = z.infer<typeof seatPresenceSchema>;

/** First message after a successful join: your seat, the match config, the full
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

/** A rejected message: bad frame, wrong seat, illegal move, not your turn. */
export const errorMessageSchema = z
  .object({ t: z.literal('error'), code: z.string(), message: z.string() })
  .strict();

export const serverMessageSchema = z.discriminatedUnion('t', [
  welcomeMessageSchema,
  deltaMessageSchema,
  syncMessageSchema,
  presenceMessageSchema,
  errorMessageSchema,
]);

export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>;
export type DeltaMessage = z.infer<typeof deltaMessageSchema>;
export type SyncMessage = z.infer<typeof syncMessageSchema>;
export type PresenceMessage = z.infer<typeof presenceMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Stable error codes so clients can branch without string-matching prose. */
export const ErrorCode = {
  BadFrame: 'bad_frame',
  NotJoined: 'not_joined',
  SeatTaken: 'seat_taken',
  NotYourSeat: 'not_your_seat',
  NotYourTurn: 'not_your_turn',
  IllegalCommand: 'illegal_command',
  GameOver: 'game_over',
  WaitingForOpponent: 'waiting_for_opponent',
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
