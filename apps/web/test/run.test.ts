import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import {
  injuryFor,
  legalRunActions,
  missionSkulls,
  makeRunRandom,
  newRun,
  openNodes,
  PRESET_ROSTERS,
  RUN_EVENT_IDS,
  runBattleConfig,
  runStep,
  shopStock,
  stageEvent,
  RUN_TUNING,
  unitCost,
  type RewardOption,
  type RunAction,
  type RunPhase,
  type RunState,
} from '@fansong/content';
import { recordReplay } from '@fansong/engine';
import type { MapStorage } from '../src/game/customMaps.js';
import {
  addRunRecord,
  clearRun,
  loadRun,
  loadRunRecords,
  MAX_RUN_RECORDS,
  parseRun,
  RUN_KEY,
  RUN_RECORDS_KEY,
  pastWarbands,
  runRecord,
  saveRun,
  type RunRecord,
} from '../src/game/runStore.js';
import { NODE_IMAGES, nodeImageUrl } from '../src/ui/nodeArt.js';
import {
  advanceChange,
  advanceInfo,
  aftermathView,
  briefingView,
  campView,
  draftView,
  eventView,
  fateText,
  historyLines,
  injuryChecks,
  injuryFaces,
  renameError,
  standingUnits,
  levelLine,
  NODE_INFO,
  overView,
  placeLine,
  ROUTE_CELL,
  routeView,
  recordLine,
  rewardLine,
  rewardView,
  runHeader,
  runMenuItem,
  runSeedFrom,
  shopView,
  trainingView,
  threatLabel,
  unitView,
  woundInfo,
  type Choice,
  repeatGuard,
} from '../src/ui/runView.js';

function memoryStorage(initial: Record<string, string> = {}): MapStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

/** Fight the battle phase's match with the AI in both seats. */
function fight(s: RunState): RunState {
  return runStep(s, { type: 'battleResult', replay: recordReplay(runBattleConfig(s), chooseCommand, 20_000) });
}

/** Take the first legal action of `type` (or the first of any) until the run reaches `phase`; fights its battles. */
function playTo(s: RunState, phase: RunPhase, prefer?: RunAction['type']): RunState {
  for (let i = 0; i < 500 && s.phase !== phase; i++) {
    if (s.phase === 'over') throw new Error(`the run ended before reaching ${phase}`);
    if (s.phase === 'battle') s = fight(s);
    else {
      const legal = legalRunActions(s);
      const next =
        legal.find((a) => a.type === prefer) ??
        legal.find((a) => ['startBattle', 'advance', 'continue', 'leaveShop'].includes(a.type)) ??
        legal[0]!;
      s = runStep(s, next);
    }
  }
  return s;
}

/** A seed whose first battle the AI wins from the player's seat, and the run just after that win. */
function wonRun(): RunState {
  for (let seed = 1; seed < 40; seed++) {
    const s = fight(playTo(newRun(seed), 'battle'));
    if (s.phase === 'aftermath') return s;
  }
  throw new Error('no seed wins its first battle');
}

/** A run that has lost a battle. */
function lostRun(): RunState {
  for (let seed = 1; seed < 20; seed++) {
    let s = newRun(seed);
    for (let i = 0; i < 2000 && s.phase !== 'over'; i++) s = s.phase === 'battle' ? fight(s) : playTo(s, 'battle');
    if (s.phase === 'over') return s;
  }
  throw new Error('no run ends');
}

const WON = wonRun();
const taken = (s: RunState, c: Choice): RunState => runStep(s, c.action);

describe('the saved run', () => {
  it('round-trips at every phase of a run', () => {
    const storage = memoryStorage();
    let s = newRun(7);
    const seen = new Set<RunPhase>();
    for (let i = 0; i < 400 && s.round < 3 && s.phase !== 'over'; i++) {
      seen.add(s.phase);
      expect(saveRun(storage, s)).toBe(true);
      expect(loadRun(storage)).toEqual(s);
      s = s.phase === 'battle' ? fight(s) : runStep(s, legalRunActions(s).find((a) => a.type !== 'reroll' && a.type !== 'sell' && a.type !== 'bench')!);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['draft', 'map', 'briefing', 'battle']));
  });

  it('carries on from a loaded run exactly as from the one saved', () => {
    const storage = memoryStorage();
    const battle = playTo(newRun(3), 'battle');
    saveRun(storage, battle);
    const loaded = loadRun(storage)!;
    // The battle restarts from the same setup: the same match, to the last die.
    expect(runBattleConfig(loaded)).toEqual(runBattleConfig(battle));
    expect(fight(loaded)).toEqual(fight(battle));
  });

  it('has no run for missing, cleared, corrupt or foreign storage, and never throws', () => {
    expect(loadRun(null)).toBeNull();
    expect(loadRun(memoryStorage())).toBeNull();
    expect(loadRun(memoryStorage({ [RUN_KEY]: '{not json' }))).toBeNull();
    expect(loadRun(memoryStorage({ [RUN_KEY]: '[]' }))).toBeNull();
    expect(loadRun(memoryStorage({ [RUN_KEY]: JSON.stringify({ ...newRun(1), version: 1 }) }))).toBeNull();
    const storage = memoryStorage();
    saveRun(storage, newRun(1));
    clearRun(storage);
    expect(loadRun(storage)).toBeNull();
    expect(saveRun(null, newRun(1))).toBe(false);
    const full: MapStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(saveRun(full, newRun(1))).toBe(false);
    expect(() => clearRun(full)).not.toThrow();
  });

  it('rejects a run whose pieces are not what they say', () => {
    const briefing = playTo(newRun(5), 'briefing');
    const map = playTo(newRun(5), 'map');
    const route = map.route!;
    const node0 = route.nodes[0]!;
    const broken: unknown[] = [
      { ...briefing, roster: [] },
      { ...briefing, roster: [{ ...briefing.roster[0], unit: { name: 'Ghost' } }] },
      { ...briefing, roster: [briefing.roster[0], briefing.roster[0]] },
      { ...briefing, battle: undefined },
      { ...briefing, battle: { ...briefing.battle, map: { id: 'x' } } },
      { ...briefing, battle: { ...briefing.battle, rewards: [{ kind: 'loot' }] } },
      { ...briefing, battle: { ...briefing.battle, threat: 'high' } },
      { ...map, route: undefined },
      { ...map, route: { ...route, going: 0 } },
      { ...map, route: { ...route, closed: openNodes(route) } },
      { ...map, route: { ...route, at: 99 } },
      { ...map, route: { ...route, path: [0] } },
      { ...map, route: { ...route, nodes: [{ ...node0, kind: 'tavern' }, ...route.nodes.slice(1)] } },
      { ...map, route: { ...route, nodes: [{ ...node0, next: [0] }, ...route.nodes.slice(1)] } },
      { ...map, route: { ...route, nodes: [{ ...node0, id: 3 }, ...route.nodes.slice(1)] } },
      { ...map, route: { ...route, nodes: [{ ...node0, rewardKind: 'loot' }, ...route.nodes.slice(1)] } },
      { ...map, version: 2 },
      { ...briefing, route: { ...briefing.route!, going: undefined } },
      { ...briefing, phase: 'shop' },
      { ...briefing, phase: 'battle' },
      { ...briefing, phase: 'nowhere' },
      { ...briefing, gold: -1 },
      { ...briefing, log: 'none' },
      { ...newRun(5), offer: undefined },
    ];
    for (const run of broken) expect(() => parseRun(JSON.parse(JSON.stringify(run)))).toThrow();
    expect(parseRun(JSON.parse(JSON.stringify(briefing)))).toEqual(briefing);
    expect(parseRun(JSON.parse(JSON.stringify(map)))).toEqual(map);
  });

  it('does not offer a finished run to continue', () => {
    const storage = memoryStorage();
    saveRun(storage, lostRun());
    expect(loadRun(storage)).toBeNull();
  });
});

