/**
 * Import unit sprites and animations from a local Wesnoth checkout.
 *
 *   pnpm --filter @fansong/web sprites [path/to/wesnoth]   (default: $WESNOTH_DIR or ../wesnoth)
 *
 * For every sprite in UNIT_SPRITES it finds the Wesnoth [unit_type] whose base
 * image that is, reads its animation WML, keeps the front-facing (s/se/sw)
 * variant of each animation FanSong can use, and writes:
 *   - src/three/unitAnimations.json  — the clip manifest (see unitAnimations.ts)
 *   - public/sprites/units/…         — every frame the manifest references
 *   - public/sprites/projectiles/…   — missiles for ranged attacks
 *
 * This is a small WML reader, not a WML engine: it understands the tags,
 * attributes, image-path expansion (`x-[1~3].png:[100*3]`) and the handful of
 * animation macros these units use. It fails loudly on a referenced frame that
 * doesn't exist rather than shipping a broken clip.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALLBACK_SPRITE, UNIT_SPRITES } from '../src/three/unitSprites.js';
import type { Clip, SpriteAnimations } from '../src/three/unitAnimations.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const WESNOTH = resolve(process.argv[2] ?? process.env.WESNOTH_DIR ?? join(WEB, '..', '..', '..', 'wesnoth'));
const CORE = join(WESNOTH, 'data', 'core');
const IMAGES = join(CORE, 'images');
const OUT_IMAGES = join(WEB, 'public', 'sprites');
const OUT_MANIFEST = join(WEB, 'src', 'three', 'unitAnimations.json');

/** Sprites that are a pose of another unit type, whose animations they borrow. */
const POSE_OF: Record<string, string> = {
  'human-loyalists/lieutenant-crossbow.png': 'human-loyalists/lieutenant.png',
};
const FRONT = new Set(['s', 'se', 'sw']);
/** Missile macros that don't name an image directly. */
const MISSILE_MACROS: Record<string, string> = {
  MISSILE_FRAME_STONE_HIT: 'projectiles/stone.png',
  MISSILE_FRAME_STONE_MISS: 'projectiles/stone.png',
};
const DEFAULT_MISSILE_LEAD_MS = 150; // Wesnoth's usual missile_start_time=-150

// --- WML ------------------------------------------------------------------

interface Node {
  tag: string;
  attrs: Record<string, string>;
  kids: Node[];
  macros: string[];
}

function parseWml(text: string): Node {
  const root: Node = { tag: 'root', attrs: {}, kids: [], macros: [] };
  const stack = [root];
  let pending = ''; // a macro call spanning several lines, until its braces balance
  for (const raw of text.split(/\r?\n/)) {
    let s = raw.trim();
    if (!s || s.startsWith('#')) continue;
    const top = stack[stack.length - 1]!;
    if (pending || s.startsWith('{')) {
      pending = pending ? `${pending} ${s}` : s;
      if ((pending.match(/\{/g) ?? []).length > (pending.match(/\}/g) ?? []).length) continue;
      s = pending;
      pending = '';
    }
    const tag = /^\[(\/?)(\+?[a-z_]+)\]$/.exec(s);
    if (tag) {
      if (tag[1]) {
        if (stack.length > 1) stack.pop();
      } else {
        const n: Node = { tag: tag[2]!, attrs: {}, kids: [], macros: [] };
        top.kids.push(n);
        stack.push(n);
      }
    } else if (s.startsWith('{')) {
      top.macros.push(s);
    } else {
      const kv = /^([a-z_0-9,]+)\s*=\s*(.*)$/.exec(s);
      if (kv) top.attrs[kv[1]!] = kv[2]!.replace(/\s+#.*$/, '').replace(/^_\s*/, '').replace(/^"|"$/g, '');
    }
  }
  return root;
}

function expandList(spec: string): string[] {
  return spec.split(',').flatMap((part) => {
    const range = /^(\d+)~(\d+)$/.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      const step = b >= a ? 1 : -1;
      return Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => String(a + i * step));
    }
    const rep = /^(.+)\*(\d+)$/.exec(part);
    return rep ? Array<string>(Number(rep[2])).fill(rep[1]!) : [part];
  });
}

/** `units/x-[1~3].png:[100,200,100]` -> [[x-1.png,100], …] (paths relative to images/). */
function expandImage(spec: string): [string, number][] {
  const m = /^(.*?\.png)[^:]*(?::(.*))?$/.exec(spec.trim());
  if (!m) return [];
  const path = m[1]!;
  const dur = m[2];
  const br = /\[([^\]]+)\]/.exec(path);
  const paths = br ? expandList(br[1]!).map((v) => path.replace(br[0], v)) : [path];
  let durs = dur?.startsWith('[') ? expandList(dur.slice(1, -1)) : [dur ?? '100'];
  if (durs.length === 1) durs = Array<string>(paths.length).fill(durs[0]!);
  return paths.map((p, i) => [p, Number(durs[i] ?? durs[durs.length - 1])]);
}

