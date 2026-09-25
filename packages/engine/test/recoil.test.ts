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

  it('falls instead when the hex behind is impassable, an enemy or a knocked-down friend', () => {
    const seed = seedFor('defenderRecoiled');
    const blocked = config(seed, { board: { width: 7, height: 5, blocked: ['4,3'] } });
    // Knocked down, the enemy behind doesn't outnumber the target, so the roll is unchanged.
    const enemy = config(seed);
    enemy.warbands[0].push({ name: 'Enemy', quality: 3, combat: 3, pos: { x: 4, y: 3 } });
    const downedFriend = config(seed);
    downedFriend.warbands[1].push({ name: 'Friend', quality: 3, combat: 3, pos: { x: 4, y: 3 } });

    for (const [c, downId] of [[blocked, null], [enemy, 'p0u1'], [downedFriend, 'p1u1']] as const) {
      const s = acting(c);
      if (downId) s.units.find((u) => u.id === downId)!.knockedDown = true;
      const { state, events } = attack(s);
      expect((events.find((e) => e.type === 'AttackResolved') as Attack).result).toBe('defenderKnockedDown');
      expect(state.units.find((u) => u.id === 'p1u0')!.pos).toEqual({ x: 3, y: 2 });
      expect(state.units.find((u) => u.id === 'p1u0')!.knockedDown).toBe(true);
    }
  });

  it('a standing friend behind supports the pushed unit: it holds its ground, on its feet', () => {
    const seed = seedFor('defenderRecoiled');
    const c = config(seed);
    c.warbands[1].push({ name: 'Friend', quality: 3, combat: 3, pos: { x: 4, y: 3 } });
    const s = acting(c);
    s.units.find((u) => u.id === 'p1u0')!.guarding = true;
    const { state, events } = attack(s);
    expect((events.find((e) => e.type === 'AttackResolved') as Attack).result).toBe('defenderRecoiled');
    expect(events).toContainEqual({ type: 'UnitSupported', unitId: 'p1u0', supporterId: 'p1u1' });
    expect(events.some((e) => e.type === 'UnitRecoiled')).toBe(false);
    const target = state.units.find((u) => u.id === 'p1u0')!;
    expect(target.pos).toEqual({ x: 3, y: 2 });
    expect(target.knockedDown).toBe(false);
    expect(target.guarding).toBe(true); // never moved, so its stance holds
  });

  it('pushed off the map, the unit is killed', () => {
    const seed = seedFor('defenderRecoiled');
    const { state, events } = attack(acting(config(seed, { board: { width: 4, height: 5 } })));
    expect((events.find((e) => e.type === 'AttackResolved') as Attack).result).toBe('defenderRecoiled');
    expect(events).toContainEqual({ type: 'UnitPushedOff', unitId: 'p1u0' });
    expect(events).toContainEqual({ type: 'UnitKilled', unitId: 'p1u0', byId: 'p0u0' });
    expect(state.units[1]!.dead).toBe(true);
  });

  it('a Tough unit pushed off the map is knocked down at the edge instead', () => {
    const seed = seedFor('defenderRecoiled');
    const c = config(seed, { board: { width: 4, height: 5 } });
    c.warbands[1][0] = { ...c.warbands[1][0]!, tough: true };
    const { state, events } = attack(acting(c));
    expect(events).toContainEqual({ type: 'ToughnessSaved', unitId: 'p1u0' });
    const target = state.units[1]!;
    expect(target.dead).toBe(false);
    expect(target.knockedDown).toBe(true);
    expect(target.pos).toEqual({ x: 3, y: 2 });
  });

  it('an attacker pushed off the map dies, ending its activation', () => {
    const seed = seedFor('attackerRecoiled');
    // On the left edge, the hex directly away from its target is off the board.
    const c = config(seed);
    c.warbands[0][0] = { ...c.warbands[0][0]!, pos: { x: 0, y: 2 } };
    c.warbands[1][0] = { ...c.warbands[1][0]!, pos: { x: 1, y: 2 } };
    const board = makeHexGrid({ width: 7, height: 5, blocked: [] });
    expect(board.inBounds(board.stepAway({ x: 1, y: 2 }, { x: 0, y: 2 }))).toBe(false);
    const { state, events } = attack(acting(c, 2));
    expect(events).toContainEqual({ type: 'UnitPushedOff', unitId: 'p0u0' });
    expect(state.units[0]!.dead).toBe(true);
    expect(state.activeUnitId).toBeNull();
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

describe('a guard riposte against a supported attacker', () => {
  const guarded = (seed: number): GameConfig => {
    const c = config(seed);
    c.warbands[1][0] = { ...c.warbands[1][0]!, guard: true };
    return c;
  };
  const riposte = (events: GameEvent[]) =>
    events.find((e) => e.type === 'GuardRiposte') as Extract<GameEvent, { type: 'GuardRiposte' }>;
  const withGuard = (c: GameConfig, actions = 1) => {
    const s = acting(c, actions);
    s.units.find((u) => u.id === 'p1u0')!.guarding = true;
    return s;
  };

  it('lets the attack through when a friend braces the pushed attacker', () => {
    let seed = 1;
    while (riposte(attack(withGuard(guarded(seed))).events).result !== 'defenderRecoiled') seed++;
    // Unsupported, the push drives the attacker back and stops the blow.
    const alone = attack(withGuard(guarded(seed))).events;
    expect(riposte(alone).prevented).toBe(true);
    expect(alone.some((e) => e.type === 'AttackResolved')).toBe(false);

    // With a friend in the hex behind (not touching the guard), the blow lands.
    const board = makeHexGrid({ width: 7, height: 5, blocked: [] });
    const behind = board.stepAway({ x: 3, y: 2 }, { x: 2, y: 2 });
    const c = guarded(seed);
    c.warbands[0].push({ name: 'Friend', quality: 3, combat: 3, pos: behind });
    const { state, events } = attack(withGuard(c));
    expect(riposte(events).prevented).toBe(false);
    expect(events).toContainEqual({ type: 'UnitSupported', unitId: 'p0u0', supporterId: 'p0u1' });
    expect(events.some((e) => e.type === 'AttackResolved')).toBe(true);
    expect(state.units[0]!.pos).toEqual({ x: 2, y: 2 });
  });
});
