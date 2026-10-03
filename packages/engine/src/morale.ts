import { vecKey, type Board, type Vec, type WalkRules } from './board.js';
import { carryFlags, finishGame, isKing, isPig, regrabOnStandUp, returnCarriedFlag } from './mode.js';
import { rollD6 } from './rng.js';
import { airborne, aliveUnits, inEarshot, isOccupied, livingCount, WAR_CRY_RANGE } from './query.js';
import type { GameEvent, GameState, Owner, Unit } from './types.js';

/**
 * Morale. Beyond the activation turnover, casualties shake the survivors:
 *
 *  - **Fear** — when a unit suffers a *gruesome* kill in combat (the winner
 *    tripled its score, or is Savage), every standing friend that sees it —
 *    within {@link MORALE_RADIUS} and in line of sight, as for a war cry —
 *    must pass a nerve check (a d6 ≥ its Quality) or flee. An ordinary kill
 *    shakes no one.
 *  - **Leader** — when a Leader is killed, every standing friend that sees it
 *    fall, by the same reckoning, must pass a nerve check or flee.
 *  - **Rout** — the first time a warband is ground down to a third of its
 *    starting strength it *breaks*: every survivor takes a nerve check, and each
 *    that fails flees. It happens once per side.
 *
 * A **Disloyal** unit that rolls a natural 1 on any of these checks does not
 * flee: it changes sides where it stands (see {@link defect}).
 *
 * A unit that fails any nerve check loses its inspiration (see `Unit.inspired`).
 * A unit that **flees** runs for its own edge of the map (see {@link homeColumn}),
 * taking free hacks from every foe it turns its back on. One already standing on
 * that edge leaves the field for good. A failed check never knocks a unit down.
 *
 * All of this is deterministic (it draws from the state's RNG) and pushes new
 * events, so it replays exactly and is fully unit-testable.
 */

/**
 * How far off a friend sees a gruesome casualty or a fallen Leader, and must
 * test nerve: the reach of a war cry (see `inEarshot`).
 */
export const MORALE_RADIUS = WAR_CRY_RANGE;

/** A warband breaks when its living count falls to this fraction of its start. */
export const ROUT_FRACTION = 1 / 3;

/**
 * Free hacks on a unit turning to run: resolves them (mutating the state and
 * appending events) and reports whether the runner got away on its feet. The
 * combat rules live in `reduce`, so they are handed in; without them nobody
 * strikes at a runner.
 */
export type FreeHacks = (runner: Unit) => boolean;

const noHacks: FreeHacks = () => true;

/**
 * The map column `owner`'s warband flees toward: player 0 deploys on the left
 * edge and player 1 on the right, so each runs back the way it came.
 */
export function homeColumn(board: Board, owner: Owner): number {
  return owner === 0 ? 0 : board.width - 1;
}

/** Roll one nerve check for a unit, record it, and report the natural die and whether it passed. */
function nerveCheck(s: GameState, events: GameEvent[], unit: Unit): { passed: boolean; die: number } {
  const roll = rollD6(s.rngState);
  s.rngState = roll.state;
  const passed = roll.die >= unit.quality;
  const inspirationLost = !passed && unit.inspired;
  if (inspirationLost) unit.inspired = false;
  events.push({
    type: 'NerveCheck',
    unitId: unit.id,
    quality: unit.quality,
    die: roll.die,
    passed,
    ...(inspirationLost ? { inspirationLost: true as const } : {}),
  });
  return { passed, die: roll.die };
}

/**
 * Resolve the morale fallout of a combat casualty: after a `gruesome` kill,
 * nearby friends test nerve (fear); a fallen Leader shakes every friend who
 * saw it fall; then, for any kill, the casualty's warband tests for a rout if
 * it has just crossed the break threshold. Mutates `s` and
 * appends events. A runner cut down by a free hack is a combat casualty in its
 * own right, so the fallout can cascade — but every failed check moves a unit
 * nearer its edge or off the map, so the cascade always ends.
 */
