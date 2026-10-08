import { createGame } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import {
  enemyPoints,
  fieldedUnits,
  generateEncounter,
  legalRunActions,
  newRun,
  playerWarband,
  RUN_TUNING,
  runActionError,
  runBattleConfig,
  runMapLookup,
  runMatchSetup,
  runStep,
  runVictorious,
  validateArmy,
  validateMap,
  warbandCost,
  type RunAction,
  type RunState,
} from '../../src/index.js';
import { autoUntil, drafted, inBattle, playBattle } from './helpers.js';

/** Invariants of any run state. */
function checkState(s: RunState): void {
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  expect(s.gold).toBeGreaterThanOrEqual(0);
  expect(s.roster.length).toBeLessThanOrEqual(RUN_TUNING.rosterCap);
  expect(new Set(s.roster.map((u) => u.id)).size).toBe(s.roster.length);
  if (s.phase !== 'draft' && s.phase !== 'over') expect(validateArmy(playerWarband(s)).errors).toEqual([]);
  for (const u of s.roster) expect(u.level).toBeLessThanOrEqual(RUN_TUNING.xp.levels.length);
  if (s.battle) {
    expect(validateArmy(s.battle.enemy).errors).toEqual([]);
    expect(warbandCost(s.battle.enemy)).toBeLessThanOrEqual(enemyPoints(s.round));
    expect(validateMap(s.battle.map, s.battle.mode).errors).toEqual([]);
  }
  expect(Boolean(s.battle)).toBe(s.phase === 'briefing' || s.phase === 'battle');
}

/**
 * Play a run with the AI in both seats, taking legal action `pick` of those on
 * offer, until it is lost or `rounds` are won. Returns every state passed through.
 */
function playRun(seed: number, rounds: number, pick: (actions: RunAction[], step: number) => RunAction): RunState[] {
  let s = newRun(seed);
  const states = [s];
  for (let step = 0; step < 2000 && s.phase !== 'over' && s.round <= rounds; step++) {
    const action: RunAction = s.phase === 'battle' ? { type: 'battleResult', replay: playBattle(s) } : pick(legalRunActions(s), step);
    s = runStep(s, action);
    states.push(s);
  }
  return states;
}
const first = (actions: RunAction[]) => actions[0]!;
/** Anything legal, but never dithering in the briefing or the shop. */
const varied = (actions: RunAction[], step: number) => {
  const moving = actions.filter((a) => !['bench', 'setKing', 'sell', 'reroll'].includes(a.type));
  return moving[(step * 7 + 3) % moving.length]!;
};

describe('a run', () => {
  it('is the same for the same seed and the same choices', () => {
    for (const pick of [first, varied]) {
      const a = playRun(12, 2, pick);
      expect(playRun(12, 2, pick)).toEqual(a);
      expect(playRun(13, 2, pick).slice(0, 3)).not.toEqual(a.slice(0, 3));
    }
  });

  it('holds its invariants through every phase', () => {
    const seen = new Set<string>();
    let won = 0;
    for (let seed = 20; seed < 28; seed++) {
      const states = playRun(seed, 3, seed % 2 ? first : varied);
      for (const s of states) {
        checkState(s);
        seen.add(s.phase);
      }
      const last = states.at(-1)!;
      won += last.log.filter((r) => r.won).length;
      expect(last.log.map((r) => r.round)).toEqual(last.log.map((_, i) => i + 1));
      if (last.phase === 'over') {
        expect(last.log.at(-1)!.won).toBe(false);
        expect(legalRunActions(last)).toEqual([]);
      }
      // Gold only comes from winning.
      if (!last.log.some((r) => r.won)) expect(last.gold).toBe(0);
    }
    expect(won).toBeGreaterThan(0);
    expect([...seen].sort()).toEqual(['aftermath', 'battle', 'briefing', 'draft', 'over', 'reward', 'shop']);
  });

  it("meets the same enemies whatever the player's choices", () => {
    for (const round of [1, 2, 5]) {
      const a = generateEncounter(77, round, 4);
      const b = generateEncounter(77, round, 4);
      expect(a).toEqual(b);
    }
    const s = drafted(77);
    expect(s.battle).toEqual(generateEncounter(77, 1, s.roster.length));
    expect(drafted(77)).toEqual(s);
  });

  it('builds the battle once, so a battle left midway restarts the same', () => {
    const s = inBattle(31);
    const setup = runMatchSetup(s);
    expect(setup.seats).toEqual(['human', 'ai']);
    expect(setup.warbands![0]).toEqual(playerWarband(s));
    expect(setup.warbands![1]).toEqual(s.battle!.enemy);
    expect(runMapLookup(s)(setup.mapId!)).toEqual(s.battle!.map);
    expect(runMapLookup(s)('open-field')!.id).toBe('open-field');
    const saved = JSON.parse(JSON.stringify(s)) as RunState;
    expect(runBattleConfig(saved)).toEqual(runBattleConfig(s));
    const game = createGame(runBattleConfig(s));
    expect(game.units.filter((u) => u.owner === 0).map((u) => u.name)).toEqual(fieldedUnits(s).map((u) => u.unit.name));
    expect(() => runMatchSetup(drafted(31))).toThrow();
  });

  it('ends on a lost battle and goes to the aftermath on a won one', () => {
    let lost = 0;
    let won = 0;
    for (let seed = 40; seed < 52 && (lost === 0 || won === 0); seed++) {
      const s = inBattle(seed);
      const replay = playBattle(s);
      const next = runStep(s, { type: 'battleResult', replay });
      if (next.phase === 'over') {
        lost++;
        expect(next.log).toMatchObject([{ round: 1, won: false, gold: 0 }]);
        expect(next.roster).toEqual(s.roster);
        expect(runVictorious(next)).toBe(false);
      } else {
        won++;
        expect(next.phase).toBe('aftermath');
        expect(next.gold).toBeGreaterThan(0);
        expect(next.aftermath!.gold).toBe(next.gold);
        // A replay of some other battle is turned away.
        expect(() => runStep(inBattle(seed + 100), { type: 'battleResult', replay })).toThrow(/not of this round/);
        const shop = autoUntil(next, 'shop');
        const round2 = runStep(shop, { type: 'leaveShop' });
        expect([round2.round, round2.phase, round2.rolls]).toEqual([2, 'briefing', 0]);
        expect(round2.battle).toEqual(generateEncounter(seed, 2, round2.roster.length));
      }
    }
    expect([lost > 0, won > 0]).toEqual([true, true]);
  });

  it('counts the run as won once the victory round is beaten', () => {
    const s = newRun(1);
    expect(runVictorious(s)).toBe(false);
    const entry = { mode: 'annihilation' as const, enemy: 'x', boss: true, kills: 0, losses: 0, gold: 0 };
    expect(runVictorious({ ...s, log: [{ ...entry, round: RUN_TUNING.victoryRound, won: false }] })).toBe(false);
    expect(runVictorious({ ...s, log: [{ ...entry, round: RUN_TUNING.victoryRound, won: true }] })).toBe(true);
  });
});

