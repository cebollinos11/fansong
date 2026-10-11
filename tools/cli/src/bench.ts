import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { chooseCommand } from '@fansong/ai';
import { createMatchFromPresets, getMap, getPreset, listMaps, PRESET_IDS, supportedModes, warbandCost, type MatchSetup } from '@fansong/content';
import { GAME_MODES, reduce, type Command, type GameMode, type GameState } from '@fansong/engine';
import { CliError } from './options.js';

/** Anything that picks a command for the player to act: the AI, or a frozen copy of it. */
export type Chooser = (state: GameState) => Command;

export interface BenchOptions {
  /** Path of a module exporting `chooseCommand` to play against; null = the AI against itself. */
  baseline: string | null;
  modes: GameMode[];
  /** Map ids; empty = every built-in map that hosts the mode. */
  maps: string[];
  /** Preset ids; empty = all of them. */
  presets: string[];
  /** Seeds per matchup; each is played twice, once per seat order. */
  seeds: number;
  /** The first seed; the rest count up. */
  seed: number;
  jobs: number;
  /** Play one AI in both seats and report each preset's win rate instead. */
  self: boolean;
  maxSteps: number;
  /** Set in a child process: play only the tasks of this share (`index` of `count`) and send the tally to the parent. */
  worker: { index: number; count: number } | null;
  help: boolean;
}

/** Two presets meet only when their point costs are this close: a walkover says nothing about the AI. */
const COST_BAND = 1.2;

function numberArg(flag: string, value: string | undefined, min: number): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n < min) throw new CliError(`${flag} needs a whole number, at least ${min}`);
  return n;
}

function listArg(flag: string, value: string | undefined): string[] {
  if (value === undefined || value.startsWith('--')) throw new CliError(`${flag} needs a comma-separated list`);
  return value.split(',').filter((s) => s !== '');
}

export function parseBenchArgs(argv: string[]): BenchOptions {
  const opts: BenchOptions = {
    baseline: null,
    modes: [...GAME_MODES],
    maps: [],
    presets: [],
    seeds: 1,
    seed: 1,
    jobs: Math.max(1, Math.floor(availableParallelism() / 2)),
    self: false,
    maxSteps: 5000,
    worker: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--baseline') {
      const path = argv[++i];
      if (path === undefined) throw new CliError('--baseline needs a path');
      opts.baseline = path;
    } else if (arg === '--modes') {
      const modes = listArg(arg, argv[++i]);
      for (const m of modes) if (!(GAME_MODES as readonly string[]).includes(m)) throw new CliError(`Unknown mode "${m}". Known: ${GAME_MODES.join(', ')}`);
      opts.modes = modes as GameMode[];
    } else if (arg === '--maps') {
      opts.maps = listArg(arg, argv[++i]);
      for (const id of opts.maps) if (!getMap(id)) throw new CliError(`Unknown map "${id}". Known: ${listMaps().map((m) => m.id).join(', ')}`);
    } else if (arg === '--presets') {
      opts.presets = listArg(arg, argv[++i]);
      for (const id of opts.presets) if (!getPreset(id)) throw new CliError(`Unknown preset "${id}". Known: ${PRESET_IDS.join(', ')}`);
    } else if (arg === '--seeds') opts.seeds = numberArg(arg, argv[++i], 1);
    else if (arg === '--seed') opts.seed = numberArg(arg, argv[++i], 0);
    else if (arg === '--jobs') opts.jobs = numberArg(arg, argv[++i], 1);
    else if (arg === '--max-steps') opts.maxSteps = numberArg(arg, argv[++i], 1);
    else if (arg === '--self') opts.self = true;
    else if (arg === '--worker') {
      const [index, count] = (argv[++i] ?? '').split('/').map(Number);
      if (index === undefined || count === undefined || !(index >= 0 && index < count)) throw new CliError('--worker needs <index>/<count>');
      opts.worker = { index, count };
    } else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new CliError(`Unknown option "${arg}". Try bench --help.`);
  }
  return opts;
}

