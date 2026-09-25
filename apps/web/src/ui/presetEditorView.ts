import {
  DEFAULT_RULES,
  DEFAULT_SETUP,
  expandRoster,
  NAME_LIMITS,
  parseWarband,
  PRESET_IDS,
  PRESET_ROSTERS,
  PRESET_UNITS,
  presetUnit,
  statErrors,
  validateWarband,
  type Warband,
  type WarbandUnit,
} from '@fansong/content';
import { UNIT_SPRITES } from '../three/unitSprites.js';
import { blankUnit, uniqueName } from './armyView.js';

/**
 * The dev-only preset editor's model: a working copy of the shared preset units,
 * the preset warbands built from them (in menu order), and the setup screen's
 * default matchup. It is edited in the browser, exported as a file, and that
 * file is folded back into `packages/content` by hand — so nothing here changes
 * the game for anyone until then.
 */
export interface PresetDraft {
  /** Every shared unit, in the order they're listed in code. */
  units: DraftUnit[];
  presets: PresetEntry[];
  /** The two warbands (by id) a new setup starts with. */
  matchup: [string, string];
}

/** A shared unit. Warbands point at it by `ref`, so renaming it doesn't break them. */
export interface DraftUnit {
  /** Stable handle inside the draft (a shipped unit's original name, or `unit-N`). */
  ref: string;
  /** The shipped unit this one was edited from, if any. */
  source?: string;
  unit: WarbandUnit;
}

/** One line of a warband's roster: a shared unit, and how many of it. */
export interface RosterLine {
  unit: string;
  count: number;
}

/** One warband in the draft. */
export interface PresetEntry {
  /** Its id in code, saved setups and the CLI (e.g. `iron-wardens`). */
  id: string;
  /** The shipped preset this one was edited from, if any — so an id change reads as a rename. */
  source?: string;
  name: string;
  lines: RosterLine[];
}

/** Tags an exported file so a stray army or replay isn't mistaken for one. */
export const PRESET_FILE_FORMAT = 'fansong-presets';
export const PRESET_FILE_VERSION = 3;
export const PRESET_FILE_NAME = 'fansong-presets.json';

/** Where the working draft is autosaved between visits. */
export const PRESET_DRAFT_KEY = 'fansong.presetDraft';

/** Longest preset id the editor accepts. */
export const MAX_PRESET_ID = 40;

/** A fresh draft: a copy of the shipped units, warbands and matchup. */
export function draftFromPresets(): PresetDraft {
  return {
    units: Object.keys(PRESET_UNITS).map((name) => ({ ref: name, source: name, unit: presetUnit(name)! })),
    presets: PRESET_IDS.map((id) => ({ id, source: id, ...shippedRoster(id) })),
    matchup: [...DEFAULT_SETUP.presets],
  };
}

// --- Looking things up ------------------------------------------------------

/** The shared unit with this ref, if any. */
export function unitByRef(draft: PresetDraft, ref: string): DraftUnit | undefined {
  return draft.units.find((u) => u.ref === ref);
}

/** A warband as it will play: its lines expanded into units (numbered copies for counts). */
export function expandEntry(draft: PresetDraft, e: PresetEntry): Warband {
  return expandRoster({ name: e.name, units: e.lines }, (ref) => unitByRef(draft, ref)?.unit);
}

/** The warbands that field the unit with this ref. */
export function usedBy(draft: PresetDraft, ref: string): PresetEntry[] {
  return draft.presets.filter((e) => e.lines.some((l) => l.unit === ref));
}

// --- Validation -------------------------------------------------------------

/**
 * Rename a unit without losing its sprite: a preset unit is drawn by its name,
 * so one renamed away from its sprite's name keeps it as its `look`.
 */
export function renameUnit(unit: WarbandUnit, name: string): WarbandUnit {
  if (unit.look === undefined && unit.name in UNIT_SPRITES && !(name in UNIT_SPRITES)) return { ...unit, name, look: unit.name };
  return { ...unit, name };
}

/** Problems with the shared unit at `i`: its stats, and a name that's present, short and unique. */
export function unitErrors(draft: PresetDraft, i: number): string[] {
  const { unit } = draft.units[i]!;
  const errors = statErrors(unit);
  if (unit.name.trim() === '') errors.unshift('needs a name');
  else if (draft.units.some((u, j) => j !== i && u.unit.name === unit.name)) errors.unshift('another unit has this name');
  if (unit.name.length > NAME_LIMITS.unit) errors.push(`name is over ${NAME_LIMITS.unit} characters`);
  return errors;
}

