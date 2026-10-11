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
  enemiesOf,
  flyingMeleeBonus,
  flyingTargetBonus,
  flagAtBase,
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
  roundLimitOf,
  scoringZones,
  shortRange,
  standingInZone,
  targetScoreOf,
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
import { activationOrder, MoveSetup, threatShares, type Standing } from './tactics.js';
import { binomial, blowOutcome, blowValue, KING_WORTH, outcomeValue, successChance, successOdds, worthOf, type BlowOutcome } from './value.js';

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

  // Every mode but capture-the-flag: the unit acting weighs everything it could do on the one scale.
  const oneScale = !flags && state.phase === 'acting' && !state.spell && !!state.activeUnitId;
  const scores = oneScale ? planScores(state, board, commands, zones, kings) : commands.map((command) => ladderScore(state, board, zones, flags, kings, command));

  // A move scored for its setup has yet to pay for the risk it ends in (see
  // `setupEdge`). The risk only ever lowers a score, so the moves are weighed in
  // order of their score without it, and the rest are left once none can win.
  const setup = oneScale && nothingHeldBack(state, zones, kings) ? undefined : setups.get(state);
  const waiting: number[] = [];
  let best = -1;
  commands.forEach((command, i) => {
    if (setup && command.type === 'Move') waiting.push(i);
    else if (best < 0 || scores[i]! > scores[best]!) best = i;
  });
  waiting.sort((a, b) => scores[b]! - scores[a]! || a - b);
  for (const i of waiting) {
    if (best >= 0 && scores[i]! < scores[best]!) break;
    scores[i]! -= SETUP_SCALE * EXPOSURE_WEIGHT * setup!.risk((commands[i] as Extract<Command, { type: 'Move' }>).to);
    if (best < 0 || scores[i]! > scores[best]! || (scores[i] === scores[best] && i < best)) best = i;
  }
  return commands[best]!;
}

