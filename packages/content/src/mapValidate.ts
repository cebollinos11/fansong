import {
  GAME_MODES,
  isImpassableFeature,
  makeHexGrid,
  vecKey,
  type GameMode,
  type HexTerrain,
  type Vec,
} from '@fansong/engine';
import { mapHexAt, type MapDef } from './map.js';
import { DEFAULT_RULES } from './warband.js';

/** Size bounds for an authored map (built-in or editor-made). */
export interface MapLimits {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  /** Fewest hexes each deploy zone must have: room for a full warband. */
  minDeployHexes: number;
}

export const MAP_LIMITS: MapLimits = {
  minWidth: 6,
  maxWidth: 40,
  minHeight: 6,
  maxHeight: 40,
  minDeployHexes: DEFAULT_RULES.maxUnits,
};

export interface MapValidationResult {
  ok: boolean;
  errors: string[];
}

const fmt = (v: Vec) => `(${v.x},${v.y})`;

/**
 * Semantic checks on a structurally valid {@link MapDef} (see `parseMap`).
 * Reports *all* problems at once so the editor can list them together:
 *
 * - width/height within {@link MapLimits}, and exactly `width * height` hexes;
 * - each deploy zone in bounds, duplicate-free, on passable hexes, big enough
 *   for a warband, disjoint from the other, and every deploy hex reachable
 *   from every other over passable ground;
 * - every objective hex (flag bases, hill and conquest zones) reachable from
 *   the deploy zones, so no objective can be walled off;
 * - every objective the map *provides* is well-formed (in bounds, passable,
 *   non-empty zones, distinct flag bases, disjoint conquest zones, hill and
 *   conquest zones clear of deploy zones);
 * - when `mode` is given, the map also provides that mode's objectives.
 */
