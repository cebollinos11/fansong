import { describe, expect, it } from 'vitest';
import {
  createGame,
  getLegalCommands,
  reduce,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
} from '../src/index.js';

/**
 * Build a state already mid-activation for a given unit, bypassing the dice so a
 * single action can be tested without activation RNG. Only the attack/shot/riposte
 * roll then consumes the RNG, which keeps these outcome tests controllable.
 */
function acting(config: GameConfig, activeUnitId: string): GameState {
  const s = createGame(config);
  const u = s.units.find((x) => x.id === activeUnitId)!;
  s.active = u.owner;
  s.activeUnitId = activeUnitId;
  s.phase = 'acting';
  s.actionsRemaining = 1;
  u.activatedThisRound = true;
  return s;
}

function has(commands: Command[], predicate: (c: Command) => boolean): boolean {
  return commands.some(predicate);
}

// --- Ranged -------------------------------------------------------------------

describe('ranged attack (Shoot)', () => {
  const base: GameConfig = {
    seed: 1,
    board: { width: 9, height: 3 },
    warbands: [
      [{ name: 'Bow', quality: 3, combat: 2, ranged: 4, pos: { x: 0, y: 1 } }],
      [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 3, y: 1 } }],
    ],
  };

  it('offers a Shoot at a non-adjacent enemy within range and line of sight', () => {
    const legal = getLegalCommands(acting(base, 'p0u0'));
    expect(has(legal, (c) => c.type === 'Shoot' && c.targetId === 'p1u0')).toBe(true);
  });

  it('cannot shoot an adjacent enemy (that is melee range)', () => {
    const config = structuredClone(base);
    config.warbands[1][0]!.pos = { x: 1, y: 1 };
    const legal = getLegalCommands(acting(config, 'p0u0'));
    expect(has(legal, (c) => c.type === 'Shoot')).toBe(false);
    expect(has(legal, (c) => c.type === 'Attack')).toBe(true);
  });

  it('cannot shoot beyond its range', () => {
    const config = structuredClone(base);
    config.warbands[1][0]!.pos = { x: 6, y: 1 }; // distance 6 > range 4
    const legal = getLegalCommands(acting(config, 'p0u0'));
    expect(has(legal, (c) => c.type === 'Shoot')).toBe(false);
  });

  it('cannot shoot while itself in melee', () => {
    const config: GameConfig = {
      seed: 1,
      board: { width: 9, height: 3 },
      warbands: [
        [{ name: 'Bow', quality: 3, combat: 2, ranged: 4, pos: { x: 0, y: 1 } }],
        [
          { name: 'Near', quality: 3, combat: 3, pos: { x: 1, y: 1 } }, // adjacent — locks the shooter
          { name: 'Far', quality: 3, combat: 3, pos: { x: 4, y: 1 } },
        ],
      ],
    };
    const legal = getLegalCommands(acting(config, 'p0u0'));
    expect(has(legal, (c) => c.type === 'Shoot')).toBe(false);
  });

  it('cannot shoot through blocking terrain', () => {
    const config = structuredClone(base);
    config.board.blocked = ['2,1']; // between shooter (0,1) and foe (3,1)
    const legal = getLegalCommands(acting(config, 'p0u0'));
    expect(has(legal, (c) => c.type === 'Shoot')).toBe(false);
  });

  it('a non-ranged unit is never offered a Shoot', () => {
    const config = structuredClone(base);
    config.warbands[0][0]!.ranged = 0;
    const legal = getLegalCommands(acting(config, 'p0u0'));
    expect(has(legal, (c) => c.type === 'Shoot')).toBe(false);
  });

  it('resolving a shot emits ShotResolved and never harms the shooter', () => {
    // Across many seeds, the shooter must survive every shot (no reprisal).
    for (let seed = 1; seed <= 60; seed++) {
      const s = acting({ ...base, seed }, 'p0u0');
      const { state, events } = reduce(s, { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
      const shot = events.find((e) => e.type === 'ShotResolved');
      expect(shot).toBeDefined();
      // A shot only ever yields a defender-side (or clash) result.
      expect(['defenderKilled', 'defenderKnockedDown', 'defenderRecoiled', 'clash']).toContain(
        (shot as Extract<GameEvent, { type: 'ShotResolved' }>).result,
      );
      expect(state.units.find((u) => u.id === 'p0u0')!.dead).toBe(false);
    }
  });
});

// --- Tough --------------------------------------------------------------------

