import { MAX_ELEVATION, makeHexGrid, rngNext, seedRng, vecKey, type TerrainFeature, type Vec } from '@fansong/engine';
import { slugify } from './editor.js';
import type { MapDef, MapHex } from './map.js';
import { MAP_LIMITS, validateMap } from './mapValidate.js';

/**
 * Random map generator. {@link generateRandomMap} builds a battlefield that
 * hosts every game mode: home-edge deploy zones, a flag base 3–5 hexes in from
 * each home edge, a central hill that doubles as the middle conquest zone, and
 * two flank conquest zones, one in each half.
 *
 * A symmetric map (the default) is point-symmetric: each hex mirrors the hex at
 * `(w-1-x, h-1-y)`, the symmetry the built-in maps use, so neither side is
 * favoured. An asymmetric one places each side's terrain and objectives
 * independently (deploy zones stay equal-sized home-edge columns).
 *
 * Terrain is scattered hills, forest clumps, rock outcrops, small buildings and
 * the odd lava pool, kept off every deploy and objective hex. A layout whose
 * impassable terrain cuts the field apart is rerolled; as a last resort the
 * impassable features are dropped, so the result always passes `validateMap`.
 * The same `(width, height, seed, symmetric)` always gives the same map.
 */

export interface RandomMapOptions {
  /** Mirror the map through its centre (default true). */
  symmetric?: boolean;
  /** Map name (default `Random <seed>`); the id is its slug. */
  name?: string;
}

/** How far in from its home edge a flag base sits. */
export const FLAG_EDGE_DISTANCE = { min: 3, max: 5 } as const;

type Random = { next: () => number; int: (lo: number, hi: number) => number };

/** Simple stateful wrapper over the engine's pure mulberry32 RNG. */
function makeRandom(seed: number): Random {
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

export function generateRandomMap(
  width: number,
  height: number,
  seed: number,
  { symmetric = true, name = `Random ${seed}` }: RandomMapOptions = {},
): MapDef {
  const w = clamp(Math.floor(width), MAP_LIMITS.minWidth, MAP_LIMITS.maxWidth);
  const h = clamp(Math.floor(height), MAP_LIMITS.minHeight, MAP_LIMITS.maxHeight);
  const layout = objectiveLayout(w, h, makeRandom(seed ^ 0x5bd1e995), symmetric);
  const named = { ...layout.map, id: slugify(name), name };
  let attemptSeed = seed;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const map = { ...named, hexes: randomTerrain(w, h, attemptSeed, layout.reserved, symmetric) };
    if (validateMap(map).ok) return map;
    attemptSeed = (Math.imul(attemptSeed, 0x9e3779b1) + attempt + 1) | 0;
  }
  // Every reroll walled something off: keep the hills and forests, drop what blocks.
  const open = randomTerrain(w, h, seed, layout.reserved, symmetric).map((hex) =>
    hex.feature === 'forest' ? hex : { elevation: hex.feature === 'lava' ? 0 : hex.elevation },
  );
  return { ...named, hexes: open };
}

interface Layout {
  /** The map's deploy zones and objectives, on flat ground. */
  map: MapDef;
  /** Hex keys terrain must leave passable (deploy zones and every objective). */
  reserved: Set<string>;
}

/** Deploy zones and the objectives for every mode; point-symmetric when `symmetric`. */
function objectiveLayout(w: number, h: number, rnd: Random, symmetric: boolean): Layout {
  const mirror = (v: Vec): Vec => ({ x: w - 1 - v.x, y: h - 1 - v.y });
  const grid = makeHexGrid({ width: w, height: h, blocked: [] });
  const blob = (center: Vec, r: number): Vec[] => [center, ...grid.cellsWithin(center, r)];

  // Home-edge columns, deep enough to hold a full warband.
  const depth = Math.max(2, Math.ceil(MAP_LIMITS.minDeployHexes / h), w >= 24 ? 3 : 0);
  const deploy0: Vec[] = [];
  for (let x = 0; x < depth; x++) for (let y = 0; y < h; y++) deploy0.push({ x, y });
  const deploy1 = deploy0.map(mirror);
  const deployKeys = new Set([...deploy0, ...deploy1].map(vecKey));

  // Flag bases 3–5 hexes in from the home edge, kept in their own half on narrow maps.
  const flagFor = (): Vec => ({
    x: Math.min(rnd.int(FLAG_EDGE_DISTANCE.min, FLAG_EDGE_DISTANCE.max), Math.floor((w - 2) / 2)),
    y: h >= 8 ? rnd.int(3, h - 4) : Math.floor((h - 1) / 2),
  });
  const flag0 = flagFor();
  const flags: [Vec, Vec] = [flag0, symmetric ? mirror(flag0) : mirror(flagFor())];
  const flagKeys = new Set(flags.map(vecKey));
  const free = (v: Vec) => !deployKeys.has(vecKey(v)) && !flagKeys.has(vecKey(v));

  // The hill: a blob at the centre (plus its mirror, when symmetric).
  const small = Math.min(w, h) < 10;
  const hillR = small ? 0 : 1;
  const mid: Vec = { x: Math.floor((w - 1) / 2), y: Math.floor((h - 1) / 2) };
  const hillCells = symmetric
    ? [...blob(mid, hillR), ...blob(mirror(mid), hillR)]
    : blob(small ? mid : { x: mid.x + rnd.int(-1, 1), y: mid.y + rnd.int(-1, 1) }, hillR);
  let hill = dedupe(hillCells).filter(free);
  if (hill.length === 0) hill = [mid];
  const hillKeys = new Set(hill.map(vecKey));

  // Flank zones: one strictly in the top half, one strictly in the bottom, so they're disjoint.
  const flankR = small ? 1 : h < 20 ? 1 : 2;
  const flank = (top: boolean): Vec[] => {
    const y = Math.round(h * 0.18) + (symmetric ? 0 : rnd.int(-1, 1));
    const x = symmetric ? mid.x : rnd.int(Math.floor(w / 3), Math.ceil((2 * w) / 3) - 1);
    const c: Vec = top ? { x, y: Math.max(0, y) } : { x, y: Math.min(h - 1, h - 1 - y) };
    const half = (v: Vec) => (top ? 2 * v.y < h - 1 : 2 * v.y > h - 1);
    const zone = blob(c, flankR).filter((v) => half(v) && free(v) && !hillKeys.has(vecKey(v)));
    return zone.length > 0 ? zone : [{ x: mid.x, y: top ? 0 : h - 1 }];
  };
  const top = flank(true);
  const bottom = symmetric ? top.map(mirror) : flank(false);
  const conquest: [Vec[], Vec[], Vec[]] = [top, hill.slice(), bottom];

  const reserved = new Set([...deployKeys, ...flagKeys, ...hillKeys, ...[...top, ...bottom].map(vecKey)]);
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
 * Row-major random terrain, generated over the whole board. When `symmetric`,
 * the first half (in row-major order) is then copied onto its mirror.
 */
function randomTerrain(w: number, h: number, seed: number, reserved: Set<string>, symmetric: boolean): MapHex[] {
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
    const src = symmetric ? Math.min(i, area - 1 - i) : i;
    const f = feature[src];
    const e = f === 'lava' ? 0 : elevation[src]!; // lava lies flat
    hexes.push(f === undefined ? { elevation: e } : { elevation: e, feature: f });
  }
  return hexes;
}
