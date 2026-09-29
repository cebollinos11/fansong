import * as THREE from 'three';

// Molten lava in Wesnoth's pixel-art style, cheap enough for phones: the pool's
// surface is one unlit shader over the lava hex tops showing Wesnoth's animated
// lava texture, and its embers are a single point cloud animated in the vertex
// shader. Per frame the CPU only sets a clock and, every 125 ms, the frame.
//
// The texture is laid out in world space, so neighbouring lava hexes run together
// into one pool instead of tiling. Each vertex carries a "heat" in its colour's
// red channel: 1 in open melt, falling to 0 where the pool meets solid ground,
// where the melt crusts over in a dithered band of darker pixels.

/** Frames of Wesnoth's lava animation (`terrain/unwalkable/lava01..16.png`), and how long each shows. */
export const LAVA_FRAMES = 16;
const FRAME_MS = 125;
/**
 * Each frame is a 342×180 image of a 6×2 block of Wesnoth's 72 px hexes, plus
 * the overlap of the hexes around it; it repeats every 324×144 px (6 columns 54 px
 * apart, 2 rows 72 px apart), which is all the texture keeps.
 */
const TILE_W = 324;
const TILE_H = 144;
/** Wesnoth's hex grid in pixels: the step between columns and between rows. */
const WESNOTH_COL_PX = 54;
const WESNOTH_ROW_PX = 72;

/** World size of one lava texture pixel, given the board's world distance between hex columns. */
export function lavaPixel(colStep: number): number {
  return colStep / WESNOTH_COL_PX;
}

let frames: THREE.Texture[] | null = null;

/** The lava frames, loaded once and kept for every board. Each shows a plain molten orange until its image arrives. */
function lavaFrames(): THREE.Texture[] {
  if (frames) return frames;
  frames = Array.from({ length: LAVA_FRAMES }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_W;
    canvas.height = TILE_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#c8400c';
    ctx.fillRect(0, 0, TILE_W, TILE_H);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter; // crisp pixels up close
    texture.minFilter = THREE.LinearMipmapLinearFilter; // no shimmer far away
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H);
      texture.needsUpdate = true;
    };
    img.src = `${import.meta.env.BASE_URL}sprites/terrain/unwalkable/lava${String(i + 1).padStart(2, '0')}.png`;
    return texture;
  });
  return frames;
}

const SURFACE_VERTEX = /* glsl */ `
  varying vec2 vPos;
  varying float vHeat;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPos = world.xz;
    vHeat = color.r;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const SURFACE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uTexel;
  varying vec2 vPos;
  varying float vHeat;

  // Ordered (Bayer) dither thresholds on the texture's pixel grid, 0..1.
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(dot(a, vec2(0.5, a.y * 0.75)));
  }
  float bayer4(vec2 a) {
    return bayer2(0.5 * a) * 0.25 + bayer2(a);
  }

  void main() {
    vec2 px = vPos / uTexel;
    vec3 c = texture2D(uMap, px / vec2(${TILE_W}.0, ${TILE_H}.0)).rgb;
    // Toward a bank the melt crusts over, pixel by pixel, in two dithered steps.
    float cool = (1.0 - vHeat) * 1.8;
    float t = bayer4(floor(px));
    c *= step(cool, t) * 0.45 + 0.55;
    c *= step(cool, t + 1.0) * 0.45 + 0.55;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

/** The shader over the board's lava hex tops, animating Wesnoth's lava. */
export class LavaSurface {
  readonly material: THREE.ShaderMaterial;
  private readonly frames = lavaFrames();

  /** `colStep` and `rowStep` are the board's world distances between hex columns and rows, to match Wesnoth's grid. */
  constructor(colStep: number, rowStep: number) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.frames[0] },
        uTexel: { value: new THREE.Vector2(colStep / WESNOTH_COL_PX, rowStep / WESNOTH_ROW_PX) },
      },
      vertexShader: SURFACE_VERTEX,
      fragmentShader: SURFACE_FRAGMENT,
      vertexColors: true,
    });
  }

  /** Show the frame for `ms` on the animation clock. */
  set time(ms: number) {
    this.material.uniforms.uMap!.value = this.frames[Math.floor(ms / FRAME_MS) % LAVA_FRAMES];
  }
}

const EMBER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uPixel;
  attribute vec3 aSeed;
  varying float vLife;
  void main() {
    // Each ember loops forever: rises from the melt, drifts and burns out,
    // stepping pixel by pixel like a sprite.
    float life = fract(uTime * (0.22 + 0.2 * aSeed.y) + aSeed.x);
    vec3 p = position;
    p.y += life * (0.45 + 0.4 * aSeed.z);
    p.x += sin(life * 5.0 + aSeed.x * 20.0) * 0.07;
    p.z += cos(life * 4.0 + aSeed.y * 20.0) * 0.07;
    p = floor(p / uPixel) * uPixel;
    vLife = life;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Two or three pixels across, one fewer as it burns down.
    float px = floor(2.0 + 1.5 * aSeed.z - life * 1.2);
    gl_PointSize = max(1.0, px * uPixel * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const EMBER_FRAGMENT = /* glsl */ `
  varying float vLife;
  void main() {
    // Hard-edged and posterised: yellow, then orange, then a dull red spark.
    vec3 c = vLife < 0.3 ? vec3(1.0, 0.8, 0.3) : vLife < 0.65 ? vec3(1.0, 0.35, 0.03) : vec3(0.55, 0.06, 0.01);
    if (vLife < 0.06) discard;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export interface Ember {
  at: THREE.Vector3;
  seed: readonly [number, number, number];
}

/** Embers rising from each lava hex, all one draw call. */
export class LavaEmbers {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  /**
   * Each ember rises from a world point on the lava surface; its three 0..1
   * `seed`s set its timing, speed and height. `pixel` is the world size of one
   * lava texture pixel, which embers are drawn and move in.
   */
  constructor(embers: readonly Ember[], pixel: number) {
    const pos = new Float32Array(embers.length * 3);
    const seeds = new Float32Array(embers.length * 3);
    embers.forEach((e, i) => {
      pos.set([e.at.x, e.at.y, e.at.z], i * 3);
      seeds.set(e.seed, i * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 500 }, uPixel: { value: pixel } },
      vertexShader: EMBER_VERTEX,
      fragmentShader: EMBER_FRAGMENT,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false; // they rise past their resting bounds
    this.points.renderOrder = 1;
  }

  /** The animation clock, in seconds. */
  set time(s: number) {
    this.points.material.uniforms.uTime!.value = s;
  }

  set scale(v: number) {
    this.points.material.uniforms.uScale!.value = v;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