export function benchHelpText(): string {
  return `fansong play bench — AI against a baseline AI

Plays the current AI against a frozen copy of an earlier one and reports its
win rate per mode. Every matchup is played twice on the same seed, once with
each AI in each seat, so two identical AIs score exactly 50%. Presets only meet
others of about their own points.

Usage: pnpm play bench [options]

Options:
  --baseline <path>  Module exporting chooseCommand to play against
                     (default: the AI against itself, which must report 50.0%)
  --modes <a,b>      Modes to play (default: all)
  --maps <a,b>       Maps to play on (default: every map that hosts the mode)
  --presets <a,b>    Presets to field (default: all)
  --seeds <n>        Seeds per matchup; each makes two games (default 1)
  --seed <n>         The first seed; the rest count up (default 1)
  --jobs <n>         Parallel processes (default: half the cores)
  --self             One AI in both seats (the baseline, if given): reports each
                     preset's win rate, to tell a weak warband from a weak AI
  --max-steps <n>    Commands before a game is called a timeout (default 5000)
  --help, -h         Show this help

To freeze the committed AI as the baseline, in packages/ai/baseline (gitignored):
  mkdir packages/ai/baseline
  git archive -o packages/ai/baseline/src.tar HEAD:packages/ai/src
  tar -xf packages/ai/baseline/src.tar -C packages/ai/baseline
then: pnpm play bench --baseline packages/ai/baseline/index.ts
`;
}

/** One matchup: two presets on a map in a mode, on one seed. */
export interface BenchTask {
  mode: GameMode;
  mapId: string;
  presets: [string, string];
  seed: number;
}

/**
 * Every matchup the options ask for, in a fixed order: per mode, each map that
 * hosts it, each pair of presets of about the same points, each seed. A bench
 * pairs a preset with itself and plays each pair one way round (the AIs swap
 * seats instead); `--self` plays each pair of different presets both ways round.
 */
export function benchTasks(opts: BenchOptions): BenchTask[] {
  const presets = opts.presets.length > 0 ? opts.presets : PRESET_IDS;
  const cost = (id: string) => warbandCost(getPreset(id)!);
  const tasks: BenchTask[] = [];
  for (const mode of opts.modes) {
    for (const map of listMaps()) {
      if (opts.maps.length > 0 && !opts.maps.includes(map.id)) continue;
      if (!supportedModes(map).includes(mode)) continue;
      for (let a = 0; a < presets.length; a++) {
        for (let b = opts.self ? 0 : a; b < presets.length; b++) {
          if (opts.self && a === b) continue;
          const [p0, p1] = [presets[a]!, presets[b]!];
          if (Math.max(cost(p0), cost(p1)) > Math.min(cost(p0), cost(p1)) * COST_BAND) continue;
          for (let s = 0; s < opts.seeds; s++) tasks.push({ mode, mapId: map.id, presets: [p0, p1], seed: opts.seed + s });
        }
      }
    }
  }
  return tasks;
}

/** Decision times of one side, in milliseconds: enough to give a mean, a p95 and a maximum after merging. */
export interface Timing {
  count: number;
  sum: number;
  max: number;
  /** Counts by {@link bucketOf}. */
  buckets: number[];
}

const BUCKETS = 96;
/** Quarter-octave buckets from about a microsecond up. */
const bucketOf = (ms: number): number => Math.min(BUCKETS - 1, Math.max(0, Math.floor((Math.log2(ms) + 10) * 4)));
const bucketTop = (i: number): number => 2 ** ((i + 1) / 4 - 10);

const newTiming = (): Timing => ({ count: 0, sum: 0, max: 0, buckets: new Array<number>(BUCKETS).fill(0) });

function addTime(t: Timing, ms: number): void {
  t.count++;
  t.sum += ms;
  if (ms > t.max) t.max = ms;
  t.buckets[bucketOf(ms)]!++;
}

/** The 95th percentile, to the top of its bucket (so within a fifth). */
export function p95(t: Timing): number {
  let seen = 0;
  for (let i = 0; i < BUCKETS; i++) {
    seen += t.buckets[i]!;
    if (seen >= t.count * 0.95) return Math.min(bucketTop(i), t.max);
  }
  return t.max;
}

/** How one mode went. `wins` are the current AI's; in `--self` they are player 0's. */
export interface ModeTally {
  games: number;
  wins: number;
  /** Games over with no winner. */
  draws: number;
  /** Games stopped at the step cap. */
  timeouts: number;
  /** Matchups that could not be set up (say, a warband too big for the map's deployment zone). */
  skipped: number;
  /** Decision times: the current AI's, then the baseline's. */
  time: [Timing, Timing];
  /** `--self` only: games and wins by preset. */
  presets: Record<string, { games: number; wins: number }>;
}

