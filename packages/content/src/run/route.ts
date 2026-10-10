import { PRESET_ROSTERS } from '../presets.js';
import { warbandCost } from '../warband.js';
import { enemyPoints, RIVAL_FACTION, rollMode } from './encounter.js';
import { makeRunRandom, RUN_STREAM, type RunRandom } from './rng.js';
import { RUN_TUNING } from './tuning.js';
import type { NodeKind, RewardOption, Route, RouteNode, RunRival } from './types.js';

/**
 * The act's map: rows of nodes joined by branching paths, all of which end at
 * the act's boss. The player sees all of it from the start and picks a way up,
 * one node a step. An act's route comes from the run's seed and the act alone.
 */

/** The act `round` belongs to, from 1. */
export function actOf(round: number): number {
  return Math.ceil(round / RUN_TUNING.enemy.bossEvery);
}

/** Whether a node of this kind is a fight, not a stop. */
export function isFight(kind: NodeKind): boolean {
  return kind === 'battle' || kind === 'elite' || kind === 'boss';
}

/** Whether a node of this kind is a stop: somewhere safe, with no battle to fight (unless a mystery turns out to be one). */
export function isStop(kind: NodeKind): boolean {
  return !isFight(kind);
}

/**
 * What each node below the boss is, by id; `nodes` are in row order, `first`
 * the step of the bottom row. The bottom row is all battles. The top row is
 * camps and markets, one of each if it has two nodes. In between the kinds
 * are rolled by weight, but an elite waits no lower than `eliteFromRow`, no
 * stop comes straight after a stop (so the row under the top one is all
 * fights), and the act is given an elite and a market if the rolls left it
 * without.
 */
function rollKinds(nodes: readonly RouteNode[], first: number, rnd: RunRandom): NodeKind[] {
  const { rows, kinds: weights, eliteFromRow } = RUN_TUNING.route;
  const kinds: NodeKind[] = nodes.map(() => 'battle');
  const rowOf = (n: RouteNode) => n.step - first + 1;
  const rolled = Object.keys(weights) as (keyof typeof weights)[];

  for (const node of nodes) {
    const row = rowOf(node);
    if (row === 1 || row === rows) continue;
    const afterStop = nodes.some((p) => p.next.includes(node.id) && isStop(kinds[p.id]!));
    const allowed = rolled.filter((k) => (isStop(k) ? !afterStop && row < rows - 1 : k !== 'elite' || row >= eliteFromRow));
    kinds[node.id] = rnd.weighted(allowed, (k) => weights[k]);
  }

  const top = rnd.sample(nodes.filter((n) => rowOf(n) === rows), nodes.length);
  top.forEach((node, i) => (kinds[node.id] = i === 0 ? 'camp' : i === 1 ? 'market' : rnd.pick(['camp', 'market'] as const)));
  if (!kinds.includes('market')) kinds[top[0]!.id] = 'market';
  if (!kinds.includes('elite')) {
    const plain = nodes.filter((n) => kinds[n.id] === 'battle' && rowOf(n) >= eliteFromRow);
    if (plain.length > 0) kinds[rnd.pick(plain).id] = 'elite';
  }
  return kinds;
}

/**
 * The route of `act`. `paths` walks go up from the bottom row, each a step to
 * the lane left, ahead or right, never crossing one another; the nodes are the
 * places they pass, and the top row all leads to the boss. A fight node rolls
 * here what the map shows of it: its enemy's faction and threat, its mode and
 * the kind of reward. A rival due at one of the act's steps takes a battle
 * node of that step.
 */
