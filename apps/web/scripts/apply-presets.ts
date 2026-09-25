/**
 * Fold a preset file exported by the dev preset editor (`?dev=1` → Preset
 * units…) back into the game's code.
 *
 *   pnpm --filter @fansong/web apply-presets <fansong-presets.json> [--check]
 *
 * It reads the file with the editor's own parser (any file version), refuses it
 * if the editor would flag a problem, then rewrites `PRESET_UNITS` and
 * `PRESET_ROSTERS` in packages/content/src/presets.ts and `DEFAULT_SETUP.presets`
 * in packages/content/src/match.ts. Afterwards it re-imports the content package
 * in a fresh process and checks every preset expands to exactly what the editor
 * showed. `--check` validates and reports without writing anything.
 *
 * It prints a report of the follow-up work code can't do mechanically: renamed
 * or deleted warband ids and units that other files may still name, and units
 * with no sprite. Units are keyed by name in code, so a renamed unit gets its
 * new name as its key.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESET_ROSTERS, PRESET_UNITS, type PresetUnit, type Warband, type WarbandUnit } from '@fansong/content';
import { UNIT_SPRITES } from '../src/three/unitSprites.js';
import {
  deletedPresets,
  deletedUnits,
  draftBroken,
  draftChanges,
  entryErrors,
  expandEntry,
  matchupErrors,
  parsePresetsText,
  unitChanged,
  unitErrors,
  usedBy,
  type DraftUnit,
  type PresetDraft,
  type PresetEntry,
} from '../src/ui/presetEditorView.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PRESETS_TS = join(ROOT, 'packages', 'content', 'src', 'presets.ts');
const MATCH_TS = join(ROOT, 'packages', 'content', 'src', 'match.ts');

/** The order unit fields are written in (a unit left untouched keeps its own order). */
const FIELD_ORDER = ['quality', 'combat', 'shooter', 'slow', 'fast', 'tough', 'guard', 'big', 'flying', 'reassembling', 'look'] as const;

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) fail('usage: apply-presets <fansong-presets.json> [--check]');

  const draft = parsePresetsText(readFileSync(resolve(file), 'utf8'));
  const problems = [
    ...matchupErrors(draft),
    ...draft.units.flatMap((u, i) => unitErrors(draft, i).map((e) => `unit "${u.unit.name}": ${e}`)),
    ...draft.presets.flatMap((e, i) => entryErrors(draft, i).map((x) => `warband "${e.name}" (${e.id}): ${x}`)),
  ];
  if (draftBroken(draft)) fail(`The file has problems — fix them in the editor and export again:\n  ${problems.join('\n  ')}`);

  console.log(report(draft));
  if (check) return;

  edit(PRESETS_TS, (src) => replaceBlock(replaceBlock(src, 'PRESET_UNITS', unitsBlock(draft)), 'PRESET_ROSTERS', rostersBlock(draft)));
  edit(MATCH_TS, (src) => replaceMatchup(src, draft.matchup));
  verify(draft);
  console.log('\nWrote packages/content/src/presets.ts and match.ts; every preset expands as the editor showed.');
}

// --- Writing code -------------------------------------------------------------

/**
 * The shared units, grouped under a warband each — the layout presets.ts
 * already has. A shipped unit stays under the warband it shipped in while that
 * warband still fields it (so sharing it elsewhere doesn't move it); any other
 * unit goes under the first warband that fields it, and unused ones go last.
 */
function unitsBlock(draft: PresetDraft): string {
  const home = (u: DraftUnit): number => {
    const fields = (e: PresetEntry): boolean => e.lines.some((l) => l.unit === u.ref);
    const shipped = draft.presets.findIndex(
      (e) => fields(e) && e.source !== undefined && PRESET_ROSTERS[e.source]!.units.some((s) => s.unit === u.source),
    );
    const i = shipped >= 0 ? shipped : draft.presets.findIndex(fields);
    return i < 0 ? draft.presets.length : i;
  };
  const sorted = draft.units.map((u, i) => ({ u, i })).sort((a, b) => home(a.u) - home(b.u) || a.i - b.i);
  const groups: string[] = [];
  let group = -1;
  let lines: string[] = [];
  for (const { u } of sorted) {
    if (home(u) !== group) {
      if (lines.length) groups.push(lines.join('\n'));
      group = home(u);
      lines = [`  // ${draft.presets[group]?.name ?? 'Unused by any warband'}`];
    }
    lines.push(`  ${key(u.unit.name)}: { ${fields(u)} },`);
  }
  if (lines.length) groups.push(lines.join('\n'));
  return groups.join('\n\n') + '\n';
}

function rostersBlock(draft: PresetDraft): string {
  const nameOf = (ref: string): string => draft.units.find((u) => u.ref === ref)!.unit.name;
  return draft.presets
    .map((e) => {
      const lines = e.lines.map((l) => `      { unit: ${str(nameOf(l.unit))}${l.count === 1 ? '' : `, count: ${l.count}`} },`);
      return [`  ${key(e.id)}: {`, `    name: ${str(e.name)},`, '    units: [', ...lines, '    ],', '  },'].join('\n');
    })
    .join('\n') + '\n';
}

