import {
  brushCells,
  eraseTerrain,
  MAP_LIMITS,
  mapToBoard,
  paintElevation,
  paintFeature,
  regionCells,
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
export type EditorTool =
  | { kind: 'select' }
  | { kind: 'elevation'; brush: ElevationBrush }
  | { kind: 'erase' }
  | { kind: 'building' }
  | { kind: 'area'; feature: AreaFeature };

/** Features painted in bulk (brush or drag-fill) rather than stamped. */
export type AreaFeature = 'forest' | 'rock';

/** Longest side (in hexes) of a dragged building footprint. */
export const MAX_FOOTPRINT_SIDE = 4;

/** Whether left-drag paints a region with this tool (otherwise it orbits the camera). */
export function toolDrags(tool: EditorTool): boolean {
  return tool.kind === 'building' || tool.kind === 'area';
}

const hexAt = (map: MapDef, v: Vec) => map.hexes[v.y * map.width + v.x];

/**
 * Paint an area feature over `cells`, or — when the `anchor` hex (click centre
 * or drag start) already has it — remove it from those of the cells that have
 * it, leaving other features alone. One gesture both places and removes.
 */
function toggleArea(map: MapDef, feature: AreaFeature, anchor: Vec, cells: Vec[]): MapDef {
  if (cells.length === 0) return map;
  if (hexAt(map, anchor)?.feature !== feature) return paintFeature(map, cells, feature);
  const having = cells.filter((c) => hexAt(map, c)?.feature === feature);
  return paintFeature(map, having, undefined);
}

/**
 * Apply `tool` with a brush of `radius` centred on `cell`. Returns the map
 * unchanged (same reference) for `select`, so the caller can skip committing.
 * A building click ignores the radius and toggles a single-hex building; a
 * forest/rock click paints the brush, or clears it when the centre already has
 * that feature.
 */
export function applyTool(map: MapDef, tool: EditorTool, cell: Vec, radius: number): MapDef {
  if (tool.kind === 'select') return map;
  if (tool.kind === 'building') {
    const cells = brushCells(map, cell, 0);
    return paintFeature(map, cells, hexAt(map, cell)?.feature === 'building' ? undefined : 'building');
  }
  const cells = brushCells(map, cell, radius);
  if (cells.length === 0) return map;
  if (tool.kind === 'area') return toggleArea(map, tool.feature, cell, cells);
  return tool.kind === 'erase' ? eraseTerrain(map, cells) : paintElevation(map, cells, tool.brush);
}

/**
 * The building footprint dragged from `from` to `to`: the offset-coordinate
 * rectangle between them, with the far corner pulled in so neither side
 * exceeds {@link MAX_FOOTPRINT_SIDE}.
 */
export function footprintCells(map: MapDef, from: Vec, to: Vec): Vec[] {
  const reach = MAX_FOOTPRINT_SIDE - 1;
  const clamp = (a: number, b: number) => Math.max(a - reach, Math.min(a + reach, b));
  return regionCells(map, from, { x: clamp(from.x, to.x), y: clamp(from.y, to.y) });
}

/**
 * The hexes a drag of `tool` from `from` to `to` would paint (empty for
 * non-drag tools): a capped building footprint, or the full forest/rock fill
 * rectangle.
 */
export function dragCells(map: MapDef, tool: EditorTool, from: Vec, to: Vec): Vec[] {
  if (tool.kind === 'building') return footprintCells(map, from, to);
  if (tool.kind === 'area') return regionCells(map, from, to);
  return [];
}

/**
 * Apply a finished drag of `tool`: a building stamps its whole footprint; a
 * forest/rock drag fills the region, or clears it when started on that feature.
 */
export function applyDrag(map: MapDef, tool: EditorTool, from: Vec, to: Vec): MapDef {
  const cells = dragCells(map, tool, from, to);
  if (cells.length === 0) return map;
  if (tool.kind === 'area') return toggleArea(map, tool.feature, from, cells);
  return tool.kind === 'building' ? paintFeature(map, cells, 'building') : map;
}