const facesFront = (n: Node): boolean => {
  const d = n.attrs.direction;
  return d === undefined || d.split(',').some((x) => FRONT.has(x.trim()));
};

/** Body frames of an animation: front-facing branches only, the first of any hit/miss pair. */
function collectFrames(node: Node): { frames: [string, number][]; missiles: string[] } {
  const frames: [string, number][] = [];
  const missiles: string[] = [];
  let ifTaken = false;
  for (const k of node.kids) {
    if (k.tag === 'if' || k.tag === 'else') {
      if (!facesFront(k)) {
        if (k.tag === 'if') ifTaken = false;
        continue;
      }
      if (k.tag === 'else' && ifTaken) continue;
      const sub = collectFrames(k);
      frames.push(...sub.frames);
      missiles.push(...sub.missiles);
      if (k.tag === 'if') ifTaken = true;
    } else if (k.tag === 'frame' && k.attrs.image) {
      frames.push(...expandImage(k.attrs.image));
    } else if (k.tag === 'missile_frame' && k.attrs.image) {
      missiles.push(k.attrs.image.replace(/[:~].*$/, ''));
    }
  }
  for (const mac of node.macros) {
    const name = /^\{(\w+)/.exec(mac)?.[1];
    if (name && MISSILE_MACROS[name]) missiles.push(MISSILE_MACROS[name]);
  }
  return { frames, missiles };
}

// --- unit_type -> clips ----------------------------------------------------

interface RawAnim {
  kind: string;
  range?: string;
  direction?: string;
  wounded: boolean;
  startTime: number;
  missileStart?: number;
  frames: [string, number][];
  missiles: string[];
}

function rawAnims(ut: Node): RawAnim[] {
  const ranges = new Map<string, Set<string>>();
  for (const k of ut.kids) {
    if (k.tag !== 'attack' || !k.attrs.name || !k.attrs.range) continue;
    if (!ranges.has(k.attrs.name)) ranges.set(k.attrs.name, new Set());
    ranges.get(k.attrs.name)!.add(k.attrs.range);
  }

  const out: RawAnim[] = [];
  for (const k of ut.kids) {
    if (!(k.tag.endsWith('_anim') || k.tag === 'death' || k.tag === 'defend') || !facesFront(k)) continue;
    const { frames, missiles } = collectFrames(k);
    const anim: RawAnim = {
      kind: k.tag,
      direction: k.attrs.direction,
      wounded: k.macros.some((m) => m.includes('WOUNDED_UNIT')),
      startTime: Number(k.attrs.start_time ?? 0),
      missileStart: k.attrs.missile_start_time ? Number(k.attrs.missile_start_time) : undefined,
      frames,
      missiles,
    };
    if (k.tag === 'attack_anim') {
      const fa = k.kids.find((c) => c.tag === 'filter_attack');
      let range = fa?.attrs.range;
      if (!range && fa?.attrs.name) {
        const rs = new Set(fa.attrs.name.split(',').flatMap((n) => [...(ranges.get(n.trim()) ?? [])]));
        range = rs.size === 1 ? [...rs][0] : undefined;
      }
      anim.range = range;
    }
    out.push(anim);
  }

  for (const mac of ut.macros) {
    const m = /^\{(DEFENSE_ANIM\w*|LEADING_ANIM)\s+(.*)\}$/.exec(mac);
    if (!m) continue;
    // A FILTERED variant's filter may pin a direction; keep only front-facing ones.
    const dir = /direction=([a-z,]+)/.exec(m[2]!)?.[1];
    if (dir && !dir.split(',').some((d) => FRONT.has(d))) continue;
    const args = [...m[2]!.matchAll(/"([^"]+)"|(\S+)/g)].map((a) => a[1] ?? a[2]!);
    const imgs = args.filter((a) => a.endsWith('.png'));
    if (imgs.length < 2) continue;
    // Both macros take (REACTION, BASE, …): play base -> reaction -> base.
    const [reaction, base] = [imgs[0]!, imgs[1]!];
    if (m[1] === 'LEADING_ANIM') {
      out.push({ kind: 'leading_anim', wounded: false, startTime: 0, frames: [[base, 150], [reaction, 450], [base, 150]], missiles: [] });
    } else {
      out.push({
        kind: 'defend',
        range: m[1] === 'DEFENSE_ANIM_RANGE' ? args[args.length - 1] : undefined,
        wounded: false,
        startTime: -126, // the macro's reaction frame straddles the hit
        frames: [[base, 1], [reaction, 250], [base, 1]],
        missiles: [],
      });
    }
  }
  return out.filter((a) => a.frames.length > 0);
}

const toClip = (a: RawAnim): Clip => {
  const frames = a.frames.map(([p, ms]) => [p.replace(/^units\//, ''), ms] as [string, number]);
  const total = frames.reduce((s, [, ms]) => s + ms, 0);
  const clip: Clip = { frames };
  if (a.kind === 'attack_anim' || a.kind === 'defend') clip.hitMs = Math.min(total, Math.max(0, -a.startTime));
  return clip;
};

/** Prefer se/sw over s-only variants when both exist. */
function preferDiagonal(list: RawAnim[]): RawAnim[] {
  const diag = list.filter((a) => a.direction === undefined || a.direction.split(',').some((d) => d === 'se' || d === 'sw'));
  return diag.length > 0 ? diag : list;
}

function buildAnimations(ut: Node, isPose: boolean): SpriteAnimations {
  const all = rawAnims(ut);
  const of = (kind: string, range?: string) =>
    preferDiagonal(all.filter((a) => a.kind === kind && (range === undefined || a.range === range || a.range === undefined)));
  const anims: SpriteAnimations = {};

  const standing = all.find((a) => a.kind === 'standing_anim' && !a.wounded && a.frames.length > 1);
  if (standing) anims.standing = toClip(standing);
  const idle = of('idle_anim')[0];
  if (idle) anims.idle = toClip(idle);
  const move = of('movement_anim')[0];
  if (move) anims.move = toClip(move);

  const melee = of('attack_anim', 'melee').filter((a) => a.range === 'melee');
  if (melee.length) anims.melee = melee.map(toClip);
  const ranged = of('attack_anim', 'ranged').filter((a) => a.range === 'ranged');
  if (ranged.length) {
    anims.ranged = ranged.map((a) => ({
      ...toClip(a),
      missile: a.missiles[0],
      missileMs: a.missileStart !== undefined ? -a.missileStart : DEFAULT_MISSILE_LEAD_MS,
    }));
  }

  const defMelee = of('defend', 'melee')[0];
  if (defMelee) anims.defendMelee = toClip(defMelee);
  const defRanged = of('defend', 'ranged')[0];
  if (defRanged) anims.defendRanged = toClip(defRanged);

  const death = of('death')[0];
  if (death) anims.death = toClip(death);
  // A borrowed pose's rally gesture shows the other unit's weapon; skip it.
  const leading = of('leading_anim')[0];
  if (leading && !isPose) anims.leading = toClip(leading);
  const victory = of('victory_anim')[0];
  if (victory) anims.victory = toClip(victory);
  return anims;
}

// --- main ------------------------------------------------------------------

function* cfgFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* cfgFiles(p);
    else if (p.endsWith('.cfg')) yield p;
  }
}

if (!existsSync(IMAGES)) {
  console.error(`No Wesnoth checkout at ${WESNOTH} (pass its path, or set WESNOTH_DIR).`);
  process.exit(1);
}

const unitTypes = new Map<string, { node: Node; file: string }>();
for (const file of cfgFiles(join(CORE, 'units'))) {
  for (const k of parseWml(readFileSync(file, 'utf8')).kids) {
    if (k.tag === 'unit_type' && k.attrs.image) unitTypes.set(k.attrs.image, { node: k, file });
  }
}

const sprites = [...new Set([...Object.values(UNIT_SPRITES), FALLBACK_SPRITE])].sort();
const manifest: Record<string, SpriteAnimations> = {};
const files = new Set<string>();
const problems: string[] = [];

for (const sprite of sprites) {
  const source = POSE_OF[sprite] ?? sprite;
  const ut = unitTypes.get(`units/${source}`);
  files.add(`units/${sprite}`);
  if (!ut) {
    problems.push(`${sprite}: no [unit_type] with image=units/${source}`);
    continue;
  }
  const anims = buildAnimations(ut.node, source !== sprite);
  manifest[sprite] = anims;
  for (const clips of Object.values(anims)) {
    for (const clip of [clips].flat() as (Clip & { missile?: string })[]) {
      for (const [p] of clip.frames) files.add(`units/${p}`);
      if (clip.missile) files.add(clip.missile);
    }
  }
  console.log(`${sprite.padEnd(42)} <- ${ut.node.attrs.id} (${relative(CORE, ut.file)}): ${Object.keys(anims).join(', ')}`);
}

for (const f of files) {
  const src = join(IMAGES, f);
  if (!existsSync(src)) {
    problems.push(`missing image ${f}`);
    continue;
  }
  const dest = join(OUT_IMAGES, f);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
console.log(`\n${sprites.length} sprites, ${files.size} images -> ${relative(WEB, OUT_IMAGES)}; manifest -> ${relative(WEB, OUT_MANIFEST)}`);
