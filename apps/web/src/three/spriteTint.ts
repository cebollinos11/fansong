/**
 * A unit's cosmetic tint: a colour blended into its sprite. Pure pixel maths,
 * shared by the board's atlases and the builder's previews.
 */

/**
 * Wesnoth's team-colour reference palette ("magenta"); entry 0 is the average
 * shade. Pixels in it are team colour, so a tint leaves them alone.
 */
export const MAGENTA = [
  0xf49ac1, 0x3f0016, 0x55002a, 0x690039, 0x7b0045, 0x8c0051, 0x9e005d, 0xb10069, 0xc30074, 0xd6007f,
  0xec008c, 0xee3d96, 0xef5ba1, 0xf172ac, 0xf287b6, 0xf6adcd, 0xf8c1d9, 0xfad5e5, 0xfde9f1,
];

const TEAM_PIXELS = new Set(MAGENTA);

/** Whether a source pixel (0xRRGGBB) is one of the team-colour shades. */
export function isTeamPixel(rgb: number): boolean {
  return TEAM_PIXELS.has(rgb);
}

/** How far a tinted pixel moves toward the tint colour (0 = not at all, 1 = fully). */
export const TINT_STRENGTH = 0.5;

/** The default colour offered when a tint is first switched on. */
export const DEFAULT_TINT = '#c03030';

/** `"#rrggbb"` as `[r, g, b]`. */
export function parseTint(tint: string): [number, number, number] {
  const n = parseInt(tint.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * One pixel tinted: blended toward the tint colour scaled to the pixel's own
 * brightness, so shading and highlights survive and only the hue shifts.
 */
export function tintPixel(
  r: number,
  g: number,
  b: number,
  tint: readonly [number, number, number],
  strength = TINT_STRENGTH,
): [number, number, number] {
  const k = luma(r, g, b) / Math.max(1, luma(tint[0], tint[1], tint[2]));
  const mix = (from: number, to: number) => Math.round(from + (Math.min(255, to * k) - from) * strength);
  return [mix(r, tint[0]), mix(g, tint[1]), mix(b, tint[2])];
}

/** Tint every opaque, non-team-colour pixel of RGBA `px` in place. */
export function tintPixels(px: Uint8ClampedArray, tint: string): void {
  const t = parseTint(tint);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0 || isTeamPixel((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!)) continue;
    [px[i], px[i + 1], px[i + 2]] = tintPixel(px[i]!, px[i + 1]!, px[i + 2]!, t);
  }
}
