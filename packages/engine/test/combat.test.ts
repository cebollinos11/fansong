import { describe, expect, it } from 'vitest';
import { computeCombatResult } from '../src/combat.js';

describe('combat result table', () => {
  it('kills the defender when the attacker doubles them', () => {
    expect(computeCombatResult(10, 5, false, false)).toBe('defenderKilled');
    expect(computeCombatResult(10, 4, false, false)).toBe('defenderKilled');
  });

  it('knocks the defender down on a plain win', () => {
    expect(computeCombatResult(7, 5, false, false)).toBe('defenderKnockedDown');
  });

  it('kills a defender who was already knocked down on a plain win', () => {
    expect(computeCombatResult(7, 5, true, false)).toBe('defenderKilled');
  });

  it('turns the tables: defender doubling kills the attacker', () => {
    expect(computeCombatResult(4, 8, false, false)).toBe('attackerKilled');
  });

  it('knocks the attacker down when the defender merely wins', () => {
    expect(computeCombatResult(5, 7, false, false)).toBe('attackerKnockedDown');
    expect(computeCombatResult(5, 7, false, true)).toBe('attackerKilled');
  });

  it('is a clash on a tie', () => {
    expect(computeCombatResult(6, 6, false, false)).toBe('clash');
  });
});
