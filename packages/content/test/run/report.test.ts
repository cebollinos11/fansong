import { runReplay, type GameEvent, type GameState, type Replay } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { battleReport, enemyCost, goldFor, legalRunActions, runStep, unitCost, type RunState } from '../../src/index.js';
import { drafted, inBattle, playBattle } from './helpers.js';

/** Check a report against the replay's own events and final state. */
function checkReport(s: RunState, replay: Replay): void {
  const fielded = s.battle!.fielded!;
  const report = battleReport(replay, fielded);
  const run = runReplay(replay);
  const events = run.events.flat();
  expect(report.winner).toBe(run.final.winner);
  expect(Object.keys(report.units)).toEqual(fielded);
  expect(report.enemyPoints).toBe(enemyCost(s.battle!));
  expect(report.enemyPointsKilled).toBeLessThanOrEqual(report.enemyPoints);

  const turned = new Set(events.flatMap((e) => (e.type === 'UnitDefected' ? [e.unitId] : [])));
  fielded.forEach((id, i) => {
    const unit = run.final.units.find((u) => u.id === `p0u${i}`)!;
    const r = report.units[id]!;
    // The engine unit at that index is the roster unit the id names.
    expect(unit.name).toBe(s.roster.find((u) => u.id === id)!.unit.name);
    const killed = events.some((e) => e.type === 'UnitKilled' && e.unitId === unit.id);
    const routed = events.some((e) => e.type === 'UnitRouted' && e.unitId === unit.id);
    expect(r.fate).toBe(turned.has(unit.id) ? 'turned' : killed ? 'fell' : routed ? 'fled' : 'survived');
    if (r.fate === 'survived') expect(unit.dead).toBe(false);
    else if (r.fate !== 'turned') expect(unit.dead).toBe(true);
    expect(r.killCosts).toHaveLength(r.kills);
    expect(r.kills).toBeLessThanOrEqual(events.filter((e) => e.type === 'UnitKilled' && e.byId === unit.id).length);
  });

  // With nobody changing sides, the kills are exactly the enemy's dead with a killer.
  if (turned.size === 0) {
    const kills = events.filter((e) => e.type === 'UnitKilled' && e.unitId.startsWith('p1') && e.byId !== null);
    expect(Object.values(report.units).reduce((n, u) => n + u.kills, 0)).toBe(kills.length);
    // An enemy forced to surrender pays for its survivors too.
    const surrendered = report.winner === 0 && events.some((e) => e.type === 'GameOver' && e.reason === 'surrender');
    const paid = run.final.units.filter((u) => u.owner === 1 && (u.dead || surrendered));
    const enemy = s.battle!.enemy.units;
    expect(report.enemyPointsKilled).toBe(paid.reduce((sum, u) => sum + unitCost(enemy[Number(u.id.slice(3))]!), 0));
    if (surrendered) expect(report.enemyPointsKilled).toBe(report.enemyPoints);
  }
}

/** The first seed (from 1) whose first battle, AI in both seats, ends as `ending` says. */
function battleEnding(ending: (final: GameState, events: GameEvent[]) => boolean, banners?: number): { s: RunState; replay: Replay } {
  for (let seed = 1; seed <= 60; seed++) {
    const s = { ...inBattle(seed), ...(banners === undefined ? {} : { banners }) };
    if (s.battle!.mode !== 'annihilation') continue;
    const replay = playBattle(s);
    const run = runReplay(replay);
    if (ending(run.final, run.events.flat())) return { s, replay };
  }
  throw new Error('no such battle in 60 seeds');
}

const bySurrender = (events: GameEvent[]) => events.some((e) => e.type === 'GameOver' && e.reason === 'surrender');

describe('battleReport', () => {
  it('agrees with the replay it reads', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = inBattle(seed);
      checkReport(s, playBattle(s));
    }
  });

  it('pays a forced surrender as if the survivors had fallen, with no kills credited for them', () => {
    const { s, replay } = battleEnding((final, events) => final.winner === 0 && bySurrender(events));
    const run = runReplay(replay);
    const survivors = run.final.units.filter((u) => u.owner === 1 && !u.dead);
    expect(survivors.length).toBeGreaterThan(0);
    const report = battleReport(replay, s.battle!.fielded!);
    expect(report.enemyPointsKilled).toBe(report.enemyPoints);
    const fallen = run.events.flat().filter((e) => (e.type === 'UnitKilled' || e.type === 'UnitRouted') && e.unitId.startsWith('p1'));
    expect(Object.values(report.units).reduce((n, u) => n + u.kills, 0)).toBeLessThanOrEqual(fallen.length);
    // The run settles it as any other win, on the full gold.
    const won = runStep(s, { type: 'battleResult', replay });
    expect(won.phase).toBe('aftermath');
    expect(won.aftermath!.gold).toBe(goldFor(s.round, report));
    checkReport(s, replay);
  });

  it('ends the run when the player, with no banner to retreat under, is the one forced to surrender', () => {
    const { s, replay } = battleEnding((final, events) => final.winner === 1 && bySurrender(events), 0);
    const report = battleReport(replay, s.battle!.fielded!);
    expect(report.retreated).toBe(false);
    expect(Object.values(report.units).some((u) => u.fate === 'survived')).toBe(true);
    expect(runStep(s, { type: 'battleResult', replay }).phase).toBe('over');
  });

  it('maps engine units back to the roster when someone is benched', () => {
    let s = drafted(3);
    const benched = s.roster[0]!.id;
    s = runStep(s, { type: 'bench', unitId: benched, benched: true });
    s = runStep(s, { type: 'startBattle' });
    expect(s.battle!.fielded).toEqual(s.roster.slice(1).map((u) => u.id));
    const replay = playBattle(s);
    checkReport(s, replay);
    expect(battleReport(replay, s.battle!.fielded!).units[benched]).toBeUndefined();
  });

  it('reports an unfinished battle as having no winner, and rejects the wrong roster', () => {
    const s = inBattle(2);
    const replay = playBattle(s);
    const cut = { ...replay, commands: replay.commands.slice(0, 5) };
    expect(battleReport(cut, s.battle!.fielded!).winner).toBeNull();
    expect(() => battleReport(replay, [...s.battle!.fielded!, 'extra'])).toThrow();
    expect(() => runStep(s, { type: 'battleResult', replay: cut })).toThrow(/not over/);
    expect(legalRunActions(s)).toEqual([]);
  });

  it('lets a playtester win the battle unfought, with nobody hurt', () => {
    const s = inBattle(2);
    const won = runStep(s, { type: 'devWin' });
    expect(won.phase).toBe('aftermath');
    expect(won.battle).toBeUndefined();
    expect(won.roster.map((u) => u.id)).toEqual(s.roster.map((u) => u.id));
    expect(won.log.at(-1)).toMatchObject({ won: true, losses: 0 });
    expect(() => runStep(won, { type: 'devWin' })).toThrow();
  });
});
