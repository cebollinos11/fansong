import {
  adjacentEnemies,
  airborne,
  aliveUnits,
  bigMeleeBonus,
  bigTargetBonus,
  BREAK_FREE_COST,
  canWarCry,
  isDown,
  spellTargets,
  warCryTargets,
  combatOdds,
  enemiesOf,
  flyingMeleeBonus,
  flyingTargetBonus,
  flagAtBase,
  isKing,
  isPig,
  pigExtracted,
  pigOf,
  getLegalCommands,
  groupFor,
  kingOf,
  makeHexGrid,
  masteryEdge,
  opportunistBonus,
  pincerBonus,
  sharpshooterBonus,
  shieldwallBonus,
  slipsAway,
  woodwiseBonus,
  outnumberedPenalty,
  rangePenalty,
  scoringZones,
  shortRange,
  standingInZone,
  unitById,
  unitMove,
  vecKey,
  type Board,
  type ChooseActivation,
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
  const zones = zonePlan(state, board, state.active);
  const flags = flagPlan(state, board, state.active);
  const kings = kingPlan(state, board, state.active);

  let best = commands[0]!;
  let bestScore = -Infinity;
  for (const command of commands) {
    let score = flags ? scoreFlagCommand(state, board, flags, command) : scoreCommand(state, board, zones, kings, command);
    if (command.type === 'Move') score -= disengageCost(state, board, command.unitId);
    if (command.type === 'Move') score += lavaMoveEdge(state, board, unitById(state, command.unitId)!, command.to);
    if (command.type === 'Attack') {
      score += lavaAttackEdge(state, board, unitById(state, command.attackerId)!, unitById(state, command.targetId)!);
    }
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
  // A flyer lifts away without drawing a hack, and a Slippery unit ducks out, so leaving contact costs them nothing.
  if (slipsAway(state, mover)) return 0;
  return adjacentEnemies(state, mover, board).filter((e) => !e.knockedDown).length * DISENGAGE_COST;
}

/**
 * Whether losing a melee to `by` would send `unit` into lava: shoved into an
 * empty lava hex while on the ground, or knocked out of the air over one. Only
 * half of a lost melee is a push (an odd die), but either way it is a death no
 * Tough save stops, so it is worth weighing both ways.
 */
function lavaAtRisk(state: GameState, board: Board, unit: Unit, by: Vec, at: Vec = unit.pos): boolean {
  if (airborne(state, unit)) return board.isDeadly(at);
  const behind = board.stepAway(by, at);
  if (!board.inBounds(behind) || !board.isDeadly(behind)) return false;
  return !state.units.some((u) => !u.dead && u.id !== unit.id && u.pos.x === behind.x && u.pos.y === behind.y);
}

/** Score for a blow that could put the foe in the lava, or cost us ours in it. */
const LAVA_ATTACK_EDGE = 2_000;

/** Attack a foe with lava at its back; think twice before swinging from where a loss drops us in. */
function lavaAttackEdge(state: GameState, board: Board, attacker: Unit, target: Unit): number {
  return (
    (lavaAtRisk(state, board, target, attacker.pos) ? LAVA_ATTACK_EDGE : 0) -
    (lavaAtRisk(state, board, attacker, target.pos) ? LAVA_ATTACK_EDGE : 0)
  );
}

/** Per foe: a move's worth of pinning it against lava, or of giving it the chance to do so to us. */
const LAVA_MOVE_EDGE = 400;

/**
 * Where to stand around lava: beside a grounded foe that has lava behind it
 * (away from us) is a good place to fight from; beside a foe with lava behind
 * *us* — or, for a flyer, hovering over lava within reach of a foe — is a bad
 * one. Worth a few hexes of approach, never a free hack.
 */
function lavaMoveEdge(state: GameState, board: Board, mover: Unit, to: Vec): number {
  let edge = 0;
  for (const e of enemiesOf(state, mover.owner)) {
    if (e.dead) continue;
    const d = board.distance(e.pos, to);
    if (d === 1) {
      if (!e.knockedDown && lavaAtRisk(state, board, mover, e.pos, to)) edge -= LAVA_MOVE_EDGE;
      if (lavaAtRisk(state, board, e, to)) edge += LAVA_MOVE_EDGE;
    } else if (airborne(state, mover) && board.isDeadly(to) && d <= Math.max(unitMove(e) + 1, e.traits.ranged)) {
      // A flyer over lava is one knockdown from death: keep off it within a foe's reach.
      edge -= LAVA_MOVE_EDGE;
    }
  }
  return edge;
}

/** Score cost per point a shot loses to range or cover — worth about one point of target Combat. */
const SHOT_PENALTY_COST = 100;

/**
 * How far a shot at `target` from where `shooter` stands is stacked against it:
 * range, cover and a Woodwise target's trees, less the points a Big, airborne or (to an Opportunist) downed target, a Sharpshooter's eye and a Woodwise shooter's own trees hand the shooter. Negative means
 * the shot is better than an unmodified one.
 */
function shotPenalty(state: GameState, board: Board, shooter: Unit, target: Unit): number {
  const occupied = new Set(state.units.filter((u) => !u.dead).map((u) => vecKey(u.pos)));
  const cover = board.inCover(shooter.pos, target.pos, (v) => occupied.has(vecKey(v))) ? 1 : 0;
  return (
    rangePenalty(shooter.traits.ranged, board.distance(shooter.pos, target.pos)) +
    cover +
    woodwiseBonus(state, board, target) -
    woodwiseBonus(state, board, shooter) -
    bigTargetBonus(target) -
    flyingTargetBonus(state, target) -
    opportunistBonus(shooter, target) -
    sharpshooterBonus(shooter)
  );
}

/**
 * How much a two-action blow or shot is worth against swinging twice with the
 * same actions. Kept well below the ±50 steps target selection uses, so it only
 * ever decides *how* to hit the foe the AI already picked, never *which* foe.
 */
const PRESSED_EDGE = 10;

/**
 * Should the aggressor spend both actions on one pressed blow, or swing twice?
 * Two swings are two chances to kill, so they normally win. The exceptions:
 *
 * - **Melee**, when the match-up is against us (the defender is no weaker, once
 *   outnumbering is counted): each exchange risks *our* neck, so buying better
 *   odds beats buying a second exchange.
 * - **Shooting**, when range and cover have already eaten 2 points: a raw shot
 *   that is unlikely to land at all is not worth firing twice.
 *
 * Returns the bonus to add for the pressed variant (negative = swing twice).
 */
function pressedEdge(worthIt: boolean, pressed: boolean): number {
  return pressed === worthIt ? PRESSED_EDGE : -PRESSED_EDGE;
}

/** How far the melee is stacked our way: our Combat less the foe's, both after size, flight, opportunism, pincers, shieldwalls, woods and outnumbering. */
function meleeEdge(state: GameState, board: Board, attacker: Unit, target: Unit): number {
  return (
    attacker.combat +
    bigMeleeBonus(attacker, target) +
    flyingMeleeBonus(state, attacker, target) +
    opportunistBonus(attacker, target) +
    pincerBonus(state, board, attacker, target) +
    woodwiseBonus(state, board, attacker) -
    outnumberedPenalty(state, attacker, board) -
    (target.combat +
      bigMeleeBonus(target, attacker) +
      opportunistBonus(target, attacker) +
      shieldwallBonus(state, board, target) +
      woodwiseBonus(state, board, target) -
      outnumberedPenalty(state, target, board))
  );
}

/** Traits that make a unit worth more to keep (or to kill), each counted once. */
const VALUED_TRAITS = [
  'fast', 'tough', 'guard', 'big', 'flying', 'reassembling', 'opportunist',
  'savage', 'leader', 'armored', 'sharpshooter', 'mastery',
  'shieldwall', 'rusher', 'slippery', 'whirling', 'immovable', 'woodwise', 'trample',
] as const;

/**
 * Rough worth of a unit, after the point-buy formula: Combat and traits,
 * scaled by how reliably it activates (lower Quality is better).
 */
function unitValue(u: Unit): number {
  let traits = u.traits.ranged > 0 ? 1 : 0;
  for (const t of VALUED_TRAITS) if (u.traits[t]) traits++;
  return ((u.combat + 1 + traits * 0.6) * (7 - u.quality)) / 4;
}

/** What a King is worth in kill-the-king, in {@link unitValue} terms: the game rides on it. */
const KING_WORTH = 30;

/** {@link unitValue}, except that a King — or the golden Pig — is worth the game. */
function worthOf(state: GameState, u: Unit): number {
  return isKing(state, u.id) || isPig(state, u.id) ? KING_WORTH : unitValue(u);
}

/** Score per unit of {@link blowValue}: wide enough to rank targets, far below the gap to a move. */
const EV_SCALE = 10_000;

/**
 * What a blow or shot by `attacker` on `target` is worth, from the exact odds:
 * a kill is the target's whole worth (a Tough save turns it into a knockdown),
 * a lesser hit — knocked down or pushed — a share of it, and a lost melee costs
 * a share of the attacker's. A single swing with a second action behind it
 * counts that follow-up too, so it compares fairly against a pressed one.
 */
function blowValue(
  state: GameState,
  board: Board,
  attacker: Unit,
  target: Unit,
  pressed: boolean,
  ranged: boolean,
  from?: Vec,
  actions = state.actionsRemaining,
): number {
  const odds = combatOdds(state, attacker.id, target.id, { pressed, ranged, from });
  const at = from ?? attacker.pos;
  const vt = worthOf(state, target);
  const killWorth = target.traits.tough && !target.knockedDown ? vt * 0.5 : vt;
  // A push off the map is a kill: about half of a lesser win or loss is a push.
  const hurtWorth = edgeBehind(board, target.pos, at) ? (killWorth + vt * 0.3) / 2 : vt * 0.3;
  const lossWorth = worthOf(state, attacker) * (!ranged && edgeBehind(board, at, target.pos) ? 0.7 : 0.4);
  const ev = odds.kill * killWorth + (odds.win - odds.kill) * hurtWorth - odds.lose * lossWorth;
  return !pressed && actions >= 2 ? ev * 1.8 : ev;
}

/** Whether a unit at `at` pushed back by a foe at `by` would go off the edge of the map. */
function edgeBehind(board: Board, at: Vec, by: Vec): boolean {
  return !board.inBounds(board.stepAway(by, at));
}

/** Score per unit of {@link blowValue} for the charge a move sets up: a few hexes of approach at most. */
const CHARGE_SCALE = 1_000;

/**
 * How good a fight `mover` walks into by ending its move at `to`: with an
 * action left to strike, the best blow it could land from there — outnumbering
 * and high ground included — so it charges where the odds favour it.
 */
function chargeEdge(state: GameState, board: Board, mover: Unit, to: Vec): number {
  const left = state.actionsRemaining - 1;
  if (left < 1) return 0;
  let best = -Infinity;
  for (const e of enemiesOf(state, mover.owner)) {
    if (board.distance(e.pos, to) !== 1) continue;
    best = Math.max(best, blowValue(state, board, mover, e, false, false, to, left));
  }
  return best === -Infinity ? 0 : best * CHARGE_SCALE;
}

/** Activation score per unit of {@link blowValue}: orders fighters, never lifts one above a war-crying Leader. */
const ORDER_SCALE = 500;

/** The best melee blow `unit` could strike from where it stands, as if activated with two actions. */
function bestBlowNow(state: GameState, board: Board, unit: Unit): number {
  let best = 0;
  for (const e of adjacentEnemies(state, unit, board)) {
    best = Math.max(best, blowValue(state, board, unit, e, false, false, undefined, 2));
  }
  return Math.min(best, 15);
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
  theirs: number;
  /** Walking distance from every reachable hex to the nearest hex of the zone. */
  field: Map<string, number>;
  /** Ids of the units sent to take (or contest) this zone — see {@link assignZones}. */
  claimants: Set<string>;
}

/** The zones scored in the current mode, from `player`'s side (empty outside the zone modes). */
function zonePlan(state: GameState, board: Board, player: Owner): ZoneView[] {
  const zones = scoringZones(state).map((hexes) => {
    const counts = standingInZone(state, hexes);
    return {
      hexes,
      keys: new Set(hexes.map(vecKey)),
      theirs: counts[player === 0 ? 1 : 0],
      field: zoneField(state, board, hexes),
      claimants: new Set<string>(),
    };
  });
  assignZones(state, zones, player);
  return zones;
}

/**
 * Walking distances to a zone's hexes, cached per map: terrain never changes
 * mid-game, and on a big map the fields are the costliest part of a decision.
 */
const zoneFields = new Map<string, Map<string, number>>();

function zoneField(state: GameState, board: Board, hexes: Vec[]): Map<string, number> {
  const key = JSON.stringify(state.board) + JSON.stringify(hexes);
  let field = zoneFields.get(key);
  if (!field) {
    if (zoneFields.size >= 16) zoneFields.clear();
    field = distanceField(board, ...hexes);
    zoneFields.set(key, field);
  }
  return field;
}

/**
 * Share the warband out among the zones, all at once rather than each unit on
 * its own: repeatedly pair the unit and zone that are closest by walking
 * distance, first until every zone has enough units to outnumber the enemy's
 * there, then again for a {@link ZONE_SPARES spare} or two to keep it. Units
 * already in a zone are closest to it, so they are the first to stay; anyone
 * left over hunts.
 */
function assignZones(state: GameState, zones: ZoneView[], player: Owner): void {
  const spares = zones.length === 1 ? ZONE_SPARES.hill : ZONE_SPARES.conquest;
  const free = aliveUnits(state, player);
  const fill = (wanted: (z: ZoneView) => number) => {
    for (;;) {
      let best: { unit: Unit; zone: ZoneView } | undefined;
      let bestDist = FAR;
      for (const unit of free) {
        for (const z of zones) {
          if (z.claimants.size >= wanted(z)) continue;
          const d = walk(z.field, unit.pos);
          if (d < bestDist) {
            best = { unit, zone: z };
            bestDist = d;
          }
        }
      }
      if (!best) return;
      best.zone.claimants.add(best.unit.id);
      free.splice(free.indexOf(best.unit), 1);
    }
  };
  fill((z) => z.theirs + 1);
  fill((z) => z.theirs + 1 + spares);
}

/**
 * Units sent to a zone beyond the bare majority, as a margin against a unit
 * being knocked down or pushed out before the round is scored. The lone hill
 * gets more: it is the whole game.
 */
const ZONE_SPARES = { hill: 2, conquest: 1 };

function zoneIndexAt(zones: ZoneView[], pos: Vec): number {
  const key = vecKey(pos);
  return zones.findIndex((z) => z.keys.has(key));
}

/** Walking distance from `from` to `zone` (`FAR` when it can't be reached on foot). */
function zoneDistance(from: Vec, zone: ZoneView): number {
  return walk(zone.field, from);
}

/**
 * Whether `unit` should stay where it is: on its feet in the zone it was sent
 * to (see {@link assignZones}), whether needed to hold it or as a spare.
 */
function sitsInZone(zones: ZoneView[], unit: Unit): boolean {
  return !unit.knockedDown && !!targetZone(zones, unit)?.keys.has(vecKey(unit.pos));
}

/**
 * The zone `unit` was sent to (see {@link assignZones}), or `undefined` when it
 * isn't needed at any zone, so it goes back to hunting enemies.
 */
function targetZone(zones: ZoneView[], unit: Unit): ZoneView | undefined {
  return zones.find((z) => z.claimants.has(unit.id));
}

/**
 * How many friends a war cry from `leader` would inspire right now: the living
 * non-Leaders of its side still to activate this round, in its range and sight.
 * Zero when it can't cry.
 */
function warCryReach(state: GameState, leader: Unit): number {
  if (!canWarCry(state, leader)) return 0;
  return warCryTargets(state, leader, makeHexGrid(state.board)).length;
}

/**
 * A war cry is worth an action once it inspires at least this many friends: it
 * then outranks even an attack, so the Leader cries first and fights after.
 */
const WAR_CRY_QUORUM = 2;

/** Score of a war cry by `leader`: before anything else with a quorum, else just above guarding. */
function warCryScore(state: GameState, leader: Unit): number {
  return warCryReach(state, leader) >= WAR_CRY_QUORUM ? 1_050_000 : 5;
}

/**
 * Activation score floor for a Leader whose war cry would reach a quorum: it
 * goes first, ahead of anyone who can merely fight, so the rest roll inspired.
 */
function leaderFirst(state: GameState, unit: Unit, score: number): number {
  return warCryReach(state, unit) >= WAR_CRY_QUORUM ? Math.max(score, 110_000) : score;
}

/**
 * Dice policy: normally 2 dice (enough output, modest turnover risk). When this
 * is the player's last available unit, a turnover benches nothing, and a unit
 * that turns over still takes the actions its successes earned — so 3 dice is
 * strictly best.
 */
function diceScore(state: GameState, board: Board, command: ChooseActivation): number {
  const { diceCount } = command;
  const members = activated(state, board, command);
  const availableCount = aliveUnits(state, members[0]!.owner).filter((u) => !u.activatedThisRound).length;
  // A group takes all its members' actions for one roll's risk: better than going alone.
  const together = command.group ? 4 : 0;
  if (availableCount <= members.length) return together + diceCount;
  return together + (diceCount === 2 ? 3 : diceCount === 3 ? 2 : 1);
}

/** Worth of a unit's 1st, 2nd and 3rd action this activation (later ones matter less). */
const ACTION_WORTH = [1, 0.8, 0.5];

/** What a turnover costs per friend it benches: that friend's activation this round. */
const BENCH_COST = 1;

/**
 * Expected worth of activating `members` (one unit, or a group sharing the
 * roll) with `dice` dice: the actions the successes buy each of them (less the
 * one a knocked-down unit spends standing), less the chance of a turnover times
 * the activations it would cost the friends still waiting. The first die is a
 * sure success when every member is inspired.
 */
function activationWorth(members: Unit[], dice: number, need: (u: Unit) => number, waiting: number): number {
  const p = Math.min(1, Math.max(0, (7 - members[0]!.quality) / 6));
  const sure = members.every((u) => u.inspired) ? 1 : 0;
  const rolled = dice - sure;
  const needs = members.map(need);
  let worth = 0;
  for (let hits = 0; hits <= rolled; hits++) {
    const prob = binomial(rolled, hits) * p ** hits * (1 - p) ** (rolled - hits);
    const successes = hits + sure;
    const failures = dice - successes;
    let actions = 0;
    members.forEach((unit, m) => {
      for (let i = unit.knockedDown ? 1 : 0; i < successes; i++) actions += ACTION_WORTH[i]! * needs[m]!;
      if (unit.knockedDown && successes > 0) actions += 0.5; // back on its feet
    });
    worth += prob * (actions - (failures >= 2 ? waiting * BENCH_COST : 0));
  }
  return worth;
}

// --- Magic ------------------------------------------------------------------

/** The range a Magic User keeps its foes at: the reach of a spell of power 2. */
const CASTER_STANDOFF = 5;

/** What holding a foe transfixed is worth, as a share of its {@link worthOf}: out of the fight, and one blow from dead. */
const TRANSFIX_WORTH = 0.6;

/** How much more a transfixed foe is worth with one of our fighters still to act and near enough to cut it down. */
const TRANSFIX_FINISH = 1.6;

/** How much less it is worth with no one to follow the spell up: it only sits out until it breaks free. */
const TRANSFIX_ALONE = 0.6;

/** How much more it is worth once it has activated this round: it cannot even try to break free until the next. */
const TRANSFIX_SPENT = 1.5;

/** What a turnover costs a spell turn or a roll to break free, per friend it benches, in {@link worthOf} terms. */
const MAGIC_BENCH_COST = 1.5;

/** A spell turn worth less than this is not worth giving up the caster's ordinary activation for. */
const MIN_SPELL_WORTH = 0.8;

/** The chance a die against `quality` comes up a success. */
const successChance = (quality: number) => Math.min(1, Math.max(0, (7 - quality) / 6));

/** The chance of each number of successes on `dice` dice against `quality`, the first a sure one when `inspired`. */
function successOdds(quality: number, dice: number, inspired: boolean): number[] {
  const p = successChance(quality);
  const sure = inspired ? 1 : 0;
  const rolled = dice - sure;
  const odds = new Array<number>(dice + 1).fill(0);
  for (let hits = 0; hits <= rolled; hits++) odds[hits + sure] = binomial(rolled, hits) * p ** hits * (1 - p) ** (rolled - hits);
  return odds;
}

/**
 * What casting Transfix on `target` with `power` is worth: the chance it fails
 * to resist, times a share of its worth — more when a friend still to act can
 * reach it (or shoot it) and finish it, and when it has already activated and
 * so stays held into the next round; next to nothing when it is held already.
 */
function castValue(state: GameState, board: Board, caster: Unit, target: Unit, power: number): number {
  if (target.transfixedBy !== undefined) return 0.01;
  const caught = 1 - successChance(target.quality) ** power;
  const finisher = aliveUnits(state, caster.owner).some((u) => {
    if (u.id === caster.id || isDown(u) || (u.activatedThisRound && !target.activatedThisRound)) return false;
    const d = board.distance(u.pos, target.pos);
    return d <= unitMove(u) + 1 || (u.traits.ranged >= 2 && d <= u.traits.ranged);
  });
  const follow = finisher ? TRANSFIX_FINISH : TRANSFIX_ALONE;
  const spent = target.activatedThisRound ? TRANSFIX_SPENT : 1;
  return caught * worthOf(state, target) * TRANSFIX_WORTH * follow * spent;
}

/** The best {@link castValue} a spell of `power` by `caster` could have (0 with no one in reach). */
function bestCast(state: GameState, board: Board, caster: Unit, power: number): number {
  let best = 0;
  for (const target of spellTargets(state, caster, board, power)) best = Math.max(best, castValue(state, board, caster, target, power));
  return best;
}

function castScore(state: GameState, board: Board, command: Extract<Command, { type: 'Cast' }>): number {
  const power = state.spell?.power ?? 0;
  return 1_000_000 + castValue(state, board, unitById(state, command.casterId)!, unitById(state, command.targetId)!, power) * EV_SCALE;
}

/**
 * The activation score of a spell turn or of a transfixed unit's roll to break
 * free; `undefined` for an ordinary activation. Either is weighed over every
 * roll the dice could make, against the friends a turnover would bench.
 *
 * A spell turn worth casting goes ahead of the fighters, so they find their foe
 * already helpless; one that is not scores below any ordinary activation. A
 * held unit with a foe beside it struggles first of all; left alone it waits
 * until the fighting is done.
 */
function magicActivationScore(state: GameState, board: Board, command: ChooseActivation): number | undefined {
  const unit = unitById(state, command.unitId)!;
  const breakingFree = unit.transfixedBy !== undefined;
  if (!command.spell && !breakingFree) return undefined;

  const dice = command.diceCount;
  const waiting = aliveUnits(state, unit.owner).filter((u) => !u.activatedThisRound && u.id !== unit.id).length;
  const odds = successOdds(unit.quality, dice, unit.inspired);
  const threatened = adjacentEnemies(state, unit, board).some((e) => !isDown(e));
  let worth = 0;
  odds.forEach((prob, successes) => {
    const gain = breakingFree
      ? successes >= BREAK_FREE_COST
        ? worthOf(state, unit) * (threatened ? 1 : 0.5)
        : 0
      : bestCast(state, board, unit, successes);
    worth += prob * (gain - (dice - successes >= 2 ? waiting * MAGIC_BENCH_COST : 0));
  });

  if (breakingFree) return (threatened ? 120_000 : 60_000) + worth * ORDER_SCALE;
  return worth >= MIN_SPELL_WORTH ? 105_000 + Math.min(worth, 8) * ORDER_SCALE : -1;
}

/** Who a `ChooseActivation` command would activate: the unit alone, or its group. */
function activated(state: GameState, board: Board, command: ChooseActivation): Unit[] {
  const unit = unitById(state, command.unitId)!;
  return command.group ? groupFor(state, unit, board) : [unit];
}

function binomial(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** How much an idle unit's actions are worth: one holding a zone, or a King with no one near, has little to do. */
const IDLE_NEED = 0.15;

/**
 * How much `unit` has to do with its actions this round, from 0 to 1: full
 * unless it is sitting where it is needed with no foe to strike — a zone
 * holder, or a King nobody is threatening.
 */
function unitNeed(state: GameState, board: Board, zones: ZoneView[], kings: KingPlan | undefined, unit: Unit): number {
  const enemies = enemiesOf(state, unit.owner);
  const d = nearestEnemyDistance(board, unit.pos, enemies);
  if (d === 1 || (unit.traits.ranged >= 2 && d <= unit.traits.ranged)) return 1;
  if (zones.length > 0 && sitsInZone(zones, unit)) return IDLE_NEED;
  if (kings && !kings.goal && unit.id === kings.ourKing?.id && d > THREAT_RANGE) return IDLE_NEED;
  return 1;
}

/**
 * Dice policy: the dice count with the best {@link activationWorth}, as a small
 * tiebreak (at most ~25) that never reorders which unit goes. A turnover costs
 * the activations of the friends still waiting, each weighed by how much it has
 * to do; the last unit risks nothing, so it always rolls all three.
 *
 * A group activation is worth all its members' actions for one roll's risk, so
 * it outscores activating the same unit alone.
 */
function diceWorth(
  state: GameState,
  board: Board,
  zones: ZoneView[],
  kings: KingPlan | undefined,
  command: ChooseActivation,
): number {
  const members = activated(state, board, command);
  const need = (u: Unit) => unitNeed(state, board, zones, kings, u);
  let waiting = 0;
  for (const u of aliveUnits(state, members[0]!.owner)) if (!u.activatedThisRound && !members.includes(u)) waiting += need(u);
  const worth = (d: number) => activationWorth(members, d, need, waiting);
  const best = Math.max(worth(1), worth(2), worth(3));
  return worth(command.diceCount) === best ? 20 + best : worth(command.diceCount);
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
      const magic = magicActivationScore(state, board, command);
      if (magic !== undefined) return magic;
      if (kings) {
        // The Pig rolls everything when one good roll walks it home.
        const dash = command.diceCount === 3 && unit.id === kings.ourKing?.id && pigCanGetHome(kings, unit) ? 50 : 0;
        return leaderFirst(state, unit, kingActivationScore(state, board, kings, unit)) + diceWorth(state, board, zones, kings, command) + dash;
      }
      const enemyDist = nearestEnemyDistance(board, unit.pos, enemies);
      // Zone modes: a unit already holding a zone has nowhere better to be, so
      // it activates late; one with a zone to reach counts its distance to it.
      let dist = enemyDist;
      let holding = false;
      if (zones.length > 0) {
        holding = sitsInZone(zones, unit);
        const target = holding ? undefined : targetZone(zones, unit);
        if (target) dist = Math.min(zoneDistance(unit.pos, target), 99);
      }
      // A unit that can already fight this turn — in melee, or a shooter with a
      // foe in range — is the one worth activating first. That is about enemies,
      // never about how close the unit is to a zone.
      const canMelee = enemyDist === 1;
      const canShoot = unit.traits.ranged >= 2 && enemyDist >= 2 && enemyDist <= unit.traits.ranged;
      const canAttack = canMelee || canShoot;
      // Prefer the unit that can already fight — the best fight first, such as
      // a blow at a downed foe before it stands — else the one closest to a foe.
      const fight = canMelee ? bestBlowNow(state, board, unit) * ORDER_SCALE : 0;
      const unitScore = leaderFirst(state, unit, canAttack ? 100_000 + fight : holding ? 1_000 : 10_000 - dist * 100);

      return unitScore + diceWorth(state, board, zones, kings, command);
    }

    case 'Attack': {
      const target = unitById(state, command.targetId)!;
      const attacker = unitById(state, command.attackerId)!;
      let score = 1_000_000 + blowValue(state, board, attacker, target, command.power === true, false) * EV_SCALE;
      if (kings) {
        // Our King only trades blows to end the game or finish a downed foe;
        // stuck in melee with nowhere safer, it still hits back rather than idle.
        // (The golden Pig has a clock to beat: it fights its way through.)
        if (!kings.goal && attacker.id === kings.ourKing?.id && target.id !== kings.theirKing?.id && !target.knockedDown) return 50_000;
        score += kingTargetBonus(kings, target);
      }
      return score;
    }

    case 'Shoot': {
      // Shooting deals damage with no risk of reprisal — nearly as good as a
      // melee blow, and better against a soft or already-downed target.
      const target = unitById(state, command.targetId)!;
      const shooter = unitById(state, command.attackerId)!;
      let score = 900_000 + blowValue(state, board, shooter, target, command.aimed === true, true) * EV_SCALE;
      if (kings) score += kingTargetBonus(kings, target);
      return score;
    }

    case 'Move': {
      const mover = unitById(state, command.unitId)!;
      if (zones.length > 0) {
        const zoneScore = zoneMoveScore(state, board, zones, mover, command.to);
        if (zoneScore !== undefined) return zoneScore;
      }
      if (kings) return kingMoveScore(state, board, kings, mover, command.to);
      const dist = nearestEnemyDistance(board, command.to, enemies);
      // A ranged unit seeks a standoff: inside its range but out of melee, so it
      // can shoot next turn instead of being dragged into a fight. (When a shot
      // is already available, Shoot outscores every Move anyway.)
      // A Magic User hangs back the same way, to keep its spell in play: in
      // contact it cannot cast at all.
      const standoff = mover.traits.ranged >= 2 ? mover.traits.ranged : mover.traits.magicUser ? CASTER_STANDOFF : 0;
      if (standoff >= 2) {
        const r = standoff;
        if (dist >= 2 && dist <= r) return standoffScore(r, dist); // in the sweet spot — short range, else the edge of range
        if (dist < 2) return 40_000; // stepping into melee is a last resort for a shooter
        return 100_000 - dist * 100; // out of range: close the gap
      }
      // Melee: close the distance; always beats ending, never beats attacking.
      return 100_000 - dist * 100 + chargeEdge(state, board, mover, command.to);
    }

    case 'Guard': {
      // A last-resort defensive stance: only when there's nothing better to do
      // (no attack, no useful move). Kept just above ending the activation —
      // and a zone holder's preferred way to sit tight.
      if (zones.length > 0 && sitsInZone(zones, unitById(state, command.unitId)!)) return 10;
      // Our King with nowhere safer to go waits on guard, ready to riposte.
      if (kings && command.unitId === kings.ourKing?.id) return 10;
      return 1;
    }

    case 'WarCry':
      return warCryScore(state, unitById(state, command.unitId)!);

    // The AI fights every battle out: it never sounds the retreat.
    case 'Retreat':
      return -Infinity;

    case 'Cast':
      return castScore(state, board, command);

    case 'EndActivation':
      // The Pig standing in the goal wins by ending its activation there.
      if (kings?.goal && state.activeUnitId && pigExtracted(state, state.activeUnitId)) return 3_000_000;
      return 0;

    // Group members act in the order the engine lines them up.
    case 'SwitchGroupMember':
      return -1;
  }
}