export type Tally = Partial<Record<GameMode, ModeTally>>;

const newModeTally = (): ModeTally => ({ games: 0, wins: 0, draws: 0, timeouts: 0, skipped: 0, time: [newTiming(), newTiming()], presets: {} });

/** Play one game with `choosers[seat]` in each seat. The winner's seat, or how it ended without one. */
function playGame(start: GameState, choosers: [Chooser, Chooser], times: [Timing, Timing], maxSteps: number): 0 | 1 | 'draw' | 'timeout' {
  let state = start;
  for (let steps = 0; state.phase !== 'gameOver'; steps++) {
    if (steps >= maxSteps) return 'timeout';
    const seat = state.active;
    const began = performance.now();
    const command = choosers[seat](state);
    addTime(times[seat], performance.now() - began);
    state = reduce(state, command).state;
  }
  return state.winner ?? 'draw';
}

/**
 * Play `tasks` and tally them by mode. A bench plays each task twice, the AIs
 * swapping seats; `--self` (`self`) plays it once with `current` in both.
 */
export function runTasks(tasks: BenchTask[], current: Chooser, baseline: Chooser, self: boolean, maxSteps: number): Tally {
  const tally: Tally = {};
  for (const task of tasks) {
    const t = (tally[task.mode] ??= newModeTally());
    const setup: MatchSetup = {
      presets: task.presets,
      seats: ['ai', 'ai'],
      seed: task.seed,
      mapId: task.mapId,
      ...(task.mode === 'annihilation' ? {} : { mode: task.mode }),
    };
    let start: GameState;
    try {
      start = createMatchFromPresets(setup);
    } catch {
      t.skipped++;
      continue;
    }
    // Seat of the current AI in each game: first player 0, then player 1.
    for (const seat of self ? ([0] as const) : ([0, 1] as const)) {
      const choosers: [Chooser, Chooser] = seat === 0 ? [current, baseline] : [baseline, current];
      const times: [Timing, Timing] = seat === 0 ? t.time : [t.time[1], t.time[0]];
      const result = playGame(start, choosers, times, maxSteps);
      t.games++;
      if (result === 'draw') t.draws++;
      else if (result === 'timeout') t.timeouts++;
      else if (result === seat) t.wins++;
      if (self) {
        task.presets.forEach((id, p) => {
          const row = (t.presets[id] ??= { games: 0, wins: 0 });
          row.games++;
          if (result === p) row.wins++;
          else if (result === 'draw' || result === 'timeout') row.wins += 0.5;
        });
      }
    }
  }
  return tally;
}

function mergeTiming(into: Timing, from: Timing): void {
  into.count += from.count;
  into.sum += from.sum;
  into.max = Math.max(into.max, from.max);
  from.buckets.forEach((n, i) => (into.buckets[i]! += n));
}

export function mergeTally(into: Tally, from: Tally): void {
  for (const mode of Object.keys(from) as GameMode[]) {
    const f = from[mode]!;
    const t = (into[mode] ??= newModeTally());
    t.games += f.games;
    t.wins += f.wins;
    t.draws += f.draws;
    t.timeouts += f.timeouts;
    t.skipped += f.skipped;
    mergeTiming(t.time[0], f.time[0]);
    mergeTiming(t.time[1], f.time[1]);
    for (const [id, row] of Object.entries(f.presets)) {
      const mine = (t.presets[id] ??= { games: 0, wins: 0 });
      mine.games += row.games;
      mine.wins += row.wins;
    }
  }
}

/** The current AI's share of the games, a game with no winner counting half, as a fraction. */
export function winRate(t: ModeTally): number {
  return t.games === 0 ? 0.5 : (t.wins + (t.draws + t.timeouts) / 2) / t.games;
}

/** The 95% margin of {@link winRate}, as a fraction. */
export function margin(t: ModeTally): number {
  const p = winRate(t);
  return t.games === 0 ? 0 : 1.96 * Math.sqrt((p * (1 - p)) / t.games);
}

const ms = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const timeCell = (t: Timing) => (t.count === 0 ? '-' : `${ms(t.sum / t.count)} / ${ms(p95(t))} / ${ms(t.max)}`);

