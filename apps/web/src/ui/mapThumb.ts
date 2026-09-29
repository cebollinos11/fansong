import { vecKey, type TerrainFeature, type Vec } from '@fansong/engine';
import type { MapDef } from '@fansong/content';
import { mix, tileTopColor } from '../three/terrain.js';
import { ZONE_COLORS } from './editorView.js';

// A flat, top-down picture of a map for the map pickers (no DOM), so it can be unit-tested.

/** One hex of the thumbnail: its polygon in viewBox units and its fill. */
export interface ThumbHex {
  cell: Vec;
  points: string;
  fill: string;
}

/** A flag base, drawn as a dot on top of its hex. */
export interface ThumbFlag {
  cx: number;
  cy: number;
  fill: string;
}

export interface MapThumbData {
  viewBox: string;
  hexes: ThumbHex[];
  flags: ThumbFlag[];
}

/** Features read at a glance: the colours the board draws them in. */
const FEATURE_COLORS: Record<TerrainFeature, number> = {
  forest: 0x2f6b3a,
  rock: 0x7b7771,
  building: 0x9a8466,
  lava: 0xd9531e,
};

const SQRT3 = Math.sqrt(3);

/** Centre of a unit-radius flat-top hex in the board's odd-q layout (odd columns sit half a row lower). */
export function hexCenter(v: Vec): { x: number; y: number } {
  return { x: 1 + v.x * 1.5, y: (SQRT3 / 2) * (1 + (v.x % 2)) + v.y * SQRT3 };
}

function hexPoints(c: { x: number; y: number }): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    // Shrink a touch so the grid shows between hexes.
    pts.push(`${(c.x + 0.94 * Math.cos(a)).toFixed(3)},${(c.y + 0.94 * Math.sin(a)).toFixed(3)}`);
  }
  return pts.join(' ');
}

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/**
 * The map as SVG-ready hexes: terrain coloured by elevation and feature, deploy
 * zones and objective zones tinted in the editor's overlay colours, flag bases
 * as dots.
 */
export function mapThumb(map: MapDef): MapThumbData {
  const tint = new Map<string, { color: number; amount: number }>();
  const mark = (cells: readonly Vec[] | undefined, color: number, amount: number) =>
    cells?.forEach((v) => tint.set(vecKey(v), { color, amount }));
  mark(map.deployZones[0], ZONE_COLORS.deploy[0], 0.45);
  mark(map.deployZones[1], ZONE_COLORS.deploy[1], 0.45);
  mark(map.objectives.hill, ZONE_COLORS.hill, 0.55);
  map.objectives.conquest?.forEach((zone, i) => mark(zone, ZONE_COLORS.conquest[i]!, 0.55));

  const hexes: ThumbHex[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = { x, y };
      const hex = map.hexes[y * map.width + x];
      const elevation = hex?.elevation ?? 0;
      let color = tileTopColor(cell, elevation);
      if (hex?.feature) color = mix(FEATURE_COLORS[hex.feature], color, 0.15 * elevation);
      const t = tint.get(vecKey(cell));
      if (t) color = mix(color, t.color, t.amount);
      hexes.push({ cell, points: hexPoints(hexCenter(cell)), fill: css(color) });
    }
  }

  const flags = (map.objectives.flags ?? []).map((v, i) => {
    const c = hexCenter(v);
    return { cx: c.x, cy: c.y, fill: css(ZONE_COLORS.deploy[i]!) };
  });

  const width = 0.5 + map.width * 1.5;
  const height = SQRT3 * (map.height + (map.width > 1 ? 0.5 : 0));
  return { viewBox: `0 0 ${width} ${height.toFixed(3)}`, hexes, flags };
}
