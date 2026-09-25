import { createGame, getLegalCommands, makeHexGrid, rollDice, type GameState, type Vec } from '@fansong/engine';
import { DEFAULT_SETUP } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import {
  activateUnit,
  findRngState,
  forceDice,
  forceOutcome,
  freshRound,
  nextUnitId,
  outcomeRule,
  paintHex,
  parseDicePattern,
  parseSandboxState,
  patchUnit,
  peekDice,
  removeUnit,
  resumeGame,
  spawnUnit,
  stuckReason,
  teleportUnit,
} from '../src/game/sandbox.js';
import { SandboxClient } from '../src/game/SandboxClient.js';
import { deleteSnapshot, loadAutosave, loadSnapshots, saveAutosave, saveSnapshot } from '../src/game/sandboxStore.js';

const FIGHTER = { name: 'Fighter', quality: 3, combat: 3 };

/** Two fighters, face to face on an empty 8x8 board. */
function duel(): { state: GameState; a: Vec; b: Vec } {
  const a = { x: 3, y: 3 };
  const b = makeHexGrid({ width: 8, height: 8, blocked: [] }).neighbors(a)[0]!;
  const state = createGame({
    seed: 1,
    board: { width: 8, height: 8 },
    warbands: [[{ ...FIGHTER, pos: a }], [{ ...FIGHTER, pos: b }]],
  });
  return { state, a, b };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('sandbox units', () => {
  it('spawns a unit with a fresh id and counts it toward the starting strength', () => {
    const { state } = duel();
    const s = spawnUnit(state, 0, { ...FIGHTER, name: 'Extra', flying: true }, { x: 0, y: 0 });
    const unit = s.units.at(-1)!;
    expect(unit).toMatchObject({ id: 'p0u1', owner: 0, name: 'Extra', pos: { x: 0, y: 0 } });
    expect(unit.traits.flying).toBe(true);
    expect(s.startCount).toEqual([2, 1]);
    expect(state.units).toHaveLength(2); // the input is untouched
  });

  it('refuses to spawn on an occupied or off-board hex', () => {
    const { state, a } = duel();
    expect(() => spawnUnit(state, 1, FIGHTER, a)).toThrow(/occupied/);
    expect(() => spawnUnit(state, 1, FIGHTER, { x: 99, y: 0 })).toThrow(/off the board/);
  });

  it('never reuses an id, even after a removal', () => {
    const { state } = duel();
    const s = removeUnit(spawnUnit(state, 0, FIGHTER, { x: 0, y: 0 }), 'p0u0');
    expect(nextUnitId(s, 0)).toBe('p0u2');
    expect(s.startCount[0]).toBe(1);
  });

  it('teleports and patches units', () => {
    const { state } = duel();
    const moved = teleportUnit(state, 'p0u0', { x: 0, y: 7 });
    expect(moved.units[0]!.pos).toEqual({ x: 0, y: 7 });
    const patched = patchUnit(moved, 'p0u0', { combat: 6, knockedDown: true, traits: { big: true } });
    expect(patched.units[0]).toMatchObject({ combat: 6, knockedDown: true });
    expect(patched.units[0]!.traits.big).toBe(true);
  });

  it('killing the acting unit ends its activation', () => {
    const { state } = duel();
    const s = patchUnit(activateUnit(state, 'p0u0', 2), 'p0u0', { dead: true });
    expect(s.phase).toBe('awaitingActivation');
    expect(s.activeUnitId).toBeNull();
  });
});

describe('sandbox turn flow', () => {
  it('hands a unit its actions without a roll', () => {
    const { state } = duel();
    const s = activateUnit(state, 'p1u0', 3);
    expect(s).toMatchObject({ phase: 'acting', active: 1, activeUnitId: 'p1u0', actionsRemaining: 3 });
    const legal = getLegalCommands(s);
    expect(legal.some((c) => c.type === 'Attack' && c.attackerId === 'p1u0')).toBe(true);
  });

  it('a fresh round gets a spent board moving again', () => {
    const { state } = duel();
    const spent = patchUnit(patchUnit(state, 'p0u0', { activatedThisRound: true }), 'p1u0', { activatedThisRound: true });
    expect(stuckReason(spent, getLegalCommands(spent).length)).toMatch(/no unit/);
    const fresh = freshRound(spent);
    expect(stuckReason(fresh, getLegalCommands(fresh).length)).toBeNull();
  });

  it('resumes a finished game', () => {
    const { state } = duel();
    const over = { ...state, phase: 'gameOver' as const, winner: 0 as const };
    expect(resumeGame(over)).toMatchObject({ phase: 'awaitingActivation', winner: null });
  });
});

describe('sandbox terrain', () => {
  it('paints elevation and features, and clears them again', () => {
    const { state } = duel();
    const s = paintHex(paintHex(state, { x: 0, y: 0 }, { elevation: 2 }), { x: 0, y: 0 }, { feature: 'forest' });
    expect(s.board.terrain?.['0,0']).toEqual({ elevation: 2, feature: 'forest' });
    const flat = paintHex(paintHex(s, { x: 0, y: 0 }, { elevation: 0 }), { x: 0, y: 0 }, { feature: null });
    expect(flat.board.terrain).toBeUndefined();
  });

  it("won't wall a unit in", () => {
    const { state, a } = duel();
    expect(() => paintHex(state, a, { blocked: true })).toThrow(/Move the unit/);
    expect(() => paintHex(state, a, { feature: 'rock' })).toThrow(/Move the unit/);
    expect(paintHex(state, a, { elevation: 1 }).board.terrain?.[`${a.x},${a.y}`]).toEqual({ elevation: 1 });
  });
});

describe('sandbox dice', () => {
  it('parses dice patterns', () => {
    expect(parseDicePattern('6 1, ? *')).toEqual([6, 1, null, null]);
    expect(() => parseDicePattern('7')).toThrow(/die face/);
  });

  it('finds an RNG state that rolls the wanted dice', () => {
    const pattern = [6, 6, null, 1];
    const s = findRngState(pattern, 12345);
    const { dice } = rollDice(s, 4);
    expect([dice[0], dice[1], dice[3]]).toEqual([6, 6, 1]);
  });

  it('forces the next activation roll', () => {
    const { state } = duel();
    const s = forceDice(state, [1, 1]);
    expect(peekDice(s, 2)).toEqual([1, 1]);
    const client = new SandboxClient(s, DEFAULT_SETUP);
    client.send({ type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 });
    expect(client.getState().benched[0]).toBe(true); // two failures: a turnover
    client.dispose();
  });
});

describe('sandbox forced outcomes', () => {
  const attack = { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' } as const;

  it.each(['combat-defenderKilled', 'combat-attackerKilled', 'combat-clash', 'combat-defenderRecoiled'])(
    'forces %s',
    (id) => {
      const s = activateUnit(duel().state, 'p0u0', 2);
      const rule = outcomeRule(id)!;
      const { result, status } = forceOutcome(s, attack, rule);
      expect(status.kind).toBe('forced');
      expect(rule.matches(result.events)).toBe(true);
    },
  );

  it('reports an outcome the modifiers rule out', () => {
    // Combat 0 against 9: the attacker's best (6) can never double the defender's worst (10).
    const s = patchUnit(patchUnit(activateUnit(duel().state, 'p0u0', 2), 'p0u0', { combat: 0 }), 'p1u0', { combat: 9 });
    const { status } = forceOutcome(s, attack, outcomeRule('combat-defenderKilled')!, 500);
    expect(status).toEqual({ kind: 'impossible', tries: 500 });
  });

  it("doesn't count a kill that Tough turns into a knockdown", () => {
    const s = patchUnit(activateUnit(duel().state, 'p0u0', 2), 'p0u0', { traits: { tough: true } });
    const { result, status } = forceOutcome(s, attack, outcomeRule('combat-attackerKilled')!, 2000);
    expect(status.kind).toBe('impossible');
    expect(result.state.units[0]!.dead).toBe(false);
  });

  it('waits out commands the rule is not about', () => {
    const s = activateUnit(duel().state, 'p0u0', 2);
    const { status } = forceOutcome(s, { type: 'EndActivation' }, outcomeRule('combat-defenderKilled')!);
    expect(status.kind).toBe('notApplicable');
  });

  it('the client forces an armed outcome once, then disarms', () => {
    const client = new SandboxClient(activateUnit(duel().state, 'p0u0', 2), DEFAULT_SETUP);
    client.arm({ ruleId: 'combat-defenderKilled', sticky: false });
    client.send(attack);
    expect(client.getState().units.find((u) => u.id === 'p1u0')!.dead).toBe(true);
    expect(client.info().armed).toBeNull();
    expect(client.info().lastForce?.status.kind).toBe('forced');
    client.dispose();
  });
});

describe('SandboxClient history', () => {
  it('undoes and redoes commands and edits alike', () => {
    const { state } = duel();
    const client = new SandboxClient(state, DEFAULT_SETUP);
    client.edit((s) => spawnUnit(s, 1, FIGHTER, { x: 0, y: 0 }));
    expect(client.getState().units).toHaveLength(3);
    client.send({ type: 'ChooseActivation', unitId: 'p0u0', diceCount: 1 });
    expect(client.getState().units[0]!.activatedThisRound).toBe(true);
    client.undo();
    client.undo();
    expect(client.getState()).toEqual(state);
    client.redo();
    expect(client.getState().units).toHaveLength(3);
    expect(client.info()).toMatchObject({ canUndo: true, canRedo: true });
    client.dispose();
  });

  it('an edit that throws changes nothing', () => {
    const { state, a } = duel();
    const client = new SandboxClient(state, DEFAULT_SETUP);
    expect(() => client.edit((s) => spawnUnit(s, 1, FIGHTER, a))).toThrow();
    expect(client.info().canUndo).toBe(false);
    client.dispose();
  });

  it('hands a seat to the AI', () => {
    const client = new SandboxClient(duel().state, DEFAULT_SETUP);
    expect(client.controlledSeats).toEqual([0, 1]);
    client.setAi(1, true);
    expect(client.controlledSeats).toEqual([0]);
    const before = client.getState();
    client.aiStep();
    expect(client.getState()).not.toEqual(before);
    expect(client.info().canUndo).toBe(true);
    client.dispose();
  });
});

describe('sandbox storage', () => {
  it('round-trips the autosave and named snapshots', () => {
    const storage = memoryStorage();
    const { state } = duel();
    expect(loadAutosave(storage)).toBeNull();
    saveAutosave(storage, state);
    expect(loadAutosave(storage)).toEqual(state);

    saveSnapshot(storage, 'first', state, 1);
    saveSnapshot(storage, 'second', state, 2);
    saveSnapshot(storage, 'first', state, 3); // same name: replaced
    expect(loadSnapshots(storage).map((s) => s.name)).toEqual(['first', 'second']);
    expect(deleteSnapshot(storage, 'first').map((s) => s.name)).toEqual(['second']);
  });

  it('rejects anything that is not a game state', () => {
    expect(() => parseSandboxState({ hello: 1 })).toThrow(/game state/);
    const { state } = duel();
    expect(parseSandboxState({ state })).toBe(state); // a snapshot wrapper is unwrapped
  });
});
