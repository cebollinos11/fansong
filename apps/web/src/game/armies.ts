import { ARMY_RULES, parseWarband, PRESETS, validateArmy, type Warband } from '@fansong/content';
import type { MapStorage } from './customMaps.js';

/**
 * Army-builder armies, kept in `localStorage` as one JSON array next to the
 * custom maps. Like maps, every function takes the storage explicitly (`null` =
 * unavailable) so the logic is testable without a DOM, and stored or imported
 * armies are untrusted: they go through {@link parseWarband}.
 */

/** A saved army: a stable id (so renaming keeps it) and its roster. */
export interface SavedArmy {
  id: string;
  warband: Warband;
}

export const ARMIES_KEY = 'fansong.armies';

/** A setup-screen side value naming a saved army (preset ids are used as-is). */
const ARMY_PREFIX = 'army:';

export function armyChoice(id: string): string {
  return `${ARMY_PREFIX}${id}`;
}

/**
 * The warband a setup-screen side value fields: a preset id, or `army:<id>` for
 * a saved army. `undefined` if it names neither (e.g. a deleted army).
 */
export function choiceWarband(choice: string, armies: readonly SavedArmy[]): Warband | undefined {
  if (!choice.startsWith(ARMY_PREFIX)) return PRESETS[choice];
  const id = choice.slice(ARMY_PREFIX.length);
  return armies.find((a) => a.id === id)?.warband;
}

/** Whether a side value is a saved army rather than a preset. */
export function isArmyChoice(choice: string): boolean {
  return choice.startsWith(ARMY_PREFIX);
}

/** Every stored army (in save order). Corrupt storage or entries are skipped, never thrown. */
export function loadArmies(storage: MapStorage | null): SavedArmy[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(ARMIES_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const armies: SavedArmy[] = [];
  for (const entry of raw) {
    try {
      const { id, warband } = entry as { id?: unknown; warband?: unknown };
      if (typeof id !== 'string' || armies.some((a) => a.id === id)) continue;
      armies.push({ id, warband: parseWarband(warband) });
    } catch {
      // Skip entries this version can't read.
    }
  }
  return armies;
}

/** Stored armies that pass `validateArmy` — the ones offered for play. */
export function playableArmies(storage: MapStorage | null): SavedArmy[] {
  return loadArmies(storage).filter((a) => validateArmy(a.warband).ok);
}

function writeArmies(storage: MapStorage | null, armies: readonly SavedArmy[]): void {
  if (!storage) throw new Error('Browser storage is unavailable.');
  try {
    storage.setItem(ARMIES_KEY, JSON.stringify(armies));
  } catch {
    throw new Error('Could not write to browser storage (is it full?).');
  }
}

/** Save `army`, replacing a stored one with the same id in place. Throws if storage fails. */
export function saveArmy(storage: MapStorage | null, army: SavedArmy): SavedArmy[] {
  const armies = loadArmies(storage);
  const i = armies.findIndex((a) => a.id === army.id);
  if (i >= 0) armies[i] = army;
  else armies.push(army);
  writeArmies(storage, armies);
  return armies;
}

/** Remove the stored army with this id (no-op if absent). */
export function deleteArmy(storage: MapStorage | null, id: string): SavedArmy[] {
  const armies = loadArmies(storage);
  const kept = armies.filter((a) => a.id !== id);
  if (kept.length !== armies.length) writeArmies(storage, kept);
  return kept;
}

/** A fresh id no stored army uses. */
export function newArmyId(existing: readonly SavedArmy[], now: number = Date.now()): string {
  let n = now;
  while (existing.some((a) => a.id === `a${n.toString(36)}`)) n++;
  return `a${n.toString(36)}`;
}

/**
 * Parse an imported army file. Throws a friendly `Error` unless it is a warband
 * whose roster fits {@link ARMY_RULES}' size (stat problems are left for the
 * builder to show and fix).
 */
export function parseArmyText(text: string): Warband {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  const warband = parseWarband(raw);
  if (warband.units.length > ARMY_RULES.maxUnits)
    throw new Error(`The army has ${warband.units.length} units; the most allowed is ${ARMY_RULES.maxUnits}.`);
  return warband;
}

/** A filename-safe slug for exporting an army. */
export function armyFileName(w: Warband): string {
  const slug = w.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'army'}.json`;
}
