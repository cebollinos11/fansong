import { chooseCommand } from '@fansong/ai';
import { createDemoGame, reduce, type GameState } from '@fansong/engine';
import { formatEvent, renderBoard, renderRoster } from './format.js';

interface Options {
  seed: number;
  maxSteps: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { seed: 42, maxSteps: 5000, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seed') opts.seed = Number(argv[++i]);
    else if (arg === '--max-steps') opts.maxSteps = Number(argv[++i]);
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (arg === '--help' || arg === '-h') {
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
  --max-steps <n>  Safety cap on reduce steps (default 5000)
  --quiet, -q      Only print setup and final result
  --help, -h       Show this help
`);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  let state: GameState = createDemoGame(opts.seed);

  console.log(`FanSong — AI vs AI (seed ${opts.seed})\n`);
  console.log(renderBoard(state));
  console.log('');
  console.log(renderRoster(state));
  console.log('\n=== Round 1 begins — P0 leads ===');

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
