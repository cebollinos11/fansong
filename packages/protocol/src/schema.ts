import { z } from 'zod';
import { MAX_ELEVATION, TERRAIN_FEATURES } from '@fansong/engine';
import type {
  AttackCommand,
  BoardData,
  ChooseActivation,
  Command,
  EndActivation,
  GameEvent,
  GameState,
  GuardCommand,
  HexTerrain,
  MoveCommand,
  Owner,
  ShootCommand,
  TerrainFeature,
  Unit,
} from '@fansong/engine';
import type { MatchSetup, Seat } from '@fansong/content';

/**
 * Wire schemas. These are the trust boundary: a Durable Object never `reduce`s a
 * command it has not run through {@link commandSchema} first, so a malformed or
 * hostile client payload is rejected before it can touch authoritative state.
 * The engine still has the final say on *legality* (via `getLegalCommands`);
 * these schemas only guarantee a value is structurally a `Command` at all.
 *
 * Each schema is checked against the engine's own types at the bottom of this
 * file (`satisfies`), so the two cannot silently drift.
 */

export const ownerSchema = z.union([z.literal(0), z.literal(1)]);

export const vecSchema = z
  .object({ x: z.number().int(), y: z.number().int() })
  .strict();

// --- Commands (untrusted input — validated strictly) ----------------------

export const chooseActivationSchema = z
  .object({
    type: z.literal('ChooseActivation'),
    unitId: z.string().min(1),
    diceCount: z.number().int().min(1).max(3),
  })
  .strict();

export const moveCommandSchema = z
  .object({
    type: z.literal('Move'),
    unitId: z.string().min(1),
    to: vecSchema,
  })
  .strict();

export const attackCommandSchema = z
  .object({
    type: z.literal('Attack'),
    attackerId: z.string().min(1),
    targetId: z.string().min(1),
  })
  .strict();

export const shootCommandSchema = z
  .object({
    type: z.literal('Shoot'),
    attackerId: z.string().min(1),
    targetId: z.string().min(1),
  })
  .strict();

export const guardCommandSchema = z
  .object({
    type: z.literal('Guard'),
    unitId: z.string().min(1),
  })
  .strict();

export const endActivationSchema = z
  .object({ type: z.literal('EndActivation') })
  .strict();

export const commandSchema = z.discriminatedUnion('type', [
  chooseActivationSchema,
  moveCommandSchema,
  attackCommandSchema,
  shootCommandSchema,
  guardCommandSchema,
  endActivationSchema,
]);

// --- State (server-authoritative — schema exists for shape + resync checks) --

export const terrainFeatureSchema = z.enum(TERRAIN_FEATURES as [TerrainFeature, ...TerrainFeature[]]);

/** One hex's non-default terrain; both keys optional (sparse, like the engine). */
export const hexTerrainSchema = z
  .object({
    elevation: z.number().int().min(0).max(MAX_ELEVATION).optional(),
    feature: terrainFeatureSchema.optional(),
  })
  .strict();

export const boardDataSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    blocked: z.array(z.string()),
    terrain: z.record(z.string().regex(/^\d+,\d+$/), hexTerrainSchema).optional(),
  })
  .strict();

export const unitTraitsSchema = z
  .object({
    ranged: z.number().int().min(0),
    tough: z.boolean(),
    guard: z.boolean(),
  })
  .strict();

export const unitSchema = z
  .object({
    id: z.string(),
    owner: ownerSchema,
    name: z.string(),
    quality: z.number(),
    combat: z.number(),
    move: z.number(),
    pos: vecSchema,
    dead: z.boolean(),
    knockedDown: z.boolean(),
    activatedThisRound: z.boolean(),
    traits: unitTraitsSchema,
    guarding: z.boolean(),
  })
  .strict();

export const phaseSchema = z.enum(['awaitingActivation', 'acting', 'gameOver']);

export const gameStateSchema = z
  .object({
    board: boardDataSchema,
    units: z.array(unitSchema),
    round: z.number().int(),
    initiativeLeader: ownerSchema,
    active: ownerSchema,
    benched: z.tuple([z.boolean(), z.boolean()]),
    broken: z.tuple([z.boolean(), z.boolean()]),
    startCount: z.tuple([z.number().int(), z.number().int()]),
    phase: phaseSchema,
    activeUnitId: z.string().nullable(),
    actionsRemaining: z.number().int(),
    activationCount: z.number().int(),
    rngState: z.number(),
    winner: ownerSchema.nullable(),
  })
  .strict();

// --- Events (server -> client, for animation) -----------------------------

const combatResultSchema = z.enum([
  'defenderKilled',
  'defenderKnockedDown',
  'attackerKilled',
  'attackerKnockedDown',
  'clash',
]);

