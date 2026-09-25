import { z } from 'zod';
import { GAME_MODES, MAX_ELEVATION, TERRAIN_FEATURES } from '@fansong/engine';
import type {
  AttackCommand,
  BoardData,
  ChooseActivation,
  Command,
  EndActivation,
  FlagState,
  GameConfig,
  GameEvent,
  GameMode,
  GameState,
  GuardCommand,
  HexTerrain,
  ModeObjectives,
  ModeState,
  MoveCommand,
  Owner,
  ShootCommand,
  TerrainFeature,
  Unit,
  UnitSpec,
} from '@fansong/engine';
import { ARMY_RULES, MAP_LIMITS, NAME_LIMITS, SHOOTER_KINDS, STAT_BOUNDS, type MatchSetup, type Seat, type Warband } from '@fansong/content';

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
    /** A power blow: two actions for one swing the defender meets at a penalty. */
    power: z.literal(true).optional(),
  })
  .strict();

export const shootCommandSchema = z
  .object({
    type: z.literal('Shoot'),
    attackerId: z.string().min(1),
    targetId: z.string().min(1),
    /** An aimed shot: two actions for one shot the target meets at a penalty. */
    aimed: z.literal(true).optional(),
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
    slow: z.boolean(),
    fast: z.boolean(),
    ranged: z.number().int().min(0),
    tough: z.boolean(),
    guard: z.boolean(),
    big: z.boolean(),
    flying: z.boolean(),
    reassembling: z.boolean(),
    mounted: z.boolean(),
    opportunist: z.boolean(),
  })
  .strict();

export const unitSchema = z
  .object({
    id: z.string(),
    owner: ownerSchema,
    name: z.string(),
    look: z.string().optional(),
    quality: z.number(),
    combat: z.number(),
    pos: vecSchema,
    dead: z.boolean(),
    knockedDown: z.boolean(),
    activatedThisRound: z.boolean(),
    traits: unitTraitsSchema,
    guarding: z.boolean(),
  })
  .strict();

export const phaseSchema = z.enum(['awaitingActivation', 'acting', 'gameOver']);

export const gameModeSchema = z.enum(GAME_MODES as [GameMode, ...GameMode[]]);

export const modeObjectivesSchema = z
  .object({
    flags: z.tuple([vecSchema, vecSchema]).optional(),
    hill: z.array(vecSchema).optional(),
    conquest: z.tuple([z.array(vecSchema), z.array(vecSchema), z.array(vecSchema)]).optional(),
  })
  .strict();

export const flagStateSchema = z.object({ at: vecSchema, carrier: z.string().nullable() }).strict();

export const modeStateSchema = z
  .object({
    mode: z.enum(['capture-the-flag', 'king-of-the-hill', 'conquest', 'kill-the-king']),
    objectives: modeObjectivesSchema,
    scores: z.tuple([z.number().int(), z.number().int()]),
    kings: z.tuple([z.string(), z.string()]).optional(),
    flags: z.tuple([flagStateSchema, flagStateSchema]).optional(),
  })
  .strict();

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
    mode: modeStateSchema.optional(),
  })
  .strict();

// --- Events (server -> client, for animation) -----------------------------

