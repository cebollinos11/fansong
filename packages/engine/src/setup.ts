import type { BoardData, HexTerrain, Vec } from './board.js';
import { createModeState, normalizeLimits, type GameLimits, type GameMode, type ModeObjectives } from './mode.js';
import { seedRng } from './rng.js';
import type { GameState, Owner, Unit } from './types.js';

export interface UnitSpec {
  name: string;
  quality: number;
  combat: number;
  pos: Vec;
  /** Slow: 3 hexes per Move action instead of the base 5. Never with `fast`. */
  slow?: boolean;
  /** Fast: 7 hexes per Move action instead of the base 5. Never with `slow`. */
  fast?: boolean;
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
  /** Reassembling: a knocked-down unit stands up for free at the start of each round. */
  reassembling?: boolean;
  /** Opportunist: +1 in melee or shooting against a knocked-down or transfixed foe. */
  opportunist?: boolean;
  /** Savage: every kill it deals is a gruesome kill. */
  savage?: boolean;
  /** Leader: may war cry once a round, inspiring its friends; its death shakes those who see it. */
  leader?: boolean;
  /** Armored: a combat it loses by exactly 1 point does it no harm. */
  armored?: boolean;
  /** Sharpshooter: +1 to every shot it takes. */
  sharpshooter?: boolean;
  /** Combat Mastery: a melee it ties against a foe without it kills that foe. */
  mastery?: boolean;
  /** Shieldwall: +1 defending against a melee attack while next to a standing friend. */
  shieldwall?: boolean;
  /** Rusher: +1 on the first attack after a Move that brought it into contact with its target. */
  rusher?: boolean;
  /** Slippery: leaving contact draws no free hack, unless it carries a flag. */
  slippery?: boolean;
  /** Whirling: never outnumbered in melee while on its feet. */
  whirling?: boolean;
  /** Immovable: never pushed. Never with `badBalance`. */
  immovable?: boolean;
  /** Woodwise: +1 on every combat roll while standing in a forest hex. */
  woodwise?: boolean;
  /** Trample: a foe it pushes in melee goes two hexes instead of one. */
  trample?: boolean;
  /** Dumb: at most 2 activation dice. */
  dumb?: boolean;
  /** Disloyal: a natural 1 on a nerve check makes it change sides. */
  disloyal?: boolean;
  /** Bad Balance: a push that moves it also knocks it down. Never with `immovable`. */
  badBalance?: boolean;
  /** Magic User: may take a spell turn to cast Transfix. */
  magicUser?: boolean;
  /**
   * Kill-the-king: this unit is its side's King (exactly one per warband in that
   * mode). Ignored in every other mode.
   */
  king?: boolean;
  /**
   * Extract the golden Pig: this unit is the Pig, and its owner the escort
   * (exactly one across both warbands in that mode). Ignored in every other mode.
   */
  pig?: boolean;
  /** Cosmetic: the unit this one is drawn as (see {@link Unit.look}). */
  look?: string;
  /** Cosmetic: a colour blended into its sprite (see {@link Unit.tint}). */
  tint?: string;
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
  /** Custom round limit / target score (default: the mode's own; see {@link GameLimits}). */
  limits?: GameLimits;
  /**
   * The hexes player 0's and player 1's retreat flag may be planted on (see
   * `RetreatCommand`). An empty list means that player cannot retreat; omitted
   * (or both empty), nobody can and the game is the ordinary one.
   */
  retreatZones?: [Vec[], Vec[]];
}

function makeUnit(spec: UnitSpec, owner: Owner, index: number): Unit {
  if (spec.slow && spec.fast) throw new Error(`unit '${spec.name}' cannot be both slow and fast`);
  if (spec.immovable && spec.badBalance) throw new Error(`unit '${spec.name}' cannot be both immovable and badly balanced`);
  const unit: Unit = {
    id: `p${owner}u${index}`,
    owner,
    name: spec.name,
    quality: spec.quality,
    combat: spec.combat,
    pos: { x: spec.pos.x, y: spec.pos.y },
    dead: false,
    knockedDown: false,
    activatedThisRound: false,
    traits: {
      slow: spec.slow ?? false,
      fast: spec.fast ?? false,
      ranged: spec.ranged ?? 0,
      tough: spec.tough ?? false,
      guard: spec.guard ?? false,
      big: spec.big ?? false,
      flying: spec.flying ?? false,
      reassembling: spec.reassembling ?? false,
      opportunist: spec.opportunist ?? false,
      savage: spec.savage ?? false,
      leader: spec.leader ?? false,
      armored: spec.armored ?? false,
      sharpshooter: spec.sharpshooter ?? false,
      mastery: spec.mastery ?? false,
      shieldwall: spec.shieldwall ?? false,
      rusher: spec.rusher ?? false,
      slippery: spec.slippery ?? false,
      whirling: spec.whirling ?? false,
      immovable: spec.immovable ?? false,
      woodwise: spec.woodwise ?? false,
      trample: spec.trample ?? false,
      dumb: spec.dumb ?? false,
      disloyal: spec.disloyal ?? false,
      badBalance: spec.badBalance ?? false,
      magicUser: spec.magicUser ?? false,
    },
    guarding: false,
    inspired: false,
    warCried: false,
  };
  // Only carried when set, so states (and replay hashes) without looks are unchanged.
  if (spec.look !== undefined) unit.look = spec.look;
  if (spec.tint !== undefined) unit.tint = spec.tint;
  return unit;
}

/** The id of the one unit flagged `king` in a warband; throws unless exactly one is. */
function kingId(specs: UnitSpec[], owner: Owner): string {
  const idx = specs.flatMap((s, i) => (s.king ? [i] : []));
  if (idx.length !== 1) throw new Error(`kill-the-king: player ${owner} must designate exactly one King (got ${idx.length})`);
  return `p${owner}u${idx[0]}`;
}

/** The one unit flagged `pig` across both warbands, and its owner; throws unless exactly one is. */
function pigIn(warbands: [UnitSpec[], UnitSpec[]]): { unitId: string; escort: Owner } {
  const found = warbands.flatMap((specs, owner) => specs.flatMap((s, i) => (s.pig ? [{ unitId: `p${owner}u${i}`, escort: owner as Owner }] : [])));
  if (found.length !== 1) throw new Error(`golden-pig: exactly one unit must be the Pig (got ${found.length})`);
  return found[0]!;
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
  if (mode?.mode === 'golden-pig') mode.pig = pigIn(config.warbands);
  if (mode) state.mode = mode;
  const limits = normalizeLimits(config.mode, config.limits);
  if (limits) state.limits = limits;
  // Likewise the retreat zones: a game without any carries nothing.
  const zones = config.retreatZones;
  if (zones && (zones[0].length > 0 || zones[1].length > 0)) {
    state.retreatZones = [zones[0].map((v) => ({ x: v.x, y: v.y })), zones[1].map((v) => ({ x: v.x, y: v.y }))];
  }
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
    { name: 'Skirmisher', quality: 3, combat: 2, fast: true, pos: { x: 0, y: rows[2]! } },
  ];
  const p1: UnitSpec[] = [
    { name: 'Raider', quality: 3, combat: 3, pos: { x: width - 1, y: rows[0]! } },
    { name: 'Brute', quality: 4, combat: 4, pos: { x: width - 1, y: rows[1]! } },
    { name: 'Scout', quality: 3, combat: 2, fast: true, pos: { x: width - 1, y: rows[2]! } },
  ];

  return createGame({
    seed,
    board: { width, height },
    warbands: [p0, p1],
  });
}
