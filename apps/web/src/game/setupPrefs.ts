import { GAME_MODES, type GameMode } from '@fansong/engine';
import type { MapStorage } from './customMaps.js';
import { parseLimitsByMode, type LimitsByMode } from './limits.js';

/**
 * The setup screen's last choices (play mode, both sides, map, game mode,
 * Kings), kept in `localStorage` so the main menu reopens as it was left. Like
 * maps and armies, the storage is passed explicitly (`null` = unavailable) and
 * what is read back is untrusted: fields that don't parse are dropped, and the
 * screen checks the rest (a deleted army or map) against what it can offer.
 */

export const SETUP_PREFS_KEY = 'fansong.setup';

export interface SetupPrefs {
  mode?: 'vsAI' | 'hotseat' | 'online';
  /** Preset ids or saved-army choices (`army:<id>`). */
  sides?: [string, string];
  mapId?: string;
  gameMode?: GameMode;
  kings?: [number, number];
  /** Custom round limit / target score, remembered per game mode. */
  limits?: LimitsByMode;
}

const PLAY_MODES = ['vsAI', 'hotseat', 'online'] as const;

/** The stored choices; missing, corrupt or unknown fields are left out, never thrown. */
export function loadSetupPrefs(storage: MapStorage | null): SetupPrefs {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(SETUP_PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const prefs: SetupPrefs = {};
  if (PLAY_MODES.includes(r.mode as never)) prefs.mode = r.mode as SetupPrefs['mode'];
  if (isPair(r.sides, (x) => typeof x === 'string')) prefs.sides = r.sides as [string, string];
  if (typeof r.mapId === 'string') prefs.mapId = r.mapId;
  if (GAME_MODES.includes(r.gameMode as GameMode)) prefs.gameMode = r.gameMode as GameMode;
  if (isPair(r.kings, (x) => Number.isInteger(x) && (x as number) >= 0)) prefs.kings = r.kings as [number, number];
  const limits = parseLimitsByMode(r.limits);
  if (Object.keys(limits).length > 0) prefs.limits = limits;
  return prefs;
}

/** Store the choices; a failing or missing storage is ignored (it is only a convenience). */
export function saveSetupPrefs(storage: MapStorage | null, prefs: SetupPrefs): void {
  try {
    storage?.setItem(SETUP_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Full or locked-down storage: the menu just won't remember.
  }
}

function isPair(v: unknown, ok: (x: unknown) => boolean): boolean {
  return Array.isArray(v) && v.length === 2 && v.every(ok);
}
