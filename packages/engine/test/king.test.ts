import { describe, expect, it } from 'vitest';
import {
  createGame,
  fallenKingOwner,
  isKing,
  kingOf,
  reduce,
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

const config = (w0: UnitSpec[], w1: UnitSpec[], extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: 11,
  board: { width: 8, height: 6 },
  warbands: [w0, w1],
  mode: 'kill-the-king',
  ...extra,
});

/** Player 0's `attacker` swings at `target` until it falls; everyone else only passes. */
function playOut(s: GameState, attacker: string, target: string): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < 600 && s.phase !== 'gameOver'; i++) {
    let cmd: Command;
    if (s.phase === 'awaitingActivation') {
      const unit = s.active === 0 ? s.units.find((u) => u.id === attacker && !u.activatedThisRound && !u.dead) : undefined;
      const pick = unit ?? s.units.find((u) => u.owner === s.active && !u.activatedThisRound && !u.dead)!;
      cmd = { type: 'ChooseActivation', unitId: pick.id, diceCount: 1 };
    } else if (s.activeUnitId === attacker && !s.units.find((u) => u.id === target)!.dead) {
      cmd = { type: 'Attack', attackerId: attacker, targetId: target };
    } else {
      cmd = { type: 'EndActivation' };
    }
    const r = reduce(s, cmd);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

describe('kill-the-king', () => {
  it('records each side’s King in the mode state', () => {
    const g = createGame(config([A('a', 0, 0), A('b', 0, 2, { king: true })], [A('c', 7, 0, { king: true }), A('d', 7, 2)]));
    expect(g.mode?.kings).toEqual(['p0u1', 'p1u0']);
    expect(kingOf(g, 0)).toBe('p0u1');
    expect(kingOf(g, 1)).toBe('p1u0');
    expect(isKing(g, 'p0u1')).toBe(true);
    expect(isKing(g, 'p0u0')).toBe(false);
    expect(fallenKingOwner(g)).toBeUndefined();
    // Units themselves are untouched: the King lives only in the mode state.
    expect(g.units.every((u) => !('king' in u))).toBe(true);
  });

  it('requires exactly one King per side', () => {
    expect(() => createGame(config([A('a', 0, 0)], [A('c', 7, 0, { king: true })]))).toThrow(/player 0.*exactly one King/);
    expect(() =>
      createGame(config([A('a', 0, 0, { king: true })], [A('c', 7, 0, { king: true }), A('d', 7, 2, { king: true })])),
    ).toThrow(/player 1.*got 2/);
  });

  it('ignores King flags outside kill-the-king', () => {
    const w0 = [A('a', 0, 0, { king: true })];
    const w1 = [A('c', 7, 0)];
    const plain = createGame(config(w0, w1, { mode: undefined }));
    expect('mode' in plain).toBe(false);
    expect(JSON.stringify(plain)).toBe(JSON.stringify(createGame(config([A('a', 0, 0)], w1, { mode: undefined }))));
    const hill = createGame(config(w0, w1, { mode: 'king-of-the-hill', objectives: { hill: [{ x: 3, y: 3 }] } }));
    expect(hill.mode?.kings).toBeUndefined();
    expect(isKing(hill, 'p0u0')).toBe(false);
  });

  it('slaying the enemy King wins at once, even with its warband intact', () => {
    const g = createGame(
      config(
        [A('hero', 3, 2, { combat: 12, king: true })],
        [A('king', 4, 2, { combat: 0, king: true }), A('guard1', 7, 0), A('guard2', 7, 4), A('guard3', 7, 5)],
      ),
    );
    const { state, events } = playOut(g, 'p0u0', 'p1u0');
    expect(state.phase).toBe('gameOver');
    expect(state.winner).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 0, reason: 'king' });
    expect(events.filter((e) => e.type === 'GameOver')).toHaveLength(1);
    expect(state.units.filter((u) => u.owner === 1 && !u.dead)).toHaveLength(3);
    expect(fallenKingOwner(state)).toBe(1);
  });

  it('losing a non-King unit does not end the game', () => {
    const g = createGame(
      config(
        [A('hero', 3, 2, { combat: 12, king: true })],
        [A('pawn', 4, 2, { combat: 0 }), A('king', 7, 0, { king: true }), A('b', 7, 4), A('c', 7, 5)],
      ),
    );
    const { state, events } = playOut(g, 'p0u0', 'p1u0');
    const killed = events.findIndex((e) => e.type === 'UnitKilled' && e.unitId === 'p1u0');
    expect(killed).toBeGreaterThanOrEqual(0);
    // The pawn's death alone ends nothing (no GameOver in the same step).
    expect(events.slice(0, killed + 1).some((e) => e.type === 'GameOver')).toBe(false);
    expect(state.units.find((u) => u.id === 'p1u1')!.dead).toBe(false);
  });

  it('a King dying as the attacker loses for its own side', () => {
    const g = createGame(
      config(
        [A('rash king', 3, 2, { combat: 0, king: true }), A('p', 0, 0), A('q', 0, 5)],
        [A('wall', 4, 2, { combat: 12, king: true })],
      ),
    );
    const { state, events } = playOut(g, 'p0u0', 'p1u0');
    expect(state.winner).toBe(1);
    expect(events.at(-1)).toEqual({ type: 'GameOver', winner: 1, reason: 'king' });
  });

  it('a routed King counts as fallen', () => {
    const g = createGame(config([A('a', 0, 0, { king: true })], [A('c', 7, 0, { king: true })]));
    const s = structuredClone(g);
    s.units[1]!.dead = true;
    expect(fallenKingOwner(s)).toBe(1);
  });
});