/** The report: per mode, the win rate with its margin, games without a winner, and each side's decision times. */
export function summarizeBench(tally: Tally, modes: GameMode[], versus: string): string {
  const lines = [`current AI vs ${versus}`, '', `${'mode'.padEnd(17)} games    win      ±   draws  timeouts  ${'AI ms: mean / p95 / max'.padEnd(26)} baseline ms`];
  for (const mode of modes) {
    const t = tally[mode];
    if (!t) continue;
    lines.push(
      [
        mode.padEnd(17),
        String(t.games).padStart(5),
        `${(100 * winRate(t)).toFixed(1)}%`.padStart(6),
        `${(100 * margin(t)).toFixed(1)}%`.padStart(6),
        String(t.draws).padStart(7),
        String(t.timeouts).padStart(9),
        ` ${timeCell(t.time[0]).padEnd(26)}`,
        timeCell(t.time[1]),
      ].join(' ') + (t.skipped > 0 ? `  (${t.skipped} matchups skipped)` : ''),
    );
  }
  return lines.join('\n');
}

/** The `--self` report: each preset's win rate per mode with one AI in both seats. */
export function summarizeSelf(tally: Tally, modes: GameMode[], who: string): string {
  const played = modes.filter((m) => tally[m]);
  const ids = [...new Set(played.flatMap((m) => Object.keys(tally[m]!.presets)))];
  const lines = [`${who} in both seats: each preset's win rate against the others of its size`, '', `${'preset'.padEnd(24)} ${played.map((m) => m.padStart(17)).join(' ')}`];
  for (const id of ids) {
    const cells = played.map((m) => {
      const row = tally[m]!.presets[id];
      return (row && row.games > 0 ? `${((100 * row.wins) / row.games).toFixed(0)}% of ${row.games}` : '-').padStart(17);
    });
    lines.push(`${id.padEnd(24)} ${cells.join(' ')}`);
  }
  return lines.join('\n');
}

async function loadBaseline(path: string): Promise<Chooser> {
  const module = (await import(pathToFileURL(resolve(path)).href)) as { chooseCommand?: Chooser };
  if (typeof module.chooseCommand !== 'function') throw new CliError(`${path} exports no chooseCommand`);
  return module.chooseCommand;
}

/** Run this share of the tasks in a child process running the same script. */
function runWorker(argv: string[], index: number, count: number): Promise<Tally> {
  return new Promise((done, fail) => {
    const child = fork(process.argv[1]!, ['bench', ...argv, '--worker', `${index}/${count}`]);
    let tally: Tally | undefined;
    child.on('message', (m) => (tally = m as Tally));
    child.on('error', fail);
    child.on('exit', (code) => (tally ? done(tally) : fail(new Error(`bench worker ${index} exited with code ${code}`))));
  });
}

/** The `bench` subcommand. Returns the process exit code. */
export async function benchMain(argv: string[], print: (line: string) => void = console.log): Promise<number> {
  const opts = parseBenchArgs(argv);
  if (opts.help) {
    print(benchHelpText());
    return 0;
  }
  const tasks = benchTasks(opts);
  if (opts.worker) {
    const { index, count } = opts.worker;
    const baseline = opts.baseline ? await loadBaseline(opts.baseline) : chooseCommand;
    const mine = tasks.filter((_, i) => i % count === index);
    process.send!(runTasks(mine, opts.self ? baseline : chooseCommand, baseline, opts.self, opts.maxSteps));
    return 0;
  }
  if (tasks.length === 0) throw new CliError('No matchups: no chosen map hosts a chosen mode, or no two chosen presets are of a size.');
  if (opts.baseline) await loadBaseline(opts.baseline);

  const started = Date.now();
  const tally: Tally = {};
  const jobs = Math.min(opts.jobs, tasks.length);
  if (jobs === 1) {
    const baseline = opts.baseline ? await loadBaseline(opts.baseline) : chooseCommand;
    mergeTally(tally, runTasks(tasks, opts.self ? baseline : chooseCommand, baseline, opts.self, opts.maxSteps));
  } else {
    const parts = await Promise.all(Array.from({ length: jobs }, (_, i) => runWorker(argv, i, jobs)));
    for (const part of parts) mergeTally(tally, part);
  }
  const versus = opts.baseline ?? 'itself';
  print(opts.self ? summarizeSelf(tally, opts.modes, opts.baseline ?? 'the current AI') : summarizeBench(tally, opts.modes, versus));
  print(`\n${((Date.now() - started) / 1000).toFixed(1)}s, ${jobs} job${jobs === 1 ? '' : 's'}`);
  return 0;
}