/**
 * Zone modes: the score of moving `mover` to `to`, or `undefined` when it
 * wasn't sent to a zone (see {@link assignZones}) and the usual enemy-seeking
 * applies. A unit already in its zone stays put — it only shifts within the
 * zone to charge a foe at good odds, and leaving scores far under ending the
 * activation. Anyone else heads for its zone: stepping in beats any ordinary
 * move (a shooter's standoff included), otherwise closer is better, and a
 * well-set charge on the way counts too.
 */
function zoneMoveScore(state: GameState, board: Board, zones: ZoneView[], mover: Unit, to: Vec): number | undefined {
  if (sitsInZone(zones, mover)) {
    if (!zones[zoneIndexAt(zones, mover.pos)]!.keys.has(vecKey(to))) return -1_000;
    // Shuffling within the zone is only worth it to take on a foe at good odds.
    const charge = chargeEdge(state, board, mover, to);
    return charge > 0 ? 50_000 + charge : -1;
  }
  const target = targetZone(zones, mover);
  if (!target) return undefined;
  const charge = chargeEdge(state, board, mover, to);
  if (target.keys.has(vecKey(to))) return 130_000 + charge;
  return 100_000 - zoneDistance(to, target) * 100 + charge;
}

/**
 * Kill-the-king as the AI sees it, from `player`'s side: both Kings (while
 * alive) and the enemies close enough to threaten ours.
 *
 * Extracting the golden Pig reuses it: the Pig is the escort's "King" (and the
 * defender has none), so the escort protects it and the defender hunts it.
 */
