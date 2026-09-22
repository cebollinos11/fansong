import {
  brushCells,
  eraseTerrain,
  MAP_LIMITS,
  mapToBoard,
  paintConquest,
  paintDeploy,
  paintElevation,
  paintFeature,
  paintHill,
  regionCells,
  renameMap,
  setFlag,
  supportedModes,
  validateMap,
  type ElevationBrush,
  type MapDef,
} from '@fansong/content';
import { createGame, vecKey, type GameMode, type GameState, type Vec } from '@fansong/engine';
import type { HexOverlay } from '../three/BoardView.js';

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
  | { kind: 'area'; feature: AreaFeature }
  | { kind: 'zone'; zone: ZoneId }
  | { kind: 'flag'; player: 0 | 1 };

/** A paintable hex set: a player's deploy zone, the hill, or a conquest zone. */
export type ZoneId =
  | { kind: 'deploy'; player: 0 | 1 }
  | { kind: 'hill' }
  | { kind: 'conquest'; index: 0 | 1 | 2 };

/** Features painted in bulk (brush or drag-fill) rather than stamped. */
export type AreaFeature = 'forest' | 'rock';

/** Longest side (in hexes) of a dragged building footprint. */
export const MAX_FOOTPRINT_SIDE = 4;

/** Whether left-drag paints a region with this tool (otherwise it orbits the camera). */
export function toolDrags(tool: EditorTool): boolean {
  return tool.kind === 'building' || tool.kind === 'area' || tool.kind === 'zone';
}

/** The hexes currently in `zone`. */
export function zoneCells(map: MapDef, zone: ZoneId): readonly Vec[] {
  if (zone.kind === 'deploy') return map.deployZones[zone.player];
  if (zone.kind === 'hill') return map.objectives.hill ?? [];
  return map.objectives.conquest?.[zone.index] ?? [];
}

function paintZone(map: MapDef, zone: ZoneId, cells: readonly Vec[], on: boolean): MapDef {
  if (zone.kind === 'deploy') return paintDeploy(map, zone.player, cells, on);
  if (zone.kind === 'hill') return paintHill(map, cells, on);
  return paintConquest(map, zone.index, cells, on);
}

/**
 * Add `cells` to `zone`, or — when the `anchor` hex is already in it — remove
 * them, mirroring the forest/rock toggle. Adding to a deploy or conquest zone
 * takes the hexes out of its siblings (see the content ops).
 */
function toggleZone(map: MapDef, zone: ZoneId, anchor: Vec, cells: Vec[]): MapDef {
  if (cells.length === 0) return map;
  const inZone = zoneCells(map, zone).some((v) => v.x === anchor.x && v.y === anchor.y);
  return paintZone(map, zone, cells, !inZone);
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
  if (tool.kind === 'flag') {
    const base = map.objectives.flags?.[tool.player];
    return base && base.x === cell.x && base.y === cell.y ? map : setFlag(map, tool.player, cell);
  }
  if (tool.kind === 'building') {
    const cells = brushCells(map, cell, 0);
    return paintFeature(map, cells, hexAt(map, cell)?.feature === 'building' ? undefined : 'building');
  }
  const cells = brushCells(map, cell, radius);
  if (cells.length === 0) return map;
  if (tool.kind === 'area') return toggleArea(map, tool.feature, cell, cells);
  if (tool.kind === 'zone') return toggleZone(map, tool.zone, cell, cells);
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
  if (tool.kind === 'area' || tool.kind === 'zone') return regionCells(map, from, to);
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
  if (tool.kind === 'zone') return toggleZone(map, tool.zone, from, cells);
  return tool.kind === 'building' ? paintFeature(map, cells, 'building') : map;
}

/** Overlay colours, shared with the editor legend. */
export const ZONE_COLORS = {
  deploy: [0x4f9dff, 0xff6b5b],
  hill: 0xffd54a,
  conquest: [0xc77dff, 0x2ec4b6, 0xff9f1c],
} as const;

export const CONQUEST_LABELS = ['A', 'B', 'C'] as const;

