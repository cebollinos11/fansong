import { LIMIT_RANGE, makeHexGrid, tossInitiative, vecKey, type GameConfig, type GameLimits, type GameMode, type Owner, type UnitSpec, type Vec } from '@fansong/engine';
import { profileRange, unitCost } from './cost.js';
import { flatMap, mapHexAt, mapToBoard, type MapDef } from './map.js';
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
  /** Player who leads round 1 (default: the seed's coin toss, see {@link tossInitiative}). */
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
  /**
   * Extract the golden Pig: the player escorting the Pig (default 0). The other
   * defends. Ignored in every other mode.
   */
  escort?: Owner;
  /** Custom round limit / target score; omitted = the mode's defaults. */
  limits?: GameLimits;
}

/**
 * The golden Pig: the unit the escort walks into the enemy camp in "Extract the
 * golden Pig". It joins the escorting warband for free, on top of its roster.
 */
export const GOLDEN_PIG: WarbandUnit = {
  name: 'Golden Pig',
  quality: 2,
  combat: 3,
  slow: true,
  tough: true,
  look: 'Piglet',
  tint: '#ffd700',
};

/** Hexes a Slow unit covers per Move: the pace {@link defaultPigRounds} budgets on. */
const PIG_PACE = 3;

/**
 * Rounds allowed on top of the bare walk. Measured in AI self-play: each of the
 * first four is worth escort wins, and more than four changes nothing (by then
 * the Pig has either got home or been cut down).
 */
const PIG_SPARE_ROUNDS = 4;

/**
 * The default round limit of "Extract the golden Pig" on `map` with `escort`
 * escorting: one round per Move the Pig needs to walk from the back of its own
 * deploy zone to the nearest goal hex (the enemy zone), plus {@link PIG_SPARE_ROUNDS} to spare,
 * within {@link LIMIT_RANGE}.
 */
export function defaultPigRounds(map: MapDef, escort: Owner = 0): number {
  const board = makeHexGrid({ ...mapToBoard(map), blocked: [] });
  const open = (v: Vec) => mapHexAt(map, v) !== undefined && !board.isBlocked(v) && !board.isDeadly(v);
  const dist = new Map<string, number>();
  let frontier = map.deployZones[escort === 0 ? 1 : 0].filter(open);
  for (const v of frontier) dist.set(vecKey(v), 0);
  for (let d = 1; frontier.length > 0; d++) {
    const next: Vec[] = [];
    for (const v of frontier)
      for (const n of board.neighbors(v)) {
        if (dist.has(vecKey(n)) || !open(n)) continue;
        dist.set(vecKey(n), d);
        next.push(n);
      }
    frontier = next;
  }
  const walk = Math.max(0, ...map.deployZones[escort].map((v) => dist.get(vecKey(v)) ?? 0));
  return Math.min(LIMIT_RANGE.max, Math.max(LIMIT_RANGE.min, Math.ceil(walk / PIG_PACE) + PIG_SPARE_ROUNDS));
}

/**
 * The unit a warband fields as King when none is chosen: its most expensive
 * model (the first such on a tie) — the natural leader, and one that can fight.
 */
export function defaultKing(units: readonly WarbandUnit[]): number {
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
    pos,
    // Carry the special-ability traits through to the engine profile.
    slow: unit.slow,
    fast: unit.fast,
    ranged: profileRange(unit),
    tough: unit.tough,
    guard: unit.guard,
    big: unit.big,
    flying: unit.flying,
    reassembling: unit.reassembling,
    opportunist: unit.opportunist,
    savage: unit.savage,
    leader: unit.leader,
    armored: unit.armored,
    sharpshooter: unit.sharpshooter,
    mastery: unit.mastery,
    shieldwall: unit.shieldwall,
    rusher: unit.rusher,
    slippery: unit.slippery,
    whirling: unit.whirling,
    immovable: unit.immovable,
    woodwise: unit.woodwise,
    trample: unit.trample,
    dumb: unit.dumb,
    disloyal: unit.disloyal,
    badBalance: unit.badBalance,
    magicUser: unit.magicUser,
  };
  if (unit.look !== undefined) spec.look = unit.look;
  if (unit.tint !== undefined) spec.tint = unit.tint;
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
 *
 * A warband too big for its zone fills the zone, then spills onto the nearest
 * open ground outside it (see {@link overflowHexes}), never onto the enemy's
 * zone or a hex in `taken`. Throws only if the board itself has no room left.
 */
export function layOutInZone(units: WarbandUnit[], owner: Owner, map: MapDef, taken: Vec[] = []): UnitSpec[] {
  const enemy = map.deployZones[owner === 0 ? 1 : 0];
  const zone = map.deployZones[owner].filter((v) => !taken.some((t) => t.x === v.x && t.y === v.y));
  const overflow = units.length > zone.length ? overflowHexes(map, zone, [...enemy, ...taken], units.length - zone.length) : [];
  if (zone.length + overflow.length < units.length)
    throw new Error(
      `map "${map.id}" has room for only ${zone.length + overflow.length} of player ${owner}'s ${units.length} models`,
    );

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
  overflow.slice(0, units.length - next).forEach((v, i) => specs.push(toSpec(units[next + i]!, { ...v })));
  return specs;
}

/**
 * Up to `count` hexes for the models a deploy zone can't hold: the open hexes
 * (no rock, building or lava) nearest `zone` by walking distance, searching out
 * from it ring by ring, never entering `avoid`. Within a ring, hexes farther
 * from the enemy (`avoid`) come first, then row-major.
 */
