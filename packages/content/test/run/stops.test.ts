import { describe, expect, it } from 'vitest';
import {
  applyAdvance,
  applyWound,
  availableAdvances,
  enemyPoints,
  generateBattle,
  generateRoute,
  legalRunActions,
  levelFor,
  PRESET_ROSTERS,
  PRESET_UNITS,
  RUN_TUNING,
  runActionError,
  runStep,
  unitCost,
  warbandCost,
  type NodeKind,
  type RunState,
  type WarbandUnit,
} from '../../src/index.js';
import { atStep } from './helpers.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A drafted run standing just below a node of `kind`, and that node's id. */
function below(kind: NodeKind, from = 1): { s: RunState; nodeId: number } {
  for (let seed = from; seed < from + 300; seed++) {
    const node = generateRoute(seed, 1).nodes.find((n) => n.kind === kind);
    if (node) return { s: atStep(seed, node.step, { node: node.id }), nodeId: node.id };
  }
  throw new Error(`no route has a ${kind}`);
}

/** The same run, arrived at that node. */
function at(kind: NodeKind, from = 1): RunState {
  const { s, nodeId } = below(kind, from);
  return runStep(s, { type: 'travel', nodeId });
}

/** `s` with its first unit carrying a lasting wound and its second sitting out. */
function hurt(s: RunState): RunState {
  const next = clone(s);
  const [a, b] = next.roster;
  a!.unit = applyWound(a!.unit, { kind: 'combat' });
  a!.wounds = [{ kind: 'combat' }];
  a!.unit = applyWound(a!.unit, { kind: 'trait', trait: 'slow' });
  a!.wounds.push({ kind: 'trait', trait: 'slow' });
  if (b) b.sitsOut = true;
  return next;
}

describe('a camp', () => {
  it('is a stop with one choice: rest or drill', () => {
    const s = at('camp');
    expect([s.phase, s.offer]).toEqual(['stop', { kind: 'camp' }]);
    expect(s.battle).toBeUndefined();
    expect(legalRunActions(s)).toEqual([
      { type: 'camp', choice: 'rest' },
      { type: 'camp', choice: 'drill' },
    ]);
    expect(runActionError(s, { type: 'leaveStop' })).toMatch(/rest or drill/);
    expect(runActionError(s, { type: 'train', unitId: s.roster[0]!.id })).toMatch(/no training ground/);
    for (const choice of ['rest', 'drill'] as const) {
      const spent = runStep(s, { type: 'camp', choice });
      expect(spent.offer).toEqual({ kind: 'camp', taken: choice });
      expect(runActionError(spent, { type: 'camp', choice: 'rest' })).toMatch(/already spent/);
      expect(runActionError(spent, { type: 'camp', choice: 'drill' })).toMatch(/already spent/);
    }
  });

  it('rests: every lasting wound is mended, and whoever sat out is fit again', () => {
    const s = hurt(at('camp'));
    const healthy = at('camp');
    const rested = runStep(s, { type: 'camp', choice: 'rest' });
    expect(rested.roster.map((u) => u.unit)).toEqual(healthy.roster.map((u) => u.unit));
    expect(rested.roster.some((u) => u.wounds || u.sitsOut)).toBe(false);
    expect(rested.roster.map((u) => u.xp)).toEqual(s.roster.map((u) => u.xp));
    expect([rested.gold, rested.pending]).toEqual([s.gold, undefined]);
    // The night spent, the road goes on, a step further.
    expect(legalRunActions(rested)).toEqual([{ type: 'leaveStop' }]);
    const on = runStep(rested, { type: 'leaveStop' });
    expect([on.phase, on.round, on.rolls, on.offer]).toEqual(['map', s.round + 1, 0, undefined]);
    expect([on.route!.at, on.route!.going, on.route!.path.at(-1)]).toEqual([s.route!.going, undefined, s.route!.going]);
    expect(on.log).toEqual(s.log);
  });

  it('drills: every unit earns XP, and the levels that brings are spent before moving on', () => {
    const s = hurt(at('camp'));
    const { drillXp } = RUN_TUNING.camp;
    const drilled = runStep(s, { type: 'camp', choice: 'drill' });
    expect(drilled.roster.map((u) => u.xp)).toEqual(s.roster.map((u) => u.xp + drillXp));
    // A drill mends nothing.
    expect(drilled.roster.map((u) => [u.wounds, u.sitsOut])).toEqual(s.roster.map((u) => [u.wounds, u.sitsOut]));
    expect(drilled.pending).toBeUndefined();
    expect(runStep(drilled, { type: 'leaveStop' }).phase).toBe('map');

    // A unit a drill takes over the line levels up there and then.
    const near = clone(s);
    near.roster[0]!.xp = RUN_TUNING.xp.levels[0]! - 1;
    const up = runStep(near, { type: 'camp', choice: 'drill' });
    const id = near.roster[0]!.id;
    expect(up.pending).toHaveLength(1);
    expect(up.pending![0]!.unitId).toBe(id);
    expect(runActionError(up, { type: 'leaveStop' })).toMatch(/levels still to spend/);
    expect(legalRunActions(up)).toEqual(up.pending![0]!.choices.map((_, index) => ({ type: 'advance', unitId: id, index })));
    const taken = runStep(up, { type: 'advance', unitId: id, index: 0 });
    expect(taken.roster[0]!.level).toBe(1);
    expect(taken.roster[0]!.unit).toEqual(applyAdvance(near.roster[0]!.unit, up.pending![0]!.choices[0]!));
    expect(levelFor(taken.roster[0]!.xp)).toBe(1);
    expect(legalRunActions(taken)).toEqual([{ type: 'leaveStop' }]);
  });

  it('is the same camp for the same seed', () => {
    const play = () => runStep(runStep(at('camp'), { type: 'camp', choice: 'drill' }), { type: 'leaveStop' });
    expect(play()).toEqual(play());
  });
});

