import type { Warband } from '@fansong/content';
import { animationsFor, framesOf } from '../three/unitAnimations.js';
import { spriteFor } from '../three/unitSprites.js';

/**
 * The offline copy of the game (`src/pwa/sw.js`) fetches unit art only as it is
 * shown: there are thousands of frames, most for looks a player never fields.
 * These are the files it is asked to fetch ahead, so the warbands a player can
 * pick play offline without having been seen first.
 */

/** Every file a unit drawn as `look` can show, from the site's root: its frames and its missiles. */
export function spriteFiles(look: string): string[] {
  const sprite = spriteFor(look);
  const missiles = (animationsFor(sprite).ranged ?? []).flatMap((clip) => (clip.missile ? [clip.missile] : []));
  return [...framesOf(sprite).map((frame) => `sprites/units/${frame}`), ...missiles.map((missile) => `sprites/${missile}`)];
}

/** The unit art of `warbands`, each file once. */
export function spritesToKeep(warbands: Iterable<Warband>): string[] {
  const files = new Set<string>();
  for (const warband of warbands) for (const unit of warband.units) for (const file of spriteFiles(unit.look ?? unit.name)) files.add(file);
  return [...files];
}
