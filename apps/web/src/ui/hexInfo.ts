import {
  airborne,
  combatOdds,
  combatScoring,
  unitById,
  unitMove,
  vecKey,
  type CombatOdds,
  type GameState,
  type Vec,
} from '@fansong/engine';
import type { PlanPreview } from '../game/planView.js';
import { INSPIRED_HELP, traitLine, traitTags } from './hudView.js';
import { modifierHelp, previewScores, signed, type RollModifier } from './rollView.js';

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

/**
 * One side's score before the dice in a fight a click would start: who, each
 * modifier (Combat first) as the roll card will show it, and what the die adds to.
 */
export interface HexScore {
  name: string;
  mods: RollModifier[];
  total: number;
}

/** A tooltip line: plain text, a unit's stats, one of its abilities spelled out, or a side's score in a fight. */
export type HexLine = string | HexStats | HexTrait | HexScore;

/**
 * The fight a click on the hex would start, in parts, for a tooltip that leads
 * with the odds (see `FightTip.tsx`) rather than listing it line by line.
 */
export interface HexFight {
  /** "Attack", "Charge", "Shoot" or "Move and shoot". */
  verb: string;
  target: string;
  /** "1 action (2 actions left)". */
  cost: string;
  /** A shot draws no return fire, so it has no chance to lose. */
  ranged: boolean;
  odds: CombatOdds;
  attacker: HexScore;
  defender: HexScore;
  /** A guarding target's riposte, rolled before the blow. */
  riposte?: { guard: HexScore; attacker: HexScore };
  /** What each modifier in play is, once each. */
  help: HexTrait[];
  /** The route there breaks away from an enemy. */
  breaksAway: boolean;
  /** The lines about the target itself: its marks, stats and abilities. */
  about: HexLine[];
  /** The pointer has rested here (see {@link describeHex}). */
  detailed: boolean;
}

export interface HexInfo {
  title: string;
  lines: HexLine[];
  /** Set when a click here would start a fight. */
  fight?: HexFight;
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
      // Held long enough, inspiration is spelled out below with the abilities.
      unit.inspired && !detailed ? 'Inspired' : null,
    ].filter(Boolean);
    if (marks.length > 0) lines.push(marks.join(' · '));
    lines.push({ quality: unit.quality, combat: unit.combat, move: unitMove(unit) });
    // The abilities decide how the unit must be fought, so the tooltip names them.
    if (detailed) {
      const grounded = unit.traits.flying && !airborne(state, unit);
      // A sure 6 reads as safety, so say plainly that it can still turn over.
      if (unit.inspired) lines.push({ trait: 'Inspired', help: INSPIRED_HELP });
      lines.push(...traitTags(unit, grounded).map((t) => ({ trait: t.label, help: t.help })));
    } else {
      const traits = traitLine(unit);
      if (traits) lines.push(traits);
    }
  }
  const fight = plan ? fightPreview(state, plan, [...lines], detailed) : null;
  if (plan) lines.push(...planLines(state, plan, detailed));
  if (unit) return { title: unit.name, lines, ...(fight ? { fight } : {}) };
  if (where === 'editor') return { title: `Hex (${cell.x}, ${cell.y})`, lines };
  // In a match a bare hex is titled by the first thing worth saying about it.
  const [first, ...rest] = lines;
  return typeof first === 'string' ? { title: first, lines: rest } : null;
}

const ACTIONS = (n: number): string => `${n} action${n === 1 ? '' : 's'}`;

/** "2 actions (1 action left)": what a plan spends, and what that leaves. */
function planCost(state: GameState, plan: PlanPreview): string {
  const left = state.actionsRemaining - plan.cost;
  return `${ACTIONS(plan.cost)}${left > 0 ? ` (${ACTIONS(left)} left)` : ''}`;
}

/** What a fighting plan is called: a blow or shot that is walked to says so. */
function planVerb(plan: PlanPreview): string {
  const walks = plan.waypoints.length > 0;
  if (plan.kind === 'attack') return walks ? 'Charge' : 'Attack';
  return walks ? 'Move and shoot' : 'Shoot';
}