export function generateRoute(seed: number, act: number, rivals: readonly RunRival[] = []): Route {
  const { lanes, rows, paths, rewardKinds } = RUN_TUNING.route;
  const rnd = makeRunRandom(seed, act, 0, RUN_STREAM.route);
  const base = (act - 1) * RUN_TUNING.enemy.bossEvery;

  // links[row][lane]: the lanes of the next row this place leads to, if a path passes it.
  const links: (Set<number> | undefined)[][] = Array.from({ length: rows }, () => Array.from({ length: lanes }, () => undefined));
  const crosses = (row: number, from: number, to: number) =>
    links[row]!.some((tos, other) => tos && [...tos].some((t) => (other < from && t > to) || (other > from && t < to)));
  const { fresh, fork } = RUN_TUNING.route.spread;
  // The first two walks start apart, so the act opens on a choice.
  const starts = rnd.sample(Array.from({ length: lanes }, (_, l) => l), 2);
  for (let p = 0; p < paths; p++) {
    let lane = starts[p] ?? rnd.int(0, lanes - 1);
    for (let row = 0; row < rows; row++) {
      const here = (links[row]![lane] ??= new Set());
      if (row === rows - 1) break;
      const from = lane;
      // Straight ahead never crosses, so there is always a way on. A walk leans
      // toward ground no other has trodden, so the roads fork rather than bunch.
      const ways = [from - 1, from, from + 1].filter((to) => to >= 0 && to < lanes && !crosses(row, from, to));
      lane = rnd.weighted(ways, (to) => (!links[row + 1]![to] ? fresh : !here.has(to) ? fork : 1));
      here.add(lane);
    }
  }
  // Four walks alone leave most places with one way on. Side roads join
  // neighbours the walks left unjoined, so that most steps are a choice.
  links.slice(0, -1).forEach((row, r) =>
    row.forEach((tos, from) => {
      if (!tos) return;
      for (const to of [from - 1, from, from + 1])
        if (links[r + 1]![to] && !tos.has(to) && !crosses(r, from, to) && rnd.next() < RUN_TUNING.route.sideRoads) tos.add(to);
    }),
  );

  const idAt = new Map<string, number>();
  const nodes: RouteNode[] = [];
  links.forEach((row, r) =>
    row.forEach((tos, lane) => {
      if (!tos) return;
      idAt.set(`${r}:${lane}`, nodes.length);
      nodes.push({ id: nodes.length, step: base + r + 1, lane, kind: 'battle', next: [] });
    }),
  );
  const bossId = nodes.length;
  for (const node of nodes) {
    const r = node.step - base - 1;
    node.next = r === rows - 1 ? [bossId] : [...links[r]![node.lane]!].sort((a, b) => a - b).map((lane) => idAt.get(`${r + 1}:${lane}`)!);
  }

  rollKinds(nodes, base + 1, rnd).forEach((kind, id) => (nodes[id]!.kind = kind));
  nodes.push({ id: bossId, step: base + rows + 1, lane: (lanes - 1) / 2, kind: 'boss', next: [] });

  const factions = Object.keys(PRESET_ROSTERS);
  const kinds = Object.keys(rewardKinds) as RewardOption['kind'][];
  for (const node of nodes) {
    if (!isFight(node.kind)) continue;
    const { min, max } = node.kind === 'elite' ? RUN_TUNING.elite.threat : RUN_TUNING.mission.threat;
    node.faction = rnd.pick(factions);
    node.mode = rollMode(node.step, rnd);
    node.threat = node.kind === 'boss' ? 1 : min + rnd.next() * (max - min);
    if (node.kind !== 'boss') node.rewardKind = rnd.weighted(kinds, (k) => rewardKinds[k]);
  }

  for (const rival of rivals) {
    const here = nodes.filter((n) => n.step === rival.round && n.kind === 'battle' && !n.rival);
    if (here.length === 0) continue;
    const node = rnd.pick(here);
    node.rival = true;
    node.faction = RIVAL_FACTION;
    node.threat = warbandCost(rival.warband) / enemyPoints(node.step);
  }

  return { act, nodes, at: null, path: [], closed: [] };
}

/** The nodes the run may travel to now: those the last one leads to (the bottom row, at the act's start), but for the closed. None while a node is being played. */
export function openNodes(route: Route): number[] {
  if (route.going !== undefined) return [];
  const start = Math.min(...route.nodes.map((n) => n.step));
  const ahead = route.at === null ? route.nodes.filter((n) => n.step === start).map((n) => n.id) : (route.nodes[route.at]?.next ?? []);
  return ahead.filter((id) => !route.closed.includes(id));
}
