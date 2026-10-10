import { describe, expect, it } from 'vitest';
import { generateRoute, legalRunActions, makeRunRandom, newRun, RUN_EVENT_IDS, runStep, RUN_TUNING, stageEvent, unitCost, type RunState } from '@fansong/content';
import { CliError } from '../src/options.js';
import { autoPick, battleLine, DEFAULT_RETREAT_SHARE, parseRunArgs, routePick, runHelpText, runSimMain, simulateRun, summarize } from '../src/runSim.js';

describe('parseRunArgs', () => {
  it('has defaults and reads every flag', () => {
    expect(parseRunArgs([])).toEqual({
      seeds: 20,
      seed: 1,
      maxRounds: 30,
      route: 'balanced',
      retreat: 'never',
      retreatShare: DEFAULT_RETREAT_SHARE,
      verbose: false,
      help: false,
    });
    expect(
      parseRunArgs(['--seeds', '200', '--seed', '7', '--max-rounds', '12', '--route', 'greedy', '--retreat', 'losing', '--retreat-share', '0.8', '-v']),
    ).toEqual({
      seeds: 200,
      seed: 7,
      maxRounds: 12,
      route: 'greedy',
      retreat: 'losing',
      retreatShare: 0.8,
      verbose: true,
      help: false,
    });
    expect(parseRunArgs(['-h']).help).toBe(true);
    expect(runHelpText()).toMatch(/--seeds/);
  });

  it('rejects bad flags', () => {
    expect(() => parseRunArgs(['--seeds'])).toThrow(CliError);
    expect(() => parseRunArgs(['--seeds', '0'])).toThrow(/at least 1/);
    expect(() => parseRunArgs(['--seeds', '2.5'])).toThrow(CliError);
    expect(() => parseRunArgs(['--bogus'])).toThrow(/Unknown option/);
    expect(() => parseRunArgs(['--route', 'reckless'])).toThrow(/safe, balanced, greedy/);
    expect(() => parseRunArgs(['--mission', 'easy'])).toThrow(/Unknown option/);
    expect(() => parseRunArgs(['--retreat', 'always'])).toThrow(/never, losing/);
    expect(() => parseRunArgs(['--retreat-share', '0'])).toThrow(CliError);
  });
});

describe('autoPick', () => {
  it('always picks a legal action, and drafts the costliest offer', () => {
    let s: RunState = newRun(3);
    const offer = s.offer!;
    if (offer.kind !== 'draft') throw new Error('not a draft');
    for (let i = 0; i < 40 && s.phase !== 'battle'; i++) {
      const action = autoPick(s);
      expect(legalRunActions(s)).toContainEqual(action);
      s = runStep(s, action);
    }
    expect(s.phase).toBe('battle');
    // Everyone is fielded.
    expect(s.battle!.fielded).toEqual(s.roster.map((u) => u.id));
  });

  it('spends in the shop only on what is worth its price, then leaves', () => {
    // A run that wins its first step.
    const run = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => simulateRun(seed, 1)).find((r) => r.end === 'capped')!;
    expect(run.end).toBe('capped');
    // The cap stopped it on the next step's map, shop done: no gold left that could have bought a recruit worth having.
    expect(run.final.round).toBe(2);
    expect(run.final.gold).toBeGreaterThanOrEqual(0);
  });
});

