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
// Ruined Village — blocks of buildings cut by streets: a main street along the
// middle rows, a cross street either side of the centre, and back lanes. Some
// houses have fallen to rubble (rock) or overgrown gardens (forest). The
// market square at the heart of the village is raised a step and is the
// king-of-the-hill zone.
function ruinedVillage(): MapDef {
  const W = 14;
  const H = 12;
  const mirror = (v: Vec): Vec => ({ x: W - 1 - v.x, y: H - 1 - v.y });
  // Building blocks are these column pairs × row pairs; everything else in the
  // village is street. Both sets map onto themselves under the 180° mirror.
  const blockCols = [3, 4, 6, 7, 9, 10];
  const blockRows = [0, 1, 3, 4, 7, 8, 10, 11];
  // The market square: the central block pair plus the main street between them.
  const market = (v: Vec) => (v.x === 6 || v.x === 7) && v.y >= 4 && v.y <= 7;

  const map = build('ruined-village', 'Ruined Village', W, H, (v) => {
    if (market(v)) return { elevation: 1 };
    if (!blockCols.includes(v.x) || !blockRows.includes(v.y)) return { elevation: 0 };
    const n = symNoise(v, W, H, 0x7111a6e);
    if (n < 0.6) return { elevation: 0, feature: 'building' };
    if (n < 0.72) return { elevation: 0, feature: 'rock' };
    if (n < 0.82) return { elevation: 0, feature: 'forest' };
    return { elevation: 0 };
  });
  map.objectives = {
    flags: [{ x: 0, y: 5 }, mirror({ x: 0, y: 5 })],
    hill: map.hexes
      .map((_, i) => ({ x: i % W, y: Math.floor(i / W) }))
      .filter(market)
      .sort((a, b) => a.y - b.y || a.x - b.x),
  };
  return map;
}

// ---------------------------------------------------------------------------
// Rocky Pass — a rocky ridge runs down the middle of the field, crossed only
// by three narrow passes: one at the centre and one near each board edge. The
// slopes rise towards the ridge, so whoever holds a pass holds the high
// ground; boulders litter the approaches. The centre pass is the
// king-of-the-hill zone.
function rockyPass(): MapDef {
  const W = 14;
  const H = 12;
  const mirror = (v: Vec): Vec => ({ x: W - 1 - v.x, y: H - 1 - v.y });
  // Pass rows through the ridge (columns 6–7). Row r in column 6 mirrors to row
  // H-1-r in column 7, so the set is symmetric.
  const passRows = [1, 5, 6, 10];
  const centrePass = (v: Vec) => (v.x === 6 || v.x === 7) && (v.y === 5 || v.y === 6);
  const boulders = [{ x: 3, y: 2 }, { x: 4, y: 8 }, { x: 5, y: 4 }, { x: 2, y: 9 }, { x: 3, y: 10 }];
  const isBoulder = (v: Vec) => boulders.some((b) => [b, mirror(b)].some((u) => u.x === v.x && u.y === v.y));
  const slope = [0, 0, 0, 0, 1, 2, 2, 2, 2, 1, 0, 0, 0, 0]; // elevation by column

  const map = build('rocky-pass', 'Rocky Pass', W, H, (v) => {
    const elevation = slope[v.x]!;
    if (v.x === 6 || v.x === 7) {
      return passRows.includes(v.y) ? { elevation } : { elevation: 3, feature: 'rock' };
    }
    return isBoulder(v) ? { elevation, feature: 'rock' } : { elevation };
  });
  map.objectives = {
    hill: map.hexes
      .map((_, i) => ({ x: i % W, y: Math.floor(i / W) }))
      .filter(centrePass)
      .sort((a, b) => a.y - b.y || a.x - b.x),
  };
  return map;
}

// ---------------------------------------------------------------------------

const MAPS: MapDef[] = [rollingHills(), oldForest(), ruinedVillage(), rockyPass()];

for (const map of MAPS) {
  const { ok, errors } = validateMap(map);
  if (!ok) throw new Error(`${map.id}: ${errors.join('; ')}`);
  writeFileSync(`${MAPS_DIR}${map.id}.json`, mapToJson(map));
  console.log(`wrote ${map.id}.json`);
}
