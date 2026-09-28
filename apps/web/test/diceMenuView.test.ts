import { describe, expect, it } from 'vitest';
import { diceHint, dicePips } from '../src/ui/diceMenuView.js';

describe('dice menu', () => {
  it('shows every die as still to roll for an uninspired unit', () => {
    expect(dicePips(3, false)).toEqual(['roll', 'roll', 'roll']);
  });

  it("marks an inspired unit's first die as the sure 6", () => {
    expect(dicePips(1, true)).toEqual(['sure']);
    expect(dicePips(3, true)).toEqual(['sure', 'roll', 'roll']);
  });

  it('promises an inspired unit a guaranteed action and the right turnover risk', () => {
    expect(diceHint(1, true)).toMatch(/sure 6/);
    // With the first die safe, two dice can fail at most once: no turnover.
    expect(diceHint(2, true)).toMatch(/never turn over/);
    expect(diceHint(3, true)).toMatch(/two failures/);
    expect(diceHint(2, false)).not.toMatch(/sure 6/);
  });
});
