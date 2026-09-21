import manifest from './unitAnimations.json';

/**
 * Wesnoth animations for each unit sprite, generated from a Wesnoth checkout by
 * `scripts/import-wesnoth.ts` (don't edit the JSON by hand). Frame paths are
 * relative to `public/sprites/units/`.
 */
export interface Clip {
  /** [image, duration ms] in play order. */
  frames: [string, number][];
  /** Attacks/defends: ms from clip start to the moment of impact (Wesnoth's t=0). */
  hitMs?: number;
}

export interface RangedClip extends Clip {
  /** Projectile image, relative to `public/sprites/`. */
  missile?: string;
  /** How long before impact the projectile leaves the shooter. */
  missileMs?: number;
}

/**
 * The animations FanSong plays. Everything is optional: a unit without a clip
 * holds its base image (and fades out on death, as Wesnoth does by default).
 */
export interface SpriteAnimations {
  /** Loops while the unit is at rest (e.g. a cloak in the breeze). */
  standing?: Clip;
  /** Played now and then while at rest. */
  idle?: Clip;
  /** Loops while sliding between hexes. */
  move?: Clip;
  /** Melee strikes (also a Guard riposte); one is picked at random per attack. */
  melee?: Clip[];
  ranged?: RangedClip[];
  defendMelee?: Clip;
  defendRanged?: Clip;
  death?: Clip;
  /** Rally gesture, played when a leader activates. */
  leading?: Clip;
  victory?: Clip;
}

// JSON infers frames as (string | number)[][]; the importer guarantees [image, ms] pairs.
const ANIMATIONS = manifest as unknown as Record<string, SpriteAnimations>;

export function animationsFor(sprite: string): SpriteAnimations {
  return ANIMATIONS[sprite] ?? {};
}

export const clipDuration = (clip: Clip): number => clip.frames.reduce((s, [, ms]) => s + ms, 0);

/** Every image a sprite can show: its base image first, then each clip frame. */
export function framesOf(sprite: string): string[] {
  const set = new Set<string>([sprite]);
  for (const c of Object.values(animationsFor(sprite))) {
    for (const clip of [c].flat() as Clip[]) for (const [p] of clip.frames) set.add(p);
  }
  return [...set];
}