describe('Tough trait', () => {
  function meleeConfig(tough: boolean, seed: number): GameConfig {
    return {
      seed,
      board: { width: 4, height: 3 },
      warbands: [
        [{ name: 'Brute', quality: 3, combat: 6, pos: { x: 0, y: 1 } }],
        [{ name: 'Shield', quality: 3, combat: 1, tough, pos: { x: 1, y: 1 } }],
      ],
    };
  }

  /** Find a seed whose single melee attack produces a killing result. */
  function seedForKill(tough: boolean): number {
    for (let seed = 1; seed <= 400; seed++) {
      const s = acting(meleeConfig(tough, seed), 'p0u0');
      const { events } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
      const atk = events.find((e) => e.type === 'AttackResolved') as
        | Extract<GameEvent, { type: 'AttackResolved' }>
        | undefined;
      if (atk?.result === 'defenderKilled') return seed;
    }
    throw new Error('no killing seed found');
  }

  it('downgrades the first would-be kill to a knockdown and shrugs it off', () => {
    const seed = seedForKill(true);
    const s = acting(meleeConfig(true, seed), 'p0u0');
    const { state, events } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    const shield = state.units.find((u) => u.id === 'p1u0')!;
    expect(shield.dead).toBe(false);
    expect(shield.knockedDown).toBe(true);
    expect(events.some((e) => e.type === 'ToughnessSaved')).toBe(true);
    expect(events.some((e) => e.type === 'UnitKilled')).toBe(false);
  });

  it('a non-tough unit dies from the same blow', () => {
    const seed = seedForKill(false);
    const s = acting(meleeConfig(false, seed), 'p0u0');
    const { state, events } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    expect(state.units.find((u) => u.id === 'p1u0')!.dead).toBe(true);
    expect(events.some((e) => e.type === 'UnitKilled')).toBe(true);
  });

  it('an already-knocked-down tough unit dies normally (the save is one-time)', () => {
    const seed = seedForKill(true);
    const s = acting(meleeConfig(true, seed), 'p0u0');
    s.units.find((u) => u.id === 'p1u0')!.knockedDown = true; // already down
    const { state } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    expect(state.units.find((u) => u.id === 'p1u0')!.dead).toBe(true);
  });
});

// --- Guard (reaction) ---------------------------------------------------------

