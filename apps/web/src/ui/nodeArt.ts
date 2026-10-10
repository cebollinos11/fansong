import type { NodeKind } from '@fansong/content';

/**
 * The picture each kind of place on the run's map is drawn with: a Wesnoth
 * item or scenery image, kept under `public/sprites/` at its own Wesnoth path
 * and copied there by the sprite importer (`scripts/import-wesnoth.ts`).
 * Credited in `public/sprites/CREDITS.md`.
 */
export const NODE_IMAGES: Record<NodeKind, string> = {
  battle: 'items/sword.png',
  elite: 'items/flame-sword.png',
  market: 'scenery/tent-shop-weapons.png',
  camp: 'scenery/fire1.png',
  training: 'items/dummy.png',
  mystery: 'scenery/signpost.png',
  boss: 'items/dragonstatue.png',
};

/** Where a node's picture is served from, under the app's `base` URL. */
export function nodeImageUrl(kind: NodeKind, base: string): string {
  return `${base}sprites/${NODE_IMAGES[kind]}`;
}
