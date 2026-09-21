import { getLegalCommands } from './legal.js';
import { reduce } from './reduce.js';
import type { Command, GameState, ReduceResult } from './types.js';

/**
 * Structural equality for two commands, so a candidate can be matched against
 * the {@link getLegalCommands} list. Pure and framework-free: the UI, the CLI,
 * and a server all decide "is this command legal" the same way, so none can
 * drift from the others on what the rules allow.
 */
export function commandsEqual(a: Command, b: Command): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'ChooseActivation':
      return b.type === 'ChooseActivation' && a.unitId === b.unitId && a.diceCount === b.diceCount;
    case 'Move':
      return b.type === 'Move' && a.unitId === b.unitId && a.to.x === b.to.x && a.to.y === b.to.y;
    case 'Attack':
      return b.type === 'Attack' && a.attackerId === b.attackerId && a.targetId === b.targetId;
    case 'Shoot':
      return b.type === 'Shoot' && a.attackerId === b.attackerId && a.targetId === b.targetId;
    case 'Guard':
      return b.type === 'Guard' && a.unitId === b.unitId;
    case 'EndActivation':
      return b.type === 'EndActivation';
  }
}

/** Whether `command` is in the legal set for the player currently to act. */
export function isLegalCommand(state: GameState, command: Command): boolean {
  return getLegalCommands(state).some((c) => commandsEqual(c, command));
}

/**
 * The authoritative guard: validate `command` against the engine's legal set and
 * reduce it, throwing if it is not currently legal. This is the exact seam every
 * client applies commands through — the local UI controller, the headless CLI,
 * and (M4) the server-authoritative Durable Object — so an illegal move is
 * rejected identically everywhere. Callers should derive commands from
 * {@link getLegalCommands}; the throw is a guard against bugs and untrusted input.
 */
export function applyCommand(state: GameState, command: Command): ReduceResult {
  if (!isLegalCommand(state, command)) {
    throw new Error(`illegal command: ${JSON.stringify(command)}`);
  }
  return reduce(state, command);
}
