import type { GameEvent } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { ACTIVATION_SEAM_MS, seamHoldMs, VERDICT_SEAM_MS } from '../src/game/seams.js';

/** Events by type alone: the seam only looks at what kind of thing happened. */
const events = (...types: GameEvent['type'][]): GameEvent[] => types.map((type) => ({ type }) as GameEvent);

describe('seamHoldMs', () => {
  const YOU = [0] as const;

  it("pauses after an opponent's activation, whoever acts next", () => {
    expect(seamHoldMs(events('AttackResolved', 'ActivationEnded'), 1, 1, YOU, 2000)).toBe(ACTIVATION_SEAM_MS);
    expect(seamHoldMs(events('UnitMoved', 'ActivationEnded'), 1, 0, YOU, 1500)).toBe(ACTIVATION_SEAM_MS);
  });

  it("pauses after the player's own activation when the opponent is up next", () => {
    expect(seamHoldMs(events('AttackResolved', 'ActivationEnded'), 0, 1, YOU, 2000)).toBe(ACTIVATION_SEAM_MS);
    // A roll with no successes passes play on without an activation to end.
    expect(seamHoldMs(events('ActivationChosen', 'DiceRolled', 'Turnover'), 0, 1, YOU, 1600)).toBe(ACTIVATION_SEAM_MS);
  });

  it("gives an opponent's blow a shorter beat when its unit carries on", () => {
    expect(seamHoldMs(events('AttackResolved', 'UnitKilled'), 1, 1, YOU, 2000)).toBe(VERDICT_SEAM_MS);
    expect(seamHoldMs(events('UnitMoved'), 1, 1, YOU, 1500)).toBe(0);
  });

  it("leaves the player's own chain of actions alone", () => {
    expect(seamHoldMs(events('AttackResolved'), 0, 0, YOU, 2000)).toBe(0);
    expect(seamHoldMs(events('ActivationChosen', 'DiceRolled'), 0, 0, YOU, 1600)).toBe(0);
    // Hotseat: every seat is the player's, so nothing is held.
    expect(seamHoldMs(events('AttackResolved', 'ActivationEnded'), 0, 1, [0, 1], 2000)).toBe(0);
  });

  it('adds nothing to a batch that was instant or skipped, or that ended the game', () => {
    expect(seamHoldMs(events('AttackResolved', 'ActivationEnded'), 1, 1, YOU, 0)).toBe(0);
    expect(seamHoldMs(events('AttackResolved', 'UnitKilled', 'GameOver'), 1, 1, YOU, 2000)).toBe(0);
  });
});
