/**
 * Survey every unit sprite in a local Wesnoth checkout and write sprite-report.md.
 *
 *   pnpm --filter @fansong/web survey [path/to/wesnoth]   (default: $WESNOTH_DIR or ../wesnoth)
 *
 * Runs the importer's WML reader (wesnoth-wml.ts) over every [unit_type], not
 * just the ones in UNIT_SPRITES, so the report lists the clips the importer
 * would really produce for each, which are in the game already, and which
 * animation macros it still cannot read. Re-run it after changing the reader
 * or UNIT_SPRITES; the report is never edited by hand.
 */
import { closeSync, existsSync, openSync, readSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RIDING_SPRITES, UNIT_SPRITES } from '../src/three/unitSprites.js';
import type { Clip, SpriteAnimations } from '../src/three/unitAnimations.js';
import { allUnitTypes, baseImage, buildAnimations, CORE, IMAGES, SKIP_CLIPS, WEB } from './wesnoth-wml.js';

const OUT = join(WEB, '..', '..', 'sprite-report.md');
/** A look is worth importing when one of its attacks shows at least this many different images. */
const MIN_ATTACK_FRAMES = 3;

type ClipName = keyof SpriteAnimations;
type Fit = 'foot' | 'mounted' | 'beast' | 'large' | 'vehicle';

interface Row {
  id: string;
  group: string;
  level: string;
  hp: string;
  /** Base image relative to `images/units/`, as it goes into UNIT_SPRITES; undefined when there is none there. */
  sprite?: string;
  size?: [number, number];
  fit: Fit;
  /** Different images in each variant of each clip. */
  clips: Partial<Record<ClipName, number[]>>;
  looks: string[];
  /** Why it is not in the game; undefined when it is, or could be. */
  out?: string;
  score: number;
  rank: number;
}

const CLIPS: [ClipName, string, number, string][] = [
  ['melee', 'melee', 3, 'The attack swing; extra variants are picked at random per blow'],
  ['ranged', 'ranged', 2, 'A shot, with its projectile'],
  ['defendMelee', 'def-m', 2, "The defender's flinch on every melee blow"],
  ['defendRanged', 'def-r', 1, "The defender's flinch on an incoming shot"],
  ['death', 'death', 4, 'A kill, and the source of the knocked-down pose'],
  ['move', 'move', 1.5, 'Loops while a unit slides between hexes'],
  ['standing', 'stand', 1, 'Breathing loop at rest'],
  ['idle', 'idle', 1, 'Occasional flourish at rest'],
  ['leading', 'lead', 3, "A leader's rally when it activates"],
  ['victory', 'win', 0.5, 'Unused so far'],
];
const FIT_SCORE: Record<Fit, number> = { foot: 2, mounted: 1, beast: 0, large: -2, vehicle: -8 };
const BEAST_GROUPS = new Set(['monsters', 'bats', 'gryphons']);
/** Macros that are sounds, traits or filters, or that the reader already turns into clips. */
const READ_MACROS = /^(SOUND|TRAIT_|AMLA_|DEFENSE_ANIM|LEADING_ANIM$|STANDARD_IDLE_FILTER$|STANDING_COMBAT_FILTER$|WOUNDED_UNIT$|MISSILE_FRAME_(STONE|HATCHET|WAIL|ICE|FAERIE|CHILL|SHADOW|FIREBALL|FIRE_BREATH))/;
const ANIMATION_MACRO = /ANIM|FRAME|HALO|FLARE|BOLT|MISSILE|FOG|GRAPHICS/;

function pngSize(file: string): [number, number] {
  const fd = openSync(file, 'r');
  const header = Buffer.alloc(24);
  readSync(fd, header, 0, 24, 0);
  closeSync(fd);
  return [header.readUInt32BE(16), header.readUInt32BE(20)];
}

const looksOf = new Map<string, string[]>();
for (const [look, sprite] of Object.entries(UNIT_SPRITES)) looksOf.set(sprite, [...(looksOf.get(sprite) ?? []), look]);

