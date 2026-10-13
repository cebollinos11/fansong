import { unitCost } from '../cost.js';
import { PRESET_UNITS, presetUnit } from '../presets.js';
import type { Warband, WarbandUnit } from '../warband.js';
import { NAME_LIMITS } from '../warband.js';
import { mendWound } from './advance.js';
import { RUN_TUNING } from './tuning.js';
import type { RunState, RunUnit } from './types.js';

/** The name the player's warband fights under. */
export const RUN_WARBAND_NAME = 'Your Warband';

/** Preset units a run leaves out for now: creatures of the sea, until there is water for them. */
export const SEA_CREATURES: readonly string[] = [
  ...Object.keys(PRESET_UNITS).filter((name) => /^(Merman|Mermaid|Naga) /.test(name)),
  'Caribe',
  'Hunter Caribe',
  'Cuttle Fish',
  'Kraken',
  'Tentacle of the Deep',
  'Great Seahorse',
  'Water Serpent',
];

/** Every preset unit a run can field. */
const POOL: WarbandUnit[] = Object.keys(PRESET_UNITS)
  .filter((name) => !SEA_CREATURES.includes(name))
  .map((name) => presetUnit(name)!);

/** The units that can lead a drafted warband: every preset unit, made a Leader if it isn't one, that costs no more than the draft allows. */
export const LEADER_POOL: readonly WarbandUnit[] = POOL.map((u) => (u.leader ? u : { ...u, leader: true })).filter(
  (u) => unitCost(u) <= RUN_TUNING.draft.leaderMax,
);

/** The units offered as troops and recruits: the preset units that lead nobody. */
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

/**
 * Give `unitId` the player's own name (mutates `s`), still drawn as before.
 * Throws on a blank name, one too long, or one another roster unit has.
 */
export function renameUnit(s: RunState, unitId: string, name: string): void {
  const u = rosterUnit(s, unitId);
  const next = name.trim().replace(/\s+/g, ' ');
  if (next === '') throw new Error('a name cannot be blank');
  if (next.length > NAME_LIMITS.unit) throw new Error(`a name is at most ${NAME_LIMITS.unit} characters`);
  if (s.roster.some((x) => x !== u && x.unit.name === next)) throw new Error(`another unit is already called ${next}`);
  if (next === u.unit.name) return;
  u.unit = { ...u.unit, name: next, look: u.unit.look ?? u.unit.name };
  for (const line of s.aftermath?.units ?? []) if (line.unitId === unitId) line.name = next;
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
