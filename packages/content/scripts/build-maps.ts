/**
 * Generates the built-in map files in `packages/content/maps/` from code, so
 * each premade map is described by a few readable rules rather than hand-edited
 * JSON. Output goes through `mapToJson` (the canonical format a registry test
 * pins every file to) and must pass `validateMap`.
 *
 *   pnpm tsx packages/content/scripts/build-maps.ts
 *
 * Premade maps have an even width so the 180° rotation (x, y) → (W-1-x, H-1-y)
 * is an exact hex isometry on the odd-q grid; terrain is laid out
 * point-symmetrically so neither side gets the better ground.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeHexGrid, type TerrainFeature, type Vec } from '@fansong/engine';
import { flatMap, mapToJson, type MapDef } from '../src/map.js';
import { validateMap } from '../src/mapValidate.js';

const MAPS_DIR = fileURLToPath(new URL('../maps/', import.meta.url));

type Terrain = (v: Vec) => { elevation: number; feature?: TerrainFeature };

/** A map with edge-column deploy zones (like `flatMap`) and terrain from `terrain`. */
function build(id: string, name: string, width: number, height: number, terrain: Terrain): MapDef {
  const map = flatMap(width, height, id, name);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { elevation, feature } = terrain({ x, y });
      map.hexes[y * width + x] = feature ? { elevation, feature } : { elevation };
    }
  }
  return map;
}

/** The hexes within `radius` of `c` on a `width`×`height` grid. */
function disc(width: number, height: number, c: Vec, radius: number): Vec[] {
  const grid = makeHexGrid({ width, height, blocked: [] });
  const out: Vec[] = [];
  for (let x = 0; x < width; x++)
    for (let y = 0; y < height; y++) if (grid.distance(c, { x, y }) <= radius) out.push({ x, y });
  return out;
}

/** Deterministic per-hex noise in [0, 1). */
function noise(x: number, y: number, seed: number): number {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 2 ** 32;
}

/** `noise` made point-symmetric: a hex and its 180° mirror get the same value. */
function symNoise(v: Vec, w: number, h: number, seed: number): number {
  const m = { x: w - 1 - v.x, y: h - 1 - v.y };
  const [a] = [v, m].sort((p, q) => p.y - q.y || p.x - q.x);
  return noise(a!.x, a!.y, seed);
}

// ---------------------------------------------------------------------------
// Rolling Hills — elevation-heavy, few features. A broad central hilltop (the
// king-of-the-hill zone) with a pair of flanking hills and low rises; a few
// scattered trees and boulders.
function rollingHills(): MapDef {
  const W = 14;
  const H = 12;
  const grid = makeHexGrid({ width: W, height: H, blocked: [] });
  const centre = { x: 7, y: 5 };
  // [centre, peak height, plateau radius]; each hill's mirror is added below.
  const hills: [Vec, number, number][] = [
    [centre, 3, 1],
    [{ x: 4, y: 2 }, 2, 0],
    [{ x: 4, y: 9 }, 1, 0],
  ];
  const all = hills.flatMap(([c, h, r]) => [
    [c, h, r] as const,
    [{ x: W - 1 - c.x, y: H - 1 - c.y }, h, r] as const,
  ]);
  const features = new Map<string, TerrainFeature>();
  const place = (v: Vec, f: TerrainFeature) => {
    features.set(`${v.x},${v.y}`, f);
    features.set(`${W - 1 - v.x},${H - 1 - v.y}`, f);
  };
  place({ x: 3, y: 5 }, 'forest');
  place({ x: 3, y: 6 }, 'forest');
  place({ x: 6, y: 9 }, 'forest');
  place({ x: 9, y: 1 }, 'rock');
  place({ x: 5, y: 0 }, 'rock');

  const map = build('rolling-hills', 'Rolling Hills', W, H, (v) => {
    let elevation = 0;
    for (const [c, h, r] of all) elevation = Math.max(elevation, h - Math.max(0, grid.distance(c, v) - r));
    return { elevation, feature: features.get(`${v.x},${v.y}`) };
  });
  // The hilltop proper: the two central peaks' plateaus, all at elevation 3.
  map.objectives = {
    hill: [...disc(W, H, centre, 1), ...disc(W, H, { x: W - 1 - centre.x, y: H - 1 - centre.y }, 1)]
      .filter((v, i, a) => a.findIndex((u) => u.x === v.x && u.y === v.y) === i)
      .sort((a, b) => a.y - b.y || a.x - b.x),
  };
  return map;
}

// ---------------------------------------------------------------------------
// Old Forest — dense woodland broken by a central glade and two side
// clearings; forest blocks sight *through* it, so fights happen at short range
// and archers hunt for lanes. Flags sit at each side's home edge.
function oldForest(): MapDef {
  const W = 14;
  const H = 12;
  const grid = makeHexGrid({ width: W, height: H, blocked: [] });
  const mirror = (v: Vec): Vec => ({ x: W - 1 - v.x, y: H - 1 - v.y });
  const glades: [Vec, number][] = [
    [{ x: 7, y: 5 }, 1],
    [{ x: 6, y: 6 }, 1],
    [{ x: 4, y: 2 }, 1],
    [mirror({ x: 4, y: 2 }), 1],
  ];
  const rocks = [{ x: 5, y: 8 }, mirror({ x: 5, y: 8 }), { x: 9, y: 3 }, mirror({ x: 9, y: 3 })];
  const inGlade = (v: Vec) => glades.some(([c, r]) => grid.distance(c, v) <= r);
  const isRock = (v: Vec) => rocks.some((r) => r.x === v.x && r.y === v.y);

  const map = build('old-forest', 'Old Forest', W, H, (v) => {
    const home = Math.min(v.x, W - 1 - v.x); // columns from the nearest home edge
    if (home <= 1 || inGlade(v)) return { elevation: 0 };
    if (isRock(v)) return { elevation: 1, feature: 'rock' };
    const density = home === 2 ? 0.4 : 0.8;
    return symNoise(v, W, H, 0x0f0e57) < density ? { elevation: 0, feature: 'forest' } : { elevation: 0 };
  });
  map.objectives = { flags: [{ x: 0, y: 5 }, mirror({ x: 0, y: 5 })] };
  return map;
}

// ---------------------------------------------------------------------------

const MAPS: MapDef[] = [rollingHills(), oldForest()];

for (const map of MAPS) {
  const { ok, errors } = validateMap(map);
  if (!ok) throw new Error(`${map.id}: ${errors.join('; ')}`);
  writeFileSync(`${MAPS_DIR}${map.id}.json`, mapToJson(map));
  console.log(`wrote ${map.id}.json`);
}
