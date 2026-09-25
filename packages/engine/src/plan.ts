/**
 * Multi-action planning: everything the activating unit could do with *all* the
 * actions it holds, not just the next one.
 *
 * `getLegalCommands` answers "what may this unit do right now?", which is all a
 * reducer needs but leaves the player to discover a two-action move or a
 * move-then-strike by trial. This module answers "what could it do this
 * activation?" by chaining those same commands over hypothetical intermediate
 * positions. It invents no rules: every plan is a list of ordinary commands, each
 * of which `applyCommand` re-validates when it is actually sent, and the
 * one-action plans are exactly the Move/Attack/Shoot set `getLegalCommands` gives.
 */

import { makeHexGrid, vecKey, type Board, type Vec } from './board.js';
import { COVER_PENALTY, highGroundBonus, PRESSED_COST, rangePenalty } from './combat.js';
import {
  enemiesOf,
  inMelee,
  isOccupied,
  occupiedKeys,
  outnumberedPenalty,
  unitById,
  unitMove,
  walkRules,
} from './query.js';
import type { Command, GameState, Unit } from './types.js';

/**
 * Upper bound on the actions a plan will chain. Three activation dice is the
 * ceiling today (see `DICE_CHOICES`); the cap keeps the search bounded should a
 * trait ever hand out more.
 */
export const MAX_PLANNED_ACTIONS = 3;

/** A hex the active unit could stand on this activation, and what getting there costs. */
export interface ReachNode {
  cell: Vec;
  /** Move actions spent. Minimal over all routes. */
  cost: number;
  /** Move destinations in order; the last is `cell`. Length === cost. */
  waypoints: Vec[];
  /** Hexes walked, start hex first — what the animation will show. Empty when the unit stays put. */
  path: Vec[];
  /** Hops departing a hex in contact with a *standing* enemy: each risks a free hack. */
  provokes: number;
  /**
   * Whether the unit may finish a Move here. A friend's hex is walkable *through*
   * (only enemy hexes bar a walk) but can never be stood on.
   */
  standable: boolean;
}

export type PlanKind = 'move' | 'attack' | 'shoot';

/**
 * One complete thing the unit could do, as the sequence of ordinary commands that
 * does it. `steps[0]` is always legal in the current state.
 */
export interface ActionPlan {
  kind: PlanKind;
  /** Total actions spent; never more than the unit has left. */
  cost: number;
  steps: Command[];
  waypoints: Vec[];
  path: Vec[];
  /** Where the unit ends up (its current hex when it strikes without moving). */
  to: Vec;
  targetId?: string;
  /** The pressed variant: a power blow / aimed shot, costing {@link PRESSED_COST}. */
  pressed?: true;
  provokes: number;
}

/**
 * Every hex the unit can stand on with up to `maxAp` Move actions, at its minimum
 * action cost, keyed by `vecKey`.
 *
 * Not `reachableWithin(move * maxAp)`: a walk *stops* on entering enemy contact
 * (see {@link walkRules}) and only the start hex is exempt, so a second Move can
 * carry on out of a hex the first was forced to halt in. Reach therefore has to be
 * expanded one action at a time, from hexes the unit could actually stand on.
 */