const combatResultSchema = z.enum([
  'defenderKilled',
  'defenderKnockedDown',
  'defenderRecoiled',
  'attackerKilled',
  'attackerKnockedDown',
  'attackerRecoiled',
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
  z.object({ type: z.literal('UnitStoodUp'), unitId: z.string(), reassembled: z.boolean().optional() }),
  z.object({
    type: z.literal('UnitMoved'),
    unitId: z.string(),
    from: vecSchema,
    to: vecSchema,
    path: z.array(vecSchema).optional(),
  }),
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
    attackOutnumbered: z.number().optional(),
    defenseOutnumbered: z.number().optional(),
    attackBig: z.number().optional(),
    defenseBig: z.number().optional(),
    attackFly: z.number().optional(),
    attackMounted: z.number().optional(),
    defenseMounted: z.number().optional(),
    attackOpportunist: z.number().optional(),
    defenseOpportunist: z.number().optional(),
    powerPenalty: z.number().optional(),
    result: combatResultSchema,
    gruesome: z.literal(true).optional(),
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
    rangePenalty: z.number().optional(),
    coverPenalty: z.number().optional(),
    bigTarget: z.number().optional(),
    flyingTarget: z.number().optional(),
    attackOpportunist: z.number().optional(),
    aimPenalty: z.number().optional(),
    result: combatResultSchema,
    gruesome: z.literal(true).optional(),
  }),
  z.object({
    type: z.literal('FreeHackResolved'),
    attackerId: z.string(),
    targetId: z.string(),
    attackDie: z.number(),
    defenseDie: z.number(),
    attackScore: z.number(),
    defenseScore: z.number(),
    attackBonus: z.number().optional(),
    defenseBonus: z.number().optional(),
    attackOutnumbered: z.number().optional(),
    defenseOutnumbered: z.number().optional(),
    attackBig: z.number().optional(),
    defenseBig: z.number().optional(),
    attackFly: z.number().optional(),
    attackMounted: z.number().optional(),
    defenseMounted: z.number().optional(),
    attackOpportunist: z.number().optional(),
    defenseOpportunist: z.number().optional(),
    result: combatResultSchema,
    gruesome: z.literal(true).optional(),
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
    guardOutnumbered: z.number().optional(),
    attackerOutnumbered: z.number().optional(),
    guardBig: z.number().optional(),
    attackerBig: z.number().optional(),
    guardFly: z.number().optional(),
    guardMounted: z.number().optional(),
    attackerMounted: z.number().optional(),
    guardOpportunist: z.number().optional(),
    attackerOpportunist: z.number().optional(),
    result: combatResultSchema,
    gruesome: z.literal(true).optional(),
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
  z.object({
    type: z.literal('UnitFled'),
    unitId: z.string(),
    from: vecSchema,
    to: vecSchema,
    path: z.array(vecSchema),
  }),
  z.object({ type: z.literal('UnitKnockedDown'), unitId: z.string() }),
  z.object({ type: z.literal('UnitRecoiled'), unitId: z.string(), from: vecSchema, to: vecSchema }),
  z.object({ type: z.literal('UnitSupported'), unitId: z.string(), supporterId: z.string() }),
  z.object({ type: z.literal('UnitPushedOff'), unitId: z.string() }),
  z.object({ type: z.literal('UnitKilled'), unitId: z.string(), byId: z.string().nullable() }),
  z.object({ type: z.literal('ActivationEnded'), unitId: z.string() }),
  z.object({ type: z.literal('RoundEnded'), round: z.number(), nextLeader: ownerSchema }),
  z.object({
    type: z.literal('ScoreChanged'),
    player: ownerSchema,
    points: z.number().int(),
    scores: z.tuple([z.number().int(), z.number().int()]),
    zone: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('FlagPickedUp'), player: ownerSchema, unitId: z.string() }),
  z.object({ type: z.literal('FlagDropped'), player: ownerSchema, unitId: z.string(), at: vecSchema }),
  z.object({ type: z.literal('FlagReturned'), player: ownerSchema, unitId: z.string() }),
  z.object({ type: z.literal('FlagCaptured'), player: ownerSchema, unitId: z.string() }),
  z.object({
    type: z.literal('GameOver'),
    winner: ownerSchema,
    reason: z.enum(['annihilation', 'score', 'roundLimit', 'king', 'flag']).optional(),
  }),
]);

// --- Game config (untrusted input: a replay file) -------------------------

const stat = ([min, max]: readonly [number, number]) => z.number().int().min(min).max(max);



/**
 * A unit as a replay's config places it. Stats are held to {@link STAT_BOUNDS}
 * — the same range the army builder and every preset are checked against — so a
 * recorded game always round-trips while a hand-edited file cannot smuggle in a
 * profile the rules could never have produced.
 */
export const unitSpecSchema = z
  .object({
    name: z.string().max(NAME_LIMITS.unit),
    quality: stat(STAT_BOUNDS.quality),
    combat: stat(STAT_BOUNDS.combat),
    pos: vecSchema,
    slow: z.boolean().optional(),
    fast: z.boolean().optional(),
    // A raw range: the Shooter traits give 3, 5 or 7, and replays recorded before them reach up to 8.
    ranged: stat([0, 8]).optional(),
    tough: z.boolean().optional(),
    guard: z.boolean().optional(),
    big: z.boolean().optional(),
    flying: z.boolean().optional(),
    reassembling: z.boolean().optional(),
    mounted: z.boolean().optional(),
    opportunist: z.boolean().optional(),
    king: z.boolean().optional(),
    look: z.string().max(64).optional(),
  })
  .strict()
  .refine((u) => !(u.slow && u.fast), { message: 'a unit cannot be both slow and fast' });