describe('the briefing', () => {
  it('benches units, but always leaves someone to fight', () => {
    let s = drafted(8);
    const ids = s.roster.map((u) => u.id);
    for (const unitId of ids.slice(1)) s = runStep(s, { type: 'bench', unitId, benched: true });
    expect(fieldedUnits(s).map((u) => u.id)).toEqual([ids[0]]);
    expect(runActionError(s, { type: 'bench', unitId: ids[0]!, benched: true })).toMatch(/someone/);
    s = runStep(s, { type: 'bench', unitId: ids[1]!, benched: false });
    expect(fieldedUnits(s).map((u) => u.id)).toEqual(ids.slice(0, 2));
    expect(runStep(s, { type: 'startBattle' }).battle!.fielded).toEqual(ids.slice(0, 2));
  });

  it('keeps a unit that sits out off the field, unless nobody else is left', () => {
    const s = drafted(8);
    s.roster[0]!.sitsOut = true;
    expect(fieldedUnits(s).map((u) => u.id)).toEqual(s.roster.slice(1).map((u) => u.id));
    for (const u of s.roster) u.sitsOut = true;
    expect(fieldedUnits(s)).toHaveLength(s.roster.length);
  });

  it('lets the player choose a King on a boss round only', () => {
    const regular = drafted(8);
    expect(runActionError(regular, { type: 'setKing', unitId: regular.roster[0]!.id })).toMatch(/no King/);

    let s: RunState = { ...drafted(8), round: RUN_TUNING.enemy.bossEvery };
    s.battle = generateEncounter(s.seed, s.round, s.roster.length);
    expect(s.battle.mode).toBe('kill-the-king');
    const last = s.roster.at(-1)!;
    expect(runActionError(s, { type: 'setKing', unitId: 'nobody' })).not.toBeNull();
    const byDefault = runMatchSetup(runStep(s, { type: 'startBattle' }));
    expect(byDefault.kings![0]).toBe(0);
    expect(byDefault.kings![1]).toBe(s.battle.enemyKing);

    s = runStep(s, { type: 'setKing', unitId: last.id });
    const started = runStep(s, { type: 'startBattle' });
    expect(runMatchSetup(started).kings![0]).toBe(s.roster.length - 1);
    const game = createGame(runBattleConfig(started));
    expect(game.mode!.kings).toEqual([`p0u${s.roster.length - 1}`, `p1u${s.battle!.enemyKing}`]);
  });
});

describe('runStep', () => {
  it('throws on an action its phase does not allow, and leaves the state alone', () => {
    const s = drafted(5);
    const before = JSON.stringify(s);
    const wrong: RunAction[] = [
      { type: 'draftPick', index: 0 },
      { type: 'continue' },
      { type: 'reward', index: 0 },
      { type: 'leaveShop' },
      { type: 'reroll' },
      { type: 'advance', unitId: s.roster[0]!.id, index: 0 },
      { type: 'bench', unitId: 'nobody', benched: true },
    ];
    for (const action of wrong) {
      expect(() => runStep(s, action)).toThrow();
      expect(runActionError(s, action)).not.toBeNull();
    }
    runStep(s, { type: 'startBattle' });
    expect(JSON.stringify(s)).toBe(before);
    for (const action of legalRunActions(s)) expect(runActionError(s, action)).toBeNull();
  });
});
