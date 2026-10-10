import { createGame } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import {
  fieldedUnits,
  generateBattle,
  legalRunActions,
  newRun,
  openNodes,
  playerWarband,
  rewardValue,
  RUN_TUNING,
  runActionError,
  runBattleConfig,
  runMapLookup,
  runMatchSetup,
  runStep,
  runVictorious,
  type RunAction,
  type RunState,
} from '../../src/index.js';
import { atStep, autoUntil, checkState, drafted, inBattle, onMap, playBattle } from './helpers.js';

/**
 * Play a run with the AI in both seats, taking legal action `pick` of those on
 * offer, until it is lost or `rounds` steps are behind it. Returns every state passed through.
 */
function playRun(seed: number, rounds: number, pick: (actions: RunAction[], step: number) => RunAction): RunState[] {
  let s = newRun(seed);
  const states = [s];
  for (let step = 0; step < 2000 && s.phase !== 'over' && s.round <= rounds; step++) {
    const action: RunAction = s.phase === 'battle' ? { type: 'battleResult', replay: playBattle(s) } : pick(legalRunActions(s), step);
    s = runStep(s, action);
    states.push(s);
  }
  return states;
}
const first = (actions: RunAction[]) => actions[0]!;
/** Anything legal, but never dithering in the briefing or the shop. */
const varied = (actions: RunAction[], step: number) => {
  const moving = actions.filter((a) => !['bench', 'setKing', 'sell', 'reroll'].includes(a.type));
  return moving[(step * 7 + 3) % moving.length]!;
};