export function multiMoveReach(state: GameState, unit: Unit, board: Board, maxAp: number): Map<string, ReachNode> {
  const rules = walkRules(state, unit, board);
  // Hexes from which leaving contact draws a free hack. Only *standing* enemies
  // swing (see `resolveFreeHacks`), so a knocked-down foe holds nobody in place —
  // and a flyer lifts away untouched, so nothing provokes one.
  const provoking = new Set<string>();
  if (!unit.traits.flying) {
    for (const e of state.units) {
      if (e.dead || e.knockedDown || e.owner === unit.owner) continue;
      for (const n of board.neighbors(e.pos)) provoking.add(vecKey(n));
    }
  }

  const startKey = vecKey(unit.pos);
  const start: ReachNode = {
    cell: { ...unit.pos },
    cost: 0,
    waypoints: [],
    path: [],
    provokes: 0,
    standable: true,
  };
  const best = new Map<string, ReachNode>([[startKey, start]]);
  let frontier: ReachNode[] = [start];

  const move = unitMove(unit);
  for (let ap = 1; ap <= maxAp && frontier.length > 0; ap++) {
    const next: ReachNode[] = [];
    for (const node of frontier) {
      const reach = board.reachableWithin(node.cell, move, rules);
      // Leaving *this* hex is what provokes, so the risk is counted once per hop.
      const hop = provoking.has(vecKey(node.cell)) ? 1 : 0;
      // `cellsWithin` order, exactly as `getLegalCommands` enumerates moves, so
      // the one-action layer comes out in the same order it does.
      for (const to of board.cellsWithin(node.cell, move)) {
        const key = vecKey(to);
        if (!reach.has(key)) continue;
        // Every Move costs 1, so this BFS over *actions* sees each hex first at
        // its minimum cost. A hex seen again *this* hop is a rival route at the
        // same price, though, and a route that keeps clear of enemy blades is
        // worth having — otherwise whichever route enumeration happened to reach
        // first would decide, and the free-hack warning would be arbitrary.
        const seen = best.get(key);
        if (seen && (seen.cost < ap || seen.provokes <= node.provokes + hop)) continue;
        const seg = board.pathWithin(node.cell, to, move, rules);
        if (!seg) continue;
        const waypoints = [...node.waypoints, { ...to }];
        // The first leg contributes its start hex; later legs drop the joint.
        const path = node.path.length === 0 ? seg : [...node.path, ...seg.slice(1)];
        const provokes = node.provokes + hop;
        if (seen) {
          // Same price, safer route: rewrite it in place, so anything already
          // queued to expand from this hex carries the better route with it.
          seen.waypoints = waypoints;
          seen.path = path;
          seen.provokes = provokes;
          continue;
        }
        const child: ReachNode = {
          cell: { ...to },
          cost: ap,
          waypoints,
          path,
          provokes,
          // A flyer's reach includes hexes it merely phased over; it can only
          // finish on a legal, empty one. (A walker never reaches a blocked hex.)
          standable: !isOccupied(state, to, unit.id) && !board.isBlocked(to),
        };
        best.set(key, child);
        // Only an empty hex can be a waypoint, so only those expand further.
        if (child.standable) next.push(child);
      }
    }
    frontier = next;
  }

  best.delete(startKey);
  return best;
}

/**
 * Everything the activating unit could do with the actions it has left.
 *
 * The one-action plans are exactly the Move/Attack/Shoot set `getLegalCommands`
 * gives; the rest are chains of those. `Guard` and `EndActivation` are left out:
 * both end the activation and the HUD already offers them.
 *
 * Deterministic throughout — attacks, then shots, then moves, in unit and
 * `cellsWithin` order, with every tie broken explicitly.
 */
export function getActionPlans(state: GameState): ActionPlan[] {
  if (state.phase !== 'acting' || !state.activeUnitId) return [];
  const unit = unitById(state, state.activeUnitId);
  if (!unit || unit.dead || state.actionsRemaining <= 0) return [];

  const board = makeHexGrid(state.board);
  const ap = Math.min(state.actionsRemaining, MAX_PLANNED_ACTIONS);
  const reach = multiMoveReach(state, unit, board, ap);
  const enemies = enemiesOf(state, unit.owner);
  const plans: ActionPlan[] = [];

  // Striking from where it already stands is just a zero-cost "approach", so it
  // goes through the same selection as every other hex.
  const here: ReachNode = { cell: { ...unit.pos }, cost: 0, waypoints: [], path: [], provokes: 0, standable: true };

  // Melee: from contact now, or after walking into contact.
  for (const enemy of enemies) {
    const spots: ReachNode[] = [];
    if (board.distance(unit.pos, enemy.pos) === 1) spots.push(here);
    for (const n of board.neighbors(enemy.pos)) {
      const node = reach.get(vecKey(n));
      if (node?.standable) spots.push(node);
    }
    if (spots.length === 0) continue;
    const advantage = (n: ReachNode): number =>
      highGroundBonus(board, { pos: n.cell, knockedDown: unit.knockedDown }, enemy) -
      outnumberedPenalty(state, { ...unit, pos: n.cell }, board);
    // Plain and pressed choose their approach hex independently — see `pickSpot`.
    for (const pressed of [false, true]) {
      const spot = pickSpot(spots, ap, pressed, advantage);
      if (spot) plans.push(strikePlan('attack', unit, enemy.id, spot, pressed));
    }
  }

  // Shots: from where it stands, or from a firing position it can walk to.
  if (unit.traits.ranged >= 1) {
    // The shooter vacates its start hex, so that hex never blocks its own lane.
    // Line of sight ignores endpoints, so one set serves every firing position.
    const occ = occupiedKeys(state);
    occ.delete(vecKey(unit.pos));
    const seeThrough = (v: Vec): boolean => occ.has(vecKey(v));

    for (const enemy of enemies) {
      const spots: ReachNode[] = [];
      if (canShootFrom(state, unit, board, here.cell, enemy, seeThrough)) spots.push(here);
      // At one action there is nothing left to shoot with after moving.
      if (ap >= 2) {
        for (const node of reach.values()) {
          if (!node.standable || node.cost + 1 > ap) continue;
          if (canShootFrom(state, unit, board, node.cell, enemy, seeThrough)) spots.push(node);
        }
      }
      if (spots.length === 0) continue;
      const advantage = (n: ReachNode): number =>
        highGroundBonus(board, { pos: n.cell, knockedDown: unit.knockedDown }, enemy) -
        rangePenalty(unit.traits.ranged, board.distance(n.cell, enemy.pos)) -
        (board.inCover(n.cell, enemy.pos, seeThrough) ? COVER_PENALTY : 0);
      for (const pressed of [false, true]) {
        const spot = pickSpot(spots, ap, pressed, advantage);
        if (spot) plans.push(strikePlan('shoot', unit, enemy.id, spot, pressed));
      }
    }
  }

  // Moves, in discovery order (hop by hop, `cellsWithin` within each).
  for (const node of reach.values()) {
    if (!node.standable) continue;
    plans.push({
      kind: 'move',
      cost: node.cost,
      steps: moveSteps(unit, node),
      waypoints: node.waypoints.map(copy),
      path: node.path.map(copy),
      to: { ...node.cell },
      provokes: node.provokes,
    });
  }

  return plans;
}