/** Every problem with one expanded preset: the preset rules, plus names that must be present and distinct. */
export function presetErrors(w: Warband): string[] {
  const errors = validateWarband(w, DEFAULT_RULES).errors;
  if (w.name.trim() === '') errors.unshift('the preset needs a name');
  const seen = new Set<string>();
  w.units.forEach((u, i) => {
    if (u.name.trim() === '') errors.push(`unit ${i + 1} needs a name`);
    else if (seen.has(u.name)) errors.push(`two units are named "${u.name}"`);
    seen.add(u.name);
  });
  return errors;
}

/** Problems with the id of the warband at `i`: its shape, and clashes with the others. */
export function idErrors(draft: PresetDraft, i: number): string[] {
  const id = draft.presets[i]!.id;
  if (id === '') return ['the preset needs an id'];
  const errors: string[] = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) errors.push('the id must be lowercase letters and digits, joined by single dashes');
  if (id.length > MAX_PRESET_ID) errors.push(`the id is over ${MAX_PRESET_ID} characters`);
  if (draft.presets.some((e, j) => j !== i && e.id === id)) errors.push(`another preset already has the id "${id}"`);
  return errors;
}

/** Everything wrong with the warband at `i`: its id, its lines, and the warband they make. */
export function entryErrors(draft: PresetDraft, i: number): string[] {
  const e = draft.presets[i]!;
  const errors = idErrors(draft, i);
  const seen = new Set<string>();
  for (const line of e.lines) {
    const name = unitByRef(draft, line.unit)?.unit.name ?? line.unit;
    if (seen.has(line.unit)) errors.push(`${name} is listed twice — raise its count instead`);
    seen.add(line.unit);
    if (!Number.isInteger(line.count) || line.count < 1) errors.push(`${name}: the count must be a whole number, at least 1`);
  }
  return [...errors, ...presetErrors(expandEntry(draft, e))];
}

/** Problems with the default matchup: it must name warbands still in the draft. */
export function matchupErrors(draft: PresetDraft): string[] {
  return draft.matchup
    .filter((id) => !draft.presets.some((e) => e.id === id))
    .map((id) => `the default matchup names "${id}", which is no longer a preset`);
}

/** Whether the draft can't be applied as it stands. */
export function draftBroken(draft: PresetDraft): boolean {
  return (
    matchupErrors(draft).length > 0 ||
    draft.units.some((_, i) => unitErrors(draft, i).length > 0) ||
    draft.presets.some((_, i) => entryErrors(draft, i).length > 0)
  );
}

// --- What changed -----------------------------------------------------------

/** Whether a shared unit differs from the shipped one it came from (a new one always does). */
export function unitChanged(u: DraftUnit): boolean {
  const shipped = u.source === undefined ? undefined : presetUnit(u.source);
  return !shipped || canonicalUnit(shipped) !== canonicalUnit(u.unit);
}

/** Whether a warband's name or roster lines differ from the shipped ones (a new one always does). */
export function rosterChanged(draft: PresetDraft, e: PresetEntry): boolean {
  if (e.source === undefined || !(e.source in PRESET_ROSTERS)) return true;
  const shipped = shippedRoster(e.source);
  // Lines are compared by which shipped unit they field, so a unit's own edits don't count here.
  const key = (lines: RosterLine[], ref: (r: string) => string) => lines.map((l) => `${ref(l.unit)}×${l.count}`).join();
  return (
    shipped.name !== e.name ||
    key(shipped.lines, (r) => r) !== key(e.lines, (r) => unitByRef(draft, r)?.source ?? `new:${r}`)
  );
}

/** Whether anything about a warband differs from what ships: id, name or roster. */
export function entryChanged(draft: PresetDraft, e: PresetEntry): boolean {
  return e.id !== e.source || rosterChanged(draft, e);
}

/** Shipped preset ids no warband in the draft came from (deleted in the editor). */
export function deletedPresets(draft: PresetDraft): string[] {
  return PRESET_IDS.filter((id) => !draft.presets.some((e) => e.source === id));
}

/** Shipped unit names no shared unit in the draft came from (deleted in the editor). */
export function deletedUnits(draft: PresetDraft): string[] {
  return Object.keys(PRESET_UNITS).filter((name) => !draft.units.some((u) => u.source === name));
}

