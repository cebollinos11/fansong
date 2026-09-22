import { describe, expect, it } from 'vitest';
import { makeHexGrid } from '../src/board.js';
import { createGame, reduce, type CombatResult, type GameConfig, type GameEvent, type GameState } from '../src/index.js';

type Attack = Extract<GameEvent, { type: 'AttackResolved' }>;

const config = (seed: number, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed,
  board: { width: 7, height: 5 },
  warbands: [
    [{ name: 'Striker', quality: 3, combat: 4, pos: { x: 2, y: 2 } }],
    [{ name: 'Target', quality: 3, combat: 3, pos: { x: 3, y: 2 } }],
  ],
  ...extra,
});

/** Mid-activation for `p0u0`, with the RNG untouched so only the attack roll consumes it. */
function acting(c: GameConfig, actions = 1): GameState {
  const s = createGame(c);
  s.active = 0;
  s.activeUnitId = 'p0u0';
  s.phase = 'acting';
  s.actionsRemaining = actions;
  s.units[0]!.activatedThisRound = true;
  return s;
}

const attack = (s: GameState) => reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });

function seedFor(result: CombatResult): number {
  for (let seed = 1; seed <= 500; seed++) {
    const atk = attack(acting(config(seed))).events.find((e) => e.type === 'AttackResolved') as Attack;
    if (atk.result === result) return seed;
  }
  throw new Error(`no seed gives ${result}`);
}

describe('stepAway', () => {
  const board = makeHexGrid({ width: 9, height: 9, blocked: [] });

  it('continues the line from a neighbour through the centre, in every direction', () => {
    const centre = { x: 4, y: 4 };
    for (const n of board.neighbors(centre)) {
      const away = board.stepAway(n, centre);
      expect(board.distance(centre, away)).toBe(1);
      expect(board.distance(n, away)).toBe(2);
    }
  });

  it('steps directly away from a distant shooter', () => {
    const away = board.stepAway({ x: 0, y: 4 }, { x: 4, y: 4 });
    expect(board.distance({ x: 4, y: 4 }, away)).toBe(1);
    expect(board.distance({ x: 0, y: 4 }, away)).toBe(5);
  });
});

describe('recoil (push back)', () => {
  it("a plain win on the winner's odd die pushes the loser one hex directly away", () => {
    const seed = seedFor('defenderRecoiled');
    const { state, events } = attack(acting(config(seed)));
    const atk = events.find((e) => e.type === 'AttackResolved') as Attack;
    expect(atk.attackDie % 2).toBe(1);
    const target = state.units[1]!;
    expect(target.pos).toEqual({ x: 4, y: 3 });
    expect(target.knockedDown).toBe(false);
    expect(events).toContainEqual({ type: 'UnitRecoiled', unitId: 'p1u0', from: { x: 3, y: 2 }, to: { x: 4, y: 3 } });
  });

  it('falls instead when the hex behind is impassable, occupied or off the board', () => {
    const seed = seedFor('defenderRecoiled');
    const blocked = config(seed, { board: { width: 7, height: 5, blocked: ['4,3'] } });
    const friend = config(seed);
    friend.warbands[1].push({ name: 'Friend', quality: 3, combat: 3, pos: { x: 4, y: 3 } });
    const edge = config(seed, { board: { width: 4, height: 5 } });

    for (const c of [blocked, friend, edge]) {
      const { state, events } = attack(acting(c));
      expect((events.find((e) => e.type === 'AttackResolved') as Attack).result).toBe('defenderKnockedDown');
      expect(state.units[1]!.pos).toEqual({ x: 3, y: 2 });
      expect(state.units[1]!.knockedDown).toBe(true);
    }
  });

  it('a pushed-back attacker stays standing and keeps its remaining actions', () => {
    const seed = seedFor('attackerRecoiled');
    const { state } = attack(acting(config(seed), 2));
    expect(state.units[0]!.pos).toEqual({ x: 1, y: 1 });
    expect(state.units[0]!.knockedDown).toBe(false);
    expect(state.activeUnitId).toBe('p0u0');
    expect(state.actionsRemaining).toBe(1);
  });

  it('a pushed flag carrier takes the flag with it', () => {
    const seed = seedFor('defenderRecoiled');
    const s = acting(config(seed, { mode: 'capture-the-flag', objectives: { flags: [{ x: 0, y: 0 }, { x: 6, y: 4 }] } }));
    s.mode!.flags![0] = { at: { x: 3, y: 2 }, carrier: 'p1u0' };
    const { state } = attack(s);
    expect(state.mode!.flags![0]).toEqual({ at: { x: 4, y: 3 }, carrier: 'p1u0' });
  });
});
