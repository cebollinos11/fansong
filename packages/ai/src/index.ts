import {
  adjacentEnemies,
  aliveUnits,
  enemiesOf,
  flagAtBase,
  getLegalCommands,
  kingOf,
  makeHexGrid,
  outnumberedPenalty,
  rangePenalty,
  scoringZones,
  shortRange,
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
  const flags = flagPlan(state, board, state.active);
  const kings = kingPlan(state, board, state.active);

  let best = commands[0]!;
  let bestScore = -Infinity;
  for (const command of commands) {
    let score = flags ? scoreFlagCommand(state, board, flags, command) : scoreCommand(state, board, zones, kings, command);
    if (command.type === 'Move') score -= disengageCost(state, board, command.unitId);
    if (score > bestScore) {
      bestScore = score;
      best = command;
    }
  }
  return best;
}

/**
 * Score cost of a move that leaves contact: every standing enemy in contact gets
 * a free hack at the mover. Big enough that an ordinary reposition never pays
 * for it, small enough that a carrier's run home or a King's escape from a lone
 * foe still does.
 */
const DISENGAGE_COST = 30_000;

function disengageCost(state: GameState, board: Board, unitId: string): number {
  const mover = unitById(state, unitId)!;
  return adjacentEnemies(state, mover, board).filter((e) => !e.knockedDown).length * DISENGAGE_COST;
}

/** Score cost per point a shot loses to range or cover — worth about one point of target Combat. */
const SHOT_PENALTY_COST = 100;

/** Range and cover penalties `shooter` would take shooting `target` from where it stands. */
function shotPenalty(state: GameState, board: Board, shooter: Unit, target: Unit): number {
  const occupied = new Set(state.units.filter((u) => !u.dead).map((u) => vecKey(u.pos)));
  const cover = board.inCover(shooter.pos, target.pos, (v) => occupied.has(vecKey(v))) ? 1 : 0;
  return rangePenalty(shooter.traits.ranged, board.distance(shooter.pos, target.pos)) + cover;
}

