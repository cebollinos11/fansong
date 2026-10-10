import { chooseCommand } from '@fansong/ai';
import { getLegalCommands, makeHexGrid, recordReplay, type Command, type GameState, type Replay } from '@fansong/engine';
import { expect } from 'vitest';
import {
  actOf,
  enemyPoints,
  generateRoute,
  legalRunActions,
  newRun,
  openNodes,
  playerWarband,
  RUN_TUNING,
  runBattleConfig,
  runStep,
  validateArmy,
  validateMap,
  warbandCost,
  type RunAction,
  type RunState,
  type Warband,
} from '../../src/index.js';

/** Play the run's battle out with the AI in both seats. */
export function playBattle(s: RunState): Replay {
  return recordReplay(runBattleConfig(s), chooseCommand);
}

/** Take the first legal action until the run reaches one of `phases`. */
export function autoUntil(s: RunState, ...phases: RunState['phase'][]): RunState {
  for (let i = 0; i < 500 && !phases.includes(s.phase); i++) {
    const action: RunAction | undefined = legalRunActions(s)[0];
    if (!action) throw new Error(`nothing to do in the ${s.phase} phase`);
    s = runStep(s, action);
  }
  return s;
}

/** A drafted run, looking at its first map. */
export function onMap(seed: number, past: readonly Warband[] = []): RunState {
  return autoUntil(newRun(seed, past), 'map');
}

/** A drafted run, waiting at its first briefing. */
export function drafted(seed: number): RunState {
  return autoUntil(newRun(seed), 'briefing');
}

/** A run in its first battle. */
export function inBattle(seed: number): RunState {
  return autoUntil(newRun(seed), 'battle');
}

/**
 * A drafted run set down on the map at step `round`, as if it had come up the
 * route without a scratch: the nodes open to it are those of that step that
 * lead on from the one it stands on. With `node`, it stands just below that node.
 */
export function atStep(seed: number, round: number, options: { past?: readonly Warband[]; node?: number } = {}): RunState {
  const s = onMap(seed, options.past);
  const route = generateRoute(seed, actOf(round), s.rivals ?? []);
  const target = options.node ?? route.nodes.find((n) => n.step === round)!.id;
  // The road there: from the node below the target, down to the bottom row.
  for (let below = route.nodes.find((n) => n.next.includes(target)); below; below = route.nodes.find((n) => n.next.includes(below!.id)))
    route.path.unshift(below.id);
  route.at = route.path.at(-1) ?? null;
  return { ...s, round, rolls: 0, route };
}

/** Invariants of any run state. */
export function checkState(s: RunState): void {
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  expect(s.gold).toBeGreaterThanOrEqual(0);
  expect(s.roster.length).toBeLessThanOrEqual(RUN_TUNING.rosterCap);
  expect(new Set(s.roster.map((u) => u.id)).size).toBe(s.roster.length);
  if (s.phase !== 'draft' && s.phase !== 'over') expect(validateArmy(playerWarband(s)).errors).toEqual([]);
  for (const u of s.roster) expect(u.level).toBeLessThanOrEqual(RUN_TUNING.xp.levels.length);
  if (s.battle) {
    expect(validateArmy(s.battle.enemy).errors).toEqual([]);
    expect(s.battle.enemy.units.length).toBeGreaterThanOrEqual(RUN_TUNING.enemy.minUnits);
    if (s.battle.enemy.units.length > RUN_TUNING.enemy.minUnits)
      expect(warbandCost(s.battle.enemy)).toBeLessThanOrEqual(enemyPoints(s.round, RUN_TUNING.mission.threat.max));
    expect(validateMap(s.battle.map, s.battle.mode).errors).toEqual([]);
  }
  expect(Boolean(s.battle)).toBe(s.phase === 'briefing' || s.phase === 'battle');
  const owed = { draft: 'draft', aftermath: 'reward', reward: 'reward', shop: 'shop' } as Record<string, string>;
  if (!(s.phase === 'aftermath' && s.aftermath?.retreated)) expect(s.offer?.kind).toBe(owed[s.phase]);

  // The route: drawn once the draft is done, for the act the run is in; a node is being played in every phase but the map.
  expect(Boolean(s.route)).toBe(s.phase !== 'draft');
  if (!s.route) return;
  expect(s.route.act).toBe(actOf(s.round));
  expect(s.route.at).toBe(s.route.path.at(-1) ?? null);
  // The road taken is a road: a node a step, each leading to the next.
  s.route.path.forEach((id, i) => {
    if (i > 0) expect(s.route!.nodes[s.route!.path[i - 1]!]!.next).toContain(id);
  });
  if (s.phase === 'map') {
    expect(s.route.going).toBeUndefined();
    const open = openNodes(s.route);
    expect(open.length).toBeGreaterThan(0);
    for (const id of open) expect(s.route.nodes[id]!.step).toBe(s.round);
    expect(legalRunActions(s)).toEqual(open.map((nodeId) => ({ type: 'travel', nodeId })));
  } else if (s.route.going !== undefined) expect(s.route.nodes[s.route.going]!.step).toBe(s.round);
}

/**
 * The AI in both seats, but the player gives the battle up: its Leader sounds
 * the retreat the first time it can, and from then on every player unit walks
 * for the flag (`runFor`: all of them, or only the Leader).
 */
export function retreating(runFor: 'all' | 'leader' = 'all') {
  return (state: GameState): Command => {
    if (state.active !== 0) return chooseCommand(state);
    const legal = getLegalCommands(state);
    const call = legal.find((c) => c.type === 'Retreat');
    if (call) return call;
    if (state.phase === 'awaitingActivation') {
      const leader = state.units.find((u) => u.owner === 0 && u.traits.leader && !u.dead && !u.activatedThisRound);
      const pick = leader && legal.filter((c) => c.type === 'ChooseActivation' && c.unitId === leader.id && !c.group && !c.spell).at(-1);
      return pick ?? chooseCommand(state);
    }
    const unit = state.units.find((u) => u.id === state.activeUnitId)!;
    const flag = state.retreat?.hex;
    if (!flag || (runFor === 'leader' && !unit.traits.leader)) return chooseCommand(state);
    const board = makeHexGrid(state.board);
    let best: Command = { type: 'EndActivation' };
    let bestGap = board.distance(unit.pos, flag);
    for (const c of legal) {
      if (c.type !== 'Move') continue;
      const gap = board.distance(c.to, flag);
      if (gap < bestGap) [best, bestGap] = [c, gap];
    }
    return best;
  };
}
