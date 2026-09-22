import { getMap, listMaps, MAP_LIMITS, parseMap, validateMap, type MapDef, type MapLookup } from '@fansong/content';

/**
 * Custom (editor-made) maps, kept in `localStorage` as one JSON array. Every
 * function takes the storage explicitly (`null` = unavailable, e.g. a locked-down
 * browser) so the logic is testable without a DOM. Stored and imported maps are
 * untrusted: they go through {@link parseMapText}, which checks the structure and
 * the grid; semantic problems (deploy zones, objectives) are left to
 * `validateMap`, shown inline by the editor and used to hide unplayable maps
 * from the Setup picker.
 */

/** The storage surface used (a subset of the DOM `Storage`). */
export type MapStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const CUSTOM_MAPS_KEY = 'fansong.customMaps';

/** `window.localStorage`, or `null` if it is missing or access throws. */
export function browserStorage(): MapStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Parse an untrusted map (file text or stored entry). Throws a friendly `Error`
 * unless it is structurally a map with a well-formed grid inside the size
 * limits — enough for the editor to render and edit it safely.
 */
export function parseMapJson(raw: unknown): MapDef {
  const map = parseMap(raw);
  const { minWidth, maxWidth, minHeight, maxHeight } = MAP_LIMITS;
  if (map.width < minWidth || map.width > maxWidth || map.height < minHeight || map.height > maxHeight)
    throw new Error(`Map size ${map.width}×${map.height} is outside ${minWidth}–${maxWidth} × ${minHeight}–${maxHeight}.`);
  if (map.hexes.length !== map.width * map.height)
    throw new Error(`Map has ${map.hexes.length} hexes; a ${map.width}×${map.height} map needs ${map.width * map.height}.`);
  return map;
}

/** {@link parseMapJson} over the text of a `.json` file. */
export function parseMapText(text: string): MapDef {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  return parseMapJson(raw);
}

/**
 * The id a custom map is stored under: its own id, unless that belongs to a
 * built-in map (e.g. an editor map named "Old Forest"), which it must never
 * shadow — then `-custom` is appended.
 */
export function customMapId(id: string): string {
  return getMap(id) ? `${id}-custom` : id;
}

/** Every stored custom map (in save order). Corrupt storage or entries are skipped, never thrown. */
export function loadCustomMaps(storage: MapStorage | null): MapDef[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(CUSTOM_MAPS_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const maps: MapDef[] = [];
  for (const entry of raw) {
    try {
      const map = parseMapJson(entry);
      if (!getMap(map.id) && !maps.some((m) => m.id === map.id)) maps.push(map);
    } catch {
      // Skip entries this version can't read.
    }
  }
  return maps;
}

function writeMaps(storage: MapStorage | null, maps: readonly MapDef[]): void {
  if (!storage) throw new Error('Browser storage is unavailable.');
  try {
    storage.setItem(CUSTOM_MAPS_KEY, JSON.stringify(maps));
  } catch {
    throw new Error('Could not write to browser storage (is it full?).');
  }
}

/** The outcome of {@link saveCustomMap}: the map as stored and whether it replaced one. */
export interface SaveResult {
  map: MapDef;
  replaced: boolean;
}

/**
 * Save `map` under {@link customMapId}, replacing a stored map with the same id
 * in place (maps are keyed by their name's slug). Throws if storage fails.
 */
export function saveCustomMap(storage: MapStorage | null, map: MapDef): SaveResult {
  const stored: MapDef = { ...map, id: customMapId(map.id) };
  const maps = loadCustomMaps(storage);
  const i = maps.findIndex((m) => m.id === stored.id);
  if (i >= 0) maps[i] = stored;
  else maps.push(stored);
  writeMaps(storage, maps);
  return { map: stored, replaced: i >= 0 };
}

/** Remove the stored custom map with this id (no-op if absent). */
export function deleteCustomMap(storage: MapStorage | null, id: string): void {
  const maps = loadCustomMaps(storage);
  const kept = maps.filter((m) => m.id !== id);
  if (kept.length !== maps.length) writeMaps(storage, kept);
}

/** Stored custom maps that pass `validateMap` — the ones offered for play. */
export function playableCustomMaps(storage: MapStorage | null): MapDef[] {
  return loadCustomMaps(storage).filter((m) => validateMap(m).ok);
}

/** Built-in maps plus playable custom maps, in picker order. */
export function allPlayableMaps(storage: MapStorage | null): MapDef[] {
  return [...listMaps(), ...playableCustomMaps(storage)];
}

/**
 * A {@link MapLookup} that resolves built-in ids first, then playable custom
 * maps. Reads storage at call time, so it sees maps saved after it was made.
 */
export function customMapLookup(storage: MapStorage | null): MapLookup {
  return (id) => getMap(id) ?? playableCustomMaps(storage).find((m) => m.id === id);
}
