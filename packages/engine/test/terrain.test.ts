import { describe, expect, it } from 'vitest';
import { makeHexGrid, type BoardData, type Vec } from '../src/board.js';
import { highGroundBonus } from '../src/combat.js';
import { createDemoGame, createGame, normalizeTerrain, type GameConfig } from '../src/setup.js';
import { getLegalCommands } from '../src/legal.js';
import { reduce } from '../src/reduce.js';

const base: GameConfig = {
  seed: 1,
  board: { width: 6, height: 5 },
  warbands: [
    [{ name: 'A', quality: 3, combat: 3, pos: { x: 0, y: 0 } }],
    [{ name: 'B', quality: 3, combat: 3, pos: { x: 5, y: 4 } }],
  ],
};

describe('board terrain', () => {
  it('reports elevation and feature per hex, defaulting to flat and empty', () => {
    const g = makeHexGrid({
      width: 6,
      height: 5,
      blocked: [],
      terrain: { '1,1': { elevation: 2 }, '2,2': { feature: 'forest', elevation: 1 }, '3,3': { feature: 'rock' } },
    });
    expect(g.elevation({ x: 1, y: 1 })).toBe(2);
    expect(g.elevation({ x: 2, y: 2 })).toBe(1);
    expect(g.elevation({ x: 0, y: 0 })).toBe(0);
    expect(g.feature({ x: 2, y: 2 })).toBe('forest');
    expect(g.feature({ x: 1, y: 1 })).toBeUndefined();
  });

  it('treats rock and building as impassable, forest as passable', () => {
    const g = makeHexGrid({
      width: 6,
      height: 5,
      blocked: ['0,4'],
      terrain: { '1,1': { feature: 'rock' }, '2,1': { feature: 'building' }, '3,1': { feature: 'forest' } },
    });
    expect(g.isBlocked({ x: 1, y: 1 })).toBe(true);
    expect(g.isBlocked({ x: 2, y: 1 })).toBe(true);
    expect(g.isBlocked({ x: 3, y: 1 })).toBe(false);
    expect(g.isBlocked({ x: 0, y: 4 })).toBe(true); // legacy blocked still works
    // Impassable hexes are not neighbours.
    const ns = g.neighbors({ x: 1, y: 2 }).map((v) => `${v.x},${v.y}`);
    expect(ns).not.toContain('1,1');
  });

  it('a default game carries no terrain key (state shape unchanged)', () => {
    expect('terrain' in createGame(base).board).toBe(false);
    expect('terrain' in createDemoGame(3).board).toBe(false);
    // All-default terrain entries collapse away too.
    const flat = createGame({ ...base, board: { ...base.board, terrain: { '1,1': { elevation: 0 } } } });
    expect('terrain' in flat.board).toBe(false);
  });

  it('copies terrain into state, normalised and detached from the config', () => {
    const terrain = { '3,2': { feature: 'forest' as const }, '1,0': { elevation: 3 }, '2,2': {} };
    const s = createGame({ ...base, board: { ...base.board, terrain } });
    expect(s.board.terrain).toEqual({ '1,0': { elevation: 3 }, '3,2': { feature: 'forest' } });
    expect(Object.keys(s.board.terrain!)).toEqual(['1,0', '3,2']);
    terrain['1,0'].elevation = 1;
    expect(s.board.terrain!['1,0']!.elevation).toBe(3);
  });

  it('normalizeTerrain returns undefined for empty input', () => {
    expect(normalizeTerrain(undefined)).toBeUndefined();
    expect(normalizeTerrain({})).toBeUndefined();
  });
});

