import * as THREE from 'three';
import type { Owner } from '@fansong/engine';
import { loadSpriteAtlas, type SpriteAtlas } from './spriteTextures.js';
import { framesOf } from './unitAnimations.js';
import { spriteFor } from './unitSprites.js';

/**
 * The coin that decides who strikes first. A real medallion in the scene — a
 * gold-rimmed disc struck with each side's colour and champion — held in front
 * of the camera so it is framed the same however the player has the board
 * turned (see `BoardView.tossCoin`).
 *
 * Everything here is geometry, paint and choreography; the *outcome* is the
 * engine's (`tossInitiative`), decided from the seed long before the coin is
 * built, so the animation only ever shows a result it was handed.
 */

// The toss, beat by beat (ms). The pace is deliberately operatic: the coin is
// the first thing a battle does, and the only one nobody has to think about.
/** It flicks up from under the view, winding up to a blur. */
export const COIN_LAUNCH_MS = 1300;
/** At the top it almost stops, turning over once in the air. */
export const COIN_HANG_MS = 620;
/** Then it drops, spinning up again all the way down. */
export const COIN_FALL_MS = 900;
/** It slams to a stop in the middle of the view, overshooting a hair. */
export const COIN_IMPACT_MS = 220;
/** ...and rocks itself flat, the winner's face up. */
export const COIN_SETTLE_MS = 620;
/** The verdict is held up, glowing, while the banner reads it out. */
export const COIN_REVEAL_MS = 1200;
/** The coin swells and fades, handing the battle over. */
export const COIN_EXIT_MS = 480;

/** How long a whole toss takes, from the first glint to the empty board. */
export const COIN_TOSS_MS =
  COIN_LAUNCH_MS + COIN_HANG_MS + COIN_FALL_MS + COIN_IMPACT_MS + COIN_SETTLE_MS + COIN_REVEAL_MS + COIN_EXIT_MS;

/** When, in the toss, the coin lands — the moment the verdict is readable. */
export const COIN_LAND_MS = COIN_LAUNCH_MS + COIN_HANG_MS + COIN_FALL_MS;

/** Full turns the coin makes in the air. Enough to lose count of, which is the point. */
const TURNS = 11;
/** How far up the view the coin starts (fractions of the view's height from its middle). */
const START_RISE = -0.78;
/** ...and how high it flies. */
const APEX_RISE = 0.26;
/** How far it sinks past its resting place as it lands, before it rocks flat. */
const OVERSHOOT = 0.05;
/** The coin's width as a fraction of the view's height, at the distance it is tossed. */
const COIN_VIEW_SPAN = 0.3;
/** How far in the camera creeps while the verdict is up (fraction of the toss distance). */
const REVEAL_PUSH = 0.86;
/** How hard the coin rocks as it settles, and how fast the rocking dies away. */
const WOBBLE = 0.5;
const WOBBLE_TURNS = 2.4;
/** How far it leans off true through the flight, so the tumble isn't a flat wheel. */
const LEAN = 0.13;

/** Where the coin is, and how it is turned, part way through a toss. */
export interface CoinPose {
  /** Height above the middle of the view, in fractions of the view's height. */
  rise: number;
  /** Distance from the camera, as a fraction of the distance it is tossed at. */
  push: number;
  /** How far it has turned end over end (radians). 0 shows player 0's face. */
  spin: number;
  /** A lean off the tumbling axis (radians), so it wheels rather than spins flat. */
  lean: number;
  /** Size against its struck size: squashed by the landing, swelling as it goes. */
  scale: number;
  opacity: number;
  /** How brightly the winner's face burns, 0..1. */
  glow: number;
}

/** 0 at `from`, 1 at `to`, clamped. */
function span(ms: number, from: number, to: number): number {
  return Math.max(0, Math.min(1, (ms - from) / (to - from)));
}

/**
 * The coin's pose `ms` into a toss won by `winner`. A pure function of the
 * clock, so the view only has to place what it returns — and so the whole
 * choreography can be read (and tested) in one place.
 *
 * The spin is laid out backwards from the landing: it ends on an exact number
 * of half-turns, the last of them showing the winner, so the coin never has to
 * cheat its way round to the right face.
 */
