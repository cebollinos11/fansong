import { describe, expect, it } from 'vitest';
import { createGame, type Command, type GameConfig, type GameState, type UnitSpec } from '@fansong/engine';
import { MatchController } from '../src/game/controller.js';
import { PlanRunner } from '../src/game/planRunner.js';

const config = (seed: number, p0: UnitSpec[], p1: UnitSpec[]): GameConfig => ({
  seed,
  board: { width: 11, height: 7 },
  warbands: [p0, p1],
});

/** Mid-activation for `p0u0` with `actions` in hand. */
function acting(c: GameConfig, actions: number): GameState {
  const s = createGame(c);
  s.active = 0;
  s.activeUnitId = 'p0u0';
  s.phase = 'acting';
  s.actionsRemaining = actions;
  s.units[0]!.activatedThisRound = true;
  return s;
}

/**
 * The narrowest client the runner needs, over a real controller — so every step
 * it sends is validated and reduced by the actual engine, not a stub.
 */
function harness(state: GameState) {
  const controller = new MatchController(state);
  const sent: Command[] = [];
  // A fake clock, so a poll costs nothing and a timeout arrives instantly.
  let clock = 0;
  const runner = new PlanRunner({
    client: {
      send: (c) => {
        sent.push(c);
        controller.apply(c);
      },
      getState: () => controller.getState(),
    },
    whenIdle: () => Promise.resolve(),
    delay: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  return { controller, sent, runner };
}

const mover: UnitSpec = { name: 'Mover', quality: 3, combat: 3, move: 3, pos: { x: 2, y: 3 } };
const far: UnitSpec = { name: 'Far', quality: 3, combat: 3, pos: { x: 10, y: 0 } };
const move = (to: { x: number; y: number }): Command => ({ type: 'Move', unitId: 'p0u0', to });

describe('PlanRunner', () => {
  it('sends a whole chain in order', async () => {
    const { controller, sent, runner } = harness(acting(config(1, [mover], [far]), 3));
    const steps = [move({ x: 5, y: 3 }), move({ x: 8, y: 3 })];

    await expect(runner.run(steps)).resolves.toEqual({ done: true, sent: 2 });
    expect(sent).toEqual(steps);
    expect(controller.getState().units[0]!.pos).toEqual({ x: 8, y: 3 });
    expect(controller.getState().actionsRemaining).toBe(1);
  });

  it('reports done when the last action ends the activation', async () => {
    const { controller, runner } = harness(acting(config(2, [mover], [far]), 2));
    const steps = [move({ x: 5, y: 3 }), move({ x: 8, y: 3 })];

    // Spending the final action auto-ends the activation, which is success, not
    // an interruption — the chain only judges the state *before* each send.
    await expect(runner.run(steps)).resolves.toEqual({ done: true, sent: 2 });
    expect(controller.getState().phase).toBe('awaitingActivation');
  });

  it('stops when a free hack cuts the walk short', async () => {
    // Seed 17: leaving contact with the brute at (4,3) knocks the mover down,
    // which strands it where it stood and ends its activation.
    const brute: UnitSpec = { name: 'Brute', quality: 3, combat: 6, pos: { x: 4, y: 3 } };
    const weak: UnitSpec = { name: 'Weak', quality: 3, combat: 1, move: 3, pos: { x: 3, y: 3 } };
    const pal: UnitSpec = { name: 'Pal', quality: 3, combat: 3, pos: { x: 0, y: 0 } };
    const spare: UnitSpec = { name: 'Spare', quality: 3, combat: 3, pos: { x: 10, y: 6 } };
    const { controller, sent, runner } = harness(acting(config(17, [weak, pal], [brute, spare]), 2));

    const outcome = await runner.run([move({ x: 2, y: 3 }), move({ x: 0, y: 3 })]);

    expect(outcome).toEqual({ done: false, sent: 1, reason: 'interrupted' });
    // The second leg was never sent, and the unit is still where it started.
    expect(sent).toHaveLength(1);
    expect(controller.getState().units[0]!.pos).toEqual({ x: 3, y: 3 });
    expect(controller.getState().units[0]!.knockedDown).toBe(true);
  });

  it('stops when the activation has ended before a later step', async () => {
    const { sent, runner } = harness(acting(config(3, [mover], [far]), 1));
    // One action in hand, two legs planned: the first spends it and the
    // activation ends, so the second is dropped rather than forced through.
    const outcome = await runner.run([move({ x: 5, y: 3 }), move({ x: 8, y: 3 })]);

    expect(outcome).toEqual({ done: false, sent: 1, reason: 'interrupted' });
    expect(sent).toHaveLength(1);
  });

  it('refuses a step that is not legal', async () => {
    const { sent, runner } = harness(acting(config(4, [mover], [far]), 2));
    // Far beyond one move, so the engine would reject it — the runner never
    // gets as far as `send`, so `applyCommand` never has to throw.
    const outcome = await runner.run([move({ x: 10, y: 6 })]);

    expect(outcome).toEqual({ done: false, sent: 0, reason: 'illegal' });
    expect(sent).toEqual([]);
  });

  it('stops before the next step when cancelled', async () => {
    const { controller, sent, runner } = harness(acting(config(5, [mover], [far]), 3));
    const steps = [move({ x: 5, y: 3 }), move({ x: 8, y: 3 })];

    const outcome = runner.run(steps);
    runner.cancel();

    await expect(outcome).resolves.toEqual({ done: false, sent: 1, reason: 'cancelled' });
    expect(sent).toHaveLength(1);
    // The unit keeps the action the cancelled leg would have spent.
    expect(controller.getState().actionsRemaining).toBe(2);
  });

  it('gives up on a client whose state never advances', async () => {
    const state = acting(config(6, [mover], [far]), 3);
    let clock = 0;
    const sent: Command[] = [];
    const runner = new PlanRunner({
      // A client that swallows commands, as a dropped connection would.
      client: { send: (c) => void sent.push(c), getState: () => state },
      whenIdle: () => Promise.resolve(),
      delay: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });

    const outcome = await runner.run([move({ x: 5, y: 3 }), move({ x: 8, y: 3 })]);

    expect(outcome).toEqual({ done: false, sent: 1, reason: 'timeout' });
    expect(sent).toHaveLength(1);
  });

  it('runs one chain at a time', async () => {
    const { runner } = harness(acting(config(7, [mover], [far]), 3));
    const first = runner.run([move({ x: 5, y: 3 })]);
    expect(runner.running).toBe(true);
    await expect(runner.run([move({ x: 4, y: 3 })])).resolves.toEqual({
      done: false,
      sent: 0,
      reason: 'cancelled',
    });
    await first;
    expect(runner.running).toBe(false);
  });
});