describe('line of sight with terrain features', () => {
  const board = (terrain: BoardData['terrain'], blocked: string[] = []) =>
    makeHexGrid({ width: 9, height: 9, blocked, terrain });
  const a = { x: 0, y: 4 };
  const b = { x: 4, y: 4 };
  const mid = '2,4'; // straight down row 4 on the even columns' line

  it('rock and building block sight through them', () => {
    expect(board({}).lineOfSight(a, b)).toBe(true);
    expect(board({ [mid]: { feature: 'rock' } }).lineOfSight(a, b)).toBe(false);
    expect(board({ [mid]: { feature: 'building' } }).lineOfSight(a, b)).toBe(false);
  });

  it('forest blocks sight through it but not into or out of it', () => {
    const g = board({ [mid]: { feature: 'forest' } });
    expect(g.lineOfSight(a, b)).toBe(false);
    // A unit standing in the forest hex sees out, and is seen.
    expect(g.lineOfSight(a, { x: 2, y: 4 })).toBe(true);
    expect(g.lineOfSight({ x: 2, y: 4 }, b)).toBe(true);
    // Both ends in (separate) forest hexes, nothing between: still clear.
    const both = board({ '0,4': { feature: 'forest' }, '1,4': { feature: 'forest' } });
    expect(both.lineOfSight({ x: 0, y: 4 }, { x: 1, y: 4 })).toBe(true);
  });

  it('elevation alone never blocks sight', () => {
    expect(board({ [mid]: { elevation: 3 } }).lineOfSight(a, b)).toBe(true);
  });

  it('legacy blocked cells still block', () => {
    expect(board({}, [mid]).lineOfSight(a, b)).toBe(false);
  });

  it('is symmetric for every pair of hexes, including edge-grazing lines', () => {
    // A scatter of features on a 9x9 board; sight a->b must equal b->a everywhere.
    const g = board({
      '2,2': { feature: 'forest' },
      '3,5': { feature: 'rock' },
      '5,3': { feature: 'building' },
      '6,6': { feature: 'forest' },
      '4,1': { feature: 'forest' },
    });
    const cells: Vec[] = [];
    for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) cells.push({ x, y });
    for (const p of cells) {
      for (const q of cells) {
        expect(g.lineOfSight(p, q), `${p.x},${p.y} <-> ${q.x},${q.y}`).toBe(g.lineOfSight(q, p));
      }
    }
  });

  it('edge-grazing lines resolve deterministically', () => {
    // (0,2) -> (2,2) runs exactly along the edge between (1,1) and (1,2).
    // Exactly one of the two grazed hexes is on the drawn line, and repeat calls agree.
    const viaTop = board({ '1,1': { feature: 'rock' } });
    const viaBottom = board({ '1,2': { feature: 'rock' } });
    const p = { x: 0, y: 2 };
    const q = { x: 2, y: 2 };
    const results = [viaTop.lineOfSight(p, q), viaBottom.lineOfSight(p, q)];
    expect(results.filter((r) => !r)).toHaveLength(1);
    expect(viaTop.lineOfSight(p, q)).toBe(results[0]);
    expect(viaTop.lineOfSight(q, p)).toBe(results[0]);
    expect(viaBottom.lineOfSight(q, p)).toBe(results[1]);
  });
});