export function resolveCombatMorale(
  s: GameState,
  events: GameEvent[],
  victim: Unit,
  board: Board,
  gruesome: boolean,
  hacks: FreeHacks = noHacks,
): void {
  if (gruesome) fearCheck(s, events, victim, board, hacks);
  if (victim.traits.leader) {
    events.push({ type: 'LeaderFallen', unitId: victim.id });
    leaderCheck(s, events, victim, victim.owner, board, hacks);
  }
  routCheck(s, events, victim.owner, board, hacks);
}

/**
 * `owner`'s side has lost the Leader `leader` — killed, or gone over to the
 * enemy: every standing friend that sees it happen tests nerve (see
 * {@link witnesses}).
 */
function leaderCheck(s: GameState, events: GameEvent[], leader: Unit, owner: Owner, board: Board, hacks: FreeHacks): void {
  fleeFailures(s, events, witnesses(s, leader, owner, board), board, hacks);
}

function fearCheck(s: GameState, events: GameEvent[], victim: Unit, board: Board, hacks: FreeHacks): void {
  fleeFailures(s, events, witnesses(s, victim, victim.owner, board), board, hacks);
}

/**
 * The standing friends on `owner`'s side that see what befalls `unit`: those
 * {@link inEarshot in earshot} of it, as a war cry would carry — within
 * {@link MORALE_RADIUS} hexes, with terrain but not other units blocking sight.
 */
function witnesses(s: GameState, unit: Unit, owner: Owner, board: Board): Unit[] {
  return aliveUnits(s, owner).filter((u) => u.id !== unit.id && !u.knockedDown && inEarshot(board, unit.pos, u.pos));
}

/**
 * The living count at or below which `owner`'s warband breaks (see
 * {@link ROUT_FRACTION}). Exported so a UI can warn a player how close to
 * collapse a side is without re-deriving the rule.
 */
export function routThreshold(state: GameState, owner: Owner): number {
  return Math.floor(state.startCount[owner] * ROUT_FRACTION);
}

function routCheck(s: GameState, events: GameEvent[], owner: Owner, board: Board, hacks: FreeHacks): void {
  if (s.broken[owner]) return;
  const start = s.startCount[owner];
  if (start <= 0 || livingCount(s, owner) > routThreshold(s, owner)) return;

  s.broken[owner] = true;
  events.push({ type: 'WarbandBroken', player: owner });
  fleeFailures(s, events, aliveUnits(s, owner), board, hacks);
}

/**
 * Every unit in `tested` checks nerve at once; then those that failed flee, in
 * unit order — or, Disloyal and on a natural 1, change sides. A unit already
 * caught up in an earlier one's cascade — cut down, sent running or turned by
 * it — is not dealt with twice.
 */
function fleeFailures(s: GameState, events: GameEvent[], tested: Unit[], board: Board, hacks: FreeHacks): void {
  const failed = tested
    .map((u) => ({ unit: u, at: vecKey(u.pos), owner: u.owner, ...nerveCheck(s, events, u) }))
    .filter((f) => !f.passed);
  for (const { unit, at, owner, die } of failed) {
    if (s.phase === 'gameOver') return;
    if (unit.dead || vecKey(unit.pos) !== at || unit.owner !== owner) continue;
    if (unit.traits.disloyal && die === 1) defect(s, events, unit, board, hacks);
    else flee(s, events, unit, board, hacks);
  }
}

/**
 * A Disloyal `unit` goes over to the enemy where it stands (mutates `s`). It
 * drops its stance and its place in a group activation, sends any flag it
 * carries — now its own side's — back to base, and counts as activated for
 * the round. A King that turns hands its new side
 * the game at once. Otherwise the side it left is a unit short: a Leader's
 * desertion shakes the friends who see it, and the loss can break the warband
 * (see {@link routCheck}) — or leave it with no one, which the caller's
 * game-over check picks up.
 */
