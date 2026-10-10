import {
  legalRunActions,
  openNodes,
  RUN_EVENT_IDS,
  parseMap,
  parseWarband,
  runBattleConfig,
  runVictorious,
  type RunPhase,
  type RunState,
  type Warband,
  type WarbandUnit,
} from '@fansong/content';
import type { MapStorage } from './customMaps.js';

/**
 * The run in progress and the best runs so far, kept in `localStorage`. Like
 * the saved armies, every function takes the storage explicitly (`null` =
 * unavailable) so the logic is testable without a DOM, and what comes back out
 * is untrusted: a stored run goes through {@link parseRun}, and one this
 * version can't read is dropped rather than thrown.
 */

export const RUN_KEY = 'fansong.run';
export const RUN_RECORDS_KEY = 'fansong.runRecords';

/** How many finished runs are remembered. */
export const MAX_RUN_RECORDS = 10;

/** A finished run, as the records list shows it. */
export interface RunRecord {
  seed: number;
  /** Battles won. */
  wins: number;
  /** The step it ended at. */
  round: number;
  kills: number;
  /** Lost a battle, or given up for a new run. */
  end: 'lost' | 'abandoned';
  /** Whether it beat the victory round. */
  victorious: boolean;
  /** When it ended (ms since the epoch). */
  at: number;
  /** The names of the warband it ended with. */
  roster: string[];
  /** The warband it ended with, to meet again in later runs (absent from records older than that). */
  units?: WarbandUnit[];
  /** Battles it retreated from (absent when none, and from records older than retreats). */
  retreats?: number;
}

const PHASES: readonly RunPhase[] = ['draft', 'map', 'briefing', 'battle', 'aftermath', 'reward', 'shop', 'stop', 'over'];
const NODE_KINDS = ['battle', 'elite', 'market', 'camp', 'training', 'mystery', 'boss'];
const REWARD_KINDS = ['recruit', 'boost', 'gold', 'mend'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(what: string): never {
  throw new Error(`Not a saved run: ${what}.`);
}

function count(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(what);
  return v;
}

function list(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) fail(what);
  return v;
}

function parseUnit(raw: unknown): WarbandUnit {
  return parseWarband({ name: '', units: [raw] }).units[0]!;
}

/** A unit slot of the shop: a unit, or `null` once bought. */
const parseSlot = (raw: unknown): WarbandUnit | null => (raw === null ? null : parseUnit(raw));

/** An advance, a wound or a reward: a record whose `kind` is one of `kinds`. */
function kinded(raw: unknown, kinds: readonly string[], what: string): Record<string, unknown> {
  if (!isRecord(raw) || typeof raw.kind !== 'string' || !kinds.includes(raw.kind)) fail(what);
  if (raw.kind === 'trait' && typeof raw.trait !== 'string') fail(what);
  return raw;
}

const STEP_KINDS = ['trait', 'combat', 'quality'];

/** What a battle pays: a list of rewards. */
function parseRewards(raw: unknown): unknown[] {
  return list(raw, 'bad reward').map((o) => {
    const option = kinded(o, REWARD_KINDS, 'bad reward');
    if (option.kind === 'recruit') return { ...option, unit: parseUnit(option.unit) };
    if (option.kind === 'boost') kinded(option.advance, STEP_KINDS, 'bad reward');
    if (option.kind === 'gold') count(option.amount, 'bad reward');
    return option;
  });
}

/** A battle: who is fought, how hard it is and what it pays. */
function parseBattle(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.faction !== 'string' || typeof raw.threat !== 'number' || !(raw.threat >= 0)) fail('bad battle');
  count(raw.rewardValue, 'bad battle');
  return { ...raw, enemy: parseWarband(raw.enemy), rewards: parseRewards(raw.rewards) };
}

