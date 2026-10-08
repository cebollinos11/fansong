import { unitCost } from '../cost.js';
import { PRESET_UNITS, presetUnit } from '../presets.js';
import type { Warband, WarbandUnit } from '../warband.js';
import { mendWound } from './advance.js';
import type { RunState, RunUnit } from './types.js';

/** The name the player's warband fights under. */
export const RUN_WARBAND_NAME = 'Your Warband';

/** Every preset unit, as the pool draft offers, recruits and enemies are drawn from. */
const POOL: WarbandUnit[] = Object.keys(PRESET_UNITS).map((name) => presetUnit(name)!);

/** The preset units that can lead a drafted warband. */
export const LEADER_POOL: readonly WarbandUnit[] = POOL.filter((u) => u.leader);

/** The preset units offered as troops and recruits. */
export const TROOP_POOL: readonly WarbandUnit[] = POOL.filter((u) => !u.leader);

/**
 * `unit` under a name none of `taken` has: its own, or numbered (`Wolf 2`,
 * `Wolf 3`, …) and still drawn as the original, as a preset roster numbers its copies.
 */
export function uniquelyNamed(unit: WarbandUnit, taken: readonly string[]): WarbandUnit {
  if (!taken.includes(unit.name)) return { ...unit };
  let k = 2;
  while (taken.includes(`${unit.name} ${k}`)) k++;
  return { ...unit, name: `${unit.name} ${k}`, look: unit.look ?? unit.name };
}

/** Add `unit` to the roster under a name of its own (mutates `s`). */
export function enlist(s: RunState, unit: WarbandUnit): RunUnit {
  const recruit: RunUnit = {
    id: `u${s.nextId++}`,
    unit: uniquelyNamed(unit, s.roster.map((u) => u.unit.name)),
    xp: 0,
    level: 0,
    kills: 0,
  };
  s.roster.push(recruit);
  return recruit;
}

/** The roster unit with this id; throws if there is none. */
export function rosterUnit(s: RunState, unitId: string): RunUnit {
  const unit = s.roster.find((u) => u.id === unitId);
  if (!unit) throw new Error(`no unit "${unitId}" in the roster`);
  return unit;
}

/** Point cost of the whole roster. */
export function rosterCost(s: RunState): number {
  return s.roster.reduce((sum, u) => sum + unitCost(u.unit), 0);
}

/** The units fit to fight the next battle: all but those sitting out, or everyone if all would. */
export function fitUnits(s: RunState): RunUnit[] {
  const fit = s.roster.filter((u) => !u.sitsOut);
  return fit.length > 0 ? fit : s.roster;
}

/** The units the next battle fields, in roster order: the fit ones the player hasn't benched. */
export function fieldedUnits(s: RunState): RunUnit[] {
  const fit = fitUnits(s);
  const fielded = fit.filter((u) => !u.benched);
  return fielded.length > 0 ? fielded : fit;
}

/** The warband the next battle fields. Unit `i` is `fieldedUnits(s)[i]`. */
export function playerWarband(s: RunState): Warband {
  return { name: RUN_WARBAND_NAME, units: fieldedUnits(s).map((u) => ({ ...u.unit })) };
}

/** Mend a unit's oldest lasting wound (mutates it); throws if it has none. */
export function mendOldest(u: RunUnit): void {
  const wound = u.wounds?.[0];
  if (!wound) throw new Error(`${u.unit.name} has no lasting wound`);
  u.unit = mendWound(u.unit, wound);
  u.wounds = u.wounds!.slice(1);
  if (u.wounds.length === 0) delete u.wounds;
}

export function isWounded(u: RunUnit): boolean {
  return (u.wounds?.length ?? 0) > 0;
}
