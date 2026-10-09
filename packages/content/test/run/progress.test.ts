import { describe, expect, it } from 'vitest';
import {
  applyAdvance,
  applyAftermath,
  applyReward,
  applyWound,
  availableAdvances,
  availableWounds,
  goldFor,
  injuryFor,
  levelFor,
  makeRunRandom,
  mendWound,
  PRESET_UNITS,
  presetUnit,
  rewardOffer,
  rollLevelUps,
  RUN_TUNING,
  runStep,
  statErrors,
  unitCost,
  xpFor,
  type BattleReport,
  type RunState,
  type UnitFate,
  type WarbandUnit,
} from '../../src/index.js';
import { inBattle } from './helpers.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const UNITS: WarbandUnit[] = Object.keys(PRESET_UNITS).map((name) => presetUnit(name)!);

/** A won battle's report in which every fielded unit met `fate`. */
function reportOf(s: RunState, fate: (id: string, i: number) => UnitFate, kills = 0): BattleReport {
  const units = Object.fromEntries(
    s.battle!.fielded!.map((id, i) => [id, { kills, killCosts: Array.from({ length: kills }, () => 1000), fate: fate(id, i) }]),
  );
  return { winner: 0, units, enemyPoints: 100, enemyPointsKilled: 60 };
}

describe('advances and wounds', () => {
  it('only ever offers a legal profile that costs more', () => {
    for (const unit of UNITS) {
      const advances = availableAdvances(unit);
      expect(advances.length).toBeGreaterThan(0);
      for (const a of advances) {
        const after = applyAdvance(unit, a);
        expect(statErrors(after)).toEqual([]);
        expect(unitCost(after)).toBeGreaterThanOrEqual(unitCost(unit));
        expect(availableAdvances(after)).not.toContainEqual(a.kind === 'trait' ? a : null);
      }
      if (!unit.shooter) expect(advances).not.toContainEqual({ kind: 'trait', trait: 'sharpshooter' });
    }
  });

  it('runs out once a unit has learned everything', () => {
    let unit: WarbandUnit = { name: 'Paragon', quality: 3, combat: 5 };
    for (let i = 0; i < 100 && availableAdvances(unit).length > 0; i++) unit = applyAdvance(unit, availableAdvances(unit)[0]!);
    expect(availableAdvances(unit)).toEqual([]);
    expect(statErrors(unit)).toEqual([]);
    expect([unit.quality, unit.combat]).toEqual([2, 6]);
  });

  it('wounds stay legal, cost points, and mend back to the same profile', () => {
    for (const unit of UNITS)
      for (const w of availableWounds(unit)) {
        const hurt = applyWound(unit, w);
        expect(statErrors(hurt)).toEqual([]);
        expect(unitCost(hurt)).toBeLessThanOrEqual(unitCost(unit));
        expect(mendWound(hurt, w)).toEqual(unit);
      }
    // A stat never mends past its bounds.
    expect(mendWound({ name: 'x', quality: 2, combat: 6 }, { kind: 'quality' }).quality).toBe(2);
    expect(mendWound({ name: 'x', quality: 2, combat: 6 }, { kind: 'combat' }).combat).toBe(6);
    expect(availableWounds({ name: 'x', quality: 6, combat: 1, slow: true, dumb: true, badBalance: true })).toEqual([]);
  });
});

