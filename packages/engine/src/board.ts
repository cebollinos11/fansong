/**
 * Spatial model. Everything spatial goes through the `Board` interface so no rule
 * ever does coordinate math itself — distance, adjacency, cells-in-range, line of
 * sight, and in-bounds are all questions the board answers.
 *
 * The board is a **flat-top hex grid** with a rectangular footprint. Cells are
 * stored as **offset coordinates** in the existing `Vec {x, y}` (x = column,
 * y = row, "odd-q" layout), so the wire schema, `"x,y"` blocked keys, and all the
 * `{x, y}` plumbing are unchanged. All hex math is done in **cube coordinates**,
 * converted internally — offset is only ever the storage/serialisation shape.
 *
 * Only plain `BoardData` is stored in GameState (so it clones/serialises
 * cleanly); a `Board` is reconstructed from that data by the engine each reduce.
 */

export interface Vec {
  x: number;
  y: number;
}

export function vecEq(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

export function vecKey(v: Vec): string {
  return `${v.x},${v.y}`;
}

/**
 * A terrain feature occupying a whole hex (at most one per hex).
 * - `rock`, `building`: impassable and block line of sight.
 * - `forest`: passable; blocks sight *through* it, but a unit inside can see and
 *   be seen from outside.
 */
export type TerrainFeature = 'rock' | 'building' | 'forest';

export const TERRAIN_FEATURES: ReadonlyArray<TerrainFeature> = ['rock', 'building', 'forest'];

/** Highest hex elevation (elevations are integers `0..MAX_ELEVATION`). */
export const MAX_ELEVATION = 3;

/** Non-default terrain of one hex. Omitted keys mean elevation 0 / no feature. */
export interface HexTerrain {
  elevation?: number;
  feature?: TerrainFeature;
}

/** Serialisable board description held in GameState. */
export interface BoardData {
  width: number;
  height: number;
  /** Impassable / LoS-blocking cell keys ("x,y"). */
  blocked: string[];
  /**
   * Sparse per-hex terrain keyed by "x,y" — only hexes with a non-zero elevation
   * or a feature appear. The key itself is omitted entirely on a flat,
   * featureless board, so such a board serialises exactly as it did before
   * terrain existed (and old replays/golden hashes are unaffected).
   */
  terrain?: Record<string, HexTerrain>;
}

/** Does this feature stop movement into its hex? */
export function isImpassableFeature(f: TerrainFeature | undefined): boolean {
  return f === 'rock' || f === 'building';
}

/** Does this feature stop line of sight passing *through* its hex? */
export function blocksSight(f: TerrainFeature | undefined): boolean {
  return f !== undefined;
}

/**
 * Extra movement constraints layered over terrain by a rule (e.g. enemy contact).
 * Terrain passability always applies on top.
 */
export interface WalkRules {
  /** Can a walk enter this hex at all? (Default: yes.) */
  passable?(v: Vec): boolean;
  /** Does a walk that enters this hex have to stop there? The start hex never stops. (Default: no.) */
  stops?(v: Vec): boolean;
  /**
   * Phasing (a flyer): the walk passes *through* otherwise-impassable terrain —
   * rocks, buildings and legacy blocked cells — so movement is pure hex distance
   * around nothing. It still may not *land* on such a hex; that is the caller's
   * check on the destination, not the board's. (Default: no.)
   */
  phaseThrough?: boolean;
}

export interface Board {
  readonly width: number;
  readonly height: number;
  inBounds(v: Vec): boolean;
  /** Impassable: a legacy blocked cell or a rock/building hex. */
  isBlocked(v: Vec): boolean;
  /** Integer elevation of a hex (0 when flat or out of bounds). */
  elevation(v: Vec): number;
  /** The hex's terrain feature, if any. */
  feature(v: Vec): TerrainFeature | undefined;
  /** Hex (cube) distance between two cells. */
  distance(a: Vec, b: Vec): number;
  /** In-bounds, unblocked adjacent cells (every cell at distance 1). */
  neighbors(v: Vec): Vec[];
  /**
   * The hex adjacent to `v` directly away from `from` (continuing the line from
   * `from` through `v` one step). Not bounds- or terrain-checked.
   */
  stepAway(from: Vec, v: Vec): Vec;
  /**
   * Every in-bounds cell (excluding the centre) at distance `1..r`, in a
   * deterministic order. Not filtered by blocked/occupied — the caller decides
   * what a given rule treats as passable — so a rule never loops a coordinate
   * window itself.
   */
  cellsWithin(v: Vec, r: number): Vec[];
  /**
   * Movement reach: every passable cell reachable from `v` in `1..steps` steps,
   * walking only through in-bounds, unblocked hexes (BFS around rocks, buildings
   * and legacy blocked cells). Occupancy is ignored — the caller decides whether
   * a destination may hold another unit. Returned as a set of `"x,y"` keys.
   * `rules` can forbid hexes or force a walk to stop in them.
   */
  reachableWithin(v: Vec, steps: number, rules?: WalkRules): Set<string>;
  /**
   * A shortest walk from `a` to `b` (both included) through the same hexes
   * {@link reachableWithin} walks (under the same `rules`), or null when `b`
   * isn't reachable in `steps`.
   */
  pathWithin(a: Vec, b: Vec, steps: number, rules?: WalkRules): Vec[] | null;
  /**
   * Line of sight between hex centres (symmetric). Any intervening blocked cell,
   * rock/building/forest hex, or (optionally) occupied cell breaks it; the
   * endpoints themselves never do.
   */
  lineOfSight(a: Vec, b: Vec, occupied?: (v: Vec) => boolean): boolean;
  /**
   * Whether a target at `b`, seen from `a`, has partial cover: it stands in a
   * forest hex, or the sight line only just grazes past a blocker (the line
   * nudged to the other side of an edge would be broken, by terrain or by an
   * occupied cell). Assumes {@link lineOfSight} is clear.
   */
  inCover(a: Vec, b: Vec, occupied?: (v: Vec) => boolean): boolean;
}

// --- Cube coordinates (internal working representation) -------------------
// A cube coord (q, r, s) always satisfies q + r + s === 0. Offset <-> cube uses
// the "odd-q" convention for flat-top hexes: odd columns are shoved half a row.

interface Cube {
  q: number;
  r: number;
  s: number;
}

function offsetToCube(v: Vec): Cube {
  const q = v.x;
  const r = v.y - (v.x - (v.x & 1)) / 2;
  return { q, r, s: -q - r };
}

function cubeToOffset(c: Cube): Vec {
  const x = c.q;
  const y = c.r + (c.q - (c.q & 1)) / 2;
  return { x, y };
}

function cubeDistance(a: Cube, b: Cube): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
}

