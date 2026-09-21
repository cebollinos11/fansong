/**
 * Download every Wesnoth sprite referenced by UNIT_SPRITES into
 * public/sprites/units/, mirroring Wesnoth's folder layout. Idempotent: files
 * already on disk are skipped unless --force is passed.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALLBACK_SPRITE, UNIT_SPRITES } from '../src/three/unitSprites.js';

const BASE = 'https://raw.githubusercontent.com/wesnoth/wesnoth/master/data/core/images/units';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites', 'units');
const force = process.argv.includes('--force');

const paths = new Set([...Object.values(UNIT_SPRITES), FALLBACK_SPRITE]);
for (const path of paths) {
  const dest = join(OUT, path);
  if (!force && existsSync(dest)) continue;
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${path}`);
}
console.log(`${paths.size} sprites in ${OUT}`);
