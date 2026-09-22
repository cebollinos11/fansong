import { describe, expect, it } from 'vitest';
import {
  AIMED_SHOT_PENALTY,
  applyCommand,
  commandsEqual,
  createGame,
  getLegalCommands,
  isLegalCommand,
  POWER_BLOW_PENALTY,
  PRESSED_COST,
  reduce,
  type Command,
  type CombatResult,
  type GameConfig,
  type GameEvent,
  type GameState,
} from '../src/index.js';

/**
 * Power blows and aimed shots: the two-action versions of an attack and a shot,
 * which buy the target a penalty with the extra action they cost.
 */

type Attack = Extract<GameEvent, { type: 'AttackResolved' }>;
type Shot = Extract<GameEvent, { type: 'ShotResolved' }>;

/** Mid-activation for `p0u0` with `actions` in hand, and the RNG untouched. */
function acting(c: GameConfig, actions: number): GameState {
  const s = createGame(c);
  s.active = 0;
  s.activeUnitId = 'p0u0';
  s.phase = 'acting';
  s.actionsRemaining = actions;
  s.units[0]!.activatedThisRound = true;
  return s;
}

const melee: GameConfig = {
  seed: 1,
  board: { width: 5, height: 3 },
  warbands: [
    [{ name: 'Blade', quality: 3, combat: 3, pos: { x: 1, y: 1 } }],
    [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
  ],
};

const ranged: GameConfig = {
  seed: 1,
  board: { width: 9, height: 3 },
  warbands: [
    [{ name: 'Bow', quality: 3, combat: 2, ranged: 4, pos: { x: 0, y: 1 } }],
    [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
  ],
};

const isPower = (c: Command) => c.type === 'Attack' && c.power === true;
const isAimed = (c: Command) => c.type === 'Shoot' && c.aimed === true;

const meleeResult = (seed: number, power: boolean) =>
  reduce(acting({ ...melee, seed }, 3), {
    type: 'Attack',
    attackerId: 'p0u0',
    targetId: 'p1u0',
    ...(power ? { power: true } as const : {}),
  }).events.find((x): x is Attack => x.type === 'AttackResolved')!.result;

/** Outcomes that leave the attacker on its feet, mid-activation, in a game still running. */
const stillActing = (r: CombatResult) => r === 'clash' || r === 'defenderKnockedDown' || r.endsWith('Recoiled');

/**
 * A seed where both the plain blow and the power blow leave the attacker acting,
 * so what is left of its actions is the cost and nothing else. (The two can never
 * *both* clash: the power blow's extra point is exactly what breaks the tie.)
 */
const quietSeed = (() => {
  for (let seed = 1; seed <= 200; seed++) {
    if (stillActing(meleeResult(seed, false)) && stillActing(meleeResult(seed, true))) return seed;
  }
  throw new Error('no quiet seed found');
})();

describe('offering the pressed options', () => {
  it('a unit with one action left is offered only the ordinary blow', () => {
    const legal = getLegalCommands(acting(melee, 1));
    expect(legal.some((c) => c.type === 'Attack' && !c.power)).toBe(true);
    expect(legal.some(isPower)).toBe(false);
  });

  it('a unit with two actions is offered both', () => {
    const legal = getLegalCommands(acting(melee, PRESSED_COST));
    expect(legal.some((c) => c.type === 'Attack' && !c.power)).toBe(true);
    expect(legal.some(isPower)).toBe(true);
  });

  it('a shooter is offered an aimed shot only with two actions in hand', () => {
    expect(getLegalCommands(acting(ranged, 1)).some(isAimed)).toBe(false);
    expect(getLegalCommands(acting(ranged, PRESSED_COST)).some(isAimed)).toBe(true);
  });

  it('a pressed blow is a different command from a plain one at the same target', () => {
    const plain: Command = { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' };
    const power: Command = { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0', power: true };
    expect(commandsEqual(plain, power)).toBe(false);
    // So a one-action unit cannot slip a power blow past the legality guard.
    const s = acting(melee, 1);
    expect(isLegalCommand(s, plain)).toBe(true);
    expect(isLegalCommand(s, power)).toBe(false);
    expect(() => applyCommand(s, power)).toThrow(/illegal command/);
  });
});

describe('what a pressed blow buys', () => {
  it('a power blow docks the defender a point, on the dice a plain blow would have rolled', () => {
    const s = acting(melee, 3);
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0', power: true });
    const e = events.find((x): x is Attack => x.type === 'AttackResolved')!;
    expect(e.powerPenalty).toBe(POWER_BLOW_PENALTY);
    const p = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' }).events.find(
      (x): x is Attack => x.type === 'AttackResolved',
    )!;
    expect(e.attackScore).toBe(p.attackScore);
    expect(e.defenseScore).toBe(p.defenseScore - POWER_BLOW_PENALTY);
    expect(p.powerPenalty).toBeUndefined();
  });

  it('an aimed shot docks the target a point', () => {
    const s = acting(ranged, 3);
    const { events } = reduce(s, { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0', aimed: true });
    const e = events.find((x): x is Shot => x.type === 'ShotResolved')!;
    expect(e.aimPenalty).toBe(AIMED_SHOT_PENALTY);
    const p = reduce(s, { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' }).events.find(
      (x): x is Shot => x.type === 'ShotResolved',
    )!;
    expect(e.attackScore).toBe(p.attackScore);
    expect(e.defenseScore).toBe(p.defenseScore - AIMED_SHOT_PENALTY);
    expect(p.aimPenalty).toBeUndefined();
  });

  it('a power blow costs two actions where a plain one costs one', () => {
    const s = acting({ ...melee, seed: quietSeed }, 3);
    const plain = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    const power = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0', power: true });
    expect(plain.state.actionsRemaining).toBe(2);
    expect(power.state.actionsRemaining).toBe(3 - PRESSED_COST);
  });

  it('spending the last two actions ends the activation', () => {
    const s = acting(melee, PRESSED_COST);
    const { state } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0', power: true });
    expect(state.actionsRemaining).toBe(0);
    expect(state.activeUnitId).toBeNull();
  });

  it('a pressed blow with only one action left is refused', () => {
    const s = acting(melee, 1);
    expect(() => reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0', power: true })).toThrow(
      /not enough actions/,
    );
  });

  it('the extra point shifts the whole outcome table one step the attacker way', () => {
    let better = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const s = acting({ ...melee, seed }, 3);
      const plain = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
      const power = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0', power: true });
      const p = plain.events.find((x): x is Attack => x.type === 'AttackResolved')!;
      const q = power.events.find((x): x is Attack => x.type === 'AttackResolved')!;
      expect(q.attackScore - q.defenseScore).toBe(p.attackScore - p.defenseScore + POWER_BLOW_PENALTY);
      if (p.result === 'clash' && q.result.startsWith('defender')) better++;
    }
    // On some of those seeds the extra point is what turned a clash into a hit.
    expect(better).toBeGreaterThan(0);
  });
});

describe('a power blow against a guard', () => {
  const guarded: GameConfig = {
    seed: 4,
    board: { width: 5, height: 3 },
    warbands: [
      [{ name: 'Blade', quality: 3, combat: 3, pos: { x: 1, y: 1 } }],
      [{ name: 'Sentry', quality: 3, combat: 4, guard: true, pos: { x: 2, y: 1 } }],
    ],
  };

  /** `p0u0` mid-activation against a sentry already on guard. */
  function vsGuard(seed: number): GameState {
    const s = acting({ ...guarded, seed }, 3);
    s.units.find((u) => u.id === 'p1u0')!.guarding = true;
    return s;
  }

  it('never reaches the riposte — the guard strikes before the blow lands', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = vsGuard(seed);
      const plain = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
      const power = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0', power: true });
      expect(power.events.find((e) => e.type === 'GuardRiposte')).toEqual(
        plain.events.find((e) => e.type === 'GuardRiposte'),
      );
    }
  });

  it('is spent for nothing when the riposte repels it', () => {
    let repelled = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { state, events } = reduce(vsGuard(seed), {
        type: 'Attack',
        attackerId: 'p0u0',
        targetId: 'p1u0',
        power: true,
      });
      if (!events.find((e) => e.type === 'GuardRiposte')!.prevented) continue;
      repelled++;
      // The swing never happens, and the repelled attacker's activation is over.
      expect(events.some((e) => e.type === 'AttackResolved')).toBe(false);
      expect(state.activeUnitId).toBeNull();
    }
    expect(repelled).toBeGreaterThan(0);
  });
});