/** The six flat-top hex directions, in cube space (fixed order for determinism). */
const CUBE_DIRS: ReadonlyArray<Cube> = [
  { q: 1, r: 0, s: -1 },
  { q: 1, r: -1, s: 0 },
  { q: 0, r: -1, s: 1 },
  { q: -1, r: 0, s: 1 },
  { q: -1, r: 1, s: 0 },
  { q: 0, r: 1, s: -1 },
];

function cubeRound(fq: number, fr: number, fs: number): Cube {
  let q = Math.round(fq);
  let r = Math.round(fr);
  let s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  else s = -q - r;
  return { q, r, s };
}

/**
 * Cells a hex line passes through, from `a` to `b` inclusive. A tiny epsilon
 * nudge keeps a line that grazes an edge/vertex from rounding ambiguously, so the
 * draw is deterministic.
 */
function cubeLine(a: Cube, b: Cube, nudge = 1): Cube[] {
  const n = cubeDistance(a, b);
  if (n === 0) return [a];
  // Nudge the endpoints off exact edges (redblobgames' standard trick). A
  // negative `nudge` rounds edge grazes the other way (used to detect cover).
  const eq = 1e-6 * nudge;
  const cells: Cube[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const q = a.q + (b.q - a.q) * t + eq;
    const r = a.r + (b.r - a.r) * t + eq;
    const s = a.s + (b.s - a.s) * t - 2 * eq;
    cells.push(cubeRound(q, r, s));
  }
  return cells;
}

