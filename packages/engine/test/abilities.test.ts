import { describe, expect, it } from 'vitest';
import {
  combatOdds,
  createGame,
  getLegalCommands,
  makeHexGrid,
  reduce,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
  type UnitSpec,
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

  it('a knockdown or a shove breaks the stance, even after a failed riposte', () => {
    let sawKnockdown = false;
    let sawRecoil = false;
    for (let seed = 1; seed <= 500 && !(sawKnockdown && sawRecoil); seed++) {
      const s = acting({ ...base, seed }, 'p1u0');
      s.units.find((u) => u.id === 'p0u0')!.guarding = true;
      const { state, events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
      const atk = events.find((e) => e.type === 'AttackResolved') as
        | Extract<GameEvent, { type: 'AttackResolved' }>
        | undefined;
      if (!atk) continue;
      const sentry = state.units.find((u) => u.id === 'p0u0')!;
      if (atk.result === 'defenderKnockedDown') {
        sawKnockdown = true;
        expect(sentry.guarding).toBe(false);
      } else if (atk.result === 'defenderRecoiled') {
        sawRecoil = true;
        expect(sentry.guarding).toBe(false);
      }
    }
    expect(sawKnockdown).toBe(true);
    expect(sawRecoil).toBe(true);
  });
});

// --- Big (size) ---------------------------------------------------------------

