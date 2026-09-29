import { describe, expect, it } from 'vitest';
import { armorHeld, canStrikeBack, computeCombatResult, masteryStruck, type CombatSide } from '../src/combat.js';

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

describe('Armored', () => {
  const armored = (score: number, o: Partial<CombatSide> = {}) => side(score, { armored: true, ...o });

  it('turns a loss by exactly 1 into a clash, whatever it would have cost', () => {
    expect(computeCombatResult(side(6, { die: 4 }), armored(5))).toBe('clash'); // knockdown
    expect(computeCombatResult(side(6, { die: 3 }), armored(5))).toBe('clash'); // push
    expect(computeCombatResult(side(2), armored(1))).toBe('clash'); // a double
    expect(computeCombatResult(armored(5), side(6, { die: 4 }))).toBe('clash');
    expect(armorHeld(side(6), armored(5))).toBe('defense');
    expect(armorHeld(armored(5), side(6))).toBe('attack');
  });

  it('holds for a knocked-down loser too', () => {
    expect(computeCombatResult(side(6), armored(5, { knockedDown: true }))).toBe('clash');
    expect(computeCombatResult(armored(5, { knockedDown: true }), side(6))).toBe('clash');
  });

  it('does nothing against a loss by 2 or more, or for the winner', () => {
    expect(computeCombatResult(side(7, { die: 4 }), armored(5))).toBe('defenderKnockedDown');
    expect(computeCombatResult(side(7), armored(5, { knockedDown: true }))).toBe('defenderKilled');
    expect(computeCombatResult(armored(6, { die: 4 }), side(5))).toBe('defenderKnockedDown');
    expect(armorHeld(armored(6), side(5))).toBeNull();
    expect(armorHeld(side(5), armored(5))).toBeNull();
  });

  it('is not needed against a knocked-down defender that cannot strike back', () => {
    expect(armorHeld(armored(5), side(6, { knockedDown: true, die: 5 }))).toBeNull();
    expect(armorHeld(armored(5), side(6, { knockedDown: true, die: 6 }))).toBe('attack');
  });
});

describe('Combat Mastery', () => {
  const master = (score: number, o: Partial<CombatSide> = {}) => side(score, { mastery: true, ...o });

  it("turns a tie into a kill of the foe without it, on either side", () => {
    expect(computeCombatResult(master(5), side(5))).toBe('defenderKilled');
    expect(computeCombatResult(side(5), master(5))).toBe('attackerKilled');
    expect(masteryStruck(master(5), side(5))).toBe('attack');
    expect(masteryStruck(side(5), master(5))).toBe('defense');
  });

  it('leaves a tie between two masters, or two plain units, a clash', () => {
    expect(computeCombatResult(master(5), master(5))).toBe('clash');
    expect(computeCombatResult(side(5), side(5))).toBe('clash');
    expect(masteryStruck(master(5), master(5))).toBeNull();
  });

  it('changes nothing about a roll that is not a tie', () => {
    expect(computeCombatResult(master(5), side(6, { die: 4 }))).toBe('attackerKnockedDown');
    expect(computeCombatResult(side(7, { die: 4 }), master(5))).toBe('defenderKnockedDown');
    expect(masteryStruck(master(6), side(5))).toBeNull();
  });

  it('needs a natural 6 when the master is knocked down', () => {
    expect(computeCombatResult(side(5), master(5, { knockedDown: true, die: 5 }))).toBe('clash');
    expect(computeCombatResult(side(5), master(5, { knockedDown: true, die: 6 }))).toBe('attackerKilled');
  });

  it('kills a knocked-down foe on a tie as readily as a standing one', () => {
    expect(computeCombatResult(master(5), side(5, { knockedDown: true }))).toBe('defenderKilled');
  });
});
