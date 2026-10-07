import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import { ROUT_FRACTION, type GameState, type Owner, type UnitTraits } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { BROKEN_HELP, INSPIRED_HELP, breaksAtHelp, TRAIT_HELP, WAR_CRY_HELP, armyName, leavePrompt, seatLabel, traitLine, traitTags, turnPhrase, waitingLine, warbandStatus } from '../src/ui/hudView.js';

const VS_AI: MatchSetup = {
  presets: ['iron-wardens-medium', 'ashfang-raiders-medium'],
  seats: ['human', 'ai'],
  seed: 42,
};
const HOTSEAT: MatchSetup = { ...VS_AI, seats: ['human', 'human'] };

/** Kill everything of `owner` past the first `keep` units. */
function reduceTo(state: GameState, owner: Owner, keep: number): GameState {
  let left = keep;
  return {
    ...state,
    units: state.units.map((u) => (u.owner !== owner ? u : left-- > 0 ? u : { ...u, dead: true })),
  };
}

describe('seatLabel', () => {
  it('names the AI seat and the local player in vs-AI play', () => {
    expect(seatLabel(VS_AI, [0], 0)).toBe('You');
    expect(seatLabel(VS_AI, [0], 1)).toBe('AI');
  });

  it('names the remote seat in online play', () => {
    expect(seatLabel(HOTSEAT, [1], 1)).toBe('You');
    expect(seatLabel(HOTSEAT, [1], 0)).toBe('Opponent');
  });

  it('falls back to the army names in hotseat, where both seats are yours', () => {
    // "You" on both sides tells the player nothing about which is which.
    expect(seatLabel(HOTSEAT, [0, 1], 0)).toBe('Iron Wardens');
    expect(seatLabel(HOTSEAT, [0, 1], 1)).toBe('Ashfang Raiders');
  });

  it('prefers an explicit roster name over the preset label', () => {
    const custom: MatchSetup = {
      ...HOTSEAT,
      presets: ['custom', 'custom'],
      warbands: [
        { name: 'My Lads', units: [{ name: 'A', quality: 4, combat: 3 }] },
        { name: 'Their Lads', units: [{ name: 'B', quality: 4, combat: 3 }] },
      ],
    };
    expect(seatLabel(custom, [0, 1], 0)).toBe('My Lads');
    expect(armyName(custom, 1)).toBe('Their Lads');
    // An unresolvable preset with no roster still gives the seat a label.
    expect(armyName({ ...HOTSEAT, presets: ['nope', 'nope'] }, 0)).toBeNull();
    expect(seatLabel({ ...HOTSEAT, presets: ['nope', 'nope'] }, [0, 1], 0)).toBe('Seat 0');
  });
});

describe('waitingLine', () => {
  const state = createMatchFromPresets(VS_AI);
  const mine = state.units.find((u) => u.owner === 0)!;
  const theirs = state.units.find((u) => u.owner === 1)!;
  const aiToAct: GameState = { ...state, active: 1 };

  it('names the opposing unit the board is playing out', () => {
    expect(waitingLine(VS_AI, [0], aiToAct, theirs.id)).toBe(`AI: ${theirs.name} acts…`);
    expect(waitingLine(HOTSEAT, [0], aiToAct, theirs.id)).toBe(`Opponent: ${theirs.name} acts…`);
  });

  it("says the player's own action is resolving", () => {
    expect(waitingLine(VS_AI, [0], aiToAct, mine.id)).toBe('Resolving…');
    expect(waitingLine(VS_AI, [0], { ...state, active: 0 }, '')).toBe('Resolving…');
  });

  it('only says the other side is thinking when nothing is playing', () => {
    expect(waitingLine(VS_AI, [0], aiToAct, null)).toBe('AI is thinking…');
    expect(waitingLine(HOTSEAT, [0], aiToAct, null)).toBe("Opponent's turn…");
  });
});

describe('turnPhrase', () => {
  it('special-cases "You" into "Your turn"', () => {
    expect(turnPhrase('You')).toBe('Your turn');
  });

  it("possessive-s's everything else", () => {
    expect(turnPhrase('Opponent')).toBe("Opponent's turn");
    expect(turnPhrase('AI')).toBe("AI's turn");
    expect(turnPhrase('Iron Wardens')).toBe("Iron Wardens's turn");
  });
});

