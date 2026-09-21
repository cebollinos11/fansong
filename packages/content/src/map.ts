import { z } from 'zod';
import { MAX_ELEVATION, TERRAIN_FEATURES, type TerrainFeature, type Vec } from '@fansong/engine';

/**
 * Map format. A {@link MapDef} is the authored, JSON-serialisable description of
 * a battlefield: its size, the terrain of every hex, where each player deploys,
 * and the objectives the game modes use. Built-in maps live in
 * `packages/content/maps/*.json`; the editor produces the same shape.
 *
 * The zod schema here checks *structure* only (types, ranges, no stray keys).
 * Semantic checks — size limits, hex count, deploy zones on passable hexes,
 * objectives valid for a mode — live in `validateMap`.
 */

/** Terrain of one hex. `feature` is omitted for open ground. */
export interface MapHex {
  elevation: number;
  feature?: TerrainFeature;
}

/**
 * Objective placements. Every key is optional; which ones a map provides decides
 * which game modes it supports.
 */
export interface MapObjectives {
  /** Capture-the-flag: the flag base hex of player 0 and player 1. */
  flags?: [Vec, Vec];
  /** King-of-the-hill: the hexes of the single scoring zone. */
  hill?: Vec[];
  /** Conquest: exactly three scoring zones, each a set of hexes. */
  conquest?: [Vec[], Vec[], Vec[]];
}

export interface MapDef {
  /** Stable slug, e.g. `"rolling-hills"`. */
  id: string;
  name: string;
  width: number;
  height: number;
  /** Row-major terrain: the hex at `(x, y)` is `hexes[y * width + x]`. */
  hexes: MapHex[];
  /** Deployment hexes for player 0 and player 1. */
  deployZones: [Vec[], Vec[]];
  objectives: MapObjectives;
}

const mapVecSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

const zoneSchema = z.array(mapVecSchema);

export const mapHexSchema = z
  .object({
    elevation: z.number().int().min(0).max(MAX_ELEVATION),
    feature: z.enum(TERRAIN_FEATURES as [TerrainFeature, ...TerrainFeature[]]).optional(),
  })
  .strict();

export const mapObjectivesSchema = z
  .object({
    flags: z.tuple([mapVecSchema, mapVecSchema]).optional(),
    hill: zoneSchema.optional(),
    conquest: z.tuple([zoneSchema, zoneSchema, zoneSchema]).optional(),
  })
  .strict();

export const mapDefSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be a lowercase-hyphenated slug'),
    name: z.string().trim().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    hexes: z.array(mapHexSchema),
    deployZones: z.tuple([zoneSchema, zoneSchema]),
    objectives: mapObjectivesSchema,
  })
  .strict();

/** Parse unknown JSON as a {@link MapDef} (structure only), or throw a readable error. */
export function parseMap(json: unknown): MapDef {
  const result = mapDefSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`invalid map: ${issues.join('; ')}`);
  }
  return result.data;
}

/** The terrain of hex `v`, or undefined when it's outside the map / hex list. */
export function mapHexAt(map: MapDef, v: Vec): MapHex | undefined {
  if (v.x < 0 || v.y < 0 || v.x >= map.width || v.y >= map.height) return undefined;
  return map.hexes[v.y * map.width + v.x];
}

type Expect<T extends true> = T;
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compile-time drift guard: the schema and the hand-written types must agree. */
export type MapSchemaDriftChecks = [
  Expect<Eq<z.infer<typeof mapDefSchema>, MapDef>>,
  Expect<Eq<z.infer<typeof mapHexSchema>, MapHex>>,
  Expect<Eq<z.infer<typeof mapObjectivesSchema>, MapObjectives>>,
];
