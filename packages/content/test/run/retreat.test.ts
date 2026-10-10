import { chooseCommand } from '@fansong/ai';
import { createGame, getLegalCommands, recordReplay, runReplay, type Command, type GameState, type Replay } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import {
  applyRetreat,
  applyWound,
  battleReport,
  injuryFor,
  isBossRound,
  legalRunActions,
  makeRunRandom,
  openNodes,
  RUN_TUNING,
  runBattleConfig,
  runStep,
  type BattleReport,
  type RunState,
  type UnitFate,
} from '../../src/index.js';
import { atStep, autoUntil, inBattle, playBattle, retreating } from './helpers.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function playRetreat(s: RunState, runFor: 'all' | 'leader' = 'all'): Replay {
  return recordReplay(runBattleConfig(s), retreating(runFor));
}

/** A run in its first battle whose retreat, played by {@link retreating}, is lost with the Leader off the field. */
function retreatedBattle(runFor: 'all' | 'leader' = 'all'): { s: RunState; replay: Replay; report: BattleReport } {
  for (let seed = 1; seed < 40; seed++) {
    const s = inBattle(seed);
    const replay = playRetreat(s, runFor);
    const report = battleReport(replay, s.battle!.fielded!);
    const fates = Object.values(report.units).map((u) => u.fate);
    if (report.winner !== 1 || !report.retreated || !fates.includes('retreated')) continue;
    if (runFor === 'leader' && !fates.includes('leftBehind')) continue;
    return { s, replay, report };
  }
  throw new Error('no seed gave a clean retreat');
}

/** A retreated battle's report in which every fielded unit met `fate`. */
function reportOf(s: RunState, fate: (id: string, i: number) => UnitFate): BattleReport {
  const units = Object.fromEntries(s.battle!.fielded!.map((id, i) => [id, { kills: 1, killCosts: [1000], fate: fate(id, i) }]));
  return { winner: 1, units, enemyPoints: 100, enemyPointsKilled: 60, retreated: true };
}

