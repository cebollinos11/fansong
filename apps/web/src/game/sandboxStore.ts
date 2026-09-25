import type { GameState } from '@fansong/engine';
import type { MapStorage } from './customMaps.js';
import { parseSandboxState } from './sandbox.js';

/**
 * Where the dev sandbox keeps its states in `localStorage`: the latest one
 * (autosaved on every change, so a dev-server reload resumes where it left
 * off) and any named snapshots. Storage is passed in (`null` = unavailable) so
 * this is testable without a DOM; what comes back out is shape-checked.
 */

export const AUTOSAVE_KEY = 'fansong.sandbox.autosave';
export const SNAPSHOTS_KEY = 'fansong.sandbox.snapshots';

export interface Snapshot {
  name: string;
  savedAt: number;
  state: GameState;
}

export function saveAutosave(storage: MapStorage | null, state: GameState): void {
  try {
    storage?.setItem(AUTOSAVE_KEY, JSON.stringify(state));
  } catch {
    // Full or unavailable: the sandbox just won't resume.
  }
}

export function loadAutosave(storage: MapStorage | null): GameState | null {
  try {
    const raw = storage?.getItem(AUTOSAVE_KEY);
    return raw ? parseSandboxState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Every readable snapshot, newest first. */
export function loadSnapshots(storage: MapStorage | null): Snapshot[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(SNAPSHOTS_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Snapshot[] = [];
  for (const entry of raw) {
    try {
      const { name, savedAt, state } = entry as Partial<Snapshot>;
      if (typeof name !== 'string' || typeof savedAt !== 'number') continue;
      out.push({ name, savedAt, state: parseSandboxState(state) });
    } catch {
      // Skip entries this version can't read.
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

function writeSnapshots(storage: MapStorage | null, snapshots: readonly Snapshot[]): void {
  if (!storage) throw new Error('Browser storage is unavailable.');
  try {
    storage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
  } catch {
    throw new Error('Could not write to browser storage (is it full?).');
  }
}

/** Save `state` under `name`, replacing a snapshot of the same name. Returns the new list. */
export function saveSnapshot(storage: MapStorage | null, name: string, state: GameState, now = Date.now()): Snapshot[] {
  const trimmed = name.trim() || 'Untitled';
  const next = [{ name: trimmed, savedAt: now, state }, ...loadSnapshots(storage).filter((s) => s.name !== trimmed)];
  writeSnapshots(storage, next);
  return next;
}

export function deleteSnapshot(storage: MapStorage | null, name: string): Snapshot[] {
  const next = loadSnapshots(storage).filter((s) => s.name !== name);
  writeSnapshots(storage, next);
  return next;
}