const unread = new Map<string, Set<string>>();
const firstWith = new Map<string, string>();
const rows: Row[] = allUnitTypes().map((ut) => {
  const { node } = ut;
  const id = node.attrs.id ?? '?';
  const group = relative(join(CORE, 'units'), ut.file).split(/[\\/]/)[0]!;
  const image = baseImage(ut);
  const onDisk = image !== undefined && existsSync(join(IMAGES, image));
  const sprite = onDisk && image.startsWith('units/') ? image.slice('units/'.length) : undefined;
  const size = onDisk ? pngSize(join(IMAGES, image)) : undefined;

  const anims = buildAnimations(node, false);
  for (const clip of (sprite && SKIP_CLIPS[sprite]) || []) delete anims[clip];
  const clips: Row['clips'] = {};
  for (const [name, value] of Object.entries(anims) as [ClipName, Clip | Clip[]][]) {
    clips[name] = [value].flat().map((c) => new Set(c.frames.map(([p]) => p)).size);
  }
  for (const mac of [...node.macros, ...node.kids.flatMap((k) => k.macros)]) {
    const name = /^\{([\w:]+)/.exec(mac)?.[1];
    if (!name || READ_MACROS.test(name) || !ANIMATION_MACRO.test(name)) continue;
    if (!unread.has(name)) unread.set(name, new Set());
    unread.get(name)!.add(id);
  }

  const vehicle = group === 'boats' || group === 'fake';
  const mounted = /mounted|horse/.test(node.attrs.movement_type ?? '') || (sprite !== undefined && RIDING_SPRITES.has(sprite));
  const fit: Fit = vehicle ? 'vehicle' : size && (size[0] > 88 || size[1] > 96) ? 'large' : mounted ? 'mounted' : BEAST_GROUPS.has(group) ? 'beast' : 'foot';

  const attack = Math.max(0, ...(clips.melee ?? []), ...(clips.ranged ?? []));
  const looks = (sprite && looksOf.get(sprite)) || [];
  let out: string | undefined;
  if (looks.length === 0) {
    if (vehicle) out = group === 'boats' ? 'a ship' : 'not a real unit';
    else if (!sprite) out = 'no base image';
    else if (attack < MIN_ATTACK_FRAMES) out = attack === 0 ? 'no attack clip' : `attack of ${attack} frame${attack === 1 ? '' : 's'}`;
    else if (firstWith.has(sprite)) out = `same sprite as ${firstWith.get(sprite)}`;
  }
  if (sprite && !firstWith.has(sprite)) firstWith.set(sprite, id);

  let score = FIT_SCORE[fit] + (sprite ? 0 : -4);
  for (const [name, , points] of CLIPS) if (clips[name]) score += points;
  score += Math.min(1, 0.5 * ((clips.melee?.length ?? 1) - 1));
  return { id, group, level: node.attrs.level ?? '?', hp: node.attrs.hitpoints ?? '?', sprite, size, fit, clips, looks, out, score, rank: 0 };
});

[...rows].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).forEach((r, i) => (r.rank = i + 1));
const ranked = [...rows].sort((a, b) => a.rank - b.rank);

// --- markdown ---------------------------------------------------------------

const animations = (r: Row): string =>
  CLIPS.filter(([name]) => r.clips[name])
    .map(([name, short]) => `${short}(${r.clips[name]!.join(',')})`)
    .join(' ') || '—';
const inGame = (r: Row): string =>
  r.looks.length ? `✅ ${r.looks[0]}${r.looks.length > 1 ? ` +${r.looks.length - 1}` : ''}` : (r.out ?? 'not imported');
const spriteCell = (r: Row): string => (r.sprite ? `\`${r.sprite}\`` : '—');

