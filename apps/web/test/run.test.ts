import { describe, expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import { legalRunActions, newRun, runBattleConfig, runStep, RUN_TUNING, type RunAction, type RunPhase, type RunState } from '@fansong/content';
import { recordReplay } from '@fansong/engine';
import type { MapStorage } from '../src/game/customMaps.js';
import {
  addRunRecord,
  clearRun,
  loadRun,
  loadRunRecords,
  MAX_RUN_RECORDS,
  parseRun,
  RUN_KEY,
  RUN_RECORDS_KEY,
  runRecord,
  saveRun,
  type RunRecord,
} from '../src/game/runStore.js';
import {
  advanceChange,
  advanceInfo,
  aftermathView,
  briefingView,
  draftView,
  fateText,
  historyLines,
  levelLine,
  overView,
  recordLine,
  rewardView,
  runHeader,
  runMenuItem,
  runSeedFrom,
  shopView,
  unitView,
  woundInfo,
  type Choice,
} from '../src/ui/runView.js';

function memoryStorage(initial: Record<string, string> = {}): MapStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

/** Fight the battle phase's match with the AI in both seats. */
function fight(s: RunState): RunState {
  return runStep(s, { type: 'battleResult', replay: recordReplay(runBattleConfig(s), chooseCommand, 20_000) });
}

/** Take the first legal action of `type` (or the first of any) until the run reaches `phase`; fights its battles. */
function playTo(s: RunState, phase: RunPhase, prefer?: RunAction['type']): RunState {
  for (let i = 0; i < 500 && s.phase !== phase; i++) {
    if (s.phase === 'over') throw new Error(`the run ended before reaching ${phase}`);
    if (s.phase === 'battle') s = fight(s);
    else {
      const legal = legalRunActions(s);
      const next =
        legal.find((a) => a.type === prefer) ??
        legal.find((a) => ['startBattle', 'advance', 'continue', 'leaveShop'].includes(a.type)) ??
        legal[0]!;
      s = runStep(s, next);
    }
  }
  return s;
}

/** A seed whose first battle the AI wins from the player's seat, and the run just after that win. */
function wonRun(): RunState {
  for (let seed = 1; seed < 40; seed++) {
    const s = fight(playTo(newRun(seed), 'battle'));
    if (s.phase === 'aftermath') return s;
  }
  throw new Error('no seed wins its first battle');
}

/** A run that has lost a battle. */
function lostRun(): RunState {
  for (let seed = 1; seed < 20; seed++) {
    let s = newRun(seed);
    for (let i = 0; i < 2000 && s.phase !== 'over'; i++) s = s.phase === 'battle' ? fight(s) : playTo(s, 'battle');
    if (s.phase === 'over') return s;
  }
  throw new Error('no run ends');
}

const WON = wonRun();
const taken = (s: RunState, c: Choice): RunState => runStep(s, c.action);

describe('the saved run', () => {
  it('round-trips at every phase of a run', () => {
    const storage = memoryStorage();
    let s = newRun(7);
    const seen = new Set<RunPhase>();
    for (let i = 0; i < 400 && s.round < 3 && s.phase !== 'over'; i++) {
      seen.add(s.phase);
      expect(saveRun(storage, s)).toBe(true);
      expect(loadRun(storage)).toEqual(s);
      s = s.phase === 'battle' ? fight(s) : runStep(s, legalRunActions(s).find((a) => a.type !== 'reroll' && a.type !== 'sell' && a.type !== 'bench')!);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['draft', 'briefing', 'battle']));
  });

  it('carries on from a loaded run exactly as from the one saved', () => {
    const storage = memoryStorage();
    const battle = playTo(newRun(3), 'battle');
    saveRun(storage, battle);
    const loaded = loadRun(storage)!;
    // The battle restarts from the same setup: the same match, to the last die.
    expect(runBattleConfig(loaded)).toEqual(runBattleConfig(battle));
    expect(fight(loaded)).toEqual(fight(battle));
  });

  it('has no run for missing, cleared, corrupt or foreign storage, and never throws', () => {
    expect(loadRun(null)).toBeNull();
    expect(loadRun(memoryStorage())).toBeNull();
    expect(loadRun(memoryStorage({ [RUN_KEY]: '{not json' }))).toBeNull();
    expect(loadRun(memoryStorage({ [RUN_KEY]: '[]' }))).toBeNull();
    expect(loadRun(memoryStorage({ [RUN_KEY]: JSON.stringify({ ...newRun(1), version: 2 }) }))).toBeNull();
    const storage = memoryStorage();
    saveRun(storage, newRun(1));
    clearRun(storage);
    expect(loadRun(storage)).toBeNull();
    expect(saveRun(null, newRun(1))).toBe(false);
    const full: MapStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(saveRun(full, newRun(1))).toBe(false);
    expect(() => clearRun(full)).not.toThrow();
  });

  it('rejects a run whose pieces are not what they say', () => {
    const briefing = playTo(newRun(5), 'briefing');
    const broken: unknown[] = [
      { ...briefing, roster: [] },
      { ...briefing, roster: [{ ...briefing.roster[0], unit: { name: 'Ghost' } }] },
      { ...briefing, roster: [briefing.roster[0], briefing.roster[0]] },
      { ...briefing, battle: undefined },
      { ...briefing, battle: { ...briefing.battle, map: { id: 'x' } } },
      { ...briefing, phase: 'shop' },
      { ...briefing, phase: 'battle' },
      { ...briefing, phase: 'nowhere' },
      { ...briefing, gold: -1 },
      { ...briefing, log: 'none' },
      { ...newRun(5), offer: undefined },
    ];
    for (const run of broken) expect(() => parseRun(JSON.parse(JSON.stringify(run)))).toThrow();
    expect(parseRun(JSON.parse(JSON.stringify(briefing)))).toEqual(briefing);
  });

  it('does not offer a finished run to continue', () => {
    const storage = memoryStorage();
    saveRun(storage, lostRun());
    expect(loadRun(storage)).toBeNull();
  });
});