export function coinPose(ms: number, winner: Owner): CoinPose {
  const hang = COIN_LAUNCH_MS + COIN_HANG_MS;
  const land = COIN_LAND_MS;
  const impact = land + COIN_IMPACT_MS;
  const settled = impact + COIN_SETTLE_MS;
  const reveal = settled + COIN_REVEAL_MS;
  // Heads (player 0) is the face the coin shows at rest; tails is half a turn on.
  const total = 2 * Math.PI * TURNS + (winner === 1 ? Math.PI : 0);

  // Fast off the flick, almost stalled at the top, winding up again as it falls.
  const turned =
    ms < COIN_LAUNCH_MS
      ? 0.46 * span(ms, 0, COIN_LAUNCH_MS) ** 0.7
      : ms < hang
        ? 0.46 + 0.06 * span(ms, COIN_LAUNCH_MS, hang)
        : 0.52 + 0.48 * span(ms, hang, land) ** 1.3;
  const spin = total * Math.min(1, turned);

  // Up fast and slowing to the apex, then away under it.
  const rise =
    ms < COIN_LAUNCH_MS
      ? START_RISE + (APEX_RISE - START_RISE) * (1 - (1 - span(ms, 0, COIN_LAUNCH_MS)) ** 2)
      : ms < hang
        ? APEX_RISE
        : ms < land
          ? APEX_RISE * (1 - span(ms, hang, land) ** 2)
          : ms < impact
            ? -OVERSHOOT * Math.sin(Math.PI * span(ms, land, impact))
            : 0;

  // The landing jolt, then a rocking that dies out as the coin lies flat.
  const settle = span(ms, impact, settled);
  const lean =
    ms < land
      ? LEAN * Math.sin((ms / COIN_LAUNCH_MS) * Math.PI * 1.7)
      : ms < impact
        ? 0
        : WOBBLE * Math.sin(settle * Math.PI * 2 * WOBBLE_TURNS) * (1 - settle) ** 2;

  const squash = ms >= land && ms < impact ? 1 - 0.16 * Math.sin(Math.PI * span(ms, land, impact)) : 1;
  const swell = 1 + 0.35 * span(ms, reveal, COIN_TOSS_MS) ** 2;

  return {
    rise,
    push: 1 - (1 - REVEAL_PUSH) * span(ms, hang, reveal) ** 0.8,
    spin,
    lean,
    scale: squash * swell,
    opacity: span(ms, 0, 220) * (1 - span(ms, reveal, COIN_TOSS_MS)),
    glow: Math.min(span(ms, land, impact), 1 - 0.4 * span(ms, reveal, COIN_TOSS_MS)),
  };
}

/** How much the board behind the coin is darkened, `ms` into the toss (0..1). */
export function coinDim(ms: number): number {
  return Math.min(span(ms, 0, 420), 1 - span(ms, COIN_TOSS_MS - COIN_EXIT_MS, COIN_TOSS_MS));
}

/** A side of the coin: its colour, the unit struck on it, and what that side is called. */
export interface CoinFace {
  owner: Owner;
  /** The unit name whose sprite is struck on this face (a {@link spriteFor} key). */
  unit: string;
  /** What the side is called, engraved round the foot of the face. */
  name: string;
  /** The side's board colour. */
  color: number;
}

const FACE_PX = 512;
const RIM_COLOR = 0xf0c969;
const RIM_DARK = 0x6b4e1c;
const GOLD = '#f6d88a';
const GOLD_DEEP = '#8a6520';

/** A coin: the group to add to the scene, its two faces, and how it is turned. */
export class Coin {
  readonly group = new THREE.Group();
  private readonly disc = new THREE.Group();
  private readonly faceMats: THREE.MeshBasicMaterial[] = [];
  private readonly rimMat: THREE.MeshStandardMaterial;
  private readonly light: THREE.PointLight;
  private readonly made: THREE.BufferGeometry[] = [];
  private readonly canvases: HTMLCanvasElement[] = [];
  private disposed = false;

