import { MAX_ELEVATION, makeHexGrid, rngNext, seedRng, vecKey, type TerrainFeature, type Vec } from '@fansong/engine';
import { slugify } from './editor.js';
import type { MapDef, MapHex } from './map.js';
import { MAP_LIMITS, validateMap } from './mapValidate.js';

/**
 * Random map generator. {@link generateRandomMap} builds a point-symmetric
 * battlefield (each hex mirrors the hex at `(w-1-x, h-1-y)`, the symmetry the
 * built-in maps use, so neither side is favoured) that hosts every game mode:
 * home-edge deploy zones, flag bases on the home edges, a central hill that
 * doubles as the middle conquest zone, and two mirrored flank conquest zones.
 *
 * Terrain is scattered hills, forest clumps, rock outcrops, small buildings and
 * the odd lava pool, kept off every deploy and objective hex. A layout whose
 * impassable terrain cuts the field apart is rerolled; as a last resort the
 * impassable features are dropped, so the result always passes `validateMap`.
 * The same `(width, height, seed)` always gives the same map.
 */

/** Simple stateful wrapper over the engine's pure mulberry32 RNG. */
function makeRandom(seed: number): { next: () => number; int: (lo: number, hi: number) => number } {
  let state = seedRng(seed);
  const next = (): number => {
    const draw = rngNext(state);
    state = draw.state;
    return draw.value;
  };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)) };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Rerolls attempted before falling back to a map without impassable terrain. */
const MAX_ATTEMPTS = 12;

export function generateRandomMap(width: number, height: number, seed: number, name = `Random ${seed}`): MapDef {
  const w = clamp(Math.floor(width), MAP_LIMITS.minWidth, MAP_LIMITS.maxWidth);
  const h = clamp(Math.floor(height), MAP_LIMITS.minHeight, MAP_LIMITS.maxHeight);
  const layout = objectiveLayout(w, h);
  let attemptSeed = seed;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const map = { ...layout.map, id: slugify(name), name, hexes: randomTerrain(w, h, attemptSeed, layout.reserved) };
    if (validateMap(map).ok) return map;
    attemptSeed = (Math.imul(attemptSeed, 0x9e3779b1) + attempt + 1) | 0;
  }
  // Every reroll walled something off: keep the hills and forests, drop what blocks.
  const open = randomTerrain(w, h, seed, layout.reserved).map((hex) =>
    hex.feature === 'forest' ? hex : { elevation: hex.feature === 'lava' ? 0 : hex.elevation },
  );
  return { ...layout.map, id: slugify(name), name, hexes: open };
}

interface Layout {
  /** The map's deploy zones and objectives, on flat ground. */
  map: MapDef;
  /** Hex keys terrain must leave passable (deploy zones and every objective). */
  reserved: Set<string>;
}

/** Deploy zones and the objectives for every mode, all point-symmetric. */
function objectiveLayout(w: number, h: number): Layout {
  const mirror = (v: Vec): Vec => ({ x: w - 1 - v.x, y: h - 1 - v.y });
  const grid = makeHexGrid({ width: w, height: h, blocked: [] });
  const blob = (center: Vec, r: number): Vec[] => [center, ...grid.cellsWithin(center, r)];

  // Home-edge columns, deep enough to hold a full warband.
  const depth = Math.max(2, Math.ceil(MAP_LIMITS.minDeployHexes / h), w >= 24 ? 3 : 0);
  const deploy0: Vec[] = [];
  for (let x = 0; x < depth; x++) for (let y = 0; y < h; y++) deploy0.push({ x, y });
  const deploy1 = deploy0.map(mirror);
  const deployKeys = new Set([...deploy0, ...deploy1].map(vecKey));

  const flag0: Vec = { x: 0, y: Math.floor((h - 1) / 2) };
  const flags: [Vec, Vec] = [flag0, mirror(flag0)];

  // The hill: a blob at the centre plus its mirror, clear of the deploy zones.
  const small = Math.min(w, h) < 10;
  const center: Vec = { x: Math.floor((w - 1) / 2), y: Math.floor((h - 1) / 2) };
  const hill = dedupe([...blob(center, small ? 0 : 1), ...blob(mirror(center), small ? 0 : 1)]).filter(
    (v) => !deployKeys.has(vecKey(v)),
  );
  const hillKeys = new Set(hill.map(vecKey));

  // Flank zone in the top half; its mirror sits strictly in the bottom half, so they're disjoint.
  const flankCenter: Vec = { x: center.x, y: Math.max(0, Math.round(h * 0.18)) };
  let flank = blob(flankCenter, small ? 1 : 2 - (h < 20 ? 1 : 0)).filter(
    (v) => 2 * v.y < h - 1 && !deployKeys.has(vecKey(v)) && !hillKeys.has(vecKey(v)),
  );
  if (flank.length === 0) flank = [{ x: center.x, y: 0 }];
  const conquest: [Vec[], Vec[], Vec[]] = [flank, hill.slice(), flank.map(mirror)];

  const reserved = new Set([...deployKeys, ...flags.map(vecKey), ...hillKeys, ...[...flank, ...conquest[2]].map(vecKey)]);
  return {
    map: {
      id: 'random',
      name: 'Random',
      width: w,
      height: h,
      hexes: [],
      deployZones: [deploy0, deploy1],
      objectives: { flags, hill, conquest },
    },
    reserved,
  };
}

