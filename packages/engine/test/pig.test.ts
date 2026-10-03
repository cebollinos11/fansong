import { describe, expect, it } from 'vitest';
import {
  createGame,
  isPig,
  pigExtracted,
  pigOf,
  reduce,
  roundLimitWinner,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
} from '../src/index.js';

const A = (name: string, x: number, y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 2,
  combat: 3,
  pos: { x, y },
  ...extra,
});

/** The goal: the right-hand edge column of the 8×6 board. */
const GOAL = Array.from({ length: 6 }, (_, y) => ({ x: 7, y }));

const config = (w0: UnitSpec[], w1: UnitSpec[], extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: 11,
  board: { width: 8, height: 6 },
  warbands: [w0, w1],
  mode: 'golden-pig',
  objectives: { extraction: GOAL },
  ...extra,
});

/** Player 0 escorts a Pig (`p0u1`) standing at `(x, y)`; player 1 has one defender far off. */
const pigAt = (x: number, y: number, pig: Partial<UnitSpec> = {}, extra: Partial<GameConfig> = {}): GameState =>
  createGame(config([A('escort', 0, 0), A('pig', x, y, { pig: true, slow: true, ...pig })], [A('defender', 0, 5)], extra));

/** Put `unitId` mid-activation with `actions` left (no dice, so no luck involved). */
const acting = (s: GameState, unitId: string, actions: number): GameState => ({
  ...s,
  active: s.units.find((u) => u.id === unitId)!.owner,
  phase: 'acting',
  activeUnitId: unitId,
  actionsRemaining: actions,
  activationCount: 1,
});

const over = (events: GameEvent[]) => events.filter((e) => e.type === 'GameOver');