function overflowHexes(map: MapDef, zone: Vec[], avoid: Vec[], count: number): Vec[] {
  const board = makeHexGrid({ ...mapToBoard(map), blocked: [] });
  const open = (v: Vec) => !board.isBlocked(v) && !board.isDeadly(v);
  const seen = new Set([...zone, ...avoid].map(vecKey));
  const farFromEnemy = (v: Vec) => (avoid.length === 0 ? 0 : Math.min(...avoid.map((e) => board.distance(v, e))));
  const out: Vec[] = [];
  let ring = zone.filter(open);
  while (out.length < count && ring.length > 0) {
    const next: Vec[] = [];
    for (const v of ring)
      for (const n of board.neighbors(v)) {
        if (seen.has(vecKey(n)) || !open(n)) continue;
        seen.add(vecKey(n));
        next.push(n);
      }
    next.sort((a, b) => farFromEnemy(b) - farFromEnemy(a) || a.y - b.y || a.x - b.x);
    out.push(...next.slice(0, count - out.length));
    ring = next;
  }
  return out;
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
 * objectives (the map must provide them), kill-the-king flags each side's King,
 * and "Extract the golden Pig" adds the {@link GOLDEN_PIG} to the escort's side,
 * makes the defender's deploy zone the goal and sets the round limit (see
 * {@link defaultPigRounds}) unless `opts.limits` names one.
 */
export function buildMatch(p0: Warband, p1: Warband, opts: MatchOptions): GameConfig {
  const mode = opts.mode ?? 'annihilation';
  const escort: Owner | undefined = mode === 'golden-pig' ? (opts.escort ?? 0) : undefined;
  if (escort !== undefined && escort !== 0 && escort !== 1) throw new Error(`escort must be player 0 or 1, got ${String(escort)}`);
  // The Pig deploys first, so it lands in the back rank, and trades places with
  // whoever stands in the middle of it; its spec then goes last, so every other
  // unit keeps the id it has in any other mode.
  const fielded = (w: Warband, owner: Owner) => (owner === escort ? [GOLDEN_PIG, ...w.units] : w.units);
  const field = opts.map ?? flatMap((opts.board ?? DEFAULT_BOARD).width, (opts.board ?? DEFAULT_BOARD).height);
  const pigLast = (specs: UnitSpec[], owner: Owner): UnitSpec[] => {
    if (owner !== escort) return specs;
    const [pig, ...rest] = specs;
    const grid = makeHexGrid({ width: field.width, height: field.height, blocked: [] });
    const enemy = field.deployZones[owner === 0 ? 1 : 0];
    const depth = (v: Vec) => Math.min(...enemy.map((e) => grid.distance(v, e)));
    const rank = specs.filter((s) => depth(s.pos) === depth(pig!.pos));
    const centre = { x: rank.reduce((n, s) => n + s.pos.x, 0) / rank.length, y: rank.reduce((n, s) => n + s.pos.y, 0) / rank.length };
    const off = (s: UnitSpec) => (s.pos.x - centre.x) ** 2 + (s.pos.y - centre.y) ** 2;
    const middle = rank.reduce((best, s) => (off(s) < off(best) ? s : best));
    [pig!.pos, middle.pos] = [middle.pos, pig!.pos];
    return [...rest, { ...pig!, pig: true }];
  };
  let config: GameConfig;
  if (opts.map) {
    const map = opts.map;
    const check = validateMap(map, mode === 'annihilation' ? undefined : mode);
    if (!check.ok) throw new Error(`map "${map.id}" is invalid: ${check.errors.join('; ')}`);
    const first = layOutInZone(fielded(p0, 0), 0, map);
    const second = layOutInZone(fielded(p1, 1), 1, map, first.map((s) => s.pos));
    config = {
      seed: opts.seed,
      board: mapToBoard(map),
      warbands: [pigLast(first, 0), pigLast(second, 1)],
      initiativeLeader: opts.initiativeLeader ?? tossInitiative(opts.seed),
    };
    if (mode === 'golden-pig') config.objectives = { extraction: map.deployZones[escort === 0 ? 1 : 0].map((v) => ({ x: v.x, y: v.y })) };
    else if (mode !== 'annihilation' && mode !== 'kill-the-king') config.objectives = objectivesFor(map, mode);
  } else {
    if (mode !== 'annihilation' && mode !== 'kill-the-king' && mode !== 'golden-pig')
      throw new Error(`mode '${mode}' needs a map with its objectives`);
    const board = opts.board ?? DEFAULT_BOARD;
    config = {
      seed: opts.seed,
      board: { width: board.width, height: board.height },
      warbands: [pigLast(layOutWarband(fielded(p0, 0), 0, board), 0), pigLast(layOutWarband(fielded(p1, 1), 1, board), 1)],
      initiativeLeader: opts.initiativeLeader ?? tossInitiative(opts.seed),
    };
    // The goal is the defender's edge column.
    if (escort !== undefined) {
      const x = escort === 0 ? board.width - 1 : 0;
      config.objectives = { extraction: Array.from({ length: board.height }, (_, y) => ({ x, y })) };
    }
  }
  // Default games add no keys, so their config (and every replay hash) is unchanged.
  if (opts.limits && Object.keys(opts.limits).length > 0) config.limits = opts.limits;
  if (escort !== undefined && opts.limits?.roundLimit === undefined) {
    const board = opts.board ?? DEFAULT_BOARD;
    const map = opts.map ?? flatMap(board.width, board.height);
    config.limits = { ...config.limits, roundLimit: defaultPigRounds(map, escort) };
  }
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
