import { chooseCommand } from '@fansong/ai';
import {
  buildMatch,
  DEFAULT_BOARD,
  getPreset,
  PRESET_IDS,
  PRESETS,
  validateWarband,
  warbandCost,
  type Warband,
} from '@fansong/content';
import { createDemoGame, createGame, reduce, type GameState } from '@fansong/engine';
import { formatEvent, renderBoard, renderRoster } from './format.js';

interface Options {
  seed: number;
  maxSteps: number;
  quiet: boolean;
  p0: string | null;
  p1: string | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { seed: 42, maxSteps: 5000, quiet: false, p0: null, p1: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seed') opts.seed = Number(argv[++i]);
    else if (arg === '--max-steps') opts.maxSteps = Number(argv[++i]);
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (arg === '--p0') opts.p0 = argv[++i] ?? null;
    else if (arg === '--p1') opts.p1 = argv[++i] ?? null;
    else if (arg === '--list') {
      printPresets();
      process.exit(0);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`fansong play — headless AI-vs-AI runner

Usage: pnpm play [options]

Options:
  --seed <n>       RNG seed (default 42)
  --p0 <preset>    Warband for player 0 (default: built-in demo)
  --p1 <preset>    Warband for player 1 (default: built-in demo)
  --list           List available preset warbands and exit
  --max-steps <n>  Safety cap on reduce steps (default 5000)
  --quiet, -q      Only print setup and final result
  --help, -h       Show this help

Presets: ${PRESET_IDS.join(', ')}
`);
}

function printPresets(): void {
  console.log('Preset warbands:\n');
  for (const id of PRESET_IDS) {
    const wb = PRESETS[id]!;
    console.log(`  ${id.padEnd(18)} ${wb.name}  (${warbandCost(wb)} pts, ${wb.units.length} units)`);
  }
}

/** Resolve a preset id or exit with a helpful error. */
function requirePreset(id: string): Warband {
  const wb = getPreset(id);
  if (!wb) {
    console.error(`Unknown preset "${id}". Try --list. Known: ${PRESET_IDS.join(', ')}`);
    process.exit(2);
  }
  const check = validateWarband(wb);
  if (!check.ok) {
    console.error(`Preset "${id}" is illegal: ${check.errors.join('; ')}`);
    process.exit(2);
  }
  return wb;
}

function setup(opts: Options): { state: GameState; label: string } {
  // Both presets given -> a warband match; otherwise fall back to the demo.
  if (opts.p0 || opts.p1) {
    const w0 = requirePreset(opts.p0 ?? 'free-company');
    const w1 = requirePreset(opts.p1 ?? 'free-company');
    const config = buildMatch(w0, w1, { seed: opts.seed, board: DEFAULT_BOARD });
    return {
      state: createGame(config),
      label: `${w0.name} (P0) vs ${w1.name} (P1)`,
    };
  }
  return { state: createDemoGame(opts.seed), label: 'demo warbands' };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const { state: initial, label } = setup(opts);
  let state = initial;

  console.log(`FanSong — AI vs AI · ${label} (seed ${opts.seed})\n`);
  console.log(renderBoard(state));
  console.log('');
  console.log(renderRoster(state));
  console.log(`\n=== Round 1 begins — P${state.initiativeLeader} leads ===`);

  let steps = 0;
  while (state.phase !== 'gameOver' && steps < opts.maxSteps) {
    const command = chooseCommand(state);
    const result = reduce(state, command);
    state = result.state;
    steps++;
    if (!opts.quiet) {
      for (const e of result.events) console.log(formatEvent(state, e));
    }
  }

  console.log('');
  console.log(renderBoard(state));
  console.log('');
  console.log(renderRoster(state));
  console.log('');
  if (state.phase === 'gameOver') {
    console.log(`Result: P${state.winner} wins after ${state.round} round(s), ${steps} steps.`);
  } else {
    console.log(`Result: no winner within ${opts.maxSteps} steps (stopped at round ${state.round}).`);
    process.exitCode = 1;
  }
}

main();