export const gameEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ActivationChosen'), player: ownerSchema, unitId: z.string(), diceCount: z.number() }),
  z.object({
    type: z.literal('DiceRolled'),
    unitId: z.string(),
    quality: z.number(),
    dice: z.array(z.number()),
    successes: z.number(),
    failures: z.number(),
  }),
  z.object({ type: z.literal('Turnover'), player: ownerSchema, unitId: z.string() }),
  z.object({ type: z.literal('UnitStoodUp'), unitId: z.string() }),
  z.object({ type: z.literal('UnitMoved'), unitId: z.string(), from: vecSchema, to: vecSchema }),
  z.object({
    type: z.literal('AttackResolved'),
    attackerId: z.string(),
    targetId: z.string(),
    attackDie: z.number(),
    defenseDie: z.number(),
    attackScore: z.number(),
    defenseScore: z.number(),
    attackBonus: z.number().optional(),
    defenseBonus: z.number().optional(),
    result: combatResultSchema,
  }),
  z.object({
    type: z.literal('ShotResolved'),
    attackerId: z.string(),
    targetId: z.string(),
    attackDie: z.number(),
    defenseDie: z.number(),
    attackScore: z.number(),
    defenseScore: z.number(),
    attackBonus: z.number().optional(),
    defenseBonus: z.number().optional(),
    result: combatResultSchema,
  }),
  z.object({ type: z.literal('GuardDeclared'), unitId: z.string() }),
  z.object({
    type: z.literal('GuardRiposte'),
    guardId: z.string(),
    attackerId: z.string(),
    guardDie: z.number(),
    attackerDie: z.number(),
    guardScore: z.number(),
    attackerScore: z.number(),
    guardBonus: z.number().optional(),
    attackerBonus: z.number().optional(),
    result: combatResultSchema,
    prevented: z.boolean(),
  }),
  z.object({ type: z.literal('ToughnessSaved'), unitId: z.string() }),
  z.object({
    type: z.literal('NerveCheck'),
    unitId: z.string(),
    quality: z.number(),
    die: z.number(),
    passed: z.boolean(),
  }),
  z.object({ type: z.literal('WarbandBroken'), player: ownerSchema }),
  z.object({ type: z.literal('UnitRouted'), unitId: z.string() }),
  z.object({ type: z.literal('UnitKnockedDown'), unitId: z.string() }),
  z.object({ type: z.literal('UnitKilled'), unitId: z.string(), byId: z.string().nullable() }),
  z.object({ type: z.literal('ActivationEnded'), unitId: z.string() }),
  z.object({ type: z.literal('RoundEnded'), round: z.number(), nextLeader: ownerSchema }),
  z.object({ type: z.literal('GameOver'), winner: ownerSchema }),
]);

// --- Match setup ----------------------------------------------------------

export const seatSchema: z.ZodType<Seat> = z.enum(['human', 'ai']);

export const matchSetupSchema = z
  .object({
    presets: z.tuple([z.string(), z.string()]),
    seats: z.tuple([seatSchema, seatSchema]),
    seed: z.number().int(),
    mapId: z.string().min(1).max(64).optional(),
  })
  .strict();

// --- Drift guards: schema output must equal the engine's own types ---------
// If a stat is added to a Unit or a Command variant changes, one of these lines
// stops compiling — the schema and the engine are kept in lockstep by the type
// checker, not by discipline.

type Expect<T extends true> = T;
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type CommandFromSchema = z.infer<typeof commandSchema>;
export type GameEventFromSchema = z.infer<typeof gameEventSchema>;
export type GameStateFromSchema = z.infer<typeof gameStateSchema>;
export type MatchSetupFromSchema = z.infer<typeof matchSetupSchema>;

/** Compile-time drift guard; every entry must stay `true` (see above). */
export type SchemaDriftChecks = [
  Expect<Eq<CommandFromSchema, Command>>,
  Expect<Eq<GameEventFromSchema, GameEvent>>,
  Expect<Eq<GameStateFromSchema, GameState>>,
  Expect<Eq<MatchSetupFromSchema, MatchSetup>>,
  // Individual command variants line up too.
  Expect<Eq<z.infer<typeof chooseActivationSchema>, ChooseActivation>>,
  Expect<Eq<z.infer<typeof moveCommandSchema>, MoveCommand>>,
  Expect<Eq<z.infer<typeof attackCommandSchema>, AttackCommand>>,
  Expect<Eq<z.infer<typeof shootCommandSchema>, ShootCommand>>,
  Expect<Eq<z.infer<typeof guardCommandSchema>, GuardCommand>>,
  Expect<Eq<z.infer<typeof endActivationSchema>, EndActivation>>,
  Expect<Eq<z.infer<typeof unitSchema>, Unit>>,
  Expect<Eq<z.infer<typeof boardDataSchema>, BoardData>>,
  Expect<Eq<z.infer<typeof hexTerrainSchema>, HexTerrain>>,
  Expect<Eq<z.infer<typeof ownerSchema>, Owner>>,
];
