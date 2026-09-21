import { describe, expect, it } from 'vitest';
import {
  createDemoGame,
  getLegalCommands,
  reduce,
  vecKey,
  type Command,
  type GameState,
} from '@fansong/engine';
import { chooseCommand } from '../src/index.js';

const STEP_CAP = 20_000;

interface RunResult {
  final: GameState;
  steps: number;
  rounds: number;
  commands: Command[];
  /** Did morale ever fire (nerve check / warband break / rout) this game? */
  sawMorale: boolean;
}

/** Play a full AI-vs-AI game, checking invariants at every step. */
function runGame(seed: number): RunResult {
  let state = createDemoGame(seed);
  const startCount = state.startCount;
  const commands: Command[] = [];
  let steps = 0;
  let sawMorale = false;
  const broken: [boolean, boolean] = [false, false];

  while (state.phase !== 'gameOver' && steps < STEP_CAP) {
    const legal = getLegalCommands(state);
    expect(legal.length).toBeGreaterThan(0);

    const command = chooseCommand(state);
    // The AI only ever plays a legal command.
    expect(legal).toContainEqual(command);

    const prevRound = state.round;
    const { state: next, events } = reduce(state, command);
    state = next;
    commands.push(command);
    steps++;

    for (const e of events) {
      if (e.type === 'NerveCheck' || e.type === 'WarbandBroken' || e.type === 'UnitRouted') sawMorale = true;
    }

    assertInvariants(state, prevRound, startCount, broken);
  }

  return { final: state, steps, rounds: state.round, commands, sawMorale };
}

function assertInvariants(
  state: GameState,
  prevRound: number,
  startCount: readonly [number, number],
  broken: [boolean, boolean],
): void {
  // Rounds never go backwards.
  expect(state.round).toBeGreaterThanOrEqual(prevRound);
  expect(state.actionsRemaining).toBeGreaterThanOrEqual(0);

  // Morale bookkeeping: starting counts are immutable, a broken flag never
  // un-sets, and no side ever has more living units than it started with.
  expect(state.startCount).toEqual(startCount);
  for (const p of [0, 1] as const) {
    if (broken[p]) expect(state.broken[p]).toBe(true); // monotonic
    broken[p] = state.broken[p];
    expect(state.units.filter((u) => u.owner === p && !u.dead).length).toBeLessThanOrEqual(startCount[p]);
  }

  const occupied = new Set<string>();
  for (const u of state.units) {
    // Every unit stays on the board.
    expect(u.pos.x).toBeGreaterThanOrEqual(0);
    expect(u.pos.y).toBeGreaterThanOrEqual(0);
    expect(u.pos.x).toBeLessThan(state.board.width);
    expect(u.pos.y).toBeLessThan(state.board.height);
    // Dead units never act.
    if (u.dead) continue;
    // No two living units share a cell.
    const key = vecKey(u.pos);
    expect(occupied.has(key)).toBe(false);
    occupied.add(key);
  }

  // The activating unit, if any, is alive and belongs to the active player.
  if (state.activeUnitId) {
    const active = state.units.find((u) => u.id === state.activeUnitId);
    expect(active).toBeDefined();
    expect(active!.dead).toBe(false);
    expect(active!.owner).toBe(state.active);
  }
}

describe('AI-vs-AI self play', () => {
  it('terminates with a winner across many seeds, only ever playing legal moves', () => {
    let moraleGames = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { final, steps, sawMorale } = runGame(seed);
      expect(final.phase).toBe('gameOver');
      expect(steps).toBeLessThan(STEP_CAP);
      expect(final.winner === 0 || final.winner === 1).toBe(true);
      // Exactly one side has living units at the end.
      const p0 = final.units.filter((u) => u.owner === 0 && !u.dead).length;
      const p1 = final.units.filter((u) => u.owner === 1 && !u.dead).length;
      expect(p0 === 0 || p1 === 0).toBe(true);
      expect(p0 === 0 && p1 === 0).toBe(false);
      if (sawMorale) moraleGames++;
    }
    // The morale rules actually engage during AI-vs-AI play (not dead code).
    expect(moraleGames).toBeGreaterThan(0);
  });

  it('is fully deterministic for a given seed (golden replay)', () => {
    const a = runGame(42);
    const b = runGame(42);
    expect(a.commands).toEqual(b.commands);
    expect(a.final).toEqual(b.final);
    expect(a.final.winner).toBe(b.final.winner);
  });
});
