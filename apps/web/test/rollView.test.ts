import type { GameEvent } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { describeActivation, describeCombat, describeNerve, signed } from '../src/ui/rollView.js';

type Attack = Extract<GameEvent, { type: 'AttackResolved' }>;

function attack(over: Partial<Attack>): Attack {
  return {
    type: 'AttackResolved',
    attackerId: 'a',
    targetId: 'd',
    attackDie: 4,
    defenseDie: 2,
    attackScore: 7,
    defenseScore: 5,
    result: 'defenderKnockedDown',
    ...over,
  };
}

describe('opposed roll cards', () => {
  it('splits each total into die, Combat and high ground', () => {
    const r = describeCombat(attack({ attackScore: 8, attackBonus: 1 }));
    expect(r.a).toMatchObject({ unitId: 'a', role: 'Attack', die: 4, total: 8, outcome: 'win' });
    expect(r.a.mods).toEqual([
      { label: 'Combat', value: 3 },
      { label: 'High ground', value: 1 },
    ]);
    expect(r.b).toMatchObject({ unitId: 'd', role: 'Defend', die: 2, total: 5, outcome: 'lose' });
    expect(r.b.mods).toEqual([{ label: 'Combat', value: 3 }]);
    expect(r.verdict).toEqual({ text: 'Knocked down', detail: '8 beats 5', on: ['d'], tone: 'down' });
  });

  it('calls a doubled score a kill, and a Tough save a knockdown', () => {
    const kill = attack({ attackScore: 10, defenseScore: 5, result: 'defenderKilled' });
    expect(describeCombat(kill).verdict).toMatchObject({ text: 'Slain!', detail: '10 doubles 5', tone: 'kill' });
    const saved = describeCombat(kill, [{ type: 'ToughnessSaved', unitId: 'd' }]).verdict;
    expect(saved).toMatchObject({ text: 'Tough!', on: ['d'], tone: 'save' });
  });

  it('notes an already-down defender dying to a mere win', () => {
    const r = describeCombat(attack({ result: 'defenderKilled' }));
    expect(r.verdict.detail).toBe('7 beats 5 — already down');
  });

  it('puts a defender win on the attacker', () => {
    const r = describeCombat(attack({ attackScore: 4, defenseScore: 6, result: 'attackerKnockedDown' }));
    expect(r.a.outcome).toBe('lose');
    expect(r.b.outcome).toBe('win');
    expect(r.verdict).toMatchObject({ text: 'Knocked down', on: ['a'] });
  });

  it("calls a push back on the winner's odd die, and says why an odd die still knocked down", () => {
    const pushed = describeCombat(attack({ attackDie: 3, result: 'defenderRecoiled' }));
    expect(pushed.verdict).toEqual({ text: 'Pushed back', detail: '7 beats 5 on an odd 3', on: ['d'], tone: 'down' });
    const cornered = describeCombat(attack({ attackDie: 3, result: 'defenderKnockedDown' }));
    expect(cornered.verdict.detail).toBe('7 beats 5 — no room to fall back');
    const back = describeCombat(attack({ attackScore: 4, defenseScore: 6, defenseDie: 5, result: 'attackerRecoiled' }));
    expect(back.verdict).toMatchObject({ text: 'Pushed back', on: ['a'] });
  });

  it('says where a push ended: braced by a friend, or off the edge', () => {
    const push = attack({ attackDie: 3, result: 'defenderRecoiled' });
    const held = describeCombat(push, [{ type: 'UnitSupported', unitId: 'd', supporterId: 'f' }]).verdict;
    expect(held).toMatchObject({ text: 'Holds ground', on: ['d'], tone: 'save' });
    const off = describeCombat(push, [{ type: 'UnitPushedOff', unitId: 'd' }, { type: 'UnitKilled', unitId: 'd', byId: 'a' }]);
    expect(off.verdict).toMatchObject({ text: 'Pushed off!', on: ['d'], tone: 'kill' });
    const tough = describeCombat(push, [{ type: 'UnitPushedOff', unitId: 'd' }, { type: 'ToughnessSaved', unitId: 'd' }]);
    expect(tough.verdict).toMatchObject({ text: 'Tough!', tone: 'save' });
  });

  it('explains a knocked-down defender whose higher total did nothing', () => {
    const r = describeCombat(attack({ attackScore: 4, defenseScore: 6, result: 'clash' }));
    expect(r.b).toMatchObject({ outcome: 'tie', note: 'Down: only a 6 strikes back' });
    expect(r.verdict).toMatchObject({ text: 'Clash', on: ['a', 'd'], tone: 'neutral' });
  });

  it('never has a shot hurt the shooter', () => {
    const shot: GameEvent = {
      type: 'ShotResolved',
      attackerId: 'a',
      targetId: 'd',
      attackDie: 1,
      defenseDie: 6,
      attackScore: 3,
      defenseScore: 9,
      result: 'clash',
    };
    const r = describeCombat(shot);
    expect(r.a.role).toBe('Shoot');
    expect(r.b.note).toBe('No return fire');
    expect(r.verdict.text).toBe('Missed');
  });

  it('shows a riposte from the guard, and a failed one as the attack going through', () => {
    const riposte: GameEvent = {
      type: 'GuardRiposte',
      guardId: 'g',
      attackerId: 'a',
      guardDie: 1,
      attackerDie: 5,
      guardScore: 4,
      attackerScore: 8,
      // The guard losing the exchange costs it nothing, so the engine reports a
      // clash — the attack simply goes through.
      result: 'clash',
      prevented: false,
    };
    const r = describeCombat(riposte);
    expect(r.a).toMatchObject({ unitId: 'g', role: 'Riposte' });
    expect(r.b).toMatchObject({ unitId: 'a', outcome: 'tie', note: 'Guard is unhurt' });
    expect(r.verdict).toMatchObject({ text: 'Attack goes through', tone: 'neutral' });
  });

  it('lists outnumbering as its own modifier, leaving Combat intact', () => {
    const r = describeCombat(attack({ defenseScore: 4, defenseOutnumbered: 1 }));
    expect(r.b.mods).toEqual([
      { label: 'Combat', value: 3 },
      { label: 'Outnumbered', value: -1 },
    ]);
  });

  it('shows size as its own modifier on both sides of a melee', () => {
    const r = describeCombat(attack({ attackScore: 8, attackBig: 1 }));
    expect(r.a.mods).toEqual([
      { label: 'Combat', value: 3 },
      { label: 'Size', value: 1 },
    ]);
    expect(r.b.mods).toEqual([{ label: 'Combat', value: 3 }]);
  });

  it('credits a shot with the size of a Big target', () => {
    const shot: GameEvent = {
      type: 'ShotResolved',
      attackerId: 'a',
      targetId: 'd',
      attackDie: 5,
      defenseDie: 1,
      attackScore: 8,
      defenseScore: 4,
      bigTarget: 1,
      result: 'defenderRecoiled',
    };
    expect(describeCombat(shot).a.mods).toEqual([
      { label: 'Combat', value: 2 },
      { label: 'Big target', value: 1 },
    ]);
  });

  it('lists long range and cover on a shot', () => {
    const shot: GameEvent = {
      type: 'ShotResolved',
      attackerId: 'a',
      targetId: 'd',
      attackDie: 5,
      defenseDie: 1,
      attackScore: 5,
      defenseScore: 4,
      rangePenalty: 1,
      coverPenalty: 1,
      result: 'defenderRecoiled',
    };
    expect(describeCombat(shot).a.mods).toEqual([
      { label: 'Combat', value: 2 },
      { label: 'Long range', value: -1 },
      { label: 'Cover', value: -1 },
    ]);
  });

  it('names a power blow and puts its penalty on the defender', () => {
    const r = describeCombat(attack({ defenseScore: 4, powerPenalty: 1 }));
    expect(r.a.role).toBe('Power blow');
    expect(r.b.role).toBe('Defend');
    expect(r.b.mods).toEqual([
      { label: 'Combat', value: 3 },
      { label: 'Power blow', value: -1 },
    ]);
  });

  it('names an aimed shot and puts its penalty on the target', () => {
    const shot: GameEvent = {
      type: 'ShotResolved',
      attackerId: 'a',
      targetId: 'd',
      attackDie: 5,
      defenseDie: 1,
      attackScore: 7,
      defenseScore: 3,
      aimPenalty: 1,
      result: 'defenderKnockedDown',
    };
    const r = describeCombat(shot);
    expect(r.a.role).toBe('Aimed shot');
    expect(r.b.mods).toEqual([
      { label: 'Combat', value: 3 },
      { label: 'Aimed at', value: -1 },
    ]);
  });

  it('calls a tripled kill gruesome', () => {
    const r = describeCombat(attack({ attackScore: 9, defenseScore: 3, result: 'defenderKilled', gruesome: true }));
    expect(r.verdict).toEqual({ text: 'Gruesome!', detail: '9 triples 3', on: ['d'], tone: 'kill' });
  });

  it('shows a free hack at a unit leaving contact', () => {
    type Hack = Extract<GameEvent, { type: 'FreeHackResolved' }>;
    const hack = (over: Partial<Hack>): Hack => ({
      type: 'FreeHackResolved',
      attackerId: 'h',
      targetId: 'l',
      attackDie: 3,
      defenseDie: 2,
      attackScore: 6,
      defenseScore: 5,
      result: 'defenderRecoiled',
      ...over,
    });
    const slipped = describeCombat(hack({}));
    expect(slipped.a).toMatchObject({ unitId: 'h', role: 'Free hack' });
    expect(slipped.b).toMatchObject({ unitId: 'l', role: 'Leaving' });
    expect(slipped.verdict).toEqual({ text: 'Slips away', detail: '6 beats 5 on an odd 3', on: ['l'], tone: 'neutral' });
    const felled = describeCombat(hack({ attackDie: 4, attackScore: 7, result: 'defenderKnockedDown' }));
    expect(felled.verdict).toMatchObject({ text: 'Knocked down', on: ['l'] });
    const missed = describeCombat(hack({ attackScore: 4, defenseScore: 6, result: 'clash' }));
    expect(missed.b.note).toBe("Leaving: can't strike back");
    expect(missed.verdict.text).toBe('Gets away');
  });
});