/** Can `unit` shoot `enemy` standing on `from`? The melee bar is judged at `from`, not at its current hex. */
function canShootFrom(
  state: GameState,
  unit: Unit,
  board: Board,
  from: Vec,
  enemy: Unit,
  seeThrough: (v: Vec) => boolean,
): boolean {
  if (inMelee(state, { ...unit, pos: from }, board)) return false;
  const d = board.distance(from, enemy.pos);
  if (d < 2 || d > unit.traits.ranged) return false;
  return board.lineOfSight(from, enemy.pos, seeThrough);
}

/**
 * The hex to strike from, out of those the unit can both reach and still afford
 * the blow from.
 *
 * Chosen **per variant** rather than per target: an approach two moves out affords
 * a plain blow at three actions (2 + 1) but not a power blow (2 + 2), while a
 * nearer, less-preferred hex still affords one (1 + 2). Choosing separately keeps
 * that option on the table instead of silently dropping it. Cost is therefore a
 * filter first, and only then the leading tie-break.
 */
function pickSpot(
  spots: ReachNode[],
  ap: number,
  pressed: boolean,
  advantage: (n: ReachNode) => number,
): ReachNode | undefined {
  const blow = pressed ? PRESSED_COST : 1;
  let best: ReachNode | undefined;
  let bestAdv = 0;
  for (const spot of spots) {
    if (spot.cost + blow > ap) continue;
    const adv = advantage(spot);
    if (best === undefined || better(spot, adv, best, bestAdv)) {
      best = spot;
      bestAdv = adv;
    }
  }
  return best;
}

/**
 * Is `a` the better place to fight from? Spend as little as possible walking,
 * prefer a chain a free hack cannot cut short, then take the advantage the combat
 * resolver would actually reward, then the shorter walk — and finally a stable
 * coordinate order, so the same board always yields the same choice.
 */
function better(a: ReachNode, advA: number, b: ReachNode, advB: number): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost;
  if (a.provokes !== b.provokes) return a.provokes < b.provokes;
  if (advA !== advB) return advA > advB;
  if (a.path.length !== b.path.length) return a.path.length < b.path.length;
  if (a.cell.x !== b.cell.x) return a.cell.x < b.cell.x;
  return a.cell.y < b.cell.y;
}

function moveSteps(unit: Unit, node: ReachNode): Command[] {
  return node.waypoints.map((to) => ({ type: 'Move', unitId: unit.id, to: { ...to } }));
}

function strikePlan(
  kind: 'attack' | 'shoot',
  unit: Unit,
  targetId: string,
  spot: ReachNode,
  pressed: boolean,
): ActionPlan {
  const steps = moveSteps(unit, spot);
  steps.push(
    kind === 'attack'
      ? { type: 'Attack', attackerId: unit.id, targetId, ...(pressed ? ({ power: true } as const) : {}) }
      : { type: 'Shoot', attackerId: unit.id, targetId, ...(pressed ? ({ aimed: true } as const) : {}) },
  );
  return {
    kind,
    cost: spot.cost + (pressed ? PRESSED_COST : 1),
    steps,
    waypoints: spot.waypoints.map(copy),
    path: spot.path.map(copy),
    to: { ...spot.cell },
    targetId,
    ...(pressed ? ({ pressed: true } as const) : {}),
    provokes: spot.provokes,
  };
}

function copy(v: Vec): Vec {
  return { x: v.x, y: v.y };
}