/**
 * Every change from what ships, in words — shown in the editor and written
 * into the export so whoever applies it knows what moved where.
 */
export function draftChanges(draft: PresetDraft): string[] {
  const changes: string[] = [];
  for (const u of draft.units) {
    if (u.source === undefined) changes.push(`added unit "${u.unit.name}"`);
    else if (unitChanged(u)) {
      changes.push(u.unit.name === u.source ? `edited unit "${u.source}"` : `edited unit "${u.source}" (now "${u.unit.name}")`);
    }
  }
  for (const name of deletedUnits(draft)) changes.push(`deleted unit "${name}"`);
  for (const e of draft.presets) {
    if (e.source === undefined) changes.push(`added warband "${e.name}" (${e.id})`);
    else {
      if (e.id !== e.source) changes.push(`id ${e.source} → ${e.id}`);
      if (rosterChanged(draft, e)) changes.push(`edited warband "${e.name}" (${e.id})`);
    }
  }
  for (const id of deletedPresets(draft)) changes.push(`deleted warband "${PRESET_ROSTERS[id]!.name}" (${id})`);
  const kept = draft.presets.flatMap((e) => (e.source === undefined ? [] : [e.source]));
  if (kept.join() !== PRESET_IDS.filter((id) => kept.includes(id)).join()) changes.push('reordered the warbands');
  // Compared by where each pick came from, so renaming a matched warband's id isn't a new matchup.
  const picked = draft.matchup.map((id) => draft.presets.find((e) => e.id === id)?.source);
  if (picked.join() !== DEFAULT_SETUP.presets.join()) changes.push(`default matchup ${draft.matchup[0]} vs ${draft.matchup[1]}`);
  return changes;
}

// --- Edits ------------------------------------------------------------------

