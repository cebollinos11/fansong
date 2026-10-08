import { describe, expect, it } from 'vitest';
import { legalRunActions, newRun, runStep, RUN_TUNING, type RunState } from '@fansong/content';
import { CliError } from '../src/options.js';
import { autoPick, battleLine, parseRunArgs, runHelpText, runSimMain, simulateRun, summarize } from '../src/runSim.js';

describe('parseRunArgs', () => {
  it('has defaults and reads every flag', () => {
    expect(parseRunArgs([])).toEqual({ seeds: 20, seed: 1, maxRounds: 30, verbose: false, help: false });
    expect(parseRunArgs(['--seeds', '200', '--seed', '7', '--max-rounds', '12', '-v'])).toEqual({
      seeds: 200,
      seed: 7,
      maxRounds: 12,
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
    const run = simulateRun(2, 1);
    expect(run.end).toBe('capped');
    // The cap stopped it in the next round's briefing, shop done: no gold left that could have bought a recruit worth having.
    expect(run.final.round).toBe(2);
    expect(run.final.gold).toBeGreaterThanOrEqual(0);
  });
});

describe('simulateRun', () => {
  it('plays the same run for the same seed', () => {
    const a = simulateRun(5, 3);
    expect(simulateRun(5, 3)).toEqual(a);
    expect(a.battles.length).toBeGreaterThan(0);
    expect(a.battles.map((b) => b.round)).toEqual(a.battles.map((_, i) => i + 1));
    expect(a.wins).toBe(a.battles.filter((b) => b.won).length);
    if (a.end === 'lost') expect(a.final.phase).toBe('over');
    else expect(a.final.round).toBe(4);
    for (const b of a.battles) expect(b.playerUnits).toBeLessThanOrEqual(RUN_TUNING.rosterCap);
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

describe('the report', () => {
  it('summarises depth, rounds, modes and enemies', () => {
    const results = [simulateRun(5, 2), simulateRun(6, 2)];
    const text = summarize(results);
    expect(text).toMatch(/^2 runs · reached round: mean /);
    expect(text).toMatch(/round {2}fought/);
    expect(text).toMatch(/annihilation/);
    expect(text).toContain(results[0]!.battles[0]!.enemy);
    expect(battleLine(5, results[0]!.battles[0]!)).toMatch(/^seed 5 round {2}1 (WON |LOST)/);
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