describe('run records', () => {
  const record = (wins: number, at: number): RunRecord => ({ seed: wins, wins, round: wins + 1, kills: 0, end: 'lost', victorious: false, at, roster: [] });

  it('describes a run that has ended', () => {
    const over = lostRun();
    const r = runRecord(over, 'lost', 99);
    expect(r).toMatchObject({ seed: over.seed, round: over.round, end: 'lost', at: 99, wins: over.log.filter((l) => l.won).length, victorious: false });
    expect(r.roster).toEqual(over.roster.map((u) => u.unit.name));
  });

  it('keeps the best few, best first, the newer of equals ahead', () => {
    const storage = memoryStorage();
    addRunRecord(storage, record(2, 1));
    addRunRecord(storage, record(5, 2));
    expect(addRunRecord(storage, record(2, 3)).map((r) => [r.wins, r.at])).toEqual([[5, 2], [2, 3], [2, 1]]);
    for (let i = 0; i < MAX_RUN_RECORDS + 3; i++) addRunRecord(storage, record(10 + i, 10 + i));
    const kept = loadRunRecords(storage);
    expect(kept).toHaveLength(MAX_RUN_RECORDS);
    expect(kept[0]!.wins).toBe(10 + MAX_RUN_RECORDS + 2);
  });

  it('skips corrupt records and survives failing storage', () => {
    expect(loadRunRecords(null)).toEqual([]);
    expect(loadRunRecords(memoryStorage({ [RUN_RECORDS_KEY]: 'nope' }))).toEqual([]);
    expect(loadRunRecords(memoryStorage({ [RUN_RECORDS_KEY]: '{}' }))).toEqual([]);
    const mixed = JSON.stringify([record(1, 1), { seed: 'x' }, null, { ...record(3, 2), end: 'won' }, { ...record(4, 3), roster: [1, 'Wolf'] }]);
    expect(loadRunRecords(memoryStorage({ [RUN_RECORDS_KEY]: mixed })).map((r) => [r.wins, r.roster])).toEqual([[4, ['Wolf']], [1, []]]);
    expect(addRunRecord(null, record(1, 1))).toEqual([record(1, 1)]);
  });

  it('keeps the warband a run ended with, to meet again in later runs', () => {
    const over = lostRun();
    const storage = memoryStorage();
    addRunRecord(storage, runRecord(over, 'lost', 1));
    addRunRecord(storage, record(1, 2));
    const records = loadRunRecords(storage);
    const units = records.find((r) => r.at === 1)!.units;
    expect(units).toEqual(over.roster.map((u) => u.unit));
    expect(pastWarbands(records)).toEqual([{ name: `The Fallen of Round ${over.round}`, units }]);
    // A warband that no longer reads is dropped, not the record.
    const bad = JSON.stringify([{ ...record(1, 1), units: [{ name: 'X' }] }]);
    expect(loadRunRecords(memoryStorage({ [RUN_RECORDS_KEY]: bad }))).toEqual([record(1, 1)]);
  });

  it('saves and loads a run with rivals', () => {
    const units = lostRun().roster.map((u) => u.unit);
    const s = newRun(3, [{ name: 'Old', units }, { name: 'Older', units: units.concat(units).map((u, i) => ({ ...u, name: `${u.name} ${i}` })) }]);
    expect(s.rivals?.length).toBeGreaterThan(0);
    const storage = memoryStorage();
    saveRun(storage, s);
    expect(loadRun(storage)).toEqual(s);
  });

  it('reads as a line', () => {
    expect(recordLine(record(1, 1))).toBe('1 battle won · fell at step 2 · seed 1');
    expect(recordLine({ ...record(6, 1), end: 'abandoned' })).toBe('6 battles won · given up at step 7 · seed 6');
  });
});

