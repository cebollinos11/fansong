import { describe, expect, it } from 'vitest';
import { combatOdds, createGame, reduce, type GameConfig, type GameEvent, type GameState } from '../src/index.js';

/** The odds the hover tooltip quotes before an attack or shot is clicked. */

function acting(c: GameConfig): GameState {
  const s = createGame(c);
  s.active = 0;
  s.activeUnitId = 'p0u0';
  s.phase = 'acting';
  s.actionsRemaining = 2;
  s.units[0]!.activatedThisRound = true;
  return s;
}

const melee = (foe: Record<string, unknown> = {}, blade: Record<string, unknown> = {}): GameConfig => ({
  seed: 1,
  board: { width: 5, height: 3 },
  warbands: [
    [{ name: 'Blade', quality: 3, combat: 3, pos: { x: 1, y: 1 }, ...blade }],
    [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 2, y: 1 }, ...foe }],
  ],
});

/** Share of seeds where the real attack hurt the target / the attacker. */
function sampled(c: GameConfig, prep: (s: GameState) => void, runs = 1500): { win: number; lose: number } {
  let win = 0;
  let lose = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const s = acting({ ...c, seed });
    prep(s);
    const events = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' }).events;
    const riposte = events.find((e): e is Extract<GameEvent, { type: 'GuardRiposte' }> => e.type === 'GuardRiposte');
    const attack = events.find((e): e is Extract<GameEvent, { type: 'AttackResolved' }> => e.type === 'AttackResolved');
    if (riposte?.prevented) lose++;
    else if (riposte?.result === 'attackerKilled') win++; // a master cut the guard down
    else if (attack?.result.startsWith('defender')) win++;
    else if (attack?.result.startsWith('attacker')) lose++;
  }
  return { win: win / runs, lose: lose / runs };
}

describe('combatOdds', () => {
  it('counts all 36 dice pairs of an even melee', () => {
    const odds = combatOdds(acting(melee()), 'p0u0', 'p1u0');
    expect(odds.win).toBeCloseTo(15 / 36);
    expect(odds.lose).toBeCloseTo(15 / 36);
    expect(odds.clash).toBeCloseTo(6 / 36);
    // 3+a doubles 3+d only for d = 1 and a >= 5.
    expect(odds.kill).toBeCloseTo(2 / 36);
  });

  it('matches what the reducer actually rolls, riposte included', () => {
    const plain = combatOdds(acting(melee({ combat: 2 })), 'p0u0', 'p1u0');
    const seen = sampled(melee({ combat: 2 }), () => {});
    expect(Math.abs(plain.win - seen.win)).toBeLessThan(0.04);
    expect(Math.abs(plain.lose - seen.lose)).toBeLessThan(0.04);

    const guardUp = (s: GameState) => {
      s.units.find((u) => u.id === 'p1u0')!.guarding = true;
    };
    const s = acting(melee({ guard: true }));
    guardUp(s);
    const guarded = combatOdds(s, 'p0u0', 'p1u0');
    const seenGuarded = sampled(melee({ guard: true }), guardUp);
    expect(guarded.lose).toBeGreaterThan(15 / 36);
    expect(Math.abs(guarded.win - seenGuarded.win)).toBeLessThan(0.04);
    expect(Math.abs(guarded.lose - seenGuarded.lose)).toBeLessThan(0.04);
  });

  it('matches what the reducer rolls when Combat Mastery turns ties into kills', () => {
    const guardUp = (s: GameState) => {
      s.units.find((u) => u.id === 'p1u0')!.guarding = true;
    };
    const cases: [Record<string, unknown>, Record<string, unknown>, (s: GameState) => void][] = [
      [{}, { mastery: true }, () => {}],
      [{ mastery: true }, {}, () => {}],
      [{ guard: true, mastery: true }, {}, guardUp],
      [{ guard: true }, { mastery: true }, guardUp],
    ];
    for (const [foe, blade, prep] of cases) {
      const s = acting(melee(foe, blade));
      prep(s);
      const odds = combatOdds(s, 'p0u0', 'p1u0');
      const seen = sampled(melee(foe, blade), prep);
      expect(Math.abs(odds.win - seen.win)).toBeLessThan(0.04);
      expect(Math.abs(odds.lose - seen.lose)).toBeLessThan(0.04);
    }
  });

  it('never risks the shooter, and scores from the hex a charge ends on', () => {
    const c: GameConfig = {
      seed: 1,
      board: { width: 9, height: 3 },
      warbands: [
        [{ name: 'Bow', quality: 3, combat: 3, ranged: 4, pos: { x: 0, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
      ],
    };
    const s = acting(c);
    const shot = combatOdds(s, 'p0u0', 'p1u0', { ranged: true });
    expect(shot.lose).toBe(0);
    expect(shot.win + shot.clash).toBeCloseTo(1);
    // Charging in to (1,1) gives the same odds as already standing there.
    const charge = combatOdds(s, 'p0u0', 'p1u0', { from: { x: 1, y: 1 } });
    expect(charge.win).toBeCloseTo(15 / 36);
    expect(s.units[0]!.pos).toEqual({ x: 0, y: 1 });
  });
});