/**
 * What this click costs, and what it risks on the way. A fight also shows both
 * sides' modifiers; `detailed` spells out what each one is.
 */
function planLines(state: GameState, plan: PlanPreview, detailed: boolean): HexLine[] {
  const name = plan.targetId ? (unitById(state, plan.targetId)?.name ?? 'the enemy') : '';
  const lines: HexLine[] = [];
  if (plan.kind === 'move') lines.push(`Move here — ${planCost(state, plan)}`);
  else lines.push(`${planVerb(plan)} ${name} — ${planCost(state, plan)}`);
  const odds = oddsLine(state, plan);
  if (odds) lines.push(odds);
  lines.push(...fightScores(state, plan, detailed));
  if (plan.provokes > 0) lines.push('Breaking away — risks a parting blow');
  return lines;
}

/**
 * Both sides' scores before the dice for the fight a plan starts, modifiers and
 * all (a guarding target's riposte first), then (when `detailed`) what each
 * modifier is: the same chips the roll cards will show once the blow lands, so
 * nothing on them comes as a surprise. A pressed plan is scored as the plain
 * one: the pressed blow's own −1 is the menu's to explain.
 */
export function fightScores(
  state: GameState,
  plan: Pick<PlanPreview, 'kind' | 'targetId' | 'path'>,
  detailed = false,
): HexLine[] {
  const sides = fightSides(state, plan);
  if (!sides) return [];
  const { attacker, defender, riposte, help } = sides;
  const blow: HexLine[] = [attacker, defender];
  const lines: HexLine[] = riposte
    ? [`On guard: ${defender.name} ripostes first`, riposte.guard, riposte.attacker, 'Then the blow', ...blow]
    : blow;
  if (detailed) lines.push(...help);
  return lines;
}

/** Both sides' scores for the fight a plan starts, a guard's riposte, and what each modifier in play is. */
function fightSides(
  state: GameState,
  plan: Pick<PlanPreview, 'kind' | 'targetId' | 'path'>,
): Pick<HexFight, 'attacker' | 'defender' | 'riposte' | 'help'> | null {
  if (plan.kind === 'move' || !plan.targetId || !state.activeUnitId) return null;
  const attacker = unitById(state, state.activeUnitId);
  const target = unitById(state, plan.targetId);
  if (!attacker || !target) return null;
  const from = plan.path.at(-1);
  const { attack, defense, riposte } = previewScores(
    combatScoring(state, attacker.id, target.id, { ranged: plan.kind === 'shoot', ...(from ? { from } : {}) }),
  );
  const help: HexTrait[] = [];
  const seen = new Set<string>();
  const all = [attack, defense, ...(riposte ? [riposte.guard, riposte.attacker] : [])];
  for (const m of all.flatMap((score) => score.mods)) {
    const label = `${signed(m.value)} ${m.label}`;
    const text = modifierHelp(m.label);
    if (m.label === 'Combat' || !text || seen.has(label)) continue;
    seen.add(label);
    help.push({ trait: label, help: text });
  }
  return {
    attacker: { name: attacker.name, ...attack },
    defender: { name: target.name, ...defense },
    ...(riposte
      ? {
          riposte: {
            guard: { name: target.name, ...riposte.guard },
            attacker: { name: attacker.name, ...riposte.attacker },
          },
        }
      : {}),
    help,
  };
}

/** The fight a plan starts, in parts (see {@link HexFight}); null for a walk, or with no unit activating. */
function fightPreview(state: GameState, plan: PlanPreview, about: HexLine[], detailed: boolean): HexFight | null {
  const sides = fightSides(state, plan);
  if (!sides || !plan.targetId || !state.activeUnitId) return null;
  const ranged = plan.kind === 'shoot';
  const from = plan.path.at(-1);
  return {
    verb: planVerb(plan),
    target: sides.defender.name,
    cost: planCost(state, plan),
    ranged,
    odds: combatOdds(state, state.activeUnitId, plan.targetId, { ranged, ...(from ? { from } : {}) }),
    ...sides,
    breaksAway: plan.provokes > 0,
    about,
    detailed,
  };
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
