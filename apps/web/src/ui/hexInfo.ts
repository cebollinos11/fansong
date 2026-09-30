import { airborne, combatOdds, unitById, unitMove, vecKey, type GameState, type Vec } from '@fansong/engine';
import type { PlanPreview } from '../game/planView.js';
import { traitLine, traitTags } from './hudView.js';

// Pure hex-tooltip text (no DOM), so it can be unit-tested.

const FEATURE_TEXT = {
  rock: 'Rocks — impassable, blocks sight',
  building: 'Building — impassable, blocks sight',
  forest: 'Forest — blocks sight through it',
  lava: 'Lava — only flyers may cross or land; anyone else pushed in dies, Tough or not; a flyer knocked down here falls in',
} as const;

/** A unit's core numbers, drawn as stat icons rather than text. */
export interface HexStats {
  quality: number;
  combat: number;
  move: number;
}

/** One of a unit's abilities spelled out, for a tooltip held long enough to read it. */
export interface HexTrait {
  trait: string;
  help: string;
}

/** A tooltip line: plain text, a unit's stats, or one of its abilities spelled out. */
export type HexLine = string | HexStats | HexTrait;

export interface HexInfo {
  title: string;
  lines: HexLine[];
}

/**
 * Describe a board hex for the hover tooltip; null when the cell is off the
 * board. `plan` is what clicking here would commit, so the tooltip can price the
 * click before it is made. `detailed` (the pointer has rested on the hex) spells
 * out what each of the unit's abilities does instead of just naming them.
 * `where` is 'match' for a board in play, which leaves out the hex's
 * coordinates and elevation (the editor wants them); there, a hex with nothing
 * else to say gets no tooltip at all.
 */
export function describeHex(
  state: GameState,
  cell: Vec,
  plan: PlanPreview | null = null,
  detailed = false,
  where: 'match' | 'editor' = 'editor',
): HexInfo | null {
  const { board } = state;
  if (cell.x < 0 || cell.y < 0 || cell.x >= board.width || cell.y >= board.height) return null;
  const key = vecKey(cell);
  const terrain = board.terrain?.[key];
  const lines: HexLine[] = [];
  const unit = state.units.find((u) => !u.dead && vecKey(u.pos) === key);
  // A unit's tooltip is about the unit: no coordinates, height or owner.
  if (!unit && where === 'editor') {
    const elevation = terrain?.elevation ?? 0;
    lines.push(elevation > 0 ? `Elevation ${elevation} — high ground` : 'Elevation 0');
  }
  if (board.blocked.includes(key)) lines.push('Blocked — impassable, blocks sight');
  if (terrain?.feature) lines.push(FEATURE_TEXT[terrain.feature]);
  if (unit) {
    const marks = [
      unit.knockedDown ? 'Knocked down' : null,
      unit.guarding ? 'On guard' : null,
      unit.inspired ? 'Inspired' : null,
    ].filter(Boolean);
    if (marks.length > 0) lines.push(marks.join(' · '));
    lines.push({ quality: unit.quality, combat: unit.combat, move: unitMove(unit) });
    // The abilities decide how the unit must be fought, so the tooltip names them.
    if (detailed) {
      const grounded = unit.traits.flying && !airborne(state, unit);
      lines.push(...traitTags(unit, grounded).map((t) => ({ trait: t.label, help: t.help })));
    } else {
      const traits = traitLine(unit);
      if (traits) lines.push(traits);
    }
  }
  if (plan) lines.push(...planLines(state, plan));
  if (unit) return { title: unit.name, lines };
  if (where === 'editor') return { title: `Hex (${cell.x}, ${cell.y})`, lines };
  // In a match a bare hex is titled by the first thing worth saying about it.
  const [first, ...rest] = lines;
  return typeof first === 'string' ? { title: first, lines: rest } : null;
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
  const odds = oddsLine(state, plan);
  if (odds) lines.push(odds);
  if (plan.provokes > 0) lines.push('Breaking away — risks a parting blow');
  return lines;
}

const pct = (p: number): string => `${Math.round(p * 100)}%`;

/**
 * The chance a plan wins its fight, for an attack or shot by the activating
 * unit; a pressed plan (power blow / aimed shot) is quoted as pressed.
 */
export function oddsLine(
  state: GameState,
  plan: Pick<PlanPreview, 'kind' | 'targetId' | 'path'> & { pressed?: true },
): string | null {
  if (plan.kind === 'move' || !plan.targetId || !state.activeUnitId) return null;
  const ranged = plan.kind === 'shoot';
  const from = plan.path.at(-1);
  const odds = combatOdds(state, state.activeUnitId, plan.targetId, {
    ranged,
    ...(plan.pressed ? { pressed: true } : {}),
    ...(from ? { from } : {}),
  });
  const parts = [`Win ${pct(odds.win)}`];
  if (odds.kill > 0) parts.push(`kill ${pct(odds.kill)}`);
  // A shot draws no return fire, so a miss is only ever a miss.
  parts.push(ranged ? 'no risk' : `lose ${pct(odds.lose)}`);
  return parts.join(' · ');
}
