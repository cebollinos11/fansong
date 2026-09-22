import {
  aliveUnits,
  enemiesOf,
  getLegalCommands,
  makeHexGrid,
  scoringZones,
  standingInZone,
  unitById,
  vecKey,
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
  const zones = zonePlan(state, state.active);

  let best = commands[0]!;
  let bestScore = -Infinity;
  for (const command of commands) {
    const score = scoreCommand(state, board, zones, command);
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

/**
 * A scoring zone (king-of-the-hill's hill, conquest's three zones) as the AI
 * sees it: its hexes and how many standing units each side has in it.
 */
interface ZoneView {
  hexes: Vec[];
  keys: Set<string>;
  ours: number;
  theirs: number;
}

/** The zones scored in the current mode, from `player`'s side (empty outside the zone modes). */
function zonePlan(state: GameState, player: Owner): ZoneView[] {
  return scoringZones(state).map((hexes) => {
    const counts = standingInZone(state, hexes);
    return {
      hexes,
      keys: new Set(hexes.map(vecKey)),
      ours: counts[player],
      theirs: counts[player === 0 ? 1 : 0],
    };
  });
}

function zoneIndexAt(zones: ZoneView[], pos: Vec): number {
  const key = vecKey(pos);
  return zones.findIndex((z) => z.keys.has(key));
}

function zoneDistance(board: Board, from: Vec, zone: ZoneView): number {
  let min = Infinity;
  for (const h of zone.hexes) {
    const d = board.distance(from, h);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Whether `unit` is holding a zone it is needed in: it stands in a zone that
 * its side would no longer hold outright without it.
 */
function isHolding(zones: ZoneView[], unit: Unit): boolean {
  if (unit.knockedDown) return false;
  const z = zones[zoneIndexAt(zones, unit.pos)];
  return !!z && z.ours - 1 <= z.theirs;
}

/**
 * The zone `unit` should head for: the nearest one its side does not yet hold
 * outright (ties → the one needing the most help, then the first). `undefined`
 * when every zone is held, so the unit goes back to hunting enemies.
 */
function targetZone(board: Board, zones: ZoneView[], unit: Unit): ZoneView | undefined {
  let best: ZoneView | undefined;
  let bestDist = Infinity;
  let bestNeed = 0;
  for (const z of zones) {
    const need = z.theirs - z.ours + 1;
    if (need <= 0) continue;
    const d = zoneDistance(board, unit.pos, z);
    if (d < bestDist || (d === bestDist && need > bestNeed)) {
      best = z;
      bestDist = d;
      bestNeed = need;
    }
  }
  return best;
}

function scoreCommand(state: GameState, board: Board, zones: ZoneView[], command: Command): number {
  const player = state.active;
  const enemies = enemiesOf(state, player);

  switch (command.type) {
    case 'ChooseActivation': {
      const unit = unitById(state, command.unitId)!;
      let dist = nearestEnemyDistance(board, unit.pos, enemies);
      // Zone modes: a unit already holding a zone has nowhere better to be, so
      // it activates late; one with a zone to reach counts its distance to it.
      let holding = false;
      if (zones.length > 0) {
        holding = isHolding(zones, unit);
        const target = holding ? undefined : targetZone(board, zones, unit);
        if (target) dist = zoneDistance(board, unit.pos, target);
      }
      // A unit that can already fight this turn — in melee, or a shooter with a
      // foe in range — is the one worth activating first.
      const canMelee = dist === 1;
      const canShoot = unit.traits.ranged >= 2 && dist >= 2 && dist <= unit.traits.ranged;
      const canAttack = canMelee || canShoot;
      // Prefer the unit that can already fight, else the one closest to a foe.
      const unitScore = canAttack ? 100_000 : holding ? 1_000 : 10_000 - dist * 100;

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
      if (zones.length > 0) {
        const zoneScore = zoneMoveScore(board, zones, mover, command.to);
        if (zoneScore !== undefined) return zoneScore;
      }
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
      // (no attack, no useful move). Kept just above ending the activation —
      // and a zone holder's preferred way to sit tight.
      if (zones.length > 0 && isHolding(zones, unitById(state, command.unitId)!)) return 10;
      return 1;
    }

    case 'EndActivation':
      return 0;
  }
}

/**
 * Zone modes: the score of moving `mover` to `to`, or `undefined` when zones
 * don't matter to it (every zone is held) and the usual enemy-seeking applies.
 * A holder stays put — shuffling within its zone scores just under ending the
 * activation, leaving far under. Anyone else heads for its target zone: stepping in beats
 * any ordinary move (a shooter's standoff included), otherwise closer is better.
 */
function zoneMoveScore(board: Board, zones: ZoneView[], mover: Unit, to: Vec): number | undefined {
  if (isHolding(zones, mover)) {
    return zones[zoneIndexAt(zones, mover.pos)]!.keys.has(vecKey(to)) ? -1 : -1_000;
  }
  const target = targetZone(board, zones, mover);
  if (!target) return undefined;
  if (target.keys.has(vecKey(to))) return 130_000;
  return 100_000 - zoneDistance(board, to, target) * 100;
}

export function playerLabel(owner: Owner): string {
  return `P${owner}`;
}