/** The act's map: nodes that know their own place in the list and lead only to the row above, and a stand on it that names real nodes. */
function parseRoute(raw: unknown): Record<string, unknown> {
  const bad = 'bad route';
  if (!isRecord(raw) || count(raw.act, bad) < 1) fail(bad);
  const nodes = list(raw.nodes, bad);
  if (nodes.length < 2) fail(bad);
  const index = (v: unknown): number => {
    if (count(v, bad) >= nodes.length) fail(bad);
    return v as number;
  };
  nodes.forEach((node, id) => {
    if (!isRecord(node) || node.id !== id || typeof node.lane !== 'number' || !(node.lane >= 0)) fail(bad);
    if (typeof node.kind !== 'string' || !NODE_KINDS.includes(node.kind)) fail(bad);
    const step = count(node.step, bad);
    for (const to of list(node.next, bad)) {
      const next = nodes[index(to)];
      if (!isRecord(next) || next.step !== step + 1) fail(bad);
    }
    if (node.threat !== undefined && !(typeof node.threat === 'number' && node.threat >= 0)) fail(bad);
    if (node.budget !== undefined && !(typeof node.budget === 'number' && node.budget >= 0)) fail(bad);
    if (node.faction !== undefined && typeof node.faction !== 'string') fail(bad);
    if (node.mode !== undefined && typeof node.mode !== 'string') fail(bad);
    if (node.rewardKind !== undefined && !(typeof node.rewardKind === 'string' && REWARD_KINDS.includes(node.rewardKind))) fail(bad);
    if (node.rival !== undefined && node.rival !== true) fail(bad);
  });
  if (raw.at !== null) index(raw.at);
  if (raw.going !== undefined) index(raw.going);
  list(raw.closed, bad).forEach(index);
  const path = list(raw.path, bad).map(index);
  if ((path.at(-1) ?? null) !== raw.at) fail(bad);
  return raw;
}

/**
 * Parse an untrusted saved run. Throws a friendly `Error` unless it has the
 * shape of a {@link RunState} whose every unit and map parses, and the run's
 * own rules can carry on from it: its legal actions can be listed and, mid
 * battle, its match can be built.
 */