function defect(s: GameState, events: GameEvent[], unit: Unit, board: Board, hacks: FreeHacks): void {
  const from = unit.owner;
  const to: Owner = from === 0 ? 1 : 0;
  unit.owner = to;
  unit.guarding = false;
  unit.activatedThisRound = true;
  if (s.group) s.group.pending = s.group.pending.filter((p) => p.unitId !== unit.id);
  events.push({ type: 'UnitDefected', unitId: unit.id, to });
  returnCarriedFlag(s, events, unit);

  if (isKing(s, unit.id)) {
    finishGame(s, events, to, 'king');
    return;
  }
  // A golden Pig that turns is lost to its escort.
  if (isPig(s, unit.id)) {
    finishGame(s, events, to, 'pig');
    return;
  }
  if (unit.traits.leader) leaderCheck(s, events, unit, from, board, hacks);
  if (s.phase !== 'gameOver') routCheck(s, events, from, board, hacks);
}

/**
 * Send `unit` running (mutates `s`). On its own edge already, it leaves the
 * field. Otherwise it picks itself up if it was down, takes the free hacks of
 * the foes it is turning from, and — if they neither cut it down nor floor it —
 * runs as near its edge as it can get (see {@link fleeRun}). Hemmed in with
 * nowhere nearer to go, it holds where it is.
 */
function flee(s: GameState, events: GameEvent[], unit: Unit, board: Board, hacks: FreeHacks): void {
  unit.guarding = false;
  if (unit.pos.x === homeColumn(board, unit.owner)) {
    unit.dead = true;
    unit.knockedDown = false;
    events.push({ type: 'UnitRouted', unitId: unit.id });
    return;
  }
  const run = fleeRun(s, unit, board);
  if (!run) return;
  if (unit.knockedDown) {
    unit.knockedDown = false;
    events.push({ type: 'UnitStoodUp', unitId: unit.id });
    regrabOnStandUp(s, events, unit);
  }
  if (!hacks(unit)) return;

  const from = { ...unit.pos };
  unit.pos = { x: run.to.x, y: run.to.y };
  carryFlags(s, unit);
  events.push({ type: 'UnitFled', unitId: unit.id, from, to: { x: run.to.x, y: run.to.y }, path: run.path });
}

/**
 * Where a fleeing `unit` runs: to the free hex nearest its home edge that it can
 * reach, however far, by the shortest way there. A runner gives foes a wide
 * berth — it never passes through an enemy or into a hex touching one — while a
 * flyer simply lifts over everything. Null when no reachable hex is any nearer
 * the edge than where it stands.
 */
export function fleeRun(s: GameState, unit: Unit, board: Board): { to: Vec; path: Vec[] } | null {
  const rules = fleeRules(s, unit, board);
  const steps = board.width * board.height;
  const home = homeColumn(board, unit.owner);
  const gap = (v: Vec) => Math.abs(v.x - home);

  let best: { to: Vec; path: Vec[] } | null = null;
  for (const key of board.reachableWithin(unit.pos, steps, rules)) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const to = { x, y };
    if (board.isBlocked(to) || isOccupied(s, to, unit.id)) continue;
    if (gap(to) >= gap(unit.pos) || (best && gap(to) > gap(best.to))) continue;
    const path = board.pathWithin(unit.pos, to, steps, rules);
    if (!path) continue;
    if (!best || gap(to) < gap(best.to) || path.length < best.path.length) best = { to, path };
  }
  return best;
}

/** How a runner may go: nowhere an enemy stands or can reach out and touch. A flyer goes over it all. */
function fleeRules(s: GameState, unit: Unit, board: Board): WalkRules {
  if (airborne(s, unit)) return { phaseThrough: true };
  const shunned = new Set<string>();
  for (const e of s.units) {
    if (e.dead || e.owner === unit.owner) continue;
    shunned.add(vecKey(e.pos));
    for (const n of board.neighbors(e.pos)) shunned.add(vecKey(n));
  }
  return { passable: (v) => !shunned.has(vecKey(v)) };
}
