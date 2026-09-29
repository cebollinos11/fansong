import * as THREE from 'three';

// What the board stands in: a sky dome that follows the camera (so it reads as
// infinitely far) and, for some designs, a ground or cloud layer under the table
// that fades into the sky's horizon colour with distance. Everything is unlit
// shader work, posterised and dithered on a coarse screen grid to sit with the
// Wesnoth pixel art rather than read as a photographic sky.

export const BACKDROPS = ['void', 'meadow', 'clouds', 'dusk', 'night', 'table'] as const;
export type BackdropKind = (typeof BACKDROPS)[number];

/** Wesnoth's hex grid in pixels (see lava.ts). */
const WESNOTH_COL_PX = 54;
const WESNOTH_ROW_PX = 72;
/**
 * The meadow is a 16×12 block of Wesnoth's 72 px grass hexes, scattered at
 * random with a little dry grass, wrapped at the edges so it repeats seamlessly.
 */
const MEADOW_COLS = 16;
const MEADOW_ROWS = 12;
const MEADOW_W = WESNOTH_COL_PX * MEADOW_COLS;
const MEADOW_H = WESNOTH_ROW_PX * MEADOW_ROWS;
const MEADOW_DRY = 0.15;
const GREEN_TILES = ['green', 'green2', 'green3', 'green4', 'green5', 'green6', 'green7', 'green8'];
const DRY_TILES = ['semi-dry', 'semi-dry2', 'semi-dry3'];
/** The Wesnoth images the meadow is built from, under `public/sprites/` (vendored by the importer). */
export const MEADOW_TILES = [...GREEN_TILES, ...DRY_TILES].map((n) => `terrain/grass/${n}.png`);

/** The names on the backdrop button. */
export const BACKDROP_LABELS: Record<BackdropKind, string> = {
  void: 'None',
  meadow: 'Meadow',
  clouds: 'Clouds',
  dusk: 'Dusk',
  night: 'Night',
  table: 'Table',
};

interface Palette {
  zenith: number;
  horizon: number;
  /** Straight down: the horizon colour again wherever a floor fades into it, or the gap past its far edge shows. */
  nadir: number;
  /** Cloud tops (lit, shade) and the sky seen through gaps, or the ground colour. */
  lit: number;
  shade: number;
  gap: number;
}

const PALETTES: Record<Exclude<BackdropKind, 'void'>, Palette> = {
  meadow: { zenith: 0x5a7fa8, horizon: 0xb9c9cf, nadir: 0xb9c9cf, lit: 0, shade: 0, gap: 0 },
  clouds: { zenith: 0x3d6ea8, horizon: 0xbfd6ea, nadir: 0xbfd6ea, lit: 0xf4f6fa, shade: 0x9fb2cc, gap: 0x5d82b4 },
  dusk: { zenith: 0x1d1f45, horizon: 0xf09a5c, nadir: 0xf09a5c, lit: 0xf7b98a, shade: 0x8a5a7a, gap: 0x2f2548 },
  night: { zenith: 0x05060d, horizon: 0x0b0d1c, nadir: 0x05060d, lit: 0x5b3a8a, shade: 0x1f5a7a, gap: 0 },
  table: { zenith: 0x07080a, horizon: 0x07080a, nadir: 0x07080a, lit: 0x6e4a2c, shade: 0x3e2716, gap: 0 },
};

const NOISE = /* glsl */ `
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm2(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise2(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
    return v;
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y),
      u.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise3(p); p = p * 2.07 + vec3(5.0, 11.0, 3.0); a *= 0.5; }
    return v;
  }
  // Ordered dither threshold on a 3 px screen grid, 0..1.
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float dither() { return bayer2(0.5 * gl_FragCoord.xy / 3.0) * 0.25 + bayer2(gl_FragCoord.xy / 3.0); }
  // Step between colours in bands, dithering only a narrow seam at each band edge.
  float band(float v, float steps) { return floor(v * steps + (dither() - 0.5) * 0.6 + 0.5) / steps; }
`;

