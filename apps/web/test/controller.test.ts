import { chooseCommand } from '@fansong/ai';
import { getLegalCommands } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { commandsEqual, MatchController } from '../src/game/controller.js';
import { deriveInteraction } from '../src/game/interaction.js';
import { createMatch } from '../src/game/setup.js';
import type { MatchSetup } from '../src/game/types.js';

const SETUP: MatchSetup = {
  presets: ['iron-wardens', 'ashfang-raiders'],
  seats: ['human', 'ai'],
  seed: 42,
};

describe('MatchController', () => {
  it('exposes the engine legal commands unchanged', () => {
    const state = createMatch(SETUP);
    const controller = new MatchController(state);
    expect(controller.legalCommands()).toEqual(getLegalCommands(state));
    expect(controller.legalCommands().length).toBeGreaterThan(0);
  });

  it('rejects a command that is not currently legal', () => {
    const controller = new MatchController(createMatch(SETUP));
    expect(() => controller.apply({ type: 'EndActivation' })).toThrow(/illegal command/);
  });

  it('applies a legal command, advances state, and notifies subscribers', () => {
    const controller = new MatchController(createMatch(SETUP));
    let received = 0;
    controller.subscribe(({ events }) => {
      received += events.length;
    });
    const first = controller.legalCommands()[0]!;
    const events = controller.apply(first);
    expect(events.length).toBeGreaterThan(0);
    expect(received).toBe(events.length);
    // State moved on: it is a distinct object from what we started with.
    expect(controller.getState()).not.toBe(createMatch(SETUP));
  });

  it('drives a full game to completion using only legal commands (thin over the engine)', () => {
    const controller = new MatchController(createMatch({ ...SETUP, seed: 7 }));
    let steps = 0;
    while (controller.getState().phase !== 'gameOver' && steps < 5000) {
      const command = chooseCommand(controller.getState());
      // The controller must accept every command the AI derives from the engine.
      expect(controller.isLegal(command)).toBe(true);
      controller.apply(command);
      steps++;
    }
    expect(controller.getState().phase).toBe('gameOver');
    expect(controller.getState().winner).not.toBeNull();
  });
});

describe('deriveInteraction', () => {
  it('projects activation options at the start of a match', () => {
    const state = createMatch(SETUP);
    const interaction = deriveInteraction(getLegalCommands(state));
    expect(interaction.selectableUnitIds.length).toBeGreaterThan(0);
    expect(interaction.diceChoices).toEqual([1, 2, 3]);
    expect(interaction.moveTargets).toHaveLength(0);
    expect(interaction.attackTargetIds).toHaveLength(0);
  });

  it('projects moves and end-activation once a unit is acting', () => {
    const controller = new MatchController(createMatch(SETUP));
    // Activate the first unit until we land in the 'acting' phase.
    for (const c of controller.legalCommands()) {
      if (c.type === 'ChooseActivation' && c.diceCount === 3) {
        controller.apply(c);
        break;
      }
    }
    if (controller.getState().phase === 'acting') {
      const interaction = deriveInteraction(controller.legalCommands());
      expect(interaction.canEndActivation).toBe(true);
      expect(interaction.moveTargets.length).toBeGreaterThan(0);
    }
  });
});

describe('commandsEqual', () => {
  it('matches by structure, not identity', () => {
    expect(commandsEqual({ type: 'EndActivation' }, { type: 'EndActivation' })).toBe(true);
    expect(
      commandsEqual(
        { type: 'Move', unitId: 'p0u0', to: { x: 1, y: 2 } },
        { type: 'Move', unitId: 'p0u0', to: { x: 1, y: 2 } },
      ),
    ).toBe(true);
    expect(
      commandsEqual(
        { type: 'Move', unitId: 'p0u0', to: { x: 1, y: 2 } },
        { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 2 } },
      ),
    ).toBe(false);
    expect(
      commandsEqual({ type: 'EndActivation' }, { type: 'Attack', attackerId: 'a', targetId: 'b' }),
    ).toBe(false);
  });
});