describe('a training ground', () => {
  it('teaches one unit one of three advances, for nothing and for no level', () => {
    const s = at('training');
    expect([s.phase, s.offer]).toEqual(['stop', { kind: 'training' }]);
    const ids = s.roster.map((u) => u.id);
    // It may be passed by, until a unit is named.
    expect(legalRunActions(s)).toEqual([{ type: 'leaveStop' }, ...ids.map((unitId) => ({ type: 'train', unitId }))]);
    expect(runStep(s, { type: 'leaveStop' })).toMatchObject({ phase: 'map', round: s.round + 1 });
    expect(runActionError(s, { type: 'trainPick', index: 0 })).toMatch(/no training/);
    expect(runActionError(s, { type: 'camp', choice: 'rest' })).toMatch(/not in camp/);

    for (const unitId of ids) {
      const before = s.roster.find((u) => u.id === unitId)!;
      const named = runStep(s, { type: 'train', unitId });
      if (named.offer?.kind !== 'training') throw new Error('no training');
      const choices = named.offer.choices!;
      expect(named.offer.unitId).toBe(unitId);
      expect(choices).toHaveLength(Math.min(RUN_TUNING.training.choices, availableAdvances(before.unit).length));
      expect(new Set(choices.map((c) => JSON.stringify(c))).size).toBe(choices.length);
      for (const c of choices) expect(availableAdvances(before.unit)).toContainEqual(c);
      // The unit named is the unit that trains: no going back, and no passing by.
      expect(legalRunActions(named)).toEqual(choices.map((_, index) => ({ type: 'trainPick', index })));
      expect(runActionError(named, { type: 'train', unitId: ids[0]! })).toMatch(/already training/);
      expect(runActionError(named, { type: 'leaveStop' })).toMatch(/yet to choose/);
      expect(runActionError(named, { type: 'trainPick', index: choices.length })).toMatch(/no training/);

      choices.forEach((advance, index) => {
        const done = runStep(named, { type: 'trainPick', index });
        const after = done.roster.find((u) => u.id === unitId)!;
        expect(after).toEqual({ ...before, unit: applyAdvance(before.unit, advance) });
        expect(unitCost(after.unit)).toBeGreaterThanOrEqual(unitCost(before.unit));
        expect([done.phase, done.round, done.gold, done.offer]).toEqual(['map', s.round + 1, s.gold, undefined]);
      });
      expect(runStep(s, { type: 'train', unitId })).toEqual(named);
    }
  });

  it('turns away a unit with nothing left to learn', () => {
    const s = at('training');
    let unit: WarbandUnit = s.roster[0]!.unit;
    for (let advances = availableAdvances(unit); advances.length > 0; advances = availableAdvances(unit)) unit = applyAdvance(unit, advances[0]!);
    s.roster[0]!.unit = unit;
    expect(runActionError(s, { type: 'train', unitId: s.roster[0]!.id })).toMatch(/nothing left to learn/);
    expect(legalRunActions(s)).not.toContainEqual({ type: 'train', unitId: s.roster[0]!.id });
  });
});

