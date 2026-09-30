import { describe, expect, it } from 'vitest';
import { diceHint } from '../src/ui/diceMenuView.js';

describe('dice menu', () => {
  it('promises an inspired unit a guaranteed action and the right turnover risk', () => {
    expect(diceHint(1, true)).toMatch(/sure 6/);
    // With the first die safe, two dice can fail at most once: no turnover.
    expect(diceHint(2, true)).toMatch(/never turn over/);
    expect(diceHint(3, true)).toMatch(/two failures/);
    expect(diceHint(2, false)).not.toMatch(/sure 6/);
  });
});
