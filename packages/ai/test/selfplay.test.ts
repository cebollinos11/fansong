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
}

/** Play a full AI-vs-AI game, checking invariants at every step. */
function runGame(seed: number): RunResult {
  let state = createDemoGame(seed);
  const commands: Command[] = [];
  let steps = 0;

  while (state.phase !== 'gameOver' && steps < STEP_CAP) {
    const legal = getLegalCommands(state);
    expect(legal.length).toBeGreaterThan(0);

    const command = chooseCommand(state);
    // The AI only ever plays a legal command.
    expect(legal).toContainEqual(command);

    const prevRound = state.round;
    state = reduce(state, command).state;
    commands.push(command);
    steps++;

    assertInvariants(state, prevRound);
  }

  return { final: state, steps, rounds: state.round, commands };
}

function assertInvariants(state: GameState, prevRound: number): void {
  // Rounds never go backwards.
  expect(state.round).toBeGreaterThanOrEqual(prevRound);
  expect(state.actionsRemaining).toBeGreaterThanOrEqual(0);

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
    for (let seed = 1; seed <= 40; seed++) {
      const { final, steps } = runGame(seed);
      expect(final.phase).toBe('gameOver');
      expect(steps).toBeLessThan(STEP_CAP);
      expect(final.winner === 0 || final.winner === 1).toBe(true);
      // Exactly one side has living units at the end.
      const p0 = final.units.filter((u) => u.owner === 0 && !u.dead).length;
      const p1 = final.units.filter((u) => u.owner === 1 && !u.dead).length;
      expect(p0 === 0 || p1 === 0).toBe(true);
      expect(p0 === 0 && p1 === 0).toBe(false);
    }
  });

  it('is fully deterministic for a given seed (golden replay)', () => {
    const a = runGame(42);
    const b = runGame(42);
    expect(a.commands).toEqual(b.commands);
    expect(a.final).toEqual(b.final);
    expect(a.final.winner).toBe(b.final.winner);
  });
});