describe('a market', () => {
  it('is the full shop: recruits, upgrades, fresh stock, a buyer, and a road on', () => {
    const s = { ...at('market'), gold: 500 };
    if (s.offer?.kind !== 'shop') throw new Error('no shop');
    expect([s.phase, s.offer.market]).toEqual(['shop', true]);
    // (The run came with no gold, so a free cadet stands beside the recruits.)
    expect(s.offer.recruits.filter((u) => u && u.name !== 'Eager Cadet')).toHaveLength(RUN_TUNING.shop.recruits);
    expect(s.offer.upgrades).toHaveLength(RUN_TUNING.shop.upgrades);
    const types = new Set(legalRunActions(s).map((a) => a.type));
    expect([...types].sort()).toEqual(['buyBanner', 'buyRecruit', 'buyUpgrade', 'leaveShop', 'reroll', 'sell']);
    const restocked = runStep(s, { type: 'reroll' });
    expect(restocked.offer).toMatchObject({ kind: 'shop', market: true, rerolls: 1 });
    expect(runStep(s, { type: 'sell', unitId: s.roster.at(-1)!.id }).roster).toHaveLength(s.roster.length - 1);
    const on = runStep(s, { type: 'leaveShop' });
    expect([on.phase, on.round]).toEqual(['map', s.round + 1]);
    expect(on.route!.at).toBe(s.route!.going);
  });

  it('sells retreat banners, up to the most a warband carries', () => {
    const { banner } = RUN_TUNING.market;
    const { max } = RUN_TUNING.banners;
    const s = { ...at('market'), gold: banner * 5, banners: 0 };
    let run: RunState = s;
    for (let i = 1; i <= max; i++) {
      run = runStep(run, { type: 'buyBanner' });
      expect([run.banners, run.gold]).toEqual([i, s.gold - banner * i]);
    }
    expect(runActionError(run, { type: 'buyBanner' })).toMatch(/at most/);
    expect(legalRunActions(run)).not.toContainEqual({ type: 'buyBanner' });
    expect(runActionError({ ...s, gold: banner - 1 }, { type: 'buyBanner' })).toMatch(/costs/);
    // The field shop has none to sell.
    const field: RunState = { ...s, offer: { kind: 'shop', recruits: [], upgrades: [], rerolls: 0 } };
    expect(runActionError(field, { type: 'buyBanner' })).toMatch(/only a market/);
    expect(legalRunActions(field)).toEqual([{ type: 'leaveShop' }]);
  });
});