export function parseRun(raw: unknown): RunState {
  if (!isRecord(raw)) fail('it is not an object');
  if (raw.version !== 3) fail('it is from another version');
  if (typeof raw.seed !== 'number' || !Number.isSafeInteger(raw.seed)) fail('it has no seed');
  if (typeof raw.phase !== 'string' || !(PHASES as readonly string[]).includes(raw.phase)) fail('it has no phase');
  const phase = raw.phase as RunPhase;
  if (count(raw.round, 'it has no round') < 1) fail('it has no round');
  count(raw.gold, 'it has no gold');
  count(raw.rolls, 'it has no roll count');
  count(raw.nextId, 'it has no next id');
  const banners = count(raw.banners, 'it has no banner count');
  if (raw.retreats !== undefined) count(raw.retreats, 'bad retreat count');

  const ids = new Set<string>();
  const roster = list(raw.roster, 'it has no roster').map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || ids.has(entry.id)) fail('a roster unit has no id of its own');
    ids.add(entry.id);
    count(entry.xp, 'a roster unit has no XP');
    count(entry.level, 'a roster unit has no level');
    count(entry.kills, 'a roster unit has no kills');
    if (entry.wounds !== undefined) list(entry.wounds, 'bad wounds').forEach((w) => kinded(w, STEP_KINDS, 'bad wound'));
    return { ...entry, unit: parseUnit(entry.unit) };
  });
  if (phase !== 'draft' && roster.length === 0) fail('its roster is empty');

  const next: Record<string, unknown> = { ...raw, roster, banners };

  for (const line of list(raw.log, 'it has no history')) {
    if (!isRecord(line) || typeof line.mode !== 'string' || typeof line.enemy !== 'string' || typeof line.won !== 'boolean') fail('bad history');
    if (line.retreated !== undefined && line.retreated !== true) fail('bad history');
    count(line.round, 'bad history');
    count(line.kills, 'bad history');
  }

  if (raw.offer !== undefined) {
    const offer = kinded(raw.offer, ['draft', 'reward', 'shop', 'camp', 'training', 'event'], 'bad offer');
    if (offer.kind === 'draft') {
      next.offer = { ...offer, units: list(offer.units, 'bad draft offer').map(parseUnit) };
    } else if (offer.kind === 'camp') {
      if (offer.taken !== undefined && offer.taken !== 'rest' && offer.taken !== 'drill') fail('bad camp');
    } else if (offer.kind === 'training') {
      if (offer.unitId !== undefined && (typeof offer.unitId !== 'string' || !ids.has(offer.unitId))) fail('bad training');
      if (offer.choices !== undefined) list(offer.choices, 'bad training').forEach((a) => kinded(a, STEP_KINDS, 'bad training'));
      if ((offer.unitId === undefined) !== (offer.choices === undefined)) fail('bad training');
      if (offer.then !== undefined && offer.then !== 'shop') fail('bad training');
    } else if (offer.kind === 'event') {
      if (typeof offer.event !== 'string' || !(RUN_EVENT_IDS as readonly string[]).includes(offer.event)) fail('bad event');
      for (const key of ['price', 'gold', 'die'] as const) if (offer[key] !== undefined) count(offer[key], 'bad event');
      if (offer.result !== undefined && !(isRecord(offer.result) && typeof offer.result.text === 'string' && count(offer.result.choice, 'bad event') >= 0)) fail('bad event');
      next.offer = offer.unit === undefined ? offer : { ...offer, unit: parseUnit(offer.unit) };
    } else if (offer.kind === 'reward') {
      count(offer.value, 'bad reward');
      next.offer = { ...offer, rewards: parseRewards(offer.rewards) };
    } else {
      count(offer.rerolls, 'bad shop');
      if (offer.market !== undefined && offer.market !== true) fail('bad shop');
      list(offer.upgrades, 'bad shop').forEach((a) => a === null || kinded(a, STEP_KINDS, 'bad shop'));
      next.offer = { ...offer, recruits: list(offer.recruits, 'bad shop').map(parseSlot) };
    }
  }
  const offerKind = isRecord(next.offer) ? next.offer.kind : undefined;
  const owed: Partial<Record<RunPhase, string>> = { draft: 'draft', aftermath: 'reward', reward: 'reward', shop: 'shop' };
  if (phase === 'stop' && offerKind !== 'camp' && offerKind !== 'training' && offerKind !== 'event') fail('its stop has nothing on offer');
  // A retreat's aftermath is owed nothing, nor is that of a fight with no reward at stake: they lead straight to the shop.
  const retreated = isRecord(raw.aftermath) && (raw.aftermath.retreated === true || raw.aftermath.plain === true);
  if (isRecord(raw.aftermath) && raw.aftermath.retreated !== undefined && raw.aftermath.retreated !== true) fail('bad aftermath');
  if (isRecord(raw.aftermath) && raw.aftermath.plain !== undefined && raw.aftermath.plain !== true) fail('bad aftermath');
  if (phase === 'aftermath' && retreated) {
    if (offerKind !== undefined) fail('its retreat has something on offer');
  } else if (owed[phase] !== undefined && offerKind !== owed[phase]) fail(`its ${phase} has nothing on offer`);

  if (raw.pending !== undefined) {
    for (const p of list(raw.pending, 'bad level-ups')) {
      if (!isRecord(p) || typeof p.unitId !== 'string') fail('bad level-ups');
      list(p.choices, 'bad level-ups').forEach((a) => kinded(a, STEP_KINDS, 'bad level-ups'));
    }
  }

  if (raw.aftermath !== undefined) {
    if (!isRecord(raw.aftermath)) fail('bad aftermath');
    count(raw.aftermath.gold, 'bad aftermath');
    for (const line of list(raw.aftermath.units, 'bad aftermath')) {
      if (!isRecord(line) || typeof line.unitId !== 'string' || typeof line.name !== 'string' || typeof line.fate !== 'string') fail('bad aftermath');
      count(line.kills, 'bad aftermath');
      count(line.xp, 'bad aftermath');
      if (line.wound !== undefined) kinded(line.wound, STEP_KINDS, 'bad aftermath');
      if (line.die !== undefined && (count(line.die, 'bad aftermath') < 1 || (line.die as number) > 6)) fail('bad aftermath');
      if ((line.look !== undefined && typeof line.look !== 'string') || (line.tint !== undefined && typeof line.tint !== 'string')) fail('bad aftermath');
    }
  }
  if (phase === 'aftermath' && raw.aftermath === undefined) fail('its aftermath is missing');

  if (raw.battle !== undefined) {
    const battle = raw.battle;
    if (!isRecord(battle) || typeof battle.mode !== 'string') fail('bad battle');
    next.battle = { ...parseBattle(battle), map: parseMap(battle.map) };
  }
  if ((phase === 'briefing' || phase === 'battle') && raw.battle === undefined) fail('its battle is missing');

  // The map is drawn when the draft ends. On it nothing is being played and a road is open; in a battle, something is.
  if (raw.route !== undefined) next.route = parseRoute(raw.route);
  if (phase !== 'draft' && raw.route === undefined) fail('it has no map');
  if (isRecord(raw.route)) {
    const playing = raw.route.going !== undefined;
    if (phase === 'map' && (playing || openNodes(next.route as unknown as NonNullable<RunState['route']>).length === 0)) fail('its map leads nowhere');
    if ((phase === 'briefing' || phase === 'battle' || phase === 'reward' || phase === 'stop') && !playing) fail('it is nowhere on the map');
  }

  if (raw.rivals !== undefined) {
    next.rivals = list(raw.rivals, 'bad rivals').map((r) => {
      if (!isRecord(r)) fail('bad rivals');
      count(r.round, 'bad rivals');
      return { ...r, warband: parseWarband(r.warband) };
    });
  }

  const run = next as unknown as RunState;
  // The rules have the last word: a run they can't go on from is no run.
  legalRunActions(run);
  if (phase === 'battle') runBattleConfig(run);
  return run;
}

