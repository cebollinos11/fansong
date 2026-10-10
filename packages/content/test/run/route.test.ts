import { recordReplay } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import {
  generateRoute,
  isFight,
  legalRunActions,
  makeRunRandom,
  openNodes,
  PRESET_ROSTERS,
  RUN_TUNING,
  runBattleConfig,
  runStep,
  type Route,
  type RunAction,
  type RunState,
} from '../../src/index.js';
import { atStep, checkState, playBattle, retreating } from './helpers.js';

const SEEDS = Array.from({ length: 500 }, (_, i) => i * 31 + 1);
const { lanes, rows } = RUN_TUNING.route;
const ACT = RUN_TUNING.enemy.bossEvery;

/** The row of a node, from 0; the boss is in row `rows`. */
const rowOf = (route: Route, id: number) => route.nodes[id]!.step - (route.act - 1) * ACT - 1;

describe('generateRoute', () => {
  it('is the same for the same seed and act, and no other', () => {
    expect(generateRoute(5, 1)).toEqual(generateRoute(5, 1));
    expect(generateRoute(5, 2)).not.toEqual(generateRoute(5, 1));
    expect(generateRoute(6, 1)).not.toEqual(generateRoute(5, 1));
    expect(JSON.parse(JSON.stringify(generateRoute(5, 1)))).toEqual(generateRoute(5, 1));
  });

  it('is rows of nodes under one boss: every node is reached from the bottom and reaches the boss, and no two roads cross', () => {
    let choices = 0;
    let steps = 0;
    for (const seed of SEEDS)
      for (const act of [1, 2, 3]) {
        const route = generateRoute(seed, act);
        const at = `seed ${seed} act ${act}`;
        expect(route).toMatchObject({ act, at: null, path: [], closed: [] });
        route.nodes.forEach((n, i) => expect(n.id).toBe(i));
        const boss = route.nodes.at(-1)!;
        expect(boss, at).toMatchObject({ kind: 'boss', step: act * ACT, next: [] });
        expect(route.nodes.filter((n) => n.kind === 'boss')).toHaveLength(1);

        const reached = new Set(openNodes(route));
        expect(reached.size, at).toBeGreaterThanOrEqual(2);
        for (const n of route.nodes) {
          const row = rowOf(route, n.id);
          expect(n.step).toBe((act - 1) * ACT + row + 1);
          if (n === boss) continue;
          expect(row).toBeLessThan(rows);
          expect(n.lane).toBeGreaterThanOrEqual(0);
          expect(n.lane).toBeLessThan(lanes);
          // Bottom row first, left to right; each road goes up one row, at most a lane aside.
          expect(reached.has(n.id), at).toBe(true);
          expect(n.next.length, at).toBeGreaterThan(0);
          expect(new Set(n.next).size).toBe(n.next.length);
          for (const id of n.next) {
            reached.add(id);
            const to = route.nodes[id]!;
            expect(rowOf(route, id)).toBe(row + 1);
            if (to !== boss) expect(Math.abs(to.lane - n.lane), at).toBeLessThanOrEqual(1);
          }
          if (row === rows - 1) expect(n.next).toEqual([boss.id]);
          steps++;
          if (n.next.length > 1) choices++;
        }
        // One place per row and lane.
        expect(new Set(route.nodes.map((n) => `${n.step}:${n.lane}`)).size).toBe(route.nodes.length);
        // No crossing: of two nodes in a row, the left one's roads all end at or left of the right one's.
        for (const a of route.nodes)
          for (const b of route.nodes) {
            if (a.step !== b.step || a.lane >= b.lane || a === boss) continue;
            const right = Math.max(...a.next.map((id) => route.nodes[id]!.lane));
            const left = Math.min(...b.next.map((id) => route.nodes[id]!.lane));
            expect(right, at).toBeLessThanOrEqual(left);
          }
      }
    // The map is a choice, not a corridor: a fair share of its nodes fork.
    expect(choices / steps).toBeGreaterThan(0.33);
  });

  it('offers a choice of roads on most steps of a wandering run', () => {
    let choice = 0;
    let stops = 0;
    for (const seed of SEEDS) {
      const route = generateRoute(seed, 1);
      const rnd = makeRunRandom(seed, 0, 0, 77);
      for (let row = 0; row < rows; row++) {
        const open = openNodes(route);
        stops++;
        if (open.length > 1) choice++;
        route.at = rnd.pick(open);
      }
    }
    expect(choice / stops).toBeGreaterThan(0.55);
  });

  it('shows of each fight who waits there, how hard, in what mode and for what kind of pay', () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 100))
      for (const act of [1, 2]) {
        const route = generateRoute(seed, act);
        for (const n of route.nodes) {
          if (!isFight(n.kind)) {
            expect([n.threat, n.faction, n.mode, n.rewardKind]).toEqual([undefined, undefined, undefined, undefined]);
            continue;
          }
          expect(Object.keys(PRESET_ROSTERS)).toContain(n.faction);
          if (n.kind === 'boss') expect(n).toMatchObject({ mode: 'kill-the-king', threat: 1 });
          else {
            expect(RUN_TUNING.modes.regular).toContain(n.mode);
            if (n.step <= RUN_TUNING.modes.annihilationThrough) expect(n.mode).toBe('annihilation');
            kinds.add(n.rewardKind!);
          }
          if (n.kind === 'battle') {
            expect(n.threat).toBeGreaterThanOrEqual(RUN_TUNING.mission.threat.min);
            expect(n.threat).toBeLessThan(RUN_TUNING.mission.threat.max);
          }
        }
      }
    expect([...kinds].sort()).toEqual(['boost', 'gold', 'mend', 'recruit']);
  });
});