/** A command's score on the ladder (capture-the-flag, and who activates in every mode): its kind first, then how good a one of its kind it is. */
function ladderScore(
  state: GameState,
  board: Board,
  zones: ZoneView[],
  flags: FlagPlan | undefined,
  kings: KingPlan | undefined,
  command: Command,
): number {
  let score = flags ? scoreFlagCommand(state, board, flags, command) : scoreCommand(state, board, zones, kings, command);
  if (command.type === 'Move') score -= disengageCost(state, board, command.unitId);
  if (command.type === 'Move') score += lavaMoveEdge(state, board, unitById(state, command.unitId)!, command.to);
  if (command.type === 'Attack') {
    score += lavaAttackEdge(state, board, unitById(state, command.attackerId)!, unitById(state, command.targetId)!);
  }
  return score;
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

/** Score per unit of {@link blowValue}: wide enough to rank targets, far below the gap to a move. */
const EV_SCALE = 10_000;

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

/** Whether a hex holds a living unit other than the one acting, by state: what a shot of its own has to see past. */
const lanes = new WeakMap<GameState, (v: Vec) => boolean>();

function laneOf(state: GameState): (v: Vec) => boolean {
  let lane = lanes.get(state);
  if (!lane) {
    const taken = new Set<string>();
    for (const u of state.units) if (!u.dead && u.id !== state.activeUnitId) taken.add(vecKey(u.pos));
    lane = (v) => taken.has(vecKey(v));
    lanes.set(state, lane);
  }
  return lane;
}

/**
 * The best shot `mover` could fire from `to` with `left` actions once it has
 * moved there, in {@link blowValue} terms: a foe in range and in sight, with no
 * standing foe beside the hex to pin it. `undefined` with no shot from there.
 */
function shotAfter(state: GameState, board: Board, mover: Unit, to: Vec, left: number, even = false, hold?: HoldView, court?: Court): number | undefined {
  const range = mover.traits.ranged;
  if (range < 2 || left < 1) return undefined;
  const enemies = enemiesOf(state, mover.owner);
  for (const e of enemies) if (!isDown(e) && board.distance(e.pos, to) === 1) return undefined;
  const lane = laneOf(state);
  let best: number | undefined;
  for (const e of enemies) {
    const d = board.distance(e.pos, to);
    if (d < 2 || d > range || !board.lineOfSight(to, e.pos, lane)) continue;
    const value = strikeValue(state, board, mover, e, false, true, to, left, even, hold, court);
    if (best === undefined || value > best) best = value;
  }
  return best;
}

/**
 * The best blow `mover` could strike from `to` with `left` actions once it has
 * moved there, in {@link blowValue} terms. `undefined` with no foe beside it.
 */
function blowAfter(state: GameState, board: Board, mover: Unit, to: Vec, left: number, even = false, hold?: HoldView, court?: Court): number | undefined {
  if (left < 1) return undefined;
  let best: number | undefined;
  for (const e of enemiesOf(state, mover.owner)) {
    if (board.distance(e.pos, to) !== 1) continue;
    const value = strikeValue(state, board, mover, e, false, false, to, left, even, hold, court);
    if (best === undefined || value > best) best = value;
  }
  return best;
}

/** A scoring zone as the unit acting counts it: the standing units of each side in it. */
interface ZoneCount {
  zone: ZoneView;
  /** The standing units of its side in the zone, itself left out. */
  others: number;
  theirs: number;
}

/**
 * The zone modes as the unit acting sees them: who stands in each zone (the one
 * hill, or conquest's three), where the unit was sent (see {@link assignZones}),
 * and what a zone is worth.
 */
interface HoldView {
  counts: ZoneCount[];
  /** The zone it was sent to, to take it or to keep it. */
  sent: ZoneView | undefined;
  /** Whether it is where it was sent: on its feet in that zone. */
  holding: boolean;
  /**
   * What a step of control is worth, in {@link blowValue} terms: from the
   * enemy's zone to no one's, or from no one's to ours, is a point a round, and
   * a point is its share of the game: what a King is worth, over the points to win.
   */
  point: number;
}

function holdView(state: GameState, zones: ZoneView[], unit: Unit): HoldView {
  const key = vecKey(unit.pos);
  const up = !isDown(unit);
  const sent = targetZone(zones, unit);
  const counts: ZoneCount[] = [];
  for (const zone of zones) {
    counts.push({ zone, others: standingInZone(state, zone.hexes)[unit.owner] - (up && zone.keys.has(key) ? 1 : 0), theirs: zone.theirs });
  }
  return { counts, sent, holding: !!sent && up && sent.keys.has(key), point: KING_WORTH / (targetScoreOf(state) ?? 1) };
}

/** Who holds the zones with the unit acting standing on `at`: per zone 1 for its side, -1 for the enemy, 0 for no one. */
function zoneControl(hold: HoldView, at: Vec): number {
  const key = vecKey(at);
  let control = 0;
  for (const c of hold.counts) control += Math.sign(c.others + (c.zone.keys.has(key) ? 1 : 0) - c.theirs);
  return control;
}

/**
 * What a blow or shot struck from `at` does to the hold on the zones, in
 * {@link blowValue} terms: a foe standing in one that is killed, knocked down or
 * pushed counts there no longer, and nor does the unit itself if it stands in
 * one and loses the exchange. (A push is taken to clear the zone.)
 */
function zoneSwing(hold: HoldView, o: BlowOutcome, target: Unit, at: Vec, ranged: boolean): number {
  const key = vecKey(at);
  const targetKey = isDown(target) ? undefined : vecKey(target.pos);
  let swing = 0;
  for (const c of hold.counts) {
    const on = c.zone.keys.has(key);
    const margin = c.others + (on ? 1 : 0) - c.theirs;
    const now = Math.sign(margin);
    if (targetKey !== undefined && c.zone.keys.has(targetKey)) swing += (o.kill + o.hurt) * (Math.sign(margin + 1) - now);
    if (on && !ranged) swing += o.lose * (Math.sign(margin - 1) - now);
  }
  return swing * hold.point;
}

/**
 * Kill-the-king and the golden Pig as the unit acting sees them: the plan of
 * its side, and whether it is the King that plan keeps safe (a King left on its
 * own is not: see {@link kingPlan}) or the Pig its side escorts.
 */
interface Court {
  plan: KingPlan;
  royal: boolean;
  /** The golden Pig only: walking distances to the goal, when the unit acting is the Pig. */
  home: Map<string, number> | undefined;
  /** The golden Pig only: how near the goal its escort has come ({@link escortFront}). */
  front: number;
  /** The plan with the threats to our King left out: the unit's way to the enemy King. */
  chase: KingPlan;
  /** By foe, what its blow adds to what our King is threatened with as things stand ({@link threatShares}). */
  shares: Map<string, number> | undefined;
}

function courtOf(state: GameState, board: Board, plan: KingPlan, unit: Unit): Court {
  const royal = plan.ourKing?.id === unit.id;
  return {
    plan,
    royal,
    home: royal ? plan.goal : undefined,
    front: royal && plan.goal ? escortFront(state, plan.goal, unit) : 0,
    chase: { ...plan, threats: [] },
    shares: plan.ourKing ? threatShares(state, board, plan.ourKing) : undefined,
  };
}

/**
 * How near the goal the golden Pig's escort has come: the walking distance to
 * it of the escort nearest it, or 0 with no escort left to wait for, or no
 * round left to wait in ({@link pigOutOfTime}). The Pig counts no hex of its
 * own nearer than that ({@link placeScore}).
 */
function escortFront(state: GameState, goal: Map<string, number>, pig: Unit): number {
  if (pigOutOfTime(state, goal, pig)) return 0;
  let front = FAR;
  for (const u of state.units) {
    if (u.dead || u.owner !== pig.owner || u.id === pig.id) continue;
    const d = walk(goal, u.pos);
    if (d < front) front = d;
  }
  return front < FAR ? front : 0;
}

/**
 * What a blow or shot at `target` does for our King, in {@link blowValue}
 * terms: a foe killed, knocked down or pushed threatens it no longer, so the
 * blow is worth what that foe's own adds to the King's exposure, by its odds.
 * (As with a zone, the lesser hit is taken to clear the foe away.)
 */
function kingSwing(court: Court, o: BlowOutcome, target: Unit): number {
  const share = court.shares?.get(target.id);
  return share ? (o.kill + o.hurt) * share : 0;
}

/**
 * A blow our King does not strike, whatever the odds: at a foe on its feet that
 * is not the enemy King. It trades blows to end the game or to finish a foe
 * that cannot hit back, and for nothing else. (The golden Pig weighs its blows
 * like anyone: what it is worth is in what a lost exchange costs it.)
 */
function tradesForNothing(court: Court, target: Unit): boolean {
  return court.royal && !court.plan.goal && target.id !== court.plan.theirKing?.id && !isDown(target);
}

/** What a blow that is never struck counts for, in {@link blowValue} terms: under ending the activation by more than any blow is worth. */
const NO_TRADE = -1_000;

/**
 * {@link blowValue}, and what the mode adds to it: in the zone modes what the
 * blow does to the hold on the zones ({@link zoneSwing}); in kill-the-king what
 * it spares our King ({@link kingSwing}), and the blows our King does not
 * strike ({@link tradesForNothing}).
 */
function strikeValue(
  state: GameState,
  board: Board,
  attacker: Unit,
  target: Unit,
  pressed: boolean,
  ranged: boolean,
  from: Vec | undefined,
  actions: number,
  even: boolean,
  hold: HoldView | undefined,
  court?: Court,
): number {
  if (court && !ranged && tradesForNothing(court, target)) return NO_TRADE;
  if (!hold && !court) return blowValue(state, board, attacker, target, pressed, ranged, from, actions, even);
  const o = blowOutcome(state, board, attacker, target, pressed, ranged, from, even);
  // A blow at the enemy King is struck whatever it may cost the striker, unless that is our King: the game rides on it.
  // Not so a blow at the golden Pig: the clock ends that game, and it is for the Pig to come on.
  if (court && !court.royal && !court.plan.goal && target.id === court.plan.theirKing?.id) o.lossWorth = 0;
  let value = outcomeValue(o, pressed, actions);
  if (hold) value += zoneSwing(hold, o, target, from ?? attacker.pos, ranged);
  if (court) value += kingSwing(court, o, target);
  return value;
}

/** A holder's move out of the zone it was sent to: under ending its activation whatever it would gain. */
const LEAVE_ZONE = -1_000_000;

/** The golden Pig's move into the goal: over anything else it could do short of standing there already. */
const PIG_HOME = 2_000_000;

/** The golden Pig ending its activation in the goal, which wins: over everything. */
const PIG_OUT = 3_000_000;

/** Score per unit of {@link blowValue} when a unit's whole activation is weighed on one scale: a move's own. */
const PLAN_SCALE = 1_000;

/** Score per hex a move brings a unit nearer the fight: what closing on the foe has always been worth to a move. */
const APPROACH = 100;

/**
 * Every command of the unit acting on one scale, in {@link blowValue} terms
 * times {@link PLAN_SCALE}, against ending its activation where it stands (0).
 *
 * A blow or a shot is worth its expected value with the actions held. A move is
 * worth the best strike its hex allows with the actions then left, if any is
 * worth making, plus what standing there does for the warband
 * ({@link setupEdge}; the risk to the mover itself is taken off by
 * `chooseCommand`), plus the hexes it closes on the foe, less the hacks it
 * draws. Standing on guard is worth what the riposte spares the unit. So a unit
 * strikes only when the blow is worth more than a better place to stand, and
 * holds its ground when nothing is worth doing.
 *
 * With a side down to its last unit there is nothing to hold back for
 * ({@link lastStand}): a lost exchange exposes no friend, so it counts for no
 * more than the lesser hit it is, and what closing on the foe exposes the unit
 * itself to is not weighed. So of two last units the one with the better of the
 * exchange strikes, and a warband goes in after the last foe on its perch:
 * neither waits for the other for ever.
 *
 * The zone modes (`zones`: the one hill, or conquest's three) add the zones to
 * the same scale. A unit sent to a zone counts its hexes to it in place of those
 * to the foe; a move that changes who holds any zone is worth that step of
 * control, and so is a blow that may clear a foe out of one or cost the unit its
 * own place in one ({@link zoneSwing}). So a unit on its way still takes a good
 * blow or a flank, and one holding a zone alone does not risk it on an even
 * fight. The one thing not weighed: a unit standing in the zone it was sent to
 * never walks out of it.
 *
 * Kill-the-king (`kings`) is on the same scale by what a King is worth
 * ({@link worthOf}): a blow at the enemy King, or a hex that threatens it, counts
 * for the game, and so does what the enemy can do to ours, in the exposure of
 * every move, in the worth of its guard and in a blow at a foe that threatens it
 * ({@link kingSwing}). A unit counts its hexes to the enemy King
 * ({@link kingHuntDistance}) in place of those to the nearest foe; our King
 * counts none, and moves only to where it has less to fear. Two things are not
 * weighed: our King never trades blows for nothing ({@link tradesForNothing}),
 * and a blow at the enemy King counts nothing for what its striker may lose by
 * it, or a King no one can hurt enough would never be attacked.
 *
 * The golden Pig (`kings`, with a `goal`) is on the scale the same way: the Pig
 * is worth the game to both sides, so its hunters weigh a blow at it and a hex
 * that threatens it as they would a King, and its escort weighs what the enemy
 * can do to it in every move and in a blow at a foe that threatens it. The Pig
 * counts its hexes to the goal, less what it would be exposed to on the way, and
 * none nearer than its escort has come ({@link escortFront}): it does not lead.
 * Once the clock leaves it no round to wait in ({@link pigOutOfTime}) it goes
 * for the goal with nothing held back, escort or none.
 * An escort counts its hexes to the foe nearest the Pig, a hunter those to the Pig.
 * Two things are not weighed: the Pig standing in the goal ends its activation
 * there, and a move that takes it into the goal comes before anything else.
 */
function planScores(state: GameState, board: Board, commands: Command[], zones: ZoneView[], kings?: KingPlan): number[] {
  const unit = unitById(state, state.activeUnitId!)!;
  const enemies = enemiesOf(state, unit.owner);
  const left = state.actionsRemaining - 1;
  const hacks = disengageCost(state, board, unit.id);
  const hold = zones.length > 0 ? holdView(state, zones, unit) : undefined;
  const sent = hold?.sent;
  const court = kings ? courtOf(state, board, kings, unit) : undefined;
  const here = placeScore(board, unit, unit.pos, enemies, sent, court);
  const held = hold ? zoneControl(hold, unit.pos) : 0;
  const last = nothingHeldBack(state, zones, kings);
  const scores: number[] = [];
  for (const command of commands) {
    let score = 0;
    switch (command.type) {
      case 'Attack': {
        const target = unitById(state, command.targetId)!;
        score = strikeValue(state, board, unit, target, command.power === true, false, undefined, state.actionsRemaining, last, hold, court) * PLAN_SCALE;
        score += lavaAttackEdge(state, board, unit, target) * (PLAN_SCALE / EV_SCALE);
        break;
      }
      case 'Shoot':
        score = strikeValue(state, board, unit, unitById(state, command.targetId)!, command.aimed === true, true, undefined, state.actionsRemaining, false, hold, court) * PLAN_SCALE;
        break;
      case 'Move': {
        const to = command.to;
        if (hold?.holding && !sent!.keys.has(vecKey(to))) {
          score = LEAVE_ZONE;
          break;
        }
        if (court?.home && walk(court.home, to) === 0) {
          score = PIG_HOME;
          break;
        }
        const strike = blowAfter(state, board, unit, to, left, last, hold, court) ?? shotAfter(state, board, unit, to, left, last, hold, court) ?? 0;
        const setup = last ? SETUP_SCALE * setupOf(state, board, unit).partial(to).threat : setupEdge(state, board, unit, to);
        score = placeScore(board, unit, to, enemies, sent, court) - here;
        score += Math.max(0, strike) * PLAN_SCALE + setup - hacks + lavaMoveEdge(state, board, unit, to);
        if (hold) score += (zoneControl(hold, to) - held) * hold.point * PLAN_SCALE;
        // Our King moves for a gain only: a hex no better than its own is under ending its activation there.
        if (court?.royal) score -= 1;
        break;
      }
      case 'Guard':
        // Just above ending the activation, as ever, when the stance spares it nothing.
        score = 1 + (last ? 0 : SETUP_SCALE * EXPOSURE_WEIGHT * setupOf(state, board, unit).guardGain());
        break;
      case 'WarCry':
        score = warCryScore(state, unit);
        break;
      // The AI fights every battle out: it never sounds the retreat.
      case 'Retreat':
        score = -Infinity;
        break;
      // Group members act in the order the engine lines them up.
      case 'SwitchGroupMember':
        score = -1;
        break;
      case 'EndActivation':
        if (court?.home && pigExtracted(state, unit.id)) score = PIG_OUT;
        break;
      default:
        break;
    }
    scores.push(score);
  }
  return scores;
}

/**
 * What standing on `at` is worth to `unit` before anything it could do from
 * there ({@link standingScore}), by its distance to where the mode sends it: the
 * zone it was sent to; in kill-the-king the enemy King, a shooter counting no
 * nearer than its range; the golden Pig the goal, no nearer than its escort has
 * come, its hunters the Pig and its escort the foe nearest it
 * ({@link kingHuntDistance}); else the nearest foe. Our King is sent nowhere.
 */
function placeScore(board: Board, unit: Unit, at: Vec, enemies: Unit[], sent: ZoneView | undefined, court: Court | undefined): number {
  if (sent) return -zoneDistance(at, sent) * APPROACH;
  if (court?.home) return -Math.max(walk(court.home, at), court.front) * APPROACH;
  if (court?.royal) return 0;
  // A Magic User keeps its standoff from whoever is nearest, as anywhere.
  if (!court || unit.traits.magicUser) return standingScore(unit, nearestEnemyDistance(board, at, enemies));
  const range = unit.traits.ranged;
  return standingScore(unit, kingHuntDistance(board, court.chase, at, enemies, unit.traits.flying, range >= 2 ? range : 0));
}

/**
 * Whether the unit acting holds nothing back ({@link lastStand}): never in the
 * zone modes, where the points end the game, and never our King while it has a
 * warband to hide behind. The golden Pig holds nothing back once the clock
 * leaves it no round to wait in ({@link pigOutOfTime}).
 */
function nothingHeldBack(state: GameState, zones: ZoneView[], kings: KingPlan | undefined): boolean {
  if (zones.length > 0) return false;
  if (kings?.ourKing && kings.ourKing.id === state.activeUnitId) return pigOutOfTime(state, kings.goal, kings.ourKing);
  return lastStand(state);
}

/**
 * Whether the golden Pig `pig` has no round left to wait in: at a Move a round,
 * the pace its clock is set by, the rounds still to play (this one included)
 * are no more than the Moves it is from the goal. Never without a goal or a clock.
 */
function pigOutOfTime(state: GameState, goal: Map<string, number> | undefined, pig: Unit): boolean {
  const limit = roundLimitOf(state);
  if (!goal || limit === undefined) return false;
  return Math.ceil(walk(goal, pig.pos) / unitMove(pig)) >= limit - state.round + 1;
}

/**
 * Whether either side is down to its last unit. That unit has no friend to wait
 * for, to cover or to expose; and against it no one's fall exposes a friend to
 * a second foe, nor does waiting bring a better fight than the one on offer.
 */
function lastStand(state: GameState): boolean {
  return aliveUnits(state, 0).length === 1 || aliveUnits(state, 1).length === 1;
}

/**
 * What standing `dist` hexes from the nearest foe is worth to `unit` before
 * anything it could do from there: each hex nearer counts, down to contact for
 * a fighter and down to its range for a shooter, whose shots and whose risks
 * then say where in range to stand. A Magic User's spell is no part of those,
 * so it keeps the standoff it has always kept.
 */
function standingScore(unit: Unit, dist: number): number {
  if (unit.traits.ranged >= 2) return -Math.max(dist, unit.traits.ranged) * APPROACH;
  if (unit.traits.magicUser) {
    if (dist >= 2 && dist <= CASTER_STANDOFF) return standoffScore(CASTER_STANDOFF, dist);
    return dist < 2 ? 40_000 : 100_000 - dist * APPROACH;
  }
  return -dist * APPROACH;
}

/** Score per unit of threat a move adds, in {@link blowValue} terms: as much as the charge it sets up for the mover itself. */
const SETUP_SCALE = 1_000;

/** What a point of exposure costs against a point of threat. */
const EXPOSURE_WEIGHT = 1;

/** The {@link MoveSetup} of the unit moving in a given state: one per decision, shared by all its moves. */
const setups = new WeakMap<GameState, MoveSetup>();

function setupOf(state: GameState, board: Board, mover: Unit): MoveSetup {
  let setup = setups.get(state);
  if (!setup) {
    setup = new MoveSetup(state, board, mover);
    setups.set(state, setup);
  }
  return setup;
}

/**
 * What ending a move at `to` does for the whole warband: the threat it adds —
 * a friend's better blow on a foe the mover now flanks or outnumbers, the
 * mover's own charge next round — less the exposure it adds, such as leaving a
 * friend to be outnumbered.
 *
 * All of it but the risk to the mover itself at `to`, such as standing where
 * three foes can charge it: that is the costly part, and `chooseCommand` only
 * takes it off the moves that could still be the best.
 */
function setupEdge(state: GameState, board: Board, mover: Unit, to: Vec): number {
  const part = setupOf(state, board, mover).partial(to);
  return SETUP_SCALE * (part.threat - EXPOSURE_WEIGHT * part.exposure);
}

/** Activation score per unit of {@link blowValue}: orders fighters, never lifts one above a war-crying Leader. */
const ORDER_SCALE = 500;

/** The {@link activationOrder} of the side choosing in a given state: one per decision, shared by all its activations. */
const orders = new WeakMap<GameState, Map<string, Standing>>();

/**
 * How much `unit` should go now rather than later, in {@link blowValue} terms:
 * the blow it can strike itself, plus what its stepping up to a foe adds to its
 * friends' blows, less what its own blow would gain from a friend stepping up
 * first. So the unit that closes a pincer goes before the one that strikes
 * through it. `undefined` when it has nothing to do yet.
 */
function orderEdge(state: GameState, board: Board, unit: Unit): number | undefined {
  let order = orders.get(state);
  if (!order) {
    order = activationOrder(state, board, unit.owner);
    orders.set(state, order);
  }
  const standing = order.get(unit.id);
  if (!standing || standing.own + standing.gift <= 0) return undefined;
  return Math.max(-ORDER_SPAN, Math.min(ORDER_SPAN, standing.own + standing.gift - standing.wait));
}

/** The widest {@link orderEdge}: keeps the fighters' order inside their own band of activation scores. */
const ORDER_SPAN = 15;

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
      let unitScore: number;
      if (zones.length === 0) {
        // Annihilation: whoever has the most to do now goes first, counting what
        // it sets up for its friends, and a unit a friend could set up waits for
        // it. With nothing to do yet, the one closest to a foe.
        const edge = orderEdge(state, board, unit);
        unitScore = edge !== undefined || canAttack ? 100_000 + (edge ?? 0) * ORDER_SCALE : 10_000 - dist * 100;
      } else {
        // Prefer the unit that can already fight — the best fight first, such as
        // a blow at a downed foe before it stands — else the one closest to a foe.
        const fight = canMelee ? bestBlowNow(state, board, unit) * ORDER_SCALE : 0;
        unitScore = canAttack ? 100_000 + fight : holding ? 1_000 : 10_000 - dist * 100;
      }
      unitScore = leaderFirst(state, unit, unitScore);

      return unitScore + diceWorth(state, board, zones, kings, command);
    }

    case 'Attack': {
      const target = unitById(state, command.targetId)!;
      const attacker = unitById(state, command.attackerId)!;
      return 1_000_000 + blowValue(state, board, attacker, target, command.power === true, false) * EV_SCALE;
    }

    case 'Shoot': {
      // Shooting deals damage with no risk of reprisal — nearly as good as a
      // melee blow, and better against a soft or already-downed target.
      const target = unitById(state, command.targetId)!;
      const shooter = unitById(state, command.attackerId)!;
      return 900_000 + blowValue(state, board, shooter, target, command.aimed === true, true) * EV_SCALE;
    }

    case 'Move': {
      const mover = unitById(state, command.unitId)!;
      // No mode's unit comes here any more: `planScores` weighs its moves, and capture-the-flag scores its own.
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
      // (no attack, no useful move). Kept just above ending the activation.
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
      return 0;

    // Group members act in the order the engine lines them up.
    case 'SwitchGroupMember':
      return -1;
  }
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
  const hunt = theirKing ? zoneField(state, board, [theirKing.pos]) : undefined;
  const plan: KingPlan = { ourKing, theirKing, threats, hunt };
  return goal ? { ...plan, goal } : plan;
}

/**
 * How far a non-King unit at `from` is from its quarry: a threat to our King
 * if there is one (protect first — the closer a threat is to the King, the
 * sooner it must be met), else the enemy King — by walking distance, unless
 * the hunter flies over the rock in between — else simply the nearest enemy.
 * A shooter counts its quarry no nearer than `reach`, its range.
 */
function kingHuntDistance(board: Board, plan: KingPlan, from: Vec, enemies: Unit[], flies = false, reach = 0): number {
  const king = plan.ourKing;
  if (king && plan.threats.length > 0) {
    let min = Infinity;
    for (const t of plan.threats) min = Math.min(min, Math.max(board.distance(from, t.pos), reach) + 2 * (board.distance(t.pos, king.pos) - 1));
    return min;
  }
  if (plan.theirKing) {
    // Hunting the Pig: as good a hex nearer the goal than it is bars its way too.
    const barring = plan.goal && walk(plan.goal, from) >= walk(plan.goal, plan.theirKing.pos) ? 0.5 : 0;
    const walked = plan.hunt && !flies ? walk(plan.hunt, from) : FAR;
    return Math.max(walked < FAR ? walked : board.distance(from, plan.theirKing.pos), reach) + barring;
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