export function makeHexGrid(data: BoardData): Board {
  const blocked = new Set(data.blocked);
  const terrain = data.terrain ?? {};
  const { width, height } = data;

  const inBounds = (v: Vec) => v.x >= 0 && v.y >= 0 && v.x < width && v.y < height;
  const feature = (v: Vec): TerrainFeature | undefined => terrain[vecKey(v)]?.feature;
  const elevation = (v: Vec): number => terrain[vecKey(v)]?.elevation ?? 0;
  const isBlocked = (v: Vec) => blocked.has(vecKey(v)) || isImpassableFeature(feature(v));

  const distance = (a: Vec, b: Vec) => cubeDistance(offsetToCube(a), offsetToCube(b));

  /** The hexes a walk may step to from `cell` under `rules` (none out of a stopping hex). */
  const walkSteps = (cell: Vec, isStart: boolean, rules?: WalkRules): Vec[] => {
    if (!isStart && rules?.stops?.(cell)) return [];
    const ns = rules?.phaseThrough ? phaseNeighbors(cell) : neighbors(cell);
    return rules?.passable ? ns.filter((n) => rules.passable!(n)) : ns;
  };

  const neighbors = (v: Vec): Vec[] => {
    const c = offsetToCube(v);
    const result: Vec[] = [];
    for (const d of CUBE_DIRS) {
      const n = cubeToOffset({ q: c.q + d.q, r: c.r + d.r, s: c.s + d.s });
      if (inBounds(n) && !isBlocked(n)) result.push(n);
    }
    return result;
  };

  /** In-bounds adjacent cells, blocked ones included — a flyer phases through terrain. */
  const phaseNeighbors = (v: Vec): Vec[] => {
    const c = offsetToCube(v);
    const result: Vec[] = [];
    for (const d of CUBE_DIRS) {
      const n = cubeToOffset({ q: c.q + d.q, r: c.r + d.r, s: c.s + d.s });
      if (inBounds(n)) result.push(n);
    }
    return result;
  };

  /**
   * Is the hex line between `a` and `b` free of blockers? Always drawn in a
   * canonical direction (lower column, then lower row, first) so an
   * edge-grazing tie rounds the same way whichever end is looking: sight is
   * symmetric. `nudge` picks which way such a graze rounds.
   */
  const lineClear = (a: Vec, b: Vec, nudge: number, occupied?: (v: Vec) => boolean): boolean => {
    const [from, to] = a.x < b.x || (a.x === b.x && a.y <= b.y) ? [a, b] : [b, a];
    const line = cubeLine(offsetToCube(from), offsetToCube(to), nudge);
    // Endpoints never count as blockers, so a unit standing in a forest sees
    // out and is seen; an intermediate blocked/forest/occupied cell breaks sight.
    for (let i = 1; i < line.length - 1; i++) {
      const cell = cubeToOffset(line[i]!);
      if (isBlocked(cell) || blocksSight(feature(cell)) || (occupied?.(cell) ?? false)) return false;
    }
    return true;
  };

  return {
    width,
    height,
    inBounds,
    isBlocked,
    elevation,
    feature,
    distance,
    neighbors,
    stepAway(from, v) {
      const a = offsetToCube(from);
      const b = offsetToCube(v);
      const n = cubeDistance(a, b);
      if (n === 0) return { x: v.x, y: v.y };
      const eq = 1e-6; // same edge nudge as cubeLine, so a graze rounds deterministically
      return cubeToOffset(
        cubeRound(b.q + (b.q - a.q) / n + eq, b.r + (b.r - a.r) / n + eq, b.s + (b.s - a.s) / n - 2 * eq),
      );
    },
    cellsWithin(v, r) {
      const c = offsetToCube(v);
      const cells: Vec[] = [];
      // Enumerate the cube range [-r, r]^3 (with q+r+s=0), deterministic order.
      for (let dq = -r; dq <= r; dq++) {
        const loR = Math.max(-r, -dq - r);
        const hiR = Math.min(r, -dq + r);
        for (let dr = loR; dr <= hiR; dr++) {
          if (dq === 0 && dr === 0) continue;
          const ds = -dq - dr;
          const cell = cubeToOffset({ q: c.q + dq, r: c.r + dr, s: c.s + ds });
          if (inBounds(cell)) cells.push(cell);
        }
      }
      return cells;
    },
    reachableWithin(v, steps, rules) {
      const start = vecKey(v);
      const seen = new Set<string>([start]);
      let frontier: Vec[] = [v];
      for (let step = 0; step < steps && frontier.length > 0; step++) {
        const next: Vec[] = [];
        for (const cell of frontier) {
          for (const n of walkSteps(cell, step === 0, rules)) {
            const k = vecKey(n);
            if (seen.has(k)) continue;
            seen.add(k);
            next.push(n);
          }
        }
        frontier = next;
      }
      seen.delete(start);
      return seen;
    },
    pathWithin(a, b, steps, rules) {
      const goal = vecKey(b);
      const parent = new Map<string, Vec | null>([[vecKey(a), null]]);
      let frontier: Vec[] = [a];
      for (let step = 0; step <= steps && frontier.length > 0; step++) {
        const next: Vec[] = [];
        for (const cell of frontier) {
          if (vecKey(cell) === goal) {
            const path: Vec[] = [];
            for (let c: Vec | null | undefined = cell; c; c = parent.get(vecKey(c))) path.push(c);
            return path.reverse();
          }
          if (step === steps) continue;
          for (const n of walkSteps(cell, step === 0, rules)) {
            const k = vecKey(n);
            if (parent.has(k)) continue;
            parent.set(k, cell);
            next.push(n);
          }
        }
        frontier = next;
      }
      return null;
    },
    lineOfSight(a, b, occupied) {
      return lineClear(a, b, 1, occupied);
    },
    inCover(a, b, occupied) {
      return feature(b) === 'forest' || !lineClear(a, b, -1, occupied);
    },
  };
}
