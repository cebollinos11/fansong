/**
 * Synthesize walk cycles for unit sprites that Wesnoth gives no move animation.
 *
 * Usage: pnpm --filter @fansong/web walks
 *
 * Each rigged sprite's base image (already vendored under public/sprites/units/)
 * is cut into a body layer and one layer per leg, then re-stacked into a
 * four-frame stomp: lift one foot while the body bobs up a pixel, set it down,
 * then the other foot. Frames are written next to the base image as
 * `<name>-walk-<n>.png`, and their clip to src/three/walkAnimations.json, which
 * `animationsFor` uses only where the Wesnoth manifest has no `move` clip.
 *
 * Legs are rectangles in base-image pixels. Everything at or below `cut` inside
 * the leg's columns moves with the leg; the leg layer also carries the rows from
 * `top` down to `cut`, hidden under the body, so a lifted body never opens a gap
 * at the hip.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

interface Leg {
  /** Inclusive column range. */
  x: [number, number];
  /** First row that moves with the leg. */
  cut: number;
  /** First row of the leg layer (<= cut); rows above `cut` sit under the body. */
  top: number;
}

interface Rig {
  /** Exactly two legs: the first steps first. */
  legs: [Leg, Leg];
}

const RIGS: Record<string, Rig> = {
  // Bulwark. The right leg only shows below the tower shield.
  'human-loyalists/siegetrooper.png': {
    legs: [
      { x: [21, 35], cut: 44, top: 41 },
      { x: [39, 53], cut: 53, top: 50 },
    ],
  },
};

/** [body dy, leg 0 dy, leg 1 dy] per frame: step, settle, other step, settle. */
const CYCLE: [number, number, number][] = [
  [-1, -3, 0],
  [0, -1, 0],
  [-1, 0, -3],
  [0, 0, -1],
];
/** Four frames per 300ms hex, so a unit takes two steps per hex. */
const FRAME_MS = 75;
/** Wesnoth's baked drop shadow; it stays on the ground. */
const SHADOW_ALPHA = 153;

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const UNITS = join(WEB, 'public', 'sprites', 'units');
const OUT_MANIFEST = join(WEB, 'src', 'three', 'walkAnimations.json');

interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode an 8-bit, non-interlaced palette or RGBA PNG (all Wesnoth unit art is one of these). */
function readPng(file: string): Rgba {
  const buf = readFileSync(file);
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error(`${file}: not a PNG`);
  let width = 0, height = 0, colorType = 0;
  let palette: Buffer | undefined, trns: Buffer | undefined;
  const idat: Buffer[] = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9];
      if (body[8] !== 8 || body[12] !== 0 || (colorType !== 3 && colorType !== 6)) {
        throw new Error(`${file}: unsupported PNG (depth ${body[8]}, colour type ${colorType}, interlace ${body[12]})`);
      }
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 1;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + i] = (line[i] + pred) & 0xff;
    }
  }
  if (colorType === 6) return { width, height, data: px };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const k = px[i];
    data.set([palette![k * 3], palette![k * 3 + 1], palette![k * 3 + 2], trns && k < trns.length ? trns[k] : 255], i * 4);
  }
  return { width, height, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
function writePng(file: string, img: Rgba): void {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  writeFileSync(
    file,
    Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]),
  );
}

const inLeg = (leg: Leg, x: number, y: number, from: number) => x >= leg.x[0] && x <= leg.x[1] && y >= from;

/** The base image's pixels that pass `keep`, drawn at (0, dy) over `into`. */
function stamp(into: Rgba, src: Rgba, dy: number, keep: (x: number, y: number, alpha: number) => boolean): void {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= src.height) continue;
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      if (src.data[i + 3] === 0 || !keep(x, y, src.data[i + 3])) continue;
      into.data.set(src.data.subarray(i, i + 4), (ty * src.width + x) * 4);
    }
  }
}

const manifest: Record<string, { frames: [string, number][] }> = {};
for (const [sprite, rig] of Object.entries(RIGS).sort(([a], [b]) => a.localeCompare(b))) {
  const base = readPng(join(UNITS, sprite));
  const solid = (a: number) => a !== SHADOW_ALPHA;
  const frames: [string, number][] = [];
  CYCLE.forEach(([bodyDy, ...legDy], n) => {
    const out: Rgba = { width: base.width, height: base.height, data: new Uint8Array(base.data.length) };
    stamp(out, base, 0, (_x, _y, a) => a === SHADOW_ALPHA);
    rig.legs.forEach((leg, l) => stamp(out, base, legDy[l], (x, y, a) => solid(a) && inLeg(leg, x, y, leg.top)));
    stamp(out, base, bodyDy, (x, y, a) => solid(a) && !rig.legs.some((leg) => inLeg(leg, x, y, leg.cut)));
    const name = sprite.replace(/\.png$/, `-walk-${n + 1}.png`);
    mkdirSync(dirname(join(UNITS, name)), { recursive: true });
    writePng(join(UNITS, name), out);
    frames.push([name, FRAME_MS]);
  });
  manifest[sprite] = { frames };
  console.log(`${sprite}: ${frames.length} frames`);
}
writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