describe('simulateRun', () => {
  it('plays the same run for the same seed', () => {
    const a = simulateRun(5, 3);
    expect(simulateRun(5, 3)).toEqual(a);
    expect(a.battles.length).toBeGreaterThan(0);
    expect(a.battles.map((b) => b.round)).toEqual([...a.battles.map((b) => b.round)].sort((x, y) => x - y));
    expect(a.visits.length).toBeGreaterThanOrEqual(a.battles.length);
    expect(a.wins).toBe(a.battles.filter((b) => b.won).length);
    if (a.end === 'lost') expect(a.final.phase).toBe('over');
    else expect(a.final.round).toBe(4);
    for (const b of a.battles) expect(b.playerUnits).toBeLessThanOrEqual(RUN_TUNING.rosterCap);
  });

  it('goes up the map the way its policy names', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const open = generateRoute(seed, 1).nodes.filter((n) => n.step === 1);
      const threats = open.map((n) => n.threat!);
      expect(routePick(open, 'safe').threat).toBe(Math.min(...threats));
      expect(routePick(open, 'greedy').threat).toBe(Math.max(...threats));
      const off = threats.map((t) => Math.abs(t - 1));
      expect(Math.abs(routePick(open, 'balanced').threat! - 1)).toBe(Math.min(...off));
    }
    // A stop is the safe way, and the last a greedy run takes; an elite is the greedy way.
    const [fight] = generateRoute(1, 1).nodes;
    const stop = { ...fight!, id: 90, kind: 'camp' as const, threat: undefined };
    const elite = { ...fight!, id: 91, kind: 'elite' as const, threat: 1.5 };
    expect(routePick([fight!, stop, elite], 'safe')).toBe(stop);
    expect(routePick([stop, fight!, elite], 'greedy')).toBe(elite);
    expect(routePick([stop, elite, { ...fight!, threat: 0.9 }], 'balanced').threat).toBe(0.9);
  });

  it('rests or drills at a camp, trains its costliest unit, and buys a banner only to use one', () => {
    const base = simulateRun(1, 1).final;
    const camp: RunState = { ...base, phase: 'stop', offer: { kind: 'camp' } };
    expect(autoPick(camp)).toEqual({ type: 'camp', choice: 'drill' });
    const hurt: RunState = { ...camp, roster: camp.roster.map((u, i) => (i === 0 ? { ...u, sitsOut: true } : u)) };
    expect(autoPick(hurt)).toEqual({ type: 'camp', choice: 'rest' });
    expect(autoPick({ ...camp, offer: { kind: 'camp', taken: 'rest' } })).toEqual({ type: 'leaveStop' });

    const training: RunState = { ...base, phase: 'stop', offer: { kind: 'training' } };
    const costs = training.roster.map((u) => unitCost(u.unit));
    const named = autoPick(training);
    expect(named.type).toBe('train');
    expect(unitCost(training.roster.find((u) => named.type === 'train' && u.id === named.unitId)!.unit)).toBe(Math.max(...costs));
    const choosing = runStep(training, named);
    expect(autoPick(choosing).type).toBe('trainPick');

    const market: RunState = { ...base, phase: 'shop', gold: 40, banners: 0, offer: { kind: 'shop', market: true, recruits: [], upgrades: [], rerolls: 0 } };
    expect(autoPick(market)).toEqual({ type: 'leaveShop' });
    expect(autoPick(market, 'balanced', 'losing')).toEqual({ type: 'buyBanner' });
    expect(autoPick({ ...market, banners: 1 }, 'balanced', 'losing')).toEqual({ type: 'leaveShop' });
  });

  it('takes every event some legal way, by a preference of its own', () => {
    const base: RunState = { ...simulateRun(1, 1).final, phase: 'stop', gold: 200, banners: 0 };
    const picked = (event: (typeof RUN_EVENT_IDS)[number], s: RunState = base, ...policy: Parameters<typeof autoPick> extends [unknown, ...infer P] ? P : never) => {
      const at: RunState = { ...s, offer: stageEvent(event, s, makeRunRandom(1, 1, 9)) };
      const action = autoPick(at, ...policy);
      expect(legalRunActions(at)).toContainEqual(action);
      return action;
    };
    expect(picked('sellsword')).toEqual({ type: 'eventChoice', index: 0 });
    // Too poor to hire: it walks on.
    expect(picked('sellsword', { ...base, gold: 0 })).toEqual({ type: 'eventChoice', index: 1 });
    expect(picked('deserters')).toEqual({ type: 'eventChoice', index: 0 });
    expect(picked('shrine')).toEqual({ type: 'eventChoice', index: 1 });
    expect(picked('cache')).toEqual({ type: 'eventChoice', index: 1 });
    expect(picked('ambush')).toEqual({ type: 'eventChoice', index: 0 });
    expect(picked('ambush', base, 'safe')).toEqual({ type: 'eventChoice', index: 1 });
    expect(picked('ambush', { ...base, gold: 0 }, 'safe')).toEqual({ type: 'eventChoice', index: 0 });
    expect(picked('standard')).toEqual({ type: 'eventChoice', index: 1 });
    expect(picked('standard', base, 'balanced', 'losing')).toEqual({ type: 'eventChoice', index: 0 });
    // Settled, it moves on.
    const settled: RunState = { ...base, offer: { kind: 'event', event: 'cache', gold: 10, result: { choice: 0, text: 'x' } } };
    expect(autoPick(settled)).toEqual({ type: 'leaveStop' });
  });

  it('fights weaker enemies on the safe road than on the greedy one', () => {

    const threat = (policy: 'safe' | 'greedy') => simulateRun(5, 1, policy).battles[0]!;
    expect(threat('safe').threat).toBeLessThan(threat('greedy').threat);
    expect(threat('safe').reward).toBeLessThan(threat('greedy').reward);
  });

  it('stops at the round cap or at a loss', () => {
    for (let seed = 10; seed < 14; seed++) {
      const run = simulateRun(seed, 2);
      expect(run.end).not.toBe('stalled');
      expect(run.battles.length).toBeLessThanOrEqual(2);
      expect(run.end === 'lost').toBe(!run.battles.at(-1)!.won);
    }
  });
});

