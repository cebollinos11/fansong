import {
  aliveUnits,
  enemiesOf,
  getLegalCommands,
  makeHexGrid,
  unitById,
  type Board,
  type Command,
  type GameState,
  type Owner,
  type Unit,
  type Vec,
} from '@fansong/engine';

/**
 * Deterministic heuristic opponent. It speaks only `Command`, so the same code
 * is both the PvE opponent and the AI-vs-AI test bot.
 *
 * It scores the legal commands and picks the best; ties break toward the
 * earlier command, and `getLegalCommands` is deterministically ordered, so a
 * given state always yields the same choice.
 */
export function chooseCommand(state: GameState): Command {
  const commands = getLegalCommands(state);
  if (commands.length === 0) {
    throw new Error('chooseCommand called with no legal commands');
  }
  const board = makeHexGrid(state.board);

  let best = commands[0]!;
  let bestScore = -Infinity;
  for (const command of commands) {
    const score = scoreCommand(state, board, command);
    if (score > bestScore) {
      bestScore = score;
      best = command;
    }
  }
  return best;
}

function nearestEnemyDistance(board: Board, from: Vec, enemies: Unit[]): number {
  let min = Infinity;
  for (const e of enemies) {
    const d = board.distance(from, e.pos);
    if (d < min) min = d;
  }
  return min;
}

function scoreCommand(state: GameState, board: Board, command: Command): number {
  const player = state.active;
  const enemies = enemiesOf(state, player);

  switch (command.type) {
    case 'ChooseActivation': {
      const unit = unitById(state, command.unitId)!;
      const dist = nearestEnemyDistance(board, unit.pos, enemies);
      // A unit that can already fight this turn — in melee, or a shooter with a
      // foe in range — is the one worth activating first.
      const canMelee = dist === 1;
      const canShoot = unit.traits.ranged >= 2 && dist >= 2 && dist <= unit.traits.ranged;
      const canAttack = canMelee || canShoot;
      // Prefer the unit that can already fight, else the one closest to a foe.
      const unitScore = canAttack ? 100_000 : 10_000 - dist * 100;

      // Dice policy: normally 2 dice (enough output, modest turnover risk). When
      // this is the player's last available unit, take the safe 1 die that can
      // never turn over, to preserve tempo.
      const availableCount = aliveUnits(state, player).filter((u) => !u.activatedThisRound).length;
      let diceScore: number;
      if (availableCount <= 1) {
        diceScore = command.diceCount === 1 ? 3 : command.diceCount === 2 ? 2 : 1;
      } else {
        diceScore = command.diceCount === 2 ? 3 : command.diceCount === 3 ? 2 : 1;
      }
      return unitScore + diceScore;
    }

    case 'Attack': {
      const target = unitById(state, command.targetId)!;
      const attacker = unitById(state, command.attackerId)!;
      let score = 1_000_000;
      if (target.knockedDown) score += 5_000; // likely a kill — finish it
      score += (6 - target.combat) * 100; // focus-fire the weakest reachable foe
      score += (attacker.combat - target.combat) * 50; // favour favourable match-ups
      return score;
    }

    case 'Shoot': {
      // Shooting deals damage with no risk of reprisal — nearly as good as a
      // melee blow, and better against a soft or already-downed target.
      const target = unitById(state, command.targetId)!;
      let score = 900_000;
      if (target.knockedDown) score += 5_000;
      score += (6 - target.combat) * 100; // pick off the weakest reachable foe
      return score;
    }

    case 'Move': {
      const mover = unitById(state, command.unitId)!;
      const dist = nearestEnemyDistance(board, command.to, enemies);
      // A ranged unit seeks a standoff: inside its range but out of melee, so it
      // can shoot next turn instead of being dragged into a fight. (When a shot
      // is already available, Shoot outscores every Move anyway.)
      if (mover.traits.ranged >= 2) {
        const r = mover.traits.ranged;
        if (dist >= 2 && dist <= r) return 120_000 + dist; // in the sweet spot — hold at the edge of range
        if (dist < 2) return 40_000; // stepping into melee is a last resort for a shooter
        return 100_000 - dist * 100; // out of range: close the gap
      }
      // Melee: close the distance; always beats ending, never beats attacking.
      return 100_000 - dist * 100;
    }

    case 'Guard': {
      // A last-resort defensive stance: only when there's nothing better to do
      // (no attack, no useful move). Kept just above ending the activation.
      return 1;
    }

    case 'EndActivation':
      return 0;
  }
}

export function playerLabel(owner: Owner): string {
  return `P${owner}`;
}
