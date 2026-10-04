import { describe, expect, it } from 'vitest';
import {
  createGame,
  getLegalCommands,
  makeHexGrid,
  reduce,
  resolveCombatMorale,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
  type HexTerrain,
  type Unit,
  type UnitSpec,
} from '../src/index.js';

/**
 * The pincer every unit gets, the positional traits (Shieldwall, Rusher, Slippery, Whirling,
 * Immovable, Woodwise, Trample) and the drawbacks (Dumb, Disloyal, Bad Balance).
 *
 * Fights are laid out down one column: on a flat-top grid `(x, y)`, `(x, y+1)`
 * and `(x, y+2)` are a straight line, so a push goes straight down it.
 */

type Attack = Extract<GameEvent, { type: 'AttackResolved' }>;

const SEEDS = 400;

function config(p0: UnitSpec[], p1: UnitSpec[], seed = 1, board: Partial<GameConfig['board']> = {}): GameConfig {
  return { seed, board: { width: 7, height: 9, ...board }, warbands: [p0, p1] };
}

/** A state already mid-activation for `activeUnitId`, with `actions` in hand. */
function acting(cfg: GameConfig, activeUnitId = 'p0u0', actions = 1): GameState {
  const s = createGame(cfg);
  const u = s.units.find((x) => x.id === activeUnitId)!;
  s.active = u.owner;
  s.activeUnitId = activeUnitId;
  s.phase = 'acting';
  s.actionsRemaining = actions;
  u.activatedThisRound = true;
  return s;
}

function unit(s: GameState, id: string): Unit {
  return s.units.find((u) => u.id === id)!;
}

const strike: Command = { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' };

function attackEvent(events: GameEvent[]): Attack {
  return events.find((e): e is Attack => e.type === 'AttackResolved')!;
}

/** The first seed whose attack gives `result`, played out. */
function attackUntil(build: (seed: number) => GameConfig, result: Attack['result']) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const out = reduce(acting(build(seed)), strike);
    if (attackEvent(out.events).result === result) return out;
  }
  throw new Error(`no seed gives ${result}`);
}

const striker: UnitSpec = { name: 'Striker', quality: 3, combat: 3, pos: { x: 3, y: 2 } };
const foe: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 3, y: 3 } };

describe('Pincer (every unit)', () => {
  const friend: UnitSpec = { name: 'Friend', quality: 3, combat: 3, pos: { x: 3, y: 4 } };

  it('scores +1 with a standing friend on the hex directly opposite the target', () => {
    const { events } = reduce(acting(config([striker, friend], [foe])), strike);
    expect(attackEvent(events).attackPincer).toBe(1);
  });

  it('gets nothing from a friend that is not directly opposite, or is knocked down', () => {
    const aside = { ...friend, pos: { x: 4, y: 3 } };
    const off = reduce(acting(config([striker, aside], [foe])), strike);
    expect(attackEvent(off.events).attackPincer).toBeUndefined();

    const s = acting(config([striker, friend], [foe]));
    unit(s, 'p0u1').knockedDown = true;
    expect(attackEvent(reduce(s, strike).events).attackPincer).toBeUndefined();
  });

  it('lapses while the striker is knocked down', () => {
    const s = acting(config([striker, friend], [foe]));
    unit(s, 'p0u0').knockedDown = true;
    expect(attackEvent(reduce(s, strike).events).attackPincer).toBeUndefined();
  });
});

