/**
 * Which Wesnoth unit sprite stands in for each FanSong unit. Paths are relative
 * to Wesnoth's `data/core/images/units/` and mirrored under
 * `public/sprites/units/`; `pnpm --filter @fansong/web sprites` imports them, and
 * their animations, from a local Wesnoth checkout (see scripts/import-wesnoth.ts).
 *
 * Wesnoth art is GPL-2.0-or-later; see `public/sprites/CREDITS.md`.
 */
export const UNIT_SPRITES: Record<string, string> = {
  // Iron Wardens — heavy, disciplined loyalist infantry.
  'Warden-Captain': 'human-loyalists/general.png',
  Ironguard: 'human-loyalists/heavyinfantry.png',
  Bulwark: 'human-loyalists/siegetrooper.png',
  Sentinel: 'human-loyalists/royalguard.png',
  Halberdier: 'human-loyalists/halberdier.png',
  Levy: 'human-peasants/peasant.png',

  // Ashfang Raiders — orcs and goblin wolf riders.
  'Raid-Leader': 'orcs/leader.png',
  Marauder: 'orcs/grunt.png',
  Reaver: 'orcs/warrior.png',
  'Wolf-Prowler': 'goblins/wolf-rider.png',
  Outrider: 'goblins/knight.png',
  Whelp: 'goblins/spearman.png',

  // Free Company — sellswords and hired locals.
  Sergeant: 'human-loyalists/sergeant.png',
  Swordsman: 'human-loyalists/swordsman.png',
  Pikeman: 'human-loyalists/pikeman.png',
  Slinger: 'human-outlaws/footpad.png',
  'Halberd-Recruit': 'human-peasants/woodsman.png',
  Recruit: 'human-peasants/ruffian.png',

  // Hollow Watch — a garrison of bows, shields and a riposting captain.
  'Watch-Captain': 'human-loyalists/master-at-arms.png',
  'Shield-Warden': 'human-loyalists/shocktrooper.png',
  Longbow: 'human-loyalists/longbowman.png',
  Crossbow: 'human-loyalists/lieutenant-crossbow.png',
  Sentry: 'human-loyalists/spearman.png',

  // Thorn Patrol — a three-man border patrol: one bow, two foot.
  'Thorn-Bow': 'human-loyalists/longbowman.png',
  'Thorn-Blade': 'human-loyalists/swordsman.png',
  'Thorn-Spear': 'human-loyalists/spearman.png',

  // Sky Talons — a pair of flying gryphons screened by foot and a bow.
  'Sky-Talon': 'monsters/gryphon.png',
  'Storm-Talon': 'monsters/gryphon.png',
  'Talon-Falconer': 'human-loyalists/longbowman.png',
  Skywatch: 'human-loyalists/spearman.png',
  Fledgling: 'human-peasants/ruffian.png',

  // Bonefield Legion — Reassembling undead skeletons that refuse to stay down.
  'Skeleton Infantry': 'undead-skeletal/skeleton/skeleton.png',
  'Skeleton Archer': 'undead-skeletal/archer/archer.png',

  // Grave Knights — the skeletal elite: a rider, a twin-blade, and a crowned lord.
  'Skeleton Rider': 'undead-skeletal/rider.png',
  Deathblade: 'undead-skeletal/deathblade.png',
  'Death Knight': 'undead-skeletal/deathknight.png',
};

/**
 * The frame of a sprite's death clip that shows it knocked down but alive —
 * kneeling or staggered, before the fall. Hand-picked; a sprite without one
 * crouches (squashes) instead.
 */
export const DOWN_POSES: Record<string, string> = {
  'orcs/grunt.png': 'orcs/grunt-die-2.png',
  'goblins/spearman.png': 'goblins/spearman-die-1.png',
  'goblins/wolf-rider.png': 'goblins/wolf-rider-die-3.png',
  'human-loyalists/spearman.png': 'human-loyalists/spearman-death3.png',
  'human-loyalists/lieutenant-crossbow.png': 'human-loyalists/lieutenant-die-3.png',
  'human-peasants/peasant.png': 'human-peasants/peasant-die3.png',
  'undead-skeletal/skeleton/skeleton.png': 'undead-skeletal/skeleton/skeleton-dying-2.png',
  'undead-skeletal/archer/archer.png': 'undead-skeletal/archer/archer-die2-2.png',
  'undead-skeletal/deathblade.png': 'undead-skeletal/deathblade-dying-2.png',
};

/** Used for any unit name without an entry above. */
export const FALLBACK_SPRITE = 'human-loyalists/spearman.png';

export function spriteFor(name: string): string {
  return UNIT_SPRITES[name] ?? FALLBACK_SPRITE;
}

/** Public URL of a sprite path from {@link UNIT_SPRITES}. */
export function spriteUrl(path: string): string {
  return `${import.meta.env.BASE_URL}sprites/units/${path}`;
}
