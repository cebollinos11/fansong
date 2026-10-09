import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createGame,
  fallenKingOwner,
  getLegalCommands,
  hashGameState,
  makeHexGrid,
  reduce,
  retreatHex,
  runReplay,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Replay,
  type UnitSpec,
  type Vec,
} from '../src/index.js';

const U = (name: string, x: number, y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 2,
  combat: 3,
  pos: { x, y },
  ...extra,
});

/** Player 0's deploy edge: the two left columns of the 10×6 board. */
const ZONE: Vec[] = [0, 1].flatMap((x) => [0, 1, 2, 3, 4, 5].map((y) => ({ x, y })));

const config = (w0: UnitSpec[], w1: UnitSpec[], extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: 5,
  board: { width: 10, height: 6 },
  warbands: [w0, w1],
  retreatZones: [ZONE, []],
  ...extra,
});

const standard = (extra: Partial<GameConfig> = {}): GameConfig =>
  config(
    [U('Chief', 3, 2, { leader: true }), U('Spear', 3, 3), U('Bow', 3, 4)],
    [U('Foe', 9, 2), U('Foe', 9, 3), U('Foe', 9, 4)],
    extra,
  );

/**
 * Put `unitId` into an activation with `actions` to spend, skipping the dice:
 * these tests are about what the actions do, not whether they were rolled.
 */
function acting(state: GameState, unitId: string, actions = 3): GameState {
  const s = structuredClone(state);
  const unit = s.units.find((u) => u.id === unitId)!;
  unit.activatedThisRound = true;
  s.active = unit.owner;
  s.phase = 'acting';
  s.activeUnitId = unitId;
  s.actionsRemaining = actions;
  return s;
}

