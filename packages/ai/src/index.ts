import {
  adjacentEnemies,
  airborne,
  aliveUnits,
  BREAK_FREE_COST,
  canWarCry,
  isDown,
  spellTargets,
  warCryTargets,
  enemiesOf,
  flagAtBase,
  pigExtracted,
  pigOf,
  getLegalCommands,
  inMelee,
  groupFor,
  kingOf,
  makeHexGrid,
  slipsAway,
  roundLimitOf,
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
  type WalkRules,
} from '@fansong/engine';
import { actionOdds, activationOrder, exposure, MoveSetup, threat, threatOn, threatShares, type BlowStake, type Standing } from './tactics.js';
import { lookahead, searchOf, type Plan, type Policy, type Ranked } from './search.js';
import { binomial, blowOutcome, blowValue, KING_WORTH, outcomeValue, ownWorth, pointWorth, successChance, successOdds, worthOf, type BlowOutcome } from './value.js';

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
  // A mode with a search looks further than one command ({@link lookahead}); the rest play as ever.
  const search = searchOf(state);
  if (search) return commands[lookahead(state, board, commands, search, PLAIN)]!;
  return commands[bestCommand(state, board, commands).index]!;
}

/** The best of `commands` in `state`, as {@link chooseCommand} picks it with no search, and what it scored. */
function bestCommand(state: GameState, board: Board, commands: Command[]): Ranked {
  return bestCommands(state, board, commands, 1)[0]!;
}

/** The best `width` of `commands` in `state`, best first, ties toward the earlier command, and what each scored. */
function bestCommands(state: GameState, board: Board, commands: Command[], width: number): Ranked[] {
  const zones = zonePlan(state, board, state.active);
  const flags = flagPlan(state, board, state.active);
  const kings = kingPlan(state, board, state.active);

  // The unit acting weighs everything it could do on the one scale, in every mode.
  const oneScale = state.phase === 'acting' && !state.spell && !!state.activeUnitId;
  const scores = oneScale ? planScores(state, board, commands, zones, kings, flags) : commands.map((command) => ladderScore(state, board, zones, flags, kings, command));

  // A move scored for its setup has yet to pay for the risk it ends in (see
  // `setupEdge`). The risk only ever lowers a score, so the moves are weighed in
  // order of their score without it, and the rest are left once none can make the list.
  const setup = oneScale && nothingHeldBack(state, zones, kings) ? undefined : setups.get(state);
  const waiting: number[] = [];
  const top: Ranked[] = [];
  for (let i = 0; i < commands.length; i++) {
    if (setup && commands[i]!.type === 'Move') waiting.push(i);
    else rankIn(top, i, scores[i]!, width);
  }
  waiting.sort((a, b) => scores[b]! - scores[a]! || a - b);
  for (const i of waiting) {
    if (top.length >= width && scores[i]! < top[width - 1]!.score) break;
    scores[i]! -= SETUP_SCALE * EXPOSURE_WEIGHT * setup!.risk((commands[i] as Extract<Command, { type: 'Move' }>).to);
    rankIn(top, i, scores[i]!, width);
  }
  return top;
}

/** Put command `index` in its place among the best `width` so far: by score, the earlier command first among equals. */
function rankIn(top: Ranked[], index: number, score: number, width: number): void {
  let at = top.length;
  while (at > 0 && (score > top[at - 1]!.score || (score === top[at - 1]!.score && index < top[at - 1]!.index))) at--;
  if (at >= width) return;
  top.splice(at, 0, { index, score });
  if (top.length > width) top.pop();
}

/**
 * Whether an activation is one the beam search may put in another order: one
 * unit on its own, going by what it has to do ({@link orderScore}). A group, a
 * Magic User with a spell worth casting and a Leader with a war cry to sound go
 * when the plain AI says.
 */
function openActivation(state: GameState, board: Board, command: Command): boolean {
  if (command.type !== 'ChooseActivation' || command.group) return false;
  const unit = unitById(state, command.unitId)!;
  return magicActivationScore(state, board, command) === undefined && warCryReach(state, unit) < WAR_CRY_QUORUM;
}

/**
 * The best plan of `unit`, of the side choosing, were it acting now with
 * `actions` actions, as {@link planNow} reads it: what {@link planScores} gives
 * the best thing it could do, with what getting up spares it when it is on the
 * ground (which takes the first action). And the position the plan leaves: the
 * unit on the hex it moves to, or the odds that its blow or shot kills or knocks
 * down and the position with the target gone or on the ground. A position to score, never to play: no dice.
 */
function planOf(state: GameState, board: Board, unit: Unit, actions: number): Plan {
  let acting: GameState = { ...state, phase: 'acting', activeUnitId: unit.id, actionsRemaining: actions };
  let stood = 0;
  if (unit.knockedDown) {
    const units: Unit[] = [];
    for (const u of state.units) units.push(u.id === unit.id ? { ...u, knockedDown: false } : u);
    acting = { ...acting, units, actionsRemaining: actions - 1 };
    stood = Math.max(0, threatOn(state, board, unit) - threatOn(acting, board, unitById(acting, unit.id)!)) * PLAN_SCALE;
    if (actions <= 1) return { score: stood };
  }
  // The same unit in the same position weighs its moves once, whatever the actions it holds ({@link MoveSetup} counts none).
  let shared = planSetups.get(state);
  if (!shared) {
    shared = new Map();
    planSetups.set(state, shared);
  }
  const known = shared.get(unit.id);
  if (known) setups.set(acting, known);
  const commands = getLegalCommands(acting);
  const best = bestCommand(acting, board, commands);
  const made = setups.get(acting);
  if (made && !known) shared.set(unit.id, made);
  const command = commands[best.index]!;
  const plan: Plan = { score: stood + best.score };
  if (command.type === 'Move') {
    const units: Unit[] = [];
    for (const u of acting.units) units.push(u.id === unit.id ? { ...u, pos: { x: command.to.x, y: command.to.y }, activatedThisRound: true } : u);
    plan.moved = { ...state, units };
  } else if (command.type === 'Attack' || command.type === 'Shoot') {
    const ranged = command.type === 'Shoot';
    const pressed = command.type === 'Attack' ? command.power === true : command.aimed === true;
    const target = unitById(acting, command.targetId)!;
    const o = blowOutcome(acting, board, unitById(acting, unit.id)!, target, pressed, ranged);
    // A Tough foe on its feet is knocked down by the blow that would have killed it; half the lesser hits are a push, as everywhere.
    const saved = target.traits.tough && !target.knockedDown;
    plan.target = target.id;
    plan.kill = saved ? 0 : o.kill;
    plan.down = target.knockedDown ? 0 : o.hurt / 2 + (saved ? o.kill : 0);
    if (plan.kill > 0) {
      const units: Unit[] = [];
      for (const u of acting.units) units.push(u.id === target.id ? { ...u, dead: true } : u);
      plan.killed = { ...state, units };
    }
    if (plan.down > 0) {
      const units: Unit[] = [];
      for (const u of acting.units) units.push(u.id === target.id ? { ...u, knockedDown: true } : u);
      plan.downed = { ...state, units };
    }
  }
  return plan;
}