describe('openNodes', () => {
  it('is the bottom row at first, then what the last node leads to, less the closed; nothing while a node is played', () => {
    const route = generateRoute(3, 1);
    const start = route.nodes.filter((n) => n.step === 1).map((n) => n.id);
    expect(openNodes(route)).toEqual(start);
    expect(openNodes({ ...route, closed: [start[0]!] })).toEqual(start.slice(1));
    expect(openNodes({ ...route, going: start[0]! })).toEqual([]);
    const from = route.nodes.find((n) => n.next.length > 1)!;
    expect(openNodes({ ...route, at: from.id })).toEqual(from.next);
    expect(openNodes({ ...route, at: from.id, closed: [from.next[1]!] })).toEqual(from.next.filter((_, i) => i !== 1));
    expect(openNodes({ ...route, at: route.nodes.at(-1)!.id })).toEqual([]);
  });
});

/**
 * A random walk of the legal actions, from the map at a random step. A battle
 * is played out by the AI, or (every other one, banner in hand) fled.
 */
function walk(seed: number, steps: number): { phases: Set<string>; actions: Set<string>; closed: number } {
  const rnd = makeRunRandom(seed, 0, 0, 99);
  let s: RunState = { ...atStep(seed, rnd.int(1, ACT + 2)), gold: rnd.int(0, 120), banners: rnd.int(0, 2) };
  const phases = new Set<string>();
  const actions = new Set<string>();
  let closed = 0;
  let battles = 0;
  for (let i = 0; i < steps && s.phase !== 'over'; i++) {
    checkState(s);
    phases.add(s.phase);
    let action: RunAction;
    if (s.phase === 'battle') {
      if (battles++ >= 1) break;
      const flee = s.banners > 0 && rnd.int(0, 1) === 0;
      action = { type: 'battleResult', replay: flee ? recordReplay(runBattleConfig(s), retreating()) : playBattle(s) };
    } else {
      const legal = legalRunActions(s);
      expect(legal.length, `seed ${seed}: stuck in the ${s.phase} phase`).toBeGreaterThan(0);
      action = rnd.pick(legal);
    }
    actions.add(action.type);
    s = runStep(s, action);
    closed = Math.max(closed, s.route?.closed.length ?? 0);
  }
  checkState(s);
  return { phases, actions, closed };
}

describe('a random walk of the legal actions', () => {
  it('never gets stuck and never throws, over 200 seeds', () => {
    const phases = new Set<string>();
    const actions = new Set<string>();
    let closed = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const w = walk(seed, 400);
      for (const p of w.phases) phases.add(p);
      for (const a of w.actions) actions.add(a);
      closed = Math.max(closed, w.closed);
    }
    expect([...phases].sort()).toEqual(['aftermath', 'battle', 'briefing', 'map', 'reward', 'shop']);
    for (const type of ['travel', 'startBattle', 'battleResult', 'continue', 'reward', 'leaveShop', 'buyRecruit', 'bench'])
      expect([...actions], type).toContain(type);
    expect(closed).toBeGreaterThan(0);
  }, 600_000);
});
