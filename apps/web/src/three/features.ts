import { makeHexGrid, vecKey, type BoardData, type Vec } from '@fansong/engine';
import { hexElevation, surfaceY } from './terrain.js';

// Pure low-poly layout for terrain features (no three.js), so it can be unit-tested.
// BoardView turns each piece into a mesh: rocks are jittered dodecahedron clusters,
// buildings are boxes joined by connector boxes where two building hexes touch,
// and forests are a few cone-and-trunk trees around the hex rim (leaving the
// centre, where a unit stands, readable).

export type FeaturePiece =
  | { kind: 'rock'; cell: Vec; x: number; y: number; z: number; radius: number; squash: number; rotY: number; color: number }
  | { kind: 'box'; cell: Vec; x: number; y: number; z: number; w: number; h: number; d: number; rotY: number; color: number }
  | { kind: 'cone'; cell: Vec; x: number; y: number; z: number; radius: number; h: number; color: number }
  | { kind: 'trunk'; cell: Vec; x: number; y: number; z: number; radius: number; h: number; color: number };

const ROCK_COLORS = [0x6d6a66, 0x7b7771, 0x5f5c58] as const;
const WALL_COLOR = 0x9a8466;
const ROOF_COLOR = 0x6e4b3a;
const LEAF_COLORS = [0x2f6b3a, 0x3a7a42, 0x285c33] as const;
const TRUNK_COLOR = 0x4a3526;

/** Building body height above its hex surface, and the roof slab on top. */
export const BUILDING_HEIGHT = 0.55;
const ROOF_HEIGHT = 0.08;

/** Deterministic 0..1 noise per cell and salt, so a board always looks the same. */
export function cellNoise(v: Vec, salt: number): number {
  let h = (v.x * 374761393 + v.y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/**
 * Every feature piece on the board. `centre` maps a cell to its world hex centre
 * (x/z) and `hexSize` is the hex radius; y values are absolute world heights.
 */
export function featureLayout(
  board: BoardData,
  centre: (v: Vec) => { x: number; z: number },
  hexSize: number,
): FeaturePiece[] {
  const pieces: FeaturePiece[] = [];
  const terrain = board.terrain ?? {};
  const grid = makeHexGrid(board);
  const isBuilding = (v: Vec) => terrain[vecKey(v)]?.feature === 'building';

  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const cell = { x, y };
      const feature = terrain[vecKey(cell)]?.feature;
      if (!feature) continue;
      const c = centre(cell);
      const base = surfaceY(hexElevation(board, cell));

      if (feature === 'rock') {
        // A big boulder off-centre plus two smaller ones around it.
        const n = 3;
        for (let i = 0; i < n; i++) {
          const ang = cellNoise(cell, i) * Math.PI * 2;
          const dist = i === 0 ? 0.1 * hexSize : (0.35 + 0.15 * cellNoise(cell, 10 + i)) * hexSize;
          const radius = (i === 0 ? 0.5 : 0.26 + 0.08 * cellNoise(cell, 20 + i)) * hexSize;
          const squash = 0.6 + 0.3 * cellNoise(cell, 30 + i);
          pieces.push({
            kind: 'rock',
            cell,
            x: c.x + Math.cos(ang) * dist,
            y: base + radius * squash * 0.7,
            z: c.z + Math.sin(ang) * dist,
            radius,
            squash,
            rotY: cellNoise(cell, 40 + i) * Math.PI * 2,
            color: ROCK_COLORS[i % ROCK_COLORS.length]!,
          });
        }
      } else if (feature === 'building') {
        const side = 1.1 * hexSize;
        pieces.push(
          { kind: 'box', cell, x: c.x, y: base + BUILDING_HEIGHT / 2, z: c.z, w: side, h: BUILDING_HEIGHT, d: side, rotY: 0, color: WALL_COLOR },
          { kind: 'box', cell, x: c.x, y: base + BUILDING_HEIGHT + ROOF_HEIGHT / 2, z: c.z, w: side * 1.06, h: ROOF_HEIGHT, d: side * 1.06, rotY: 0, color: ROOF_COLOR },
        );
        // Join to each later-listed adjacent building hex at the same level, once per pair.
        for (const n of grid.cellsWithin(cell, 1)) {
          if (!isBuilding(n) || n.y * board.width + n.x < y * board.width + x) continue;
          if (hexElevation(board, n) !== hexElevation(board, cell)) continue;
          const o = centre(n);
          const dx = o.x - c.x;
          const dz = o.z - c.z;
          const len = Math.hypot(dx, dz);
          const mx = (c.x + o.x) / 2;
          const mz = (c.z + o.z) / 2;
          const rotY = -Math.atan2(dz, dx);
          pieces.push(
            { kind: 'box', cell, x: mx, y: base + BUILDING_HEIGHT / 2, z: mz, w: len, h: BUILDING_HEIGHT, d: side, rotY, color: WALL_COLOR },
            { kind: 'box', cell, x: mx, y: base + BUILDING_HEIGHT + ROOF_HEIGHT / 2, z: mz, w: len, h: ROOF_HEIGHT, d: side * 1.06, rotY, color: ROOF_COLOR },
          );
        }
      } else {
        // Forest: three trees on the rim, rotated per cell so a wood doesn't tile.
        const turn = cellNoise(cell, 0) * Math.PI * 2;
        for (let i = 0; i < 3; i++) {
          const ang = turn + (i * Math.PI * 2) / 3;
          const dist = (0.52 + 0.1 * cellNoise(cell, 50 + i)) * hexSize;
          const tx = c.x + Math.cos(ang) * dist;
          const tz = c.z + Math.sin(ang) * dist;
          const size = 0.85 + 0.3 * cellNoise(cell, 60 + i);
          const trunkH = 0.14 * size;
          const coneH = 0.55 * size;
          const coneR = 0.24 * size;
          const color = LEAF_COLORS[i % LEAF_COLORS.length]!;
          pieces.push(
            { kind: 'trunk', cell, x: tx, y: base + trunkH / 2, z: tz, radius: 0.04 * size, h: trunkH, color: TRUNK_COLOR },
            { kind: 'cone', cell, x: tx, y: base + trunkH + coneH / 2, z: tz, radius: coneR, h: coneH, color },
            { kind: 'cone', cell, x: tx, y: base + trunkH + coneH * 0.85, z: tz, radius: coneR * 0.7, h: coneH * 0.7, color },
          );
        }
      }
    }
  }
  return pieces;
}
