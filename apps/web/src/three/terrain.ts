import { vecKey, type BoardData, type Vec } from '@fansong/engine';

// Pure terrain layout for the board view (no three.js), so it can be unit-tested.

/** How far a lava pool's surface sits below its hex's level, so the ground around it reads as a bank. */
export const LAVA_SINK = 0.07;

/** Molten lava, from its deepest orange to its brightest yellow, and the dark crust at a pool's rim. */
const LAVA_DEEP = 0xe0461a;
const LAVA_BRIGHT = 0xffa53a;
const LAVA_CRUST = 0x5a1c0c;

/** Tiles are 0.2 tall and flat ones sit centred on y = 0, so their top is at 0.1. */
export const TILE_TOP = 0.1;
export const TILE_BOTTOM = -0.1;
/** World units each elevation level raises a hex. */
export const ELEVATION_STEP = 0.32;

const TILE_LIGHT = 0x2a3140;
const TILE_DARK = 0x232936;
/** Each level lifts the top toward a sunlit plateau colour. */
const HIGH_GROUND = 0x6b7a5a;

/** A hex's elevation straight from board data (0 when flat, unlisted or off-board). */
export function hexElevation(board: BoardData, v: Vec): number {
  return board.terrain?.[vecKey(v)]?.elevation ?? 0;
}

/** World Y of a hex's top surface — where units, bases and highlights stand. */
export function surfaceY(elevation: number): number {
  return TILE_TOP + elevation * ELEVATION_STEP;
}

/** Height of the prism for a hex, from the shared tile bottom up to its surface. */
export function tileHeight(elevation: number): number {
  return surfaceY(elevation) - TILE_BOTTOM;
}

/** Blend two 0xRRGGBB colours: `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return out;
}

function scale(c: number, k: number): number {
  return mix(0, c, k);
}

/** Top-face colour: the checkerboard on flat ground, brightening with each level. */
export function tileTopColor(v: Vec, elevation: number): number {
  const base = (v.x + v.y) % 2 === 0 ? TILE_LIGHT : TILE_DARK;
  return elevation <= 0 ? base : mix(base, HIGH_GROUND, 0.1 + 0.28 * elevation);
}

/** Side-face colour: a darker shade of the top, so raised hexes read as cliffs. */
export function tileSideColor(v: Vec, elevation: number): number {
  return scale(tileTopColor(v, elevation), elevation <= 0 ? 0.85 : 0.55);
}

/** Rim colour around a hex top: a darker shade of it, so the grid reads where tiles meet. */
export function tileRimColor(top: number): number {
  return scale(top, 0.6);
}

/** Top-face colour of a lava hex: molten orange, a touch brighter or deeper per hex so a pool doesn't tile. `t` is 0..1 noise. */
export function lavaTopColor(t: number): number {
  return mix(LAVA_DEEP, LAVA_BRIGHT, 0.25 + 0.5 * t);
}

/** Rim colour around a lava hex top: cooling crust at the pool's edge. */
export function lavaRimColor(): number {
  return LAVA_CRUST;
}
