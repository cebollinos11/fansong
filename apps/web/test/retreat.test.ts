import { describe, expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import {
  injuryFor,
  legalRunActions,
  newRun,
  runBattleConfig,
  runMapLookup,
  runMatchSetup,
  runStep,
  RUN_TUNING,
  type RunState,
} from '@fansong/content';
import { createGame, getLegalCommands, makeHexGrid, reduce, type Command, type GameConfig, type GameEvent, type GameState } from '@fansong/engine';
import { LocalMatchClient } from '../src/game/client.js';
import type { MapStorage } from '../src/game/customMaps.js';
import { EFFECT_DEMOS, stageDemo } from '../src/game/effectDemos.js';
import { deriveInteraction } from '../src/game/interaction.js';
import { loadRun, parseRun, runRecord, saveRun } from '../src/game/runStore.js';
import { soundScene } from '../src/game/soundScenes.js';
import { SFX_CUES } from '../src/audio/sfxCues.js';
import { ZONE_COLORS } from '../src/ui/editorView.js';
import { outcomeWord, RETREAT_PROMPT } from '../src/ui/hudView.js';
import { appendEvents, emptyLog, itemText } from '../src/ui/log.js';
import { modeMarkers, modeMarkingsKey, modeOverlays } from '../src/ui/modeView.js';
import {
  aftermathView,
  briefingView,
  fateText,
  historyLines,
  injuryChecks,
  injuryFaces,
  overView,
  recordLine,
  retreatNote,
  runHeader,
  standingUnits,
} from '../src/ui/runView.js';

const config: GameConfig = {
  seed: 5,
  board: { width: 14, height: 10 },
  warbands: [
    [
      { name: 'Chief', quality: 2, combat: 3, leader: true, pos: { x: 2, y: 2 } },
      { name: 'Spear', quality: 3, combat: 3, pos: { x: 2, y: 3 } },
    ],
    [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 13, y: 2 } }],
  ],
  retreatZones: [[{ x: 0, y: 2 }], []],
};

/** `unitId` mid-activation with three actions in hand, the dice skipped. */
function acting(state: GameState, unitId: string): GameState {
  const s = structuredClone(state);
  s.units.find((u) => u.id === unitId)!.activatedThisRound = true;
  return { ...s, active: 0, phase: 'acting', activeUnitId: unitId, actionsRemaining: 3 };
}

const CALL: Command = { type: 'Retreat', unitId: 'p0u0' };
const called = (): { state: GameState; events: GameEvent[] } => reduce(acting(createGame(config), 'p0u0'), CALL);
const walk = (state: GameState, unitId: string) => reduce(acting(state, unitId), { type: 'Move', unitId, to: { x: 0, y: 2 } });

function memoryStorage(): MapStorage {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

/** The AI in both seats, but the player's Leader sounds the retreat at once and then everyone (or only the Leader) walks for the flag. */
function retreating(runFor: 'all' | 'leader') {
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
    let gap = board.distance(unit.pos, flag);
    for (const c of legal) {
      if (c.type === 'Move' && board.distance(c.to, flag) < gap) [best, gap] = [c, board.distance(c.to, flag)];
    }
    return best;
  };
}

function toBattle(seed: number): RunState {
  let s = newRun(seed);
  for (let i = 0; i < 200 && s.phase !== 'battle'; i++) {
    const legal = legalRunActions(s);
    s = runStep(s, legal.find((a) => a.type === 'startBattle') ?? legal[0]!);
  }
  return s;
}

/** A run's first battle, played to a retreat that leaves someone behind, and the run just after it. */
function retreatedRun(): { battle: RunState; after: RunState } {
  for (let seed = 1; seed < 60; seed++) {
    const battle = toBattle(seed);
    const client = new LocalMatchClient(runMatchSetup(battle), runMapLookup(battle), runBattleConfig(battle));
    try {
      const pilot = retreating('leader');
      for (let i = 0; i < 20_000 && client.getState().phase !== 'gameOver'; i++) {
        // The client's own AI plays seat 1; this plays the human's seat through the client.
        if (client.getState().active === 0) client.send(pilot(client.getState()));
        else client.send(chooseCommand(client.getState()));
      }
      const final = client.getState();
      if (final.phase !== 'gameOver' || final.winner !== 1 || final.retreat?.owner !== 0) continue;
      const after = runStep(battle, { type: 'battleResult', replay: client.getReplay() });
      if (after.phase !== 'aftermath' || !after.aftermath!.units.some((l) => l.fate === 'leftBehind')) continue;
      return { battle, after };
    } finally {
      client.dispose();
    }
  }
  throw new Error('no seed gave a retreat with someone left behind');
}

