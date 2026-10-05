import type { GameEvent } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { describeActivation, describeCombat, describeNerve, modifierHelp, signed } from '../src/ui/rollView.js';

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

  it('calls a unit going into lava, pushed in or knocked out of the air', () => {
    const killed: GameEvent = { type: 'UnitKilled', unitId: 'd', byId: 'a' };
    const push = attack({ attackDie: 3, result: 'defenderRecoiled' });
    const pushed = describeCombat(push, [{ type: 'UnitPushedIntoLava', unitId: 'd', to: { x: 1, y: 1 } }, killed]);
    expect(pushed.verdict).toMatchObject({ text: 'Into the lava!', on: ['d'], tone: 'kill' });
    const down = attack({ attackDie: 4, result: 'defenderKnockedDown' });
    const fell = describeCombat(down, [{ type: 'UnitFellIntoLava', unitId: 'd' }, killed]);
    expect(fell.verdict).toMatchObject({ text: 'Into the lava!', detail: '7 beats 5 — knocked out of the air', tone: 'kill' });
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

  it("calls a master's tie a kill, naming the mastery", () => {
    const tie = attack({ attackScore: 6, defenseScore: 6, result: 'defenderKilled' });
    const r = describeCombat(tie, [{ type: 'MasteryStruck', unitId: 'a' }]);
    expect(r.a).toMatchObject({ outcome: 'win', note: 'Combat Mastery' });
    expect(r.b).toMatchObject({ outcome: 'lose' });
    expect(r.verdict).toEqual({ text: 'Mastery!', detail: "6 ties 6 — a master's tie kills", on: ['d'], tone: 'kill' });
    const saved = describeCombat(tie, [{ type: 'MasteryStruck', unitId: 'a' }, { type: 'ToughnessSaved', unitId: 'd' }]);
    expect(saved.verdict).toMatchObject({ text: 'Tough!', on: ['d'], tone: 'save' });
  });

  it('shows a guard cut down when an attacking master ties its riposte', () => {
    const riposte: GameEvent = {
      type: 'GuardRiposte',
      guardId: 'g',
      attackerId: 'a',
      guardDie: 3,
      attackerDie: 3,
      guardScore: 6,
      attackerScore: 6,
      result: 'attackerKilled',
      prevented: false,
    };
    const r = describeCombat(riposte, [{ type: 'MasteryStruck', unitId: 'a' }]);
    expect(r.a).toMatchObject({ unitId: 'g', outcome: 'lose' });
    expect(r.b).toMatchObject({ unitId: 'a', outcome: 'win', note: 'Combat Mastery' });
    expect(r.verdict).toMatchObject({ text: 'Mastery!', on: ['g'], tone: 'kill' });
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

  it('stamps a tripled blow or shot as a gruesome kill', () => {
    const r = describeCombat(attack({ attackScore: 9, defenseScore: 3, result: 'defenderKilled', gruesome: true }));
    expect(r.verdict).toEqual({ text: 'Gruesome Kill!', detail: '9 triples 3', on: ['d'], tone: 'kill', gruesome: true });
    const shot = describeCombat({
      type: 'ShotResolved',
      attackerId: 'a',
      targetId: 'd',
      attackDie: 6,
      defenseDie: 1,
      attackScore: 9,
      defenseScore: 3,
      result: 'defenderKilled',
      gruesome: true,
    });
    expect(shot.verdict).toMatchObject({ text: 'Gruesome Kill!', detail: '9 triples 3', gruesome: true });
  });

  it("stamps a Savage's merely doubled kill as gruesome, and says why", () => {
    const r = describeCombat(attack({ attackScore: 6, defenseScore: 3, result: 'defenderKilled', gruesome: true }));
    expect(r.verdict).toEqual({ text: 'Gruesome Kill!', detail: '6 doubles 3 — a savage kill', on: ['d'], tone: 'kill', gruesome: true });
  });

  it('stamps a savage shove that kills as gruesome, and says where it sent the victim', () => {
    const killed: GameEvent = { type: 'UnitKilled', unitId: 'd', byId: 'a' };
    const push = attack({ attackDie: 3, result: 'defenderRecoiled', gruesome: true });
    const off = describeCombat(push, [{ type: 'UnitPushedOff', unitId: 'd' }, killed]);
    expect(off.verdict).toMatchObject({ text: 'Gruesome Kill!', on: ['d'], gruesome: true });
    const lava = describeCombat(push, [{ type: 'UnitPushedIntoLava', unitId: 'd', to: { x: 1, y: 1 } }, killed]);
    expect(lava.verdict).toMatchObject({ text: 'Gruesome Kill!', gruesome: true });
    const down = attack({ result: 'defenderKnockedDown', gruesome: true });
    const fell = describeCombat(down, [{ type: 'UnitFellIntoLava', unitId: 'd' }, killed]);
    expect(fell.verdict).toMatchObject({ text: 'Gruesome Kill!', detail: '7 beats 5 — savagely knocked out of the air', gruesome: true });
  });

  it('never stamps a kill that Tough turned into a knockdown', () => {
    const r = describeCombat(attack({ attackScore: 9, defenseScore: 3, result: 'defenderKilled', gruesome: true }), [
      { type: 'ToughnessSaved', unitId: 'd' },
    ]);
    expect(r.verdict).toEqual({ text: 'Tough!', detail: '9 doubles 3 — knocked down instead', on: ['d'], tone: 'save' });
  });

  it("says an Armored loser's armor turned a 1-point loss aside", () => {
    const r = describeCombat(attack({ attackScore: 6, defenseScore: 5, result: 'clash' }), [{ type: 'ArmorHeld', unitId: 'd' }]);
    expect(r.b.note).toBe('Armor holds');
    expect(r.verdict).toEqual({ text: 'Armor holds!', detail: '6 beats 5 by only 1', on: ['d'], tone: 'save' });
  });

  it("names an Armored attacker's save, not a knocked-down defender's miss", () => {
    const r = describeCombat(attack({ attackScore: 5, defenseScore: 6, result: 'clash' }), [{ type: 'ArmorHeld', unitId: 'a' }]);
    expect(r.a.note).toBe('Armor holds');
    expect(r.b.note).toBeUndefined();
    expect(r.verdict).toEqual({ text: 'Armor holds!', detail: '6 beats 5 by only 1', on: ['a'], tone: 'save' });
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
    const r = describeActivation(rolled([1, 2]), [{ type: 'Turnover', player: 0, unitId: 'u' }]);
    expect(r.turnover).toBe(true);
    expect(r.summary).toBe('2 fails — turnover');
    expect(r.verdict).toMatchObject({ text: 'Turnover!', detail: 'benched for the round', on: ['u'] });
  });

  it('keeps the earned action on a turnover with a success', () => {
    const r = describeActivation(rolled([1, 2, 6]), [{ type: 'Turnover', player: 0, unitId: 'u' }]);
    expect(r.summary).toBe('2 fails — turnover · 1 action');
    expect(r.verdict).toMatchObject({ text: 'Turnover!', detail: 'benched after this activation' });
  });

  it("marks an inspired roll's first die as the war cry's sure 6", () => {
    const r = describeActivation({ ...rolled([6, 2]), quality: 6, successes: 1, failures: 1, inspired: true });
    expect(r.inspired).toBe(true);
    expect(r.dice).toEqual([
      { value: 6, success: true, inspired: true },
      { value: 2, success: false },
    ]);
    expect(describeActivation(rolled([6, 4])).inspired).toBe(false);
  });
});

describe('nerve roll cards', () => {
  it('tells running for the edge from leaving the field', () => {
    const e = { type: 'NerveCheck', unitId: 'u', quality: 4, die: 2, passed: false } as const;
    expect(describeNerve(e).summary).toBe('Flees!');
    expect(describeNerve(e, [{ type: 'UnitRouted', unitId: 'u' }]).summary).toBe('Flees the field!');
    expect(describeNerve({ ...e, die: 5, passed: true }).summary).toBe('Holds firm');
    expect(describeNerve({ ...e, inspirationLost: true }).summary).toBe('Flees! Inspiration lost');
  });
});

it('signs modifiers', () => {
  expect([signed(3), signed(0), signed(-1)]).toEqual(['+3', '+0', '−1']);
});

describe('modifier help', () => {
  it('explains every modifier a card can show', () => {
    const everything = [
      describeCombat(
        attack({
          attackScore: 20,
          defenseScore: 1,
          attackBonus: 1,
          attackBig: 1,
          attackFly: 1,
          attackOpportunist: 1,
          attackPincer: 1,
          attackRusher: 1,
          attackWoodwise: 1,
          attackOutnumbered: 1,
          powerPenalty: 1,
          defenseBonus: 1,
          defenseBig: 1,
          defenseOpportunist: 1,
          defenseShieldwall: 1,
          defenseWoodwise: 1,
          defenseOutnumbered: 1,
        }),
      ),
      describeCombat({
        type: 'ShotResolved',
        attackerId: 'a',
        targetId: 'd',
        attackDie: 4,
        defenseDie: 2,
        attackScore: 9,
        defenseScore: 3,
        result: 'defenderKnockedDown',
        attackBonus: 1,
        bigTarget: 1,
        flyingTarget: 1,
        attackOpportunist: 1,
        attackSharpshooter: 1,
        attackWoodwise: 1,
        rangePenalty: 1,
        coverPenalty: 1,
        defenseBonus: 1,
        defenseWoodwise: 1,
        aimPenalty: 1,
      }),
      describeCombat({
        type: 'GuardRiposte',
        guardId: 'g',
        attackerId: 'a',
        guardDie: 5,
        attackerDie: 2,
        guardScore: 9,
        attackerScore: 4,
        result: 'clash',
        guardPincer: 1,
        guardFly: 1,
        prevented: false,
      }),
    ];
    const labels = new Set(everything.flatMap((r) => [...r.a.mods, ...r.b.mods].map((m) => m.label)));
    expect(labels.size).toBeGreaterThan(15);
    for (const label of labels) expect(modifierHelp(label), label).toBeTruthy();
  });

  it('says what a pincer is, since no unit carries it', () => {
    expect(modifierHelp('Pincer')).toMatch(/directly opposite/);
    expect(modifierHelp('Nonsense')).toBeUndefined();
  });
});