describe('XP', () => {
  it('pays for fighting, for each kill, and more for a costlier kill', () => {
    const { fought, perKill, costlierKill } = RUN_TUNING.xp;
    expect(xpFor({ kills: 0, killCosts: [], fate: 'survived' }, 30)).toBe(fought);
    expect(xpFor({ kills: 2, killCosts: [10, 30], fate: 'fell' }, 30)).toBe(fought + 2 * perKill);
    expect(xpFor({ kills: 2, killCosts: [10, 31], fate: 'survived' }, 30)).toBe(fought + 2 * perKill + costlierKill);
  });

  it('levels at the thresholds and no further', () => {
    const [a, b, c, d] = RUN_TUNING.xp.levels as [number, number, number, number];
    expect([0, a - 1, a, b - 1, b, c - 1, c, d - 1, d, 500].map(levelFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('offers one level at a time, each a choice of different advances', () => {
    let s = inBattle(4);
    const id = s.roster[0]!.id;
    s.roster[0]!.xp = RUN_TUNING.xp.levels[1]!;
    rollLevelUps(s, makeRunRandom(1, 1, 0));
    expect(s.pending).toHaveLength(1);
    const { choices } = s.pending![0]!;
    expect(choices).toHaveLength(RUN_TUNING.xp.choices);
    expect(choices[0]).not.toEqual(choices[1]);

    s.phase = 'aftermath';
    const before = s.roster[0]!.unit;
    s = runStep(s, { type: 'advance', unitId: id, index: 1 });
    expect(s.roster[0]!.unit).toEqual(applyAdvance(before, choices[1]!));
    expect(s.roster[0]!.level).toBe(1);
    // The second level it had earned comes up next.
    expect(s.pending).toHaveLength(1);
    expect(() => runStep(s, { type: 'continue' })).toThrow();
    s = runStep(s, { type: 'advance', unitId: id, index: 0 });
    expect(s.roster[0]!.level).toBe(2);
    expect(s.pending).toBeUndefined();
    expect(runStep(s, { type: 'continue' }).phase).toBe('reward');
  });
});

describe('the aftermath', () => {
  it('pays gold and XP, and logs the round', () => {
    const s = inBattle(6);
    const report = reportOf(s, () => 'survived', 1);
    const before = clone(s);
    applyAftermath(s, report, makeRunRandom(6, 1, 9));
    expect(s.gold).toBe(goldFor(1, report));
    expect(goldFor(1, report)).toBe(RUN_TUNING.gold.perWin + RUN_TUNING.gold.perRound + Math.floor(60 * RUN_TUNING.gold.killShare));
    expect(s.roster).toHaveLength(before.roster.length);
    const xp = RUN_TUNING.xp.fought + RUN_TUNING.xp.perKill + RUN_TUNING.xp.costlierKill;
    for (const u of s.roster) expect([u.xp, u.kills]).toEqual([xp, 1]);
    expect(s.log).toEqual([
      { round: 1, mode: 'annihilation', enemy: before.battle!.enemy.name, boss: false, won: true, kills: before.roster.length, losses: 0, gold: s.gold },
    ]);
    expect(s.aftermath!.units.map((l) => l.unitId)).toEqual(before.battle!.fielded);
    // One battle's XP is not yet a level.
    expect(xp).toBeLessThan(RUN_TUNING.xp.levels[0]!);
    expect(s.pending).toBeUndefined();
  });

  it('loses a turncoat, brings back one that fled, and rolls for each one that fell', () => {
    const outcomes = new Set<string>();
    for (let rolls = 0; rolls < 40; rolls++) {
      const s = inBattle(6);
      const before = clone(s);
      const [turned, fled, ...rest] = s.battle!.fielded!;
      applyAftermath(s, reportOf(s, (id) => (id === turned ? 'turned' : id === fled ? 'fled' : 'fell')), makeRunRandom(6, 1, rolls));
      const ids = s.roster.map((u) => u.id);
      expect(ids).not.toContain(turned);
      expect(s.roster.find((u) => u.id === fled)).toEqual({ ...before.roster.find((u) => u.id === fled)!, xp: RUN_TUNING.xp.fought });
      const lines = s.aftermath!.units;
      expect(lines.find((l) => l.unitId === turned)).toMatchObject({ fate: 'turned', xp: 0 });
      expect(lines.find((l) => l.unitId === fled)!.injury).toBeUndefined();

      for (const id of rest) {
        const line = lines.find((l) => l.unitId === id)!;
        const was = before.roster.find((u) => u.id === id)!;
        const now = s.roster.find((u) => u.id === id);
        outcomes.add(line.injury!);
        expect(line.injury).toBe(injuryFor(line.die!) === 'wound' && !line.wound ? 'sitsOut' : injuryFor(line.die!));
        expect(line.look).toBe(was.unit.look ?? was.unit.name);
        if (line.injury === 'dead') expect(now).toBeUndefined();
        else if (line.injury === 'wound') {
          expect(now!.wounds).toEqual([line.wound]);
          expect(now!.unit).toEqual(applyWound(was.unit, line.wound!));
          expect(statErrors(now!.unit)).toEqual([]);
        } else {
          expect(now!.unit).toEqual(was.unit);
          expect(Boolean(now!.sitsOut)).toBe(line.injury === 'sitsOut');
        }
      }
      expect(s.log[0]!.losses).toBe(before.roster.length - s.roster.length);
    }
    expect([...outcomes].sort()).toEqual(['dead', 'recovered', 'sitsOut', 'wound']);
  });

  it('reads the injury die as the tuning table says', () => {
    expect([1, 2, 3, 4, 5, 6].map(injuryFor)).toEqual(['dead', 'wound', 'sitsOut', 'recovered', 'recovered', 'recovered']);
  });

  it('lets a unit that sat out fight again', () => {
    const s = inBattle(6);
    s.roster.push({ id: 'spare', unit: { name: 'Spare', quality: 4, combat: 2 }, xp: 0, level: 0, kills: 0, sitsOut: true });
    applyAftermath(s, reportOf(s, () => 'survived'), makeRunRandom(1, 1, 0));
    expect(s.roster.some((u) => u.sitsOut)).toBe(false);
  });
});

describe('the reward', () => {
  it('offers options that can all be taken', () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = inBattle(seed);
      if (seed % 2) {
        const hurt = s.roster[0]!;
        hurt.wounds = [{ kind: 'combat' }];
        hurt.unit = applyWound(hurt.unit, { kind: 'combat' });
      }
      if (seed % 3 === 0) while (s.roster.length < RUN_TUNING.rosterCap) s.roster.push({ ...clone(s.roster[0]!), id: `x${s.roster.length}` });
      const options = rewardOffer(s, makeRunRandom(seed, 1, 0));
      expect(options).toHaveLength(RUN_TUNING.reward.options);
      for (const option of options) {
        const takers = s.roster.filter((u) => {
          try {
            applyReward(clone(s), option, u.id);
            return true;
          } catch {
            return false;
          }
        });
        expect(takers.length, JSON.stringify(option)).toBeGreaterThan(0);
        if (option.kind === 'recruit') expect(s.roster.length).toBeLessThan(RUN_TUNING.rosterCap);
      }
    }
  });

  it('applies each kind', () => {
    const s = inBattle(9);
    const first = s.roster[0]!;
    applyReward(s, { kind: 'gold', amount: 12 });
    expect(s.gold).toBe(12);

    const size = s.roster.length;
    applyReward(s, { kind: 'recruit', unit: clone(first.unit) });
    expect(s.roster).toHaveLength(size + 1);
    expect(s.roster.at(-1)!.unit.name).toBe(`${first.unit.name} 2`);

    const combat = first.unit.combat;
    applyReward(s, { kind: 'boost', advance: { kind: 'combat' } }, first.id);
    expect(first.unit.combat).toBe(combat + 1);
    expect(() => applyReward(s, { kind: 'boost', advance: { kind: 'combat' } })).toThrow();

    expect(() => applyReward(s, { kind: 'mend' }, first.id)).toThrow();
    first.unit = applyWound(first.unit, { kind: 'trait', trait: 'dumb' });
    first.wounds = [{ kind: 'trait', trait: 'dumb' }];
    applyReward(s, { kind: 'mend' }, first.id);
    expect(first.unit.dumb).toBeUndefined();
    expect(first.wounds).toBeUndefined();
  });
});