describe('movement pathing around impassable terrain', () => {
  // A rock wall down column 2 with a single gap at the bottom row.
  const wall: GameConfig = {
    seed: 3,
    board: {
      width: 6,
      height: 5,
      blocked: ['2,3'],
      terrain: { '2,0': { feature: 'rock' }, '2,1': { feature: 'building' }, '2,2': { feature: 'rock' } },
    },
    warbands: [
      [{ name: 'Runner', quality: 1, combat: 3, move: 3, pos: { x: 1, y: 1 } }],
      [{ name: 'Far', quality: 1, combat: 3, pos: { x: 5, y: 4 } }],
    ],
  };

  it('reachableWithin walks around blocked hexes and ignores the start', () => {
    const g = makeHexGrid({ width: 6, height: 5, blocked: ['2,3'], terrain: wall.board.terrain });
    const from = { x: 1, y: 1 };
    const reach3 = g.reachableWithin(from, 3);
    expect(reach3.has('1,1')).toBe(false);
    expect(reach3.has('2,4')).toBe(true); // through the gap
    expect(reach3.has('2,2')).toBe(false); // rock
    // (3,1) is 2 hexes away as the crow flies but needs the detour via the gap.
    expect(g.distance(from, { x: 3, y: 1 })).toBe(2);
    expect(reach3.has('3,1')).toBe(false);
    expect(g.reachableWithin(from, 6).has('3,1')).toBe(true);
    expect(g.reachableWithin(from, 0).size).toBe(0);
  });

  it('forest is passable for pathing', () => {
    const g = makeHexGrid({ width: 3, height: 1, blocked: [], terrain: { '1,0': { feature: 'forest' } } });
    expect(g.reachableWithin({ x: 0, y: 0 }, 2)).toEqual(new Set(['1,0', '2,0']));
  });

  it('on an open board, reach equals every in-range cell', () => {
    const g = makeHexGrid({ width: 7, height: 7, blocked: [] });
    const from = { x: 3, y: 3 };
    const reach = g.reachableWithin(from, 2);
    expect([...reach].sort()).toEqual(g.cellsWithin(from, 2).map((v) => `${v.x},${v.y}`).sort());
  });

  it('legal moves and reduce both use path reachability', () => {
    const acting = reduce(createGame(wall), { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 }).state;
    const moves = getLegalCommands(acting).filter((c) => c.type === 'Move');
    const dests = moves.map((c) => (c.type === 'Move' ? `${c.to.x},${c.to.y}` : ''));
    expect(dests).toContain('2,4');
    expect(dests).not.toContain('3,1');
    expect(() => reduce(acting, { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 1 } })).toThrow(/unreachable/);
    const moved = reduce(acting, { type: 'Move', unitId: 'p0u0', to: { x: 2, y: 4 } }).state;
    expect(moved.units.find((u) => u.id === 'p0u0')!.pos).toEqual({ x: 2, y: 4 });
  });

  it('other units do not block the path, only the destination', () => {
    // One-hex-wide corridor: the runner may pass its ally to reach the far side.
    const corridor: GameConfig = {
      seed: 3,
      board: { width: 4, height: 1 },
      warbands: [
        [
          { name: 'Runner', quality: 1, combat: 3, move: 3, pos: { x: 0, y: 0 } },
          { name: 'Ally', quality: 1, combat: 3, pos: { x: 1, y: 0 } },
        ],
        [{ name: 'Far', quality: 1, combat: 3, pos: { x: 3, y: 0 } }],
      ],
    };
    const acting = reduce(createGame(corridor), { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 }).state;
    const dests = getLegalCommands(acting).flatMap((c) => (c.type === 'Move' ? [`${c.to.x},${c.to.y}`] : []));
    expect(dests).toEqual(['2,0']);
  });
});