describe('retreat banners', () => {
  it('starts a run with one, and gives the battle a retreat zone only while one is in hand', () => {
    const s = inBattle(31);
    expect(s.banners).toBe(RUN_TUNING.banners.start);
    const config = runBattleConfig(s);
    expect(config.retreatZones).toEqual([s.battle!.map.deployZones[0], []]);
    expect(createGame(config).retreatZones?.[1]).toEqual([]);
    // The same every time, banner in hand: nothing is spent until the result is in.
    expect(runBattleConfig(clone(s))).toEqual(config);
    expect(runBattleConfig({ ...s, banners: 0 }).retreatZones).toBeUndefined();
    expect('retreatZones' in createGame(runBattleConfig({ ...s, banners: 0 }))).toBe(false);
  });

  it('never lets the AI retreat: an ordinary battle reports no retreat and spends no banner', () => {
    for (let seed = 40; seed < 46; seed++) {
      const s = inBattle(seed);
      const replay = playBattle(s);
      const report = battleReport(replay, s.battle!.fielded!);
      expect(report.retreated).toBe(false);
      expect(replay.commands.some((c) => c.type === 'Retreat')).toBe(false);
      const next = runStep(s, { type: 'battleResult', replay });
      expect(next.banners).toBe(RUN_TUNING.banners.start);
      if (report.winner === 1) expect(next.phase).toBe('over');
    }
  });

  it('reads the fates of a retreat back from its replay', () => {
    const { s, replay, report } = retreatedBattle('leader');
    const run = runReplay(replay);
    expect(run.final.retreat?.owner).toBe(0);
    s.battle!.fielded!.forEach((id, i) => {
      const unit = run.final.units.find((u) => u.id === `p0u${i}`)!;
      const fate = report.units[id]!.fate;
      if (unit.retreated) expect(fate).toBe('retreated');
      else if (!unit.dead) expect(fate).toBe('leftBehind');
      else expect(['fell', 'fled', 'turned']).toContain(fate);
    });
    expect(Object.values(report.units).some((u) => u.fate === 'survived')).toBe(false);
  });

  it('spends the banner, pays nothing, and falls back to the map with the fled node closed', () => {
    const { s, replay, report } = retreatedBattle();
    const next = runStep(s, { type: 'battleResult', replay });
    expect([next.phase, next.banners, next.retreats, next.round]).toEqual(['aftermath', 0, 1, s.round]);
    expect(next.offer).toBeUndefined();
    expect(next.gold).toBe(s.gold);
    expect(next.pending).toBeUndefined();
    expect(next.aftermath).toMatchObject({ gold: 0, retreated: true });
    expect(next.log).toMatchObject([{ round: 1, won: false, retreated: true, gold: 0 }]);
    for (const u of next.roster) expect(u.xp).toBe(0);
    // Those who walked off are exactly as they were.
    for (const [id, r] of Object.entries(report.units)) {
      if (r.fate !== 'retreated') continue;
      expect(next.roster.find((u) => u.id === id)).toEqual({ ...s.roster.find((u) => u.id === id)!, kills: r.kills });
      expect(next.aftermath!.units.find((l) => l.unitId === id)).toMatchObject({ fate: 'retreated', xp: 0 });
      expect(next.aftermath!.units.find((l) => l.unitId === id)!.die).toBeUndefined();
    }

    // The node it fled is closed at once, and nothing is being played.
    const fled = s.route!.going!;
    expect(next.route).toEqual({ ...s.route!, going: undefined, closed: [fled] });

    // No reward: the aftermath leads straight to the field shop, and the shop back to the map at step 1.
    expect(legalRunActions(next)).toEqual([{ type: 'continue' }]);
    const shop = runStep(next, { type: 'continue' });
    expect([shop.phase, shop.offer?.kind]).toEqual(['shop', 'shop']);
    const again = runStep(shop, { type: 'leaveShop' });
    expect([again.phase, again.round, again.retreats]).toEqual(['map', 1, 1]);
    expect(again.route).toEqual(next.route);
    const open = openNodes(again.route!);
    expect(open).not.toContain(fled);
    expect(open.length).toBeGreaterThan(0);
    expect(legalRunActions(again)).toEqual(open.map((nodeId) => ({ type: 'travel', nodeId })));
    expect(runStep(again, { type: 'rename', unitId: again.roster[0]!.id, name: 'Still Here' }).phase).toBe('map');

    // With no banner left the next battle has no retreat zone, and losing it ends the run.
    const battle = autoUntil(again, 'battle');
    expect(battle.route!.going).not.toBe(fled);
    expect(runBattleConfig(battle).retreatZones).toBeUndefined();
    expect(playRetreat(battle).commands.some((c) => c.type === 'Retreat')).toBe(false);
  });

  it('opens the fled node again, against someone new, when no other road is left or it is the boss', () => {
    const { s, replay } = retreatedBattle();
    const fled = s.route!.going!;
    const others = s.route!.nodes.filter((n) => n.step === 1 && n.id !== fled).map((n) => n.id);

    // Every other way already closed: the node stays open.
    const cornered = clone(s);
    cornered.route!.closed = others;
    const back = autoUntil(runStep(cornered, { type: 'battleResult', replay }), 'map');
    expect(back.route!.closed).toEqual(others);
    expect(legalRunActions(back)).toEqual([{ type: 'travel', nodeId: fled }]);
    const again = runStep(back, { type: 'travel', nodeId: fled });
    expect(again.battle!.seed).not.toBe(s.battle!.seed);
    expect(again.battle!.faction).toBe(s.battle!.faction);

    // The boss is never closed, whatever else is open.
    const boss = clone(s);
    boss.route!.nodes[fled]!.kind = 'boss';
    expect(runStep(boss, { type: 'battleResult', replay }).route!.closed).toEqual([]);
  });

  it('spends the banner on the call, even when the battle is then won', () => {
    // The Leader sounds the retreat as soon as it can, and the warband fights on regardless.
    const callThenFight = (state: GameState): Command => getLegalCommands(state).find((c) => c.type === 'Retreat') ?? chooseCommand(state);
    for (let seed = 1; seed < 40; seed++) {
      const s = inBattle(seed);
      const replay = recordReplay(runBattleConfig(s), callThenFight);
      const report = battleReport(replay, s.battle!.fielded!);
      if (report.winner !== 0 || !report.retreated) continue;
      const next = runStep(s, { type: 'battleResult', replay });
      expect([next.phase, next.banners, next.retreats]).toEqual(['aftermath', RUN_TUNING.banners.start - 1, undefined]);
      expect(next.aftermath?.retreated).toBeUndefined();
      expect(next.offer?.kind).toBe('reward');
      expect(next.log).toMatchObject([{ round: 1, won: true }]);
      return;
    }
    throw new Error('no seed won after sounding the retreat');
  });

  it('moves on, and forgets the retreats, once the round is won', () => {
    const { s, replay } = retreatedBattle();
    let run = runStep(s, { type: 'battleResult', replay });
    for (let tries = 0; tries < 12; tries++) {
      run = autoUntil(run, 'battle', 'over');
      if (run.phase === 'over') break;
      run = runStep(run, { type: 'battleResult', replay: playBattle(run) });
      if (run.phase === 'over') break;
      const shop = autoUntil(run, 'shop');
      const next = runStep(shop, { type: 'leaveShop' });
      expect([next.round, next.retreats, next.rolls, next.phase]).toEqual([2, undefined, 0, 'map']);
      expect(next.route!.closed).toHaveLength(1);
      expect(next.log.map((r) => [r.round, r.won])).toEqual([
        [1, false],
        [1, true],
      ]);
      return;
    }
    // Every seed that lost round 1 again simply ended, as a loss without a banner does.
    expect(run.phase).toBe('over');
  });

  it('is the same run for the same seed and the same choices, retreat and all', () => {
    const play = (): RunState => {
      const { s, replay } = retreatedBattle();
      return autoUntil(runStep(s, { type: 'battleResult', replay }), 'briefing');
    };
    expect(play()).toEqual(play());
  });

  it('rolls the harsher table for those left behind, and the ordinary one for those who fell', () => {
    const { dead, wound, sitsOut } = RUN_TUNING.leftBehind;
    expect([dead, wound, sitsOut]).toEqual([RUN_TUNING.injury.dead + 2, RUN_TUNING.injury.wound + 2, RUN_TUNING.injury.sitsOut + 2]);
    expect([1, 2, 3, 4, 5, 6].map((d) => injuryFor(d, RUN_TUNING.leftBehind))).toEqual(['dead', 'dead', 'dead', 'wound', 'sitsOut', 'recovered']);

    const outcomes = new Set<string>();
    for (let rolls = 0; rolls < 60; rolls++) {
      const s = inBattle(6);
      // Enough of them for every fate, and several left behind.
      for (let i = 0; s.battle!.fielded!.length < 8; i++) {
        s.roster.push({ id: `x${i}`, unit: { name: `Extra ${i}`, quality: 4, combat: 2 }, xp: 0, level: 0, kills: 0 });
        s.battle!.fielded!.push(`x${i}`);
      }
      const before = clone(s);
      const [walked, fled, turned, fell, ...behind] = s.battle!.fielded!;
      const fates: Record<string, UnitFate> = { [walked!]: 'retreated', [fled!]: 'fled', [turned!]: 'turned', [fell!]: 'fell' };
      applyRetreat(s, reportOf(s, (id) => fates[id] ?? 'leftBehind'), makeRunRandom(6, 1, rolls));
      const lines = s.aftermath!.units;
      expect(s.gold).toBe(before.gold);
      expect(s.roster.find((u) => u.id === turned)).toBeUndefined();
      for (const id of [walked!, fled!]) {
        expect(s.roster.find((u) => u.id === id)).toEqual({ ...before.roster.find((u) => u.id === id)!, kills: 1 });
        expect(lines.find((l) => l.unitId === id)!.die).toBeUndefined();
      }
      for (const id of [fell!, ...behind]) {
        const line = lines.find((l) => l.unitId === id)!;
        const table = id === fell ? RUN_TUNING.injury : RUN_TUNING.leftBehind;
        const rolled = injuryFor(line.die!, table);
        expect(line.injury).toBe(rolled === 'wound' && !line.wound ? 'sitsOut' : rolled);
        expect(line.xp).toBe(0);
        const was = before.roster.find((u) => u.id === id)!;
        const now = s.roster.find((u) => u.id === id);
        if (id !== fell) outcomes.add(`${line.die}:${line.injury}`);
        if (line.injury === 'dead') expect(now).toBeUndefined();
        else {
          expect(now!.xp).toBe(0);
          expect(now!.unit).toEqual(line.wound ? applyWound(was.unit, line.wound) : was.unit);
          expect(Boolean(now!.sitsOut)).toBe(line.injury === 'sitsOut');
        }
      }
      expect(s.log).toMatchObject([{ won: false, retreated: true, losses: before.roster.length - s.roster.length, gold: 0 }]);
    }
    for (const die of [1, 2, 3]) expect(outcomes.has(`${die}:dead`)).toBe(true);
    expect(outcomes.has('6:recovered')).toBe(true);
  });

  it('can cost the whole warband', () => {
    const s = inBattle(6);
    const size = s.roster.length;
    applyRetreat(s, reportOf(s, () => 'turned'), makeRunRandom(1, 1, 0));
    expect(s.roster).toEqual([]);
    expect(s.log.at(-1)).toMatchObject({ retreated: true, losses: size });
  });

  it('gains a banner for each boss beaten, up to the cap', () => {
    const { max, perBoss } = RUN_TUNING.banners;
    const bossRound = RUN_TUNING.enemy.bossEvery;
    expect(isBossRound(bossRound)).toBe(true);
    const wins: Record<string, number[]> = { boss: [], regular: [] };
    for (let seed = 1; seed < 60 && (wins.boss!.length < 2 || wins.regular!.length < 1); seed++) {
      for (const [kind, round, banners] of [['boss', bossRound, 0], ['boss', bossRound, max], ['regular', 1, 0]] as const) {
        // A drafted run, set down at the step under test: the encounter is the seed's own.
        const s = autoUntil({ ...atStep(seed, round), banners }, 'battle');
        const next = runStep(s, { type: 'battleResult', replay: playBattle(s) });
        if (next.phase !== 'aftermath') continue;
        wins[kind]!.push(next.banners - banners);
        expect(next.banners).toBe(kind === 'boss' ? Math.min(max, banners + perBoss) : banners);
      }
    }
    expect(wins.boss).toContain(perBoss);
    expect(wins.boss).toContain(0);
    expect(wins.regular).toContain(0);
  });

  it('offers the AI nothing new to choose in a run battle: its games are the same with and without the zone', () => {
    for (let seed = 40; seed < 44; seed++) {
      const s = inBattle(seed);
      const withZone = recordReplay(runBattleConfig(s), chooseCommand);
      const without = recordReplay(runBattleConfig({ ...s, banners: 0 }), chooseCommand);
      expect(withZone.commands).toEqual(without.commands);
    }
  });
});