function run(state: GameState, commands: Command[]): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let s = state;
  for (const c of commands) {
    const r = reduce(s, c);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const canRetreatNow = (s: GameState): boolean => getLegalCommands(s).some((c) => c.type === 'Retreat');

describe('retreat', () => {
  it('is never offered in a game without retreat zones, and such a state carries nothing', () => {
    const plain = createGame({ ...standard(), retreatZones: undefined });
    expect('retreatZones' in plain).toBe(false);
    expect(canRetreatNow(acting(plain, 'p0u0'))).toBe(false);
    expect(() => reduce(acting(plain, 'p0u0'), { type: 'Retreat', unitId: 'p0u0' })).toThrow();
    // Two empty zones are no zones at all.
    expect('retreatZones' in createGame(standard({ retreatZones: [[], []] }))).toBe(false);
  });

  it('is offered to the Leader alone, on its feet, and only on its own side', () => {
    const g = createGame(standard());
    expect(getLegalCommands(acting(g, 'p0u0'))).toContainEqual({ type: 'Retreat', unitId: 'p0u0' });
    expect(canRetreatNow(acting(g, 'p0u1'))).toBe(false);
    // The enemy has no zone, Leader or not.
    const foes = createGame(config([U('Chief', 3, 2, { leader: true })], [U('Boss', 9, 2, { leader: true })]));
    expect(canRetreatNow(acting(foes, 'p1u0'))).toBe(false);
    // Down, it cannot call.
    const down = acting(g, 'p0u0');
    down.units[0]!.knockedDown = true;
    expect(canRetreatNow(down)).toBe(false);
    // Nor with no Leader at all.
    const leaderless = createGame(config([U('Spear', 3, 3)], [U('Foe', 9, 2)]));
    expect(canRetreatNow(acting(leaderless, 'p0u0'))).toBe(false);
  });

  it('costs one action, plants the flag once, and restricts nothing', () => {
    const g = createGame(standard());
    const { state, events } = run(acting(g, 'p0u0', 2), [{ type: 'Retreat', unitId: 'p0u0' }]);
    expect(state.actionsRemaining).toBe(1);
    expect(state.retreat?.owner).toBe(0);
    expect(events).toEqual([{ type: 'RetreatCalled', unitId: 'p0u0', hex: state.retreat!.hex }]);
    expect(canRetreatNow(state)).toBe(false);
    expect(() => reduce(state, { type: 'Retreat', unitId: 'p0u0' })).toThrow();
    // The Leader may still move and fight on.
    expect(getLegalCommands(state).some((c) => c.type === 'Move')).toBe(true);
    // Its last action spent on the call ends the activation.
    const spent = run(acting(g, 'p0u0', 1), [{ type: 'Retreat', unitId: 'p0u0' }]);
    expect(spent.events.map((e) => e.type)).toEqual(['RetreatCalled', 'ActivationEnded']);
    expect(spent.state.phase).toBe('awaitingActivation');
  });

  it('picks the free zone hex farthest from the enemy, then nearest the Leader, with no dice', () => {
    const g = createGame(standard());
    const board = makeHexGrid(g.board);
    const leader = g.units[0]!;
    const hex = retreatHex(g, leader, board)!;
    const safety = (v: Vec): number => Math.min(...g.units.filter((u) => u.owner === 1).map((e) => board.distance(v, e.pos)));
    const best = Math.max(...ZONE.map(safety));
    expect(safety(hex)).toBe(best);
    const rivals = ZONE.filter((v) => safety(v) === best);
    expect(board.distance(hex, leader.pos)).toBe(Math.min(...rivals.map((v) => board.distance(v, leader.pos))));
    // No RNG drawn, and the same answer every time.
    const called = reduce(acting(g, 'p0u0'), { type: 'Retreat', unitId: 'p0u0' }).state;
    expect(called.rngState).toBe(g.rngState);
    expect(called.retreat?.hex).toEqual(hex);
    expect(retreatHex(g, leader, board)).toEqual(hex);
  });

  it('never plants the flag on an occupied or impassable hex, and offers no retreat with none free', () => {
    const one = createGame(standard({ retreatZones: [[{ x: 0, y: 0 }, { x: 3, y: 3 }], []] }));
    expect(retreatHex(one, one.units[0]!, makeHexGrid(one.board))).toEqual({ x: 0, y: 0 });
    const blocked = createGame(
      standard({ retreatZones: [[{ x: 0, y: 0 }, { x: 3, y: 3 }], []], board: { width: 10, height: 6, blocked: ['0,0'] } }),
    );
    expect(retreatHex(blocked, blocked.units[0]!, makeHexGrid(blocked.board))).toBeUndefined();
    expect(canRetreatNow(acting(blocked, 'p0u0'))).toBe(false);
  });

  it('lets a unit that ends a Move on the flag leave unhurt, with no nerve checks and no kill', () => {
    // Three of four gone would break an ordinary warband; walking off breaks no one.
    const g = createGame(
      config(
        [U('Chief', 3, 2, { leader: true }), U('Spear', 2, 1), U('Bow', 2, 2), U('Axe', 2, 3)],
        [U('Foe', 9, 2), U('Foe', 9, 3)],
        { retreatZones: [[{ x: 0, y: 2 }], []] },
      ),
    );
    let s = run(acting(g, 'p0u0', 1), [{ type: 'Retreat', unitId: 'p0u0' }]).state;
    const all: GameEvent[] = [];
    for (const id of ['p0u1', 'p0u2', 'p0u3']) {
      const r = run(acting(s, id, 2), [{ type: 'Move', unitId: id, to: { x: 0, y: 2 } }]);
      s = r.state;
      all.push(...r.events);
      const gone = s.units.find((u) => u.id === id)!;
      expect(gone.dead).toBe(true);
      expect(gone.retreated).toBe(true);
      // Leaving ends its activation, actions in hand or not.
      expect(s.activeUnitId).toBeNull();
    }
    expect(all.filter((e) => e.type === 'UnitRetreated')).toHaveLength(3);
    expect(all.some((e) => e.type === 'NerveCheck' || e.type === 'WarbandBroken' || e.type === 'UnitKilled')).toBe(false);
    expect(s.broken).toEqual([false, false]);
    expect(s.phase).not.toBe('gameOver');
  });

  it('does not count a unit that walked off as a loss toward the rout', () => {
    const g = createGame(
      config(
        [U('Chief', 3, 2, { leader: true }), U('Spear', 2, 1), U('Bow', 2, 2), U('Axe', 2, 3), U('Pike', 2, 4), U('Club', 2, 5)],
        [U('Foe', 9, 2, { combat: 9 })],
        { retreatZones: [[{ x: 0, y: 2 }], []] },
      ),
    );
    let s = run(acting(g, 'p0u0', 1), [{ type: 'Retreat', unitId: 'p0u0' }]).state;
    for (const id of ['p0u1', 'p0u2', 'p0u3']) s = run(acting(s, id, 1), [{ type: 'Move', unitId: id, to: { x: 0, y: 2 } }]).state;
    // Three left of six, three of them off by the flag: one more death leaves
    // two on the field, a third of the start, but five of six still breathe.
    s.units.find((u) => u.id === 'p1u0')!.pos = { x: 3, y: 5 };
    s.units.find((u) => u.id === 'p0u5')!.pos = { x: 2, y: 5 };
    for (let i = 0; i < 200 && !s.units.find((u) => u.id === 'p0u5')!.dead; i++) {
      s = reduce(acting(s, 'p1u0', 1), { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u5' }).state;
    }
    expect(s.units.find((u) => u.id === 'p0u5')!.dead).toBe(true);
    expect(s.broken[0]).toBe(false);
  });

  it('ends the game, lost by retreat, the moment the Leader leaves', () => {
    const g = createGame(standard({ retreatZones: [[{ x: 0, y: 2 }], []] }));
    const { state, events } = run(acting(g, 'p0u0', 3), [
      { type: 'Retreat', unitId: 'p0u0' },
      { type: 'Move', unitId: 'p0u0', to: { x: 0, y: 2 } },
    ]);
    expect(state.phase).toBe('gameOver');
    expect(state.winner).toBe(1);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'retreat' });
    expect(events.some((e) => e.type === 'LeaderFallen' || e.type === 'NerveCheck')).toBe(false);
    // The others are simply still there: left behind, for the client to judge.
    expect(state.units.filter((u) => u.owner === 0 && !u.dead).map((u) => u.id)).toEqual(['p0u1', 'p0u2']);
    expect(getLegalCommands(state)).toEqual([]);
  });

  it('leaves the flag up when the Leader dies, and ends by retreat once nobody is left', () => {
    const g = createGame(standard({ retreatZones: [[{ x: 0, y: 2 }], []] }));
    let s = run(acting(g, 'p0u0', 1), [{ type: 'Retreat', unitId: 'p0u0' }]).state;
    const leader = s.units.find((u) => u.id === 'p0u0')!;
    leader.dead = true;
    s = run(acting(s, 'p0u1', 1), [{ type: 'Move', unitId: 'p0u1', to: { x: 0, y: 2 } }]).state;
    expect(s.phase).not.toBe('gameOver');
    const end = run(acting(s, 'p0u2', 1), [{ type: 'Move', unitId: 'p0u2', to: { x: 0, y: 2 } }]);
    expect(end.state.winner).toBe(1);
    expect(end.events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'retreat' });
  });

  it('does not take a unit pushed onto the flag, only one that moves there', () => {
    // The flag is on the hex directly behind the Spear, away from its attacker.
    const behind = makeHexGrid({ width: 10, height: 6, blocked: [] }).stepAway({ x: 3, y: 2 }, { x: 2, y: 2 });
    const g = createGame(
      config([U('Chief', 5, 0, { leader: true }), U('Spear', 2, 2, { combat: 1 })], [U('Foe', 3, 2, { combat: 6 })], {
        retreatZones: [[behind], []],
      }),
    );
    const called = run(acting(g, 'p0u0', 1), [{ type: 'Retreat', unitId: 'p0u0' }]).state;
    expect(called.retreat?.hex).toEqual(behind);
    let pushed = false;
    for (let seed = 1; seed < 400 && !pushed; seed++) {
      const s = acting({ ...called, rngState: seed }, 'p1u0', 1);
      const r = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u1' });
      if (!r.events.some((e) => e.type === 'UnitRecoiled')) continue;
      pushed = true;
      const spear = r.state.units.find((u) => u.id === 'p0u1')!;
      expect(spear.pos).toEqual(behind);
      expect(spear.dead).toBe(false);
      expect(r.events.some((e) => e.type === 'UnitRetreated')).toBe(false);
    }
    expect(pushed).toBe(true);
  });

  it('an enemy standing on the flag blocks it, and never leaves by it', () => {
    const g = createGame(standard({ retreatZones: [[{ x: 0, y: 2 }], []] }));
    let s = run(acting(g, 'p0u0', 1), [{ type: 'Retreat', unitId: 'p0u0' }]).state;
    s.units.find((u) => u.id === 'p1u0')!.pos = { x: 1, y: 2 };
    const r = run(acting(s, 'p1u0', 1), [{ type: 'Move', unitId: 'p1u0', to: { x: 0, y: 2 } }]);
    s = r.state;
    expect(r.events.some((e) => e.type === 'UnitRetreated')).toBe(false);
    expect(s.units.find((u) => u.id === 'p1u0')!.dead).toBe(false);
    expect(getLegalCommands(acting(s, 'p0u1', 3))).not.toContainEqual({ type: 'Move', unitId: 'p0u1', to: { x: 0, y: 2 } });
  });

  it('a King that walks off by the flag is not slain: the game ends by retreat', () => {
    const g = createGame(
      config(
        [U('Chief', 3, 2, { leader: true, king: true }), U('Spear', 3, 3)],
        [U('Boss', 9, 2, { king: true }), U('Foe', 9, 3)],
        { mode: 'kill-the-king', retreatZones: [[{ x: 0, y: 2 }], []] },
      ),
    );
    const { state, events } = run(acting(g, 'p0u0', 3), [
      { type: 'Retreat', unitId: 'p0u0' },
      { type: 'Move', unitId: 'p0u0', to: { x: 0, y: 2 } },
    ]);
    expect(fallenKingOwner(state)).toBeUndefined();
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'retreat' });
  });

  it('leaves the golden replay untouched', () => {
    const goldenPath = fileURLToPath(new URL('./fixtures/golden-replay.json', import.meta.url));
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as { replay: Replay; finalHash: string };
    expect(golden.replay.config.retreatZones).toBeUndefined();
    expect(hashGameState(runReplay(golden.replay).final)).toBe(golden.finalHash);
  });
});
