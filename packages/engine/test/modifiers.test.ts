import { describe, expect, it } from 'vitest';
import {
  computeCombatResult,
  createGame,
  isGruesome,
  makeHexGrid,
  outnumberedPenalty,
  rangePenalty,
  reduce,
  shortRange,
  type CombatSide,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
  type Vec,
} from '../src/index.js';

type Attack = Extract<GameEvent, { type: 'AttackResolved' }>;
type Shot = Extract<GameEvent, { type: 'ShotResolved' }>;

const side = (score: number): CombatSide => ({ score, die: 2, knockedDown: false, canRecoil: true });

/** Mid-activation for `p0u0`, with the RNG untouched so only this action consumes it. */
function acting(c: GameConfig): GameState {
  const s = createGame(c);
  s.active = 0;
  s.activeUnitId = 'p0u0';
  s.phase = 'acting';
  s.actionsRemaining = 1;
  s.units[0]!.activatedThisRound = true;
  return s;
}

const attack = (s: GameState) =>
  reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });

describe('scores at or below zero', () => {
  it('any win over a score of 0 or less kills; a tie is still a clash', () => {
    expect(computeCombatResult(side(3), side(0))).toBe('defenderKilled');
    expect(computeCombatResult(side(0), side(0))).toBe('clash');
    expect(computeCombatResult(side(-1), side(0))).toBe('attackerKilled');
    expect(computeCombatResult(side(-1), side(-1))).toBe('clash');
  });
});

describe('gruesome kills', () => {
  it('needs the winner to triple the loser', () => {
    expect(isGruesome(9, 3)).toBe(true);
    expect(isGruesome(8, 3)).toBe(false);
    expect(isGruesome(1, 0)).toBe(true);
    expect(isGruesome(3, 3)).toBe(false);
    expect(isGruesome(3, 9)).toBe(false);
  });

  // A heavy hitter against a feeble target with a friend nearby. P1 has enough
  // units that one death never breaks the warband, so any nerve check is fear.
  const cfg = (seed: number): GameConfig => ({
    seed,
    board: { width: 9, height: 5 },
    warbands: [
      [{ name: 'Brute', quality: 3, combat: 6, pos: { x: 2, y: 2 } }],
      [
        { name: 'Victim', quality: 4, combat: 1, pos: { x: 3, y: 2 } },
        { name: 'Friend', quality: 4, combat: 3, pos: { x: 3, y: 4 } },
        { name: 'Far1', quality: 4, combat: 3, pos: { x: 8, y: 0 } },
        { name: 'Far2', quality: 4, combat: 3, pos: { x: 8, y: 4 } },
      ],
    ],
  });

  function kill(gruesome: boolean) {
    for (let seed = 1; seed <= 500; seed++) {
      const { events } = attack(acting(cfg(seed)));
      const e = events.find((x): x is Attack => x.type === 'AttackResolved')!;
      if (e.result === 'defenderKilled' && !!e.gruesome === gruesome) return { e, events };
    }
    throw new Error(`no seed gives a ${gruesome ? '' : 'non-'}gruesome kill`);
  }

  it('flags a tripled kill and makes nearby friends test nerve', () => {
    const { e, events } = kill(true);
    expect(e.attackScore).toBeGreaterThanOrEqual(e.defenseScore * 3);
    const tested = events.filter((x) => x.type === 'NerveCheck').map((x) => (x as { unitId: string }).unitId);
    expect(tested).toEqual(['p1u1']); // the Friend — not the far pair
  });

  it('an ordinary kill spreads no fear', () => {
    const { e, events } = kill(false);
    expect('gruesome' in e).toBe(false);
    expect(events.some((x) => x.type === 'NerveCheck')).toBe(false);
  });
});