describe('run records', () => {
  const record = (wins: number, at: number): RunRecord => ({ seed: wins, wins, round: wins + 1, kills: 0, end: 'lost', victorious: false, at, roster: [] });

  it('describes a run that has ended', () => {
    const over = lostRun();
    const r = runRecord(over, 'lost', 99);
    expect(r).toMatchObject({ seed: over.seed, round: over.round, end: 'lost', at: 99, wins: over.round - 1, victorious: false });
    expect(r.roster).toEqual(over.roster.map((u) => u.unit.name));
  });

  it('keeps the best few, best first, the newer of equals ahead', () => {
    const storage = memoryStorage();
    addRunRecord(storage, record(2, 1));
    addRunRecord(storage, record(5, 2));
    expect(addRunRecord(storage, record(2, 3)).map((r) => [r.wins, r.at])).toEqual([[5, 2], [2, 3], [2, 1]]);
    for (let i = 0; i < MAX_RUN_RECORDS + 3; i++) addRunRecord(storage, record(10 + i, 10 + i));
    const kept = loadRunRecords(storage);
    expect(kept).toHaveLength(MAX_RUN_RECORDS);
    expect(kept[0]!.wins).toBe(10 + MAX_RUN_RECORDS + 2);
  });

  it('skips corrupt records and survives failing storage', () => {
    expect(loadRunRecords(null)).toEqual([]);
    expect(loadRunRecords(memoryStorage({ [RUN_RECORDS_KEY]: 'nope' }))).toEqual([]);
    expect(loadRunRecords(memoryStorage({ [RUN_RECORDS_KEY]: '{}' }))).toEqual([]);
    const mixed = JSON.stringify([record(1, 1), { seed: 'x' }, null, { ...record(3, 2), end: 'won' }, { ...record(4, 3), roster: [1, 'Wolf'] }]);
    expect(loadRunRecords(memoryStorage({ [RUN_RECORDS_KEY]: mixed })).map((r) => [r.wins, r.roster])).toEqual([[4, ['Wolf']], [1, []]]);
    expect(addRunRecord(null, record(1, 1))).toEqual([record(1, 1)]);
  });

  it('reads as a line', () => {
    expect(recordLine(record(1, 1))).toBe('1 battle won · fell in round 2 · seed 1');
    expect(recordLine({ ...record(6, 1), end: 'abandoned' })).toBe('6 battles won · given up in round 7 · seed 6');
  });
});

