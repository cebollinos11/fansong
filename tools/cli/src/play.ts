import { chooseCommand } from '@fansong/ai';
import { reduce } from '@fansong/engine';
import { formatEvent, renderBoard, renderRoster } from './format.js';
import { CliError, helpText, listText, parseArgs, resultLine, setupMatch } from './options.js';

function main(): void {
  let opts;
  let setup;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(helpText());
      return;
    }
    if (opts.list) {
      console.log(listText());
      return;
    }
    setup = setupMatch(opts);
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
    console.error(err.message);
    process.exit(2);
  }
  let state = setup.state;

  console.log(`FanSong — AI vs AI · ${setup.label} (seed ${opts.seed})\n`);
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
  console.log(resultLine(state, steps, opts.maxSteps));
  if (state.phase !== 'gameOver') process.exitCode = 1;
}

main();