/** The {@link MoveSetup} of each unit {@link planOf} has made a plan for in a given position, by the unit's id. */
const planSetups = new WeakMap<GameState, Map<string, MoveSetup>>();

/**
 * What a position is worth to `side` on the one scale, in {@link blowValue}
 * terms: the units it still has over the enemy's, at what each is worth, and
 * what it threatens over what it is exposed to from where everyone stands.
 */
function positionValue(state: GameState, board: Board, side: Owner): number {
  let value = threat(state, board, side) - EXPOSURE_WEIGHT * exposure(state, board, side);
  for (const u of state.units) {
    if (!u.dead) value += u.owner === side ? worthOf(state, u) : -worthOf(state, u);
  }
  return value;
}

/** The AI with the search off, as the search calls it. */
const PLAIN: Policy = { rank: bestCommands, open: openActivation, plan: planOf, leaf: positionValue };

/** A command's score on the ladder (who activates, in every mode, and a spell's target): its kind first, then how good a one of its kind it is. */
function ladderScore(
  state: GameState,
  board: Board,
  zones: ZoneView[],
  flags: FlagPlan | undefined,
  kings: KingPlan | undefined,
  command: Command,
): number {
  let score = scoreCommand(state, board, zones, kings, flags, command);
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
  return { counts, sent, holding: !!sent && up && sent.keys.has(key), point: pointWorth(state) };
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
  /** Capture-the-flag only: where everyone but the carrier is sent ({@link flagDistance}). */
  flags: FlagPlan | undefined;
  /** The golden Pig's hunters only: its road to the goal, once the clock makes a Move of it worth barring ({@link PigRoad}). */
  road: PigRoad | undefined;
}

function courtOf(state: GameState, board: Board, plan: KingPlan, unit: Unit, flags?: FlagPlan): Court {
  const royal = plan.ourKing?.id === unit.id;
  return {
    plan,
    royal,
    home: royal ? plan.goal : undefined,
    // A flag carrier waits for no one: its friends are on its way home already.
    front: royal && plan.goal && !flags ? escortFront(state, plan.goal, unit) : 0,
    chase: { ...plan, threats: [] },
    shares: plan.ourKing ? threatShares(state, board, plan.ourKing) : undefined,
    flags,
    road: !flags && plan.goal && plan.theirKing ? pigRoad(state, board, plan.goal, plan.theirKing, unit) : undefined,
  };
}

/**
 * Capture-the-flag as a {@link Court}: our carrier is what its side keeps safe
 * and the enemy's what it hunts, each worth the capture it would make
 * ({@link worthOf}), and the carrier's base is the goal it walks to, as the
 * golden Pig's is. So a carrier weighs its own blows and no blow at one is free.
 */
function flagCourt(state: GameState, board: Board, flags: FlagPlan, unit: Unit): Court {
  const ourKing = flags.carrierId === undefined ? undefined : unitById(state, flags.carrierId);
  const theirKing = flags.enemyCarrierId === null ? undefined : unitById(state, flags.enemyCarrierId);
  return courtOf(state, board, { ourKing, theirKing, threats: [], goal: flags.home }, unit, flags);
}

/**
 * What leaving contact costs a flag carrier or the golden Pig, in
 * {@link blowValue} terms: the free hack of each standing foe beside it, by its
 * odds, at what the unit is worth. Anyone else is held by
 * {@link DISENGAGE_COST}; a carrier's way home, and the Pig's against its clock,
 * are weighed against the blows they would take by staying.
 */
function hackRisk(state: GameState, board: Board, unit: Unit): number {
  if (slipsAway(state, unit)) return 0;
  let risk = 0;
  for (const e of adjacentEnemies(state, unit, board)) {
    if (isDown(e)) continue;
    const o = blowOutcome(state, board, e, unit, false, false);
    risk += o.kill * o.killWorth + o.hurt * o.hurtWorth;
  }
  return risk;
}

/**
 * The golden Pig's clock: by the Moves it still has to make, the share of the
 * game it loses to the round limit ({@link lateness}), counted over the rounds
 * left once this one is played.
 */
interface PigClock {
  /** Hexes to a Move. */
  pace: number;
  /** The share of the game lost with so many Moves still to make. */
  late: number[];
}

/**
 * The share of the game the clock takes from a Pig with `moves` Moves still to
 * make and `rounds` rounds to make them in, at a Move a round, the pace its
 * clock is set by: the chance its dice give it a Move in too few of those
 * rounds, on the two dice the AI usually rolls. A Pig behind that pace counts a
 * whole game for each round it is behind, so there is always something to gain
 * by going on.
 */
function clockCost(moves: number, rounds: number, quality: number): number {
  if (moves <= 0) return 0;
  if (moves > rounds) return moves - rounds;
  const p = 1 - successOdds(quality, 2, false)[0]!;
  let short = 0;
  for (let i = 0; i < moves; i++) short += binomial(rounds, i) * p ** i * (1 - p) ** (rounds - i);
  return short;
}

