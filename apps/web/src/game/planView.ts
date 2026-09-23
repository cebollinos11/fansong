import { unitById, vecKey, type ActionPlan, type GameState, type PlanKind, type Vec } from '@fansong/engine';

/**
 * Projection of the engine's {@link ActionPlan} list into the shapes the board
 * needs: what to tint, what to ring, and what a click or a hover resolves to.
 * Purely derived — like `deriveInteraction`, it decides nothing the engine did
 * not already offer.
 */

/** One highlighted hex, tinted by what reaching it costs. */
export interface ReachTile {
  cell: Vec;
  cost: number;
  /** Walking here leaves enemy contact somewhere along the way. */
  provokes: number;
}

/** What hovering a hex should trace on the board. */
export interface PlanPreview {
  path: Vec[];
  /** Hexes where an action is actually spent — what makes the cost legible on the board. */
  waypoints: Vec[];
  cost: number;
  kind: PlanKind;
  targetId?: string;
  provokes: number;
}

export interface PlanIndex {
  /** Plan a click on this hex commits: a move destination, or an enemy's own hex. */
  byCell: Map<string, ActionPlan>;
  /** Plan a click on this enemy commits. */
  byTarget: Map<string, ActionPlan>;
  /** The pressed twin of {@link byTarget}, when the actions stretch to it. */
  pressedByTarget: Map<string, ActionPlan>;
  reach: ReachTile[];
  /** Enemies strikeable from where the unit stands. */
  strikeNowIds: string[];
  /** Enemies strikeable only after walking in. */
  approachIds: string[];
  /** Highest action cost among the reachable hexes (0 when there are none). */
  maxCost: number;
}

export const emptyPlanIndex = (): PlanIndex => ({
  byCell: new Map(),
  byTarget: new Map(),
  pressedByTarget: new Map(),
  reach: [],
  strikeNowIds: [],
  approachIds: [],
  maxCost: 0,
});

export function buildPlanIndex(plans: ActionPlan[], state: GameState): PlanIndex {
  const index = emptyPlanIndex();

  for (const plan of plans) {
    if (plan.kind !== 'move') continue;
    index.reach.push({ cell: plan.to, cost: plan.cost, provokes: plan.provokes });
    const key = vecKey(plan.to);
    // A hex can be reached several ways; the cheapest is what a click commits.
    if (cheaper(plan, index.byCell.get(key))) index.byCell.set(key, plan);
    if (plan.cost > index.maxCost) index.maxCost = plan.cost;
  }

  // One offer per enemy. A target can be both shootable from here and reachable
  // on foot, so pick the best plain plan first and take the pressed twin of that
  // same kind — otherwise the menu would ask "charge, or aimed shot?".
  for (const plan of plans) {
    if (plan.kind === 'move' || plan.pressed || !plan.targetId) continue;
    if (cheaper(plan, index.byTarget.get(plan.targetId))) index.byTarget.set(plan.targetId, plan);
  }
  for (const plan of plans) {
    if (plan.kind === 'move' || !plan.pressed || !plan.targetId) continue;
    if (index.byTarget.get(plan.targetId)?.kind !== plan.kind) continue;
    index.pressedByTarget.set(plan.targetId, plan);
  }

  for (const [targetId, plan] of index.byTarget) {
    (plan.waypoints.length === 0 ? index.strikeNowIds : index.approachIds).push(targetId);
    // Hovering or clicking the enemy itself is the natural way to aim at it.
    const pos = unitById(state, targetId)?.pos;
    if (pos) index.byCell.set(vecKey(pos), plan);
  }

  return index;
}

/** The plan a click on `cell` would commit, traced for the hover preview. */
export function previewFor(index: PlanIndex, cell: Vec): PlanPreview | null {
  const plan = index.byCell.get(vecKey(cell));
  if (!plan) return null;
  return {
    path: plan.path,
    waypoints: plan.waypoints,
    cost: plan.cost,
    kind: plan.kind,
    ...(plan.targetId ? { targetId: plan.targetId } : {}),
    provokes: plan.provokes,
  };
}

/**
 * Cheapest wins; at the same price, the one that walks less. Ties beyond that
 * keep whichever came first, and `getActionPlans` emits in a fixed order.
 */
function cheaper(plan: ActionPlan, held: ActionPlan | undefined): boolean {
  if (!held) return true;
  if (plan.cost !== held.cost) return plan.cost < held.cost;
  return plan.waypoints.length < held.waypoints.length;
}
