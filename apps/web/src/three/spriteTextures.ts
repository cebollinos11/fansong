import * as THREE from 'three';
import { spriteUrl } from './unitSprites.js';

/**
 * Loads Wesnoth unit sprites as team-coloured texture atlases.
 *
 * Wesnoth marks the team-colour parts of a sprite with an exact "magenta"
 * palette and recolours those pixels per side. We replicate that mapping
 * (data/core/team-colors.cfg + src/color_range.cpp) on a canvas.
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

/** Where one frame sits in the atlas, in texture UV space (flipY'd, like three.js). */
export interface FrameRect {
  u: number;
  v: number;
}

/**
 * All of one unit's frames, team-coloured, packed into a single texture.
 *
 * Wesnoth draws every frame centred on the hex, whatever its size, so frames
 * share an anchor: each is centred in a uniform cell, and the anchor is the
 * base image's feet (lowest opaque row, horizontal middle). The cutout pins that
 * point to its base, so the unit never jitters between frames.
 */
export interface SpriteAtlas {
  texture: THREE.Texture;
  frames: Map<string, FrameRect>;
  /** Cell size in source pixels. */
  cellW: number;
  cellH: number;
  /** UV size of one cell. */
  repeatU: number;
  repeatV: number;
  /** Anchor inside a cell, in pixels from its left / top edge. */
  anchorX: number;
  anchorY: number;
  /** Alpha (0-255) at a texture UV, for pixel-accurate picking. */
  alphaAt(u: number, v: number): number;
}

const PAD = 4; // gap between cells so mipmaps don't bleed neighbouring frames

const images = new Map<string, Promise<HTMLImageElement>>();
const atlases = new Map<string, Promise<SpriteAtlas>>();

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

/**
 * A team-coloured atlas of `frames` (the first is the base image), cached per
 * (sprite, owner). Frames that fail to load are skipped, not fatal.
 */
export function loadSpriteAtlas(sprite: string, frames: string[], owner: 0 | 1): Promise<SpriteAtlas> {
  const key = `${owner}:${sprite}`;
  let p = atlases.get(key);
  if (!p) {
    p = Promise.all(frames.map((f) => loadImage(f).catch(() => null))).then((imgs) => {
      const loaded = frames.flatMap((f, i) => (imgs[i] ? [[f, imgs[i]!] as const] : []));
      if (loaded.length === 0 || loaded[0]![0] !== frames[0]) throw new Error(`failed to load sprite ${sprite}`);
      return buildAtlas(loaded, MAPPINGS[owner]);
    });
    atlases.set(key, p);
  }
  return p;
}

function buildAtlas(
  frames: readonly (readonly [string, HTMLImageElement])[],
  mapping: Map<number, [number, number, number]>,
): SpriteAtlas {
  const cellW = Math.max(...frames.map(([, img]) => img.naturalWidth));
  const cellH = Math.max(...frames.map(([, img]) => img.naturalHeight));
  const cols = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / cols);
  const atlasW = cols * (cellW + PAD);
  const atlasH = rows * (cellH + PAD);

  const canvas = document.createElement('canvas');
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const rects = new Map<string, FrameRect>();
  let anchorX = cellW / 2;
  let anchorY = cellH - 1;
  frames.forEach(([path, img], i) => {
    const x = (i % cols) * (cellW + PAD) + Math.floor((cellW - img.naturalWidth) / 2);
    const y = Math.floor(i / cols) * (cellH + PAD) + Math.floor((cellH - img.naturalHeight) / 2);
    ctx.drawImage(img, x, y);
    const bounds = recolor(ctx, x, y, img.naturalWidth, img.naturalHeight, mapping);
    const cx = (i % cols) * (cellW + PAD);
    const cy = Math.floor(i / cols) * (cellH + PAD);
    if (i === 0 && bounds) {
      anchorX = (bounds.minX + bounds.maxX + 1) / 2 - cx;
      anchorY = bounds.maxY + 1 - cy;
    }
    rects.set(path, { u: cx / atlasW, v: 1 - (cy + cellH) / atlasH });
  });

  const alpha = ctx.getImageData(0, 0, atlasW, atlasH).data;
  const alphaAt = (u: number, v: number): number => {
    const x = Math.floor(u * atlasW);
    const y = Math.floor((1 - v) * atlasH);
    if (x < 0 || y < 0 || x >= atlasW || y >= atlasH) return 0;
    return alpha[(y * atlasW + x) * 4 + 3]!;
  };

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; // keep the pixel art crisp up close
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return {
    texture,
    frames: rects,
    cellW,
    cellH,
    repeatU: cellW / atlasW,
    repeatV: cellH / atlasH,
    anchorX,
    anchorY,
    alphaAt,
  };
}

/**
 * Recolour one drawn frame in place (magenta -> team) and strip its drop
 * shadow. Returns the opaque bounds in canvas pixels, or null if it's empty.
 */
function recolor(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  mapping: Map<number, [number, number, number]>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const data = ctx.getImageData(x0, y0, w, h);
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
  ctx.putImageData(data, x0, y0);
  return maxX < 0 ? null : { minX: minX + x0, minY: minY + y0, maxX: maxX + x0, maxY: maxY + y0 };
}

const projectiles = new Map<string, THREE.Texture>();

/** A missile image (path relative to `public/sprites/`), drawn as-is. */
export function projectileTexture(path: string): THREE.Texture {
  let t = projectiles.get(path);
  if (!t) {
    t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}sprites/${path}`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    projectiles.set(path, t);
  }
  return t;
}