describe('break help', () => {
  it('says breaking is a one-time nerve test, not the end of the battle', () => {
    expect(breaksAtHelp(1)).toMatch(/^Once it is down to 1 unit, /);
    expect(breaksAtHelp(2)).toMatch(/^Once it is down to 2 units, /);
    for (const text of [breaksAtHelp(2), BROKEN_HELP]) {
      expect(text).toContain('nerve check');
      expect(text).toContain('battle goes on');
    }
  });
});

describe('warbandStatus', () => {
  const fresh = createMatchFromPresets(VS_AI);
  const start = fresh.startCount[0];
  const threshold = Math.floor(start * ROUT_FRACTION);

  it('counts the living and stays quiet while the warband is healthy', () => {
    expect(warbandStatus(fresh, 0)).toEqual({ alive: start, benched: false, broken: false, breaksAt: null });
  });

  it('warns before the rout, not after it', () => {
    // Quiet while the break is still more than two casualties away...
    expect(warbandStatus(reduceTo(fresh, 0, threshold + 3), 0).breaksAt).toBeNull();
    // ...and warning once it is within reach.
    expect(warbandStatus(reduceTo(fresh, 0, threshold + 2), 0).breaksAt).toBe(threshold);
    expect(warbandStatus(reduceTo(fresh, 0, threshold + 1), 0).breaksAt).toBe(threshold);
  });

  it('drops the warning once the warband has broken, since the rout fires once', () => {
    const routed: GameState = { ...reduceTo(fresh, 0, threshold), broken: [true, false] };
    const status = warbandStatus(routed, 0);
    expect(status.broken).toBe(true);
    expect(status.breaksAt).toBeNull();
  });

  it('reports a benched warband', () => {
    expect(warbandStatus({ ...fresh, benched: [true, false] }, 0).benched).toBe(true);
  });
});

describe('traitTags', () => {
  const traits = (over: Partial<UnitTraits>) => ({
    traits: { slow: false, fast: false, ranged: 0, tough: false, guard: false, big: false, flying: false, reassembling: false, opportunist: false, savage: false, leader: false, armored: false, sharpshooter: false, mastery: false, shieldwall: false, rusher: false, slippery: false, whirling: false, immovable: false, woodwise: false, trample: false, dumb: false, disloyal: false, badBalance: false, magicUser: false, ...over },
  });

  it('says nothing for a plain unit', () => {
    expect(traitTags(traits({}))).toEqual([]);
    expect(traitLine(traits({}))).toBeNull();
  });

  it('names each ability, with the range spelled out', () => {
    expect(traitTags(traits({ ranged: 4, tough: true, guard: true, big: true })).map((t) => t.label)).toEqual([
      'Ranged 4',
      'Tough',
      'Guard',
      'Big',
    ]);
    expect(traitLine(traits({ tough: true }))).toBe('Tough');
  });

  it('names Slow and Fast first', () => {
    expect(traitLine(traits({ slow: true }))).toBe('Slow');
    expect(traitLine(traits({ fast: true, tough: true }))).toBe('Fast · Tough');
  });

  it('explains what each ability does', () => {
    for (const tag of traitTags(traits({ ranged: 2, tough: true, guard: true, big: true }))) {
      expect(tag.help.length).toBeGreaterThan(0);
    }
  });
});

describe('inspiration wording', () => {
  it('never promises that a sure 6 protects against a turnover', () => {
    for (const text of [INSPIRED_HELP, WAR_CRY_HELP, TRAIT_HELP.leader]) {
      expect(text).toMatch(/sure 6/);
      expect(text).toMatch(/two failures among .* still turn/);
    }
  });
});

describe('leavePrompt', () => {
  it('asks before a battle is thrown away, and says what is lost', () => {
    const state: GameState = { ...createMatchFromPresets(VS_AI), round: 4 };
    const prompt = leavePrompt(state);
    expect(prompt.title).toMatch(/\?$/);
    expect(prompt.detail).toContain('Round 4');
    expect(prompt.detail).toContain(`${state.units.length} units still standing`);
    expect(prompt.detail).toMatch(/no saving or resuming/);
  });

  it('counts only the living, and says "unit" of the last one', () => {
    const start = createMatchFromPresets(VS_AI);
    const oneEach = reduceTo(reduceTo(start, 0, 1), 1, 1);
    expect(leavePrompt(oneEach).detail).toContain('2 units still standing');
    expect(leavePrompt(reduceTo(oneEach, 1, 0)).detail).toContain('1 unit still standing');
  });
});