describe('a run', () => {
  it('is the same for the same seed and the same choices', () => {
    for (const pick of [first, varied]) {
      const a = playRun(12, 2, pick);
      expect(playRun(12, 2, pick)).toEqual(a);
      expect(playRun(13, 2, pick).slice(0, 3)).not.toEqual(a.slice(0, 3));
    }
  });

  it('holds its invariants through every phase', () => {
    const seen = new Set<string>();
    let won = 0;
    for (let seed = 20; seed < 32; seed++) {
      const states = playRun(seed, 3, seed % 2 ? first : varied);
      for (const s of states) {
        checkState(s);
        seen.add(s.phase);
      }
      const last = states.at(-1)!;
      won += last.log.filter((r) => r.won).length;
      // A step is logged once, when its battle is settled; the run only goes up.
      const steps = last.log.map((r) => r.round);
      expect(steps).toEqual([...new Set(steps)].sort((a, b) => a - b));
      if (last.phase === 'over') {
        expect(last.log.at(-1)!.won).toBe(false);
        expect(legalRunActions(last)).toEqual([]);
      }
      // Gold only comes from winning.
      if (!last.log.some((r) => r.won)) expect(last.gold).toBe(0);
    }
    expect(won).toBeGreaterThan(0);
    expect([...seen]).toEqual(expect.arrayContaining(['aftermath', 'battle', 'briefing', 'draft', 'map', 'over', 'reward', 'shop']));
  });

  it("meets the same enemies whatever the player's choices", () => {
    const map = onMap(77);
    for (const nodeId of openNodes(map.route!)) {
      const s = runStep(map, { type: 'travel', nodeId });
      const node = s.route!.nodes[nodeId]!;
      const { enemy, ...ground } = generateBattle(77, 1, node, s.roster.length);
      expect(s.battle).toMatchObject({ ...ground, enemy: enemy.warband, faction: node.faction, threat: enemy.threat });
      // A bigger roster changes the size of the field, not who stands on it.
      expect(generateBattle(77, 1, node, s.roster.length + 5).enemy).toEqual(enemy);
    }
    expect(drafted(77)).toEqual(drafted(77));
  });

  it('builds the battle once, so a battle left midway restarts the same', () => {
    const s = inBattle(31);
    const setup = runMatchSetup(s);
    expect(setup.seats).toEqual(['human', 'ai']);
    expect(setup.warbands![0]).toEqual(playerWarband(s));
    expect(setup.warbands![1]).toEqual(s.battle!.enemy);
    expect(runMapLookup(s)(setup.mapId!)).toEqual(s.battle!.map);
    expect(runMapLookup(s)('open-field')!.id).toBe('open-field');
    const saved = JSON.parse(JSON.stringify(s)) as RunState;
    expect(runBattleConfig(saved)).toEqual(runBattleConfig(s));
    const game = createGame(runBattleConfig(s));
    expect(game.units.filter((u) => u.owner === 0).map((u) => u.name)).toEqual(fieldedUnits(s).map((u) => u.unit.name));
    expect(() => runMatchSetup(drafted(31))).toThrow();
  });

  it('ends on a lost battle and goes to the aftermath on a won one', () => {
    let lost = 0;
    let won = 0;
    for (let seed = 40; seed < 52 && (lost === 0 || won === 0); seed++) {
      const s = inBattle(seed);
      const replay = playBattle(s);
      const next = runStep(s, { type: 'battleResult', replay });
      if (next.phase === 'over') {
        lost++;
        expect(next.log).toMatchObject([{ round: 1, won: false, gold: 0 }]);
        expect(next.roster).toEqual(s.roster);
        expect(runVictorious(next)).toBe(false);
      } else {
        won++;
        expect(next.phase).toBe('aftermath');
        expect(next.gold).toBeGreaterThan(0);
        expect(next.aftermath!.gold).toBe(next.gold);
        // A replay of some other battle is turned away.
        expect(() => runStep(inBattle(seed + 100), { type: 'battleResult', replay })).toThrow(/not of this round/);
        // The field shop is a small one, and leads back to the map, a step on.
        const shop = autoUntil(next, 'shop');
        if (shop.offer?.kind !== 'shop') throw new Error('no shop');
        expect(shop.offer.market).toBeUndefined();
        expect(shop.offer.upgrades).toHaveLength(RUN_TUNING.fieldShop.upgrades);
        expect(shop.offer.recruits.filter((u) => u && u.name !== 'Eager Cadet')).toHaveLength(RUN_TUNING.fieldShop.recruits);
        expect(legalRunActions(shop).some((a) => a.type === 'reroll' || a.type === 'sell')).toBe(false);
        expect(runActionError(shop, { type: 'reroll' })).toMatch(/only a market/);
        expect(runActionError(shop, { type: 'sell', unitId: shop.roster[0]!.id })).toMatch(/only a market/);
        const step2 = runStep(shop, { type: 'leaveShop' });
        expect([step2.round, step2.phase, step2.rolls, step2.offer]).toEqual([2, 'map', 0, undefined]);
        expect(step2.route).toMatchObject({ at: s.route!.going, path: [s.route!.going] });
        expect(openNodes(step2.route!)).toEqual(s.route!.nodes[s.route!.going!]!.next);
      }
    }
    expect([lost > 0, won > 0]).toEqual([true, true]);
  });

  it('counts the run as won once the victory round is beaten', () => {
    const s = newRun(1);
    expect(runVictorious(s)).toBe(false);
    const entry = { mode: 'annihilation' as const, enemy: 'x', boss: true, kills: 0, losses: 0, gold: 0 };
    expect(runVictorious({ ...s, log: [{ ...entry, round: RUN_TUNING.victoryRound, won: false }] })).toBe(false);
    expect(runVictorious({ ...s, log: [{ ...entry, round: RUN_TUNING.victoryRound, won: true }] })).toBe(true);
  });
});