/** The run in progress, or `null` if there is none this version can read. A finished run counts as none. */
export function loadRun(storage: MapStorage | null): RunState | null {
  try {
    const raw = storage?.getItem(RUN_KEY);
    if (!raw) return null;
    const run = parseRun(JSON.parse(raw));
    return run.phase === 'over' ? null : run;
  } catch {
    return null;
  }
}

/** Keep `run` as the run in progress. Returns whether it was written; never throws. */
export function saveRun(storage: MapStorage | null, run: RunState): boolean {
  try {
    if (!storage) return false;
    storage.setItem(RUN_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

/** Forget the run in progress. Never throws. */
export function clearRun(storage: MapStorage | null): void {
  try {
    storage?.setItem(RUN_KEY, 'null');
  } catch {
    // Unavailable: there was nothing to forget.
  }
}

/** What a run that has just ended leaves in the records. */
export function runRecord(run: RunState, end: RunRecord['end'], now: number = Date.now()): RunRecord {
  return {
    seed: run.seed,
    wins: run.log.filter((r) => r.won).length,
    round: run.round,
    kills: run.log.reduce((sum, r) => sum + r.kills, 0),
    end,
    victorious: runVictorious(run),
    at: now,
    roster: run.roster.map((u) => u.unit.name),
    units: run.roster.map((u) => ({ ...u.unit })),
    ...(run.log.some((r) => r.retreated) ? { retreats: run.log.filter((r) => r.retreated).length } : {}),
  };
}

/** The warbands `records` ended with, as later runs meet them again. */
export function pastWarbands(records: readonly RunRecord[]): Warband[] {
  return records.flatMap((r) => (r.units?.length ? [{ name: `The ${r.end === 'lost' ? 'Fallen' : 'Deserters'} of Round ${r.round}`, units: r.units }] : []));
}

/** Best first: the most battles won, the newer of two equals ahead. */
function byDepth(a: RunRecord, b: RunRecord): number {
  return b.wins - a.wins || b.at - a.at;
}

/** The remembered runs, best first. Corrupt storage or entries are skipped, never thrown. */
export function loadRunRecords(storage: MapStorage | null): RunRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(RUN_RECORDS_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const records: RunRecord[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { seed, wins, round, kills, end, victorious, at, roster, units, retreats } = entry;
    const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
    if (!whole(seed) || !whole(wins) || !whole(round) || !whole(kills) || !whole(at)) continue;
    if (end !== 'lost' && end !== 'abandoned') continue;
    let warband: WarbandUnit[] | undefined;
    try {
      warband = units === undefined ? undefined : parseWarband({ name: '', units }).units;
    } catch {
      // A warband this version can't read is not met again; the record still stands.
    }
    records.push({
      seed,
      wins,
      round,
      kills,
      end,
      victorious: victorious === true,
      at,
      roster: Array.isArray(roster) ? roster.filter((n): n is string => typeof n === 'string') : [],
      ...(warband ? { units: warband } : {}),
      ...(whole(retreats) && retreats > 0 ? { retreats } : {}),
    });
  }
  return records.sort(byDepth);
}

/**
 * Remember a finished run, keeping the best {@link MAX_RUN_RECORDS}. Returns the
 * list as it now stands — with the new record in it even if storage failed, so
 * the screen that ends the run can still show it. Never throws.
 */
export function addRunRecord(storage: MapStorage | null, record: RunRecord): RunRecord[] {
  const records = [...loadRunRecords(storage), record].sort(byDepth).slice(0, MAX_RUN_RECORDS);
  try {
    storage?.setItem(RUN_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Full or unavailable: the record lasts as long as this screen does.
  }
  return records;
}
