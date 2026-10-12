import { getLegalCommands, reduce, unitById, type Board, type Command, type GameMode, type GameState, type Owner, type Unit } from '@fansong/engine';
import { successOdds } from './value.js';

/**
 * Lookahead over the rest of the turn (AI_PLAN.md, Phase 5), on top of the AI
 * as it stands (the "plain" AI: one command scored at a time). Two kinds:
 *
 * - **beam**: when a side chooses who activates, the few units the plain AI
 *   ranks first are tried in every order, a few activations deep. Each unit's
 *   activation is worth the plan the plain AI would make for it with the
 *   actions its dice may give, by the odds of each; the next unit plans in the
 *   position the first one's plan leaves. No dice are rolled and `reduce` is
 *   never called: every chance node is weighed by the engine's own odds.
 * - **rollout**: the few commands the plain AI ranks first are each played out
 *   by the plain AI on a copy of the state, with the copy's RNG reseeded from a
 *   hash of the position and the candidate, and the position reached is scored.
 *
 * A mode with no entry in {@link SEARCH} plays exactly as the plain AI does.
 */
export interface SearchParams {
  kind: 'beam' | 'rollout';
  /** For the beam, the activations of the side choosing looked ahead; for a rollout, the commands played after the candidate, at most to the end of the turn. */
  depth: number;
  /** The candidates looked at: units for the beam, commands for a rollout. */
  width: number;
  /** Rollouts only: the playouts of each candidate. */
  playouts: number;
}

/** The search each mode plays with. A mode left out plays with none. */
export const SEARCH: Partial<Record<GameMode, SearchParams>> = { annihilation: { kind: 'beam', depth: 2, width: 2, playouts: 0 } };

/** The search `state`'s mode plays with, if any. */
export function searchOf(state: GameState): SearchParams | undefined {
  return SEARCH[state.mode?.mode ?? 'annihilation'];
}

/** A command by its place among the legal ones, and what the plain AI scores it. */
export interface Ranked {
  index: number;
  score: number;
}

/** What the plain AI would do with a unit's activation: see {@link Policy.plan}. */
export interface Plan {
  /** What the plan is worth on the one scale, against not activating at all. */
  score: number;
  /** The position the plan leaves when it is a move. */
  moved?: GameState;
  /** When it is a blow or a shot: whom at, the odds it kills, and the position with the target gone. */
  target?: string;
  kill?: number;
  killed?: GameState;
  /** And the odds it knocks the target down, with the position that leaves. */
  down?: number;
  downed?: GameState;
}

/** The plain AI, as the search calls it. */
export interface Policy {
  /** The best `width` of `commands` in `state`, best first, ties toward the earlier command. */
  rank(state: GameState, board: Board, commands: Command[], width: number): Ranked[];
  /** Whether an activation is one the beam may reorder: a single unit going by what it has to do. */
  open(state: GameState, board: Board, command: Command): boolean;
  /** The best plan of `unit`, of the side choosing, were it to act now with `actions` actions. No dice. */
  plan(state: GameState, board: Board, unit: Unit, actions: number): Plan;
  /** What a position is worth to `side`, on the one scale. */
  leaf(state: GameState, board: Board, side: Owner): number;
}

/** The command to play in `state` with the search `params`: its place among `commands`. */
export function lookahead(state: GameState, board: Board, commands: Command[], params: SearchParams, policy: Policy): number {
  if (commands.length > 1) {
    if (params.kind === 'rollout') return rolloutChoice(state, board, commands, params, policy);
    if (state.phase === 'awaitingActivation') return beamChoice(state, board, commands, params, policy);
  }
  return policy.rank(state, board, commands, 1)[0]!.index;
}

// --- Beam search by odds ------------------------------------------------------

/** One search's working set: the candidate units, the dice each would roll, and the plans made so far. */
interface Beam {
  board: Board;
  policy: Policy;
  ids: string[];
  dice: number[];
  used: boolean[];
  /** Plans by position, then by unit and actions. */
  plans: WeakMap<GameState, Map<string, Plan>>;
  /** Positions a plan leaves, by the position before, the unit and what it did: the same move or kill with one action or two is one position. */
  made: Map<string, GameState>;
  positions: Map<GameState, number>;
}

function beamChoice(state: GameState, board: Board, commands: Command[], params: SearchParams, policy: Policy): number {
  const ranked = policy.rank(state, board, commands, commands.length);
  const first = commands[ranked[0]!.index]!;
  if (!policy.open(state, board, first)) return ranked[0]!.index;
  // The best command of each of the first few units: which unit goes is searched, its dice stay the plain AI's.
  const beam: Beam = { board, policy, ids: [], dice: [], used: [], plans: new WeakMap(), made: new Map(), positions: new Map() };
  const picks: number[] = [];
  for (const r of ranked) {
    const command = commands[r.index]!;
    if (command.type !== 'ChooseActivation' || beam.ids.includes(command.unitId) || !policy.open(state, board, command)) continue;
    beam.ids.push(command.unitId);
    beam.dice.push(command.diceCount);
    beam.used.push(false);
    picks.push(r.index);
    if (picks.length >= params.width) break;
  }
  if (picks.length < 2) return ranked[0]!.index;
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < picks.length; i++) {
    const value = goValue(beam, state, i, params.depth);
    if (value > bestValue) {
      best = i;
      bestValue = value;
    }
  }
  return picks[best]!;
}

/** The most the candidates still to go can make of `state`, `depth` activations deep: the best of them going next, or no one. */
function restValue(beam: Beam, state: GameState, depth: number): number {
  let best = 0;
  if (depth <= 0) return best;
  for (let i = 0; i < beam.ids.length; i++) {
    if (beam.used[i]) continue;
    const value = goValue(beam, state, i, depth);
    if (value > best) best = value;
  }
  return best;
}

