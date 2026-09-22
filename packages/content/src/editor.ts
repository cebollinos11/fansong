import { MAX_ELEVATION, makeHexGrid, vecKey, type TerrainFeature, type Vec } from '@fansong/engine';
import { flatMap, type MapDef, type MapHex, type MapObjectives } from './map.js';

/**
 * Pure terrain-editor model. Every operation takes a {@link MapDef} and returns
 * a new one (inputs are never mutated), so the web editor can preview a stroke
 * on the present map and commit it to an {@link EditorHistory} as one undo step.
 *
 * Operations don't refuse "bad" edits (a rock on a deploy hex, an empty
 * conquest zone): the editor shows `validateMap` errors inline instead, so an
 * author can pass through invalid intermediate states.
 */

/** Brush radii the editor offers (0 = single hex). */
export const MAX_BRUSH_RADIUS = 2;

/** Lowercase-hyphenated slug for a map name (`"My Map!"` → `"my-map"`). */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'custom-map';
}

/** A fresh flat map of the given size, with default edge deploy zones and no objectives. */
export function newEditorMap(width: number, height: number, name = 'New Map'): MapDef {
  return flatMap(width, height, slugify(name), name);
}

/** Rename a map; its id follows the name. */
export function renameMap(map: MapDef, name: string): MapDef {
  return { ...map, name, id: slugify(name) };
}

const inBounds = (map: MapDef, v: Vec) => v.x >= 0 && v.y >= 0 && v.x < map.width && v.y < map.height;

/** In-bounds hexes within `radius` (clamped to 0–{@link MAX_BRUSH_RADIUS}) of `center`, centre first. */
export function brushCells(map: MapDef, center: Vec, radius: number): Vec[] {
  if (!inBounds(map, center)) return [];
  const r = Math.max(0, Math.min(MAX_BRUSH_RADIUS, Math.floor(radius)));
  const grid = makeHexGrid({ width: map.width, height: map.height, blocked: [] });
  return [center, ...grid.cellsWithin(center, r)];
}

/**
 * The drag-fill region between two corner hexes: every in-bounds hex in the
 * offset-coordinate rectangle they span (row-major). Used for forest/rock
 * fills and multi-hex building footprints.
 */
export function regionCells(map: MapDef, a: Vec, b: Vec): Vec[] {
  const cells: Vec[] = [];
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (inBounds(map, { x, y })) cells.push({ x, y });
  }
  return cells;
}

/** Apply `f` to the terrain of each listed (in-bounds) hex. */
function editHexes(map: MapDef, cells: readonly Vec[], f: (hex: MapHex) => MapHex): MapDef {
  const hexes = map.hexes.slice();
  for (const v of cells) {
    if (!inBounds(map, v)) continue;
    const i = v.y * map.width + v.x;
    hexes[i] = f(hexes[i] ?? { elevation: 0 });
  }
  return { ...map, hexes };
}

const withFeature = (elevation: number, feature: TerrainFeature | undefined): MapHex =>
  feature === undefined ? { elevation } : { elevation, feature };

const clampElevation = (e: number) => Math.max(0, Math.min(MAX_ELEVATION, e));

export type ElevationBrush = { kind: 'raise' } | { kind: 'lower' } | { kind: 'set'; value: number };

/** Raise/lower by one, or set to a level, clamped to 0–MAX_ELEVATION. */
export function paintElevation(map: MapDef, cells: readonly Vec[], brush: ElevationBrush): MapDef {
  return editHexes(map, cells, (hex) => {
    const e =
      brush.kind === 'raise' ? hex.elevation + 1 : brush.kind === 'lower' ? hex.elevation - 1 : brush.value;
    return withFeature(clampElevation(e), hex.feature);
  });
}

/** Place `feature` on the hexes, or remove any feature when `undefined`. Elevation is kept. */
export function paintFeature(map: MapDef, cells: readonly Vec[], feature: TerrainFeature | undefined): MapDef {
  return editHexes(map, cells, (hex) => withFeature(hex.elevation, feature));
}

/** Erase terrain: flat, open ground. Deploy zones and objectives are untouched. */
export function eraseTerrain(map: MapDef, cells: readonly Vec[]): MapDef {
  return editHexes(map, cells, () => ({ elevation: 0 }));
}

// --- Deploy zones & objectives ----------------------------------------------

const keysOf = (cells: readonly Vec[]) => new Set(cells.map(vecKey));

/** Add (`on`) or remove the hexes from a zone, keeping order and no duplicates. */
function editZone(zone: readonly Vec[], cells: readonly Vec[], on: boolean): Vec[] {
  const drop = keysOf(cells);
  const kept = zone.filter((v) => !drop.has(vecKey(v)));
  if (!on) return kept;
  const seen = new Set<string>();
  const added: Vec[] = [];
  for (const v of cells) {
    const k = vecKey(v);
    if (!seen.has(k)) added.push({ x: v.x, y: v.y });
    seen.add(k);
  }
  return [...kept, ...added];
}