  /** `radius` is the struck radius in world units; the pose scales it from there. */
  constructor(faces: readonly [CoinFace, CoinFace], radius: number) {
    const thickness = radius * 0.13;
    // Gold enough to glint as it turns, but lit from within too, so it never
    // goes black when the board's own lights are down for the toss.
    this.rimMat = new THREE.MeshStandardMaterial({
      color: RIM_COLOR,
      metalness: 0.45,
      roughness: 0.3,
      emissive: new THREE.Color(RIM_DARK),
      emissiveIntensity: 1.1,
      transparent: true,
    });
    // Knurled edge: a many-sided open cylinder catches the light as it turns.
    const rimGeo = new THREE.CylinderGeometry(radius, radius, thickness, 72, 1, true);
    this.made.push(rimGeo);
    const rim = new THREE.Mesh(rimGeo, this.rimMat);
    this.disc.add(rim);

    // Player 0's face looks along +Y, player 1's along -Y, so half a turn of the
    // disc swaps them (see {@link CoinPose.spin}).
    for (const face of faces) {
      const canvas = strikeFace(face);
      this.canvases.push(canvas);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.FrontSide });
      this.faceMats.push(mat);
      const geo = new THREE.CircleGeometry(radius * 0.995, 72);
      this.made.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      const up = face.owner === 0 ? 1 : -1;
      mesh.position.y = (up * thickness) / 2;
      // Turned so the struck face looks outward and reads the right way up when
      // that side's half-turn brings it round to the camera.
      mesh.rotation.x = -up * (Math.PI / 2);
      this.disc.add(mesh);
    }

    // Travels with the coin, so the rim glints wherever the toss carries it.
    this.light = new THREE.PointLight(0xfff0c8, 14, radius * 9, 2);
    this.light.position.set(radius * 1.6, radius * 1.4, radius * 2.4);
    this.disc.add(this.light);

    this.group.add(this.disc);
    this.group.renderOrder = 9;
    this.disc.traverse((o) => {
      o.renderOrder = 9;
      o.raycast = () => {};
    });
  }

  /** Turn and dress the coin for a pose (its placing in the view is the caller's). */
  apply(pose: CoinPose): void {
    this.disc.rotation.set(Math.PI / 2 + pose.spin, 0, pose.lean);
    this.disc.scale.setScalar(pose.scale);
    const lit = 1 + 2.2 * pose.glow;
    for (const mat of this.faceMats) {
      mat.opacity = pose.opacity;
      mat.color.setScalar(lit);
    }
    this.rimMat.opacity = pose.opacity;
    this.rimMat.emissiveIntensity = 1.1 + 1.8 * pose.glow;
    this.light.intensity = 14 * (0.6 + 0.9 * pose.glow);
  }

  /**
   * Strike the champions' sprites onto the faces once their team-coloured art
   * is in (the medallions are drawn at once, and the figures land on them a
   * frame or two later — before the coin is halfway up).
   */
  dressSprites(faces: readonly [CoinFace, CoinFace]): void {
    faces.forEach((face, i) => {
      const sprite = spriteFor(face.unit);
      loadSpriteAtlas(sprite, framesOf(sprite), face.owner).then(
        (atlas) => {
          if (this.disposed) return;
          const canvas = this.canvases[i];
          const mat = this.faceMats[i];
          if (!canvas || !mat) return;
          engraveSprite(canvas, atlas, sprite);
          (mat.map as THREE.CanvasTexture | null)?.dispose();
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          mat.map = texture;
          mat.needsUpdate = true;
        },
        (err) => console.error(err),
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    for (const geo of this.made) geo.dispose();
    for (const mat of this.faceMats) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.rimMat.dispose();
    this.light.dispose();
  }
}

/**
 * Paint one face of the coin: the side's colour sunk into a struck gold
 * medallion, with its name round the foot. The champion is engraved on top
 * later, once its art has loaded (see {@link engraveSprite}).
 */
function strikeFace(face: CoinFace): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = FACE_PX;
  const ctx = canvas.getContext('2d')!;
  const mid = FACE_PX / 2;
  const hex = `#${face.color.toString(16).padStart(6, '0')}`;

  // The field: the side's colour, lit from the top left and darkening to the rim.
  const field = ctx.createRadialGradient(mid * 0.7, mid * 0.65, mid * 0.1, mid, mid, mid);
  field.addColorStop(0, mix(hex, '#ffffff', 0.45));
  field.addColorStop(0.55, hex);
  field.addColorStop(1, mix(hex, '#000000', 0.62));
  ctx.beginPath();
  ctx.arc(mid, mid, mid, 0, Math.PI * 2);
  ctx.fillStyle = field;
  ctx.fill();

  // Rays struck out from the middle, so the face flares as it turns.
  ctx.save();
  ctx.beginPath();
  ctx.arc(mid, mid, mid * 0.9, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 24; i++) {
    ctx.beginPath();
    ctx.moveTo(mid, mid);
    const a = (i / 24) * Math.PI * 2;
    const w = Math.PI / 24;
    ctx.arc(mid, mid, mid, a, a + w);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // The gold border: a bright bevel, a dark seat, and a ring of beads.
  ring(ctx, mid, mid * 0.955, mid * 0.07, GOLD, GOLD_DEEP);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = mid * 0.016;
  ctx.beginPath();
  ctx.arc(mid, mid, mid * 0.885, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(mid + Math.cos(a) * mid * 0.925, mid + Math.sin(a) * mid * 0.925, mid * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }

  engraveName(ctx, face.name);
  return canvas;
}

/** A gold band of width `w` centred on radius `r`, bright above and dark below. */
function ring(ctx: CanvasRenderingContext2D, mid: number, r: number, w: number, bright: string, dark: string): void {
  const grad = ctx.createLinearGradient(0, mid - r, 0, mid + r);
  grad.addColorStop(0, bright);
  grad.addColorStop(0.45, mix(bright, '#ffffff', 0.5));
  grad.addColorStop(0.6, dark);
  grad.addColorStop(1, mix(dark, '#ffffff', 0.4));
  ctx.strokeStyle = grad;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(mid, mid, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** The side's name, struck in gold along the foot of the face. */
function engraveName(ctx: CanvasRenderingContext2D, name: string): void {
  const mid = FACE_PX / 2;
  const text = name.toUpperCase();
  let size = mid * 0.19;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Shrink to fit: army names run much longer than "YOU".
  for (; size > mid * 0.08; size -= 2) {
    ctx.font = `700 ${size}px "Trebuchet MS", system-ui, sans-serif`;
    if (ctx.measureText(text).width <= mid * 1.45) break;
  }
  const y = mid + mid * 0.76;
  // A dark plinth, so the letters read over the field.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(mid, y - size * 0.3, mid * 0.8, size * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = GOLD_DEEP;
  ctx.strokeText(text, mid, y);
  ctx.fillStyle = GOLD;
  ctx.fillText(text, mid, y);
}

/** How much of the face's width the champion is drawn across. */
const SPRITE_SPAN = 0.62;

/**
 * Engrave a champion on a struck face: its team-coloured base frame, blown up
 * by a whole number of pixels so the art stays as crisp as it is on the board,
 * standing on a soft shadow.
 */
function engraveSprite(canvas: HTMLCanvasElement, atlas: SpriteAtlas, frame: string): void {
  const rect = atlas.frames.get(frame);
  if (!rect) return;
  const source = atlas.canvas;
  const ctx = canvas.getContext('2d')!;
  const mid = FACE_PX / 2;
  // The atlas is flipped for three.js, so the cell's top is measured from the bottom.
  const sx = Math.round(rect.u * source.width);
  const sy = Math.round((1 - rect.v) * source.height) - atlas.cellH;
  const zoom = Math.max(1, Math.floor((FACE_PX * SPRITE_SPAN) / Math.max(atlas.cellW, atlas.cellH)));
  const w = atlas.cellW * zoom;
  const h = atlas.cellH * zoom;
  const x = mid - w / 2;
  // Stood a little above the middle, clear of the name along the foot.
  const y = mid - h / 2 - FACE_PX * 0.05;

  const shadow = ctx.createRadialGradient(mid, y + h * 0.9, 1, mid, y + h * 0.9, w * 0.42);
  shadow.addColorStop(0, 'rgba(0,0,0,0.5)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(mid, y + h * 0.9, w * 0.42, h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, atlas.cellW, atlas.cellH, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

/** `a` blended `t` of the way toward `b`, both as `#rrggbb`. */
function mix(a: string, b: string, t: number): string {
  const part = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  const c = [0, 2, 4].map((at) => Math.round(part(a.slice(1), at) * (1 - t) + part(b.slice(1), at) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** The world radius a coin is struck at, for a camera `dist` away with this field of view. */
export function coinRadius(dist: number, fovDeg: number): number {
  return dist * Math.tan((fovDeg * Math.PI) / 360) * COIN_VIEW_SPAN;
}

/** How far up the view a coin at `rise` sits, in world units, for the same camera. */
export function coinOffset(rise: number, dist: number, fovDeg: number): number {
  return rise * 2 * dist * Math.tan((fovDeg * Math.PI) / 360);
}