describe('Guard trait and riposte', () => {
  const base: GameConfig = {
    seed: 1,
    board: { width: 4, height: 3 },
    warbands: [
      [{ name: 'Sentry', quality: 3, combat: 4, guard: true, pos: { x: 1, y: 1 } }],
      [{ name: 'Raider', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
    ],
  };

  it('offers a Guard action to a guard-capable unit', () => {
    const legal = getLegalCommands(acting(base, 'p0u0'));
    expect(has(legal, (c) => c.type === 'Guard' && c.unitId === 'p0u0')).toBe(true);
  });

  it('a Guard action sets the stance and ends the activation', () => {
    const s = acting(base, 'p0u0');
    const { state, events } = reduce(s, { type: 'Guard', unitId: 'p0u0' });
    expect(state.units.find((u) => u.id === 'p0u0')!.guarding).toBe(true);
    expect(events.some((e) => e.type === 'GuardDeclared')).toBe(true);
    expect(state.activeUnitId).toBeNull(); // activation ended
  });

  it('the stance clears when the unit next activates', () => {
    const s = createGame(base);
    s.units.find((u) => u.id === 'p0u0')!.guarding = true;
    const { state } = reduce(s, { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 });
    expect(state.units.find((u) => u.id === 'p0u0')!.guarding).toBe(false);
  });

  it('a guarding unit ripostes an incoming melee attacker', () => {
    // The attacker (p1u0) strikes the guarding sentry (p0u0).
    const s = acting(base, 'p1u0');
    s.units.find((u) => u.id === 'p0u0')!.guarding = true;
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
    expect(events.some((e) => e.type === 'GuardRiposte')).toBe(true);
  });

  it('reports a riposte the guard loses as a clash, and leaves the guard unhurt', () => {
    let sawLoss = false;
    for (let seed = 1; seed <= 300; seed++) {
      const s = acting({ ...base, seed }, 'p1u0');
      s.units.find((u) => u.id === 'p0u0')!.guarding = true;
      const { state, events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
      const rip = events.find((e) => e.type === 'GuardRiposte') as Extract<GameEvent, { type: 'GuardRiposte' }>;
      // A guard never wounds itself parrying, so no attacker-side outcome is
      // ever applied — and none is ever reported either.
      expect(rip.result.startsWith('attacker')).toBe(false);
      if (rip.attackerScore > rip.guardScore) {
        sawLoss = true;
        expect(rip.result).toBe('clash');
        expect(rip.prevented).toBe(false);
        const sentry = state.units.find((u) => u.id === 'p0u0')!;
        // The riposte itself cost the guard nothing; only the blow that follows can.
        expect(sentry.dead).toBe(false);
        expect(events.some((e) => e.type === 'AttackResolved')).toBe(true);
      }
    }
    expect(sawLoss).toBe(true);
  });

  it("a knocked-down guard's riposte only lands on a natural 6", () => {
    let sawSix = false;
    let sawMiss = false;
    for (let seed = 1; seed <= 300; seed++) {
      const s = acting({ ...base, seed }, 'p1u0');
      const sentry = s.units.find((u) => u.id === 'p0u0')!;
      sentry.guarding = true;
      sentry.knockedDown = true;
      const { events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
      const rip = events.find((e) => e.type === 'GuardRiposte') as Extract<GameEvent, { type: 'GuardRiposte' }>;
      if (rip.guardDie === 6 && rip.guardScore > rip.attackerScore) {
        sawSix = true;
        expect(rip.prevented).toBe(true);
      } else {
        if (rip.guardScore > rip.attackerScore) sawMiss = true;
        expect(rip.prevented).toBe(false);
        expect(events.some((e) => e.type === 'AttackResolved')).toBe(true);
      }
    }
    expect(sawSix).toBe(true);
    expect(sawMiss).toBe(true); // a winning non-6 riposte was seen, and it did nothing
  });

  it('a knocked-down defender hurts the attacker only with a winning natural 6', () => {
    const plain: GameConfig = { ...base, warbands: [[{ ...base.warbands[0]![0]!, guard: false }], base.warbands[1]!] };
    let sawSix = false;
    let sawMiss = false;
    for (let seed = 1; seed <= 300; seed++) {
      const s = acting({ ...plain, seed }, 'p1u0');
      s.units.find((u) => u.id === 'p0u0')!.knockedDown = true;
      const { state, events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
      const atk = events.find((e) => e.type === 'AttackResolved') as Extract<GameEvent, { type: 'AttackResolved' }>;
      if (atk.defenseScore <= atk.attackScore) continue;
      const raider = state.units.find((u) => u.id === 'p1u0')!;
      if (atk.defenseDie === 6) {
        sawSix = true;
        expect(raider.dead || raider.knockedDown).toBe(true);
      } else {
        sawMiss = true;
        expect(atk.result).toBe('clash');
        expect(raider.dead || raider.knockedDown).toBe(false);
      }
    }
    expect(sawSix).toBe(true);
    expect(sawMiss).toBe(true);
  });

  it('a successful riposte prevents the incoming attack entirely', () => {
    // Sweep seeds until the riposte lands (attacker killed/knocked down): the
    // normal AttackResolved must NOT follow, and the guard takes no damage.
    let sawPrevented = false;
    for (let seed = 1; seed <= 200 && !sawPrevented; seed++) {
      const s = acting({ ...base, seed }, 'p1u0');
      s.units.find((u) => u.id === 'p0u0')!.guarding = true;
      const { state, events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
      const rip = events.find((e) => e.type === 'GuardRiposte') as
        | Extract<GameEvent, { type: 'GuardRiposte' }>
        | undefined;
      if (rip?.prevented) {
        sawPrevented = true;
        expect(events.some((e) => e.type === 'AttackResolved')).toBe(false);
        expect(state.units.find((u) => u.id === 'p0u0')!.dead).toBe(false);
        expect(state.units.find((u) => u.id === 'p0u0')!.knockedDown).toBe(false);
      }
    }
    expect(sawPrevented).toBe(true);
  });

  it('a failed riposte lets the attack proceed normally', () => {
    let sawProceed = false;
    for (let seed = 1; seed <= 200 && !sawProceed; seed++) {
      const s = acting({ ...base, seed }, 'p1u0');
      s.units.find((u) => u.id === 'p0u0')!.guarding = true;
      const { events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
      const rip = events.find((e) => e.type === 'GuardRiposte') as
        | Extract<GameEvent, { type: 'GuardRiposte' }>
        | undefined;
      if (rip && !rip.prevented) {
        sawProceed = true;
        expect(events.some((e) => e.type === 'AttackResolved')).toBe(true);
      }
    }
    expect(sawProceed).toBe(true);
  });
});