describe('activation roll cards', () => {
  const rolled = (dice: number[], quality = 4): Extract<GameEvent, { type: 'DiceRolled' }> => {
    const successes = dice.filter((d) => d >= quality).length;
    return { type: 'DiceRolled', unitId: 'u', quality, dice, successes, failures: dice.length - successes };
  };

  it('marks each die against Quality and counts actions', () => {
    const r = describeActivation(rolled([5, 2, 4]));
    expect(r.dice.map((d) => d.success)).toEqual([true, false, true]);
    expect(r.summary).toBe('2 actions');
    expect(r.verdict).toBeNull();
  });

  it('charges an action to stand up', () => {
    expect(describeActivation(rolled([6, 4]), [{ type: 'UnitStoodUp', unitId: 'u' }]).summary).toBe(
      'Stands up (−1) · 1 action',
    );
  });

  it('announces a turnover', () => {
    const r = describeActivation(rolled([1, 2, 6]), [{ type: 'Turnover', player: 0, unitId: 'u' }]);
    expect(r.turnover).toBe(true);
    expect(r.summary).toBe('2 fails — turnover');
    expect(r.verdict).toMatchObject({ text: 'Turnover!', on: ['u'] });
  });
});

describe('nerve roll cards', () => {
  it('tells fear from a rout', () => {
    const e = { type: 'NerveCheck', unitId: 'u', quality: 4, die: 2, passed: false } as const;
    expect(describeNerve(e).summary).toBe('Shaken — knocked down');
    expect(describeNerve(e, [{ type: 'UnitRouted', unitId: 'u' }]).summary).toBe('Flees!');
    expect(describeNerve({ ...e, die: 5, passed: true }).summary).toBe('Holds firm');
  });
});

it('signs modifiers', () => {
  expect([signed(3), signed(0), signed(-1)]).toEqual(['+3', '+0', '−1']);
});