interface KingPlan {
  ourKing: Unit | undefined;
  theirKing: Unit | undefined;
  /** Golden Pig only: walking distance from every reachable hex to the nearest goal hex. */
  goal?: Map<string, number>;
  /** Walking distance from every reachable hex to the enemy King, so hunters go round rock rather than into it. */
  hunt?: Map<string, number>;
  /** Enemies within {@link THREAT_RANGE} of our King. */
  threats: Unit[];
  /** Ids of the threats already in contact with our King. */
  atKing: Set<string>;
  /** Living units' hexes, for line-of-sight checks (units block sight lanes). */
  occupied: Set<string>;
}

/** An enemy this close to our King is a threat the rest of the warband turns on. */
const THREAT_RANGE = 3;

/** The King plan in kill-the-king and the golden Pig, `undefined` in every other mode. */
function kingPlan(state: GameState, board: Board, player: Owner): KingPlan | undefined {
  const pig = pigOf(state);
  if (!state.mode?.kings && !pig) return undefined;
  const enemy: Owner = player === 0 ? 1 : 0;
  const living = (id: string | undefined) => {
    const u = id === undefined ? undefined : unitById(state, id);
    return u && !u.dead ? u : undefined;
  };
  // A King left on its own has no one to hide behind: it hunts like anyone else
  // (otherwise two lone Kings would shy away from each other forever).
  const alone = aliveUnits(state, player).length <= 1;
  let ourKing = alone ? undefined : living(kingOf(state, player));
  let theirKing = living(kingOf(state, enemy));
  let goal: Map<string, number> | undefined;
  if (pig) {
    ourKing = pig.escort === player ? living(pig.unitId) : undefined;
    theirKing = pig.escort === player ? undefined : living(pig.unitId);
    goal = zoneField(state, board, state.mode?.objectives.extraction ?? []);
  }
  const threats = ourKing ? enemiesOf(state, player).filter((e) => board.distance(e.pos, ourKing.pos) <= THREAT_RANGE) : [];
  const occupied = new Set(state.units.filter((u) => !u.dead).map((u) => vecKey(u.pos)));
  const atKing = new Set(threats.filter((t) => board.distance(t.pos, ourKing!.pos) === 1).map((t) => t.id));
  const hunt = theirKing ? zoneField(state, board, [theirKing.pos]) : undefined;
  const plan: KingPlan = { ourKing, theirKing, threats, atKing, occupied, hunt };
  return goal ? { ...plan, goal } : plan;
}

