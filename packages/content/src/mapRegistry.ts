import crossroads from '../maps/crossroads.json';
import oldForest from '../maps/old-forest.json';
import openField from '../maps/open-field.json';
import rockyPass from '../maps/rocky-pass.json';
import rollingHills from '../maps/rolling-hills.json';
import stoneCrown from '../maps/stone-crown.json';
import ruinedVillage from '../maps/ruined-village.json';
import twinTowers from '../maps/twin-towers.json';
import { parseMap, type MapDef } from './map.js';
import { validateMap } from './mapValidate.js';

/**
 * Built-in maps, loaded from `packages/content/maps/*.json`. Each file is
 * imported explicitly (so every bundler — Vite, wrangler, tsx — inlines it) and
 * checked once at load: structure via {@link parseMap}, semantics via
 * {@link validateMap}. A broken built-in map is a programming error, so it
 * throws rather than being skipped. A test asserts every JSON file in the
 * directory is registered here and that each file is named after its map id.
 *
 * Order is the display order of the Setup map picker; the first map is the
 * default.
 */
const RAW_MAPS: unknown[] = [openField, rollingHills, oldForest, ruinedVillage, rockyPass, twinTowers, crossroads, stoneCrown];

function load(json: unknown): MapDef {
  const map = parseMap(json);
  const { ok, errors } = validateMap(map);
  if (!ok) throw new Error(`built-in map "${map.id}" is invalid: ${errors.join('; ')}`);
  return map;
}

const BUILTIN_MAPS: readonly MapDef[] = RAW_MAPS.map(load);

const BY_ID = new Map<string, MapDef>();
for (const map of BUILTIN_MAPS) {
  if (BY_ID.has(map.id)) throw new Error(`duplicate built-in map id "${map.id}"`);
  BY_ID.set(map.id, map);
}

/** The id of the map used when a match doesn't pick one. */
export const DEFAULT_MAP_ID = 'open-field';

/** Every built-in map, in picker order. */
export function listMaps(): readonly MapDef[] {
  return BUILTIN_MAPS;
}

/** The built-in map with this id, or undefined. */
export function getMap(id: string): MapDef | undefined {
  return BY_ID.get(id);
}