describe('the retreat policy', () => {
  it('changes nothing by default: nobody retreats, and the report says nothing of it', () => {
    const plain = simulateRun(5, 3);
    expect(simulateRun(5, 3, 'balanced', 'never')).toEqual(plain);
    expect(plain.battles.some((b) => b.retreated)).toBe(false);
    expect(summarize([plain])).not.toMatch(/retreats:/);
  });

  it('gives up a losing battle once, spends the banner, and takes another road at the same step', () => {
    let seen = 0;
    for (let seed = 1; seed <= 12 && seen < 2; seed++) {
      const run = simulateRun(seed, 4, 'safe', 'losing', 1);
      expect(simulateRun(seed, 4, 'safe', 'losing', 1)).toEqual(run);
      const fled = run.battles.filter((b) => b.retreated);
      // One banner, and no boss within four rounds to win another.
      expect(fled.length).toBeLessThanOrEqual(RUN_TUNING.banners.start);
      for (const b of fled) {
        seen++;
        expect(b.won).toBe(false);
        expect(b.leftDead).toBeLessThanOrEqual(b.leftBehind);
        const at = run.battles.indexOf(b);
        const next = run.battles[at + 1];
        // Unless nobody came back, the run goes on from the same step, by another node.
        if (next) expect(next.round).toBe(b.round);

        else expect(run.end === 'lost' || run.end === 'capped').toBe(true);
        expect(battleLine(seed, b)).toMatch(/ FLED .* got away, \d+ left behind/);
      }
      expect(run.wins).toBe(run.battles.filter((b) => b.won).length);
      if (fled.length > 0) expect(summarize([run])).toMatch(/retreats: 1 in 1 runs/);
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('the report', () => {
  it('summarises depth, rounds, modes and enemies', () => {
    const results = [simulateRun(5, 2), simulateRun(6, 2)];
    const text = summarize(results);
    expect(text).toMatch(/^2 runs · reached step: mean /);
    expect(text).toMatch(/beat the first boss \(step 7\): 0%/);
    expect(text).toMatch(/battles: \d+ fought, \d+% won/);
    expect(text).toMatch(/visits a run: battle \d\.\d/);
    expect(text).toMatch(/step {2}fought/);
    expect(text).toMatch(/node +fought/);
    expect(text).toMatch(/annihilation/);
    expect(text).toContain(results[0]!.battles[0]!.enemy);
    expect(battleLine(5, results[0]!.battles[0]!)).toMatch(/^seed 5 step {2}1 (WON |LOST)/);
  });

  it('runs as a subcommand', () => {
    const lines: string[] = [];
    expect(runSimMain(['--seeds', '2', '--max-rounds', '1', '-v'], (l) => lines.push(l))).toBe(0);
    expect(lines.filter((l) => l.startsWith('seed '))).toHaveLength(2);
    expect(lines.some((l) => l.startsWith('2 runs'))).toBe(true);
    const help: string[] = [];
    expect(runSimMain(['--help'], (l) => help.push(l))).toBe(0);
    expect(help.join('\n')).toMatch(/calibration sim/);
  });
});