/** Extra attack/shot score: the enemy King above all (it ends the game), then threats to ours. */
function kingTargetBonus(plan: KingPlan, target: Unit): number {
  if (target.id === plan.theirKing?.id) return 300_000;
  if (plan.threats.some((t) => t.id === target.id)) return plan.atKing.has(target.id) ? 40_000 : 20_000;
  return 0;
}

/**
 * How far a non-King unit at `from` is from its quarry: a threat to our King
 * if there is one (protect first — the closer a threat is to the King, the
 * sooner it must be met), else the enemy King — by walking distance, unless
 * the hunter flies over the rock in between — else simply the nearest enemy.
 */
function kingHuntDistance(board: Board, plan: KingPlan, from: Vec, enemies: Unit[], flies = false): number {
  const king = plan.ourKing;
  if (king && plan.threats.length > 0) {
    let min = Infinity;
    for (const t of plan.threats) min = Math.min(min, board.distance(from, t.pos) + 2 * (board.distance(t.pos, king.pos) - 1));
    return min;
  }
  if (plan.theirKing) {
    // Hunting the Pig: as good a hex nearer the goal than it is bars its way too.
    const barring = plan.goal && walk(plan.goal, from) >= walk(plan.goal, plan.theirKing.pos) ? 0.5 : 0;
    const walked = plan.hunt && !flies ? walk(plan.hunt, from) : FAR;
    return (walked < FAR ? walked : board.distance(from, plan.theirKing.pos)) + barring;
  }
  if (king && plan.goal) {
    // Escorts with no threat to answer go for the foe nearest the Pig: the next one in its way.
    let next: Unit | undefined;
    for (const e of enemies) if (!next || board.distance(e.pos, king.pos) < board.distance(next.pos, king.pos)) next = e;
    if (next) return board.distance(from, next.pos);
  }
  return nearestEnemyDistance(board, from, enemies);
}