export function validateMap(
  map: MapDef,
  mode?: GameMode,
  limits: MapLimits = MAP_LIMITS,
): MapValidationResult {
  const errors: string[] = [];

  if (map.width < limits.minWidth || map.width > limits.maxWidth)
    errors.push(`width ${map.width} outside ${limits.minWidth}–${limits.maxWidth}`);
  if (map.height < limits.minHeight || map.height > limits.maxHeight)
    errors.push(`height ${map.height} outside ${limits.minHeight}–${limits.maxHeight}`);
  if (map.hexes.length !== map.width * map.height)
    errors.push(`expected ${map.width * map.height} hexes, got ${map.hexes.length}`);

  // Anything past here indexes hexes; bail if the grid itself is malformed.
  if (errors.length > 0) return { ok: false, errors };

  const passable = (v: Vec) => {
    const hex = mapHexAt(map, v);
    return hex !== undefined && !isImpassableFeature(hex.feature);
  };

  /** Bounds, passability and duplicates of one hex set; returns its keys. */
  const checkZone = (label: string, zone: Vec[], minSize = 1): Set<string> => {
    const keys = new Set<string>();
    if (zone.length < minSize)
      errors.push(`${label} needs at least ${minSize} hex${minSize === 1 ? '' : 'es'}, has ${zone.length}`);
    for (const v of zone) {
      const key = vecKey(v);
      if (keys.has(key)) errors.push(`${label}: duplicate hex ${fmt(v)}`);
      keys.add(key);
      if (mapHexAt(map, v) === undefined) errors.push(`${label}: hex ${fmt(v)} is off the map`);
      else if (!passable(v)) errors.push(`${label}: hex ${fmt(v)} is impassable`);
    }
    return keys;
  };

  const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((k) => b.has(k));

  // --- Deploy zones ---------------------------------------------------------
  const deploy = map.deployZones.map((zone, p) =>
    checkZone(`player ${p} deploy zone`, zone, limits.minDeployHexes),
  );
  const deployShared = overlap(deploy[0]!, deploy[1]!);
  if (deployShared.length > 0)
    errors.push(`deploy zones overlap at ${deployShared.join(' ')}`);
  const deployAll = new Set([...deploy[0]!, ...deploy[1]!]);

  const reach = walkableFromDeploy(map);
  const reachable = (v: Vec) => reach === undefined || reach.has(vecKey(v));
  const deployHexes = [...map.deployZones[0], ...map.deployZones[1]].filter(passable);
  if (!deployHexes.every(reachable)) errors.push('deploy hexes are not all connected by passable ground');
  /** Passable hexes of an objective that no unit can walk to (impassable ones are reported already). */
  const checkReachable = (label: string, zone: Vec[]) => {
    const cut = zone.filter((v) => passable(v) && !reachable(v));
    if (cut.length > 0) errors.push(`${label}: ${cut.map(fmt).join(' ')} unreachable from the deploy zones`);
  };

  // --- Objectives -----------------------------------------------------------
  const { flags, hill, conquest } = map.objectives;

  if (flags) {
    flags.forEach((v, p) => {
      checkZone(`player ${p} flag base`, [v]);
      checkReachable(`player ${p} flag base`, [v]);
    });
    if (vecKey(flags[0]) === vecKey(flags[1])) errors.push('flag bases share a hex');
  }

  const checkScoringZone = (label: string, zone: Vec[]): Set<string> => {
    const keys = checkZone(label, zone);
    checkReachable(label, zone);
    const shared = overlap(keys, deployAll);
    if (shared.length > 0) errors.push(`${label} overlaps a deploy zone at ${shared.join(' ')}`);
    return keys;
  };

  if (hill) checkScoringZone('hill zone', hill);

  if (conquest) {
    const zones = conquest.map((zone, i) => checkScoringZone(`conquest zone ${i + 1}`, zone));
    for (let i = 0; i < zones.length; i++)
      for (let j = i + 1; j < zones.length; j++) {
        const shared = overlap(zones[i]!, zones[j]!);
        if (shared.length > 0)
          errors.push(`conquest zones ${i + 1} and ${j + 1} overlap at ${shared.join(' ')}`);
      }
  }

  // --- Mode requirements ----------------------------------------------------
  if (mode) {
    const missing = missingObjective(map, mode);
    if (missing) errors.push(`${mode} needs ${missing}`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * The game modes a map can host: every mode whose objectives it provides,
 * provided the map as a whole validates (an invalid map supports nothing).
 * Annihilation and kill-the-king need no objectives, so every valid map hosts them.
 */
export function supportedModes(map: MapDef, limits: MapLimits = MAP_LIMITS): GameMode[] {
  if (!validateMap(map, undefined, limits).ok) return [];
  return GAME_MODES.filter((mode) => missingObjective(map, mode) === undefined);
}

/** What objective a mode needs that the map lacks, or undefined when it has it. */
function missingObjective(map: MapDef, mode: GameMode): string | undefined {
  switch (mode) {
    case 'annihilation':
    case 'kill-the-king':
      return undefined;
    case 'capture-the-flag':
      return map.objectives.flags ? undefined : 'flag bases';
    case 'king-of-the-hill':
      return map.objectives.hill ? undefined : 'a hill zone';
    case 'conquest':
      return map.objectives.conquest ? undefined : 'three conquest zones';
  }
}

/**
 * Every hex walkable from the first passable deploy hex (itself included), or
 * `undefined` when no deploy hex is passable (the zone errors already say so).
 * A deploy hex outside it would strand a unit (and could leave annihilation
 * unwinnable); an objective outside it could never be taken or held.
 */
function walkableFromDeploy(map: MapDef): Set<string> | undefined {
  const terrain: Record<string, HexTerrain> = {};
  map.hexes.forEach((hex, i) => {
    if (hex.feature) terrain[vecKey({ x: i % map.width, y: Math.floor(i / map.width) })] = { feature: hex.feature };
  });
  const board = makeHexGrid({ width: map.width, height: map.height, blocked: [], terrain });
  const first = [...map.deployZones[0], ...map.deployZones[1]].find((v) => board.inBounds(v) && !board.isBlocked(v));
  if (!first) return undefined;
  const reach = board.reachableWithin(first, map.width * map.height);
  reach.add(vecKey(first));
  return reach;
}