/** The clock of the golden Pig `pig` with `rounds` rounds still to play in; `undefined` with no round limit. */
function clockOf(goal: Map<string, number>, pig: Unit, rounds: number | undefined): PigClock | undefined {
  if (rounds === undefined) return undefined;
  const pace = unitMove(pig);
  const far = walk(goal, pig.pos);
  if (far >= FAR) return undefined;
  const late: number[] = [];
  // A Move more than it needs from where it stands: as far back as it could go, or be held.
  for (let moves = 0; moves <= Math.ceil(far / pace) + 2; moves++) late.push(clockCost(moves, Math.max(rounds, 0), pig.quality));
  return { pace, late };
}

/** The clock of the golden Pig as it acts: the rounds left are those after this one. */
function pigClock(state: GameState, goal: Map<string, number>, pig: Unit): PigClock | undefined {
  const limit = roundLimitOf(state);
  return clockOf(goal, pig, limit === undefined ? undefined : limit - state.round);
}

/** The share of the game the clock takes from a Pig standing `far` hexes from the goal ({@link clockCost}). */
function lateness(clock: PigClock, far: number): number {
  const moves = Math.ceil(far / clock.pace);
  return moves < clock.late.length ? clock.late[moves]! : clock.late[clock.late.length - 1]! + (moves - clock.late.length + 1);
}

/** The clock of the golden Pig as its hunters see it: the rounds left are those it has still to act in. */
function pigRoad(state: GameState, board: Board, goal: Map<string, number>, pig: Unit, hunter: Unit): PigRoad | undefined {
  const limit = roundLimitOf(state);
  const clock = clockOf(goal, pig, limit === undefined ? undefined : limit - state.round + (pig.activatedThisRound ? 0 : 1));
  if (!clock) return undefined;
  const moves = Math.ceil(walk(goal, pig.pos) / clock.pace);
  // With rounds enough in hand a Move lost costs the Pig nothing to speak of: its road is not looked at.
  if (moves < 1 || (clock.late[moves + 1]! - clock.late[moves]!) * KING_WORTH * PLAN_SCALE < 1) return undefined;
  return new PigRoad(state, board, goal, pig, hunter, clock, moves);
}

/**
 * The golden Pig's road to the goal as a hunter sees it: how much of its next
 * Move the Pig loses to the hunters in its way, with the hunter acting on a
 * given hex, and what that is worth on the Pig's clock ({@link clockCost}).
 *
 * The Pig's Move is the engine's own walk: it passes no foe, and stops where it
 * comes beside one. A hex beside a standing foe is no progress either, since
 * the next Move from there costs a free hack; so a Pig with a standing hunter
 * beside it loses the whole Move, and one with a hunter across its road loses
 * the hexes it can no longer make and still be free to go on.
 */
class PigRoad {
  /** Hexes from the Pig to the goal, and how many of them a Move could make. */
  private readonly far: number;
  private readonly full: number;
  /** Whether a standing hunter other than the one acting is beside the Pig. */
  private pinned = false;
  /** Hexes of the other hunters, hexes beside one, and hexes beside one on its feet. */
  private readonly foes = new Set<string>();
  private readonly stops = new Set<string>();
  private readonly held = new Set<string>();
  /** Hexes anyone but the Pig and the hunter acting stands on. */
  private readonly taken = new Set<string>();
  /** The hunter acting, for the walk being made: its hex and those beside it. */
  private at = '';
  private readonly ring = new Set<string>();
  private readonly rules: WalkRules;
  /** The share of a Move lost, by the hunter's hex; `''` with the hunter out of the way. */
  private readonly lost = new Map<string, number>();

  constructor(
    state: GameState,
    private readonly board: Board,
    private readonly goal: Map<string, number>,
    private readonly pig: Unit,
    hunter: Unit,
    private readonly clock: PigClock,
    private readonly moves: number,
  ) {
    this.far = walk(goal, pig.pos);
    this.full = Math.min(clock.pace, this.far);
    for (const u of state.units) {
      if (u.dead || u.id === pig.id || u.id === hunter.id) continue;
      this.taken.add(vecKey(u.pos));
      if (u.owner === pig.owner) continue;
      this.foes.add(vecKey(u.pos));
      const up = !isDown(u);
      if (up && board.distance(u.pos, pig.pos) === 1) this.pinned = true;
      for (const n of board.neighbors(u.pos)) {
        this.stops.add(vecKey(n));
        if (up) this.held.add(vecKey(n));
      }
    }
    this.rules = {
      passable: (v) => {
        const key = vecKey(v);
        return key !== this.at && !this.foes.has(key);
      },
      stops: (v) => {
        const key = vecKey(v);
        return this.ring.has(key) || this.stops.has(key);
      },
    };
  }

  /** The share of its next Move the Pig loses with the hunter acting standing on `at`, or out of the way with none given. */
  private loss(at: Vec | undefined): number {
    if (this.pinned) return 1;
    const { board, pig, goal, ring } = this;
    const apart = at ? board.distance(at, pig.pos) : FAR;
    if (apart === 1) return 1;
    // Too far off to stand in the way of this Move, or beside it.
    if (apart > this.clock.pace + 1) at = undefined;
    const key = at ? vecKey(at) : '';
    let lost = this.lost.get(key);
    if (lost !== undefined) return lost;
    this.at = key;
    ring.clear();
    if (at) for (const n of board.neighbors(at)) ring.add(vecKey(n));
    let best = this.far;
    for (const hex of board.reachableWithin(pig.pos, this.clock.pace, this.rules)) {
      const left = goal.get(hex);
      if (left === undefined || left >= best || hex === key || this.taken.has(hex)) continue;
      // On the goal it is home, whoever stands beside it.
      if (left > 0 && (ring.has(hex) || this.held.has(hex))) continue;
      best = left;
    }
    lost = (this.full - (this.far - best)) / this.full;
    this.lost.set(key, lost);
    return lost;
  }

