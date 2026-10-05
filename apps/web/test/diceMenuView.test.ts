import { describe, expect, it } from 'vitest';
import { activationOdds, diceHint, groupHint, oddsLine } from '../src/ui/diceMenuView.js';

describe('dice menu', () => {
  it('promises an inspired unit a guaranteed action and the right turnover risk', () => {
    expect(diceHint(1, true)).toMatch(/sure 6/);
    // With the first die safe, two dice can fail at most once: no turnover.
    expect(diceHint(2, true)).toMatch(/never turn over/);
    expect(diceHint(3, true)).toMatch(/two failures/);
    expect(diceHint(2, false)).not.toMatch(/sure 6/);
  });

  it('spells out what a group shares on one roll', () => {
    expect(groupHint(2, 4, false)).toMatch(/Group of 4, 2 dice rolled once/);
    expect(groupHint(1, 3, false)).toMatch(/never turn over/);
    expect(groupHint(2, 3, false)).not.toMatch(/sure 6/);
    expect(groupHint(2, 3, true)).toMatch(/sure 6/);
  });

  it('quotes the chance to act and to turn over', () => {
    // Quality 4: each die is a coin flip.
    expect(activationOdds(1, 4, false)).toEqual({ act: 0.5, turnover: 0 });
    expect(activationOdds(2, 4, false)).toEqual({ act: 0.75, turnover: 0.25 });
    expect(activationOdds(3, 4, false)).toEqual({ act: 0.875, turnover: 0.5 });
    // Quality 3: two in three succeed; 3 dice fail twice or more 7 times in 27.
    expect(activationOdds(3, 3, false).turnover).toBeCloseTo(7 / 27);
    expect(oddsLine(2, 4, false)).toBe('2 dice · 75% to act · 25% turnover');
    expect(oddsLine(1, 4, false)).toBe('1 die · 50% to act · no turnover');
  });

  it("counts an inspired unit's sure 6 as a die that can't fail", () => {
    expect(activationOdds(2, 4, true)).toEqual({ act: 1, turnover: 0 });
    expect(activationOdds(3, 4, true)).toEqual({ act: 1, turnover: 0.25 });
    expect(oddsLine(1, 5, true)).toBe('1 die · sure to act · no turnover');
  });

  it('never rounds a slim chance to 0% or a near certainty to 100%', () => {
    // Quality 2, three dice: 215/216 to act.
    expect(oddsLine(3, 2, false)).toBe('3 dice · 99% to act · 7% turnover');
  });
});
