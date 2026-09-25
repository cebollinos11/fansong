import { vecKey, type Board, type Vec, type WalkRules } from './board.js';
import { carryFlags } from './mode.js';
import { rollD6 } from './rng.js';
import { aliveUnits, isOccupied, livingCount } from './query.js';
import type { GameEvent, GameState, Owner, Unit } from './types.js';

/**
 * Morale. Beyond the activation turnover, casualties shake the survivors:
 *
 *  - **Fear** — when a unit suffers a *gruesome* kill in combat (the winner
 *    tripled its score), every standing friend within {@link MORALE_RADIUS}
 *    must pass a nerve check (a d6 ≥ its Quality) or flee. An ordinary kill
 *    shakes no one.
 *  - **Rout** — the first time a warband is ground down to a third of its
 *    starting strength it *breaks*: every survivor takes a nerve check, and each
 *    that fails flees. It happens once per side.
 *
 * A unit that **flees** runs for its own edge of the map (see {@link homeColumn}),
 * taking free hacks from every foe it turns its back on. One already standing on
 * that edge leaves the field for good. A failed check never knocks a unit down.
 *
 * All of this is deterministic (it draws from the state's RNG) and pushes new
 * events, so it replays exactly and is fully unit-testable.
 */

/**
 * Friends within this board-distance radius of a gruesome casualty must test
 * nerve: a "long" reach, half again the baseline move of 3.
 */
export const MORALE_RADIUS = 4;

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

/** Roll one nerve check for a unit, record it, and report whether it passed. */
function nerveCheck(s: GameState, events: GameEvent[], unit: Unit): boolean {
  const roll = rollD6(s.rngState);
  s.rngState = roll.state;
  const passed = roll.die >= unit.quality;
  events.push({ type: 'NerveCheck', unitId: unit.id, quality: unit.quality, die: roll.die, passed });
  return passed;
}

/**
 * Resolve the morale fallout of a combat casualty: after a `gruesome` kill,
 * nearby friends test nerve (fear); then, for any kill, the casualty's warband
 * tests for a rout if it has just crossed the break threshold. Mutates `s` and
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
  routCheck(s, events, victim.owner, board, hacks);
}

function fearCheck(s: GameState, events: GameEvent[], victim: Unit, board: Board, hacks: FreeHacks): void {
  const tested = aliveUnits(s, victim.owner).filter(
    (u) => u.id !== victim.id && !u.knockedDown && board.distance(u.pos, victim.pos) <= MORALE_RADIUS,
  );
  fleeFailures(s, events, tested, board, hacks);
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
 * unit order. A runner already caught up in an earlier one's cascade — cut
 * down, or sent running by it — is not sent running twice.
 */
function fleeFailures(s: GameState, events: GameEvent[], tested: Unit[], board: Board, hacks: FreeHacks): void {
  const failed = tested.filter((u) => !nerveCheck(s, events, u)).map((u) => ({ unit: u, at: vecKey(u.pos) }));
  for (const { unit, at } of failed) {
    if (unit.dead || vecKey(unit.pos) !== at) continue;
    flee(s, events, unit, board, hacks);
  }
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
  if (unit.traits.flying) return { phaseThrough: true };
  const shunned = new Set<string>();
  for (const e of s.units) {
    if (e.dead || e.owner === unit.owner) continue;
    shunned.add(vecKey(e.pos));
    for (const n of board.neighbors(e.pos)) shunned.add(vecKey(n));
  }
  return { passable: (v) => !shunned.has(vecKey(v)) };
}