const DOME_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const DOME_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uNadir, uLit, uShade;
  uniform float uTime;
  varying vec3 vDir;
  ${NOISE}
  void main() {
    vec3 d = normalize(vDir);
    // Eased so the sky leaves the horizon colour gently, meeting the hazy floor without a seam.
    float up = 1.0 - pow(1.0 - clamp(d.y, 0.0, 1.0), 3.0);
    float down = 1.0 - pow(1.0 - clamp(-d.y, 0.0, 1.0), 3.0);
    vec3 c = d.y > 0.0 ? mix(uHorizon, uZenith, up) : mix(uHorizon, uNadir, down);
    #ifdef STARS
      // A nebula drifting through the whole sphere, in two posterised tints.
      float n = fbm3(d * 2.2 + vec3(0.0, 0.0, uTime * 0.004));
      float m = fbm3(d * 3.1 + vec3(9.0, 2.0, 0.0));
      c += uLit * band(smoothstep(0.5, 0.8, n), 4.0) * 0.55;
      c += uShade * band(smoothstep(0.55, 0.85, m), 4.0) * 0.5;
      // Pixel stars: at most one per cell of a grid around the sphere, a small
      // square of fixed angular size about a random point in the cell.
      vec3 cell = floor(d * 120.0);
      float h = hash3(cell);
      vec3 star = normalize((cell + 0.3 + 0.4 * vec3(h, fract(h * 13.0), fract(h * 29.0))) / 120.0);
      vec3 off = abs(d - star) * 120.0;
      if (h > 0.93 && max(off.x, max(off.y, off.z)) < mix(0.05, 0.1, fract(h * 431.0))) {
        float tw = 0.65 + 0.35 * sin(uTime * (1.0 + 3.0 * fract(h * 97.0)) + h * 50.0);
        vec3 tint = mix(vec3(1.0, 0.85, 0.6), vec3(0.7, 0.85, 1.0), fract(h * 57.0));
        c += tint * pow(fract(h * 431.0), 2.0) * 1.6 * tw;
      }
    #endif
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

const FLOOR_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const FLOOR_FRAGMENT = /* glsl */ `
  uniform vec3 uHorizon, uLit, uShade, uGap;
  uniform vec3 uCam;
  uniform float uTime;
  uniform vec2 uFade;
  /** The board's centre and half extents on the ground, to shade the ground at its foot. */
  uniform vec2 uBoardCentre, uBoardHalf;
  uniform sampler2D uMap;
  uniform vec2 uTexel, uOrigin;
  varying vec3 vWorld;
  ${NOISE}
  float boardDist(vec2 p) {
    vec2 q = abs(p - uBoardCentre) - uBoardHalf;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }
  void main() {
    vec2 p = vWorld.xz;
    vec3 c;
    #if defined(MEADOW)
      // Wesnoth's grass hexes on the board's own grid, cell (0, 0) at uOrigin.
      vec2 px = (p - uOrigin) / uTexel + vec2(36.0);
      c = texture2D(uMap, px / vec2(${MEADOW_W}.0, ${MEADOW_H}.0)).rgb * 0.72;
      c *= mix(0.5, 1.0, band(smoothstep(0.0, 1.6, boardDist(p)), 4.0));
    #elif defined(TABLE)
      // Planks running across the table, pixelated on Wesnoth's pixel grid.
      vec2 q = floor(p / (uTexel * 2.0)) * uTexel * 2.0;
      float plank = floor(q.y / 1.1);
      float grain = fbm2(vec2(q.x * 0.35 + plank * 13.0, q.y * 9.0));
      float tint = hash2(vec2(plank, 3.0));
      c = mix(uShade, uLit, band(clamp(grain * 0.9 + tint * 0.35, 0.0, 1.0), 5.0));
      c *= step(0.06, fract(q.y / 1.1)) * 0.55 + 0.45; // seam between planks
      // A lamp over the board, falling off into the dark room.
      float r = length(p - uBoardCentre) / (length(uBoardHalf) * 1.5);
      c *= band(1.0 / (1.0 + r * r * 2.2), 12.0);
      c *= mix(0.45, 1.0, band(smoothstep(0.0, 0.9, boardDist(p)), 3.0));
    #else
      // A sea of cloud, lit from one side, drifting slowly.
      vec2 q = p * 0.07 + vec2(uTime * 0.006, uTime * 0.002);
      float n = fbm2(q);
      float lit = fbm2(q + vec2(0.035, 0.05));
      float cover = band(smoothstep(0.47, 0.55, n), 2.0);
      vec3 top = mix(uShade, uLit, band(clamp((n - lit) * 8.0 + 0.55, 0.0, 1.0), 3.0));
      c = mix(uGap, top, cover);
    #endif
    // Into the haze with distance from the board (not the camera, so zooming out
    // still shows the ground beside it), and fully by the horizon so the floor
    // meets the sky without a seam.
    float dist = max(boardDist(p), 0.0);
    float below = (uCam.y - vWorld.y) / length(vWorld - uCam);
    c = mix(c, uHorizon, max(smoothstep(uFade.x, uFade.y, dist), 1.0 - smoothstep(0.0, 0.12, below)));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

let meadowTexture: THREE.Texture | null = null;

/** The meadow, built once and kept for every board. It shows plain grass green until its hexes arrive. */
function meadowMap(): THREE.Texture {
  if (meadowTexture) return meadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = MEADOW_W;
  canvas.height = MEADOW_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4f6f2c';
  ctx.fillRect(0, 0, MEADOW_W, MEADOW_H);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // image down is world +z, as the board's rows run
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter; // crisp pixels up close
  texture.minFilter = THREE.LinearMipmapLinearFilter; // no shimmer far away
  meadowTexture = texture;

  const load = (path: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `${import.meta.env.BASE_URL}sprites/${path}`;
    });
  void Promise.all(MEADOW_TILES.map(load)).then(
    (tiles) => {
      const green = tiles.slice(0, GREEN_TILES.length);
      const dry = tiles.slice(GREEN_TILES.length);
      let seed = 7;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      for (let c = 0; c < MEADOW_COLS; c++) {
        for (let r = 0; r < MEADOW_ROWS; r++) {
          const pool = random() < MEADOW_DRY ? dry : green;
          const tile = pool[Math.floor(random() * pool.length)]!;
          // Odd columns sit half a row lower, as on the board; hexes over an
          // edge are drawn again on the far side so the block wraps.
          const x = WESNOTH_COL_PX * c;
          const y = WESNOTH_ROW_PX * r + (c & 1 ? WESNOTH_ROW_PX / 2 : 0);
          for (const dx of [-MEADOW_W, 0, MEADOW_W]) {
            for (const dy of [-MEADOW_H, 0, MEADOW_H]) ctx.drawImage(tile, x + dx, y + dy);
          }
        }
      }
      texture.needsUpdate = true;
    },
    () => {
      // A missing hex leaves the plain green; the board still plays.
    },
  );
  return texture;
}

/** The sky and ground around the board. */
export class Backdrop {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh | null = null;
  private readonly floor: THREE.Mesh | null = null;
  private readonly materials: THREE.ShaderMaterial[] = [];
  /** How far below the table the floor lies (a cloud sea sits well below it). */
  private readonly floorY: number;

  constructor(
    readonly kind: BackdropKind,
    /** World distances between hex columns and rows, to lay Wesnoth art on the board's grid. */
    colStep: number,
    rowStep: number,
    tileBottom: number,
  ) {
    this.floorY = kind === 'clouds' || kind === 'dusk' ? -7 : tileBottom - 0.002;
    if (kind === 'void') return;
    const pal = PALETTES[kind];
    const color = (hex: number) => ({ value: new THREE.Color(hex) });
    const shared = {
      uZenith: color(pal.zenith),
      uHorizon: color(pal.horizon),
      uNadir: color(pal.nadir),
      uLit: color(pal.lit),
      uShade: color(pal.shade),
      uGap: color(pal.gap),
      uTime: { value: 0 },
    };

    const domeMat = new THREE.ShaderMaterial({
      uniforms: shared,
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      defines: kind === 'night' ? { STARS: '' } : {},
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), domeMat);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    this.materials.push(domeMat);

    if (kind !== 'night') {
      const floorMat = new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uCam: { value: new THREE.Vector3() },
          uFade: { value: kind === 'table' ? new THREE.Vector2(60, 80) : new THREE.Vector2(10, 90) },
          uBoardCentre: { value: new THREE.Vector2() },
          uBoardHalf: { value: new THREE.Vector2(1, 1) },
          uMap: { value: kind === 'meadow' ? meadowMap() : null },
          uTexel: { value: new THREE.Vector2(colStep / WESNOTH_COL_PX, rowStep / WESNOTH_ROW_PX) },
          uOrigin: { value: new THREE.Vector2() },
        },
        vertexShader: FLOOR_VERTEX,
        fragmentShader: FLOOR_FRAGMENT,
        defines: kind === 'meadow' ? { MEADOW: '' } : kind === 'table' ? { TABLE: '' } : {},
      });
      const plane = new THREE.PlaneGeometry(300, 300);
      plane.rotateX(-Math.PI / 2);
      this.floor = new THREE.Mesh(plane, floorMat);
      this.floor.position.y = this.floorY;
      this.floor.frustumCulled = false;
      this.floor.renderOrder = -999;
      this.group.add(this.floor);
      this.materials.push(floorMat);
    }
  }

  /** Where the board lies: its centre and half extents on the ground, and the world position of cell (0, 0). */
  setBoard(centre: { x: number; z: number }, half: { x: number; z: number }, origin: { x: number; z: number }): void {
    const u = (this.floor?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    if (!u) return;
    u.uBoardCentre!.value.set(centre.x, centre.z);
    u.uBoardHalf!.value.set(half.x, half.z);
    u.uOrigin!.value.set(origin.x, origin.z);
  }

  /** Keep the sky centred on the camera and the floor under it, and run the clock (seconds). */
  update(camera: THREE.Camera, seconds: number): void {
    this.dome?.position.copy(camera.position);
    if (this.floor) {
      this.floor.position.set(camera.position.x, this.floorY, camera.position.z);
      (this.floor.material as THREE.ShaderMaterial).uniforms.uCam!.value.copy(camera.position);
    }
    for (const m of this.materials) m.uniforms.uTime!.value = seconds;
  }

  dispose(): void {
    for (const child of [this.dome, this.floor]) child?.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
