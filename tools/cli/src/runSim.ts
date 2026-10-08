import { chooseCommand } from '@fansong/ai';
import {
  advanceCost,
  enemyPoints,
  isWounded,
  legalRunActions,
  mendWound,
  newRun,
  playerWarband,
  recruitPrice,
  runBattleConfig,
  runStep,
  RUN_TUNING,
  runVictorious,
  unitCost,
  upgradePrice,
  warbandCost,
  type RunAction,
  type RunState,
  type RunUnit,
} from '@fansong/content';
import { recordReplay, type GameMode } from '@fansong/engine';
import { CliError } from './options.js';

/**
 * The run-mode calibration sim (`pnpm play run`): the AI plays the player's
 * seat as well as the enemy's, a greedy picker makes every choice between
 * battles, and the report says how deep runs get. It is how `RUN_TUNING` is
 * set: an AI-piloted run should usually die around rounds 4–7, which a human
 * should beat.
 */

export interface RunSimOptions {
  /** How many runs to play. */
  seeds: number;
  /** Seed of the first run; the rest count up from it. */
  seed: number;
  /** Stop a run that is still alive after this many rounds. */
  maxRounds: number;
  /** Print a line per battle. */
  verbose: boolean;
  help: boolean;
}

/** Steps a battle may take before the sim calls it stalled. */
const BATTLE_STEP_CAP = 20_000;

function numberArg(flag: string, value: string | undefined, min: number): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n < min) throw new CliError(`${flag} needs a whole number of at least ${min}`);
  return n;
}

/** Parse the arguments after `run`. Throws {@link CliError} on a malformed flag. */
export function parseRunArgs(argv: string[]): RunSimOptions {
  const opts: RunSimOptions = { seeds: 20, seed: 1, maxRounds: 30, verbose: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seeds') opts.seeds = numberArg(arg, argv[++i], 1);
    else if (arg === '--seed') opts.seed = numberArg(arg, argv[++i], 0);
    else if (arg === '--max-rounds') opts.maxRounds = numberArg(arg, argv[++i], 1);
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new CliError(`Unknown option "${arg}". Try run --help.`);
  }
  return opts;
}

export function runHelpText(): string {
  return `fansong play run — run-mode calibration sim

Plays whole runs with the AI in both seats and a greedy picker choosing every
draft pick, level-up, reward and purchase, then reports how deep the runs got.

Usage: pnpm play run [options]

Options:
  --seeds <n>       Runs to play (default 20)
  --seed <n>        Seed of the first run; the rest count up (default 1)
  --max-rounds <n>  Stop a surviving run after this many rounds (default 30)
  --verbose, -v     Print a line per battle
  --help, -h        Show this help
`;
}

/** Points mending `u`'s oldest wound would give back. */
function mendGain(u: RunUnit): number {
  const wound = u.wounds?.[0];
  return wound ? unitCost(mendWound(u.unit, wound)) - unitCost(u.unit) : 0;
}

/**
 * What an action is worth in warband points, and what it costs in gold. Gold in
 * hand counts as points one for one, since that is what a recruit costs.
 */
