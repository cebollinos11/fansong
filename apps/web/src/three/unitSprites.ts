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