function table(head: string[], right: number[], body: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map((_, i) => (right.includes(i) ? '--:' : '---'))), ...body.map(line)].join('\n');
}
const unitTable = (list: Row[]): string =>
  table(
    ['#', 'Unit', 'Lvl', 'HP', 'Fit', 'Sprite', 'Animations', 'Score', 'In the game'],
    [0, 2, 3, 7],
    list.map((r) => [r.rank, r.id, r.level, r.hp, r.fit, spriteCell(r), animations(r), r.score, inGame(r)]),
  );

const total = rows.length;
const withSprite = rows.filter((r) => r.sprite).length;
const imported = rows.filter((r) => r.looks.length > 0);
const candidates = rows.filter((r) => r.looks.length === 0 && !r.out);
const share = (n: number) => `${Math.round((100 * n) / total)}%`;
const has = (r: Row, ...names: ClipName[]) => names.every((n) => r.clips[n]);
const top = (list: Row[], n: number) => list.slice(0, n);

const groups = [...new Set(rows.map((r) => r.group))].sort(
  (a, b) => rows.filter((r) => r.group === b).length - rows.filter((r) => r.group === a).length || a.localeCompare(b),
);
const reasons = new Map<string, Row[]>();
for (const r of rows.filter((x) => x.out)) {
  const reason = r.out!.startsWith('same sprite') ? 'the same sprite as a unit already listed' : r.out!.startsWith('attack of') ? `an attack of fewer than ${MIN_ATTACK_FRAMES} frames` : r.out!;
  reasons.set(reason, [...(reasons.get(reason) ?? []), r]);
}

const md = `# Wesnoth unit sprites — what we can use

Every \`[unit_type]\` in the local Wesnoth checkout (\`data/core/units/**/*.cfg\`), with
the animations **FanSong's importer actually produces for it**, ranked by how much
use each one is to this game, and marked with whether it is in the game already.

Generated by [survey-wesnoth.ts](apps/web/scripts/survey-wesnoth.ts) — do not edit by
hand; re-run \`pnpm --filter @fansong/web survey C:\\Repos\\wesnoth\` after changing the
importer's WML reader or \`UNIT_SPRITES\`. It runs the same reader as the importer
([wesnoth-wml.ts](apps/web/scripts/wesnoth-wml.ts)) over every unit type, so the clip
lists here are not what Wesnoth *has* but what we *get*: front-facing
(\`s\`/\`se\`/\`sw\`) branches only, the first side of each hit/miss \`[if]\`, and only the
macros the reader understands.

**${total} unit types**, ${withSprite} with a base sprite under \`images/units/\`.
**${imported.length} are in the game** (${new Set(imported.map((r) => r.sprite)).size} sprites, ${Object.keys(UNIT_SPRITES).length} looks in \`UNIT_SPRITES\`).
${candidates.length === 0 ? `Nothing with an attack clip of ${MIN_ATTACK_FRAMES} or more frames is left to import.` : `**${candidates.length} more** have an attack clip of ${MIN_ATTACK_FRAMES} or more frames and are not imported yet: ${candidates.map((r) => r.id).join(', ')}.`}

## What the art covers

| Clip | Units | Share | What FanSong does with it |
|------|------:|------:|---------------------------|
${[...CLIPS]
  .map(([name, , , what]) => [name, rows.filter((r) => r.clips[name]).length, what] as const)
  .sort((a, b) => b[1] - a[1])
  .map(([name, n, what]) => `| \`${name}\` | ${n} | ${share(n)} | ${what} |`)
  .join('\n')}