/** Whether the golden Pig `pig` could walk into the goal with two Moves: worth rolling for now. */
function pigCanGetHome(plan: KingPlan, pig: Unit): boolean {
  return !!plan.goal && walk(plan.goal, pig.pos) <= unitMove(pig) * (pig.knockedDown ? 1 : 2);
}

/** What each standing foe beside a hex costs the Pig's wish to stop there, in hundredths of a hex of progress. */
const PIG_CONTACT_COST = 250;

/**
 * The golden Pig's moves: always toward the goal by walking distance, and
 * stepping into it beats everything (ending the activation there wins). On the
 * way it would rather not stop beside a standing foe, and once in contact with
 * one it fights instead of turning its back — unless that last move gets it home.
 */
function pigMoveScore(state: GameState, board: Board, goal: Map<string, number>, pig: Unit, to: Vec): number {
  const now = walk(goal, pig.pos);
  const then = walk(goal, to);
  if (then === 0) return 2_000_000;
  const standing = (at: Vec) => enemiesOf(state, pig.owner).filter((e) => !e.knockedDown && board.distance(e.pos, at) === 1).length;
  const base = then >= now ? 100_000 : standing(pig.pos) > 0 ? 900_000 : 1_100_000;
  return base - then * 100 - standing(to) * PIG_CONTACT_COST;
}

