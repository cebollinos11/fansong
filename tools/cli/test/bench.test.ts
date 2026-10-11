import { describe, expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import { getLegalCommands } from '@fansong/engine';
import { benchHelpText, benchTasks, margin, mergeTally, p95, parseBenchArgs, runTasks, summarizeBench, summarizeSelf, winRate } from '../src/bench.js';
import { CliError } from '../src/options.js';

const SMALL = ['--maps', 'open-field', '--presets', 'border-watch-small,restless-dead-small'];

describe('parseBenchArgs', () => {
  it('has defaults and reads every flag', () => {
    expect(parseBenchArgs([])).toMatchObject({ baseline: null, maps: [], presets: [], seeds: 1, seed: 1, self: false, worker: null });
    expect(parseBenchArgs([]).modes).toContain('annihilation');
    expect(
      parseBenchArgs(['--baseline', 'old.ts', '--modes', 'conquest,annihilation', ...SMALL, '--seeds', '4', '--seed', '9', '--jobs', '3', '--self', '--worker', '1/3']),
    ).toMatchObject({
      baseline: 'old.ts',
      modes: ['conquest', 'annihilation'],
      maps: ['open-field'],
      presets: ['border-watch-small', 'restless-dead-small'],
      seeds: 4,
      seed: 9,
      jobs: 3,
      self: true,
      worker: { index: 1, count: 3 },
    });
    expect(benchHelpText()).toContain('--baseline');
  });

  it('rejects unknown modes, maps, presets and options', () => {
    expect(() => parseBenchArgs(['--modes', 'deathmatch'])).toThrow(CliError);
    expect(() => parseBenchArgs(['--maps', 'atlantis'])).toThrow(/Unknown map/);
    expect(() => parseBenchArgs(['--presets', 'nobody'])).toThrow(/Unknown preset/);
    expect(() => parseBenchArgs(['--seeds', '0'])).toThrow(/whole number/);
    expect(() => parseBenchArgs(['--bogus'])).toThrow(/Unknown option/);
  });
});

describe('benchTasks', () => {
  it('pairs presets of a size, once each, per map, mode and seed', () => {
    const tasks = benchTasks(parseBenchArgs(['--modes', 'annihilation,conquest', ...SMALL, '--seeds', '2']));
    // Two modes × one map × three pairs (two mirrors and the cross) × two seeds.
    expect(tasks).toHaveLength(12);
    expect(tasks[0]).toEqual({ mode: 'annihilation', mapId: 'open-field', presets: ['border-watch-small', 'border-watch-small'], seed: 1 });
  });

  it('never pits a small warband against a large one', () => {
    const tasks = benchTasks(parseBenchArgs(['--modes', 'annihilation', '--maps', 'open-field', '--presets', 'border-watch-small,bonefield-legion-large']));
    expect(tasks.map((t) => t.presets)).toEqual([
      ['border-watch-small', 'border-watch-small'],
      ['bonefield-legion-large', 'bonefield-legion-large'],
    ]);
  });

  it('plays different presets both ways round for --self', () => {
    const tasks = benchTasks(parseBenchArgs(['--modes', 'annihilation', ...SMALL, '--self']));
    expect(tasks.map((t) => t.presets)).toEqual([
      ['border-watch-small', 'restless-dead-small'],
      ['restless-dead-small', 'border-watch-small'],
    ]);
  });
});

describe('runTasks', () => {
  const opts = parseBenchArgs(['--modes', 'annihilation,kill-the-king', ...SMALL]);

  it('scores an AI against itself at exactly 50%', () => {
    const tally = runTasks(benchTasks(opts), chooseCommand, chooseCommand, false, opts.maxSteps);
    for (const mode of opts.modes) {
      const t = tally[mode]!;
      expect(t.games).toBe(6);
      expect(t.wins * 2 + t.draws + t.timeouts).toBe(t.games);
      expect(winRate(t)).toBe(0.5);
      expect(margin(t)).toBeGreaterThan(0);
      expect(t.time[0].count).toBe(t.time[1].count);
      expect(p95(t.time[0])).toBeLessThanOrEqual(t.time[0].max);
    }
    const report = summarizeBench(tally, opts.modes, 'itself');
    expect(report).toContain('current AI vs itself');
    expect(report).toMatch(/kill-the-king\s+6\s+50\.0%/);
  });

  it('scores an AI that beats a bot which only ever takes its first legal command', () => {
    const first = (state: Parameters<typeof chooseCommand>[0]) => getLegalCommands(state)[0]!;
    const tally = runTasks(benchTasks({ ...opts, modes: ['annihilation'] }), chooseCommand, first, false, opts.maxSteps);
    expect(winRate(tally.annihilation!)).toBeGreaterThan(0.5);
  });

  it('merges tallies and reports each preset for --self', () => {
    const self = { ...opts, modes: ['annihilation' as const], self: true };
    const tasks = benchTasks(self);
    const tally = {};
    for (const task of tasks) mergeTally(tally, runTasks([task], chooseCommand, chooseCommand, true, self.maxSteps));
    const whole = runTasks(tasks, chooseCommand, chooseCommand, true, self.maxSteps);
    expect((tally as typeof whole).annihilation!.presets).toEqual(whole.annihilation!.presets);
    const rows = Object.values(whole.annihilation!.presets);
    expect(rows.map((r) => r.games)).toEqual([2, 2]);
    expect(rows[0]!.wins + rows[1]!.wins).toBe(2);
    expect(summarizeSelf(whole, self.modes, 'the current AI')).toContain('restless-dead-small');
  });
});
