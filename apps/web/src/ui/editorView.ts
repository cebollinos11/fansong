import { MAP_LIMITS, mapToBoard, type MapDef } from '@fansong/content';
import { createGame, type GameState } from '@fansong/engine';

// Pure editor-screen helpers (no DOM), so they can be unit-tested.

/** A unit-less, never-started game on the map's board, for rendering it. */
export function mapPreviewState(map: MapDef): GameState {
  return createGame({ seed: 0, board: mapToBoard(map), warbands: [[], []] });
}

/** Clamp a typed map dimension into {@link MAP_LIMITS} (non-numbers fall back to the minimum). */
export function clampMapSize(value: number, axis: 'width' | 'height'): number {
  const min = axis === 'width' ? MAP_LIMITS.minWidth : MAP_LIMITS.minHeight;
  const max = axis === 'width' ? MAP_LIMITS.maxWidth : MAP_LIMITS.maxHeight;
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