function worth(s: RunState, action: RunAction): { points: number; price: number } {
  const unit = (id: string | undefined) => s.roster.find((u) => u.id === id)!;
  switch (action.type) {
    case 'draftPick':
      return { points: s.offer?.kind === 'draft' ? unitCost(s.offer.units[action.index]!) : 0, price: 0 };
    case 'advance': {
      const advance = s.pending!.find((p) => p.unitId === action.unitId)!.choices[action.index]!;
      return { points: advanceCost(unit(action.unitId).unit, advance), price: 0 };
    }
    case 'reward': {
      const option = s.offer?.kind === 'reward' ? s.offer.options[action.index]! : undefined;
      if (!option) return { points: 0, price: 0 };
      if (option.kind === 'gold') return { points: option.amount, price: 0 };
      if (option.kind === 'recruit') return { points: unitCost(option.unit), price: 0 };
      if (option.kind === 'mend') return { points: mendGain(unit(action.unitId)), price: 0 };
      return { points: advanceCost(unit(action.unitId).unit, option.advance), price: 0 };
    }
    case 'buyRecruit': {
      const recruit = s.offer?.kind === 'shop' ? s.offer.recruits[action.index]! : undefined;
      return recruit ? { points: unitCost(recruit), price: recruitPrice(recruit) } : { points: 0, price: 0 };
    }
    case 'buyUpgrade': {
      const advance = s.offer?.kind === 'shop' ? s.offer.upgrades[action.index]! : undefined;
      if (!advance) return { points: 0, price: 0 };
      const u = unit(action.unitId).unit;
      return { points: advanceCost(u, advance), price: upgradePrice(u, advance) };
    }
    case 'heal':
      return { points: mendGain(unit(action.unitId)), price: RUN_TUNING.shop.heal };
    default:
      return { points: 0, price: 0 };
  }
}

/**
 * The greedy picker: of the legal actions, the one worth the most points — in
 * the shop, the most points per gold, buying until nothing worth its price is
 * left. It fields everyone, never rerolls and never sells. Deterministic: ties
 * go to the first action listed.
 */
export function autoPick(s: RunState): RunAction {
  const legal = legalRunActions(s);
  const only = (type: RunAction['type']) => legal.find((a) => a.type === type);
  if (s.phase === 'briefing') return only('startBattle')!;

  let best: RunAction | undefined;
  let bestScore = 0;
  for (const action of legal) {
    const { points, price } = worth(s, action);
    const score = s.phase === 'shop' ? (price > 0 ? points / price : 0) : points;
    if (score > bestScore) [best, bestScore] = [action, score];
  }
  if (best) return best;
  const fallback = only('continue') ?? only('leaveShop') ?? legal[0];
  if (!fallback) throw new Error(`nothing to do in the ${s.phase} phase`);
  return fallback;
}

/** One battle of a simulated run. */
export interface BattleStat {
  round: number;
  mode: GameMode;
  enemy: string;
  boss: boolean;
  won: boolean;
  playerUnits: number;
  playerPoints: number;
  enemyUnits: number;
  enemyPoints: number;
  /** Lasting wounds the fielded units carried in. */
  wounds: number;
}

export interface RunResult {
  seed: number;
  /** Battles won. */
  wins: number;
  /** How the run ended: lost a battle, hit the round cap still alive, or a battle never finished. */
  end: 'lost' | 'capped' | 'stalled';
  battles: BattleStat[];
  final: RunState;
}

/** Play one whole run with the AI in both seats and {@link autoPick} choosing. */
export function simulateRun(seed: number, maxRounds: number): RunResult {
  let s = newRun(seed);
  const battles: BattleStat[] = [];
  let end: RunResult['end'] = 'capped';
  for (let step = 0; s.round <= maxRounds; step++) {
    if (step > 100_000) throw new Error(`run ${seed} never ends`);
    if (s.phase === 'over') {
      end = 'lost';
      break;
    }
    if (s.phase !== 'battle') {
      s = runStep(s, autoPick(s));
      continue;
    }
    const battle = s.battle!;
    const fielded = playerWarband(s);
    const replay = recordReplay(runBattleConfig(s), chooseCommand, BATTLE_STEP_CAP);
    if (replay.commands.length >= BATTLE_STEP_CAP) {
      end = 'stalled';
      break;
    }
    const round = s.round;
    const wounds = s.roster.filter((u) => battle.fielded!.includes(u.id) && isWounded(u)).length;
    s = runStep(s, { type: 'battleResult', replay });
    battles.push({
      round,
      mode: battle.mode,
      enemy: battle.enemy.name,
      boss: battle.enemyKing !== undefined,
      won: s.phase !== 'over',
      playerUnits: fielded.units.length,
      playerPoints: warbandCost(fielded),
      enemyUnits: battle.enemy.units.length,
      enemyPoints: warbandCost(battle.enemy),
      wounds,
    });
  }
  return { seed, wins: battles.filter((b) => b.won).length, end, battles, final: s };
}

