import { runReplay, type Owner, type Replay, type UnitSpec } from '@fansong/engine';
import { shooterForRange, unitCost } from '../cost.js';
import type { BattleReport, UnitReport } from './types.js';

/** Point cost of a deployed unit, read back from its engine spec. */
function specCost(spec: UnitSpec): number {
  return unitCost({ ...spec, shooter: shooterForRange(spec.ranged ?? 0) });
}

/**
 * What happened to the player's units in a battle, re-run from its replay.
 *
 * The engine names units `p{owner}u{index}` by their place in the config's
 * warband, and `buildMatch` deploys a warband in its own order, so player unit
 * `p0u{i}` is roster unit `fielded[i]` (the ids `startBattle` recorded).
 *
 * A unit that changed sides counts as `turned` whatever became of it later; one
 * that ran off the field `fled`; one that was killed `fell`. A kill is credited
 * when the killer was on the player's side and its victim on the enemy's at
 * that moment.
 */
export function battleReport(replay: Replay, fielded: readonly string[]): BattleReport {
  const [mine, theirs] = replay.config.warbands;
  if (mine.length !== fielded.length)
    throw new Error(`the replay fields ${mine.length} units, not the ${fielded.length} sent to battle`);

  const owner = new Map<string, Owner>();
  const cost = new Map<string, number>();
  replay.config.warbands.forEach((specs, o) =>
    specs.forEach((spec, i) => {
      owner.set(`p${o}u${i}`, o as Owner);
      cost.set(`p${o}u${i}`, specCost(spec));
    }),
  );
  const units: Record<string, UnitReport> = {};
  for (const id of fielded) units[id] = { kills: 0, killCosts: [], fate: 'survived' };
  const mineOf = (unitId: string): UnitReport | undefined => {
    const m = /^p0u(\d+)$/.exec(unitId);
    const id = m ? fielded[Number(m[1])] : undefined;
    return id === undefined ? undefined : units[id];
  };

  const run = runReplay(replay);
  let enemyPointsKilled = 0;
  for (const e of run.events.flat()) {
    if (e.type === 'UnitDefected') {
      owner.set(e.unitId, e.to);
      const unit = mineOf(e.unitId);
      if (unit) unit.fate = 'turned';
    } else if (e.type === 'UnitKilled' || e.type === 'UnitRouted') {
      if (owner.get(e.unitId) === 1) {
        if (e.unitId.startsWith('p1')) enemyPointsKilled += cost.get(e.unitId)!;
        const killer = e.type === 'UnitKilled' && e.byId !== null && owner.get(e.byId) === 0 ? mineOf(e.byId) : undefined;
        if (killer) {
          killer.kills++;
          killer.killCosts.push(cost.get(e.unitId)!);
        }
      }
      const unit = mineOf(e.unitId);
      if (unit && unit.fate !== 'turned') unit.fate = e.type === 'UnitKilled' ? 'fell' : 'fled';
    }
  }

  return {
    winner: run.final.phase === 'gameOver' ? run.final.winner : null,
    units,
    enemyPoints: theirs.reduce((sum, spec) => sum + specCost(spec), 0),
    enemyPointsKilled,
  };
}
