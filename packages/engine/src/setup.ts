import type { BoardData, HexTerrain, Vec } from './board.js';
import { createModeState, type GameMode, type ModeObjectives } from './mode.js';
import { seedRng } from './rng.js';
import type { GameState, Owner, Unit } from './types.js';

export interface UnitSpec {
  name: string;
  quality: number;
  combat: number;
  move?: number;
  pos: Vec;
  /** Ranged attack range in cells (0/omitted = melee only). */
  ranged?: number;
  /** First would-be kill is downgraded to a knockdown. */
  tough?: boolean;
  /** May take a Guard action to riposte the first melee attacker. */
  guard?: boolean;
  /** Big: +1 in melee against smaller foes, and +1 to anyone shooting it. */
  big?: boolean;
  /** Flying: moves over terrain and units (lands on a legal hex), draws no free hacks, +1 swooping into melee — but +1 to anyone shooting it airborne. */
  flying?: boolean;
  /**
   * Kill-the-king: this unit is its side's King (exactly one per warband in that
   * mode). Ignored in every other mode.
   */
  king?: boolean;
  /** Cosmetic: the unit this one is drawn as (see {@link Unit.look}). */
  look?: string;
}

export interface GameConfig {
  seed: number;
  board: {
    width: number;
    height: number;
    blocked?: string[];
    /** Sparse per-hex elevation/feature, keyed "x,y" (see {@link BoardData.terrain}). */
    terrain?: Record<string, HexTerrain>;
  };
  /** Units for each player. */
  warbands: [UnitSpec[], UnitSpec[]];
  /** Player who leads round 1 (default 0). */
  initiativeLeader?: Owner;
  /** Game mode (default `annihilation`, which carries no mode state). */
  mode?: GameMode;
  /** Objective placements the mode needs (flags / hill / conquest zones). */
  objectives?: ModeObjectives;
}

function makeUnit(spec: UnitSpec, owner: Owner, index: number): Unit {
  const unit: Unit = {
    id: `p${owner}u${index}`,
    owner,
    name: spec.name,
    quality: spec.quality,
    combat: spec.combat,
    move: spec.move ?? 3,
    pos: { x: spec.pos.x, y: spec.pos.y },
    dead: false,
    knockedDown: false,
    activatedThisRound: false,
    traits: {
      ranged: spec.ranged ?? 0,
      tough: spec.tough ?? false,
      guard: spec.guard ?? false,
      big: spec.big ?? false,
      flying: spec.flying ?? false,
    },
    guarding: false,
  };
  // Only carried when set, so states (and replay hashes) without looks are unchanged.
  if (spec.look !== undefined) unit.look = spec.look;
  return unit;
}

/** The id of the one unit flagged `king` in a warband; throws unless exactly one is. */
function kingId(specs: UnitSpec[], owner: Owner): string {
  const idx = specs.flatMap((s, i) => (s.king ? [i] : []));
  if (idx.length !== 1) throw new Error(`kill-the-king: player ${owner} must designate exactly one King (got ${idx.length})`);
  return `p${owner}u${idx[0]}`;
}

/**
 * Copy a sparse terrain map, dropping default entries (elevation 0, no feature)
 * and sorting keys so equal terrain always serialises identically. Returns
 * `undefined` when nothing non-default remains.
 */
export function normalizeTerrain(
  terrain: Record<string, HexTerrain> | undefined,
): Record<string, HexTerrain> | undefined {
  if (!terrain) return undefined;
  const out: Record<string, HexTerrain> = {};
  for (const key of Object.keys(terrain).sort()) {
    const t = terrain[key]!;
    const hex: HexTerrain = {};
    if (t.elevation) hex.elevation = t.elevation;
    if (t.feature) hex.feature = t.feature;
    if (hex.elevation !== undefined || hex.feature !== undefined) out[key] = hex;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function createGame(config: GameConfig): GameState {
  const board: BoardData = {
    width: config.board.width,
    height: config.board.height,
    blocked: config.board.blocked ? [...config.board.blocked] : [],
  };
  const terrain = normalizeTerrain(config.board.terrain);
  // Only attach terrain when there is some, so a flat board's state shape (and
  // therefore every existing replay hash) is unchanged.
  if (terrain) board.terrain = terrain;

  const units: Unit[] = [
    ...config.warbands[0].map((s, i) => makeUnit(s, 0, i)),
    ...config.warbands[1].map((s, i) => makeUnit(s, 1, i)),
  ];

  const leader = config.initiativeLeader ?? 0;
  const startCount: [number, number] = [
    units.filter((u) => u.owner === 0).length,
    units.filter((u) => u.owner === 1).length,
  ];

  const state: GameState = {
    board,
    units,
    round: 1,
    initiativeLeader: leader,
    active: leader,
    benched: [false, false],
    broken: [false, false],
    startCount,
    phase: 'awaitingActivation',
    activeUnitId: null,
    actionsRemaining: 0,
    activationCount: 0,
    rngState: seedRng(config.seed),
    winner: null,
  };
  // Like terrain, mode state is attached only when there is some.
  const mode = createModeState(config.mode, config.objectives);
  if (mode?.mode === 'kill-the-king') mode.kings = [kingId(config.warbands[0], 0), kingId(config.warbands[1], 1)];
  if (mode) state.mode = mode;
  return state;
}

/**
 * A small symmetric demo: three fighters a side facing off across an 8x8 board.
 * Used by the CLI harness and the AI-vs-AI tests.
 */
export function createDemoGame(seed: number): GameState {
  const height = 8;
  const width = 8;
  const rows = [1, 3, 5];
  const p0: UnitSpec[] = [
    { name: 'Warden', quality: 3, combat: 3, pos: { x: 0, y: rows[0]! } },
    { name: 'Blade', quality: 4, combat: 4, pos: { x: 0, y: rows[1]! } },
    { name: 'Skirmisher', quality: 3, combat: 2, move: 4, pos: { x: 0, y: rows[2]! } },
  ];
  const p1: UnitSpec[] = [
    { name: 'Raider', quality: 3, combat: 3, pos: { x: width - 1, y: rows[0]! } },
    { name: 'Brute', quality: 4, combat: 4, pos: { x: width - 1, y: rows[1]! } },
    { name: 'Scout', quality: 3, combat: 2, move: 4, pos: { x: width - 1, y: rows[2]! } },
  ];

  return createGame({
    seed,
    board: { width, height },
    warbands: [p0, p1],
  });
}