/** One line for a battle, for `--verbose`. */
export function battleLine(seed: number, b: BattleStat): string {
  const versus = `${b.playerUnits}u/${b.playerPoints}pt vs ${b.enemyUnits}u/${b.enemyPoints}pt`;
  return `seed ${seed} round ${String(b.round).padStart(2)} ${b.won ? 'WON ' : 'LOST'} ${versus.padEnd(26)} ${b.mode}${b.boss ? ' (boss)' : ''} · ${b.enemy}`;
}

const pct = (n: number, of: number) => (of === 0 ? '  -' : `${Math.round((100 * n) / of)}%`.padStart(4));
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** The report: how deep the runs got, and how each round and mode went. */
export function summarize(results: RunResult[]): string {
  const lines: string[] = [];
  const depth = results.map((r) => r.wins + 1).sort((a, b) => a - b);
  const lost = results.filter((r) => r.end === 'lost');
  lines.push(`${results.length} runs · reached round: mean ${mean(depth).toFixed(1)}, median ${depth[Math.floor(depth.length / 2)]}, best ${depth.at(-1)}`);
  lines.push(
    `ended: ${lost.length} lost, ${results.filter((r) => r.end === 'capped').length} still alive at the cap, ${results.filter((r) => r.end === 'stalled').length} stalled · ` +
      `beat round ${RUN_TUNING.victoryRound}: ${pct(results.filter((r) => runVictorious(r.final)).length, results.length).trim()}`,
  );

  const battles = results.flatMap((r) => r.battles);
  const last = Math.max(0, ...battles.map((b) => b.round));
  lines.push('', 'round  fought   won  died here  player pts  enemy pts (budget)  units');
  for (let round = 1; round <= last; round++) {
    const here = battles.filter((b) => b.round === round);
    if (here.length === 0) continue;
    const won = here.filter((b) => b.won).length;
    lines.push(
      [
        String(round).padStart(5),
        String(here.length).padStart(7),
        pct(won, here.length).padStart(5),
        pct(here.length - won, results.length).padStart(10),
        mean(here.map((b) => b.playerPoints)).toFixed(0).padStart(11),
        `${mean(here.map((b) => b.enemyPoints)).toFixed(0)} (${enemyPoints(round)})`.padStart(19),
        `${mean(here.map((b) => b.playerUnits)).toFixed(1)} v ${mean(here.map((b) => b.enemyUnits)).toFixed(1)}`.padStart(11),
      ].join(' '),
    );
  }

  const by = (title: string, key: (b: BattleStat) => string) => {
    lines.push('', `${title.padEnd(20)} fought   won`);
    const keys = [...new Set(battles.map(key))].sort();
    for (const k of keys) {
      const here = battles.filter((b) => key(b) === k);
      lines.push(`${k.padEnd(20)} ${String(here.length).padStart(6)} ${pct(here.filter((b) => b.won).length, here.length).padStart(5)}`);
    }
  };
  by('mode', (b) => b.mode);
  by('enemy', (b) => b.enemy);
  return lines.join('\n');
}

/** The `run` subcommand. Returns the process exit code. */
export function runSimMain(argv: string[], print: (line: string) => void = console.log): number {
  const opts = parseRunArgs(argv);
  if (opts.help) {
    print(runHelpText());
    return 0;
  }
  const started = Date.now();
  const results: RunResult[] = [];
  for (let i = 0; i < opts.seeds; i++) {
    const result = simulateRun(opts.seed + i, opts.maxRounds);
    results.push(result);
    if (opts.verbose) for (const b of result.battles) print(battleLine(result.seed, b));
  }
  print(summarize(results));
  print(`\n${((Date.now() - started) / 1000).toFixed(1)}s`);
  return results.some((r) => r.end === 'stalled') ? 1 : 0;
}