describe('Big trait', () => {
  /** A duel between two neighbours, either of which may be Big. */
  function melee(attackerBig: boolean, defenderBig: boolean): GameConfig {
    return {
      seed: 5,
      board: { width: 4, height: 3 },
      warbands: [
        [{ name: 'Ogre', quality: 3, combat: 3, big: attackerBig, pos: { x: 1, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, big: defenderBig, pos: { x: 2, y: 1 } }],
      ],
    };
  }

  const resolveAttack = (config: GameConfig, attackerId: string, targetId: string) => {
    const { events } = reduce(acting(config, attackerId), { type: 'Attack', attackerId, targetId });
    return events.find((e) => e.type === 'AttackResolved') as Extract<GameEvent, { type: 'AttackResolved' }>;
  };

  it('adds +1 to a Big attacker swinging at a smaller foe', () => {
    const big = resolveAttack(melee(true, false), 'p0u0', 'p1u0');
    const plain = resolveAttack(melee(false, false), 'p0u0', 'p1u0');
    expect(big.attackBig).toBe(1);
    expect(big.attackScore - plain.attackScore).toBe(1);
    expect(big.defenseBig).toBeUndefined();
    expect(big.defenseScore).toBe(plain.defenseScore);
  });

  it('adds +1 to a Big defender fighting off a smaller attacker', () => {
    const big = resolveAttack(melee(false, true), 'p0u0', 'p1u0');
    const plain = resolveAttack(melee(false, false), 'p0u0', 'p1u0');
    expect(big.defenseBig).toBe(1);
    expect(big.defenseScore - plain.defenseScore).toBe(1);
    expect(big.attackBig).toBeUndefined();
  });

  it('cancels out when both are Big — neither towers over the other', () => {
    const both = resolveAttack(melee(true, true), 'p0u0', 'p1u0');
    const plain = resolveAttack(melee(false, false), 'p0u0', 'p1u0');
    expect(both.attackBig).toBeUndefined();
    expect(both.defenseBig).toBeUndefined();
    expect(both.attackScore).toBe(plain.attackScore);
    expect(both.defenseScore).toBe(plain.defenseScore);
  });

  it('still counts for a Big model that has been knocked down', () => {
    // Size is not a stance: unlike high ground it survives going to the ground.
    const config = melee(false, true);
    const s = acting(config, 'p0u0');
    s.units.find((u) => u.id === 'p1u0')!.knockedDown = true;
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    const atk = events.find((e) => e.type === 'AttackResolved') as Extract<GameEvent, { type: 'AttackResolved' }>;
    expect(atk.defenseBig).toBe(1);
  });

  it("carries into a guard's riposte", () => {
    const config: GameConfig = {
      seed: 5,
      board: { width: 4, height: 3 },
      warbands: [
        [{ name: 'Ogre-Guard', quality: 3, combat: 3, guard: true, big: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Raider', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
      ],
    };
    const s = acting(config, 'p1u0');
    s.units.find((u) => u.id === 'p0u0')!.guarding = true;
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
    const rip = events.find((e) => e.type === 'GuardRiposte') as Extract<GameEvent, { type: 'GuardRiposte' }>;
    expect(rip.guardBig).toBe(1);
    expect(rip.attackerBig).toBeUndefined();
  });

  it('carries into a free hack at a foe leaving contact', () => {
    const config: GameConfig = {
      seed: 5,
      board: { width: 6, height: 3 },
      warbands: [
        [{ name: 'Runner', quality: 3, combat: 3, slow: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Ogre', quality: 3, combat: 3, big: true, pos: { x: 2, y: 1 } }],
      ],
    };
    const { events } = reduce(acting(config, 'p0u0'), { type: 'Move', unitId: 'p0u0', to: { x: 0, y: 1 } });
    const hack = events.find((e) => e.type === 'FreeHackResolved') as Extract<
      GameEvent,
      { type: 'FreeHackResolved' }
    >;
    expect(hack.attackBig).toBe(1);
    expect(hack.defenseBig).toBeUndefined();
  });

  /** A bow at range 3 against a target that may be Big. */
  function shot(targetBig: boolean, shooterBig = false): GameConfig {
    return {
      seed: 5,
      board: { width: 9, height: 3 },
      warbands: [
        [{ name: 'Bow', quality: 3, combat: 2, ranged: 4, big: shooterBig, pos: { x: 0, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, big: targetBig, pos: { x: 2, y: 1 } }],
      ],
    };
  }

  const resolveShot = (config: GameConfig) => {
    const { events } = reduce(acting(config, 'p0u0'), { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
    return events.find((e) => e.type === 'ShotResolved') as Extract<GameEvent, { type: 'ShotResolved' }>;
  };

  it('gives a shooter +1 against a Big target', () => {
    const big = resolveShot(shot(true));
    const plain = resolveShot(shot(false));
    expect(big.bigTarget).toBe(1);
    expect(big.attackScore - plain.attackScore).toBe(1);
    expect(plain.bigTarget).toBeUndefined();
  });

  it('gives that +1 to a Big shooter too — size only cancels in melee', () => {
    const bigOnBig = resolveShot(shot(true, true));
    expect(bigOnBig.bigTarget).toBe(1);
  });

  it('gives a Big shooter nothing for its own size', () => {
    expect(resolveShot(shot(false, true)).bigTarget).toBeUndefined();
  });
});

// --- Flying -------------------------------------------------------------------

describe('Flying trait', () => {
  /** A duel between two neighbours, either of which may fly. */
  function melee(attackerFly: boolean, defenderFly: boolean): GameConfig {
    return {
      seed: 5,
      board: { width: 4, height: 3 },
      warbands: [
        [{ name: 'Talon', quality: 3, combat: 3, flying: attackerFly, pos: { x: 1, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, flying: defenderFly, pos: { x: 2, y: 1 } }],
      ],
    };
  }

  const resolveAttack = (config: GameConfig, attackerId: string, targetId: string) => {
    const { events } = reduce(acting(config, attackerId), { type: 'Attack', attackerId, targetId });
    return events.find((e) => e.type === 'AttackResolved') as Extract<GameEvent, { type: 'AttackResolved' }>;
  };

  it('adds +1 to a flyer swooping at a grounded foe', () => {
    const fly = resolveAttack(melee(true, false), 'p0u0', 'p1u0');
    const plain = resolveAttack(melee(false, false), 'p0u0', 'p1u0');
    expect(fly.attackFly).toBe(1);
    expect(fly.attackScore - plain.attackScore).toBe(1);
    expect(fly.defenseScore).toBe(plain.defenseScore);
  });

  it('gives a flyer nothing on defence — flying is pressed, not defended with', () => {
    const fly = resolveAttack(melee(false, true), 'p0u0', 'p1u0');
    const plain = resolveAttack(melee(false, false), 'p0u0', 'p1u0');
    expect(fly.attackFly).toBeUndefined();
    expect(fly.defenseScore).toBe(plain.defenseScore);
  });

  it('cancels out when both fly — neither swoops on the other', () => {
    const both = resolveAttack(melee(true, true), 'p0u0', 'p1u0');
    const plain = resolveAttack(melee(false, false), 'p0u0', 'p1u0');
    expect(both.attackFly).toBeUndefined();
    expect(both.attackScore).toBe(plain.attackScore);
  });

  it('lapses for a flyer brought down to earth — unlike size, flight is a stance', () => {
    const s = acting(melee(true, false), 'p0u0');
    s.units.find((u) => u.id === 'p0u0')!.knockedDown = true;
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    const atk = events.find((e) => e.type === 'AttackResolved') as Extract<GameEvent, { type: 'AttackResolved' }>;
    expect(atk.attackFly).toBeUndefined();
  });

  it("carries into a flying guard's riposte", () => {
    const config: GameConfig = {
      seed: 5,
      board: { width: 4, height: 3 },
      warbands: [
        [{ name: 'Sky-Guard', quality: 3, combat: 3, guard: true, flying: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Raider', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
      ],
    };
    const s = acting(config, 'p1u0');
    s.units.find((u) => u.id === 'p0u0')!.guarding = true;
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
    const rip = events.find((e) => e.type === 'GuardRiposte') as Extract<GameEvent, { type: 'GuardRiposte' }>;
    expect(rip.guardFly).toBe(1);
  });

  it('carries into a flyer hacking a grounded foe that leaves contact', () => {
    const config: GameConfig = {
      seed: 5,
      board: { width: 6, height: 3 },
      warbands: [
        [{ name: 'Runner', quality: 3, combat: 3, slow: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Talon', quality: 3, combat: 3, flying: true, pos: { x: 2, y: 1 } }],
      ],
    };
    const { events } = reduce(acting(config, 'p0u0'), { type: 'Move', unitId: 'p0u0', to: { x: 0, y: 1 } });
    const hack = events.find((e) => e.type === 'FreeHackResolved') as Extract<GameEvent, { type: 'FreeHackResolved' }>;
    expect(hack.attackFly).toBe(1);
  });

  it('draws no free hack of its own when it leaves contact', () => {
    const config: GameConfig = {
      seed: 5,
      board: { width: 6, height: 3 },
      warbands: [
        [{ name: 'Talon', quality: 3, combat: 3, slow: true, flying: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
      ],
    };
    const { state, events } = reduce(acting(config, 'p0u0'), { type: 'Move', unitId: 'p0u0', to: { x: 0, y: 1 } });
    expect(events.some((e) => e.type === 'FreeHackResolved')).toBe(false);
    expect(events.some((e) => e.type === 'UnitMoved')).toBe(true);
    expect(state.units.find((u) => u.id === 'p0u0')!.pos).toEqual({ x: 0, y: 1 });
  });

  /** A bow at range 3 against a target that may fly. */
  function shot(targetFly: boolean): GameConfig {
    return {
      seed: 5,
      board: { width: 9, height: 3 },
      warbands: [
        [{ name: 'Bow', quality: 3, combat: 2, ranged: 4, pos: { x: 0, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, flying: targetFly, pos: { x: 2, y: 1 } }],
      ],
    };
  }

  const resolveShot = (config: GameConfig, prep?: (s: GameState) => void) => {
    const s = acting(config, 'p0u0');
    prep?.(s);
    const { events } = reduce(s, { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
    return events.find((e) => e.type === 'ShotResolved') as Extract<GameEvent, { type: 'ShotResolved' }>;
  };

  it('gives a shooter +1 against an airborne flyer', () => {
    const fly = resolveShot(shot(true));
    const plain = resolveShot(shot(false));
    expect(fly.flyingTarget).toBe(1);
    expect(fly.attackScore - plain.attackScore).toBe(1);
    expect(plain.flyingTarget).toBeUndefined();
  });

  it('gives the shooter nothing once the flyer is knocked down to the ground', () => {
    const downed = resolveShot(shot(true), (s) => {
      s.units.find((u) => u.id === 'p1u0')!.knockedDown = true;
    });
    expect(downed.flyingTarget).toBeUndefined();
  });

  it('moves over an enemy line to land beyond it, where a walker is barred', () => {
    const config: GameConfig = {
      seed: 5,
      board: { width: 6, height: 3 },
      warbands: [
        [{ name: 'Talon', quality: 3, combat: 3, slow: true, flying: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Wall', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
      ],
    };
    const legal = getLegalCommands(acting(config, 'p0u0'));
    // (4,1) sits three hexes off, straight through the enemy at (2,1).
    expect(has(legal, (c) => c.type === 'Move' && c.to.x === 4 && c.to.y === 1)).toBe(true);
    // It may pass over the enemy but never finish on it.
    expect(has(legal, (c) => c.type === 'Move' && c.to.x === 2 && c.to.y === 1)).toBe(false);
  });

  it('phases over impassable terrain but may not land on it', () => {
    const config: GameConfig = {
      seed: 5,
      board: { width: 6, height: 3, blocked: ['2,1'] },
      warbands: [
        [{ name: 'Talon', quality: 3, combat: 3, slow: true, flying: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 5, y: 0 } }],
      ],
    };
    const legal = getLegalCommands(acting(config, 'p0u0'));
    expect(has(legal, (c) => c.type === 'Move' && c.to.x === 3 && c.to.y === 1)).toBe(true);
    expect(has(legal, (c) => c.type === 'Move' && c.to.x === 2 && c.to.y === 1)).toBe(false);
  });
});

// --- Mounted ------------------------------------------------------------------

describe('Mounted trait', () => {
  /** A duel between two neighbours, either of which may ride. */
  function melee(attackerMounted: boolean, defenderMounted: boolean): GameConfig {
    return {
      seed: 5,
      board: { width: 4, height: 3 },
      warbands: [
        [{ name: 'Rider', quality: 3, combat: 3, mounted: attackerMounted, pos: { x: 1, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, mounted: defenderMounted, pos: { x: 2, y: 1 } }],
      ],
    };
  }

  const resolveAttack = (config: GameConfig, prep?: (s: GameState) => void) => {
    const s = acting(config, 'p0u0');
    prep?.(s);
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    return events.find((e) => e.type === 'AttackResolved') as Extract<GameEvent, { type: 'AttackResolved' }>;
  };

  it('adds +1 to a rider attacking a foe on foot', () => {
    const rider = resolveAttack(melee(true, false));
    const plain = resolveAttack(melee(false, false));
    expect(rider.attackMounted).toBe(1);
    expect(rider.attackScore - plain.attackScore).toBe(1);
    expect(rider.defenseScore).toBe(plain.defenseScore);
  });

  it('adds +1 to a rider defending against a foe on foot', () => {
    const rider = resolveAttack(melee(false, true));
    const plain = resolveAttack(melee(false, false));
    expect(rider.defenseMounted).toBe(1);
    expect(rider.defenseScore - plain.defenseScore).toBe(1);
    expect(rider.attackMounted).toBeUndefined();
  });

  it('cancels out when both ride', () => {
    const both = resolveAttack(melee(true, true));
    const plain = resolveAttack(melee(false, false));
    expect(both.attackMounted).toBeUndefined();
    expect(both.defenseMounted).toBeUndefined();
    expect(both.attackScore).toBe(plain.attackScore);
    expect(both.defenseScore).toBe(plain.defenseScore);
  });

  it('lapses while the rider is knocked down', () => {
    const downedAttacker = resolveAttack(melee(true, false), (s) => {
      s.units.find((u) => u.id === 'p0u0')!.knockedDown = true;
    });
    expect(downedAttacker.attackMounted).toBeUndefined();
    const downedDefender = resolveAttack(melee(false, true), (s) => {
      s.units.find((u) => u.id === 'p1u0')!.knockedDown = true;
    });
    expect(downedDefender.defenseMounted).toBeUndefined();
  });

  it("carries into a mounted guard's riposte", () => {
    const config: GameConfig = {
      seed: 5,
      board: { width: 4, height: 3 },
      warbands: [
        [{ name: 'Lancer', quality: 3, combat: 3, guard: true, mounted: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Raider', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
      ],
    };
    const s = acting(config, 'p1u0');
    s.units.find((u) => u.id === 'p0u0')!.guarding = true;
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
    const rip = events.find((e) => e.type === 'GuardRiposte') as Extract<GameEvent, { type: 'GuardRiposte' }>;
    expect(rip.guardMounted).toBe(1);
    expect(rip.attackerMounted).toBeUndefined();
  });

  it('carries into free hacks, for the hacker and the leaver alike', () => {
    const config = (hackerMounted: boolean, leaverMounted: boolean): GameConfig => ({
      seed: 5,
      board: { width: 6, height: 3 },
      warbands: [
        [{ name: 'Runner', quality: 3, combat: 3, slow: true, mounted: leaverMounted, pos: { x: 1, y: 1 } }],
        [{ name: 'Rider', quality: 3, combat: 3, mounted: hackerMounted, pos: { x: 2, y: 1 } }],
      ],
    });
    const hackOf = (c: GameConfig) => {
      const { events } = reduce(acting(c, 'p0u0'), { type: 'Move', unitId: 'p0u0', to: { x: 0, y: 1 } });
      return events.find((e) => e.type === 'FreeHackResolved') as Extract<GameEvent, { type: 'FreeHackResolved' }>;
    };
    expect(hackOf(config(true, false)).attackMounted).toBe(1);
    expect(hackOf(config(false, true)).defenseMounted).toBe(1);
  });

  it('does not touch shooting', () => {
    const config = (mounted: boolean): GameConfig => ({
      seed: 5,
      board: { width: 9, height: 3 },
      warbands: [
        [{ name: 'Horse-Archer', quality: 3, combat: 2, ranged: 4, mounted, pos: { x: 0, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
      ],
    });
    const shoot = (c: GameConfig) => {
      const { events } = reduce(acting(c, 'p0u0'), { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
      return events.find((e) => e.type === 'ShotResolved') as Extract<GameEvent, { type: 'ShotResolved' }>;
    };
    expect(shoot(config(true)).attackScore).toBe(shoot(config(false)).attackScore);
  });
});

// --- Opportunist --------------------------------------------------------------

describe('Opportunist trait', () => {
  /** A duel between two neighbours, either of which may be an Opportunist. */
  function melee(attackerOpp: boolean, defenderOpp: boolean): GameConfig {
    return {
      seed: 5,
      board: { width: 4, height: 3 },
      warbands: [
        [{ name: 'Striker', quality: 3, combat: 3, opportunist: attackerOpp, pos: { x: 1, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, opportunist: defenderOpp, pos: { x: 2, y: 1 } }],
      ],
    };
  }

  const down = (id: string) => (s: GameState) => {
    s.units.find((u) => u.id === id)!.knockedDown = true;
  };

  const resolveAttack = (config: GameConfig, prep?: (s: GameState) => void) => {
    const s = acting(config, 'p0u0');
    prep?.(s);
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    return events.find((e) => e.type === 'AttackResolved') as Extract<GameEvent, { type: 'AttackResolved' }>;
  };

  it('adds +1 to an Opportunist attacking a knocked-down foe', () => {
    const opp = resolveAttack(melee(true, false), down('p1u0'));
    const plain = resolveAttack(melee(false, false), down('p1u0'));
    expect(opp.attackOpportunist).toBe(1);
    expect(opp.attackScore - plain.attackScore).toBe(1);
    expect(opp.defenseScore).toBe(plain.defenseScore);
  });

  it('gives nothing against a standing foe', () => {
    const opp = resolveAttack(melee(true, false));
    const plain = resolveAttack(melee(false, false));
    expect(opp.attackOpportunist).toBeUndefined();
    expect(opp.attackScore).toBe(plain.attackScore);
  });

  it('adds +1 to an Opportunist defending against a knocked-down attacker', () => {
    const opp = resolveAttack(melee(false, true), down('p0u0'));
    const plain = resolveAttack(melee(false, false), down('p0u0'));
    expect(opp.defenseOpportunist).toBe(1);
    expect(opp.defenseScore - plain.defenseScore).toBe(1);
  });

  it("carries into an Opportunist attacker's blow against a knocked-down guard's riposte", () => {
    const config: GameConfig = {
      seed: 5,
      board: { width: 4, height: 3 },
      warbands: [
        [{ name: 'Sentry', quality: 3, combat: 3, guard: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Cutthroat', quality: 3, combat: 3, opportunist: true, pos: { x: 2, y: 1 } }],
      ],
    };
    const s = acting(config, 'p1u0');
    const guard = s.units.find((u) => u.id === 'p0u0')!;
    guard.guarding = true;
    guard.knockedDown = true;
    const { events } = reduce(s, { type: 'Attack', attackerId: 'p1u0', targetId: 'p0u0' });
    const rip = events.find((e) => e.type === 'GuardRiposte') as Extract<GameEvent, { type: 'GuardRiposte' }>;
    expect(rip.attackerOpportunist).toBe(1);
    expect(rip.guardOpportunist).toBeUndefined();
  });

  it('carries into free hacks at a knocked-down leaver', () => {
    const config = (hackerOpp: boolean): GameConfig => ({
      seed: 5,
      board: { width: 6, height: 3 },
      warbands: [
        [{ name: 'Runner', quality: 3, combat: 3, slow: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Cutthroat', quality: 3, combat: 3, opportunist: hackerOpp, pos: { x: 2, y: 1 } }],
      ],
    });
    const hackOf = (c: GameConfig) => {
      const s = acting(c, 'p0u0');
      s.units.find((u) => u.id === 'p0u0')!.knockedDown = true;
      const { events } = reduce(s, { type: 'Move', unitId: 'p0u0', to: { x: 0, y: 1 } });
      return events.find((e) => e.type === 'FreeHackResolved') as Extract<GameEvent, { type: 'FreeHackResolved' }> | undefined;
    };
    const opp = hackOf(config(true));
    const plain = hackOf(config(false));
    expect(opp?.attackOpportunist).toBe(1);
    expect(opp!.attackScore - plain!.attackScore).toBe(1);
  });

  it('adds +1 to an Opportunist shooting a knocked-down target', () => {
    const config = (opportunist: boolean): GameConfig => ({
      seed: 5,
      board: { width: 9, height: 3 },
      warbands: [
        [{ name: 'Sniper', quality: 3, combat: 2, ranged: 4, opportunist, pos: { x: 0, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
      ],
    });
    const shoot = (c: GameConfig, targetDown: boolean) => {
      const s = acting(c, 'p0u0');
      if (targetDown) down('p1u0')(s);
      const { events } = reduce(s, { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
      return events.find((e) => e.type === 'ShotResolved') as Extract<GameEvent, { type: 'ShotResolved' }>;
    };
    const opp = shoot(config(true), true);
    expect(opp.attackOpportunist).toBe(1);
    expect(opp.attackScore - shoot(config(false), true).attackScore).toBe(1);
    expect(shoot(config(true), false).attackOpportunist).toBeUndefined();
  });
});

// --- Sharpshooter -------------------------------------------------------------

describe('Sharpshooter trait', () => {
  const config = (sharpshooter: boolean): GameConfig => ({
    seed: 5,
    board: { width: 9, height: 3 },
    warbands: [
      [{ name: 'Marksman', quality: 3, combat: 2, ranged: 4, sharpshooter, pos: { x: 0, y: 1 } }],
      [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
    ],
  });
  const shoot = (c: GameConfig) => {
    const s = acting(c, 'p0u0');
    const { events } = reduce(s, { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
    return events.find((e) => e.type === 'ShotResolved') as Extract<GameEvent, { type: 'ShotResolved' }>;
  };

  it('adds +1 to every shot a Sharpshooter takes', () => {
    const sharp = shoot(config(true));
    expect(sharp.attackSharpshooter).toBe(1);
    expect(sharp.attackScore - shoot(config(false)).attackScore).toBe(1);
    expect(shoot(config(false)).attackSharpshooter).toBeUndefined();
  });

  it('does nothing in melee', () => {
    const c: GameConfig = {
      seed: 5,
      board: { width: 5, height: 3 },
      warbands: [
        [{ name: 'Marksman', quality: 3, combat: 2, ranged: 4, sharpshooter: true, pos: { x: 1, y: 1 } }],
        [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 2, y: 1 } }],
      ],
    };
    const { events } = reduce(acting(c, 'p0u0'), { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    const blow = events.find((e) => e.type === 'AttackResolved') as Extract<GameEvent, { type: 'AttackResolved' }>;
    expect(blow.attackScore).toBe(2 + blow.attackDie);
  });
});

// --- Savage -------------------------------------------------------------------

describe('Savage trait', () => {
  type Combat = Extract<GameEvent, { type: 'AttackResolved' | 'ShotResolved' }>;

  /**
   * P0's lone unit `p0` next to P1's Victim (p1u0) at the map's west edge, with
   * a Friend in fear range and two far units so one death never routs P1.
   */
  const config = (seed: number, p0: Partial<UnitSpec>, victim: Partial<UnitSpec> = {}): GameConfig => ({
    seed,
    board: { width: 9, height: 5 },
    warbands: [
      [{ name: 'Brute', quality: 3, combat: 3, pos: { x: 1, y: 2 }, ...p0 }],
      [
        { name: 'Victim', quality: 4, combat: 3, pos: { x: 0, y: 2 }, ...victim },
        { name: 'Friend', quality: 4, combat: 3, pos: { x: 0, y: 4 } },
        { name: 'Far1', quality: 4, combat: 3, pos: { x: 8, y: 0 } },
        { name: 'Far2', quality: 4, combat: 3, pos: { x: 8, y: 4 } },
      ],
    ],
  });

  /** The first seed whose opening blow (or shot) by p0u0 on p1u0 passes `pick`. */
  function find(p0: Partial<UnitSpec>, pick: (e: Combat, events: GameEvent[]) => boolean, victim?: Partial<UnitSpec>) {
    const shoot = (p0.ranged ?? 0) > 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const { events } = reduce(acting(config(seed, p0, victim), 'p0u0'), {
        type: shoot ? 'Shoot' : 'Attack',
        attackerId: 'p0u0',
        targetId: 'p1u0',
      });
      const e = events.find((x): x is Combat => x.type === 'AttackResolved' || x.type === 'ShotResolved')!;
      if (pick(e, events)) return { e, events, seed };
    }
    throw new Error('no seed fits');
  }

  const tripled = (e: Combat) => e.attackScore >= e.defenseScore * 3;
  const tested = (events: GameEvent[]) => events.flatMap((x) => (x.type === 'NerveCheck' ? [x.unitId] : []));

  it("makes a Savage's ordinary kill gruesome, and nearby friends test for fear", () => {
    const { e, events, seed } = find({ savage: true }, (e) => e.result === 'defenderKilled' && !tripled(e));
    expect(e.gruesome).toBe(true);
    expect(tested(events)).toEqual(['p1u1']);
    // The same blow from a plain unit is an ordinary kill.
    const plain = reduce(acting(config(seed, {}), 'p0u0'), { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
    expect(plain.events.find((x) => x.type === 'AttackResolved')).not.toHaveProperty('gruesome');
    expect(tested(plain.events)).toEqual([]);
  });

  it('makes a Savage defender killing its attacker gruesome', () => {
    const { e } = find({}, (e) => e.result === 'attackerKilled' && e.defenseScore < e.attackScore * 3, { savage: true });
    expect(e.gruesome).toBe(true);
  });

  it("does not make a Savage's own death gruesome", () => {
    const { e } = find({ savage: true }, (e) => e.result === 'attackerKilled' && e.defenseScore < e.attackScore * 3);
    expect(e).not.toHaveProperty('gruesome');
  });

  it("makes a Savage shooter's kill gruesome", () => {
    const shooter = { savage: true, ranged: 5, pos: { x: 3, y: 2 } };
    const { e } = find(shooter, (e) => e.result === 'defenderKilled' && !tripled(e));
    expect(e.gruesome).toBe(true);
  });

  it('makes a Savage shoving a foe off the map a gruesome kill', () => {
    const { e, events } = find({ savage: true }, (_, ev) => ev.some((x) => x.type === 'UnitPushedOff'));
    expect(e.result).toBe('defenderRecoiled');
    expect(e.gruesome).toBe(true);
    expect(events.some((x) => x.type === 'UnitKilled' && x.unitId === 'p1u0')).toBe(true);
    expect(tested(events)).toEqual(['p1u1']);
  });

  it('leaves an ordinary shove off the map fearless', () => {
    const { e, events } = find({}, (_, ev) => ev.some((x) => x.type === 'UnitPushedOff'));
    expect(e).not.toHaveProperty('gruesome');
    expect(tested(events)).toEqual([]);
  });
});

// --- Armored ------------------------------------------------------------------

describe('Armored trait', () => {
  /** P0's Striker next to P1's Target (p1u0), with two far units so one death never routs P1. */
  const config = (seed: number, p0: Partial<UnitSpec>, target: Partial<UnitSpec> = {}): GameConfig => ({
    seed,
    board: { width: 9, height: 5 },
    warbands: [
      [{ name: 'Striker', quality: 3, combat: 3, pos: { x: 3, y: 2 }, ...p0 }],
      [
        { name: 'Target', quality: 4, combat: 3, pos: { x: 4, y: 2 }, ...target },
        { name: 'Far1', quality: 4, combat: 3, pos: { x: 8, y: 0 } },
        { name: 'Far2', quality: 4, combat: 3, pos: { x: 8, y: 4 } },
      ],
    ],
  });

  type Combat = Extract<GameEvent, { type: 'AttackResolved' | 'ShotResolved' }>;

  /** The first seed whose opening blow (or shot) by p0u0 on p1u0 passes `pick`; `down` knocks the target down first. */
  function find(
    p0: Partial<UnitSpec>,
    target: Partial<UnitSpec>,
    pick: (e: Combat) => boolean,
    down = false,
  ) {
    const shoot = (p0.ranged ?? 0) > 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const s = acting(config(seed, p0, target), 'p0u0');
      if (down) s.units.find((u) => u.id === 'p1u0')!.knockedDown = true;
      const { state, events } = reduce(s, { type: shoot ? 'Shoot' : 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
      const e = events.find((x): x is Combat => x.type === 'AttackResolved' || x.type === 'ShotResolved')!;
      if (pick(e)) return { e, events, state };
    }
    throw new Error('no seed fits');
  }

  const byOne = (e: Combat) => e.attackScore === e.defenseScore + 1;
  const unit = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;

  it('turns aside a blow that beats it by exactly 1', () => {
    const { e, events, state } = find({}, { armored: true }, byOne);
    expect(e.result).toBe('clash');
    expect(events[events.indexOf(e) + 1]).toEqual({ type: 'ArmorHeld', unitId: 'p1u0' });
    expect(unit(state, 'p1u0')).toMatchObject({ dead: false, knockedDown: false, pos: { x: 4, y: 2 } });
  });

  it('saves a knocked-down unit from a 1-point loss too', () => {
    const { e, events, state } = find({}, { armored: true }, byOne, true);
    expect(e.result).toBe('clash');
    expect(events.some((x) => x.type === 'ArmorHeld' && x.unitId === 'p1u0')).toBe(true);
    expect(unit(state, 'p1u0')).toMatchObject({ dead: false, knockedDown: true });
  });

  it('protects an Armored attacker that loses by 1', () => {
    const { e, events, state } = find({ armored: true }, {}, (e) => e.defenseScore === e.attackScore + 1);
    expect(e.result).toBe('clash');
    expect(events.some((x) => x.type === 'ArmorHeld' && x.unitId === 'p0u0')).toBe(true);
    expect(unit(state, 'p0u0')).toMatchObject({ dead: false, knockedDown: false });
  });

  it('turns aside a shot that beats it by exactly 1', () => {
    const shooter = { ranged: 5, pos: { x: 1, y: 2 } };
    const { e, events } = find(shooter, { armored: true }, byOne);
    expect(e.result).toBe('clash');
    expect(events.some((x) => x.type === 'ArmorHeld' && x.unitId === 'p1u0')).toBe(true);
  });

  it('does nothing against a loss by 2 or more', () => {
    const { e, events } = find({}, { armored: true }, (e) => e.attackScore >= e.defenseScore + 2);
    expect(e.result).not.toBe('clash');
    expect(events.some((x) => x.type === 'ArmorHeld')).toBe(false);
  });

  it('leaves an unarmored 1-point loser to its fate', () => {
    const { e, events } = find({}, {}, byOne);
    expect(e.result).not.toBe('clash');
    expect(events.some((x) => x.type === 'ArmorHeld')).toBe(false);
  });
});

// --- Combat Mastery -------------------------------------------------------------

describe('Combat Mastery trait', () => {
  /** P0's Striker (p0u0) next to P1's Target (p1u0), each with two far friends so one death never ends the game. */
  const config = (seed: number, striker: Partial<UnitSpec>, target: Partial<UnitSpec> = {}): GameConfig => ({
    seed,
    board: { width: 9, height: 5 },
    warbands: [
      [
        { name: 'Striker', quality: 3, combat: 3, pos: { x: 3, y: 2 }, ...striker },
        { name: 'Home1', quality: 4, combat: 3, pos: { x: 0, y: 0 } },
        { name: 'Home2', quality: 4, combat: 3, pos: { x: 0, y: 4 } },
      ],
      [
        { name: 'Target', quality: 4, combat: 3, pos: { x: 4, y: 2 }, ...target },
        { name: 'Far1', quality: 4, combat: 3, pos: { x: 8, y: 0 } },
        { name: 'Far2', quality: 4, combat: 3, pos: { x: 8, y: 4 } },
      ],
    ],
  });

  type Roll = Extract<GameEvent, { type: 'AttackResolved' | 'ShotResolved' | 'GuardRiposte' | 'FreeHackResolved' }>;
  const tie = (e: Roll) =>
    e.type === 'GuardRiposte' ? e.guardScore === e.attackerScore : e.attackScore === e.defenseScore;

  /**
   * The first seed where p0u0's `command` produces a roll of `type` passing
   * `pick`; `prep` adjusts the state first (a guard stance, a knockdown).
   */
  function find(
    striker: Partial<UnitSpec>,
    target: Partial<UnitSpec>,
    command: Command,
    type: Roll['type'],
    pick: (e: Roll) => boolean = tie,
    prep: (s: GameState) => void = () => {},
  ) {
    for (let seed = 1; seed <= 3000; seed++) {
      const s = acting(config(seed, striker, target), 'p0u0');
      prep(s);
      const { state, events } = reduce(s, command);
      const e = events.find((x): x is Roll => x.type === type);
      if (e && pick(e)) return { e, events, state };
    }
    throw new Error('no seed fits');
  }

  const attack: Command = { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' };
  const leave: Command = { type: 'Move', unitId: 'p0u0', to: { x: 2, y: 2 } };
  const unit = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;
  const guarding = (s: GameState) => void (unit(s, 'p1u0').guarding = true);
  const down = (s: GameState) => void (unit(s, 'p1u0').knockedDown = true);
  const defenseDie = (e: Roll) => (e.type === 'AttackResolved' ? e.defenseDie : 0);

  it("kills the defender when a master's blow ties", () => {
    const { e, events, state } = find({ mastery: true }, {}, attack, 'AttackResolved');
    expect(e.result).toBe('defenderKilled');
    expect(e).not.toHaveProperty('gruesome');
    expect(events[events.indexOf(e) + 1]).toEqual({ type: 'MasteryStruck', unitId: 'p0u0' });
    expect(unit(state, 'p1u0').dead).toBe(true);
  });

  it('kills the attacker when it ties a defending master', () => {
    const { e, events, state } = find({}, { mastery: true }, attack, 'AttackResolved');
    expect(e.result).toBe('attackerKilled');
    expect(events[events.indexOf(e) + 1]).toEqual({ type: 'MasteryStruck', unitId: 'p1u0' });
    expect(unit(state, 'p0u0').dead).toBe(true);
    expect(state.activeUnitId).not.toBe('p0u0');
  });

  it('leaves a tie between two masters a clash', () => {
    const { e, events } = find({ mastery: true }, { mastery: true }, attack, 'AttackResolved');
    expect(e.result).toBe('clash');
    expect(events.some((x) => x.type === 'MasteryStruck')).toBe(false);
  });

  it('is saved against by Tough like any kill', () => {
    const { e, events, state } = find({ mastery: true }, { tough: true }, attack, 'AttackResolved');
    expect(e.result).toBe('defenderKilled');
    expect(events.some((x) => x.type === 'ToughnessSaved' && x.unitId === 'p1u0')).toBe(true);
    expect(unit(state, 'p1u0')).toMatchObject({ dead: false, knockedDown: true });
  });

  it('only strikes from the ground on a natural 6', () => {
    const miss = find({}, { mastery: true }, attack, 'AttackResolved', (e) => tie(e) && defenseDie(e) !== 6, down);
    expect(miss.e.result).toBe('clash');
    expect(miss.events.some((x) => x.type === 'MasteryStruck')).toBe(false);
    const six = find({}, { mastery: true }, attack, 'AttackResolved', (e) => tie(e) && defenseDie(e) === 6, down);
    expect(six.e.result).toBe('attackerKilled');
  });

  it('does nothing for a shot', () => {
    const shooter = { ranged: 5, pos: { x: 1, y: 2 }, mastery: true };
    const shoot: Command = { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' };
    const { e, events } = find(shooter, { mastery: true }, shoot, 'ShotResolved');
    expect(e.result).toBe('clash');
    expect(events.some((x) => x.type === 'MasteryStruck')).toBe(false);
  });

  it("kills the attacker when a guarding master's riposte ties, stopping the attack", () => {
    const { e, events, state } = find({}, { guard: true, mastery: true }, attack, 'GuardRiposte', tie, guarding);
    expect(e).toMatchObject({ result: 'defenderKilled', prevented: true });
    expect(events[events.indexOf(e) + 1]).toEqual({ type: 'MasteryStruck', unitId: 'p1u0' });
    expect(unit(state, 'p0u0').dead).toBe(true);
    expect(events.some((x) => x.type === 'AttackResolved')).toBe(false);
  });

  it('cuts down a guard whose riposte a master ties: that is the blow', () => {
    const { e, events, state } = find({ mastery: true }, { guard: true }, attack, 'GuardRiposte', tie, guarding);
    expect(e).toMatchObject({ result: 'attackerKilled', prevented: false });
    expect(events[events.indexOf(e) + 1]).toEqual({ type: 'MasteryStruck', unitId: 'p0u0' });
    expect(unit(state, 'p1u0').dead).toBe(true);
    expect(unit(state, 'p0u0').dead).toBe(false);
    expect(events.some((x) => x.type === 'AttackResolved')).toBe(false);
  });

  it("kills a unit leaving contact when a master's free hack ties", () => {
    const { e, events, state } = find({}, { mastery: true }, leave, 'FreeHackResolved');
    expect(e.result).toBe('defenderKilled');
    expect(events[events.indexOf(e) + 1]).toEqual({ type: 'MasteryStruck', unitId: 'p1u0' });
    expect(unit(state, 'p0u0').dead).toBe(true);
    expect(events.some((x) => x.type === 'UnitMoved')).toBe(false);
  });

  it('cuts down the hacker when a leaving master ties, and walks on', () => {
    const { e, events, state } = find({ mastery: true }, {}, leave, 'FreeHackResolved');
    expect(e.result).toBe('attackerKilled');
    expect(events[events.indexOf(e) + 1]).toEqual({ type: 'MasteryStruck', unitId: 'p0u0' });
    expect(unit(state, 'p1u0').dead).toBe(true);
    expect(unit(state, 'p0u0').pos).toEqual({ x: 2, y: 2 });
  });

  it('counts the tie as a kill in the odds', () => {
    const odds = (striker: Partial<UnitSpec>, target: Partial<UnitSpec> = {}) =>
      combatOdds(acting(config(1, striker, target), 'p0u0'), 'p0u0', 'p1u0');
    const plain = odds({});
    // Equal Combat: 6 of the 36 dice pairs tie.
    expect(odds({ mastery: true }).kill - plain.kill).toBeCloseTo(6 / 36);
    expect(odds({ mastery: true }).clash).toBeCloseTo(0);
    expect(odds({}, { mastery: true }).lose - plain.lose).toBeCloseTo(6 / 36);
    expect(odds({ mastery: true }, { mastery: true })).toEqual(plain);
  });

  it('counts a guard cut down by a tied riposte as a kill in the odds', () => {
    const odds = (striker: Partial<UnitSpec>) => {
      const s = acting(config(1, striker, { guard: true }), 'p0u0');
      guarding(s);
      return combatOdds(s, 'p0u0', 'p1u0');
    };
    const mastered = odds({ mastery: true });
    expect(mastered.kill).toBeGreaterThan(odds({}).kill);
    expect(mastered.win + mastered.lose + mastered.clash).toBeCloseTo(1);
  });
});

// --- Leader -------------------------------------------------------------------

describe('Leader trait', () => {
  /** P0: a Leader, two friends and a second Leader; P1: one foe far away. */
  const config = (seed = 1): GameConfig => ({
    seed,
    board: { width: 9, height: 5 },
    warbands: [
      [
        { name: 'Captain', quality: 3, combat: 3, leader: true, pos: { x: 1, y: 1 } },
        { name: 'Spear', quality: 6, combat: 3, pos: { x: 1, y: 2 } },
        { name: 'Bow', quality: 6, combat: 2, pos: { x: 1, y: 3 } },
        { name: 'Sergeant', quality: 4, combat: 3, leader: true, pos: { x: 0, y: 2 } },
      ],
      [{ name: 'Foe', quality: 4, combat: 3, pos: { x: 8, y: 2 } }],
    ],
  });

  const warCry: Command = { type: 'WarCry', unitId: 'p0u0' };
  const unit = (s: GameState, id: string) => s.units.find((u) => u.id === id)!;
  type Rolled = Extract<GameEvent, { type: 'DiceRolled' }>;
  const rolled = (events: GameEvent[]) => events.find((e): e is Rolled => e.type === 'DiceRolled')!;

  it('offers a war cry to a Leader on its feet, and to no one else', () => {
    const s = acting(config(), 'p0u0');
    expect(has(getLegalCommands(s), (c) => c.type === 'WarCry' && c.unitId === 'p0u0')).toBe(true);
    expect(has(getLegalCommands(acting(config(), 'p0u1')), (c) => c.type === 'WarCry')).toBe(false);
    unit(s, 'p0u0').knockedDown = true;
    expect(has(getLegalCommands(s), (c) => c.type === 'WarCry')).toBe(false);
    expect(() => reduce(s, warCry)).toThrow();
  });

  it('spends an action to inspire every non-Leader friend still to activate', () => {
    const s = acting(config(), 'p0u0');
    s.actionsRemaining = 2;
    unit(s, 'p0u2').activatedThisRound = true; // Bow has already had its roll
    const { state, events } = reduce(s, warCry);
    expect(events).toContainEqual({ type: 'WarCry', unitId: 'p0u0', inspired: ['p0u1'] });
    expect(state.actionsRemaining).toBe(1);
    expect(state.activeUnitId).toBe('p0u0');
    expect(unit(state, 'p0u1').inspired).toBe(true);
    expect(unit(state, 'p0u2').inspired).toBe(false);
    // Leaders never inspire each other, nor themselves; the foe is untouched.
    expect(unit(state, 'p0u3').inspired).toBe(false);
    expect(unit(state, 'p0u0').inspired).toBe(false);
    expect(unit(state, 'p1u0').inspired).toBe(false);
  });

  it('carries only 5 hexes, and only to friends in sight: terrain blocks it, friends do not', () => {
    // Leader at (1,2). A forest at (1,3) hides (1,4); (1,1) stands between the
    // Leader and (1,0) but doesn't block; (7,2) is out of range.
    const board = { width: 9, height: 5, blocked: [], terrain: { '1,3': { feature: 'forest' as const } } };
    const cfg: GameConfig = {
      seed: 1,
      board,
      warbands: [
        [
          { name: 'Captain', quality: 3, combat: 3, leader: true, pos: { x: 1, y: 2 } },
          { name: 'Near', quality: 4, combat: 3, pos: { x: 1, y: 1 } },
          { name: 'Behind', quality: 4, combat: 3, pos: { x: 1, y: 0 } },
          { name: 'Hidden', quality: 4, combat: 3, pos: { x: 1, y: 4 } },
          { name: 'Edge', quality: 4, combat: 3, pos: { x: 6, y: 2 } },
          { name: 'Far', quality: 4, combat: 3, pos: { x: 7, y: 2 } },
        ],
        [{ name: 'Foe', quality: 4, combat: 3, pos: { x: 8, y: 0 } }],
      ],
    };
    const grid = makeHexGrid(board);
    const leader = { x: 1, y: 2 };
    expect(grid.distance(leader, { x: 6, y: 2 })).toBe(5);
    expect(grid.distance(leader, { x: 7, y: 2 })).toBe(6);
    expect(grid.lineOfSight(leader, { x: 6, y: 2 })).toBe(true);
    expect(grid.lineOfSight(leader, { x: 1, y: 4 })).toBe(false);

    const { state, events } = reduce(acting(cfg, 'p0u0'), warCry);
    expect(events).toContainEqual({ type: 'WarCry', unitId: 'p0u0', inspired: ['p0u1', 'p0u2', 'p0u4'] });
    expect(unit(state, 'p0u3').inspired).toBe(false);
    expect(unit(state, 'p0u5').inspired).toBe(false);
  });

  it('can be cried only once a round, and ends the activation on the last action', () => {
    const s = acting(config(), 'p0u0');
    s.actionsRemaining = 2;
    const once = reduce(s, warCry).state;
    expect(has(getLegalCommands(once), (c) => c.type === 'WarCry')).toBe(false);
    expect(() => reduce(once, warCry)).toThrow();

    const last = reduce(acting(config(), 'p0u0'), warCry);
    expect(last.events.some((e) => e.type === 'ActivationEnded' && e.unitId === 'p0u0')).toBe(true);
    expect(last.state.activeUnitId).toBeNull();
  });

  it('is not offered after a turnover: a benched side has no one left to inspire', () => {
    const s = acting(config(), 'p0u0');
    s.benched[0] = true; // the Leader turned over but still has an action it earned
    expect(has(getLegalCommands(s), (c) => c.type === 'WarCry')).toBe(false);
    expect(() => reduce(s, warCry)).toThrow();
  });

  it("makes an inspired unit's first activation die a sure 6, spending the inspiration", () => {
    // Spear needs a 6: find a seed where its lone die would miss.
    for (let seed = 1; seed <= 200; seed++) {
      const s = createGame(config(seed));
      const plain = reduce(s, { type: 'ChooseActivation', unitId: 'p0u1', diceCount: 1 });
      if (rolled(plain.events).successes > 0) continue;

      unit(s, 'p0u1').inspired = true;
      const { state, events } = reduce(s, { type: 'ChooseActivation', unitId: 'p0u1', diceCount: 1 });
      expect(rolled(events)).toEqual({
        type: 'DiceRolled',
        unitId: 'p0u1',
        quality: 6,
        dice: [6],
        successes: 1,
        failures: 0,
        inspired: true,
      });
      expect(state.actionsRemaining).toBe(1);
      expect(unit(state, 'p0u1').inspired).toBe(false);
      // The die is still drawn, so the rest of the game rolls the same either way.
      expect(state.rngState).toBe(plain.state.rngState);
      return;
    }
    throw new Error('no seed fits');
  });

  it('only makes the first die sure: the others roll as usual', () => {
    const s = createGame(config(3));
    unit(s, 'p0u1').inspired = true;
    const plain = reduce(createGame(config(3)), { type: 'ChooseActivation', unitId: 'p0u1', diceCount: 3 });
    const { events } = reduce(s, { type: 'ChooseActivation', unitId: 'p0u1', diceCount: 3 });
    expect(rolled(events).dice).toEqual([6, ...rolled(plain.events).dice.slice(1)]);
  });

  it('lets a war cry and its inspiration lapse at the end of the round', () => {
    const s = acting(config(), 'p0u0');
    s.actionsRemaining = 2;
    let state = reduce(s, warCry).state;
    // Everyone else has already gone, so ending this activation ends the round.
    for (const u of state.units) if (u.id !== 'p0u0') u.activatedThisRound = true;
    state = reduce(state, { type: 'EndActivation' }).state;
    expect(state.round).toBe(2);
    expect(unit(state, 'p0u0').warCried).toBe(false);
    expect(unit(state, 'p0u1').inspired).toBe(false);
  });

  // --- A Leader's death ---

  /**
   * P0's Brute next to P1's Leader at the west edge. Seer sees the Leader;
   * Blind stands behind a rock (no line of sight); Downed lies knocked down.
   * Far units, out of sight range, keep one death from routing P1.
   */
  const deathConfig = (seed: number, victim: Partial<UnitSpec>): GameConfig => ({
    seed,
    board: { width: 9, height: 5, terrain: { '2,2': { feature: 'rock' } } },
    warbands: [
      [{ name: 'Brute', quality: 3, combat: 5, pos: { x: 1, y: 2 } }],
      [
        { name: 'Leader', quality: 4, combat: 1, pos: { x: 0, y: 2 }, ...victim },
        { name: 'Seer', quality: 6, combat: 3, pos: { x: 0, y: 4 } },
        { name: 'Blind', quality: 6, combat: 3, pos: { x: 4, y: 2 } },
        { name: 'Downed', quality: 6, combat: 3, pos: { x: 0, y: 0 } },
        { name: 'Far', quality: 4, combat: 3, pos: { x: 8, y: 0 } },
        { name: 'Far', quality: 4, combat: 3, pos: { x: 8, y: 4 } },
      ],
    ],
  });

  /** The first seed whose opening blow kills the victim without a gruesome kill, and passes `pick`. */
  function kill(victim: Partial<UnitSpec>, pick: (events: GameEvent[]) => boolean = () => true) {
    for (let seed = 1; seed <= 2000; seed++) {
      const s = acting(deathConfig(seed, victim), 'p0u0');
      unit(s, 'p1u3').knockedDown = true;
      unit(s, 'p1u1').inspired = true;
      const { state, events } = reduce(s, { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' });
      const hit = events.find((e) => e.type === 'AttackResolved');
      if (hit?.type !== 'AttackResolved' || hit.result !== 'defenderKilled' || hit.gruesome) continue;
      if (pick(events)) return { state, events };
    }
    throw new Error('no seed fits');
  }
  const tested = (events: GameEvent[]) => events.flatMap((x) => (x.type === 'NerveCheck' ? [x.unitId] : []));

  it('has every standing friend in sight and within war cry range test nerve when a Leader falls', () => {
    const board = makeHexGrid(createGame(deathConfig(1, {})).board);
    expect(board.lineOfSight({ x: 0, y: 2 }, { x: 0, y: 4 })).toBe(true);
    expect(board.lineOfSight({ x: 0, y: 2 }, { x: 4, y: 2 })).toBe(false);

    const { events } = kill({ leader: true });
    const fallen = events.findIndex((e) => e.type === 'LeaderFallen' && e.unitId === 'p1u0');
    expect(fallen).toBeGreaterThan(-1);
    const checks = tested(events.slice(fallen + 1));
    expect(checks).toContain('p1u1'); // Seer saw it
    expect(checks).not.toContain('p1u2'); // Blind, behind the rock
    expect(checks).not.toContain('p1u3'); // Downed
    expect(checks).not.toContain('p1u4'); // Far, out of range
    expect(checks).not.toContain('p1u5');
  });

  it('shakes no one when an ordinary unit dies an ordinary death', () => {
    const { events } = kill({});
    expect(events.some((e) => e.type === 'LeaderFallen')).toBe(false);
    expect(tested(events)).toEqual([]);
  });

  it('strips the inspiration of a friend who fails its nerve check', () => {
    const { state, events } = kill({ leader: true }, (evs) =>
      evs.some((e) => e.type === 'NerveCheck' && e.unitId === 'p1u1' && !e.passed),
    );
    const check = events.find((e) => e.type === 'NerveCheck' && e.unitId === 'p1u1');
    expect(check).toMatchObject({ passed: false, inspirationLost: true });
    expect(unit(state, 'p1u1').inspired).toBe(false);
  });

  it('keeps the inspiration of a friend who holds its nerve', () => {
    const { state, events } = kill({ leader: true }, (evs) =>
      evs.some((e) => e.type === 'NerveCheck' && e.unitId === 'p1u1' && e.passed),
    );
    expect(events.find((e) => e.type === 'NerveCheck' && e.unitId === 'p1u1')).not.toHaveProperty('inspirationLost');
    expect(unit(state, 'p1u1').inspired).toBe(true);
  });
});
