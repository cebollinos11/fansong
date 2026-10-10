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
 *   - public/sprites/terrain/…       — the animated lava texture and the meadow's grass hexes
 *   - public/sprites/items/…, scenery/… — the signs of the run map's places
 *
 * The WML reading is in wesnoth-wml.ts, shared with the survey of every Wesnoth
 * unit (survey-wesnoth.ts). This script fails loudly on a referenced frame that
 * doesn't exist rather than shipping a broken clip.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { LAVA_FRAMES } from '../src/three/lava.js';
import { MEADOW_TILES } from '../src/three/backdrop.js';
import { FALLBACK_SPRITE, UNIT_SPRITES } from '../src/three/unitSprites.js';
import { NODE_IMAGES } from '../src/ui/nodeArt.js';
import type { Clip, SpriteAnimations } from '../src/three/unitAnimations.js';
import { buildAnimations, CORE, IMAGES, loadUnitTypes, POSE_OF, SKIP_CLIPS, WEB } from './wesnoth-wml.js';

const OUT_IMAGES = join(WEB, 'public', 'sprites');
const OUT_MANIFEST = join(WEB, 'src', 'three', 'unitAnimations.json');

const unitTypes = loadUnitTypes();

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
  for (const clip of SKIP_CLIPS[sprite] ?? []) delete anims[clip];
  manifest[sprite] = anims;
  for (const clips of Object.values(anims)) {
    for (const clip of [clips].flat() as (Clip & { missile?: string })[]) {
      for (const [p] of clip.frames) files.add(`units/${p}`);
      if (clip.missile) files.add(clip.missile);
    }
  }
  console.log(`${sprite.padEnd(42)} <- ${ut.node.attrs.id} (${relative(CORE, ut.file)}): ${Object.keys(anims).join(', ')}`);
}

// Lava: Wesnoth's animated 342×180 pool texture, one image per frame (see src/three/lava.ts).
for (let i = 1; i <= LAVA_FRAMES; i++) files.add(`terrain/unwalkable/lava${String(i).padStart(2, '0')}.png`);
// Grass: the hexes the meadow backdrop is scattered from (see src/three/backdrop.ts).
for (const f of MEADOW_TILES) files.add(f);
// The run map's places: an item or a piece of scenery each (see src/ui/nodeArt.ts).
for (const f of Object.values(NODE_IMAGES)) files.add(f);

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