Attack and defend animations are near-universal, so almost any unit fights
convincingly. Death and movement clips are the scarce goods. A unit with no \`death\`
clip just fades out, and has no frame to freeze on when it is knocked down, so it
falls back to the squash pose (see \`DOWN_POSES\` in
[unitSprites.ts](apps/web/src/three/unitSprites.ts)); a unit with no \`move\` clip
slides, unless \`pnpm --filter @fansong/web walks\` has a rig for it.

## How to read the tables

- **Animations**: \`melee(8)\` is one clip showing 8 different images; \`melee(5,7)\` is
  two variants. Repeats of an image are not counted, so the number is how much
  motion there is, not how long the clip lasts.
- **In the game**: ✅ and the look (the \`UNIT_SPRITES\` key) that draws it, with \`+n\`
  when more looks share the sprite. Otherwise the reason it is left out. A unit
  qualifies when one of its attacks shows ${MIN_ATTACK_FRAMES} or more different images.
- **Fit**: foot, mounted, beast, large (base image over 88×96 px) or vehicle.
- **Score** adds up the clips a unit has, weighted by how often FanSong plays them
  and how hard they are to fake, plus a modifier for the fit:

\`\`\`
${CLIPS.map(([name, , points]) => `${name.padEnd(13)}+${points}`).join('\n')}
extra melee variants  +0.5 each, up to +1
fit: foot +2, mounted +1, beast 0, large −2, vehicle −8; no base image −4
\`\`\`

## The short list

### Best all-round warband bodies

Foot units with the full loop: swing, flinch **and a death clip**.

${unitTable(top(ranked.filter((r) => r.fit === 'foot' && has(r, 'melee', 'defendMelee', 'death')), 30))}

### Leaders

Every unit with a \`leading\` rally, the only sprites that can play the leader
gesture.

${unitTable(ranked.filter((r) => has(r, 'leading')))}

### Shooters

The best-animated units with a ranged attack.

${unitTable(top(ranked.filter((r) => has(r, 'ranged') && r.fit !== 'vehicle'), 25))}

### Riders

${unitTable(top(ranked.filter((r) => r.fit === 'mounted'), 20))}

### Beasts and monsters

${unitTable(top(ranked.filter((r) => r.fit === 'beast'), 25))}

## Left out

${[...reasons]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([reason, list]) => `- **${reason[0]!.toUpperCase()}${reason.slice(1)}** (${list.length}): ${list.map((r) => r.id).join(', ')}.`)
  .join('\n')}

## What the reader still cannot read

${
  unread.size === 0
    ? 'Every animation macro these units call is understood.'
    : `Animation macros the unit files call that the reader skips. None of them costs a
whole clip the game plays: they are halos, muzzle flashes, ship-only clips and
standing poses on special terrain.

${table(
  ['Macro', 'Units', 'Used by'],
  [1],
  [...unread]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .map(([name, ids]) => [`\`${name}\``, ids.size, [...ids].slice(0, 4).join(', ') + (ids.size > 4 ? ', …' : '')]),
)}`
}

Other gaps, by design:

- **North-facing art is never read.** FanSong draws every unit from the front.
- **Swimming variants are skipped** (\`-float\`, \`-water\` frames): there is no water to
  swim in here.
- **Clips dropped by hand** in \`SKIP_CLIPS\`, because their WML names frames Wesnoth
  does not ship: ${Object.entries(SKIP_CLIPS).map(([sprite, clips]) => `\`${sprite}\` (${clips.join(', ')})`).join(', ') || 'none'}.
- **Pose sprites have no \`[unit_type]\`.** Images like \`lieutenant-crossbow.png\` are
  alternate poses of another unit and are absent from this list by construction;
  they need a \`POSE_OF\` entry in the reader.

## Every unit type

Grouped by source folder, ordered by score within each group. \`#\` is the overall
rank out of ${total}. Sprite paths are relative to \`data/core/images/units/\`, exactly
what goes into \`UNIT_SPRITES\`.

${groups
  .map((g) => {
    const list = ranked.filter((r) => r.group === g);
    return `### ${g} (${list.length})\n\n${unitTable(list)}`;
  })
  .join('\n\n')}
`;

writeFileSync(OUT, md);
console.log(`${total} unit types, ${imported.length} in the game, ${candidates.length} more would qualify -> ${relative(process.cwd(), OUT)}`);
if (candidates.length) console.log(`not imported yet: ${candidates.map((r) => r.id).join(', ')}`);