const inside = (map: MapDef, cells: readonly Vec[]) => cells.filter((v) => inBounds(map, v));

/**
 * Add hexes to (or remove them from) `player`'s deploy zone. Adding also takes
 * them out of the other player's zone, so the zones stay disjoint.
 */
export function paintDeploy(map: MapDef, player: 0 | 1, cells: readonly Vec[], on = true): MapDef {
  const c = inside(map, cells);
  const other = (1 - player) as 0 | 1;
  const zones: [Vec[], Vec[]] = [map.deployZones[0].slice(), map.deployZones[1].slice()];
  zones[player] = editZone(zones[player], c, on);
  if (on) zones[other] = editZone(zones[other], c, false);
  return { ...map, deployZones: zones };
}

/** The point-mirror of a hex (the symmetry built-in maps use). */
export function mirrorHex(map: MapDef, v: Vec): Vec {
  return { x: map.width - 1 - v.x, y: map.height - 1 - v.y };
}

/** Set objectives, dropping keys that are undefined so the JSON stays sparse. */
function withObjectives(map: MapDef, objectives: MapObjectives): MapDef {
  const clean: MapObjectives = {};
  if (objectives.flags) clean.flags = objectives.flags;
  if (objectives.hill) clean.hill = objectives.hill;
  if (objectives.conquest) clean.conquest = objectives.conquest;
  return { ...map, objectives: clean };
}

/**
 * Place `player`'s flag base. Flags come in pairs, so on a map without flags
 * the other player's base starts at the point-mirror hex.
 */
export function setFlag(map: MapDef, player: 0 | 1, v: Vec): MapDef {
  if (!inBounds(map, v)) return map;
  const flags: [Vec, Vec] = map.objectives.flags
    ? [map.objectives.flags[0], map.objectives.flags[1]]
    : player === 0
      ? [v, mirrorHex(map, v)]
      : [mirrorHex(map, v), v];
  flags[player] = { x: v.x, y: v.y };
  return withObjectives(map, { ...map.objectives, flags });
}

export function clearFlags(map: MapDef): MapDef {
  return withObjectives(map, { ...map.objectives, flags: undefined });
}

/** Add hexes to (or remove them from) the hill zone; an emptied hill is removed. */
export function paintHill(map: MapDef, cells: readonly Vec[], on = true): MapDef {
  const hill = editZone(map.objectives.hill ?? [], inside(map, cells), on);
  return withObjectives(map, { ...map.objectives, hill: hill.length > 0 ? hill : undefined });
}

/**
 * Add hexes to (or remove them from) conquest zone `index` (0–2). Adding takes
 * them out of the other two zones. When all three zones are empty the conquest
 * objective is removed.
 */
export function paintConquest(map: MapDef, index: 0 | 1 | 2, cells: readonly Vec[], on = true): MapDef {
  const c = inside(map, cells);
  const prev = map.objectives.conquest ?? [[], [], []];
  const zones = prev.map((zone, i) =>
    i === index ? editZone(zone, c, on) : on ? editZone(zone, c, false) : zone.slice(),
  ) as [Vec[], Vec[], Vec[]];
  const empty = zones.every((z) => z.length === 0);
  return withObjectives(map, { ...map.objectives, conquest: empty ? undefined : zones });
}

// --- Undo / redo ---------------------------------------------------------------

/** Undo stack depth kept by {@link commitEdit}. */
export const MAX_UNDO = 100;

export interface EditorHistory {
  present: MapDef;
  /** Older states, most recent last. */
  past: MapDef[];
  /** Undone states, most recent last (the next redo). */
  future: MapDef[];
}

export function createHistory(map: MapDef): EditorHistory {
  return { present: map, past: [], future: [] };
}

const sameMap = (a: MapDef, b: MapDef) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Make `next` the present as one undo step and clear redo. A no-op edit (the
 * map is unchanged) leaves the history as it was.
 */
export function commitEdit(h: EditorHistory, next: MapDef): EditorHistory {
  if (sameMap(h.present, next)) return h;
  const past = [...h.past, h.present];
  return { present: next, past: past.slice(Math.max(0, past.length - MAX_UNDO)), future: [] };
}

export const canUndo = (h: EditorHistory) => h.past.length > 0;
export const canRedo = (h: EditorHistory) => h.future.length > 0;

export function undoEdit(h: EditorHistory): EditorHistory {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { present: prev, past: h.past.slice(0, -1), future: [...h.future, h.present] };
}

export function redoEdit(h: EditorHistory): EditorHistory {
  const next = h.future[h.future.length - 1];
  if (!next) return h;
  return { present: next, past: [...h.past, h.present], future: h.future.slice(0, -1) };
}