/** Map deploy zones and objectives as board overlays; flag bases are small solid hexes on top. */
export function mapOverlays(map: MapDef): HexOverlay[] {
  const out: HexOverlay[] = [];
  const add = (cells: readonly Vec[], color: number, extra: Partial<HexOverlay> = {}) => {
    if (cells.length > 0) out.push({ cells: cells.slice(), color, ...extra });
  };
  add(map.deployZones[0], ZONE_COLORS.deploy[0], { opacity: 0.22 });
  add(map.deployZones[1], ZONE_COLORS.deploy[1], { opacity: 0.22 });
  add(map.objectives.hill ?? [], ZONE_COLORS.hill, { opacity: 0.35, scale: 0.75 });
  map.objectives.conquest?.forEach((zone, i) => add(zone, ZONE_COLORS.conquest[i]!, { opacity: 0.4, scale: 0.75 }));
  map.objectives.flags?.forEach((f, i) => add([f], ZONE_COLORS.deploy[i]!, { opacity: 0.95, scale: 0.4 }));
  return out;
}

/** What the map places on a hex besides terrain, for the selected-hex panel. */
export function hexMarkings(map: MapDef, cell: Vec): string[] {
  const k = vecKey(cell);
  const has = (cells: readonly Vec[] | undefined) => cells?.some((v) => vecKey(v) === k) ?? false;
  const out: string[] = [];
  map.deployZones.forEach((z, p) => has(z) && out.push(`Deploy zone: player ${p + 1}`));
  map.objectives.flags?.forEach((f, p) => has([f]) && out.push(`Flag base: player ${p + 1}`));
  if (has(map.objectives.hill)) out.push('Hill zone');
  map.objectives.conquest?.forEach((z, i) => has(z) && out.push(`Conquest zone ${CONQUEST_LABELS[i]}`));
  return out;
}

/** Longest map name the editor accepts. */
export const MAX_MAP_NAME = 40;

/**
 * Rename from the name field: trimmed and capped at {@link MAX_MAP_NAME};
 * a blank name keeps the current one (the map is returned unchanged).
 */
export function applyMapName(map: MapDef, raw: string): MapDef {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_MAP_NAME).trim();
  return name && name !== map.name ? renameMap(map, name) : map;
}

/**
 * Rewrite `validateMap` wording to the editor's labels: players are P1/P2 and
 * conquest zones A/B/C (validation counts players from 0 and zones from 1).
 */
export function editorErrorText(error: string): string {
  return error
    .replace(/\bplayer ([01])\b/g, (_, p: string) => `P${Number(p) + 1}`)
    .replace(/\bconquest zones ([123]) and ([123])\b/g, (_, a: string, b: string) =>
      `conquest zones ${CONQUEST_LABELS[Number(a) - 1]} and ${CONQUEST_LABELS[Number(b) - 1]}`,
    )
    .replace(/\bconquest zone ([123])\b/g, (_, i: string) => `conquest zone ${CONQUEST_LABELS[Number(i) - 1]}`);
}

/** Display names for game modes (Setup map picker, editor validation panel). */
export const MODE_LABELS: Record<GameMode, string> = {
  annihilation: 'Annihilation',
  'kill-the-king': 'Kill the king',
  'king-of-the-hill': 'King of the hill',
  conquest: 'Conquest',
  'capture-the-flag': 'Capture the flag',
};

/** Errors the editor lists before collapsing the rest into "…and N more". */
export const MAX_SHOWN_ERRORS = 6;

export interface EditorValidation {
  ok: boolean;
  /** Editor-worded errors, capped at {@link MAX_SHOWN_ERRORS} plus a summary line. */
  errors: string[];
  /** Modes the map can host as it stands (empty while invalid). */
  modes: GameMode[];
}

/** The inline validation panel's contents for the current map. */
export function editorValidation(map: MapDef): EditorValidation {
  const { ok, errors } = validateMap(map);
  const shown = errors.slice(0, MAX_SHOWN_ERRORS).map(editorErrorText);
  if (errors.length > MAX_SHOWN_ERRORS) shown.push(`…and ${errors.length - MAX_SHOWN_ERRORS} more`);
  return { ok, errors: shown, modes: supportedModes(map) };
}

/** Undo/redo keyboard shortcut: Ctrl/⌘+Z undoes, Ctrl/⌘+Y or Ctrl/⌘+Shift+Z redoes. */
export function historyShortcut(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}