/**
 * What candidate `i` going next in `state` is worth, with what the others can
 * make of the position it leaves: its plan for each number of actions its dice
 * may give, by the odds, and nothing after a turnover.
 */
function goValue(beam: Beam, state: GameState, i: number, depth: number): number {
  const unit = unitById(state, beam.ids[i]!);
  if (!unit || unit.dead) return 0;
  const dice = beam.dice[i]!;
  const odds = successOdds(unit.quality, dice, unit.inspired);
  beam.used[i] = true;
  // What the others make of the position as it stands: after a roll that buys nothing, or a plan that changes nothing.
  const still = depth > 1 ? restValue(beam, state, depth - 1) : 0;
  let value = 0;
  for (let n = 0; n <= dice; n++) {
    const p = odds[n]!;
    if (p === 0) continue;
    const turnover = dice - n >= 2;
    if (n === 0) {
      if (!turnover) value += p * still;
      continue;
    }
    const plan = planOf(beam, state, unit, n);
    let rest = 0;
    if (!turnover && depth > 1) {
      if (plan.moved) rest = restValue(beam, plan.moved, depth - 1);
      else {
        const kill = plan.killed ? plan.kill! : 0;
        const down = plan.downed ? plan.down! : 0;
        rest = (1 - kill - down) * still;
        if (kill > 0) rest += kill * restValue(beam, plan.killed!, depth - 1);
        if (down > 0) rest += down * restValue(beam, plan.downed!, depth - 1);
      }
    }
    value += p * (plan.score + rest);
  }
  beam.used[i] = false;
  return value;
}

function planOf(beam: Beam, state: GameState, unit: Unit, actions: number): Plan {
  let plans = beam.plans.get(state);
  if (!plans) {
    plans = new Map();
    beam.plans.set(state, plans);
  }
  const key = `${unit.id}/${actions}`;
  let plan = plans.get(key);
  if (!plan) {
    plan = beam.policy.plan(state, beam.board, unit, actions);
    // One position for one move, or for one foe killed or knocked down, however many actions the plan was made with: its plans are shared.
    if (plan.moved) {
      const at = unitById(plan.moved, unit.id)!.pos;
      plan.moved = sameMade(beam, `${positionId(beam, state)}/${unit.id}/${at.x},${at.y}`, plan.moved);
    }
    if (plan.killed) plan.killed = sameMade(beam, `${positionId(beam, state)}/${unit.id}/dead/${plan.target!}`, plan.killed);
    if (plan.downed) plan.downed = sameMade(beam, `${positionId(beam, state)}/${unit.id}/down/${plan.target!}`, plan.downed);
    plans.set(key, plan);
  }
  return plan;
}

/** The position already made under `key`, or `position` as the first of them. */
function sameMade(beam: Beam, key: string, position: GameState): GameState {
  const same = beam.made.get(key);
  if (same) return same;
  beam.made.set(key, position);
  return position;
}

/** A number for each position this search has looked at, to name the positions that follow from it. */
function positionId(beam: Beam, state: GameState): number {
  let id = beam.positions.get(state);
  if (id === undefined) {
    id = beam.positions.size;
    beam.positions.set(state, id);
  }
  return id;
}

// --- Rollouts -----------------------------------------------------------------

function rolloutChoice(state: GameState, board: Board, commands: Command[], params: SearchParams, policy: Policy): number {
  const top = policy.rank(state, board, commands, params.width);
  if (top.length < 2) return top[0]!.index;
  const side = state.active;
  const base = positionHash(state);
  let best = top[0]!.index;
  let bestValue = -Infinity;
  for (const candidate of top) {
    let value = 0;
    for (let p = 0; p < params.playouts; p++) {
      value += playout(state, board, commands[candidate.index]!, mix(mix(base, candidate.index), p), params.depth, side, policy);
    }
    if (value > bestValue) {
      best = candidate.index;
      bestValue = value;
    }
  }
  return best;
}

/**
 * `first` and then the plain AI's own play for both sides, on a copy of `state`
 * with its own dice (`seed`), for `depth` commands more or until the turn (the
 * activation under way) or the game ends; and what the position reached is
 * worth to `side`.
 */
function playout(state: GameState, board: Board, first: Command, seed: number, depth: number, side: Owner, policy: Policy): number {
  let s: GameState = { ...state, rngState: seed };
  let command = first;
  for (let played = 0; ; played++) {
    s = reduce(s, command).state;
    if (s.phase !== 'acting' || played >= depth) break;
    const commands = getLegalCommands(s);
    if (commands.length === 0) break;
    command = commands[policy.rank(s, board, commands, 1)[0]!.index]!;
  }
  return policy.leaf(s, board, side);
}

/** A hash of where everyone stands and in what shape, of whose turn it is and of the round: never of the game's dice. */
function positionHash(state: GameState): number {
  let h = mix(mix(0x811c9dc5, state.round), state.active);
  for (const u of state.units) {
    const shape = (u.dead ? 1 : 0) | (u.knockedDown ? 2 : 0) | (u.activatedThisRound ? 4 : 0) | (u.id === state.activeUnitId ? 8 : 0);
    h = mix(mix(mix(h, u.pos.x), u.pos.y), shape);
  }
  return mix(h, state.actionsRemaining);
}

function mix(h: number, n: number): number {
  h = Math.imul(h ^ n, 0x01000193);
  return (h ^ (h >>> 15)) | 0;
}