  /** What the Pig's road is worth to its hunters with the hunter acting on `at`, in {@link blowValue} terms: the share of the game the clock takes from it. */
  worth(at: Vec | undefined): number {
    const moves = this.moves + this.loss(at);
    const whole = Math.floor(moves);
    const late = this.clock.late;
    return KING_WORTH * (late[whole]! + (moves - whole) * ((late[whole + 1] ?? late[whole]!) - late[whole]!));
  }

  /** What the hunter acting holds by standing on `at`: what the road is worth with it there, over what it is with it out of the way. */
  hold(at: Vec): number {
    return this.worth(at) - this.worth(undefined);
  }
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
 * A blow or shot at the enemy's flag carrier, weighed by the capture it may
 * stop: the flag falls with a carrier that is killed or knocked down, Tough or
 * not, so each counts the whole capture ({@link pointWorth}), and not the share
 * of a unit's worth a lesser hit is elsewhere. (As with a zone, a push is taken
 * to do as much.)
 */
function stopsCapture(state: GameState, o: BlowOutcome): void {
  o.killWorth = o.hurtWorth = pointWorth(state);
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
 * Whether a blow at `target` is struck whatever it may cost the striker: one at
 * the enemy King by anyone but our own, since the game rides on it. Not so a
 * blow at the golden Pig: the clock ends that game, and it is for the Pig to come on.
 */
function costsNothing(court: Court, target: Unit): boolean {
  return !court.royal && !court.plan.goal && target.id === court.plan.theirKing?.id;
}

/**
 * {@link blowValue}, and what the mode adds to it: in the zone modes what the
 * blow does to the hold on the zones ({@link zoneSwing}); in kill-the-king what
 * it spares our King ({@link kingSwing}), and the blows our King does not
 * strike ({@link tradesForNothing}); in capture-the-flag what it spares our
 * carrier, by the same term, and the capture a blow at the enemy's may stop
 * ({@link stopsCapture}).
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
  if (court && costsNothing(court, target)) o.lossWorth = 0;
  if (court?.flags && target.id === court.plan.theirKing?.id) stopsCapture(state, o);
  let value = outcomeValue(o, pressed, actions);
  if (hold) value += zoneSwing(hold, o, target, from ?? attacker.pos, ranged);
  if (court) value += kingSwing(court, o, target);
  // A hunter that loses the exchange is down or driven off: it bars the Pig's road no longer.
  if (court?.road && !ranged) value -= o.lose * court.road.hold(from ?? attacker.pos);
  return value;
}

/** A holder's move out of the zone it was sent to: under ending its activation whatever it would gain. */
const LEAVE_ZONE = -1_000_000;

/** The golden Pig's move into the goal, or a flag carrier's onto its base: over anything else it could do short of standing there already. */
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
 * The round limit is on the scale as the share of the game it takes
 * ({@link clockCost}): a Move of the Pig's is worth what it wins back of that,
 * escort or none, and so is the free hack it pays to leave a foe, which it
 * weighs by its odds ({@link hackRisk}) where anyone else is held. To its
 * hunters the same share is worth standing across its road or beside it
 * ({@link PigRoad}), and a blow that may cost a hunter its place there counts
 * that loss.
 * Two things are not weighed: the Pig standing in the goal ends its activation
 * there, and a move that takes it into the goal comes before anything else.
 *
 * Capture-the-flag (`flags`) is on the scale by what a capture is worth
 * ({@link pointWorth}: the game), which is what a unit with a flag in its hands
 * is worth to both sides ({@link worthOf}). So a blow at the enemy carrier, or
 * a hex that threatens it, counts the capture it may stop ({@link stopsCapture});
 * a blow our carrier
 * strikes counts the capture it may lose, and so does every blow it risks, in
 * the exposure of its moves and its friends', in a friend's blow at a foe that
 * threatens it ({@link kingSwing}) and in the free hacks it draws by leaving a
 * foe ({@link hackRisk}). Each unit counts its walking distance to what the
 * plan sends it after ({@link flagDistance}): the carrier home, the rest to the
 * enemy flag, to our own where it lies dropped or to the enemy carrier, and
 * with none of those to the nearest foe. A move that picks the enemy flag up,
 * or sends our own back to its base, is worth the capture as well: what the
 * unit is worth from then on, or the enemy's carrier was. One thing is not
 * weighed: a carrier that can step onto its base does.
 */
function planScores(state: GameState, board: Board, commands: Command[], zones: ZoneView[], kings?: KingPlan, flags?: FlagPlan): number[] {
  const unit = unitById(state, state.activeUnitId!)!;
  const enemies = enemiesOf(state, unit.owner);
  const left = state.actionsRemaining - 1;
  const hold = zones.length > 0 ? holdView(state, zones, unit) : undefined;
  const sent = hold?.sent;
  const court = kings ? courtOf(state, board, kings, unit) : flags ? flagCourt(state, board, flags, unit) : undefined;
  // A flag in hand is worth the capture, to the side that holds it and to the one that has lost it.
  const flagWorth = flags ? pointWorth(state) * PLAN_SCALE : 0;
  // The golden Pig acting, and what the clock makes of where it stands ({@link pigClock}).
  const clock = court?.home && !flags ? pigClock(state, court.home, unit) : undefined;
  // A flag carrier and the golden Pig weigh the hacks they would draw; anyone else is held where it stands.
  const weighsHacks = flags ? court!.royal : !!court?.home;
  const hacks = weighsHacks ? hackRisk(state, board, unit) * PLAN_SCALE : disengageCost(state, board, unit.id);
  const here = placeScore(board, unit, unit.pos, enemies, sent, court);
  const lateHere = clock ? lateness(clock, walk(court!.home!, unit.pos)) : 0;
  const road = court?.road;
  const roadHere = road ? road.worth(unit.pos) : 0;
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
        if (flags && (sameVec(flags.grab, to) || sameVec(flags.rescue, to))) score += flagWorth;
        if (clock) score += (lateHere - lateness(clock, walk(court!.home!, to))) * KING_WORTH * PLAN_SCALE;
        if (road) score += (road.worth(to) - roadHere) * PLAN_SCALE;
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
 * ({@link kingHuntDistance}); a flag carrier its base, and its side what the
 * flag plan sends them after ({@link flagDistance}); else the nearest foe. Our
 * King is sent nowhere.
 */
function placeScore(board: Board, unit: Unit, at: Vec, enemies: Unit[], sent: ZoneView | undefined, court: Court | undefined): number {
  if (sent) return -zoneDistance(at, sent) * APPROACH;
  if (court?.home) return -Math.max(walk(court.home, at), court.front) * APPROACH;
  if (court?.flags) {
    const goal = flagDistance(court.flags, at, unit.traits.ranged >= 2 ? unit.traits.ranged : 0);
    return goal < FAR ? -goal * APPROACH : standingScore(unit, nearestEnemyDistance(board, at, enemies));
  }
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
function orderEdge(state: GameState, board: Board, unit: Unit, sitsOut?: string, mode?: ModeOrder): number | undefined {
  let order = orders.get(state);
  if (!order) {
    order = activationOrder(state, board, unit.owner, sitsOut, mode?.stake);
    orders.set(state, order);
  }
  const standing = order.get(unit.id);
  // What its activation does for the mode besides its blows: for the hold on the zones, or for our King.
  const more = mode ? mode.edge(unit, standing?.own ?? 0) : 0;
  if (!standing || standing.own + standing.gift + more <= 0) return undefined;
  return Math.max(-ORDER_SPAN, Math.min(ORDER_SPAN, standing.own + standing.gift - standing.wait + more));
}

/** The widest {@link orderEdge}: keeps the fighters' order inside their own band of activation scores. */
const ORDER_SPAN = 15;

/**
 * The activation score of a unit that goes by what it has to do now
 * ({@link orderEdge}): whoever has the most to do goes first, counting what it
 * sets up for its friends, and a unit a friend could set up waits for it. With
 * nothing to do yet, the one with the fewest hexes (`dist`) to where it is going.
 * `sitsOut` names a unit of its side that never steps up to a foe for a friend.
 * `mode` is a mode's part of it ({@link ModeOrder}).
 */
function orderScore(state: GameState, board: Board, unit: Unit, canAttack: boolean, dist: number, sitsOut?: string, mode?: ModeOrder): number {
  const edge = orderEdge(state, board, unit, sitsOut, mode);
  return edge !== undefined || canAttack ? 100_000 + (edge ?? 0) * ORDER_SCALE : 10_000 - dist * 100;
}

/**
 * A mode's part of who goes next ({@link orderEdge}), in {@link blowValue}
 * terms: what it adds to a blow of the side choosing ({@link BlowStake}), and
 * what a unit's activation is worth to it besides its blows, given the best
 * blow the unit has (`own`).
 */
interface ModeOrder {
  readonly stake: BlowStake;
  edge(unit: Unit, own: number): number;
}

/** The {@link HoldOrder} of the side choosing in a given state: one per decision, shared by all its activations. */
const holdOrders = new WeakMap<GameState, HoldOrder>();

function holdOrderOf(state: GameState, board: Board, zones: ZoneView[]): HoldOrder {
  let order = holdOrders.get(state);
  if (!order) {
    order = new HoldOrder(state, board, zones);
    holdOrders.set(state, order);
  }
  return order;
}

/**
 * The zone modes' part of who goes next ({@link orderEdge}): what a unit's
 * activation does for the hold on the zones, in {@link blowValue} terms, as
 * {@link planScores} weighs it for the unit acting.
 *
 * Its blows count the step each may win or lose ({@link stake}, which is
 * {@link zoneSwing}), so a blow at a foe standing in a zone is worth going for
 * sooner, and a lone holder's blow at an equal is not. A unit that one Move
 * takes into the zone it was sent to, or that only has to get up in it, counts
 * the step that wins ({@link edge}), by the odds it gets the actions. And a
 * unit on the ground counts what getting up spares it.
 */
class HoldOrder implements ModeOrder {
  private readonly views = new Map<string, HoldView>();
  /** What a blow of the side choosing does to the hold on the zones ({@link zoneSwing}). */
  readonly stake: BlowStake;

  constructor(
    private readonly state: GameState,
    private readonly board: Board,
    private readonly zones: ZoneView[],
  ) {
    this.stake = (attacker, target, o, from, ranged) => zoneSwing(this.view(attacker), o, target, from ?? attacker.pos, ranged);
  }

  private view(unit: Unit): HoldView {
    let view = this.views.get(unit.id);
    if (!view) {
      view = holdView(this.state, this.zones, unit);
      this.views.set(unit.id, view);
    }
    return view;
  }

  /** Whether `unit` has nowhere to go: on its feet in the zone it was sent to, or held beside a standing foe. */
  stays(unit: Unit): boolean {
    return this.view(unit).holding || (inMelee(this.state, unit, this.board) && !slipsAway(this.state, unit));
  }

  /**
   * What `unit` going now does for the zones and for itself, its blows apart:
   * the step of control it wins by walking into the zone it was sent to, when
   * one Move takes it there (by walking distance: a bound, as for a charge), or
   * by getting up in it; and, on the ground, what the enemy can do to it there
   * that it could not do to it on its feet. Each by the odds it gets the actions.
   */
  edge(unit: Unit): number {
    const { state, board } = this;
    if (unit.transfixedBy !== undefined) return 0;
    let edge = 0;
    if (unit.knockedDown) edge += actionOdds(state, unit, 1) * stoodGain(state, board, unit);
    const hold = this.view(unit);
    const sent = hold.sent;
    if (!sent || hold.holding) return edge;
    const key = vecKey(unit.pos);
    let need = unit.knockedDown ? 1 : 0;
    if (!sent.keys.has(key)) {
      if (zoneDistance(unit.pos, sent) > unitMove(unit) || (inMelee(state, unit, board) && !slipsAway(state, unit))) return edge;
      need++;
    }
    // The zone it comes to stand in, and the one it walks out of.
    let step = 0;
    for (const c of hold.counts) {
      const margin = c.others - c.theirs;
      if (c.zone === sent) step += Math.sign(margin + 1) - Math.sign(margin);
      else if (!unit.knockedDown && c.zone.keys.has(key)) step += Math.sign(margin) - Math.sign(margin + 1);
    }
    return step > 0 ? edge + actionOdds(state, unit, need) * step * hold.point : edge;
  }
}

/** The {@link CourtOrder} of the side choosing in a given state: one per decision, shared by all its activations. */
const courtOrders = new WeakMap<GameState, CourtOrder>();

function courtOrderOf(state: GameState, board: Board, plan: KingPlan): CourtOrder {
  let order = courtOrders.get(state);
  if (!order) {
    order = new CourtOrder(state, board, plan);
    courtOrders.set(state, order);
  }
  return order;
}

/**
 * Kill-the-king's part of who goes next ({@link orderEdge}): what a unit's
 * activation does for our King and against theirs, in {@link blowValue} terms,
 * as {@link planScores} weighs it for the unit acting.
 *
 * Its blows count what {@link strikeValue} adds to them ({@link stake}): a blow
 * at a foe that threatens our King is worth what it may spare the King
 * ({@link kingSwing}), so the unit that can strike that foe goes sooner, and so
 * does the one that steps up to it for a friend; a blow at the enemy King costs
 * its striker nothing ({@link costsNothing}); and the blows our King does not
 * strike ({@link tradesForNothing}) are no reason for it to go.
 *
 * Our King goes by what its best plan is worth ({@link edge}): a hex with less
 * to fear, a guard, a blow at the enemy King. With nothing to gain it goes
 * after everyone, since its roll could only turn the round over.
 */
class CourtOrder implements ModeOrder {
  readonly stake: BlowStake;
  /** The plan with the threats to our King left out: a unit's way to the enemy King, as {@link placeScore} counts it. */
  readonly chase: KingPlan;
  private readonly kingId: string | undefined;
  private turn: number | undefined;

  constructor(
    private readonly state: GameState,
    private readonly board: Board,
    plan: KingPlan,
  ) {
    const king = plan.ourKing;
    this.kingId = king?.id;
    const court: Court = { ...courtOf(state, board, plan, plan.theirKing ?? king ?? state.units[0]!), royal: false };
    const royal: Court = { ...court, royal: true };
    this.chase = court.chase;
    this.stake = (attacker, target, o, _from, ranged) => {
      const mine = attacker.id === this.kingId ? royal : court;
      if (!ranged && tradesForNothing(mine, target)) return -Infinity;
      return kingSwing(mine, o, target) + (costsNothing(mine, target) ? o.lose * o.lossWorth : 0);
    };
  }

  /** Whether `unit` has nowhere to go: our King, or a unit held beside a standing foe. */
  stays(unit: Unit): boolean {
    return unit.id === this.kingId || (inMelee(this.state, unit, this.board) && !slipsAway(this.state, unit));
  }

  /**
   * What our King gains by going now, its blows apart (`own`): what the best
   * thing it could do with one action is worth ({@link planNow}) over standing
   * as it is, by the odds it gets the action, and on the ground what getting up
   * spares it. Anyone else: nothing beyond its blows.
   */
  edge(unit: Unit, own: number): number {
    if (unit.id !== this.kingId || unit.transfixedBy !== undefined) return 0;
    this.turn ??= turnNow(this.state, this.board, unit);
    return Math.max(0, this.turn - own);
  }
}

/**
 * What `unit` gains by going now, in {@link blowValue} terms: what the best
 * thing it could do with one action is worth ({@link planNow}) over standing as
 * it is, by the odds it gets the action, and on the ground what getting up
 * spares it.
 */
function turnNow(state: GameState, board: Board, unit: Unit): number {
  const { now, stood } = planNow(state, board, unit);
  // Standing on guard for nothing scores 1: that is no reason to go.
  const plan = Math.max(0, now - 1) / PLAN_SCALE;
  return actionOdds(state, unit, 1) * stood + actionOdds(state, unit, unit.knockedDown ? 2 : 1) * plan;
}

/** What getting up spares `unit`, on the ground: what the enemy can do to it there that it could not do to it on its feet. */
function stoodGain(state: GameState, board: Board, unit: Unit): number {
  const units: Unit[] = [];
  for (const u of state.units) units.push(u.id === unit.id ? { ...u, knockedDown: false } : u);
  const up: GameState = { ...state, units };
  return Math.max(0, threatOn(state, board, unit) - threatOn(up, board, unitById(up, unit.id)!));
}

/** The {@link FlagOrder} of the side choosing in a given state: one per decision, shared by all its activations. */
const flagOrders = new WeakMap<GameState, FlagOrder>();

function flagOrderOf(state: GameState, board: Board, plan: FlagPlan): FlagOrder {
  let order = flagOrders.get(state);
  if (!order) {
    order = new FlagOrder(state, board, plan);
    flagOrders.set(state, order);
  }
  return order;
}

/**
 * Capture-the-flag's part of who goes next ({@link orderEdge}): what a unit's
 * activation does for the flags, in {@link blowValue} terms, as
 * {@link planScores} weighs it for the unit acting.
 *
 * Its blows count what {@link strikeValue} adds to them ({@link stake}): a blow
 * at a foe that threatens our carrier is worth what it may spare the carrier
 * ({@link kingSwing}), and a blow that kills, knocks down or pushes the enemy's
 * carrier counts the whole capture ({@link stopsCapture}).
 *
 * Our carrier goes by what its best plan is worth ({@link turnNow}): its way
 * home, and a hex with less to fear. A unit on the ground counts what getting
 * up spares it. A flag a Move could pick up or send home is no part of it: such
 * a unit goes by its hexes to the flag, after the fighters (counting the
 * capture for it measured as nothing).
 */
class FlagOrder implements ModeOrder {
  readonly stake: BlowStake;
  private turn: number | undefined;

  constructor(
    private readonly state: GameState,
    private readonly board: Board,
    private readonly plan: FlagPlan,
  ) {
    const court = flagCourt(state, board, plan, state.units[0]!);
    const capture = pointWorth(state);
    const quarry = plan.enemyCarrierId;
    this.stake = (_attacker, target, o) => {
      const swing = kingSwing(court, o, target);
      return target.id === quarry ? swing + o.kill * (capture - o.killWorth) + o.hurt * (capture - o.hurtWorth) : swing;
    };
  }

  /** Whether `unit` is held beside a standing foe. A carrier is not: it weighs the hack ({@link hackRisk}). */
  stays(unit: Unit): boolean {
    return unit.id !== this.plan.carrierId && inMelee(this.state, unit, this.board) && !slipsAway(this.state, unit);
  }

  /**
   * What `unit` going now does for the flags and for itself, its blows apart
   * (`own`). Our carrier: what its best plan is worth. Anyone else, on the
   * ground: what getting up spares it, by the odds it gets the action.
   */
  edge(unit: Unit, own: number): number {
    const { state, board } = this;
    if (unit.transfixedBy !== undefined) return 0;
    if (unit.id === this.plan.carrierId) {
      this.turn ??= turnNow(state, board, unit);
      return Math.max(0, this.turn - own);
    }
    return unit.knockedDown ? actionOdds(state, unit, 1) * stoodGain(state, board, unit) : 0;
  }
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
  return caught * ownWorth(state, target) * TRANSFIX_WORTH * follow * spent;
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
        ? ownWorth(state, unit) * (threatened ? 1 : 0.5)
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
  flags: FlagPlan | undefined,
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
        const dash = command.diceCount === 3 && unit.id === kings.ourKing?.id && canGetHome(kings.goal, unit) ? HOME_DASH : 0;
        const order = kings.goal ? pigActivationScore(state, board, kings, unit) : kingActivationScore(state, board, kings, unit);
        return leaderFirst(state, unit, order) + diceWorth(state, board, zones, kings, command) + dash;
      }
      if (flags) {
        // So does a carrier one good roll from its base.
        const dash = command.diceCount === 3 && unit.id === flags.carrierId && canGetHome(flags.home, unit) ? HOME_DASH : 0;
        return leaderFirst(state, unit, flagActivationScore(state, board, flags, unit)) + diceWorth(state, board, zones, kings, command) + dash;
      }
      const enemyDist = nearestEnemyDistance(board, unit.pos, enemies);
      let unitScore: number;
      if (zones.length === 0) {
        // Annihilation: whoever has the most to do now goes first ({@link orderScore}),
        // and with nothing to do yet, the one closest to a foe. A unit that can
        // already fight, in melee or a shooter with a foe in range, is never
        // counted as having nothing to do.
        const canAttack = enemyDist === 1 || (unit.traits.ranged >= 2 && enemyDist >= 2 && enemyDist <= unit.traits.ranged);
        unitScore = orderScore(state, board, unit, canAttack, enemyDist);
      } else {
        // The zone modes: the same, with the zones counted in what a unit has to
        // do ({@link HoldOrder}). With nothing to do yet, the one closest to the
        // zone it was sent to, or to a foe when it was sent to none; and one
        // with nowhere to go, holding its zone or held beside a foe, goes last.
        const hold = holdOrderOf(state, board, zones);
        const target = targetZone(zones, unit);
        const dist = hold.stays(unit) ? 100 : Math.min(target ? zoneDistance(unit.pos, target) : enemyDist, 99);
        unitScore = orderScore(state, board, unit, false, dist, undefined, hold);
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
      // No mode's unit comes here any more: `planScores` weighs its moves.
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

/** Whether `unit`, the golden Pig or a flag carrier, could walk into its `goal` with two Moves: worth rolling for now. */
function canGetHome(goal: Map<string, number> | undefined, unit: Unit): boolean {
  return !!goal && walk(goal, unit.pos) <= unitMove(unit) * (unit.knockedDown ? 1 : 2);
}

/** The activation score of a unit that one roll can take home ({@link canGetHome}): before anyone. */
const GOES_HOME = 150_000;

/** What its third die is worth to such a unit, over what the dice policy makes of it. */
const HOME_DASH = 50;

/**
 * Who activates in kill-the-king. Units go as in annihilation
 * ({@link orderScore}): by the blow each can strike, what it sets up for its
 * friends and what a friend could set up for it, with our King and theirs
 * counted in those blows ({@link CourtOrder}); so a foe that threatens our King
 * is dealt with first by what that spares the King, not by a rule. Our King
 * goes by what its best plan is worth, and is never the one to step up to a
 * foe for a friend. With nothing to do yet, a unit goes by its hexes to the
 * enemy King ({@link kingHuntDistance}, as {@link placeScore} counts them);
 * one with nowhere to go, our King or a unit held beside a foe, goes after all.
 */
function kingActivationScore(state: GameState, board: Board, plan: KingPlan, unit: Unit): number {
  const order = courtOrderOf(state, board, plan);
  let dist = 100;
  if (!order.stays(unit)) {
    const range = unit.traits.ranged;
    dist = Math.min(kingHuntDistance(board, order.chase, unit.pos, enemiesOf(state, state.active), unit.traits.flying, range >= 2 ? range : 0), 99);
  }
  return orderScore(state, board, unit, false, dist, plan.ourKing?.id, order);
}

/** The golden Pig's activation score when it waits for its escort: under any of them still to go. */
const PIG_WAITS = 50;

/** {@link pigTurn} of the Pig of the side choosing in a given state: one per decision, shared by its activations. */
const pigTurns = new WeakMap<GameState, number>();

/**
 * Who activates in the golden Pig. Escorts and hunters go as in annihilation
 * ({@link orderScore}): by the blow each can strike, what it sets up for its
 * friends and what a friend could set up for it, and with nothing to do yet by
 * the hexes to their quarry ({@link kingHuntDistance}). The Pig is never the one
 * to step up to a foe for a friend.
 *
 * The Pig goes when going is worth most ({@link pigTurn}): among the fighters,
 * by what it gains by going now, or after every escort still to go. One thing
 * is not weighed: a Pig that one roll can take home goes before anyone.
 */
function pigActivationScore(state: GameState, board: Board, plan: KingPlan, unit: Unit): number {
  if (unit.id !== plan.ourKing?.id) {
    const enemies = enemiesOf(state, state.active);
    const nearest = nearestEnemyDistance(board, unit.pos, enemies);
    const canAttack = nearest === 1 || (unit.traits.ranged >= 2 && nearest >= 2 && nearest <= unit.traits.ranged);
    const dist = Math.min(kingHuntDistance(board, plan, unit.pos, enemies, unit.traits.flying), 99);
    return orderScore(state, board, unit, canAttack, dist, plan.ourKing?.id);
  }
  if (canGetHome(plan.goal, unit)) return GOES_HOME;
  let edge = pigTurns.get(state);
  if (edge === undefined) {
    edge = pigTurn(state, board, plan.goal!, unit);
    pigTurns.set(state, edge);
  }
  return edge > 0 ? 100_000 + Math.min(edge, ORDER_SPAN) * ORDER_SCALE : PIG_WAITS;
}

/**
 * What the golden Pig gains by going now rather than after its escort, in
 * {@link blowValue} terms.
 *
 * Going now is worth its best plan as things stand: what {@link planScores}
 * gives the best thing it could do with the one action its clock counts on, a
 * Move held to where its escort has come and to where no foe can charge it, or
 * a blow, or stepping out of a foe's reach. Going last is worth a Move with its
 * road cleared and screened, at the most a whole Move and what that wins back
 * on the clock, if no escort still to go turns the round over first, on the two
 * dice the AI usually rolls. So a Pig with nothing in its way goes ahead, since
 * waiting only risks its Move; one held up waits for its escort to clear the
 * way; and the more the clock makes of this round's Move, the less it stakes it
 * on its escort's dice. A Pig on the ground counts what standing spares it.
 */
function pigTurn(state: GameState, board: Board, goal: Map<string, number>, pig: Unit): number {
  const { now, stood } = planNow(state, board, pig);
  const far = walk(goal, pig.pos);
  const pace = unitMove(pig);
  let open = Math.min(pace, far) * APPROACH;
  const clock = pigClock(state, goal, pig);
  if (clock) open += (lateness(clock, far) - lateness(clock, Math.max(far - pace, 0))) * KING_WORTH * PLAN_SCALE;
  let safe = 1;
  for (const u of state.units) {
    if (u.dead || u.owner !== pig.owner || u.id === pig.id || u.activatedThisRound) continue;
    safe *= 1 - successOdds(u.quality, 2, u.inspired)[0]!;
  }
  return stood + (now - safe * open) / PLAN_SCALE;
}

/**
 * What going now is worth to `unit`, a unit of the side choosing, as things
 * stand: `now`, what {@link planScores} gives the best thing it could do with
 * one action, on its feet; and `stood`, in {@link blowValue} terms, what
 * getting up spares it when it is on the ground. A position to score, never to
 * play: the same state with the unit acting, and no dice.
 */
function planNow(state: GameState, board: Board, unit: Unit): { now: number; stood: number } {
  let acting: GameState = { ...state, phase: 'acting', activeUnitId: unit.id, actionsRemaining: 1 };
  let stood = 0;
  if (unit.knockedDown) {
    const units: Unit[] = [];
    for (const u of state.units) units.push(u.id === unit.id ? { ...u, knockedDown: false } : u);
    acting = { ...acting, units };
    stood = Math.max(0, threatOn(state, board, unit) - threatOn(acting, board, unitById(acting, unit.id)!));
  }
  return { now: bestCommand(acting, board, getLegalCommands(acting)).score, stood };
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
  /** The one of {@link goals} that leads to the enemy carrier. */
  quarry: Map<string, number> | undefined;
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
  if (grab) goals.push(zoneField(state, board, [grab]));
  if (rescue) goals.push(zoneField(state, board, [rescue]));
  const quarry = mine.carrier !== null ? zoneField(state, board, [mine.at]) : undefined;
  if (quarry) goals.push(quarry);
  return {
    carrierId: theirs.carrier ?? undefined,
    home: zoneField(state, board, [m.objectives.flags[player]]),
    grab,
    rescue,
    enemyCarrierId: mine.carrier,
    goals,
    quarry,
  };
}

const sameVec = (a: Vec | undefined, b: Vec) => !!a && a.x === b.x && a.y === b.y;

/**
 * Walking distance from `at` to the nearest of what the flag plan sends a unit
 * after: the enemy flag, our own where it lies dropped, the enemy carrier
 * (`FAR` with none of them). A shooter counts the carrier no nearer than
 * `reach`, its range.
 */
function flagDistance(plan: FlagPlan, at: Vec, reach: number): number {
  let min = FAR;
  for (const g of plan.goals) {
    let d = walk(g, at);
    if (d < reach && g === plan.quarry) d = reach;
    if (d < min) min = d;
  }
  return min;
}

/**
 * Who activates in capture-the-flag. Units go as in annihilation
 * ({@link orderScore}): by the blow each can strike, what it sets up for its
 * friends and what a friend could set up for it, with the flags counted in
 * those blows and in what else a unit has to do ({@link FlagOrder}). Our carrier
 * goes by what its best plan is worth, and is never the one to step up to a foe
 * for a friend. With nothing to do yet, a unit goes by its hexes to what the
 * plan sends it after ({@link flagDistance}, as {@link placeScore} counts them),
 * or to the nearest foe with no goal left; one held beside a foe goes after all.
 * One thing is not weighed: a carrier that one roll can take home goes before anyone.
 */
function flagActivationScore(state: GameState, board: Board, plan: FlagPlan, unit: Unit): number {
  const carries = unit.id === plan.carrierId;
  if (carries && canGetHome(plan.home, unit)) return GOES_HOME;
  const order = flagOrderOf(state, board, plan);
  let dist = 100;
  if (carries) {
    dist = Math.min(walk(plan.home, unit.pos), 99);
  } else if (!order.stays(unit)) {
    const range = unit.traits.ranged;
    const goal = flagDistance(plan, unit.pos, range >= 2 ? range : 0);
    dist = Math.min(goal < FAR ? goal : nearestEnemyDistance(board, unit.pos, enemiesOf(state, state.active)), 99);
  }
  return orderScore(state, board, unit, false, dist, plan.carrierId, order);
}

export function playerLabel(owner: Owner): string {
  return `P${owner}`;
}