function dedupe(cells: Vec[]): Vec[] {
  const seen = new Set<string>();
  return cells.filter((v) => !seen.has(vecKey(v)) && seen.add(vecKey(v)) !== undefined);
}

/**
 * Row-major random terrain, point-symmetric. Generated over the whole board,
 * then the first half (in row-major order) is copied onto its mirror.
 */
function randomTerrain(w: number, h: number, seed: number, reserved: Set<string>): MapHex[] {
  const rnd = makeRandom(seed);
  const grid = makeHexGrid({ width: w, height: h, blocked: [] });
  const elevation = new Array<number>(w * h).fill(0);
  const feature = new Array<TerrainFeature | undefined>(w * h).fill(undefined);
  const idx = (v: Vec) => v.y * w + v.x;
  const area = w * h;
  const randomCell = (): Vec => ({ x: rnd.int(0, w - 1), y: rnd.int(0, h - 1) });

  // Rolling hills: cones that fall off by one level per hex.
  const hills = Math.max(1, Math.round(area / rnd.int(35, 70)));
  for (let i = 0; i < hills; i++) {
    const peak = rnd.int(1, MAX_ELEVATION);
    const c = randomCell();
    elevation[idx(c)] = Math.max(elevation[idx(c)]!, peak);
    for (let r = 1; r < peak; r++)
      for (const v of grid.cellsWithin(c, r)) elevation[idx(v)] = Math.max(elevation[idx(v)]!, peak - grid.distance(c, v));
  }

  /** A random-walk clump of `size` hexes from a random start. */
  const clump = (size: number): Vec[] => {
    const cells: Vec[] = [];
    let at = randomCell();
    for (let i = 0; i < size; i++) {
      cells.push(at);
      const ns = grid.cellsWithin(at, 1);
      at = ns[rnd.int(0, ns.length - 1)] ?? at;
    }
    return cells;
  };
  const scatter = (f: TerrainFeature, share: number, size: [number, number]) => {
    let budget = Math.round(area * share);
    while (budget > 0) {
      const cells = clump(rnd.int(size[0], size[1]));
      for (const v of cells) if (!reserved.has(vecKey(v))) feature[idx(v)] = f;
      budget -= cells.length;
    }
  };
  scatter('forest', 0.06 + rnd.next() * 0.1, [3, 8]);
  scatter('rock', 0.02 + rnd.next() * 0.04, [1, 4]);
  scatter('building', rnd.next() * 0.04, [1, 3]);
  if (rnd.next() < 0.3) scatter('lava', 0.01 + rnd.next() * 0.03, [2, 5]);

  const hexes: MapHex[] = [];
  for (let i = 0; i < area; i++) {
    // The second half mirrors the first.
    const src = Math.min(i, area - 1 - i);
    const f = feature[src];
    const e = f === 'lava' ? 0 : elevation[src]!; // lava lies flat
    hexes.push(f === undefined ? { elevation: e } : { elevation: e, feature: f });
  }
  return hexes;
}