describe('the run screens', () => {
  it('heads every screen with the round, gold, roster and seed', () => {
    const s = newRun(42);
    expect(runHeader(s)).toMatchObject({ title: 'Draft your warband', round: 1, gold: 0, seed: 42, boss: false, roster: `0/${RUN_TUNING.rosterCap} units · 0 pts` });
    expect(runHeader({ ...playTo(s, 'briefing'), round: RUN_TUNING.enemy.bossEvery }).title).toBe('Boss battle');
  });

  it('drafts a leader, then troops, within the budget', () => {
    let s = newRun(11);
    const first = draftView(s)!;
    expect(first.stage).toBe('leader');
    expect(first.left).toBe(RUN_TUNING.draft.budget);
    expect(first.offers.every((o) => o.unit.leader && o.pick.error === null && o.cost <= first.left)).toBe(true);
    s = taken(s, first.offers[0]!.pick);
    const second = draftView(s)!;
    expect(second.stage).toBe('troop');
    expect(second.left).toBe(RUN_TUNING.draft.budget - first.offers[0]!.cost);
    expect(draftView(playTo(s, 'briefing'))).toBeNull();
  });

  it('briefs the battle: the enemy, the field, and who fights', () => {
    const s = playTo(newRun(11), 'briefing');
    const view = briefingView(s)!;
    expect(view.mode).toBe('Annihilation');
    expect(view.boss).toBe(false);
    expect(view.enemy.kinds.reduce((n, k) => n + k.count, 0)).toBe(view.enemy.count);
    // The field is drawn with this mode's objectives only: annihilation has none.
    expect(view.map).toEqual({ ...s.battle!.map, objectives: {} });
    const hill = briefingView({ ...s, battle: { ...s.battle!, mode: 'king-of-the-hill' } })!.map.objectives;
    expect(hill).toEqual({ hill: s.battle!.map.objectives.hill });
    expect(view.units).toHaveLength(s.roster.length);
    expect(view.units.every((u) => u.fielded && !u.king && u.crown === null && u.bench?.error === null)).toBe(true);
    expect(view.start.error).toBeNull();

    // Benching a unit takes it off the field, and it can be put back.
    const benched = taken(s, view.units[0]!.bench!);
    const after = briefingView(benched)!;
    expect(after.units[0]).toMatchObject({ fielded: false, view: { benched: true } });
    expect(after.units[0]!.bench!.action).toEqual({ type: 'bench', unitId: s.roster[0]!.id, benched: false });
    expect(after.fielded).toContain(`${s.roster.length - 1} unit`);

    // The last unit standing can't be benched: the rules say why, and the button carries it.
    let alone = s;
    for (const u of s.roster.slice(1)) alone = runStep(alone, { type: 'bench', unitId: u.id, benched: true });
    expect(briefingView(alone)!.units[0]!.bench!.error).toBe('someone has to fight');
  });

  it('crowns a King on a boss round', () => {
    const s = playTo(newRun(11), 'briefing');
    const boss: RunState = { ...s, battle: { ...s.battle!, mode: 'kill-the-king', enemyKing: 0 } };
    const view = briefingView(boss)!;
    expect(view.boss).toBe(true);
    expect(view.enemy.king).toBe(boss.battle!.enemy.units[0]);
    expect(view.units.filter((u) => u.king)).toHaveLength(1);
    const other = view.units.find((u) => !u.king)!;
    expect(other.crown!.error).toBeNull();
    const crowned = briefingView(taken(boss, other.crown!))!;
    expect(crowned.units.find((u) => u.king)!.view.id).toBe(other.view.id);
    // A King left on the bench passes the crown back to the default.
    const benched = briefingView(runStep(taken(boss, other.crown!), { type: 'bench', unitId: other.view.id, benched: true }))!;
    expect(benched.units.find((u) => u.king)!.view.id).not.toBe(other.view.id);
  });

  it('tells the battle\'s aftermath, and spends levels before moving on', () => {
    const view = aftermathView(WON)!;
    expect(view.gold).toBe(WON.aftermath!.gold);
    expect(view.lines).toHaveLength(WON.aftermath!.units.length);
    expect(view.lines.every((l) => l.text.length > 0)).toBe(true);
    let s = WON;
    for (let i = 0; i < 20 && aftermathView(s)!.levelUps.length > 0; i++) {
      const up = aftermathView(s)!.levelUps[0]!;
      expect(aftermathView(s)!.next.error).toBe('there are levels still to spend');
      expect(up.options.length).toBeGreaterThan(0);
      expect(up.options.every((o) => o.take.error === null && o.change.length > 0)).toBe(true);
      const before = s.roster.find((u) => u.id === up.view.id)!.level;
      s = taken(s, up.options[0]!.take);
      expect(s.roster.find((u) => u.id === up.view.id)!.level).toBe(before + 1);
    }
    expect(aftermathView(s)!.next.error).toBeNull();
    expect(taken(s, aftermathView(s)!.next).phase).toBe('reward');
  });

  it('words every fate', () => {
    const line = { unitId: 'u1', name: 'Wolf', kills: 0, xp: 1 };
    expect(fateText({ ...line, fate: 'survived' }).tone).toBe('ok');
    expect(fateText({ ...line, fate: 'fled' }).tone).toBe('ok');
    expect(fateText({ ...line, fate: 'turned' }).tone).toBe('lost');
    expect(fateText({ ...line, fate: 'fell', injury: 'dead' }).tone).toBe('lost');
    expect(fateText({ ...line, fate: 'fell', injury: 'sitsOut' }).tone).toBe('hurt');
    expect(fateText({ ...line, fate: 'fell', injury: 'recovered' }).tone).toBe('ok');
    expect(fateText({ ...line, fate: 'fell', injury: 'wound', wound: { kind: 'combat' } })).toEqual({
      text: 'Fell, and carries a lasting wound: Combat −1',
      tone: 'hurt',
    });
  });

  it('offers rewards that can all be taken, and only to units that can have them', () => {
    const s = playTo(WON, 'reward');
    const options = rewardView(s)!;
    expect(options).toHaveLength(s.offer?.kind === 'reward' ? s.offer.options.length : -1);
    for (const option of options) {
      if (option.take) expect(taken(s, option.take).phase).toBe('shop');
      else {
        expect(option.targets!.length).toBeGreaterThan(0);
        for (const t of option.targets!) expect(taken(s, t.give).phase).toBe('shop');
      }
    }
  });

  it('prices the shop from the rules, and greys out what gold can\'t buy', () => {
    const s = playTo(WON, 'shop');
    const view = shopView(s)!;
    expect(view.gold).toBe(s.gold);
    expect(view.leave.error).toBeNull();
    expect(view.units).toHaveLength(s.roster.length);
    for (const r of view.recruits) expect(r!.buy.error === null).toBe(r!.price <= s.gold);
    for (const u of view.upgrades) for (const t of u!.targets) expect(t.give.error === null).toBe(t.price! <= s.gold);
    expect(view.reroll.buy.error === null).toBe(view.reroll.price <= s.gold);
    expect(view.units.every((u) => u.sell.sell.error === null && u.heal === null)).toBe(true);

    // A rich warband buys a recruit: the slot empties and the roster grows.
    const rich = { ...s, gold: 999 };
    const bought = taken(rich, shopView(rich)!.recruits[0]!.buy);
    expect(shopView(bought)!.recruits[0]).toBeNull();
    expect(bought.roster).toHaveLength(s.roster.length + 1);
    // And an upgrade for a unit that can take it.
    const upgrade = shopView(rich)!.upgrades.find((u) => u && u.targets.length > 0);
    if (upgrade) expect(shopView(taken(rich, upgrade.targets[0]!.give))!.upgrades).toContain(null);
    // A wounded unit can be healed, at the shop's price.
    const hurt: RunState = { ...rich, roster: rich.roster.map((u, i) => (i === 0 ? { ...u, unit: { ...u.unit, slow: true as const }, wounds: [{ kind: 'trait', trait: 'slow' }] } : u)) };
    const healing = shopView(hurt)!;
    expect(healing.units[0]!.view.wounds.map((w) => w.label)).toEqual(['Slow']);
    expect(taken(hurt, healing.units[0]!.heal!).gold).toBe(hurt.gold - healing.healPrice);
    // The last unit can't be sold.
    const last = { ...s, roster: s.roster.slice(0, 1) };
    expect(shopView(last)!.units[0]!.sell.sell.error).toBe('the last unit cannot be sold');

    expect(taken(s, view.leave)).toMatchObject({ phase: 'briefing', round: 2 });
  });

  it('sums up a run that is over', () => {
    const over = lostRun();
    const view = overView(over);
    expect(view.headline).toBe(`Your warband fell in round ${over.round}`);
    expect(view.summary).toContain(`seed ${over.seed}`);
    const history = historyLines(over);
    expect(history).toHaveLength(over.round);
    expect(history.at(-1)).toMatchObject({ round: over.round, won: false });
    expect(history.slice(0, -1).every((l) => l.won)).toBe(true);
  });

  it('names advances, wounds and levels', () => {
    const unit = { name: 'Wolf', quality: 4, combat: 3 };
    expect(advanceInfo({ kind: 'trait', trait: 'tough' }).label).toBe('Tough');
    expect(advanceChange(unit, { kind: 'combat' })).toBe('Combat 3 → 4');
    expect(advanceChange(unit, { kind: 'quality' })).toBe('Quality 4+ → 3+');
    expect(advanceChange(unit, { kind: 'trait', trait: 'fast' })).toBe('Gains Fast');
    expect(woundInfo({ kind: 'quality' }).label).toBe('Quality +1');
    const view = unitView({ id: 'u1', unit, xp: 4, level: 1, kills: 2 });
    expect(levelLine(view)).toBe(`Level 1 · 4/${RUN_TUNING.xp.levels[1]} XP`);
    expect(levelLine(unitView({ id: 'u1', unit, xp: 30, level: RUN_TUNING.xp.levels.length, kills: 9 }))).toBe(`Level ${RUN_TUNING.xp.levels.length} · 30 XP`);
  });

  it('labels the menu button and reads a typed seed', () => {
    expect(runMenuItem(null).title).toBe('Run');
    expect(runMenuItem({ ...newRun(42), round: 3 })).toEqual({ title: 'Continue run', detail: 'Round 3 · seed 42' });
    expect(runSeedFrom('', 77)).toBe(77);
    expect(runSeedFrom(' 123 ', 77)).toBe(123);
    expect(runSeedFrom('abc', 77)).toBeNull();
    expect(runSeedFrom('1.5', 77)).toBeNull();
    expect(runSeedFrom('-3', 77)).toBeNull();
  });
});
