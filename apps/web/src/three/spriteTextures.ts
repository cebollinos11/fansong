import * as THREE from 'three';
import { spriteUrl } from './unitSprites.js';

/**
 * Loads Wesnoth unit sprites as team-coloured, alpha-cropped textures.
 *
 * Wesnoth marks the team-colour parts of a sprite with an exact "magenta"
 * palette and recolours those pixels per side. We replicate that mapping
 * (data/core/team-colors.cfg + src/color_range.cpp) on a canvas, then crop to
 * the opaque bounding box so the cutout's bottom edge sits on the unit's base.
 * The baked-in drop shadow is stripped.
 */

/** Wesnoth's reference palette; entry 0 is the average shade. */
const MAGENTA = [
  0xf49ac1, 0x3f0016, 0x55002a, 0x690039, 0x7b0045, 0x8c0051, 0x9e005d, 0xb10069, 0xc30074, 0xd6007f,
  0xec008c, 0xee3d96, 0xef5ba1, 0xf172ac, 0xf287b6, 0xf6adcd, 0xf8c1d9, 0xfad5e5, 0xfde9f1,
];

/** A Wesnoth colour range: the team's mid, highlight and shadow shades. */
interface ColorRange {
  mid: number;
  max: number;
  min: number;
}

// Wesnoth's own "blue" and "red" ranges, matching the P0/P1 board colours.
const TEAM_RANGES: readonly [ColorRange, ColorRange] = [
  { mid: 0x2e419b, max: 0xffffff, min: 0x0f0f0f },
  { mid: 0xff0000, max: 0xffffff, min: 0x000000 },
];

const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** Port of Wesnoth's recolor_palette: magenta shade -> team shade, by brightness. */
function buildMapping(range: ColorRange): Map<number, [number, number, number]> {
  const [mr, mg, mb] = rgb(range.mid);
  const [xr, xg, xb] = rgb(range.max);
  const [nr, ng, nb] = rgb(range.min);
  const [ar, ag, ab] = rgb(MAGENTA[0]!);
  const refAvg = Math.floor((ar + ag + ab) / 3);
  const mix = (t: number, a: number, b: number) => Math.min(255, Math.floor(t * a + (1 - t) * b));

  const map = new Map<number, [number, number, number]>();
  for (const c of MAGENTA) {
    const [r, g, b] = rgb(c);
    const avg = Math.floor((r + g + b) / 3);
    if (avg <= refAvg) {
      const t = avg / refAvg;
      map.set(c, [mix(t, mr, nr), mix(t, mg, ng), mix(t, mb, nb)]);
    } else {
      const t = (255 - avg) / (255 - refAvg);
      map.set(c, [mix(t, mr, xr), mix(t, mg, xg), mix(t, mb, xb)]);
    }
  }
  return map;
}

const MAPPINGS = [buildMapping(TEAM_RANGES[0]), buildMapping(TEAM_RANGES[1])] as const;

export interface SpriteTexture {
  texture: THREE.Texture;
  /** Cropped size in source pixels, for sizing the cutout consistently. */
  width: number;
  height: number;
}

const images = new Map<string, Promise<HTMLImageElement>>();
const textures = new Map<string, Promise<SpriteTexture>>();

function loadImage(path: string): Promise<HTMLImageElement> {
  let p = images.get(path);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load sprite ${path}`));
      img.src = spriteUrl(path);
    });
    images.set(path, p);
  }
  return p;
}

/** A team-coloured, cropped texture for `path`, cached per (sprite, owner). */
export function loadSpriteTexture(path: string, owner: 0 | 1): Promise<SpriteTexture> {
  const key = `${owner}:${path}`;
  let p = textures.get(key);
  if (!p) {
    p = loadImage(path).then((img) => buildTexture(img, MAPPINGS[owner]));
    textures.set(key, p);
  }
  return p;
}

function buildTexture(img: HTMLImageElement, mapping: Map<number, [number, number, number]>): SpriteTexture {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Wesnoth's only partial alpha is the flat drop shadow under the feet;
      // it would read as a smear on an upright cutout, so drop it.
      if (px[i + 3]! < 255) {
        px[i + 3] = 0;
        continue;
      }
      const to = mapping.get((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
      if (to) [px[i], px[i + 1], px[i + 2]] = to;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  ctx.putImageData(data, 0, 0);
  if (maxX < 0) [minX, minY, maxX, maxY] = [0, 0, w - 1, h - 1]; // fully transparent: keep as-is

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')!.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);

  const texture = new THREE.CanvasTexture(out);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; // keep the pixel art crisp up close
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, width: cw, height: ch };
}