describe('the map', () => {
  it('lets the run travel to an open node only, and meets the battle that node showed', () => {
    const s = onMap(8);
    const route = s.route!;
    const open = openNodes(route);
    expect(open.length).toBeGreaterThanOrEqual(2);
    expect(legalRunActions(s)).toEqual(open.map((nodeId) => ({ type: 'travel', nodeId })));
    const boss = route.nodes.at(-1)!;
    expect(runActionError(s, { type: 'travel', nodeId: boss.id })).toMatch(/road does not lead/);
    expect(runActionError(s, { type: 'travel', nodeId: 99 })).toMatch(/road does not lead/);
    expect(runActionError(s, { type: 'startBattle' })).not.toBeNull();
    for (const nodeId of open) {
      const node = route.nodes[nodeId]!;
      const there = runStep(s, { type: 'travel', nodeId });
      expect(there.phase).toBe('briefing');
      expect(there.offer).toBeUndefined();
      expect(there.route).toEqual({ ...route, going: nodeId });
      expect(there.battle).toMatchObject({ faction: node.faction, mode: node.mode });
      expect(there.battle!.rewardValue).toBe(rewardValue(1, there.battle!.threat));
      // The kind of pay the map showed, when the roster can take it.
      const kinds = there.battle!.rewards.map((r) => r.kind);
      if (node.rewardKind !== 'mend') expect(kinds.includes(node.rewardKind!) || kinds.every((k) => k === 'gold')).toBe(true);
      // Nowhere else to go until this is done.
      expect(runActionError(there, { type: 'travel', nodeId: open[0]! })).not.toBeNull();
    }
  });

  it('draws a new map once the boss is beaten', () => {
    const boss = RUN_TUNING.enemy.bossEvery;
    const s = atStep(8, boss);
    const there = runStep(s, legalRunActions(s)[0]!);
    // As if the boss were beaten and paid: the field shop after it.
    const shop: RunState = { ...there, phase: 'shop', offer: { kind: 'shop', recruits: [], upgrades: [], rerolls: 0 } };
    delete shop.battle;
    const act2 = runStep(shop, { type: 'leaveShop' });
    expect([act2.round, act2.phase]).toEqual([boss + 1, 'map']);
    expect(act2.route).toMatchObject({ act: 2, at: null, path: [], closed: [] });
    expect(act2.route!.nodes).not.toEqual(s.route!.nodes);
    for (const id of openNodes(act2.route!)) expect(act2.route!.nodes[id]!.step).toBe(boss + 1);
  });
});