describe('Shieldwall trait', () => {
  const wall: UnitSpec = { ...foe, shieldwall: true };
  const mate: UnitSpec = { name: 'Mate', quality: 3, combat: 3, pos: { x: 3, y: 4 } };

  it('scores +1 defending against an attack beside a standing friend', () => {
    const { events } = reduce(acting(config([striker], [wall, mate])), strike);
    expect(attackEvent(events).defenseShieldwall).toBe(1);
  });

  it('gets nothing alone, or beside a knocked-down friend', () => {
    expect(attackEvent(reduce(acting(config([striker], [wall])), strike).events).defenseShieldwall).toBeUndefined();
    const s = acting(config([striker], [wall, mate]));
    unit(s, 'p1u1').knockedDown = true;
    expect(attackEvent(reduce(s, strike).events).defenseShieldwall).toBeUndefined();
  });

  it('does not help it when it is the one leaving contact', () => {
    // The Shieldwall unit walks away from the striker, who takes a free hack.
    const s = acting(config([striker], [wall, { ...mate, pos: { x: 4, y: 3 } }]), 'p1u0');
    const { events } = reduce(s, { type: 'Move', unitId: 'p1u0', to: { x: 3, y: 6 } });
    const hack = events.find((e) => e.type === 'FreeHackResolved')!;
    expect(hack).toBeDefined();
    expect((hack as { defenseShieldwall?: number }).defenseShieldwall).toBeUndefined();
  });
});

describe('Rusher trait', () => {
  const rusher: UnitSpec = { ...striker, rusher: true, pos: { x: 3, y: 0 } };

  it('scores +1 on the attack after a Move into contact, and only on that one', () => {
    // A sturdy foe, so the first blow is unlikely to remove it.
    const tank: UnitSpec = { ...foe, combat: 6, tough: true };
    for (let seed = 1; seed <= SEEDS; seed++) {
      let s = acting(config([rusher], [tank], seed), 'p0u0', 3);
      s = reduce(s, { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 2 } }).state;
      expect(s.rushed).toEqual(['p1u0']);
      const first = reduce(s, strike);
      expect(attackEvent(first.events).attackRusher).toBe(1);
      expect(first.state.rushed).toBeUndefined();
      if (first.state.phase !== 'acting' || first.state.activeUnitId !== 'p0u0') continue;
      if (!getLegalCommands(first.state).some((c) => c.type === 'Attack' && !c.power)) continue;
      const second = reduce(first.state, strike);
      expect(attackEvent(second.events).attackRusher).toBeUndefined();
      return;
    }
    throw new Error('no seed leaves the rusher a second attack');
  });

  it('gets nothing against a foe it was already touching', () => {
    const s = acting(config([{ ...rusher, pos: striker.pos }], [foe]));
    expect(attackEvent(reduce(s, strike).events).attackRusher).toBeUndefined();
  });

  it('forgets the charge when the activation ends', () => {
    let s = acting(config([rusher], [foe]), 'p0u0', 2);
    s = reduce(s, { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 2 } }).state;
    s = reduce(s, { type: 'EndActivation' }).state;
    expect(s.rushed).toBeUndefined();
  });
});

describe('Slippery trait', () => {
  const away: Command = { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 0 } };

  it('draws no free hack leaving contact', () => {
    const plain = reduce(acting(config([striker], [foe])), away);
    expect(plain.events.some((e) => e.type === 'FreeHackResolved')).toBe(true);

    const slippery = reduce(acting(config([{ ...striker, slippery: true }], [foe])), away);
    expect(slippery.events.some((e) => e.type === 'FreeHackResolved')).toBe(false);
    expect(unit(slippery.state, 'p0u0').pos).toEqual({ x: 3, y: 0 });
  });

  it('is hacked like anyone else while carrying a flag', () => {
    const cfg: GameConfig = {
      ...config([{ ...striker, slippery: true }], [foe]),
      mode: 'capture-the-flag',
      objectives: { flags: [{ x: 0, y: 0 }, { x: 6, y: 8 }] },
    };
    const s = acting(cfg);
    s.mode!.flags![1].carrier = 'p0u0';
    expect(reduce(s, away).events.some((e) => e.type === 'FreeHackResolved')).toBe(true);
  });
});

describe('Whirling trait', () => {
  const second: UnitSpec = { name: 'Second', quality: 3, combat: 3, pos: { x: 3, y: 4 } };

  it('is never outnumbered on its feet', () => {
    const plain = reduce(acting(config([striker, second], [foe])), strike);
    expect(attackEvent(plain.events).defenseOutnumbered).toBe(1);

    const whirling = reduce(acting(config([striker, second], [{ ...foe, whirling: true }])), strike);
    expect(attackEvent(whirling.events).defenseOutnumbered).toBeUndefined();
  });

  it('is outnumbered again once knocked down', () => {
    const s = acting(config([striker, second], [{ ...foe, whirling: true }]));
    unit(s, 'p1u0').knockedDown = true;
    expect(attackEvent(reduce(s, strike).events).defenseOutnumbered).toBe(1);
  });
});