/** An id built from `base` that no warband in the draft has: `base`, `base-2`, … */
export function freePresetId(draft: PresetDraft, base: string): string {
  const taken = new Set(draft.presets.map((e) => e.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** An id-shaped version of a name: `Iron Wardens` → `iron-wardens`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_PRESET_ID)
    .replace(/-+$/, '');
}

/** Change the id of the warband at `i`, carrying the default matchup along with it. */
export function setPresetId(draft: PresetDraft, i: number, id: string): PresetDraft {
  const old = draft.presets[i]!.id;
  return {
    ...draft,
    presets: draft.presets.map((e, j) => (j === i ? { ...e, id } : e)),
    matchup: draft.matchup.map((m) => (m === old ? id : m)) as [string, string],
  };
}

/** Apply `f` to the warband at `i`. */
export function updateEntry(draft: PresetDraft, i: number, f: (e: PresetEntry) => PresetEntry): PresetDraft {
  return { ...draft, presets: draft.presets.map((e, j) => (j === i ? f(e) : e)) };
}

/** Replace the shared unit with this ref — every warband fielding it changes with it. */
export function setUnit(draft: PresetDraft, ref: string, unit: WarbandUnit): PresetDraft {
  return { ...draft, units: draft.units.map((u) => (u.ref === ref ? { ...u, unit } : u)) };
}

/** Add a shared unit, named uniquely among the others. Returns the new draft and the unit's ref. */
export function addUnit(draft: PresetDraft, unit: WarbandUnit): [PresetDraft, string] {
  const ref = freeRef(draft);
  const name = uniqueName(unit.name, draft.units.map((u) => u.unit));
  return [{ ...draft, units: [...draft.units, { ref, unit: { ...unit, name } }] }, ref];
}

/** A new plain shared unit. */
export function newUnit(draft: PresetDraft): [PresetDraft, string] {
  return addUnit(draft, blankUnit(draft.units.map((u) => u.unit)));
}

/** A new shared unit copied from the one with this ref, drawn as it. */
export function copyUnit(draft: PresetDraft, ref: string): [PresetDraft, string] {
  const { unit } = unitByRef(draft, ref)!;
  return addUnit(draft, { ...unit, look: unit.look ?? unit.name });
}

/** Delete a shared unit, and take it out of every warband that fields it. */
export function deleteUnit(draft: PresetDraft, ref: string): PresetDraft {
  return {
    ...draft,
    units: draft.units.filter((u) => u.ref !== ref),
    presets: draft.presets.map((e) => ({ ...e, lines: e.lines.filter((l) => l.unit !== ref) })),
  };
}

/** Add a unit to the warband at `i`: one more of it if it's already there, else a new line. */
export function addLine(draft: PresetDraft, i: number, ref: string): PresetDraft {
  return updateEntry(draft, i, (e) =>
    e.lines.some((l) => l.unit === ref)
      ? { ...e, lines: e.lines.map((l) => (l.unit === ref ? { ...l, count: l.count + 1 } : l)) }
      : { ...e, lines: [...e.lines, { unit: ref, count: 1 }] },
  );
}

/**
 * Give the warband at `i` its own copy of the unit on line `line`, so editing it
 * there stops changing the other warbands that share it.
 */
export function forkLine(draft: PresetDraft, i: number, line: number): PresetDraft {
  const [next, ref] = copyUnit(draft, draft.presets[i]!.lines[line]!.unit);
  return updateEntry(next, i, (e) => ({ ...e, lines: e.lines.map((l, k) => (k === line ? { ...l, unit: ref } : l)) }));
}

/** A new warband: three of a new plain unit, under a free id. */
export function newPreset(draft: PresetDraft): PresetDraft {
  const [next, ref] = newUnit(draft);
  const entry: PresetEntry = { id: freePresetId(draft, 'new-preset'), name: 'New Preset', lines: [{ unit: ref, count: DEFAULT_RULES.minUnits }] };
  return { ...next, presets: [...next.presets, entry] };
}

/**
 * Put a shipped warband's name and roster back — at `i`, or appended when `i`
 * is omitted (restoring a deleted one). Shipped units it needs that were
 * deleted come back too; edits to units it still shares are kept.
 */
export function restorePreset(draft: PresetDraft, source: string, i?: number): PresetDraft {
  let next = draft;
  const shipped = shippedRoster(source);
  const lines = shipped.lines.map((l) => {
    let ref = next.units.find((u) => u.source === l.unit)?.ref;
    if (ref === undefined) {
      ref = next.units.some((u) => u.ref === l.unit) ? freeRef(next) : l.unit;
      next = { ...next, units: [...next.units, { ref, source: l.unit, unit: presetUnit(l.unit)! }] };
    }
    return { ...l, unit: ref };
  });
  if (i !== undefined) return updateEntry(next, i, (e) => ({ ...e, name: shipped.name, lines }));
  return { ...next, presets: [...next.presets, { id: freePresetId(next, source), source, name: shipped.name, lines }] };
}

/** Put a deleted shipped unit back in the shared list. */
export function restoreUnit(draft: PresetDraft, name: string): PresetDraft {
  const ref = draft.units.some((u) => u.ref === name) ? freeRef(draft) : name;
  return { ...draft, units: [...draft.units, { ref, source: name, unit: presetUnit(name)! }] };
}

// --- Files and storage ------------------------------------------------------

/** The export file's text: the shared units, the warbands in order, the matchup, and a summary of the changes. */
export function presetsToJson(draft: PresetDraft): string {
  return JSON.stringify(
    {
      format: PRESET_FILE_FORMAT,
      version: PRESET_FILE_VERSION,
      changes: draftChanges(draft),
      matchup: draft.matchup,
      units: draft.units.map((u) => ({ ref: u.ref, source: u.source, ...u.unit })),
      presets: draft.presets.map((e) => ({ id: e.id, source: e.source, name: e.name, units: e.lines })),
    },
    null,
    2,
  );
}

/** Parse an exported presets file (any version) back into a draft. Throws a friendly `Error`. */
export function parsePresetsText(text: string): PresetDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file.');
  }
  if (!isRecord(raw) || raw.format !== PRESET_FILE_FORMAT) throw new Error('Not a presets file.');
  const matchup = parseMatchup(raw.matchup);
  // Version 1 was an id → warband record; version 2 a list of warbands each with their own units.
  if (raw.version === 1 && isRecord(raw.presets)) {
    return fromWarbands(Object.entries(raw.presets).map(([id, w]) => ({ id, source: id, warband: parseWarband(w) })), matchup);
  }
  if (!Array.isArray(raw.presets)) throw new Error('Not a presets file.');
  if (raw.version === 2) {
    return fromWarbands(
      raw.presets.map((p: unknown, i) => {
        if (!isRecord(p) || typeof p.id !== 'string') throw new Error(`Preset ${i + 1} has no id.`);
        return { id: p.id, source: typeof p.source === 'string' ? p.source : undefined, warband: parseWarband(p) };
      }),
      matchup,
    );
  }
  if (!Array.isArray(raw.units)) throw new Error('Not a presets file.');
  const units = raw.units.map((u: unknown, i): DraftUnit => {
    if (!isRecord(u) || typeof u.ref !== 'string') throw new Error(`Unit ${i + 1} has no ref.`);
    const unit = parseWarband({ name: '', units: [u] }).units[0]!;
    return { ref: u.ref, ...(typeof u.source === 'string' && u.source in PRESET_UNITS ? { source: u.source } : {}), unit };
  });
  const presets = raw.presets.map((p: unknown, i): PresetEntry => {
    if (!isRecord(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.units))
      throw new Error(`Preset ${i + 1} is malformed.`);
    const lines = p.units.map((l: unknown): RosterLine => {
      if (!isRecord(l) || typeof l.unit !== 'string' || !units.some((u) => u.ref === l.unit))
        throw new Error(`${p.name as string} names a unit that isn't in the file.`);
      return { unit: l.unit, count: typeof l.count === 'number' ? l.count : 1 };
    });
    return { id: p.id, ...shippedSource(p.source), name: p.name, lines };
  });
  return { units, presets, matchup };
}