describe('the run screens', () => {
  it('heads every screen with the round, gold, roster and seed', () => {
    const s = newRun(42);
    expect(runHeader(s)).toMatchObject({
      title: 'Draft your warband',
      round: 1,
      place: 'Act 1 · step 1 of 7',
      gold: 0,
      seed: 42,
      boss: false,
      roster: `0/${RUN_TUNING.rosterCap} units · 0 pts`,
    });
    expect(runHeader({ ...playTo(s, 'briefing'), round: RUN_TUNING.enemy.bossEvery }).title).toBe('Boss battle');
    expect([placeLine(7), placeLine(8), placeLine(14), placeLine(15)]).toEqual(['Act 1 · step 7 of 7', 'Act 2 · step 1 of 7', 'Act 2 · step 7 of 7', 'Act 3 · step 1 of 7']);
  });

  it('drafts a leader, then troops, within the budget', () => {
    let s = newRun(11);
    const first = draftView(s)!;
    expect(first.stage).toBe('leader');
    expect(first.left).toBe(RUN_TUNING.draft.budget);
    expect(first.offers.every((o) => o.unit.leader && o.pick.error === null && o.cost <= first.left)).toBe(true);
    s = taken(s, first.offers[0]!.pick);
    const second = draftView(s)!;
    expect(second.stage).toBe('troop');
    expect(second.left).toBe(RUN_TUNING.draft.budget - first.offers[0]!.cost);
    expect(draftView(playTo(s, 'briefing'))).toBeNull();
  });

  it('draws the map: the boss on top, the roads, and the open nodes to travel to', () => {
    expect(routeView(newRun(11))).toBeNull();
    const s = playTo(newRun(11), 'map');
    const route = s.route!;
    const view = routeView(s)!;
    expect(runHeader(s).title).toBe('Choose your road');
    expect(view).toMatchObject({ act: 1, place: 'Act 1 · step 1 of 7', width: RUN_TUNING.route.lanes * ROUTE_CELL.width, height: (RUN_TUNING.route.rows + 1) * ROUTE_CELL.height });
    expect(view.nodes.map((n) => n.id)).toEqual(route.nodes.map((n) => n.id));
    expect(view.edges).toHaveLength(route.nodes.reduce((sum, n) => sum + n.next.length, 0));

    // Every node is on the map, a row a step, the boss alone above them all.
    const boss = view.nodes.at(-1)!;
    expect(boss).toMatchObject({ kind: 'boss', label: 'Boss', glyph: NODE_INFO.boss.glyph, x: view.width / 2, state: 'ahead' });
    for (const n of view.nodes) {
      const node = route.nodes[n.id]!;
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(view.width);
      expect(n.y).toBe(view.height - (node.step - 0.5) * ROUTE_CELL.height);
      if (n !== boss) expect(n.y).toBeGreaterThan(boss.y);
      expect(n.visited).toBe(false);
    }
    // Every road goes up the map.
    for (const e of view.edges) expect(e.y2).toBeLessThan(e.y1);

    // The bottom row is open, and only that: each open node has its way there, by the rules.
    const open = openNodes(route);
    expect(view.choices.map((n) => n.id)).toEqual(open);
    expect(view.nodes.filter((n) => n.state === 'open').map((n) => n.id)).toEqual(open);
    expect(view.nodes.filter((n) => n.state !== 'open').every((n) => n.state === 'ahead' && n.travel === null)).toBe(true);
    for (const n of view.choices) {
      const node = route.nodes[n.id]!;
      expect(n.travel!.error).toBeNull();
      expect(n).toMatchObject({ kind: 'battle', skulls: missionSkulls(node.threat!), look: PRESET_ROSTERS[node.faction!]!.units[0]!.unit });
      // What the map knows of a fight: its danger, mode, enemy and the kind of pay.
      expect(n.lines).toHaveLength(4);
      expect(n.lines[0]).toBe(`${'☠'.repeat(n.skulls!)} ${threatLabel(n.skulls!)}`);
      expect(n.lines[1]).toBe('Annihilation');
      expect(n.lines[2]).toBe(`Against ${PRESET_ROSTERS[node.faction!]!.name}`);
      expect(n.lines[3]).toMatch(/^Pays /);
      const there = taken(s, n.travel!);
      expect([there.phase, there.route!.going]).toEqual(['briefing', n.id]);
    }
    expect(boss.lines).toEqual(['☠☠☠☠☠ Boss', 'Kill the king', `Against ${PRESET_ROSTERS[route.nodes.at(-1)!.faction!]!.name}`, 'Pays a prize, and a retreat banner']);

    // On the way: the node being played is where the run stands, and nothing is open.
    const going = taken(s, view.choices[0]!.travel!);
    const played = routeView(going)!;
    expect(played.choices).toEqual([]);
    expect(played.nodes[view.choices[0]!.id]!.state).toBe('here');
    expect(played.nodes.filter((n) => n.state === 'passed').map((n) => n.id)).toEqual(open.slice(1));

    // A step on: the road taken is marked, the row behind is passed, the next is open.
    const on = playTo(WON, 'map');
    const later = routeView(on)!;
    const from = on.route!.at!;
    expect(later.place).toBe('Act 1 · step 2 of 7');
    expect(later.nodes[from]).toMatchObject({ state: 'here', visited: true });
    expect(later.choices.map((n) => n.id)).toEqual(on.route!.nodes[from]!.next);
    expect(later.edges.filter((e) => e.state === 'open').map((e) => [e.from, e.to])).toEqual(later.choices.map((n) => [from, n.id]));
    expect(later.nodes.filter((n) => n.state === 'passed').length).toBe(on.route!.nodes.filter((n) => n.step === 1).length - 1);

    // A node fled is closed, with no way there.
    const shut: RunState = { ...on, route: { ...on.route!, closed: [later.choices[0]!.id] } };
    const closed = routeView(shut)!;
    expect(closed.nodes[later.choices[0]!.id]).toMatchObject({ state: 'closed', travel: null });
    expect(closed.choices.map((n) => n.id)).toEqual(on.route!.nodes[from]!.next.slice(1));

    // A rival's node says who waits there, and shows no faction.
    const rival: RunState = { ...s, route: { ...route, nodes: route.nodes.map((n) => (n.id === open[0] ? { ...n, rival: true as const, faction: 'rival' } : n)) } };
    const met = routeView(rival)!.nodes[open[0]!]!;
    expect(met.look).toBeUndefined();
    expect(met.lines[2]).toBe('The warband a past run of yours ended with');

    // The road taken reads as taken once the next node is travelled to.
    const next = taken(on, later.choices[0]!.travel!);
    expect(routeView(next)!.edges.find((e) => e.from === from && e.to === later.choices[0]!.id)!.state).toBe('taken');

    expect(threatLabel(1)).toBe('Easy pickings');
    expect(threatLabel(RUN_TUNING.mission.skulls)).toBe('Deadly');
    expect(rewardLine({ kind: 'gold', amount: 12 }).title).toBe('12 gold');
    expect(rewardLine({ kind: 'boost', advance: { kind: 'combat' } }).title).toBe('Combat +1');
    expect(rewardLine({ kind: 'mend' }).title).toBe('A healer');
    expect(rewardLine({ kind: 'recruit', unit: s.roster[0]!.unit }).recruit!.cost).toBe(unitCost(s.roster[0]!.unit));
  });

  it('briefs the battle: the enemy, the field, and who fights', () => {
    const s = playTo(newRun(11), 'briefing');
    const view = briefingView(s)!;
    expect(view.mode).toBe('Annihilation');
    expect(view.boss).toBe(false);
    // The enemy is only shapes and a skull count; what winning pays is spelt out.
    expect(view.enemy.units.map((u) => u.look)).toEqual(s.battle!.enemy.units.map((u) => u.look ?? u.name));
    expect(view.enemy.count).toBe(s.battle!.enemy.units.length);
    expect(view.enemy.skulls).toBe(missionSkulls(s.battle!.threat));
    expect(view.enemy.threat).toBe(threatLabel(view.enemy.skulls));
    expect(JSON.stringify(view.enemy)).not.toContain('combat');
    expect(view.rewards).toEqual(s.battle!.rewards.map(rewardLine));
    // The field is drawn with this mode's objectives only: annihilation has none.
    expect(view.map).toEqual({ ...s.battle!.map, objectives: {} });
    const hill = briefingView({ ...s, battle: { ...s.battle!, mode: 'king-of-the-hill' } })!.map.objectives;
    expect(hill).toEqual({ hill: s.battle!.map.objectives.hill });
    // Lava, where the field has any, is pointed out.
    expect(view.lava).toBe(false);
    const molten = { ...s.battle!.map, hexes: s.battle!.map.hexes.map((hex, i) => (i === 0 ? { ...hex, feature: 'lava' as const } : hex)) };
    expect(briefingView({ ...s, battle: { ...s.battle!, map: molten } })!.lava).toBe(true);
    expect(view.units).toHaveLength(s.roster.length);
    expect(view.units.every((u) => u.fielded && !u.king && u.crown === null && u.bench?.error === null)).toBe(true);
    expect(view.start.error).toBeNull();

    // Benching a unit takes it off the field, and it can be put back.
    const benched = taken(s, view.units[0]!.bench!);
    const after = briefingView(benched)!;
    expect(after.units[0]).toMatchObject({ fielded: false, view: { benched: true } });
    expect(after.units[0]!.bench!.action).toEqual({ type: 'bench', unitId: s.roster[0]!.id, benched: false });
    expect(after.fielded).toContain(`${s.roster.length - 1} unit`);

    // The last unit standing can't be benched: the rules say why, and the button carries it.
    let alone = s;
    for (const u of s.roster.slice(1)) alone = runStep(alone, { type: 'bench', unitId: u.id, benched: true });
    expect(briefingView(alone)!.units[0]!.bench!.error).toBe('someone has to fight');
  });

  it('crowns a King on a boss round', () => {
    const s = playTo(newRun(11), 'briefing');
    const boss: RunState = { ...s, battle: { ...s.battle!, mode: 'kill-the-king', enemyKing: 0 } };
    const view = briefingView(boss)!;
    expect(view.boss).toBe(true);
    expect(view.enemy.units.map((u) => u.king)).toEqual(boss.battle!.enemy.units.map((_, i) => i === 0));
    expect(view.enemy).toMatchObject({ skulls: RUN_TUNING.mission.skulls, threat: 'Boss' });
    expect(view.goal).toBe('Kill the enemy King before yours falls');
    expect(view.units.filter((u) => u.king)).toHaveLength(1);
    const other = view.units.find((u) => !u.king)!;
    expect(other.crown!.error).toBeNull();
    const crowned = briefingView(taken(boss, other.crown!))!;
    expect(crowned.units.find((u) => u.king)!.view.id).toBe(other.view.id);
    // A King left on the bench passes the crown back to the default.
    const benched = briefingView(runStep(taken(boss, other.crown!), { type: 'bench', unitId: other.view.id, benched: true }))!;
    expect(benched.units.find((u) => u.king)!.view.id).not.toBe(other.view.id);
  });

  it('reads the injury die face by face as the rules do', () => {
    const tone = { dead: 'lost', wound: 'hurt', sitsOut: 'hurt', recovered: 'ok' } as const;
    expect(injuryFaces().map((f) => f.tone)).toEqual([1, 2, 3, 4, 5, 6].map((d) => tone[injuryFor(d)]));
  });

  it('throws a die for each unit that fell, and shows what came of it', () => {
    const s: RunState = JSON.parse(JSON.stringify(WON));
    const [first, ...rest] = s.aftermath!.units;
    s.aftermath!.units = [
      { ...first!, fate: 'fell', die: 1, injury: 'dead', look: 'Wolf' },
      { ...first!, unitId: 'x2', name: 'Bob', fate: 'fell', die: 2, injury: 'wound', wound: { kind: 'combat' } },
      { ...first!, unitId: 'x3', fate: 'fell', die: 5, injury: 'recovered' },
      ...rest.map((l) => ({ ...l, fate: 'survived' as const })),
    ];
    const checks = injuryChecks(s);
    expect(checks.map((c) => [c.die, c.tone])).toEqual([
      [1, 'lost'],
      [2, 'hurt'],
      [5, 'ok'],
    ]);
    expect(checks[0]!.look).toBe('Wolf');
    expect(checks[1]!.verdict).toBe('Wounded: Combat −1');
    expect(standingUnits(s)).toHaveLength(rest.length);
    expect(injuryChecks(WON).length).toBe(WON.aftermath!.units.filter((l) => l.fate === 'fell').length);
  });

  it('checks a new name against the rules', () => {
    const [a, b] = WON.roster;
    expect(renameError(WON, a!.id, 'Brave Sir Robin')).toBeNull();
    if (b) expect(renameError(WON, a!.id, b.unit.name)).not.toBeNull();
    expect(renameError(WON, a!.id, '')).not.toBeNull();
  });

  it('tells the battle\'s aftermath, and spends levels before moving on', () => {
    const view = aftermathView(WON)!;
    expect(view.gold).toBe(WON.aftermath!.gold);
    expect(view.lines).toHaveLength(WON.aftermath!.units.length);
    expect(view.lines.every((l) => l.text.length > 0)).toBe(true);
    let s = WON;
    for (let i = 0; i < 20 && aftermathView(s)!.levelUps.length > 0; i++) {
      const up = aftermathView(s)!.levelUps[0]!;
      expect(aftermathView(s)!.next.error).toBe('there are levels still to spend');
      expect(up.options.length).toBeGreaterThan(0);
      expect(up.options.every((o) => o.take.error === null && o.change.length > 0)).toBe(true);
      const before = s.roster.find((u) => u.id === up.view.id)!.level;
      s = taken(s, up.options[0]!.take);
      expect(s.roster.find((u) => u.id === up.view.id)!.level).toBe(before + 1);
    }
    expect(aftermathView(s)!.next.error).toBeNull();
    expect(taken(s, aftermathView(s)!.next).phase).toBe('reward');
  });

  it('marks the win of the victory round as the run\'s victory, and the run as won from then on', () => {
    expect(aftermathView(WON)!.triumph).toBeNull();
    expect(runHeader(WON)).toMatchObject({ title: 'Victory', victorious: false });

    // The same win, had it been the victory round's.
    const round = RUN_TUNING.victoryRound;
    const won: RunState = { ...WON, round, log: [{ ...WON.log[0]!, round }] };
    expect(aftermathView(won)!.triumph!.headline).toBe('The last boss is beaten: the run is won');
    expect(runHeader(won)).toMatchObject({ title: 'The run is won', victorious: true });

    // It is said once: the run goes on, marked as won, and keeps the mark when it ends.
    // (As if it had been the boss's node: the next act's map is drawn.)
    const next = playTo(playTo(won, 'shop'), 'briefing');
    expect(next.round).toBe(round + 1);
    expect(next.route!.act).toBe(3);
    expect(runHeader(next)).toMatchObject({ title: 'Briefing', victorious: true });
    expect(runMenuItem(next).detail).toBe(`Act 3 · step 1 of 7 · seed ${next.seed} · ♛ won`);
    const later: RunState = { ...WON, round: round + 1, log: [{ ...WON.log[0]!, round }, { ...WON.log[0]!, round: round + 1 }] };
    expect(aftermathView(later)!.triumph).toBeNull();
    expect(overView({ ...next, phase: 'over' })).toMatchObject({ victorious: true, headline: `A victorious run, ended at step ${round + 1}` });
  });

  it('words every fate', () => {
    const line = { unitId: 'u1', name: 'Wolf', kills: 0, xp: 1 };
    expect(fateText({ ...line, fate: 'survived' }).tone).toBe('ok');
    expect(fateText({ ...line, fate: 'fled' }).tone).toBe('ok');
    expect(fateText({ ...line, fate: 'turned' }).tone).toBe('lost');
    expect(fateText({ ...line, fate: 'fell', injury: 'dead' }).tone).toBe('lost');
    expect(fateText({ ...line, fate: 'fell', injury: 'sitsOut' }).tone).toBe('hurt');
    expect(fateText({ ...line, fate: 'fell', injury: 'recovered' }).tone).toBe('ok');
    expect(fateText({ ...line, fate: 'fell', injury: 'wound', wound: { kind: 'combat' } })).toEqual({
      text: 'Fell, and carries a lasting wound: Combat −1',
      tone: 'hurt',
    });
  });

  it("hands over the battle's reward, to a unit that can have it where it needs one", () => {
    expect(aftermathView(WON)!.rewards).toEqual((WON.offer as { rewards: RewardOption[] }).rewards.map(rewardLine));
    const s = playTo(WON, 'reward');
    const view = rewardView(s)!;
    expect(view.rewards.length).toBeGreaterThan(0);
    if (view.take) expect(taken(s, view.take).phase).toBe('shop');
    else {
      expect(view.targets!.length).toBeGreaterThan(0);
      for (const t of view.targets!) expect(taken(s, t.give).phase).toBe('shop');
    }

    // A boost goes to one unit, and only those that can learn it are offered.
    const boost: RunState = { ...s, offer: { kind: 'reward', rewards: [{ kind: 'boost', advance: { kind: 'combat' } }, { kind: 'gold', amount: 4 }], value: 10 } };
    const given = rewardView(boost)!;
    expect(given.take).toBeUndefined();
    expect(given.rewards.map((r) => r.title)).toEqual(['Combat +1', '4 gold']);
    const target = given.targets![0]!;
    expect(target.change).toMatch(/^Combat \d → \d$/);
    const after = taken(boost, target.give);
    expect(after.gold).toBe(boost.gold + 4);
    expect(after.roster.find((u) => u.id === target.unitId)!.unit.combat).toBe(target.unit.combat + 1);

    const purse: RunState = { ...s, offer: { kind: 'reward', rewards: [{ kind: 'gold', amount: 9 }], value: 9 } };
    expect(taken(purse, rewardView(purse)!.take!).gold).toBe(s.gold + 9);
  });

  it('keeps the field shop small: a recruit and mending, no fresh stock and no buyer', () => {
    const s = playTo(WON, 'shop');
    const view = shopView(s)!;
    expect(runHeader(s).title).toBe('After the battle');
    expect(view).toMatchObject({ market: false, reroll: null, upgrades: [], gold: s.gold });
    expect(view.recruits.filter((r) => r && r.price > 0)).toHaveLength(RUN_TUNING.fieldShop.recruits);
    expect(view.units.every((u, i) => u.sell === null && (u.heal === null) === !s.roster[i]!.wounds?.length)).toBe(true);
    for (const r of view.recruits) expect(r!.buy.error === null).toBe(r!.price <= s.gold);
    expect(taken(s, view.leave)).toMatchObject({ phase: 'map', round: 2 });
  });

  it('prices the market from the rules, and greys out what gold can\'t buy', () => {
    const field = playTo(WON, 'shop');
    // The same warband at a market: the full shelves.
    const s: RunState = { ...field, offer: shopStock(field, makeRunRandom(1, 1, 1), true) };
    const view = shopView(s)!;
    expect(runHeader(s).title).toBe('Market');
    expect(view.market).toBe(true);
    expect(view.gold).toBe(s.gold);
    expect(view.leave.error).toBeNull();
    expect(view.units).toHaveLength(s.roster.length);
    for (const r of view.recruits) expect(r!.buy.error === null).toBe(r!.price <= s.gold);
    for (const u of view.upgrades) for (const t of u!.targets) expect(t.give.error === null).toBe(t.price! <= s.gold);
    expect(view.reroll!.buy.error === null).toBe(view.reroll!.price <= s.gold);
    // Only a unit carrying a lasting wound can be healed.
    expect(view.units.every((u, i) => u.sell!.sell.error === null && (u.heal === null) === !s.roster[i]!.wounds?.length)).toBe(true);

    // A rich warband buys a recruit: the slot empties and the roster grows.
    const rich = { ...s, gold: 999 };
    const bought = taken(rich, shopView(rich)!.recruits[0]!.buy);
    expect(shopView(bought)!.recruits[0]).toBeNull();
    expect(bought.roster).toHaveLength(s.roster.length + 1);
    // And an upgrade for a unit that can take it.
    const upgrade = shopView(rich)!.upgrades.find((u) => u && u.targets.length > 0);
    if (upgrade) expect(shopView(taken(rich, upgrade.targets[0]!.give))!.upgrades).toContain(null);
    // A wounded unit can be healed, at the shop's price.
    const hurt: RunState = { ...rich, roster: rich.roster.map((u, i) => (i === 0 ? { ...u, unit: { ...u.unit, slow: true as const }, wounds: [{ kind: 'trait', trait: 'slow' }] } : u)) };
    const healing = shopView(hurt)!;
    expect(healing.units[0]!.view.wounds.map((w) => w.label)).toEqual(['Slow']);
    expect(taken(hurt, healing.units[0]!.heal!).gold).toBe(hurt.gold - healing.healPrice);
    // The last unit can't be sold.
    const last = { ...s, roster: s.roster.slice(0, 1) };
    expect(shopView(last)!.units[0]!.sell!.sell.error).toBe('the last unit cannot be sold');

    expect(taken(s, view.leave)).toMatchObject({ phase: 'map', round: 2 });
    // It is saved and read back as a market.
    expect(parseRun(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('sums up a run that is over', () => {
    const over = lostRun();
    const view = overView(over);
    expect(view.headline).toBe(`Your warband fell at step ${over.round}`);
    expect(view.summary).toContain(`seed ${over.seed}`);
    const history = historyLines(over);
    expect(history).toHaveLength(over.log.length);
    expect(history.at(-1)).toMatchObject({ round: over.round, won: false });
    expect(history.slice(0, -1).every((l) => l.won)).toBe(true);
  });

  it('names advances, wounds and levels', () => {
    const unit = { name: 'Wolf', quality: 4, combat: 3 };
    expect(advanceInfo({ kind: 'trait', trait: 'tough' }).label).toBe('Tough');
    expect(advanceChange(unit, { kind: 'combat' })).toBe('Combat 3 → 4');
    expect(advanceChange(unit, { kind: 'quality' })).toBe('Quality 4+ → 3+');
    expect(advanceChange(unit, { kind: 'trait', trait: 'fast' })).toBe('Gains Fast');
    expect(woundInfo({ kind: 'quality' }).label).toBe('Quality +1');
    const view = unitView({ id: 'u1', unit, xp: 4, level: 1, kills: 2 });
    expect(levelLine(view)).toBe(`Level 1 · 4/${RUN_TUNING.xp.levels[1]} XP`);
    expect(levelLine(unitView({ id: 'u1', unit, xp: 30, level: RUN_TUNING.xp.levels.length, kills: 9 }))).toBe(`Level ${RUN_TUNING.xp.levels.length} · 30 XP`);
  });

  it('labels the menu button and reads a typed seed', () => {
    expect(runMenuItem(null).title).toBe('Run');
    expect(runMenuItem({ ...newRun(42), round: 3 })).toEqual({ title: 'Continue run', detail: 'Act 1 · step 3 of 7 · seed 42' });
    expect(runSeedFrom('', 77)).toBe(77);
    expect(runSeedFrom(' 123 ', 77)).toBe(123);
    expect(runSeedFrom('abc', 77)).toBeNull();
    expect(runSeedFrom('1.5', 77)).toBeNull();
    expect(runSeedFrom('-3', 77)).toBeNull();
  });
});

describe('the stops', () => {
  /** The won run back on the map, set down at a stop of `offer`'s kind as if it had travelled there. */
  const stopped = (offer: NonNullable<RunState['offer']>, phase: RunPhase = 'stop'): RunState => {
    const map = playTo(WON, 'map');
    return { ...map, phase, offer, route: { ...map.route!, going: openNodes(map.route!)[0]! } };
  };

  it('names every kind of place, with a sign and a line on what waits there', () => {
    const kinds = ['battle', 'elite', 'market', 'camp', 'training', 'mystery', 'boss'] as const;
    expect(Object.keys(NODE_INFO).sort()).toEqual([...kinds].sort());
    expect(new Set(kinds.map((k) => NODE_INFO[k].glyph)).size).toBe(kinds.length);
    // Each has a picture of its own, vendored with the sprites and credited.
    const sprites = fileURLToPath(new URL('../public/sprites/', import.meta.url));
    expect(Object.keys(NODE_IMAGES).sort()).toEqual([...kinds].sort());
    expect(new Set(Object.values(NODE_IMAGES)).size).toBe(kinds.length);
    for (const kind of kinds) {
      expect(existsSync(sprites + NODE_IMAGES[kind]), NODE_IMAGES[kind]).toBe(true);
      expect(nodeImageUrl(kind, '/app/')).toBe(`/app/sprites/${NODE_IMAGES[kind]}`);
    }
    expect(readFileSync(sprites + 'CREDITS.md', 'utf8')).toMatch(/run map's places under `items\/` and `scenery\/`/);
    // A stop on the map says what it offers, and shows no skulls and no enemy.
    const map = playTo(WON, 'map');
    const id = openNodes(map.route!)[0]!;
    for (const kind of ['market', 'camp', 'training', 'mystery'] as const) {
      const route = { ...map.route!, nodes: map.route!.nodes.map((n) => (n.id === id ? { id: n.id, step: n.step, lane: n.lane, next: n.next, kind } : n)) };
      const node = routeView({ ...map, route })!.nodes[id]!;
      expect(node).toMatchObject({ kind, label: NODE_INFO[kind].label, glyph: NODE_INFO[kind].glyph, lines: [NODE_INFO[kind].help], state: 'open' });
      expect([node.skulls, node.look]).toEqual([undefined, undefined]);
    }
    const elite = { ...map.route!, nodes: map.route!.nodes.map((n) => (n.id === id ? { ...n, kind: 'elite' as const, threat: 1.5 } : n)) };
    const node = routeView({ ...map, route: elite })!.nodes[id]!;
    expect(node.skulls).toBe(RUN_TUNING.mission.skulls);
    expect(node.lines[0]).toBe('☠☠☠☠☠ Elite');
  });

  it('offers a camp its one choice, and says whether a rest would help', () => {
    // Nobody hurt, whatever the battle before did.
    const fit = stopped({ kind: 'camp' });
    const s: RunState = { ...fit, roster: fit.roster.map(({ sitsOut: _sitsOut, wounds: _wounds, ...u }) => u) };
    const view = campView(s)!;
    expect(runHeader(s).title).toBe('Camp');
    expect(view.taken).toBeNull();
    expect(view.rest).toMatchObject({ helps: false, detail: 'Nobody is hurt: a rest would change nothing.' });
    expect(view.rest.choose.error).toBeNull();
    expect(view.drill).toMatchObject({ xp: RUN_TUNING.camp.drillXp });
    expect(view.leave.error).toMatch(/rest or drill/);
    expect([shopView(s), trainingView(s), aftermathView(s)]).toEqual([null, null, null]);

    const hurt: RunState = { ...s, roster: s.roster.map((u, i) => (i === 0 ? { ...u, sitsOut: true, unit: { ...u.unit, slow: true as const }, wounds: [{ kind: 'trait', trait: 'slow' }] } : u)) };
    expect(campView(hurt)!.rest).toMatchObject({ helps: true });
    expect(campView(hurt)!.rest.detail).toMatch(/^1 unit carries a lasting wound, and 1 sits out the next battle/);
    const rested = taken(hurt, campView(hurt)!.rest.choose);
    expect(campView(rested)).toMatchObject({ taken: 'rest', levelUps: [] });
    expect(campView(rested)!.rest.choose.error).toMatch(/already spent/);
    expect(taken(rested, campView(rested)!.leave)).toMatchObject({ phase: 'map', round: s.round + 1 });

    // A drill that brings a level has it spent in camp, before the road goes on.
    const near: RunState = { ...s, roster: s.roster.map((u) => ({ ...u, level: 0, xp: RUN_TUNING.xp.levels[0]! - 1 })) };
    const drilled = taken(near, campView(near)!.drill.choose);
    const ups = campView(drilled)!;
    expect(ups.taken).toBe('drill');
    expect(ups.levelUps.length).toBeGreaterThan(0);
    expect(ups.leave.error).toBe('there are levels still to spend');
    expect(taken(drilled, ups.levelUps[0]!.options[0]!.take).roster.find((u) => u.id === ups.levelUps[0]!.view.id)!.level).toBe(1);

    for (const state of [s, rested, drilled]) expect(parseRun(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(() => parseRun(JSON.parse(JSON.stringify({ ...s, offer: { kind: 'camp', taken: 'feast' } })))).toThrow();
    expect(() => parseRun(JSON.parse(JSON.stringify({ ...s, offer: undefined })))).toThrow(/nothing on offer/);
    expect(() => parseRun(JSON.parse(JSON.stringify({ ...s, route: { ...s.route!, going: undefined } })))).toThrow(/nowhere on the map/);
  });

  it('trains one unit: who may train, then what it may learn', () => {
    const s = stopped({ kind: 'training' });
    const view = trainingView(s)!;
    expect(runHeader(s).title).toBe('Training ground');
    expect(view).toMatchObject({ prize: false, trainee: null });
    expect(view.units!.map((u) => u.view.id)).toEqual(s.roster.map((u) => u.id));
    expect(view.units!.every((u) => u.train.error === null)).toBe(true);
    expect(view.leave.error).toBeNull();
    expect(taken(s, view.leave).phase).toBe('map');
    expect(campView(s)).toBeNull();

    const named = taken(s, view.units![0]!.train);
    const choosing = trainingView(named)!;
    expect(choosing.units).toBeNull();
    expect(choosing.trainee!.view.id).toBe(s.roster[0]!.id);
    expect(choosing.trainee!.options.length).toBeGreaterThan(0);
    expect(choosing.trainee!.options.length).toBeLessThanOrEqual(RUN_TUNING.training.choices);
    expect(choosing.trainee!.options.every((o) => o.take.error === null && o.change.length > 0)).toBe(true);
    expect(choosing.leave.error).toMatch(/yet to choose/);
    const done = taken(named, choosing.trainee!.options[0]!.take);
    expect(done).toMatchObject({ phase: 'map', round: s.round + 1 });
    expect(unitCost(done.roster[0]!.unit)).toBeGreaterThanOrEqual(unitCost(s.roster[0]!.unit));
    expect(done.roster[0]!.level).toBe(s.roster[0]!.level);

    // An elite's prize is the same training, with the field shop after it.
    const prize = stopped({ kind: 'training', then: 'shop' });
    expect(trainingView(prize)!.prize).toBe(true);
    expect(taken(prize, trainingView(prize)!.leave).phase).toBe('shop');

    for (const state of [s, named, prize]) expect(parseRun(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(() => parseRun(JSON.parse(JSON.stringify({ ...named, offer: { ...named.offer, unitId: 'nobody' } })))).toThrow();
    expect(() => parseRun(JSON.parse(JSON.stringify({ ...named, offer: { kind: 'training', unitId: s.roster[0]!.id } })))).toThrow();
  });

  it('tells a mystery\'s event: the tale, the ways to take it, and what came of the one taken', () => {
    for (const event of RUN_EVENT_IDS) {
      const base = { ...stopped({ kind: 'camp' }), gold: 200, banners: 1 };
      const s: RunState = { ...base, offer: stageEvent(event, base, makeRunRandom(3, 1, 7)) };
      const view = eventView(s)!;
      expect(runHeader(s).title).toBe(view.title);
      expect(view.title).toMatch(/^The /);
      expect(view.text.length).toBeGreaterThan(60);
      expect(view.result).toBeNull();
      expect(view.leave.error).toMatch(/still to be settled/);
      expect(view.choices.length).toBeGreaterThanOrEqual(2);
      expect([campView(s), trainingView(s), shopView(s)]).toEqual([null, null, null]);
      expect(Boolean(view.unit)).toBe(event === 'sellsword' || event === 'deserters');
      expect(parseRun(JSON.parse(JSON.stringify(s)))).toEqual(s);

      view.choices.forEach((c, i) => {
        // A choice is one button, or a button per unit it could be done to.
        expect(c.take === null).toBe(c.targets !== null);
        if (c.targets) expect(c.targets.map((t) => t.unitId)).toEqual(s.roster.map((u) => u.id));
        const go = c.take ?? c.targets![0]!.give;
        expect(go.error, `${event} choice ${i}`).toBeNull();
        const after = taken(s, go);
        if (event === 'ambush' && i === 0) {
          // Fighting through leads to a briefing with nothing to win but the road.
          expect(after.phase).toBe('briefing');
          expect(briefingView(after)!.rewards).toEqual([]);
          return;
        }
        const done = eventView(after)!;
        expect(done.result!.text.length).toBeGreaterThan(10);
        expect(done.result!.die === null).toBe(!(event === 'cache' && i === 1));
        expect(done.leave.error).toBeNull();
        expect(taken(after, done.leave)).toMatchObject({ phase: 'map', round: s.round + 1 });
        expect(parseRun(JSON.parse(JSON.stringify(after)))).toEqual(after);
      });
    }
    const s = stopped({ kind: 'event', event: 'cache', gold: 12 });
    expect(eventView({ ...s, gold: 0 })!.choices.every((c) => c.take!.error === null)).toBe(true);
    expect(() => parseRun(JSON.parse(JSON.stringify({ ...s, offer: { kind: 'event', event: 'feast' } })))).toThrow();
    expect(() => parseRun(JSON.parse(JSON.stringify({ ...s, offer: { kind: 'event', event: 'cache', gold: -1 } })))).toThrow();
    expect(() => parseRun(JSON.parse(JSON.stringify({ ...s, offer: { kind: 'event', event: 'sellsword', unit: { name: 'Ghost' }, price: 3 } })))).toThrow();
  });

  it('says so when a won fight had no reward at stake', () => {
    // The won run's aftermath, had the battle been an ambush.
    const s: RunState = { ...WON, offer: undefined, aftermath: { ...WON.aftermath!, plain: true } };
    const view = aftermathView(s)!;
    expect(view).toMatchObject({ plain: true, rewards: [], retreat: null });
    expect(aftermathView(WON)!.plain).toBe(false);
    const on = playTo(s, 'shop');
    expect(shopView(on)!.market).toBe(false);
    const saved = { ...s, pending: undefined };
    expect(parseRun(JSON.parse(JSON.stringify(saved)))).toEqual(JSON.parse(JSON.stringify(saved)));
    expect(() => parseRun(JSON.parse(JSON.stringify({ ...saved, aftermath: { ...WON.aftermath!, plain: 'yes' } })))).toThrow();
  });

  it('sells a retreat banner at a market only', () => {
    const field = playTo(WON, 'shop');
    expect(shopView(field)!.banner).toBeNull();
    const s: RunState = { ...field, gold: 100, banners: 1, offer: shopStock(field, makeRunRandom(1, 1, 1), true) };
    const { banner } = shopView(s)!;
    expect(banner).toMatchObject({ price: RUN_TUNING.market.banner, held: 1, max: RUN_TUNING.banners.max });
    const bought = taken(s, banner!.buy);
    expect([bought.banners, bought.gold]).toEqual([2, 100 - RUN_TUNING.market.banner]);
    expect(runHeader(bought).banners).toBe(2);
    expect(shopView({ ...s, gold: 0 })!.banner!.buy.error).toMatch(/costs/);
    expect(shopView({ ...s, banners: RUN_TUNING.banners.max })!.banner!.buy.error).toMatch(/at most/);
  });
});

describe('the run buttons', () => {
  it("ignore a double click's second click", () => {
    const counts = repeatGuard(400);
    expect(counts(1000)).toBe(true);
    expect(counts(1150)).toBe(false);
    // A click that was ignored doesn't hold the next one back.
    expect(counts(1450)).toBe(true);
    expect(counts(1500)).toBe(false);
  });
});