describe('Immovable trait', () => {
  it('stays where it is, on its feet, when a blow would push it', () => {
    const { state, events } = attackUntil((seed) => config([striker], [{ ...foe, immovable: true }], seed), 'defenderRecoiled');
    expect(events.some((e) => e.type === 'UnitHeldGround' && e.unitId === 'p1u0')).toBe(true);
    expect(events.some((e) => e.type === 'UnitRecoiled')).toBe(false);
    expect(unit(state, 'p1u0').pos).toEqual(foe.pos);
    expect(unit(state, 'p1u0').knockedDown).toBe(false);
  });

  it('is not pushed off the map edge', () => {
    const edge = (seed: number) =>
      config([{ ...striker, pos: { x: 3, y: 7 } }], [{ ...foe, immovable: true, pos: { x: 3, y: 8 } }], seed);
    const { state } = attackUntil(edge, 'defenderRecoiled');
    expect(unit(state, 'p1u0').dead).toBe(false);
  });

  it('cannot also have Bad Balance', () => {
    expect(() => createGame(config([{ ...striker, immovable: true, badBalance: true }], [foe]))).toThrow();
  });
});

describe('Woodwise trait', () => {
  const woods = (at: string): Record<string, HexTerrain> => ({ [at]: { feature: 'forest' } });

  it('scores +1 attacking and defending in melee from a forest hex', () => {
    const atk = reduce(acting(config([{ ...striker, woodwise: true }], [foe], 1, { terrain: woods('3,2') })), strike);
    expect(attackEvent(atk.events).attackWoodwise).toBe(1);
    const def = reduce(acting(config([striker], [{ ...foe, woodwise: true }], 1, { terrain: woods('3,3') })), strike);
    expect(attackEvent(def.events).defenseWoodwise).toBe(1);
  });

  it('gets nothing in the open', () => {
    const { events } = reduce(acting(config([{ ...striker, woodwise: true }], [{ ...foe, woodwise: true }])), strike);
    expect(attackEvent(events).attackWoodwise).toBeUndefined();
    expect(attackEvent(events).defenseWoodwise).toBeUndefined();
  });

  it('counts on both sides of a shot', () => {
    const bow: UnitSpec = { ...striker, ranged: 5, woodwise: true, pos: { x: 3, y: 0 } };
    const target: UnitSpec = { ...foe, woodwise: true, pos: { x: 3, y: 4 } };
    const s = acting(config([bow], [target], 1, { terrain: { ...woods('3,0'), ...woods('3,4') } }));
    const { events } = reduce(s, { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
    const shot = events.find((e) => e.type === 'ShotResolved') as Extract<GameEvent, { type: 'ShotResolved' }>;
    expect(shot.attackWoodwise).toBe(1);
    expect(shot.defenseWoodwise).toBe(1);
  });
});

describe('Trample trait', () => {
  const trampler: UnitSpec = { ...striker, trample: true };

  it('pushes a foe two hexes', () => {
    const { state } = attackUntil((seed) => config([trampler], [foe], seed), 'defenderRecoiled');
    expect(unit(state, 'p1u0').pos).toEqual({ x: 3, y: 5 });
    expect(unit(state, 'p1u0').knockedDown).toBe(false);
  });

  it('stops after one hex at a standing friend of the foe', () => {
    const mate: UnitSpec = { name: 'Mate', quality: 3, combat: 3, pos: { x: 3, y: 5 } };
    const { state } = attackUntil((seed) => config([trampler], [foe, mate], seed), 'defenderRecoiled');
    expect(unit(state, 'p1u0').pos).toEqual({ x: 3, y: 4 });
    expect(unit(state, 'p1u0').knockedDown).toBe(false);
  });

  it('floors the foe on the first hex when the second is blocked', () => {
    const { state } = attackUntil((seed) => config([trampler], [foe], seed, { blocked: ['3,5'] }), 'defenderRecoiled');
    expect(unit(state, 'p1u0').pos).toEqual({ x: 3, y: 4 });
    expect(unit(state, 'p1u0').knockedDown).toBe(true);
  });

  it('kills a foe driven off the map on the second hex', () => {
    const cfg = (seed: number) =>
      config([{ ...trampler, pos: { x: 3, y: 6 } }], [{ ...foe, pos: { x: 3, y: 7 } }, { ...foe, name: 'Other', pos: { x: 0, y: 0 } }], seed);
    const { state, events } = attackUntil(cfg, 'defenderRecoiled');
    expect(events.some((e) => e.type === 'UnitPushedOff' && e.unitId === 'p1u0')).toBe(true);
    expect(unit(state, 'p1u0').dead).toBe(true);
  });

  it('does not make a shot push further', () => {
    const bow: UnitSpec = { ...trampler, ranged: 5, pos: { x: 3, y: 0 } };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { state, events } = reduce(acting(config([bow], [foe], seed)), { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' });
      const shot = events.find((e) => e.type === 'ShotResolved') as Extract<GameEvent, { type: 'ShotResolved' }>;
      if (shot.result !== 'defenderRecoiled') continue;
      expect(unit(state, 'p1u0').pos).toEqual({ x: 3, y: 4 });
      return;
    }
    throw new Error('no seed pushes the target with a shot');
  });
});

describe('Bad Balance trait', () => {
  const wobbly: UnitSpec = { ...foe, badBalance: true };

  it('is knocked down where a push lands it', () => {
    const { state, events } = attackUntil((seed) => config([striker], [wobbly], seed), 'defenderRecoiled');
    expect(unit(state, 'p1u0').pos).toEqual({ x: 3, y: 4 });
    expect(unit(state, 'p1u0').knockedDown).toBe(true);
    expect(events.some((e) => e.type === 'UnitKnockedDown' && e.unitId === 'p1u0')).toBe(true);
  });

  it('stays on its feet when a friend braces it', () => {
    const mate: UnitSpec = { name: 'Mate', quality: 3, combat: 3, pos: { x: 3, y: 4 } };
    const { state, events } = attackUntil((seed) => config([striker], [wobbly, mate], seed), 'defenderRecoiled');
    expect(events.some((e) => e.type === 'UnitSupported')).toBe(true);
    expect(unit(state, 'p1u0').knockedDown).toBe(false);
  });
});

describe('Dumb trait', () => {
  const dumb: UnitSpec = { ...striker, dumb: true };

  it('is offered at most two activation dice', () => {
    const s = createGame(config([dumb, { ...striker, name: 'Bright', pos: { x: 0, y: 0 } }], [foe]));
    const dice = (id: string) =>
      getLegalCommands(s).flatMap((c) => (c.type === 'ChooseActivation' && c.unitId === id ? [c.diceCount] : []));
    expect(dice('p0u0')).toEqual([1, 2]);
    expect(dice('p0u1')).toEqual([1, 2, 3]);
  });

  it('cannot be made to roll three', () => {
    const s = createGame(config([dumb], [foe]));
    expect(() => reduce(s, { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 3 })).toThrow();
  });
});

describe('Disloyal trait', () => {
  // A casualty with one Disloyal friend beside it; a lone enemy far away.
  const band = (traitor: Partial<UnitSpec> = {}): UnitSpec[] => [
    { name: 'Victim', quality: 4, combat: 3, pos: { x: 3, y: 3 } },
    { name: 'Turncoat', quality: 4, combat: 3, disloyal: true, pos: { x: 3, y: 4 }, ...traitor },
    { name: 'Loyal', quality: 2, combat: 3, pos: { x: 0, y: 8 } },
    { name: 'Loyal', quality: 2, combat: 3, pos: { x: 1, y: 8 } },
    { name: 'Loyal', quality: 2, combat: 3, pos: { x: 2, y: 8 } },
  ];
  const enemy: UnitSpec[] = [{ name: 'Enemy', quality: 3, combat: 3, pos: { x: 6, y: 0 } }];

  /** Kill the victim gruesomely on successive seeds until the Turncoat's nerve die is `die`. */
  function fearUntil(die: number, cfg: (seed: number) => GameConfig, prepare: (s: GameState) => void = () => {}) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createGame(cfg(seed));
      prepare(s);
      unit(s, 'p0u0').dead = true;
      const events: GameEvent[] = [];
      resolveCombatMorale(s, events, unit(s, 'p0u0'), makeHexGrid(s.board), true);
      const check = events.find((e) => e.type === 'NerveCheck' && e.unitId === 'p0u1') as { die: number };
      if (check.die === die) return { s, events };
    }
    throw new Error(`no seed rolls a ${die}`);
  }

  it('changes sides on a natural 1, where it stands, and has activated', () => {
    const { s, events } = fearUntil(1, (seed) => config(band(), enemy, seed));
    const turncoat = unit(s, 'p0u1');
    expect(events).toContainEqual({ type: 'UnitDefected', unitId: 'p0u1', to: 1 });
    expect(turncoat.owner).toBe(1);
    expect(turncoat.pos).toEqual({ x: 3, y: 4 });
    expect(turncoat.activatedThisRound).toBe(true);
    expect(events.some((e) => e.type === 'UnitFled' && e.unitId === 'p0u1')).toBe(false);
  });

  it('flees like anyone else on any other failed roll', () => {
    const { s, events } = fearUntil(2, (seed) => config(band(), enemy, seed));
    expect(unit(s, 'p0u1').owner).toBe(0);
    expect(events.some((e) => e.type === 'UnitDefected')).toBe(false);
  });

  it('a loyal unit never turns on a 1', () => {
    const { s } = fearUntil(1, (seed) => config(band({ disloyal: false }), enemy, seed));
    expect(unit(s, 'p0u1').owner).toBe(0);
  });

  it('a Leader that turns shakes the friends who see it', () => {
    const { events } = fearUntil(1, (seed) => config(band({ leader: true }), enemy, seed));
    const at = events.findIndex((e) => e.type === 'UnitDefected');
    const later = events.slice(at + 1).filter((e) => e.type === 'NerveCheck');
    expect(later.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'LeaderFallen')).toBe(false);
  });

  it('a King that turns hands its new side the game', () => {
    const cfg = (seed: number): GameConfig => ({
      ...config(band({ king: true }), [{ ...enemy[0]!, king: true }], seed),
      mode: 'kill-the-king',
    });
    const { s, events } = fearUntil(1, cfg);
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBe(1);
    expect(events).toContainEqual({ type: 'GameOver', winner: 1, reason: 'king' });
  });

  it('sends a flag it was carrying back to its base', () => {
    const cfg = (seed: number): GameConfig => ({
      ...config(band(), enemy, seed),
      mode: 'capture-the-flag',
      objectives: { flags: [{ x: 0, y: 0 }, { x: 6, y: 8 }] },
    });
    const { s, events } = fearUntil(1, cfg, (state) => {
      state.mode!.flags![1].carrier = 'p0u1';
    });
    expect(s.mode!.flags![1]).toEqual({ at: { x: 6, y: 8 }, carrier: null });
    expect(events).toContainEqual({ type: 'FlagReturned', player: 1, unitId: 'p0u1' });
    expect(events.some((e) => e.type === 'FlagDropped')).toBe(false);
  });

  it('leaves its place in a group activation', () => {
    const { s } = fearUntil(1, (seed) => config(band(), enemy, seed), (state) => {
      state.group = { pending: [{ unitId: 'p0u1', actions: 2 }], allotted: 2 };
    });
    expect(s.group!.pending).toEqual([]);
  });

  it('can break the side it left', () => {
    // Three units: the casualty and the defection leave one, at the break point.
    const trio = band().slice(0, 3);
    const { s, events } = fearUntil(1, (seed) => config(trio, enemy, seed));
    expect(events.some((e) => e.type === 'WarbandBroken' && e.player === 0)).toBe(true);
    expect(s.broken[0]).toBe(true);
  });
});