describe('high ground', () => {
  /** Mid-activation state for `unitId`, so only the combat roll consumes RNG. */
  function acting(config: GameConfig, unitId: string) {
    const s = createGame(config);
    const u = s.units.find((x) => x.id === unitId)!;
    s.active = u.owner;
    s.activeUnitId = unitId;
    s.phase = 'acting';
    s.actionsRemaining = 1;
    u.activatedThisRound = true;
    return s;
  }

  const duel = (terrain: Record<string, { elevation: number }>): GameConfig => ({
    seed: 7,
    board: { width: 6, height: 3, terrain },
    warbands: [
      [{ name: 'A', quality: 3, combat: 3, ranged: 4, pos: { x: 1, y: 1 } }],
      [{ name: 'B', quality: 3, combat: 3, guard: true, pos: { x: 2, y: 1 } }],
    ],
  });

  it('highGroundBonus: +1 only when standing on a strictly higher hex', () => {
    const g = makeHexGrid({ width: 3, height: 1, blocked: [], terrain: { '0,0': { elevation: 2 }, '1,0': { elevation: 1 } } });
    const up = { pos: { x: 0, y: 0 }, knockedDown: false };
    const mid = { pos: { x: 1, y: 0 }, knockedDown: false };
    const low = { pos: { x: 2, y: 0 }, knockedDown: false };
    expect(highGroundBonus(g, up, mid)).toBe(1);
    expect(highGroundBonus(g, mid, low)).toBe(1);
    expect(highGroundBonus(g, mid, up)).toBe(0);
    expect(highGroundBonus(g, low, { pos: { x: 2, y: 0 } })).toBe(0); // equal height
    expect(highGroundBonus(g, { ...up, knockedDown: true }, low)).toBe(0); // knocked down: no bonus
  });

  it('adds +1 to the higher melee attacker, recorded on the event', () => {
    const flat = reduce(acting(duel({}), 'p0u0'), { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    const high = reduce(acting(duel({ '1,1': { elevation: 1 } }), 'p0u0'), {
      type: 'Attack',
      attackerId: 'p0u0',
      targetId: 'p1u0',
    });
    const f = flat.events.find((e) => e.type === 'AttackResolved')!;
    const h = high.events.find((e) => e.type === 'AttackResolved')!;
    if (f.type !== 'AttackResolved' || h.type !== 'AttackResolved') throw new Error('unreachable');
    expect(h.attackDie).toBe(f.attackDie); // same seed, same dice
    expect(h.attackScore).toBe(f.attackScore + 1);
    expect(h.defenseScore).toBe(f.defenseScore);
    expect(h.attackBonus).toBe(1);
    expect('defenseBonus' in h).toBe(false);
    // No bonus keys at all on flat ground.
    expect('attackBonus' in f || 'defenseBonus' in f).toBe(false);
  });

  it('the higher defender gets the bonus too', () => {
    const r = reduce(acting(duel({ '2,1': { elevation: 3 } }), 'p0u0'), {
      type: 'Attack',
      attackerId: 'p0u0',
      targetId: 'p1u0',
    });
    const e = r.events.find((x) => x.type === 'AttackResolved')!;
    if (e.type !== 'AttackResolved') throw new Error('unreachable');
    expect(e.defenseBonus).toBe(1);
    expect(e.defenseScore).toBe(3 + e.defenseDie + 1);
    expect(e.attackScore).toBe(3 + e.attackDie);
  });

  it('a knocked-down combatant on high ground gets no bonus', () => {
    const s = acting(duel({ '2,1': { elevation: 2 } }), 'p0u0');
    s.units.find((u) => u.id === 'p1u0')!.knockedDown = true;
    const r = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    const e = r.events.find((x) => x.type === 'AttackResolved')!;
    if (e.type !== 'AttackResolved') throw new Error('unreachable');
    expect('defenseBonus' in e).toBe(false);
    expect(e.defenseScore).toBe(3 + e.defenseDie);
  });

  it('applies to guard ripostes', () => {
    const s = acting(duel({ '2,1': { elevation: 1 } }), 'p0u0');
    s.units.find((u) => u.id === 'p1u0')!.guarding = true;
    const r = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    const e = r.events.find((x) => x.type === 'GuardRiposte')!;
    if (e.type !== 'GuardRiposte') throw new Error('unreachable');
    expect(e.guardBonus).toBe(1);
    expect(e.guardScore).toBe(3 + e.guardDie + 1);
    expect('attackerBonus' in e).toBe(false);
  });

  it('applies to shots, for shooter and target', () => {
    const shoot = (terrain: Record<string, { elevation: number }>) => {
      const cfg = duel(terrain);
      cfg.warbands[1][0]!.pos = { x: 4, y: 1 };
      const r = reduce(acting(cfg, 'p0u0'), { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
      const e = r.events.find((x) => x.type === 'ShotResolved')!;
      if (e.type !== 'ShotResolved') throw new Error('unreachable');
      return e;
    };
    const up = shoot({ '1,1': { elevation: 2 } });
    expect(up.attackBonus).toBe(1);
    expect(up.attackScore).toBe(3 + up.attackDie + 1);
    const down = shoot({ '4,1': { elevation: 1 } });
    expect(down.defenseBonus).toBe(1);
    expect(down.defenseScore).toBe(3 + down.defenseDie + 1);
    expect('attackBonus' in down).toBe(false);
  });
});