/** Beyond this many hexes from every enemy, our King counts itself as safe as it gets. */
const KING_SAFE_DIST = 4;

/**
 * How safe a hex is for our King: out of reach of enemies (capped), off the
 * edge of the map (one push there kills), then higher ground.
 */
function kingSafety(board: Board, v: Vec, enemies: Unit[]): number {
  const edge = board.cellsWithin(v, 1).length < 6 ? KING_EDGE : 0;
  return Math.min(nearestEnemyDistance(board, v, enemies), KING_SAFE_DIST) * 100 - edge + board.elevation(v) * 10;
}

/** What a hex on the map's edge costs the King's safety, in hundredths of a hex of distance. */
const KING_EDGE = 150;

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
    // The golden Pig goes first when it can get home, else right after the fighters:
    // the clock is against it, and a turnover before its move costs it a round.
    if (plan.goal) return pigCanGetHome(plan, unit) ? 150_000 : nearest === 1 ? 100_000 : 60_000;
    if (canShoot) return 100_000;
    return nearest <= 2 ? 50_000 : 1_000;
  }
  if (nearest === 1 || canShoot) return 100_000;
  return 10_000 - Math.min(kingHuntDistance(board, plan, unit.pos, enemies, unit.traits.flying), 99) * 100;
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
  if (plan.goal && mover.id === plan.ourKing?.id) return pigMoveScore(state, board, plan.goal, mover, to);
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
  return 100_000 - kingHuntDistance(board, plan, to, enemies, mover.traits.flying) * 100 + height;
}