describe('retreat in a battle', () => {
  it('offers the Retreat button only while the engine offers the command', () => {
    const s = acting(createGame(config), 'p0u0');
    expect(deriveInteraction(getLegalCommands(s)).canRetreat).toBe(true);
    expect(deriveInteraction(getLegalCommands(acting(createGame(config), 'p0u1'))).canRetreat).toBe(false);
    expect(deriveInteraction(getLegalCommands(called().state)).canRetreat).toBe(false);
    expect(deriveInteraction(getLegalCommands(acting(createGame({ ...config, retreatZones: undefined }), 'p0u0'))).canRetreat).toBe(false);
  });

  it('asks before it is sounded, in the plan\'s own words', () => {
    expect(RETREAT_PROMPT.title).toBe('Sound the retreat?');
    expect(RETREAT_PROMPT.detail).toMatch(/This battle is lost\..*leave unhurt.*may not come back/);
  });

  it('stands the flag on its hex, lit in its side\'s colour, from the state alone', () => {
    const before = createGame(config);
    expect(modeMarkers(before)).toEqual([]);
    expect(modeOverlays(before)).toEqual([]);
    const { state } = called();
    expect(modeMarkers(state)).toEqual([{ kind: 'flag', owner: 0, cell: { x: 0, y: 2 } }]);
    expect(modeOverlays(state)).toEqual([expect.objectContaining({ cells: [{ x: 0, y: 2 }], color: ZONE_COLORS.deploy[0] })]);
    expect(modeMarkingsKey(state)).not.toBe(modeMarkingsKey(before));
    // A game restored from a saved state shows it too: nothing hangs on the event.
    expect(modeMarkers(JSON.parse(JSON.stringify(state)) as GameState)).toHaveLength(1);
  });

  it('tells the call and each unit leaving in the log, and how the game ended', () => {
    const call = called();
    const left = walk(call.state, 'p0u1');
    const end = walk(left.state, 'p0u0');
    let log = appendEvents(emptyLog(), call.state, call.events);
    log = appendEvents(log, left.state, left.events);
    log = appendEvents(log, end.state, end.events);
    const lines = log.rounds.flatMap((r) => r.groups.flatMap((g) => g.items.map((i) => itemText(i, ['You', 'AI']))));
    expect(lines).toContain('🏳 Chief sounds the retreat: the flag goes up');
    expect(lines).toContain('🏳 Spear reaches the flag and leaves the field');
    expect(lines.at(-1)).toBe('🏆 Game over — AI wins (the retreat was sounded)');
  });

  it('calls a battle given up "Retreated", not a defeat', () => {
    const end = walk(called().state, 'p0u0').state;
    expect(outcomeWord(end, [0])).toBe('Retreated.');
    expect(outcomeWord({ ...end, retreat: undefined }, [0])).toBe('Defeat.');
    expect(outcomeWord(end, [1])).toBe('Victory!');
    expect(outcomeWord(end, [0, 1])).toBe('Retreated.');
    expect(outcomeWord({ ...end, retreat: undefined }, [0, 1])).toBeNull();
    expect(outcomeWord(createGame(config), [0])).toBeNull();
  });

  it('has a recording, a demo and a scene behind each of its sounds', () => {
    for (const [cue, demo] of [
      ['retreat-horn', 'retreat'],
      ['unit-retreats', 'retreatLeave'],
    ] as const) {
      const entry = SFX_CUES.find((c) => c.name === cue)!;
      expect(entry.fallback).toBeDefined();
      expect(SFX_CUES.some((c) => c.name === entry.fallback)).toBe(true);
      expect(soundScene(cue)).toBe(EFFECT_DEMOS.find((d) => d.id === demo));
    }
    const staged = (id: string) => {
      const { state, command } = stageDemo(createGame({ ...config, warbands: [[], []], retreatZones: undefined }), id);
      return reduce(state, command);
    };
    expect(staged('retreat').events.map((e) => e.type)).toContain('RetreatCalled');
    const leave = staged('retreatLeave');
    expect(leave.events.map((e) => e.type)).toContain('UnitRetreated');
    expect(leave.state.phase).not.toBe('gameOver');
    // A demo staged after it starts clean: no flag left standing.
    const next = stageDemo(leave.state, 'kill').state;
    expect([next.retreat, next.retreatZones]).toEqual([undefined, undefined]);
  });
});

