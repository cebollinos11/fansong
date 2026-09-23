import { unitById, vecKey, type GameState, type Vec } from '@fansong/engine';
import type { PlanPreview } from '../game/planView.js';
import { traitLine } from './hudView.js';

// Pure hex-tooltip text (no DOM), so it can be unit-tested.

const FEATURE_TEXT = {
  rock: 'Rocks — impassable, blocks sight',
  building: 'Building — impassable, blocks sight',
  forest: 'Forest — blocks sight through it',
} as const;

export interface HexInfo {
  title: string;
  lines: string[];
}

/**
 * Describe a board hex for the hover tooltip; null when the cell is off the
 * board. `plan` is what clicking here would commit, so the tooltip can price the
 * click before it is made.
 */
export function describeHex(state: GameState, cell: Vec, plan: PlanPreview | null = null): HexInfo | null {
  const { board } = state;
  if (cell.x < 0 || cell.y < 0 || cell.x >= board.width || cell.y >= board.height) return null;
  const key = vecKey(cell);
  const terrain = board.terrain?.[key];
  const lines: string[] = [];
  const elevation = terrain?.elevation ?? 0;
  lines.push(elevation > 0 ? `Elevation ${elevation} — high ground` : 'Elevation 0');
  if (board.blocked.includes(key)) lines.push('Blocked — impassable, blocks sight');
  if (terrain?.feature) lines.push(FEATURE_TEXT[terrain.feature]);
  const unit = state.units.find((u) => !u.dead && vecKey(u.pos) === key);
  if (unit) {
    const marks = [unit.knockedDown ? 'knocked down' : null, unit.guarding ? 'on guard' : null].filter(Boolean);
    lines.push([`${unit.name} (P${unit.owner})`, ...marks].join(' · '));
    lines.push(`Q${unit.quality} · C${unit.combat} · M${unit.move}`);
    // The abilities decide how the unit must be fought, so the tooltip names them.
    const traits = traitLine(unit);
    if (traits) lines.push(traits);
  }
  if (plan) lines.push(...planLines(state, plan));
  return { title: `Hex (${cell.x}, ${cell.y})`, lines };
}

const ACTIONS = (n: number): string => `${n} action${n === 1 ? '' : 's'}`;

/** What this click costs, and what it risks on the way. */
function planLines(state: GameState, plan: PlanPreview): string[] {
  const left = state.actionsRemaining - plan.cost;
  const spare = left > 0 ? ` (${ACTIONS(left)} left)` : '';
  const name = plan.targetId ? (unitById(state, plan.targetId)?.name ?? 'the enemy') : '';
  const lines: string[] = [];
  if (plan.kind === 'move') lines.push(`Move here — ${ACTIONS(plan.cost)}${spare}`);
  else if (plan.kind === 'attack') {
    lines.push(
      plan.waypoints.length > 0
        ? `Charge ${name} — ${ACTIONS(plan.cost)}${spare}`
        : `Attack ${name} — ${ACTIONS(plan.cost)}${spare}`,
    );
  } else {
    lines.push(
      plan.waypoints.length > 0
        ? `Move and shoot ${name} — ${ACTIONS(plan.cost)}${spare}`
        : `Shoot ${name} — ${ACTIONS(plan.cost)}${spare}`,
    );
  }
  if (plan.provokes > 0) lines.push('Breaking away — risks a parting blow');
  return lines;
}