/** Walking distance (steps over passable hexes, never lava) from every reachable hex to the nearest of `targets`. */
function distanceField(board: Board, ...targets: Vec[]): Map<string, number> {
  const field = new Map<string, number>(targets.map((t) => [vecKey(t), 0]));
  let frontier = targets;
  for (let d = 1; frontier.length > 0; d++) {
    const next: Vec[] = [];
    for (const v of frontier) {
      for (const n of board.neighbors(v)) {
        const key = vecKey(n);
        if (field.has(key) || board.isDeadly(n)) continue;
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
      const magic = magicActivationScore(state, board, command);
      if (magic !== undefined) return magic;
      const enemyDist = nearestEnemyDistance(board, unit.pos, enemies);
      const canAttack = enemyDist === 1 || (unit.traits.ranged >= 2 && enemyDist >= 2 && enemyDist <= unit.traits.ranged);
      const goal = goalDistance(plan, unit.pos);
      const dist = goal < FAR ? goal : enemyDist;
      let unitScore = canAttack ? 100_000 : 10_000 - Math.min(dist, 99) * 100;
      // The carrier moves first: every activation it waits is a chance to lose the flag.
      if (unit.id === plan.carrierId) unitScore = 150_000;
      unitScore = leaderFirst(state, unit, unitScore);
      return unitScore + diceScore(state, board, command);
    }

    case 'Attack':
    case 'Shoot': {
      const targetId = command.targetId;
      const target = unitById(state, targetId)!;
      const attacker = unitById(state, command.attackerId)!;
      let score = command.type === 'Attack' ? 1_000_000 : 900_000;
      if (isDown(target)) score += 5_000;
      score += (6 - target.combat) * 100;
      if (command.type === 'Attack') {
        score += (attacker.combat - target.combat) * 50;
        score += (outnumberedPenalty(state, target, board) - outnumberedPenalty(state, attacker, board)) * 50;
        score += masteryEdge(attacker, target) * 50;
        score += pressedEdge(meleeEdge(state, board, attacker, target) < 0, command.power === true);
      } else {
        const penalty = shotPenalty(state, board, attacker, target);
        score -= penalty * SHOT_PENALTY_COST;
        score += pressedEdge(penalty >= 2, command.aimed === true);
      }
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

    case 'WarCry':
      return warCryScore(state, unitById(state, command.unitId)!);

    // The AI fights every battle out: it never sounds the retreat.
    case 'Retreat':
      return -Infinity;

    case 'Cast':
      return castScore(state, board, command);

    case 'EndActivation':
      return 0;

    // Group members act in the order the engine lines them up.
    case 'SwitchGroupMember':
      return -1;
  }
}

export function playerLabel(owner: Owner): string {
  return `P${owner}`;
}