describe('retreat in a run', () => {
  const { battle, after } = retreatedRun();

  it('plays the run\'s own config, retreat zone and all, and restarts the same', () => {
    const client = new LocalMatchClient(runMatchSetup(battle), runMapLookup(battle), runBattleConfig(battle));
    expect(client.getState().retreatZones?.[0]).toEqual(battle.battle!.map.deployZones[0]);
    expect(client.getReplay().config).toEqual(runBattleConfig(battle));
    client.dispose();
    // Left midway and reloaded, the banner is still in hand and the battle is as it began.
    const storage = memoryStorage();
    saveRun(storage, battle);
    const loaded = loadRun(storage)!;
    expect(loaded.banners).toBe(RUN_TUNING.banners.start);
    expect(runBattleConfig(loaded)).toEqual(runBattleConfig(battle));
  });

  it('shows the banners in hand on the header and the briefing', () => {
    expect(runHeader(battle).banners).toBe(1);
    expect(runHeader(after).banners).toBe(0);
    expect(runHeader(after).title).toBe('Retreat');
    const briefing = toBriefing(after);
    expect(briefingView(briefing)!.retreat).toEqual({ banners: 0, note: retreatNote(0) });
    expect(retreatNote(0)).toMatch(/run is over/);
    expect(retreatNote(1)).toMatch(/^1 retreat banner in hand/);
    expect(retreatNote(2)).toMatch(/^2 retreat banners in hand/);
  });

  it('tells the retreat\'s aftermath: no pay, the dice of the fallen and of those left behind', () => {
    const view = aftermathView(after)!;
    expect(view.retreat).toEqual({ round: 1, left: 0 });
    expect([view.gold, view.rewards, view.levelUps, view.triumph]).toEqual([0, [], [], null]);
    expect(view.lines.every((l) => l.xp === 0)).toBe(true);
    expect(view.next.error).toBeNull();
    expect(runStep(after, view.next.action).phase).toBe('shop');

    const lines = after.aftermath!.units;
    const checks = injuryChecks(after);
    expect(checks.map((c) => c.unitId)).toEqual(lines.filter((l) => l.die !== undefined).map((l) => l.unitId));
    for (const check of checks) {
      const line = lines.find((l) => l.unitId === check.unitId)!;
      expect(check.leftBehind).toBe(line.fate === 'leftBehind');
      const rolled = injuryFor(check.die, check.leftBehind ? RUN_TUNING.leftBehind : RUN_TUNING.injury);
      expect(check.tone).toBe(line.injury === 'dead' ? 'lost' : line.injury === 'recovered' ? 'ok' : 'hurt');
      if (rolled !== 'wound') expect(line.injury).toBe(rolled);
      expect(fateText(line).text).toMatch(check.leftBehind ? /^Left behind/ : /^Fell/);
    }
    expect(checks.some((c) => c.leftBehind)).toBe(true);
    const got = lines.filter((l) => l.fate === 'retreated');
    expect(got.length).toBeGreaterThan(0);
    for (const line of got) expect(fateText(line)).toEqual({ text: 'Reached the flag, and left unhurt', tone: 'ok' });
    expect(standingUnits(after).map((u) => u.name)).toEqual(lines.filter((l) => l.die === undefined && l.fate !== 'turned').map((l) => l.name));
  });

  it('shows the harsher odds of a unit left behind, face by face', () => {
    const tone = { dead: 'lost', wound: 'hurt', sitsOut: 'hurt', recovered: 'ok' } as const;
    expect(injuryFaces(true).map((f) => f.tone)).toEqual([1, 2, 3, 4, 5, 6].map((d) => tone[injuryFor(d, RUN_TUNING.leftBehind)]));
    expect(injuryFaces(true).filter((f) => f.label === 'Dies')).toHaveLength(3);
    expect(injuryFaces().filter((f) => f.label === 'Dies')).toHaveLength(1);
  });

  it('saves and loads a retreat at its aftermath and its shop, and reads a save from before banners', () => {
    const storage = memoryStorage();
    const shop = runStep(after, { type: 'continue' });
    for (const s of [after, shop, runStep(shop, { type: 'leaveShop' })]) {
      expect(saveRun(storage, s)).toBe(true);
      expect(loadRun(storage)).toEqual(s);
    }
    const { banners: _banners, ...old } = battle;
    expect(parseRun(JSON.parse(JSON.stringify(old))).banners).toBe(RUN_TUNING.banners.start);
    expect(() => parseRun({ ...JSON.parse(JSON.stringify(after)), banners: -1 })).toThrow();
    expect(() => parseRun({ ...JSON.parse(JSON.stringify(after)), offer: shop.offer })).toThrow(/retreat/);
    // An ordinary aftermath is still owed its reward.
    expect(() => parseRun({ ...JSON.parse(JSON.stringify(after)), aftermath: { ...after.aftermath, retreated: undefined } })).toThrow();
  });

  it('keeps the round, and records the retreat in the history and the records', () => {
    const again = runStep(runStep(after, { type: 'continue' }), { type: 'leaveShop' });
    expect([again.phase, again.round]).toEqual(['mission', 1]);
    expect(historyLines(after).map((l) => [l.round, l.won])).toEqual([[1, false]]);
    expect(historyLines(after)[0]!.text).toMatch(/: retreated/);
    const over: RunState = { ...after, phase: 'over' };
    expect(overView(over).summary).toMatch(/0 battles won · 1 retreat · /);
    expect(overView({ ...over, roster: [] }).headline).toBe('Nobody came back from the retreat in round 1');
    const record = runRecord(over, 'lost', 1);
    expect(record.retreats).toBe(1);
    expect(recordLine(record)).toMatch(/0 battles won · 1 retreat · fell in round 1/);
    expect(runRecord(battle, 'abandoned', 1).retreats).toBeUndefined();
  });
});

function toBriefing(s: RunState): RunState {
  for (let i = 0; i < 50 && s.phase !== 'briefing'; i++) {
    const legal = legalRunActions(s);
    s = runStep(s, legal.find((a) => ['continue', 'leaveShop', 'pickMission'].includes(a.type)) ?? legal[0]!);
  }
  return s;
}
