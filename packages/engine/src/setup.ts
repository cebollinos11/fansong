import type { BoardData, Vec } from './board.js';
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
}

export interface GameConfig {
  seed: number;
  board: { width: number; height: number; blocked?: string[] };
  /** Units for each player. */
  warbands: [UnitSpec[], UnitSpec[]];
  /** Player who leads round 1 (default 0). */
  initiativeLeader?: Owner;
}

function makeUnit(spec: UnitSpec, owner: Owner, index: number): Unit {
  return {
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
    },
    guarding: false,
  };
}

export function createGame(config: GameConfig): GameState {
  const board: BoardData = {
    width: config.board.width,
    height: config.board.height,
    blocked: config.board.blocked ? [...config.board.blocked] : [],
  };

  const units: Unit[] = [
    ...config.warbands[0].map((s, i) => makeUnit(s, 0, i)),
    ...config.warbands[1].map((s, i) => makeUnit(s, 1, i)),
  ];

  const leader = config.initiativeLeader ?? 0;
  const startCount: [number, number] = [
    units.filter((u) => u.owner === 0).length,
    units.filter((u) => u.owner === 1).length,
  ];

  return {
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