describe('outnumbering', () => {
  const striker: UnitSpec = { name: 'Striker', quality: 3, combat: 3, pos: { x: 2, y: 2 } };
  const helper: UnitSpec = { name: 'Helper', quality: 3, combat: 3, pos: { x: 3, y: 3 } };
  const target: UnitSpec = { name: 'Target', quality: 3, combat: 3, pos: { x: 3, y: 2 } };
  const cfg = (p0: UnitSpec[], seed = 1): GameConfig => ({
    seed,
    board: { width: 7, height: 5 },
    warbands: [p0, [target]],
  });

  it('is −1 per standing enemy in contact beyond the first', () => {
    const s = createGame({
      seed: 1,
      board: { width: 7, height: 5 },
      warbands: [
        [striker, helper, { ...helper, name: 'Third', pos: { x: 4, y: 2 } }],
        [target],
      ],
    });
    const board = makeHexGrid(s.board);
    const t = s.units.find((u) => u.id === 'p1u0')!;
    expect(outnumberedPenalty(s, t, board)).toBe(2);
    s.units[1]!.knockedDown = true; // a fallen foe doesn't count
    expect(outnumberedPenalty(s, t, board)).toBe(1);
    expect(outnumberedPenalty(s, s.units[0]!, board)).toBe(0);
  });

  it('applies to the outnumbered side of an attack', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const e = attack(acting(cfg([striker, helper], seed))).events.find((x): x is Attack => x.type === 'AttackResolved')!;
      expect(e.defenseOutnumbered).toBe(1);
      expect(e.defenseScore).toBe(3 + e.defenseDie - 1);
      expect('attackOutnumbered' in e).toBe(false);
      expect(e.attackScore).toBe(3 + e.attackDie);
    }
  });

  it('is absent one-on-one', () => {
    const e = attack(acting(cfg([striker]))).events.find((x): x is Attack => x.type === 'AttackResolved')!;
    expect('defenseOutnumbered' in e).toBe(false);
  });
});

describe('range bands', () => {
  it('short range is the first half of the reach, rounded up; beyond it is −1', () => {
    expect(shortRange(3)).toBe(2);
    expect(shortRange(4)).toBe(2);
    expect(shortRange(6)).toBe(3);
    expect(rangePenalty(4, 2)).toBe(0);
    expect(rangePenalty(4, 3)).toBe(1);
    expect(rangePenalty(4, 4)).toBe(1);
    expect(rangePenalty(6, 3)).toBe(0);
  });

  const shoot = (targetPos: Vec, terrain?: GameConfig['board']['terrain']) => {
    const s = acting({
      seed: 3,
      board: { width: 9, height: 5, ...(terrain ? { terrain } : {}) },
      warbands: [
        [{ name: 'Bow', quality: 3, combat: 3, ranged: 4, pos: { x: 0, y: 2 } }],
        [{ name: 'Mark', quality: 3, combat: 3, pos: targetPos }],
      ],
    });
    const e = reduce(s, { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' }).events.find(
      (x): x is Shot => x.type === 'ShotResolved',
    )!;
    return e;
  };

  it('a long shot carries the penalty; a short one does not', () => {
    const near = shoot({ x: 2, y: 2 });
    expect('rangePenalty' in near).toBe(false);
    expect(near.attackScore).toBe(3 + near.attackDie);
    const far = shoot({ x: 4, y: 2 });
    expect(far.rangePenalty).toBe(1);
    expect(far.attackScore).toBe(3 + far.attackDie - 1);
  });

  it('a target standing in a forest is in cover', () => {
    const e = shoot({ x: 2, y: 2 }, { '2,2': { feature: 'forest' } });
    expect(e.coverPenalty).toBe(1);
    expect(e.attackScore).toBe(3 + e.attackDie - 1);
    expect('coverPenalty' in shoot({ x: 2, y: 2 })).toBe(false);
  });
});

describe('cover (Board.inCover)', () => {
  it('open ground gives no cover anywhere', () => {
    const board = makeHexGrid({ width: 9, height: 7, blocked: [] });
    const from = { x: 4, y: 3 };
    for (const to of board.cellsWithin(from, 4)) expect(board.inCover(from, to)).toBe(false);
  });

  it('a sight line that only grazes past a rock gives cover; the rock gone, it does not', () => {
    const from = { x: 0, y: 3 };
    const rock = { '3,3': { feature: 'rock' as const } };
    const board = makeHexGrid({ width: 9, height: 7, blocked: [], terrain: rock });
    const open = makeHexGrid({ width: 9, height: 7, blocked: [] });
    const grazed = board.cellsWithin(from, 6).filter((to) => board.lineOfSight(from, to) && board.inCover(from, to));
    expect(grazed.length).toBeGreaterThan(0);
    for (const to of grazed) expect(open.inCover(from, to)).toBe(false);
  });

  it('a unit in the way of one edge-rounding gives cover too', () => {
    const from = { x: 0, y: 3 };
    const board = makeHexGrid({ width: 9, height: 7, blocked: [] });
    const unitAt = (v: Vec) => v.x === 3 && v.y === 3;
    const grazed = board.cellsWithin(from, 6).filter((to) => board.lineOfSight(from, to, unitAt) && board.inCover(from, to, unitAt));
    expect(grazed.length).toBeGreaterThan(0);
  });
});