describe('the reward', () => {
  it('pays what the battle showed once it is won, or its worth in gold if nobody is left to take it', () => {
    let checked = 0;
    for (let seed = 40; seed < 60 && checked < 3; seed++) {
      const s = inBattle(seed);
      const { rewards, rewardValue: value } = s.battle!;
      const won = runStep(s, { type: 'battleResult', replay: playBattle(s) });
      if (won.phase !== 'aftermath') continue;
      checked++;
      expect(won.offer).toEqual({ kind: 'reward', rewards, value });
      const owed = autoUntil(won, 'reward');
      const gold = owed.gold;
      const size = owed.roster.length;
      const paid = runStep(owed, legalRunActions(owed)[0]!);
      expect(paid.phase).toBe('shop');
      const purse = (owed.offer as { rewards: typeof rewards }).rewards.reduce((sum, r) => sum + (r.kind === 'gold' ? r.amount : 0), 0);
      expect(paid.gold).toBe(gold + purse);
      expect(paid.roster.length).toBe(size + (rewards.some((r) => r.kind === 'recruit') ? 1 : 0));

      // A boost nobody can take any more turns to gold.
      const stuck = clone(won);
      delete stuck.pending;
      stuck.offer = { kind: 'reward', rewards: [{ kind: 'mend' }, { kind: 'gold', amount: 3 }], value: 13 };
      for (const u of stuck.roster) delete u.wounds;
      const turned = runStep(stuck, { type: 'continue' });
      expect(turned.offer).toEqual({ kind: 'reward', rewards: [{ kind: 'gold', amount: 13 }], value: 13 });
      expect(legalRunActions(turned)).toEqual([{ type: 'reward' }]);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('the briefing', () => {
  it('benches units, but always leaves someone to fight', () => {
    let s = drafted(8);
    const ids = s.roster.map((u) => u.id);
    for (const unitId of ids.slice(1)) s = runStep(s, { type: 'bench', unitId, benched: true });
    expect(fieldedUnits(s).map((u) => u.id)).toEqual([ids[0]]);
    expect(runActionError(s, { type: 'bench', unitId: ids[0]!, benched: true })).toMatch(/someone/);
    s = runStep(s, { type: 'bench', unitId: ids[1]!, benched: false });
    expect(fieldedUnits(s).map((u) => u.id)).toEqual(ids.slice(0, 2));
    expect(runStep(s, { type: 'startBattle' }).battle!.fielded).toEqual(ids.slice(0, 2));
  });

  it('keeps a unit that sits out off the field, unless nobody else is left', () => {
    const s = drafted(8);
    s.roster[0]!.sitsOut = true;
    expect(fieldedUnits(s).map((u) => u.id)).toEqual(s.roster.slice(1).map((u) => u.id));
    for (const u of s.roster) u.sitsOut = true;
    expect(fieldedUnits(s)).toHaveLength(s.roster.length);
  });

  it('lets the player choose a King at the boss only', () => {
    const regular = drafted(8);
    expect(runActionError(regular, { type: 'setKing', unitId: regular.roster[0]!.id })).toMatch(/no King/);

    const boss = atStep(8, RUN_TUNING.enemy.bossEvery);
    const node = boss.route!.nodes.at(-1)!;
    expect(node.kind).toBe('boss');
    expect(legalRunActions(boss)).toEqual([{ type: 'travel', nodeId: node.id }]);
    let s = runStep(boss, { type: 'travel', nodeId: node.id });
    expect(s.battle!.mode).toBe('kill-the-king');
    expect(s.battle!.faction).toBe(node.faction);
    expect(s.battle!.rewardValue).toBeGreaterThan(0);
    const last = s.roster.at(-1)!;
    expect(runActionError(s, { type: 'setKing', unitId: 'nobody' })).not.toBeNull();
    const byDefault = runMatchSetup(runStep(s, { type: 'startBattle' }));
    expect(byDefault.kings![0]).toBe(0);
    expect(byDefault.kings![1]).toBe(s.battle!.enemyKing);

    s = runStep(s, { type: 'setKing', unitId: last.id });
    const started = runStep(s, { type: 'startBattle' });
    expect(runMatchSetup(started).kings![0]).toBe(s.roster.length - 1);
    const game = createGame(runBattleConfig(started));
    expect(game.mode!.kings).toEqual([`p0u${s.roster.length - 1}`, `p1u${s.battle!.enemyKing}`]);
  });
});

describe('renaming', () => {
  it('names a unit anew, still drawn as before, outside the battle', () => {
    const s = drafted(5);
    const u = s.roster[0]!;
    const named = runStep(s, { type: 'rename', unitId: u.id, name: '  Old   Grim ' });
    const after = named.roster[0]!.unit;
    expect(after.name).toBe('Old Grim');
    expect(after.look).toBe(u.unit.look ?? u.unit.name);
    expect({ ...after, name: u.unit.name, look: undefined }).toEqual({ ...u.unit, look: undefined });
    const again = runStep(named, { type: 'rename', unitId: u.id, name: 'Older Grim' });
    expect(again.roster[0]!.unit.look).toBe(u.unit.look ?? u.unit.name);
  });

  it('refuses a blank, overlong or taken name, and in battle', () => {
    const s = drafted(5);
    const [a, b] = s.roster;
    expect(runActionError(s, { type: 'rename', unitId: a!.id, name: '   ' })).not.toBeNull();
    expect(runActionError(s, { type: 'rename', unitId: a!.id, name: 'x'.repeat(33) })).not.toBeNull();
    expect(runActionError(s, { type: 'rename', unitId: a!.id, name: b!.unit.name })).not.toBeNull();
    expect(runActionError(s, { type: 'rename', unitId: a!.id, name: a!.unit.name })).toBeNull();
    const fighting = runStep(s, { type: 'startBattle' });
    expect(runActionError(fighting, { type: 'rename', unitId: a!.id, name: 'Later' })).toBe('units cannot be renamed now');
  });
});

describe('runStep', () => {
  it('throws on an action its phase does not allow, and leaves the state alone', () => {
    const s = drafted(5);
    const before = JSON.stringify(s);
    const wrong: RunAction[] = [
      { type: 'draftPick', index: 0 },
      { type: 'continue' },
      { type: 'reward' },
      { type: 'travel', nodeId: 0 },
      { type: 'leaveShop' },
      { type: 'reroll' },
      { type: 'advance', unitId: s.roster[0]!.id, index: 0 },
      { type: 'bench', unitId: 'nobody', benched: true },
    ];
    for (const action of wrong) {
      expect(() => runStep(s, action)).toThrow();
      expect(runActionError(s, action)).not.toBeNull();
    }
    runStep(s, { type: 'startBattle' });
    expect(JSON.stringify(s)).toBe(before);
    for (const action of legalRunActions(s)) expect(runActionError(s, action)).toBeNull();
  });
});
