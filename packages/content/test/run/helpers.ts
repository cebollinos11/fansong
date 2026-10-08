import { chooseCommand } from '@fansong/ai';
import { recordReplay, type Replay } from '@fansong/engine';
import { legalRunActions, newRun, runBattleConfig, runStep, type RunAction, type RunState } from '../../src/index.js';

/** Play the run's battle out with the AI in both seats. */
export function playBattle(s: RunState): Replay {
  return recordReplay(runBattleConfig(s), chooseCommand);
}

/** Take the first legal action until the run reaches one of `phases`. */
export function autoUntil(s: RunState, ...phases: RunState['phase'][]): RunState {
  for (let i = 0; i < 500 && !phases.includes(s.phase); i++) {
    const action: RunAction | undefined = legalRunActions(s)[0];
    if (!action) throw new Error(`nothing to do in the ${s.phase} phase`);
    s = runStep(s, action);
  }
  return s;
}

/** A drafted run, waiting at its first briefing. */
export function drafted(seed: number): RunState {
  return autoUntil(newRun(seed), 'briefing');
}

/** A run in its first battle. */
export function inBattle(seed: number): RunState {
  return autoUntil(newRun(seed), 'battle');
}
