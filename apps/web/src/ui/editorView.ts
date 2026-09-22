import {
  brushCells,
  eraseTerrain,
  MAP_LIMITS,
  mapToBoard,
  paintElevation,
  type ElevationBrush,
  type MapDef,
} from '@fansong/content';
import { createGame, type GameState, type Vec } from '@fansong/engine';

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

/** The active editor tool. `select` only inspects; the others paint on click. */
export type EditorTool = { kind: 'select' } | { kind: 'elevation'; brush: ElevationBrush } | { kind: 'erase' };

/**
 * Apply `tool` with a brush of `radius` centred on `cell`. Returns the map
 * unchanged (same reference) for `select`, so the caller can skip committing.
 */
export function applyTool(map: MapDef, tool: EditorTool, cell: Vec, radius: number): MapDef {
  if (tool.kind === 'select') return map;
  const cells = brushCells(map, cell, radius);
  if (cells.length === 0) return map;
  return tool.kind === 'erase' ? eraseTerrain(map, cells) : paintElevation(map, cells, tool.brush);
}
