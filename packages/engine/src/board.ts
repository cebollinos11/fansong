/**
 * Spatial model. Everything spatial goes through the `Board` interface so a hex
 * board could replace the square grid later without touching the rules.
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

/** Serialisable board description held in GameState. */
export interface BoardData {
  width: number;
  height: number;
  /** Impassable / LoS-blocking cell keys ("x,y"). */
  blocked: string[];
}

export interface Board {
  readonly width: number;
  readonly height: number;
  inBounds(v: Vec): boolean;
  isBlocked(v: Vec): boolean;
  /** Chebyshev (king-move) distance on the square grid. */
  distance(a: Vec, b: Vec): number;
  /** In-bounds, unblocked 8-directional neighbours. */
  neighbors(v: Vec): Vec[];
  /** Bresenham supercover LoS; blocked terrain (and optionally occupied cells) break it. */
  lineOfSight(a: Vec, b: Vec, occupied?: (v: Vec) => boolean): boolean;
}

const DIRS: ReadonlyArray<Vec> = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

export function makeSquareGrid(data: BoardData): Board {
  const blocked = new Set(data.blocked);
  const { width, height } = data;

  const inBounds = (v: Vec) => v.x >= 0 && v.y >= 0 && v.x < width && v.y < height;
  const isBlocked = (v: Vec) => blocked.has(vecKey(v));

  return {
    width,
    height,
    inBounds,
    isBlocked,
    distance: (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)),
    neighbors: (v) => DIRS.map((d) => ({ x: v.x + d.x, y: v.y + d.y })).filter((n) => inBounds(n) && !isBlocked(n)),
    lineOfSight: (a, b, occupied) => supercoverLoS(a, b, isBlocked, occupied),
  };
}

/**
 * Bresenham "supercover" line of sight: sight is clear if no *intermediate* cell
 * is blocked terrain or (when `occupied` is supplied) occupied. Endpoints are
 * never counted as blockers.
 */
function supercoverLoS(
  a: Vec,
  b: Vec,
  isBlocked: (v: Vec) => boolean,
  occupied?: (v: Vec) => boolean,
): boolean {
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;

  // Guard against pathological loops; grids are small.
  const maxSteps = dx + dy + 2;
  for (let i = 0; i < maxSteps; i++) {
    if (x === b.x && y === b.y) return true;
    const blocker = (x !== a.x || y !== a.y) && (isBlocked({ x, y }) || (occupied?.({ x, y }) ?? false));
    if (blocker) return false;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return x === b.x && y === b.y;
}