/** The autosaved draft, or `null` if there is none (or it won't parse). */
export function loadPresetDraft(storage: Pick<Storage, 'getItem'> | null): PresetDraft | null {
  const text = storage?.getItem(PRESET_DRAFT_KEY);
  if (!text) return null;
  try {
    return parsePresetsText(text);
  } catch {
    return null;
  }
}

/** Autosave the draft; a full or blocked storage is not worth interrupting the editor over. */
export function savePresetDraft(storage: Pick<Storage, 'setItem'> | null, draft: PresetDraft): void {
  try {
    storage?.setItem(PRESET_DRAFT_KEY, presetsToJson(draft));
  } catch {
    // ignore
  }
}

/**
 * Carry an older draft, where each warband held its own units, over to shared
 * units. A shipped warband's unit at a shipped position is taken as an edit of
 * the shipped unit there (so renames and stat changes carry over); anything
 * else reuses an identical unit of the same name, or becomes a new shared unit.
 */
function fromWarbands(entries: { id: string; source?: string; warband: Warband }[], matchup: [string, string]): PresetDraft {
  let draft: PresetDraft = { ...draftFromPresets(), presets: [], matchup };
  const claimed = new Set<string>();
  for (const { id, source, warband } of entries) {
    const shipped = source === undefined ? undefined : PRESET_ROSTERS[source];
    const lines = warband.units.map((unit, k): RosterLine => {
      const was = shipped?.units[k]?.unit;
      if (was !== undefined && !claimed.has(was)) {
        claimed.add(was);
        draft = setUnit(draft, was, unit);
        return { unit: was, count: 1 };
      }
      const same = draft.units.find((u) => u.unit.name === unit.name && canonicalUnit(u.unit) === canonicalUnit(unit));
      if (same) return { unit: same.ref, count: 1 };
      const [next, ref] = addUnit(draft, unit);
      draft = next;
      return { unit: ref, count: 1 };
    });
    draft = { ...draft, presets: [...draft.presets, { id, ...shippedSource(source), name: warband.name, lines }] };
  }
  return draft;
}

// --- Helpers ----------------------------------------------------------------

/** A shipped warband's name and roster as draft lines (refs are the shipped unit names). */
function shippedRoster(id: string): { name: string; lines: RosterLine[] } {
  const roster = PRESET_ROSTERS[id]!;
  return { name: roster.name, lines: roster.units.map((s) => ({ unit: s.unit, count: s.count ?? 1 })) };
}

/** A ref no shared unit has: `unit-1`, `unit-2`, … */
function freeRef(draft: PresetDraft): string {
  let n = 1;
  while (draft.units.some((u) => u.ref === `unit-${n}`)) n++;
  return `unit-${n}`;
}

function shippedSource(source: unknown): { source?: string } {
  return typeof source === 'string' && source in PRESET_ROSTERS ? { source } : {};
}

function parseMatchup(m: unknown): [string, string] {
  return Array.isArray(m) && m.length === 2 && typeof m[0] === 'string' && typeof m[1] === 'string'
    ? [m[0], m[1]]
    : [...DEFAULT_SETUP.presets];
}

/** A unit's JSON with keys in one order and unset traits dropped, for comparing. */
function canonicalUnit(u: WarbandUnit): string {
  return JSON.stringify(parseWarband({ name: '', units: [u] }).units[0]);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