describe('extract the golden Pig', () => {
  it('records the Pig and its escort in the mode state', () => {
    const g = createGame(config([A('a', 0, 0)], [A('c', 7, 0), A('pig', 7, 2, { pig: true })]));
    expect(g.mode?.pig).toEqual({ unitId: 'p1u1', escort: 1 });
    expect(pigOf(g)).toEqual({ unitId: 'p1u1', escort: 1 });
    expect(isPig(g, 'p1u1')).toBe(true);
    expect(isPig(g, 'p1u0')).toBe(false);
    expect(g.mode?.objectives).toEqual({ extraction: GOAL });
    // Units themselves are untouched: the Pig lives only in the mode state.
    expect(g.units.every((u) => !('pig' in u))).toBe(true);
  });

  it('requires exactly one Pig, and a goal zone', () => {
    expect(() => createGame(config([A('a', 0, 0)], [A('c', 7, 0)]))).toThrow(/exactly one unit must be the Pig \(got 0\)/);
    expect(() => createGame(config([A('a', 0, 0, { pig: true })], [A('c', 7, 0, { pig: true })]))).toThrow(/got 2/);
    expect(() => createGame(config([A('a', 0, 0, { pig: true })], [A('c', 7, 0)], { objectives: undefined }))).toThrow(/needs a goal zone/);
    expect(() => createGame(config([A('a', 0, 0, { pig: true })], [A('c', 7, 0)], { objectives: { extraction: [] } }))).toThrow(/needs a goal zone/);
  });

  it('ignores the Pig flag outside its mode', () => {
    const w1 = [A('c', 7, 0)];
    const plain = createGame(config([A('a', 0, 0, { pig: true })], w1, { mode: undefined, objectives: undefined }));
    expect('mode' in plain).toBe(false);
    expect(JSON.stringify(plain)).toBe(JSON.stringify(createGame(config([A('a', 0, 0)], w1, { mode: undefined, objectives: undefined }))));
  });

  it('wins when the Pig spends its last action walking into the goal', () => {
    const r = reduce(acting(pigAt(5, 2), 'p0u1', 1), { type: 'Move', unitId: 'p0u1', to: { x: 7, y: 2 } });
    expect(r.state.phase).toBe('gameOver');
    expect(r.state.winner).toBe(0);
    expect(r.events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'extracted' });
    expect(over(r.events)).toHaveLength(1);
  });

  it('walking in with actions to spare wins only once the activation ends', () => {
    const moved = reduce(acting(pigAt(5, 2), 'p0u1', 2), { type: 'Move', unitId: 'p0u1', to: { x: 7, y: 2 } });
    expect(moved.state.phase).toBe('acting');
    expect(pigExtracted(moved.state, 'p0u1')).toBe(true);
    const ended = reduce(moved.state, { type: 'EndActivation' });
    expect(ended.state.winner).toBe(0);
    expect(ended.events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'extracted' });
  });

  it('a Pig already in the goal wins however its next activation ends, a turnover included', () => {
    let turnovers = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // Quality 6: three dice mostly fail.
      const g = pigAt(7, 2, { quality: 6 }, { seed });
      const events: GameEvent[] = [];
      let r = reduce(g, { type: 'ChooseActivation', unitId: 'p0u1', diceCount: 3 });
      events.push(...r.events);
      const rolled = r.events.find((e) => e.type === 'DiceRolled');
      if (rolled?.type === 'DiceRolled' && rolled.successes === 0 && r.events.some((e) => e.type === 'Turnover')) turnovers++;
      if (r.state.phase === 'acting') {
        r = reduce(r.state, { type: 'EndActivation' });
        events.push(...r.events);
      }
      expect(r.state.winner).toBe(0);
      expect(over(events)).toEqual([{ type: 'GameOver', winner: 0, reason: 'extracted' }]);
    }
    expect(turnovers).toBeGreaterThan(0);
  });

  it('does not win while another unit acts: a Pig pushed into the goal must still end an activation there', () => {
    const g = pigAt(7, 2);
    // The Pig stands on the goal (as if shoved there) while its escort, then the defender, act.
    for (const id of ['p0u0', 'p1u0']) {
      const r = reduce(acting(g, id, 1), { type: 'EndActivation' });
      expect(r.state.phase).not.toBe('gameOver');
      expect(over(r.events)).toHaveLength(0);
    }
  });

  it('a knocked-down Pig ending its activation in the goal does not win', () => {
    const g = pigAt(7, 2);
    const down = { ...g, units: g.units.map((u) => (u.id === 'p0u1' ? { ...u, knockedDown: true } : u)) };
    expect(pigExtracted(down, 'p0u1')).toBe(false);
    const r = reduce(acting(down, 'p0u1', 1), { type: 'EndActivation' });
    expect(r.state.phase).not.toBe('gameOver');
  });

  it('only the Pig extracts: an escort ending in the goal wins nothing', () => {
    const g = createGame(config([A('escort', 7, 0), A('pig', 2, 2, { pig: true })], [A('defender', 0, 5)]));
    expect(reduce(acting(g, 'p0u0', 1), { type: 'EndActivation' }).state.phase).not.toBe('gameOver');
  });

  it('the Pig cut down in combat loses for its escort, with the warband intact', () => {
    let s = createGame(
      config([A('escort', 0, 0), A('escort2', 0, 1), A('pig', 4, 2, { pig: true, combat: 0 })], [A('butcher', 5, 2, { combat: 12 })]),
    );
    const events: GameEvent[] = [];
    for (let i = 0; i < 600 && s.phase !== 'gameOver'; i++) {
      let cmd: Command;
      if (s.phase === 'awaitingActivation') {
        const pick = s.units.find((u) => u.owner === s.active && !u.activatedThisRound && !u.dead)!;
        cmd = { type: 'ChooseActivation', unitId: pick.id, diceCount: 1 };
      } else if (s.activeUnitId === 'p1u0') cmd = { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u2' };
      else cmd = { type: 'EndActivation' };
      const r = reduce(s, cmd);
      s = r.state;
      events.push(...r.events);
    }
    expect(s.winner).toBe(1);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'pig' });
    expect(over(events)).toHaveLength(1);
    expect(s.units.filter((u) => u.owner === 0 && !u.dead)).toHaveLength(2);
  });

  it('a routed Pig counts as fallen', () => {
    const g = pigAt(3, 2);
    const gone = { ...g, units: g.units.map((u) => (u.id === 'p0u1' ? { ...u, dead: true } : u)) };
    const r = reduce(acting(gone, 'p1u0', 1), { type: 'EndActivation' });
    expect(r.events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'pig' });
  });

  it('the defender wins when the round limit is reached, whatever is left standing', () => {
    let s = createGame(
      config([A('a', 0, 0), A('b', 0, 1), A('c', 0, 2), A('pig', 0, 3, { pig: true })], [A('defender', 0, 5)], { limits: { roundLimit: 2 } }),
    );
    expect(roundLimitWinner(s)).toBe(1);
    const events: GameEvent[] = [];
    for (let i = 0; i < 200 && s.phase !== 'gameOver'; i++) {
      const pick = s.units.find((u) => u.owner === s.active && !u.activatedThisRound && !u.dead);
      const r = reduce(s, s.phase === 'acting' ? { type: 'EndActivation' } : { type: 'ChooseActivation', unitId: pick!.id, diceCount: 1 });
      s = r.state;
      events.push(...r.events);
    }
    expect(s.round).toBe(2);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'roundLimit' });
  });

  it('wiping out the defenders still wins for the escort', () => {
    const g = pigAt(3, 2);
    const cleared = { ...g, units: g.units.map((u) => (u.owner === 1 ? { ...u, dead: true } : u)) };
    const r = reduce(acting(cleared, 'p0u0', 1), { type: 'EndActivation' });
    expect(r.events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'annihilation' });
  });
});