/** A ranged mover's standoff score at `dist` from the nearest foe: short range beats long range. */
function standoffScore(ranged: number, dist: number): number {
  return (dist <= shortRange(ranged) ? 125_000 : 120_000) + dist;
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

/**
 * Dice policy: normally 2 dice (enough output, modest turnover risk). When this
 * is the player's last available unit, take the safe 1 die that can never turn
 * over, to preserve tempo.
 */
function diceScore(state: GameState, player: Owner, diceCount: number): number {
  const availableCount = aliveUnits(state, player).filter((u) => !u.activatedThisRound).length;
  if (availableCount <= 1) return diceCount === 1 ? 3 : diceCount === 2 ? 2 : 1;
  return diceCount === 2 ? 3 : diceCount === 3 ? 2 : 1;
}

function scoreCommand(
  state: GameState,
  board: Board,
  zones: ZoneView[],
  kings: KingPlan | undefined,
  command: Command,
): number {
  const player = state.active;
  const enemies = enemiesOf(state, player);

  switch (command.type) {
    case 'ChooseActivation': {
      const unit = unitById(state, command.unitId)!;
      if (kings) return kingActivationScore(state, board, kings, unit) + diceScore(state, player, command.diceCount);
      const enemyDist = nearestEnemyDistance(board, unit.pos, enemies);
      // Zone modes: a unit already holding a zone has nowhere better to be, so
      // it activates late; one with a zone to reach counts its distance to it.
      let dist = enemyDist;
      let holding = false;
      if (zones.length > 0) {
        holding = isHolding(zones, unit);
        const target = holding ? undefined : targetZone(board, zones, unit);
        if (target) dist = zoneDistance(board, unit.pos, target);
      }
      // A unit that can already fight this turn — in melee, or a shooter with a
      // foe in range — is the one worth activating first. That is about enemies,
      // never about how close the unit is to a zone.
      const canMelee = enemyDist === 1;
      const canShoot = unit.traits.ranged >= 2 && enemyDist >= 2 && enemyDist <= unit.traits.ranged;
      const canAttack = canMelee || canShoot;
      // Prefer the unit that can already fight, else the one closest to a foe.
      const unitScore = canAttack ? 100_000 : holding ? 1_000 : 10_000 - dist * 100;

      return unitScore + diceScore(state, player, command.diceCount);
    }

    case 'Attack': {
      const target = unitById(state, command.targetId)!;
      const attacker = unitById(state, command.attackerId)!;
      let score = 1_000_000;
      if (target.knockedDown) score += 5_000; // likely a kill — finish it
      score += (6 - target.combat) * 100; // focus-fire the weakest reachable foe
      score += (attacker.combat - target.combat) * 50; // favour favourable match-ups
      // Gang up: hit a foe we outnumber, not while we are the outnumbered one.
      score += (outnumberedPenalty(state, target, board) - outnumberedPenalty(state, attacker, board)) * 50;
      if (kings) {
        // Our King only trades blows to end the game or finish a downed foe;
        // stuck in melee with nowhere safer, it still hits back rather than idle.
        if (attacker.id === kings.ourKing?.id && target.id !== kings.theirKing?.id && !target.knockedDown) return 50_000;
        score += kingTargetBonus(kings, target);
      }
      return score;
    }

    case 'Shoot': {
      // Shooting deals damage with no risk of reprisal — nearly as good as a
      // melee blow, and better against a soft or already-downed target.
      const target = unitById(state, command.targetId)!;
      const shooter = unitById(state, command.attackerId)!;
      let score = 900_000;
      if (target.knockedDown) score += 5_000;
      score += (6 - target.combat) * 100; // pick off the weakest reachable foe
      score -= shotPenalty(state, board, shooter, target) * SHOT_PENALTY_COST; // a close, clear shot
      if (kings) score += kingTargetBonus(kings, target);
      return score;
    }

    case 'Move': {
      const mover = unitById(state, command.unitId)!;
      if (zones.length > 0) {
        const zoneScore = zoneMoveScore(board, zones, mover, command.to);
        if (zoneScore !== undefined) return zoneScore;
      }
      if (kings) return kingMoveScore(state, board, kings, mover, command.to);
      const dist = nearestEnemyDistance(board, command.to, enemies);
      // A ranged unit seeks a standoff: inside its range but out of melee, so it
      // can shoot next turn instead of being dragged into a fight. (When a shot
      // is already available, Shoot outscores every Move anyway.)
      if (mover.traits.ranged >= 2) {
        const r = mover.traits.ranged;
        if (dist >= 2 && dist <= r) return standoffScore(r, dist); // in the sweet spot — short range, else the edge of range
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
      // Our King with nowhere safer to go waits on guard, ready to riposte.
      if (kings && command.unitId === kings.ourKing?.id) return 10;
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

/**
 * Kill-the-king as the AI sees it, from `player`'s side: both Kings (while
 * alive) and the enemies close enough to threaten ours.
 */
interface KingPlan {
  ourKing: Unit | undefined;
  theirKing: Unit | undefined;
  /** Enemies within {@link THREAT_RANGE} of our King. */
  threats: Unit[];
  /** Living units' hexes, for line-of-sight checks (units block sight lanes). */
  occupied: Set<string>;
}

/** An enemy this close to our King is a threat the rest of the warband turns on. */
const THREAT_RANGE = 3;

/** The King plan in kill-the-king, `undefined` in every other mode. */
function kingPlan(state: GameState, board: Board, player: Owner): KingPlan | undefined {
  if (!state.mode?.kings) return undefined;
  const enemy: Owner = player === 0 ? 1 : 0;
  const living = (id: string | undefined) => {
    const u = id === undefined ? undefined : unitById(state, id);
    return u && !u.dead ? u : undefined;
  };
  // A King left on its own has no one to hide behind: it hunts like anyone else
  // (otherwise two lone Kings would shy away from each other forever).
  const alone = aliveUnits(state, player).length <= 1;
  const ourKing = alone ? undefined : living(kingOf(state, player));
  const theirKing = living(kingOf(state, enemy));
  const threats = ourKing ? enemiesOf(state, player).filter((e) => board.distance(e.pos, ourKing.pos) <= THREAT_RANGE) : [];
  const occupied = new Set(state.units.filter((u) => !u.dead).map((u) => vecKey(u.pos)));
  return { ourKing, theirKing, threats, occupied };
}

/** Extra attack/shot score: the enemy King above all (it ends the game), then threats to ours. */
function kingTargetBonus(plan: KingPlan, target: Unit): number {
  if (target.id === plan.theirKing?.id) return 300_000;
  if (plan.threats.some((t) => t.id === target.id)) return 20_000;
  return 0;
}

/**
 * How far a non-King unit at `from` is from its quarry: the nearest threat to
 * our King if there is one (protect first), else the enemy King, else simply
 * the nearest enemy.
 */
function kingHuntDistance(board: Board, plan: KingPlan, from: Vec, enemies: Unit[]): number {
  if (plan.threats.length > 0) return nearestEnemyDistance(board, from, plan.threats);
  if (plan.theirKing) return board.distance(from, plan.theirKing.pos);
  return nearestEnemyDistance(board, from, enemies);
}

/** How safe a hex is for our King: out of reach of enemies (capped), then higher ground. */
function kingSafety(board: Board, v: Vec, enemies: Unit[]): number {
  return Math.min(nearestEnemyDistance(board, v, enemies), 4) * 100 + board.elevation(v) * 10;
}

/** Whether `mover`, standing at `from`, would have a clear shot at some enemy within `range`. */
function hasShotFrom(board: Board, plan: KingPlan, mover: Unit, from: Vec, range: number, enemies: Unit[]): boolean {
  // The mover's current hex is vacated by the move, so it doesn't block.
  const blocks = (v: Vec) => plan.occupied.has(vecKey(v)) && !sameVec(mover.pos, v);
  return enemies.some((e) => {
    const d = board.distance(from, e.pos);
    return d >= 2 && d <= range && board.lineOfSight(from, e.pos, blocks);
  });
}

/**
 * Kill-the-king activation order. Anyone who can fight goes first, except
 * that our King only volunteers to shoot; otherwise it goes early when enemies
 * are closing on it (to step away) and last when they aren't. The rest go by
 * closeness to their quarry.
 */
function kingActivationScore(state: GameState, board: Board, plan: KingPlan, unit: Unit): number {
  const enemies = enemiesOf(state, state.active);
  const nearest = nearestEnemyDistance(board, unit.pos, enemies);
  const canShoot = unit.traits.ranged >= 2 && nearest >= 2 && nearest <= unit.traits.ranged;
  if (unit.id === plan.ourKing?.id) {
    if (canShoot) return 100_000;
    return nearest <= 2 ? 50_000 : 1_000;
  }
  if (nearest === 1 || canShoot) return 100_000;
  return 10_000 - Math.min(kingHuntDistance(board, plan, unit.pos, enemies), 99) * 100;
}

/**
 * Kill-the-king moves. Our King only moves to a safer hex (further from the
 * enemy, then higher) and otherwise stays put. Everyone else closes on its
 * quarry — threats to our King, then the enemy King — preferring high ground
 * (worth less than a step closer); a shooter's standoff hex only counts in
 * full with a clear line of sight to a target, a bit more with the King in range.
 */
function kingMoveScore(state: GameState, board: Board, plan: KingPlan, mover: Unit, to: Vec): number {
  const enemies = enemiesOf(state, state.active);
  if (mover.id === plan.ourKing?.id) {
    const gain = kingSafety(board, to, enemies) - kingSafety(board, mover.pos, enemies);
    return gain > 0 ? 100_000 + gain : -1;
  }
  const height = board.elevation(to) * 30;
  if (mover.traits.ranged >= 2) {
    const r = mover.traits.ranged;
    const dist = nearestEnemyDistance(board, to, enemies);
    if (dist >= 2 && dist <= r) {
      if (!hasShotFrom(board, plan, mover, to, r, enemies)) return 110_000 + height;
      const kingInRange = !!plan.theirKing && board.distance(to, plan.theirKing.pos) <= r;
      return standoffScore(r, dist) - dist + (kingInRange ? 50 : 0) + height;
    }
    if (dist < 2) return 40_000;
  }
  return 100_000 - kingHuntDistance(board, plan, to, enemies) * 100 + height;
}

/** Walking distance (steps over passable hexes) from every reachable hex to `target`. */
function distanceField(board: Board, target: Vec): Map<string, number> {
  const field = new Map<string, number>([[vecKey(target), 0]]);
  let frontier = [target];
  for (let d = 1; frontier.length > 0; d++) {
    const next: Vec[] = [];
    for (const v of frontier) {
      for (const n of board.neighbors(v)) {
        const key = vecKey(n);
        if (field.has(key)) continue;
        field.set(key, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return field;
}

/** Unreachable hexes count as this far away. */
const FAR = 999;

const walk = (field: Map<string, number>, v: Vec): number => field.get(vecKey(v)) ?? FAR;

/**
 * Capture-the-flag as the AI sees it, from `player`'s side: our carrier (if we
 * hold the enemy flag) and the way home for it, and the hexes everyone else
 * should head for — the enemy flag while it's there to grab, our own dropped
 * flag to return, and the enemy unit carrying ours to hunt down.
 */
interface FlagPlan {
  carrierId: string | undefined;
  home: Map<string, number>;
  /** Hex of the enemy flag when it lies free to pick up. */
  grab: Vec | undefined;
  /** Hex of our own flag when it lies dropped away from its base. */
  rescue: Vec | undefined;
  /** Id of the enemy unit carrying our flag. */
  enemyCarrierId: string | null;
  /** Distance fields to each of grab / rescue / enemy carrier (whichever exist). */
  goals: Map<string, number>[];
}

/** The flag plan in capture-the-flag, `undefined` in every other mode. */
function flagPlan(state: GameState, board: Board, player: Owner): FlagPlan | undefined {
  const m = state.mode;
  if (!m?.flags || !m.objectives.flags) return undefined;
  const enemy: Owner = player === 0 ? 1 : 0;
  const mine = m.flags[player];
  const theirs = m.flags[enemy];
  const grab = theirs.carrier === null ? theirs.at : undefined;
  const rescue = mine.carrier === null && !flagAtBase(state, player) ? mine.at : undefined;
  const goals: Map<string, number>[] = [];
  for (const v of [grab, rescue, mine.carrier !== null ? mine.at : undefined]) if (v) goals.push(distanceField(board, v));
  return {
    carrierId: theirs.carrier ?? undefined,
    home: distanceField(board, m.objectives.flags[player]),
    grab,
    rescue,
    enemyCarrierId: mine.carrier,
    goals,
  };
}

/** Walking distance from `v` to the nearest flag goal (`FAR` when there is none). */
function goalDistance(plan: FlagPlan, v: Vec): number {
  let min = FAR;
  for (const g of plan.goals) min = Math.min(min, walk(g, v));
  return min;
}

const sameVec = (a: Vec | undefined, b: Vec) => !!a && a.x === b.x && a.y === b.y;

/**
 * Capture-the-flag scoring. Our carrier runs for home — any step closer beats
 * fighting, and stepping onto the base (which wins) beats everything. Everyone
 * else makes for the nearest goal by walking distance: grabbing the enemy flag
 * or returning our own outranks any attack, and a blow or shot at the enemy
 * carrier outranks other attacks. With no goal left (we carry theirs and ours
 * is home) the rest fight as in annihilation.
 */
function scoreFlagCommand(state: GameState, board: Board, plan: FlagPlan, command: Command): number {
  const player = state.active;
  const enemies = enemiesOf(state, player);
  const goalOrEnemy = (to: Vec) => {
    const goal = goalDistance(plan, to);
    if (goal < FAR) return 100_000 - goal * 100;
    return 100_000 - nearestEnemyDistance(board, to, enemies) * 100;
  };

  switch (command.type) {
    case 'ChooseActivation': {
      const unit = unitById(state, command.unitId)!;
      const enemyDist = nearestEnemyDistance(board, unit.pos, enemies);
      const canAttack = enemyDist === 1 || (unit.traits.ranged >= 2 && enemyDist >= 2 && enemyDist <= unit.traits.ranged);
      const goal = goalDistance(plan, unit.pos);
      const dist = goal < FAR ? goal : enemyDist;
      let unitScore = canAttack ? 100_000 : 10_000 - Math.min(dist, 99) * 100;
      // The carrier moves first: every activation it waits is a chance to lose the flag.
      if (unit.id === plan.carrierId) unitScore = 150_000;
      return unitScore + diceScore(state, player, command.diceCount);
    }

    case 'Attack':
    case 'Shoot': {
      const targetId = command.targetId;
      const target = unitById(state, targetId)!;
      const attacker = unitById(state, command.attackerId)!;
      let score = command.type === 'Attack' ? 1_000_000 : 900_000;
      if (target.knockedDown) score += 5_000;
      score += (6 - target.combat) * 100;
      if (command.type === 'Attack') {
        score += (attacker.combat - target.combat) * 50;
        score += (outnumberedPenalty(state, target, board) - outnumberedPenalty(state, attacker, board)) * 50;
      } else score -= shotPenalty(state, board, attacker, target) * SHOT_PENALTY_COST;
      // Knocking the enemy carrier down drops our flag where we can return it.
      if (targetId === plan.enemyCarrierId) score += 200_000;
      return score;
    }

    case 'Move': {
      const mover = unitById(state, command.unitId)!;
      const to = command.to;
      if (mover.id === plan.carrierId) {
        const now = walk(plan.home, mover.pos);
        const then = walk(plan.home, to);
        if (then === 0) return 2_000_000;
        return (then < now ? 1_100_000 : 100_000) - then * 100;
      }
      if (sameVec(plan.grab, to)) return 1_500_000;
      if (sameVec(plan.rescue, to)) return 1_400_000;
      return goalOrEnemy(to);
    }

    case 'Guard':
      return 1;

    case 'EndActivation':
      return 0;
  }
}

export function playerLabel(owner: Owner): string {
  return `P${owner}`;
}