/**
 * The starting config of a game — the trust boundary for a **replay file**,
 * which is the one place an untrusted config reaches `createGame`. Sizes are
 * bounded (board to {@link MAP_LIMITS}, rosters to {@link ARMY_RULES}; Move is
 * fixed by the Slow/Fast traits) so that replaying a hostile file cannot ask the
 * engine to walk an astronomically large board.
 */
export const gameConfigSchema = z
  .object({
    seed: z.number().int(),
    board: z
      .object({
        width: z.number().int().min(MAP_LIMITS.minWidth).max(MAP_LIMITS.maxWidth),
        height: z.number().int().min(MAP_LIMITS.minHeight).max(MAP_LIMITS.maxHeight),
        blocked: z.array(z.string()).max(MAP_LIMITS.maxWidth * MAP_LIMITS.maxHeight).optional(),
        terrain: z.record(z.string().regex(/^\d+,\d+$/), hexTerrainSchema).optional(),
      })
      .strict(),
    warbands: z.tuple([
      z.array(unitSpecSchema).max(ARMY_RULES.maxUnits),
      z.array(unitSpecSchema).max(ARMY_RULES.maxUnits),
    ]),
    initiativeLeader: ownerSchema.optional(),
    mode: gameModeSchema.optional(),
    objectives: modeObjectivesSchema.optional(),
  })
  .strict();

// --- Match setup ----------------------------------------------------------

export const seatSchema: z.ZodType<Seat> = z.enum(['human', 'ai']);

/**
 * An army-builder unit as it crosses the wire. Only the shape and sizes are
 * checked here; stat ranges and roster rules are `validateArmy`'s job (the room
 * runs it when it builds the match).
 */
export const warbandUnitSchema = z
  .object({
    name: z.string().max(NAME_LIMITS.unit),
    quality: z.number().int(),
    combat: z.number().int(),
    shooter: z.enum(SHOOTER_KINDS).optional(),
    slow: z.boolean().optional(),
    fast: z.boolean().optional(),
    tough: z.boolean().optional(),
    guard: z.boolean().optional(),
    big: z.boolean().optional(),
    flying: z.boolean().optional(),
    reassembling: z.boolean().optional(),
    mounted: z.boolean().optional(),
    opportunist: z.boolean().optional(),
    look: z.string().max(64).optional(),
  })
  .strict();

export const warbandSchema = z
  .object({
    name: z.string().max(NAME_LIMITS.warband),
    units: z.array(warbandUnitSchema).max(ARMY_RULES.maxUnits),
  })
  .strict();

export const matchSetupSchema = z
  .object({
    presets: z.tuple([z.string(), z.string()]),
    warbands: z.tuple([warbandSchema, warbandSchema]).optional(),
    seats: z.tuple([seatSchema, seatSchema]),
    seed: z.number().int(),
    mapId: z.string().min(1).max(64).optional(),
    mode: gameModeSchema.optional(),
    kings: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
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
export type GameConfigFromSchema = z.infer<typeof gameConfigSchema>;

/** Compile-time drift guard; every entry must stay `true` (see above). */
export type SchemaDriftChecks = [
  Expect<Eq<CommandFromSchema, Command>>,
  Expect<Eq<GameEventFromSchema, GameEvent>>,
  Expect<Eq<GameStateFromSchema, GameState>>,
  Expect<Eq<MatchSetupFromSchema, MatchSetup>>,
  Expect<Eq<GameConfigFromSchema, GameConfig>>,
  Expect<Eq<z.infer<typeof unitSpecSchema>, UnitSpec>>,
  Expect<Eq<z.infer<typeof warbandSchema>, Warband>>,
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
  Expect<Eq<z.infer<typeof gameModeSchema>, GameMode>>,
  Expect<Eq<z.infer<typeof modeObjectivesSchema>, ModeObjectives>>,
  Expect<Eq<z.infer<typeof modeStateSchema>, ModeState>>,
  Expect<Eq<z.infer<typeof flagStateSchema>, FlagState>>,
];