/** A unit's fields as code: a shipped unit left untouched keeps its exact shipped form. */
function fields(u: DraftUnit): string {
  const untouched = u.source !== undefined && !unitChanged(u);
  const profile: PresetUnit = untouched ? PRESET_UNITS[u.source!]! : withoutName(u.unit);
  const keys = untouched ? Object.keys(profile) : FIELD_ORDER.filter((k) => profile[k] !== undefined);
  return keys.map((k) => `${k}: ${value(profile[k as keyof PresetUnit])}`).join(', ');
}

function withoutName({ name: _, ...rest }: WarbandUnit): PresetUnit {
  return rest;
}

/** Rewrite a source file, working in `\n` and keeping its own line endings (CRLF on a Windows checkout). */
function edit(path: string, f: (src: string) => string): void {
  const src = readFileSync(path, 'utf8');
  const crlf = src.includes('\r\n');
  const out = f(src.replace(/\r\n/g, '\n'));
  writeFileSync(path, crlf ? out.replace(/\n/g, '\r\n') : out);
}

/** Replace the body of `export const NAME: … = { … };` (up to its closing `};` line). */
function replaceBlock(src: string, name: string, body: string): string {
  const start = src.search(new RegExp(`^export const ${name}\\b[^\\n]*= \\{\\n`, 'm'));
  if (start < 0) fail(`couldn't find ${name} in presets.ts`);
  const open = src.indexOf('{\n', start) + 2;
  const close = src.indexOf('\n};\n', open);
  if (close < 0) fail(`couldn't find the end of ${name} in presets.ts`);
  return src.slice(0, open) + body + src.slice(close + 1);
}

function replaceMatchup(src: string, matchup: [string, string]): string {
  const re = /(export const DEFAULT_SETUP: MatchSetup = \{\n\s*presets: )\[[^\]]*\]/;
  if (!re.test(src)) fail("couldn't find DEFAULT_SETUP.presets in match.ts");
  return src.replace(re, `$1[${str(matchup[0])}, ${str(matchup[1])}]`);
}

const key = (s: string): string => (/^[A-Za-z_$][\w$]*$/.test(s) ? s : str(s));
const str = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const value = (v: unknown): string => (typeof v === 'string' ? str(v) : String(v));

// --- Checking the result ------------------------------------------------------

/** Re-import the content package in a fresh process and compare it with the draft. */
function verify(draft: PresetDraft): void {
  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', '-e', "import('@fansong/content').then((c) => console.log(JSON.stringify({ presets: c.PRESETS, matchup: c.DEFAULT_SETUP.presets })))"],
    { cwd: join(ROOT, 'apps', 'web'), encoding: 'utf8' },
  );
  const got = JSON.parse(out) as { presets: Record<string, Warband>; matchup: string[] };
  const want = Object.fromEntries(draft.presets.map((e) => [e.id, expandEntry(draft, e)]));
  const norm = (w: Record<string, Warband>) => JSON.stringify(Object.entries(w).map(([id, b]) => [id, b.name, b.units.map(sortKeys)]));
  if (norm(got.presets) !== norm(want)) fail('the rewritten presets do not match the file — check presets.ts by hand');
  if (got.matchup.join() !== draft.matchup.join()) fail('the rewritten default matchup does not match the file');
}

function sortKeys(u: WarbandUnit): [string, unknown][] {
  return Object.entries(u).sort(([a], [b]) => a.localeCompare(b));
}

// --- The report ---------------------------------------------------------------

function report(draft: PresetDraft): string {
  const renamedIds = draft.presets.filter((e) => e.source !== undefined && e.id !== e.source).map((e) => `${e.source} → ${e.id}`);
  const renamedUnits = draft.units.filter((u) => u.source !== undefined && u.unit.name !== u.source).map((u) => `${u.source} → ${u.unit.name}`);
  const noSprite = draft.units
    .filter((u) => !((u.unit.look ?? u.unit.name) in UNIT_SPRITES))
    .map((u) => u.unit.name);
  const unused = draft.units.filter((u) => usedBy(draft, u.ref).length === 0).map((u) => u.unit.name);
  const section = (title: string, items: string[]): string => `${title}:${items.length ? items.map((i) => `\n  - ${i}`).join('') : ' none'}`;
  return [
    section('Changes', draftChanges(draft)),
    section('Warband ids renamed (other files may still use the old id)', renamedIds),
    section('Warband ids deleted (other files may still use them)', deletedPresets(draft)),
    section('Units renamed (tests or docs may still use the old name)', renamedUnits),
    section('Units deleted', deletedUnits(draft)),
    section('Units with no sprite (drawn with the fallback)', noSprite),
    section('Units no warband fields (kept in PRESET_UNITS)', unused),
    `Default matchup: ${draft.matchup[0]} vs ${draft.matchup[1]}`,
    `Shipped before: ${Object.keys(PRESET_ROSTERS).length} warbands, ${Object.keys(PRESET_UNITS).length} units. After: ${draft.presets.length} warbands, ${draft.units.length} units.`,
  ].join('\n');
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main();
