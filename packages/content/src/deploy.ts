import { makeHexGrid, type GameConfig, type GameMode, type Owner, type UnitSpec, type Vec } from '@fansong/engine';
import { unitCost } from './cost.js';
import { flatMap, mapToBoard, type MapDef } from './map.js';
import { validateMap } from './mapValidate.js';
import type { Warband, WarbandUnit } from './warband.js';

export interface BoardSize {
  width: number;
  height: number;
}

export interface MatchOptions {
  seed: number;
  /** Legacy flat board (edge-column deployment). Ignored when `map` is given. */
  board?: BoardSize;
  /** Battlefield to play on: its terrain, and deploy zones units are laid out in. */
  map?: MapDef;
  /** Player who leads round 1 (default 0). */
  initiativeLeader?: Owner;
  /**
   * Game mode (default `annihilation`). Objective modes other than kill-the-king
   * need a `map` providing that mode's objectives.
   */
  mode?: GameMode;
  /**
   * Kill-the-king: index into each warband's `units` of its King. Defaults to
   * {@link defaultKing}. Ignored in every other mode.
   */
  kings?: [number, number];
}

/**
 * The unit a warband fields as King when none is chosen: its most expensive
 * model (the first such on a tie) — the natural leader, and one that can fight.
 */
export function defaultKing(units: WarbandUnit[]): number {
  let best = 0;
  units.forEach((u, i) => {
    if (unitCost(u) > unitCost(units[best]!)) best = i;
  });
  return best;
}

/** Default battlefield for a two-warband skirmish. */
export const DEFAULT_BOARD: BoardSize = { width: 12, height: 10 };

/**
 * The default map: flat, featureless, {@link DEFAULT_BOARD}-sized, deploying in
 * the two edge columns. Its match config equals the legacy `board` one exactly.
 */
export const DEFAULT_MAP: MapDef = flatMap(DEFAULT_BOARD.width, DEFAULT_BOARD.height);

function toSpec(unit: WarbandUnit, pos: Vec): UnitSpec {
  const spec: UnitSpec = {
    name: unit.name,
    quality: unit.quality,
    combat: unit.combat,
    move: unit.move,
    pos,
    // Carry the special-ability traits through to the engine profile.
    ranged: unit.ranged,
    tough: unit.tough,
    guard: unit.guard,
  };
  if (unit.look !== undefined) spec.look = unit.look;
  return spec;
}

/**
 * Deterministic deployment: line a warband up in its home column(s). Player 0
 * deploys from the left edge rightward, player 1 from the right edge leftward.
 * Each column holds up to `board.height` models, vertically centred; overflow
 * wraps into the next column inward. No two placements collide.
 */
export function layOutWarband(units: WarbandUnit[], owner: Owner, board: BoardSize): UnitSpec[] {
  const perColumn = Math.max(1, board.height);
  const specs: UnitSpec[] = [];

  units.forEach((unit, i) => {
    const column = Math.floor(i / perColumn);
    const rowIndex = i % perColumn;
    // How many models share this column, to centre them vertically.
    const inColumn = Math.min(perColumn, units.length - column * perColumn);
    const top = Math.floor((board.height - inColumn) / 2);

    const x = owner === 0 ? column : board.width - 1 - column;
    const y = top + rowIndex;
    specs.push(toSpec(unit, { x, y }));
  });

  return specs;
}

/**
 * Deterministic deployment into a map's deploy zone for `owner`. The zone is cut
 * into ranks by hex distance to the nearest enemy deploy hex; the rank farthest
 * from the enemy fills first, overflow spills into the next rank forward. Each
 * rank runs across the enemy direction (by row when the enemy lies left/right,
 * by column when above/below) and its models take a centred run of its hexes.
 *
 * On {@link DEFAULT_MAP} this is exactly {@link layOutWarband}'s placement.
 * Throws if the zone has fewer hexes than the warband has models.
 */
