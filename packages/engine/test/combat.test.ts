import { describe, expect, it } from 'vitest';
import { canStrikeBack, computeCombatResult } from '../src/combat.js';

describe('combat result table', () => {
  it('kills the defender when the attacker doubles them', () => {
    expect(computeCombatResult(10, 5, false, false, 3)).toBe('defenderKilled');
    expect(computeCombatResult(10, 4, false, false, 3)).toBe('defenderKilled');
  });

  it('knocks the defender down on a plain win', () => {
    expect(computeCombatResult(7, 5, false, false, 3)).toBe('defenderKnockedDown');
  });

  it('kills a defender who was already knocked down on a plain win', () => {
    expect(computeCombatResult(7, 5, true, false, 3)).toBe('defenderKilled');
    expect(computeCombatResult(7, 5, true, false, 6)).toBe('defenderKilled'); // a 6 that still loses
  });

  it('turns the tables: defender doubling kills the attacker', () => {
    expect(computeCombatResult(4, 8, false, false, 3)).toBe('attackerKilled');
  });

  it('knocks the attacker down when the defender merely wins', () => {
    expect(computeCombatResult(5, 7, false, false, 3)).toBe('attackerKnockedDown');
    expect(computeCombatResult(5, 7, false, true, 3)).toBe('attackerKilled');
  });

  it('a knocked-down defender cannot hurt the attacker without a natural 6', () => {
    expect(computeCombatResult(5, 7, true, false, 5)).toBe('clash');
    expect(computeCombatResult(4, 12, true, false, 5)).toBe('clash');
    expect(computeCombatResult(5, 7, true, true, 5)).toBe('clash');
  });

  it('a knocked-down defender rolling a natural 6 that beats the attacker hurts as normal', () => {
    expect(computeCombatResult(5, 7, true, false, 6)).toBe('attackerKnockedDown');
    expect(computeCombatResult(4, 9, true, false, 6)).toBe('attackerKilled');
    expect(computeCombatResult(5, 7, true, true, 6)).toBe('attackerKilled');
  });

  it('is a clash on a tie', () => {
    expect(computeCombatResult(6, 6, false, false, 3)).toBe('clash');
    expect(computeCombatResult(8, 8, true, false, 6)).toBe('clash');
  });
});

describe('canStrikeBack', () => {
  it('a standing unit always can; a knocked-down one only on a natural 6', () => {
    for (let die = 1; die <= 6; die++) {
      expect(canStrikeBack(false, die)).toBe(true);
      expect(canStrikeBack(true, die)).toBe(die === 6);
    }
  });
});