describe('an elite', () => {
  const { min, max } = RUN_TUNING.elite.threat;

  it('is led and has veterans however early, at a threat no plain battle reaches', () => {
    for (let seed = 1; seed <= 40; seed++)
      for (const round of [3, 4, 5, 9]) {
        const threat = min + ((seed % 5) / 4) * (max - min);
        const { enemy } = generateBattle(seed, round, { id: seed % 9, kind: 'elite', threat }, 5);
        const pool = PRESET_ROSTERS[enemy.faction]!.units.map((slot) => ({ name: slot.unit, ...PRESET_UNITS[slot.unit]! }));
        const dearest = Math.max(...pool.map((u) => unitCost(u)));
        const head = pool.find((u) => u.leader) ?? pool.find((u) => unitCost(u) === dearest)!;
        expect(enemy.warband.units[0]!.name, `seed ${seed} round ${round}`).toBe(head.name);
        expect(enemy.king).toBeUndefined();
        expect(warbandCost(enemy.warband)).toBeLessThanOrEqual(enemyPoints(round, threat));
        expect(enemy.threat).toBeGreaterThan(RUN_TUNING.mission.threat.max);
        // Its budget is spent to the last few points: on units, then on veterans' upgrades.
        expect(warbandCost(enemy.warband)).toBeGreaterThan(enemyPoints(round, threat) - 12);
      }
    // A plain battle of the same early step is a leaderless patrol of plain troops.
    const veteran = (kind: 'elite' | 'battle') =>
      Array.from({ length: 40 }, (_, seed) => generateBattle(seed, 3, { id: 1, kind, threat: 1.5 }, 5).enemy.warband.units)
        .flat()
        .filter((u) => unitCost(u) !== unitCost(PRESET_UNITS[u.name.replace(/ \d+$/, '')]!)).length;
    expect(veteran('battle')).toBe(0);
    expect(veteran('elite')).toBeGreaterThan(20);
  });

  it('pays its reward and then a free training, before the field shop', () => {
    const { s, nodeId } = below('elite');
    const node = s.route!.nodes[nodeId]!;
    expect(node.threat).toBeGreaterThanOrEqual(min);
    expect(node.threat).toBeLessThan(max);
    const briefing = runStep(s, { type: 'travel', nodeId });
    expect(briefing.battle).toMatchObject({ elite: true, faction: node.faction, mode: node.mode });
    // By the reward formula a threat of 1.5 pays about 2.25 times a plain battle.
    const plain = RUN_TUNING.mission.reward.base + RUN_TUNING.mission.reward.perRound * s.round;
    expect(briefing.battle!.rewardValue / plain).toBeGreaterThan(1.9);

    // As if it were won: the reward is claimed, and the training follows.
    const owed: RunState = { ...briefing, phase: 'reward', offer: { kind: 'reward', rewards: [{ kind: 'gold', amount: 50 }], value: 50 } };
    delete owed.battle;
    const paid = runStep(owed, { type: 'reward' });
    expect([paid.phase, paid.offer, paid.gold]).toEqual(['stop', { kind: 'training', then: 'shop' }, owed.gold + 50]);
    const unitId = paid.roster[0]!.id;
    const named = runStep(paid, { type: 'train', unitId });
    const trained = runStep(named, { type: 'trainPick', index: 0 });
    expect([trained.phase, trained.round]).toEqual(['shop', s.round]);
    expect(trained.offer).toMatchObject({ kind: 'shop' });
    expect((trained.offer as { market?: true }).market).toBeUndefined();
    expect(unitCost(trained.roster[0]!.unit)).toBeGreaterThanOrEqual(unitCost(paid.roster[0]!.unit));
    // Passing the training by leads to the same shop; from there, the map.
    const passed = runStep(paid, { type: 'leaveStop' });
    expect([passed.phase, passed.round, passed.roster]).toEqual(['shop', s.round, paid.roster]);
    const on = runStep(trained, { type: 'leaveShop' });
    expect([on.phase, on.round, on.route!.at]).toEqual(['map', s.round + 1, nodeId]);

    // A plain battle's reward leads straight to the field shop.
    const battle = below('battle');
    const there = runStep(battle.s, { type: 'travel', nodeId: battle.nodeId });
    expect(there.battle!.elite).toBeUndefined();
    const owedPlain: RunState = { ...there, phase: 'reward', offer: owed.offer };
    delete owedPlain.battle;
    expect(runStep(owedPlain, { type: 'reward' }).phase).toBe('shop');
  });
});