export function layOutInZone(units: WarbandUnit[], owner: Owner, map: MapDef): UnitSpec[] {
  const zone = map.deployZones[owner];
  const enemy = map.deployZones[owner === 0 ? 1 : 0];
  if (units.length > zone.length)
    throw new Error(`deploy zone ${owner} of map "${map.id}" has ${zone.length} hexes for ${units.length} models`);

  const grid = makeHexGrid({ width: map.width, height: map.height, blocked: [] });
  const depth = (v: Vec) =>
    enemy.length === 0 ? 0 : Math.min(...enemy.map((e) => grid.distance(v, e)));
  const mean = (vs: Vec[], k: 'x' | 'y') => (vs.length === 0 ? 0 : vs.reduce((s, v) => s + v[k], 0) / vs.length);
  // Ranks run perpendicular to the line between the two zones.
  const sideways =
    Math.abs(mean(enemy, 'x') - mean(zone, 'x')) >= Math.abs(mean(enemy, 'y') - mean(zone, 'y'));
  const across = (a: Vec, b: Vec) => (sideways ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y);

  const ranks = new Map<number, Vec[]>();
  for (const v of zone) {
    const d = depth(v);
    ranks.set(d, [...(ranks.get(d) ?? []), v]);
  }
  const ordered = [...ranks.entries()].sort((a, b) => b[0] - a[0]).map(([, hexes]) => hexes.sort(across));

  const specs: UnitSpec[] = [];
  let next = 0;
  for (const rank of ordered) {
    const count = Math.min(rank.length, units.length - next);
    if (count <= 0) break;
    const start = Math.floor((rank.length - count) / 2);
    for (let i = 0; i < count; i++) specs.push(toSpec(units[next + i]!, { ...rank[start + i]! }));
    next += count;
  }
  return specs;
}

/**
 * Build an engine {@link GameConfig} from two warbands. Feed the result to
 * `createGame`. The same helper backs the CLI harness today and any future UI.
 *
 * With `opts.map` the board takes the map's terrain and warbands deploy into its
 * zones (the map must pass `validateMap`); otherwise the legacy flat `opts.board`
 * (default {@link DEFAULT_BOARD}) with edge-column deployment is used.
 *
 * `opts.mode` adds `mode` to the config: objective modes take the map's
 * objectives (the map must provide them), kill-the-king flags each side's King.
 */
export function buildMatch(p0: Warband, p1: Warband, opts: MatchOptions): GameConfig {
  const mode = opts.mode ?? 'annihilation';
  let config: GameConfig;
  if (opts.map) {
    const map = opts.map;
    const check = validateMap(map, mode === 'annihilation' ? undefined : mode);
    if (!check.ok) throw new Error(`map "${map.id}" is invalid: ${check.errors.join('; ')}`);
    config = {
      seed: opts.seed,
      board: mapToBoard(map),
      warbands: [layOutInZone(p0.units, 0, map), layOutInZone(p1.units, 1, map)],
      initiativeLeader: opts.initiativeLeader ?? 0,
    };
    if (mode !== 'annihilation' && mode !== 'kill-the-king') config.objectives = objectivesFor(map, mode);
  } else {
    if (mode !== 'annihilation' && mode !== 'kill-the-king')
      throw new Error(`mode '${mode}' needs a map with its objectives`);
    const board = opts.board ?? DEFAULT_BOARD;
    config = {
      seed: opts.seed,
      board: { width: board.width, height: board.height },
      warbands: [layOutWarband(p0.units, 0, board), layOutWarband(p1.units, 1, board)],
      initiativeLeader: opts.initiativeLeader ?? 0,
    };
  }
  // Annihilation adds no keys, so its config (and every replay hash) is unchanged.
  if (mode === 'annihilation') return config;
  config.mode = mode;
  if (mode === 'kill-the-king') {
    const kings = opts.kings ?? [defaultKing(p0.units), defaultKing(p1.units)];
    config.warbands.forEach((specs, owner) => {
      const k = kings[owner]!;
      if (!Number.isInteger(k) || k < 0 || k >= specs.length)
        throw new Error(`player ${owner}'s King index ${k} is not one of its ${specs.length} units`);
      specs[k]!.king = true;
    });
  }
  return config;
}

/** Just the map objectives `mode` plays with (deep-copied), for the engine config. */
function objectivesFor(map: MapDef, mode: 'capture-the-flag' | 'king-of-the-hill' | 'conquest'): GameConfig['objectives'] {
  const copy = (vs: Vec[]) => vs.map((v) => ({ x: v.x, y: v.y }));
  const { flags, hill, conquest } = map.objectives;
  if (mode === 'capture-the-flag') return { flags: [{ ...flags![0] }, { ...flags![1] }] };
  if (mode === 'king-of-the-hill') return { hill: copy(hill!) };
  return { conquest: [copy(conquest![0]), copy(conquest![1]), copy(conquest![2])] };
}
