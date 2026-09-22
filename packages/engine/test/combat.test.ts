import { describe, expect, it } from 'vitest';
import { canStrikeBack, computeCombatResult, type CombatSide } from '../src/combat.js';

/** A side with an even natural die (knockdown on a plain win) and room to recoil unless overridden. */
const side = (score: number, o: Partial<CombatSide> = {}): CombatSide => ({
  score,
  die: 2,
  knockedDown: false,
  canRecoil: true,
  ...o,
});

describe('combat result table', () => {
  it('kills the defender when the attacker doubles them', () => {
    expect(computeCombatResult(side(10), side(5))).toBe('defenderKilled');
    expect(computeCombatResult(side(10, { die: 3 }), side(4))).toBe('defenderKilled');
  });

  it("on a plain win the winner's natural die decides: even knocks down, odd pushes back", () => {
    expect(computeCombatResult(side(7, { die: 4 }), side(5))).toBe('defenderKnockedDown');
    expect(computeCombatResult(side(7, { die: 3 }), side(5))).toBe('defenderRecoiled');
    expect(computeCombatResult(side(5), side(7, { die: 4 }))).toBe('attackerKnockedDown');
    expect(computeCombatResult(side(5), side(7, { die: 5 }))).toBe('attackerRecoiled');
  });

  it('a loser with no room to recoil falls instead', () => {
    expect(computeCombatResult(side(7, { die: 3 }), side(5, { canRecoil: false }))).toBe('defenderKnockedDown');
    expect(computeCombatResult(side(5, { canRecoil: false }), side(7, { die: 5 }))).toBe('attackerKnockedDown');
  });

  it('kills a loser who was already knocked down on a plain win, whatever the die', () => {
    expect(computeCombatResult(side(7), side(5, { knockedDown: true }))).toBe('defenderKilled');
    expect(computeCombatResult(side(7, { die: 3 }), side(5, { knockedDown: true, die: 6 }))).toBe('defenderKilled'); // a 6 that still loses
    expect(computeCombatResult(side(5, { knockedDown: true }), side(7, { die: 5 }))).toBe('attackerKilled');
  });

  it('turns the tables: defender doubling kills the attacker', () => {
    expect(computeCombatResult(side(4), side(8))).toBe('attackerKilled');
  });

  it('a knocked-down defender cannot hurt the attacker without a natural 6', () => {
    expect(computeCombatResult(side(5), side(7, { knockedDown: true, die: 5 }))).toBe('clash');
    expect(computeCombatResult(side(4), side(12, { knockedDown: true, die: 5 }))).toBe('clash');
    expect(computeCombatResult(side(5, { knockedDown: true }), side(7, { knockedDown: true, die: 5 }))).toBe('clash');
  });

  it('a knocked-down defender rolling a natural 6 that beats the attacker hurts as normal', () => {
    expect(computeCombatResult(side(5), side(7, { knockedDown: true, die: 6 }))).toBe('attackerKnockedDown');
    expect(computeCombatResult(side(4), side(9, { knockedDown: true, die: 6 }))).toBe('attackerKilled');
    expect(computeCombatResult(side(5, { knockedDown: true }), side(7, { knockedDown: true, die: 6 }))).toBe(
      'attackerKilled',
    );
  });

  it('is a clash on a tie', () => {
    expect(computeCombatResult(side(6), side(6))).toBe('clash');
    expect(computeCombatResult(side(8), side(8, { knockedDown: true, die: 6 }))).toBe('clash');
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
