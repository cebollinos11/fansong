import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeHexGrid, vecKey, type BoardData, type GameEvent, type GameState, type Vec } from '@fansong/engine';
import { loadSpriteAtlas, projectileTexture, type SpriteAtlas } from './spriteTextures.js';
import { animationsFor, clipDuration, framesOf, type Clip, type RangedClip, type SpriteAnimations } from './unitAnimations.js';
import { UnitAnimator } from './unitAnimator.js';
import { featureLayout, type FeaturePiece } from './features.js';
import {
  activationResolveMs,
  activationRollMs,
  NERVE_RESOLVE_MS,
  NERVE_ROLL_MS,
  OPPOSED_ROLL_MS,
  ROLL_LINGER_MS,
  RollOverlay,
} from './rollOverlay.js';
import { describeActivation, describeCombat, describeNerve } from '../ui/rollView.js';
import type { PlanPreview, ReachTile } from '../game/planView.js';
import { hexElevation, surfaceY, TILE_TOP, tileHeight, tileSideColor, tileTopColor } from './terrain.js';
import { DOWN_POSES, spriteFor } from './unitSprites.js';

/** Everything the board needs to draw one frame's worth of interaction state. */
export interface BoardViewModel {
  state: GameState;
  /** Cells the active unit can reach this activation, each with what it costs. */
  reach: ReachTile[];
  /** Enemy unit ids the active unit may strike where it stands. */
  attackTargetIds: string[];
  /** Enemy unit ids it could strike after walking in. */
  approachTargetIds: string[];
  /** Of the targets above, those it would shoot rather than strike in melee. */
  shootTargetIds?: string[];
  /** Own units that may be activated (awaitingActivation phase). */
  selectableUnitIds: string[];
  /** Unit the human has selected but not yet committed dice for. */
  selectedUnitId: string | null;
  /** Whether the local human may currently interact. */
  interactive: boolean;
  /** Tinted hex sets under the move highlights (editor zones and objectives). */
  overlays?: HexOverlay[];
  /** Game-mode markers standing on hexes (flags at base or dropped). */
  markers?: BoardMarker[];
  /** Game-mode badges floating over units (a King's crown, a carried flag). */
  badges?: Record<string, UnitBadge>;
  /** Changes whenever `markers`/`badges` do; they are only redrawn then. */
  markingsKey?: string;
}

/** A badge over a unit: a crown (King), player 0's / player 1's carried flag, or a Guard stance. */
export type UnitBadge = 'crown' | 'flag-0' | 'flag-1' | 'guard';

/** A marker standing on a hex. */
export interface BoardMarker {
  kind: 'flag';
  owner: 0 | 1;
  cell: Vec;
}

/** A tinted hex set drawn flat on the board surface. */
export interface HexOverlay {
  cells: Vec[];
  color: number;
  /** Fill opacity (default 0.3). */
  opacity?: number;
  /** Hexagon size relative to a tile (default 0.9). */
  scale?: number;
}

const OWNER_COLORS = [0x4f9dff, 0xff6b5b] as const; // P0 blue, P1 red
const BLOCKED_COLOR = 0x4a4038;

// Flat-top hex layout. Cells are offset "odd-q" coords (x = column, y = row);
// world placement uses the standard flat-top hex-to-pixel mapping, and picking
// inverts it with cube rounding, so a click always resolves to the right hex.
const HEX_SIZE = 0.62; // hex "radius" (centre to a vertex) in world units
const SQRT3 = Math.sqrt(3);
const HEX_COL_STEP = 1.5 * HEX_SIZE; // world X between adjacent columns
const HEX_ROW_STEP = SQRT3 * HEX_SIZE; // world Z between adjacent rows
const MOVE_COLOR = 0x3ddc84;
const PROVOKE_COLOR = 0xffb300; // reaching this hex breaks away from an enemy
const ATTACK_COLOR = 0xff5252;

// The reach is one green field with a ring drawn where each action's range ends,
// like a contour map: the first action's edge is brightest and thickest, and
// each further action's is fainter, so "how far for how much" reads at a glance.
const REACH_FILL_OPACITY = 0.22;
const CONTOUR_OPACITY = [0.95, 0.55, 0.32];
const CONTOUR_WIDTH = [0.08, 0.055, 0.04];
/** Distance between the centres of two adjacent hexes. */
const HEX_STEP = SQRT3 * HEX_SIZE;

/** A flat, unlit tint laid on the board surface. */
function fillMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/** A ring broken into dashes: an enemy the click walks up to before striking. */
function dashedRing(): THREE.BufferGeometry {
  const arc = (Math.PI * 2) / RING_DASHES;
  const dashes = Array.from(
    { length: RING_DASHES },
    (_, i) => new THREE.RingGeometry(RING_INNER, RING_OUTER, 6, 1, i * arc, arc * 0.6),
  );
  const merged = mergeGeometries(dashes)!;
  for (const d of dashes) d.dispose();
  return merged;
}

/**
 * Glow around a cutout's figure: lights the clear pixels within `uWidth` sprite
 * pixels of an opaque one, reading the same atlas cell the cutout shows.
 */
function outlineMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null },
      uOffset: { value: new THREE.Vector2() },
      uRepeat: { value: new THREE.Vector2(1, 1) },
      uPixel: { value: new THREE.Vector2(1 / 72, 1 / 72) },
      uWidth: { value: OUTLINE_PX },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 uOffset;
      uniform vec2 uRepeat;
      uniform vec2 uPixel;
      uniform float uWidth;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      // Mip gradients, taken once before any branch: implicit ones are undefined
      // in divergent flow, and some mobile GPUs then read the smallest mip (the
      // whole atlas blurred), tracing the quad's edges.
      vec2 gradX;
      vec2 gradY;
      // Alpha of the shown frame at a point in its cell; nothing outside the cell.
      float alphaAt(vec2 p) {
        vec2 inside = step(vec2(0.0), p) * step(p, vec2(1.0));
        return textureGrad(map, uOffset + clamp(p, 0.0, 1.0) * uRepeat, gradX, gradY).a * inside.x * inside.y;
      }
      void main() {
        gradX = dFdx(vUv * uRepeat);
        gradY = dFdy(vUv * uRepeat);
        if (alphaAt(vUv) > 0.5) discard;
        float near = 0.0;
        float far = 0.0;
        for (int i = 0; i < 12; i++) {
          float t = float(i) * 0.5235988;
          vec2 d = vec2(cos(t), sin(t)) * uPixel;
          near = max(near, max(alphaAt(vUv + d * uWidth * 0.5), alphaAt(vUv + d * uWidth)));
          far = max(far, alphaAt(vUv + d * uWidth * 2.0));
        }
        float glow = max(near, far * 0.4);
        if (glow < 0.02) discard;
        gl_FragColor = vec4(uColor, glow * uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const SELECT_COLOR = 0xffd54a;
const GUARD_COLOR = 0x53e0d0; // ring on a unit holding a Guard stance
const CROWN_COLOR = '#ffd54a';
const BADGE_SIZE = 0.42; // world size of a badge sprite
const BADGE_HEIGHT = 1.55; // badge centre above the unit's base
const SHOT_COLOR = 0x9fd0ff; // ranged tracer, for a shooter without a missile image

// Units waiting on a click wear a breathing ring and a glowing outline in the
// colour of what the click does: gold to activate, red to strike, blue to shoot.
// An enemy only reachable by walking in first gets a dashed, fainter version.
const RING_INNER = 0.41;
const RING_OUTER = 0.55;
const RING_DASHES = 12;
const CUE_SLOW_MS = 1600; // breath period for a unit to activate
const CUE_FAST_MS = 900; // breath period for a target
const CUE_SWELL = 0.06; // how much a breathing ring grows at its peak
const CUE_HOVER_SCALE = 1.12; // the ring under the pointer, held open
const OUTLINE_PX = 2; // outline width in sprite pixels, widened under the pointer
const OUTLINE_HOVER_PX = 3;

// Units are paper cutouts: a Wesnoth sprite standing upright on a round base.
const BASE_RADIUS = 0.36;
const BASE_HEIGHT = 0.06;
const SPRITE_PX = 1.8 / 72; // world units per sprite pixel (a 72px Wesnoth hex ≈ 1.8)
const BIG_SCALE = 1.3; // how much taller a Big unit's cutout stands (see the Big trait)
const SPRITE_LEAN = 0.18; // lean back (top away from the camera, radians) so the steep view doesn't squash it

// Flying: the cutout floats above its hex (its base ring stays on the ground as a
// shadow) with a slow bob — unless it is knocked down or dying, when it comes to earth.
const FLY_HOVER = 0.85; // world height a flyer floats above its base
const FLY_BOB = 0.07; // amplitude of the hovering bob
const FLY_BOB_MS = 1600; // period of the bob

// Knocked down: a sprite with a down pose (a frame of its death clip) holds it;
// one without crouches, squashed at the feet and leaning a little. Either way
// dizzy stars circle its head.
const DOWN_SQUASH = 0.72; // height scale of a crouching cutout
const DOWN_WIDEN = 1.08; // width scale of a crouching cutout
const DOWN_LEAN = 0.12; // radians a crouching cutout sags sideways
const STAR_COUNT = 3;
const STAR_SIZE = 0.2; // world size of a star sprite
const STAR_CLEARANCE = 0.08; // orbit centre above the top of the head
const STAR_ORBIT = 0.26; // orbit radius (world units)
const STAR_SPIN = 2.6; // radians per second
const STAR_COLOR = '#ffe066';

// Animation timing (ms). Clip timings come from Wesnoth; these fill the gaps.
const LUNGE = 0.3; // how far (world units) a melee strike leans into its target
const WALK_MS_PER_HEX = 300; // a move walks its path hex by hex at this steady pace
const WALK_HOP = 0.12; // world units a walking mini hops up on each hex step
const WALK_SWAY = 0.12; // radians it rocks side to side, alternating each step (Wesnoth foot units have no walk frames)
const DEFEND_LEAD_MS = 126; // Wesnoth's defend reaction starts this long before impact
// A sprite with no defend art reacts by moving instead: it gives ground as the
// blow arrives, further when it turns the blow aside than when it takes it.
const DODGE = 0.26; // how far (world units) it slips back from a blow it turns aside
const FLINCH = 0.12; // how far it rocks back from one that lands
const DODGE_MS = 110; // time to give ground, ending on the hit frame
const DODGE_RECOVER_MS = 190; // time to come back to its feet afterwards
const RIPOSTE_GAP_MS = 180; // beat between a parried swing and the counter-blow
const DEATH_FADE_MS = 600; // fade after a death clip (or instead of one)
const ROUT_MS = 700; // a routed unit flees toward its own board edge while fading
const MAX_QUEUE_MS = 4000; // most a new batch waits behind the previous one's animations
const NERVE_LEAD_MS = 900; // pause between a killing blow (its verdict) and the nerve checks it causes

// Following the action: a batch whose units sit outside this part of the view
// (normalised device coords, ±1 = the edges) pans the camera to them first.
const FOLLOW_MARGIN_X = 0.8;
const FOLLOW_MARGIN_TOP = 0.65; // tighter at the top, where the dice cards float over heads
const FOLLOW_MARGIN_BOTTOM = 0.85;
const FOLLOW_HEAD = 1.3; // world height above a base that must stay in view (the dice card)
const PAN_MIN_MS = 400;
const PAN_MAX_MS = 850;
const PAN_MS_PER_UNIT = 70; // extra pan time per world unit travelled
const CAMERA_SETTLE_MS = 150; // beat between the camera arriving and the dice starting
const CAMERA_STILL = 0.25; // a move shorter than this (world units of travel + zoom) isn't worth making
const AFTERMATH_HOLD_MS = 450; // how long a blow's result is held in close-up before pulling back out
const RIDE_MAX_SPAN = 4; // longest shot (world units) the camera rides along with; beyond it, it holds the wide framing
const RIDE_MIN_MS = 150; // shots that reach their target faster than this are too quick to ride
const SELECT_PAN_STEPS = 12; // halvings used to find the shortest pan that brings a pick into frame
const SELECT_PAN_SLACK = 0.12; // extra fraction of that pan, so the pick isn't left on the margin
const FOCUS_LEAD_MS = 220; // how long before a camera move its units start pulsing
const FOCUS_PULSE_MS = 700;
const COMBAT_CARD_HOLD_MS = 600; // how long a blow's dice cards stay up after it lands
const COMBAT_CARD_LINGER_MS = 3000; // a blow's dice cards stay up at least this long, unless the next fight replaces them
const COMBAT_SPAN_MARGIN = 2.2; // how much of the close-up the two combatants take up
const COMBAT_MIN_SPAN = 5; // world units kept in view (~5 hexes), however close the pair stand
const COMBAT_MAX_ZOOM = 0.45; // never closer than this fraction of the opening framing
const SHOT_LEAD_MS = 260; // swing to the shooter before it looses its missile

// The opening shot: the camera starts on the deployed warbands rather than the
// bare table, so the fight — not the empty ground around it — fills the view.
const START_MIN_SPAN = 8; // world units kept in view (~8 hexes), however tightly they're deployed
const START_FIT_STEPS = 18; // halvings used to find the closest framing that still holds every unit

// Camera limits: stay above the table, and never tip over the top into a flip.
const CAMERA_MIN_POLAR = 0.12; // radians from straight down
const CAMERA_MAX_POLAR = 1.3; // ~75°, just above the tabletop

/** Round fractional cube coords to the nearest hex (matches the engine's board). */
function cubeRound(fq: number, fr: number, fs: number): { q: number; r: number } {
  let q = Math.round(fq);
  let r = Math.round(fr);
  let s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

interface Tracer {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  life: number;
  max: number;
}

interface Missile {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  end: number;
  /** Lobbed projectiles (stones, spears) arc; arrows and bolts fly flat. */
  arc: number;
}

/** The middle of a set of points. */
function middle(points: THREE.Vector3[]): THREE.Vector3 {
  return points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
}

/** The status flags that change how a unit is drawn. */
interface UnitFlags {
  dead: boolean;
  knocked: boolean;
  guarding: boolean;
}

interface UnitObj {
  id: string;
  owner: 0 | 1;
  /** The unit's name from the state, for cards that sit away from it. */
  name: string;
  /** The {@link spriteFor} path this unit is drawn with. */
  spriteName: string;
  group: THREE.Group;
  /** Turns the cutout to face the camera (yaw only, so it stays upright); carries the melee lunge. */
  facing: THREE.Group;
  /** Knockdown pivot at the cutout's feet: sags and squashes a crouching unit. */
  tilt: THREE.Group;
  /** Flips the cutout to face screen-left. */
  mirror: THREE.Group;
  sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** Cutout size multiplier: {@link BIG_SCALE} for a Big unit, else 1. */
  size: number;
  /** Whether this unit is a flyer (floats above its hex unless downed). */
  flying: boolean;
  /** Current hover height, lerped toward {@link FLY_HOVER} while airborne (0 on the ground). */
  hover: number;
  base: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Mode badge sprite (shares a texture per badge kind); hidden when none. */
  badge: THREE.Sprite;
  /** Dizzy stars circling the head while knocked down. */
  stars: THREE.Group;
  anims: SpriteAnimations;
  /** Frame held while knocked down, or null to crouch instead. */
  downPose: string | null;
  animator: UnitAnimator;
  atlas: SpriteAtlas | null;
  shownImage: string | null;
  /** World-space direction the unit last moved or struck in. */
  heading: THREE.Vector3;
  faceRight: boolean;
  targetPos: THREE.Vector3;
  targetTilt: number;
  /** Flags from the latest GameState. */
  state: UnitFlags;
  /** Flags as drawn; lag `state` until `holdUntil` so blows land on the hit frame. */
  shown: UnitFlags;
  holdUntil: number;
  /** Set by a UnitRouted event: leave by fleeing, not by dying. */
  routed: boolean;
  /** Board times the fade-out starts / ends, while dying or fleeing. */
  fade: { start: number; end: number; flee: THREE.Vector3 | null } | null;
  /** A shove the cutout rides out and recovers from: a strike's lunge in, or a dodge back. */
  lunge: { dir: THREE.Vector3; start: number; hit: number; end: number } | null;
  /** A move in progress: hex centres from origin to destination, walked from board time `start`. `backward` keeps the facing (a recoil). */
  walk: { path: THREE.Vector3[]; start: number; backward?: boolean } | null;
  /** 0..1 transient hit flash, decays each frame. */
  flash: number;
  /** Ring pulse drawing the eye to a unit the camera is about to move to. */
  pulse: { start: number; end: number } | null;
  /** The ring as the view model wants it, which a finished pulse goes back to. */
  ringRest: { visible: boolean; opacity: number };
  /** Glow traced around the cutout's figure while {@link cue} is set. */
  outline: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** How this unit is flagged as a click the player can make, or null. */
  cue: UnitCue | null;
}

/** A unit marked as something to click: the colour says what the click does. */
interface UnitCue {
  color: number;
  /** Breath period in ms, or 0 to hold steady (the unit already picked). */
  period: number;
  /** Reached only by walking in first: dashed ring, dimmer glow. */
  far: boolean;
}

/** How much the camera helps: not at all, panning to off-screen action, or framing every blow. */
export type CameraMode = 'off' | 'follow' | 'cinematic';

/**
 * Thin three.js view of a FanSong board. It renders the grid, terrain and units
 * and reports clicks (as a cell and/or a unit id) back through callbacks — it
 * never decides legality. Unit transforms are lerped toward targets derived from
 * `GameState`; engine events drive Wesnoth sprite animations on a short timeline.
 */
export class BoardView {
  onUnitClick: ((id: string) => void) | null = null;
  onCellClick: ((cell: Vec) => void) | null = null;
  /** Fires when the hex under the pointer changes (null when it leaves the board). */
  onCellHover: ((cell: Vec | null) => void) | null = null;
  /**
   * Editor drag painting (see {@link setCellDrag}): reports the press cell and
   * the cell under the pointer while dragging, then once more with `done`.
   */
  private onCellDrag: ((from: Vec, to: Vec, done: boolean) => void) | null = null;
  private drag: { from: Vec; to: Vec; key: string; moved: boolean } | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly resizeObserver: ResizeObserver;

  private readonly units = new Map<string, UnitObj>();
  /** Dice cards and verdicts over the units. */
  private readonly rolls: RollOverlay;
  private readonly tracers: Tracer[] = [];
  private readonly missiles: Missile[] = [];
  /** Deferred animation steps, run once board time reaches `at` (ms). */
  private readonly timeline: { at: number; fn: () => void }[] = [];
  /** Board time (ms) since the view was created; drives all animation. */
  private now = 0;
  /** When the current batch of combat animations finishes. */
  private busyUntil = 0;
  /**
   * Move the camera to the action before playing it: off-screen activations and
   * moves are panned to (see {@link planPan}), and — in `cinematic` — every blow
   * is framed on its two combatants (see {@link frameCombat}). The animations
   * wait for the camera.
   */
  cameraMode: CameraMode = 'cinematic';
  /** A camera move in progress: the orbit pivot glides while the view distance eases. */
  private cam: {
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromDist: number;
    toDist: number;
    start: number;
    dur: number;
    /** Constant speed (a tracked projectile) rather than eased ends. */
    linear?: boolean;
  } | null = null;
  /**
   * Where the camera will stand once every move scheduled in this batch has run.
   * Each move is planned from here, not from where the camera happens to be now.
   */
  private planned: { target: THREE.Vector3; dist: number } | null = null;
  /** View distance to glide back out to once the fighting stops (null: nothing to restore). */
  private restoreDist: number | null = null;
  /** The framing the player last set by hand; given back whenever they can act again. */
  private playerView: { target: THREE.Vector3; dist: number } | null = null;
  /** Whether the player could act at the last update, to spot the moment they can again. */
  private wasInteractive = false;
  /** The selection the camera has already answered, so a pick is panned to once. */
  private pannedTo: string | null = null;
  /** The distance of the opening shot (see {@link positionCamera}); combat never pulls further out than this. */
  private homeDist = 0;
  /**
   * The opening shot and the units it was fitted to, while it still stands: a
   * canvas that changes shape re-fits it (see {@link refitOpening}), until the
   * player moves the camera or the first blow plays.
   */
  private opening: { points: THREE.Vector3[]; target: THREE.Vector3; dist: number } | null = null;
  /** Dev aid: `?animSpeed=0.25` plays animations at quarter speed. */
  private readonly animSpeed = import.meta.env.DEV
    ? Number(new URLSearchParams(window.location.search).get('animSpeed')) || 1
    : 1;
  private readonly highlightGroup = new THREE.Group();
  private readonly previewGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  /**
   * The highlight layer is rebuilt whenever the reach changes *or* the pointer
   * moves to a new hex, so its geometry and materials are made once and kept —
   * building them per redraw used to leak one set per command.
   */
  private reachFillGeo: THREE.CircleGeometry | null = null;
  private reachFillMat: THREE.MeshBasicMaterial | null = null;
  private provokeFillMat: THREE.MeshBasicMaterial | null = null;
  private readonly contourGeo: (THREE.PlaneGeometry | null)[] = [];
  private readonly contourMat: (THREE.MeshBasicMaterial | null)[] = [];
  private previewLineMat: THREE.LineBasicMaterial | null = null;
  private previewDotGeo: THREE.CircleGeometry | null = null;
  private previewDotMat: THREE.MeshBasicMaterial | null = null;
  /** What `drawHighlights` last drew, so an unchanged reach is not rebuilt. */
  private reachKey = '';
  private overlays: HexOverlay[] | undefined;
  private readonly markerGroup = new THREE.Group();
  private markingsKey: string | undefined;
  private readonly badgeTextures = new Map<string, THREE.Texture>();
  private starMaterial: THREE.SpriteMaterial | null = null;
  /** Board tiles and feature meshes, raycast for cell picking (each carries `userData.cell`). */
  private readonly tiles: THREE.Mesh[] = [];
  private board: BoardData | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;
  private downPos: { x: number; y: number } | null = null;
  private hoverKey: string | null = null;
  /** The unit figure under the pointer, so a clickable one can answer it. */
  private hoverUnitId: string | null = null;
  private readonly ringGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 40);
  private readonly dashedRingGeo = dashedRing();
  private clock = new THREE.Clock();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    this.scene.background = new THREE.Color(0x11151c);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

    // Physical lighting divides indirect light by π, so ~π is "full" ambient.
    const ambient = new THREE.HemisphereLight(0xeef2ff, 0x5a5448, 2.6);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 14, 8);
    this.scene.add(
      ambient,
      key,
      this.overlayGroup,
      this.highlightGroup,
      this.previewGroup,
      this.markerGroup,
    );

    // Left-drag orbits, right-drag (or shift/ctrl + left) pans across the table,
    // wheel zooms. A press that barely moves is still a click (see handlePointerUp).
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false; // pan along the ground, not the view plane
    this.controls.minPolarAngle = CAMERA_MIN_POLAR;
    this.controls.maxPolarAngle = CAMERA_MAX_POLAR;
    this.controls.zoomToCursor = true;
    // A hand on the camera takes it back: drop the scripted move, and adopt the
    // framing the player leaves it in as theirs.
    this.controls.addEventListener('start', () => {
      this.cam = null;
      this.planned = null;
      this.restoreDist = null;
      this.opening = null;
    });
    this.controls.addEventListener('end', () => this.rememberPlayerView());

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.handlePointerLeave);

    this.rolls = new RollOverlay(
      this.container,
      (id) => this.units.get(id)?.owner,
      (id) => this.units.get(id)?.name,
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop(this.render);
  }

  /**
   * Build the static board (grid + terrain). Called once per match; the editor
   * calls it again after every edit, which replaces the old tiles and keeps the
   * camera unless the board size changed.
   */
  buildBoard(state: GameState): void {
    const resized = state.board.width !== this.width || state.board.height !== this.height;
    this.clearBoard();
    this.board = state.board;
    this.width = state.board.width;
    this.height = state.board.height;
    const blocked = new Set(state.board.blocked);

    // A flat-top hex prism: a 6-sided cylinder, whose default orientation already
    // points its vertices along ±X (columns) and its flat edges along ±Z (rows).
    // Every prism stands on the same floor and rises to its hex's elevation; its
    // side faces (the cylinder's first material group) are shaded darker than the top.
    const geos = new Map<number, THREE.CylinderGeometry>();
    const tileGeo = (height: number) => {
      let geo = geos.get(height);
      if (!geo) {
        geo = new THREE.CylinderGeometry(HEX_SIZE * 0.94, HEX_SIZE * 0.94, height, 6);
        geos.set(height, geo);
      }
      return geo;
    };
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = { x, y };
        const isBlocked = blocked.has(vecKey(cell));
        const elev = hexElevation(state.board, cell);
        const top = new THREE.MeshStandardMaterial({ color: isBlocked ? BLOCKED_COLOR : tileTopColor(cell, elev) });
        const side = isBlocked ? top : new THREE.MeshStandardMaterial({ color: tileSideColor(cell, elev) });
        // Legacy blocked cells stay a tall pillar above whatever their elevation is.
        const height = tileHeight(elev) + (isBlocked ? 0.4 : 0);
        const tile = new THREE.Mesh(tileGeo(height), [side, top, top]);
        const w = this.cellToWorld(cell);
        tile.position.set(w.x, surfaceY(elev) + (isBlocked ? 0.4 : 0) - height / 2, w.z);
        tile.userData.cell = cell;
        this.tiles.push(tile);
        this.scene.add(tile);
      }
    }

    this.buildFeatures(state.board);
    if (resized) this.positionCamera(state);
  }

  /** Remove the tiles and feature meshes of a previously built board. */
  private clearBoard(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const mesh of this.tiles) {
      this.scene.remove(mesh);
      geometries.add(mesh.geometry);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    }
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    this.tiles.length = 0;
  }

  /** Low-poly rocks, buildings and trees; pickable as the hex they stand on. */
  private buildFeatures(board: BoardData): void {
    const materials = new Map<number, THREE.MeshStandardMaterial>();
    const material = (color: number) => {
      let m = materials.get(color);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color, flatShading: true });
        materials.set(color, m);
      }
      return m;
    };
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const coneGeo = new THREE.ConeGeometry(1, 1, 7);
    const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
    const meshFor = (p: FeaturePiece): THREE.Mesh => {
      switch (p.kind) {
        case 'rock': {
          const m = new THREE.Mesh(rockGeo, material(p.color));
          m.scale.set(p.radius, p.radius * p.squash, p.radius);
          m.rotation.y = p.rotY;
          return m;
        }
        case 'box': {
          const m = new THREE.Mesh(boxGeo, material(p.color));
          m.scale.set(p.w, p.h, p.d);
          m.rotation.y = p.rotY;
          return m;
        }
        case 'cone':
        case 'trunk': {
          const m = new THREE.Mesh(p.kind === 'cone' ? coneGeo : trunkGeo, material(p.color));
          m.scale.set(p.radius, p.h, p.radius);
          return m;
        }
      }
    };
    for (const p of featureLayout(board, (v) => this.cellToWorld(v), HEX_SIZE)) {
      const mesh = meshFor(p);
      mesh.position.set(p.x, p.y, p.z);
      mesh.userData.cell = p.cell;
      this.tiles.push(mesh);
      this.scene.add(mesh);
    }
  }

  /** Reconcile unit meshes and highlights with the given view model. */
  update(vm: BoardViewModel): void {
    const { state } = vm;

    // Sync unit meshes (create/move/kill).
    const seen = new Set<string>();
    for (const u of state.units) {
      seen.add(u.id);
      let obj = this.units.get(u.id);
      // A unit whose look changed (an online host's stand-in opponent replaced
      // by the real army), or whose side, size or flight the dev sandbox
      // rewrote, is rebuilt with its new sprite.
      if (
        obj &&
        (obj.spriteName !== spriteFor(u.look ?? u.name) ||
          obj.owner !== u.owner ||
          obj.size !== (u.traits.big ? BIG_SCALE : 1) ||
          obj.flying !== u.traits.flying)
      ) {
        this.scene.remove(obj.group);
        this.units.delete(u.id);
        obj = undefined;
      }
      if (!obj) {
        obj = this.createUnit(u.id, u.owner, u.look ?? u.name, u.traits.big, u.traits.flying);
        this.units.set(u.id, obj);
        obj.group.position.copy(this.unitWorld(u.pos));
      }
      obj.targetPos = this.unitWorld(u.pos);
      obj.name = u.name;
      obj.state = { dead: u.dead, knocked: u.knockedDown, guarding: u.guarding && !u.dead };

      const isActive = state.activeUnitId === u.id;
      const isSelected = vm.selectedUnitId === u.id;
      const isSelectable = vm.selectableUnitIds.includes(u.id);
      const isAttackTarget = vm.attackTargetIds.includes(u.id);
      // Reachable on foot, then strikeable: the same red, held back, so "walk in
      // and hit this" is distinguishable from "hit this now" without a new colour.
      const isApproachTarget = !isAttackTarget && vm.approachTargetIds.includes(u.id);
      const isGuarding = u.guarding && !u.dead;
      const isShot = vm.shootTargetIds?.includes(u.id) ?? false;
      obj.cue =
        isAttackTarget || isApproachTarget
          ? { color: isShot ? SHOT_COLOR : ATTACK_COLOR, period: CUE_FAST_MS, far: isApproachTarget }
          : isSelected
            ? { color: SELECT_COLOR, period: 0, far: false }
            : isSelectable
              ? { color: SELECT_COLOR, period: CUE_SLOW_MS, far: false }
              : null;
      obj.ring.geometry = obj.cue?.far ? this.dashedRingGeo : this.ringGeo;
      obj.ring.visible = !obj.fade && (isActive || isGuarding || obj.cue !== null);
      obj.ring.material.color.setHex(obj.cue ? obj.cue.color : isActive ? SELECT_COLOR : GUARD_COLOR);
      obj.ring.material.opacity = isActive || obj.cue ? 0.95 : 0.7;
      obj.ringRest = { visible: obj.ring.visible, opacity: obj.ring.material.opacity };
    }
    // Remove meshes for units no longer present (shouldn't happen, but be safe).
    for (const [id, obj] of this.units) {
      if (!seen.has(id)) {
        this.scene.remove(obj.group);
        this.units.delete(id);
      }
    }

    this.drawHighlights(vm.reach);
    if (vm.overlays !== this.overlays) this.drawOverlays(vm.overlays ?? []);
    if (vm.markingsKey !== this.markingsKey) this.drawMarkings(vm);
    this.renderer.domElement.style.cursor = vm.interactive ? 'pointer' : 'default';

    // The moment the player can act again, give them back the view they set.
    if (vm.interactive && !this.wasInteractive) this.returnToPlayerView();
    this.wasInteractive = vm.interactive;
    this.panToSelected(vm.selectedUnitId);
  }

  /**
   * Play a batch of engine events as Wesnoth-style animations. Steps are laid
   * out on a timeline: every roll first plays out on a dice card over the units
   * (dice, modifiers, total), then the strike plays its attack clip, the target
   * reacts on the clip's hit frame, and knockdowns/deaths wait for that same
   * moment (the GameState that already contains them is held back until then).
   * Returns how long (ms from now) until the batch has played out.
   */
  animateEvents(events: GameEvent[]): number {
    this.opening = null; // the units are about to leave the deployment it was fitted to
    let t = Math.min(MAX_QUEUE_MS, Math.max(0, this.busyUntil - this.now));
    // Every camera move in this batch is planned from where the last one leaves
    // off, starting from where the camera actually is (or is already heading).
    this.planned = null;
    this.planned = this.plannedCamera();
    // Off-screen action: pan there first, and start everything once the camera arrives.
    t += this.pause(this.planPan(events, t));
    let lastHit = t; // when the most recent blow lands, for its consequences
    let settle = t; // when state changes caused by the latest roll or blow are shown
    let nerveAt: number | null = null; // start of the current run of nerve checks
    const hold = (id: string, until: number) => {
      const obj = this.units.get(id);
      if (obj) obj.holdUntil = Math.max(obj.holdUntil, this.now + until);
    };

    events.forEach((e, i) => {
      const after = events.slice(i + 1);
      if (e.type !== 'NerveCheck') nerveAt = null;
      if (e.type === 'UnitMoved' || e.type === 'UnitFled') {
        const obj = this.units.get(e.unitId);
        if (obj) {
          // A runner breaks once its nerve check (and any hack at its back) has shown.
          if (e.type === 'UnitFled') t = Math.max(t, settle);
          // Walk hex by hex at a steady pace, so a longer move takes proportionally longer.
          const path = e.path ? e.path.map((c) => this.unitWorld(c)) : this.walkPath(e.from, e.to);
          const dur = (path.length - 1) * WALK_MS_PER_HEX;
          obj.walk = { path, start: this.now + t };
          this.at(t, () => {
            obj.animator.stop(); // an idle flourish mustn't play over the walk
            obj.animator.moveFor(dur);
          });
          t += dur;
          lastHit = settle = t;
        }
      } else if (e.type === 'ActivationChosen') {
        const obj = this.units.get(e.unitId);
        if (obj?.anims.leading) this.at(t, () => obj.animator.play(obj.anims.leading));
      } else if (e.type === 'DiceRolled') {
        const roll = describeActivation(e, after);
        const start = t;
        const resolve = start + activationResolveMs(roll.dice.length);
        const end = start + activationRollMs(roll.dice.length);
        this.at(start, () => this.rolls.addActivation(roll, this.now, end - start + ROLL_LINGER_MS));
        if (roll.verdict) {
          const verdict = roll.verdict;
          this.at(resolve, () => this.rolls.addVerdict(verdict, this.now));
        }
        settle = resolve;
        t = end;
      } else if (e.type === 'UnitStoodUp') {
        hold(e.unitId, settle);
      } else if (
        e.type === 'AttackResolved' ||
        e.type === 'ShotResolved' ||
        e.type === 'GuardRiposte' ||
        e.type === 'FreeHackResolved'
      ) {
        const roll = describeCombat(e, after);
        const pair: [string, string] =
          e.type === 'GuardRiposte' ? [e.guardId, e.attackerId] : [e.attackerId, e.targetId];
        // A blow plays in three beats: frame the pair, show their dice, then
        // strike while the cards are still up in the corners.
        t += this.pause(this.frameCombat(pair, t));
        const start = t;
        const cards = OPPOSED_ROLL_MS; // the cards show their outcome at once; a beat to read it
        // Whoever pair[0] is — attacker, shooter, hacker, riposting guard — the
        // blow only reaches pair[1] on a defender-side result. Anything else is
        // a miss, a getaway, a clash, or a parry the guard didn't land, and
        // must not flash the other unit as though it had connected.
        const land = e.result.startsWith('defender');
        // Melee the defender answers plays as an exchange, so the swing goes in
        // and is turned aside before the answer comes back — landing when the
        // attacker lost the roll, turned aside in its turn when they clashed.
        const s =
          e.type === 'AttackResolved' && this.answered(e)
            ? this.exchange(pair[0], pair[1], start + cards, { land: e.result.startsWith('attacker') })
            : this.strike(pair[0], pair[1], e.type === 'ShotResolved' ? 'ranged' : 'melee', start + cards, { land });
        const life = Math.max(COMBAT_CARD_LINGER_MS, s.hit - start + COMBAT_CARD_HOLD_MS);
        this.at(start, () => this.rolls.addOpposed(roll, this.now, life));
        // The conclusion lands along the bottom centre, between the two dice cards.
        this.at(s.hit, () => this.rolls.addVerdict(roll.verdict, this.now, 'bottom'));
        lastHit = s.hit;
        settle = s.hit;
        t = s.end;
      } else if (e.type === 'NerveCheck') {
        // A run of checks (every nearby friend, or a whole routing warband) rolls at once.
        if (nerveAt === null) {
          const base = Math.max(lastHit, settle) + NERVE_LEAD_MS;
          this.at(base, () => this.rolls.retireAll());
          // Widen out to hold every unit about to roll: their dice must not fall
          // outside a close-up on the two who just fought.
          const rolling = [e.unitId, ...after.filter((x) => x.type === 'NerveCheck').map((x) => x.unitId)];
          nerveAt = base + this.pause(this.frameUnits(rolling, base));
          t = Math.max(t, nerveAt);
        }
        const roll = describeNerve(e, after);
        const start = nerveAt;
        this.at(start, () => this.rolls.addNerve(roll, this.now, NERVE_ROLL_MS + ROLL_LINGER_MS));
        settle = start + NERVE_RESOLVE_MS;
        t = Math.max(t, start + NERVE_ROLL_MS);
      } else if (e.type === 'WarbandBroken') {
        const at = Math.max(lastHit, settle) + NERVE_LEAD_MS;
        this.at(at, () =>
          this.rolls.addVerdict({ text: `P${e.player}'s warband breaks!`, on: [], tone: 'kill' }, this.now),
        );
        settle = at;
      } else if (e.type === 'ToughnessSaved') {
        this.at(lastHit, () => this.flashUnit(e.unitId, 0.7));
      } else if (e.type === 'UnitRecoiled') {
        const obj = this.units.get(e.unitId);
        if (obj) {
          // Shoved back one hex on the blow's hit frame, still facing its opponent.
          obj.walk = { path: [this.unitWorld(e.from), this.unitWorld(e.to)], start: this.now + lastHit, backward: true };
          t = Math.max(t, lastHit + WALK_MS_PER_HEX);
        }
      } else if (e.type === 'UnitSupported') {
        // The friend behind braces the pushed unit on the blow's hit frame.
        this.at(lastHit, () =>
          this.rolls.addVerdict({ text: 'Supported', on: [e.supporterId], tone: 'save' }, this.now),
        );
      } else if (e.type === 'UnitKnockedDown' || e.type === 'UnitKilled') {
        hold(e.unitId, settle);
      } else if (e.type === 'UnitRouted') {
        const obj = this.units.get(e.unitId);
        if (obj) obj.routed = true;
        hold(e.unitId, settle + 300);
      } else if (
        e.type === 'FlagPickedUp' ||
        e.type === 'FlagCaptured' ||
        e.type === 'FlagReturned' ||
        e.type === 'FlagDropped'
      ) {
        // An objective decides games; show where it happened (free when already framed).
        t += this.pause(this.frameUnits([e.unitId], t));
      } else if (e.type === 'GameOver') {
        this.at(t + 400, () => {
          for (const obj of this.units.values()) {
            if (obj.owner === e.winner && !obj.state.dead) {
              obj.animator.play(obj.anims.victory ?? obj.anims.leading);
            }
          }
        });
      }
    });
    // After the fighting, hold the result, then pull back out to the framing the
    // player had — a kill means nothing without the ground around it.
    if (this.restoreDist !== null) {
      const at = t + AFTERMATH_HOLD_MS;
      const back = this.scheduleMove(at, this.plannedCamera().target, this.restoreDist);
      if (back > 0) t = at + back;
      this.restoreDist = null;
    }

    this.busyUntil = Math.max(this.busyUntil, this.now + t);
    return t;
  }

  /** A camera move's length plus a beat to settle, or 0 when it made no move. */
  private pause(moveMs: number): number {
    return moveMs > 0 ? moveMs + CAMERA_SETTLE_MS : 0;
  }

  /**
   * If the units a batch is about (the one activating, a mover's path, both
   * sides of a blow) aren't comfortably in view, schedule a pan of the orbit
   * pivot to them starting `at` ms from now. Returns the pan's length, which the
   * caller delays the batch by (0 when no pan is needed).
   */
  private planPan(events: GameEvent[], at: number): number {
    if (this.cameraMode === 'off' || this.downPos) return 0; // never fight a hand on the camera
    // Blows frame themselves (see frameCombat); this is about what leads up to them.
    const points: THREE.Vector3[] = [];
    for (const e of events) {
      if (e.type === 'ActivationChosen' || e.type === 'DiceRolled') {
        const obj = this.units.get(e.unitId);
        if (obj && !obj.fade) points.push(obj.group.position.clone());
      } else if (e.type === 'UnitMoved') {
        if (e.path) points.push(...e.path.map((c) => this.unitWorld(c)));
        else points.push(this.unitWorld(e.from), this.unitWorld(e.to));
      }
    }
    if (points.length === 0) return 0;

    const end = this.plannedCamera();
    const centre = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
    // Pull back out of a combat close-up, whether or not the action is off screen.
    const dist = this.restoreDist;
    const target = this.inView(points, end) ? (dist === null ? null : end.target) : centre;
    if (target === null) return 0;
    this.restoreDist = null;
    const ids = events.flatMap((e) =>
      e.type === 'ActivationChosen' || e.type === 'DiceRolled' || e.type === 'UnitMoved' ? [e.unitId] : [],
    );
    const dur = this.scheduleMove(at, target, dist);
    if (dur > 0) this.focusUnits(ids, at);
    return dur;
  }

  /**
   * Keep every one of `unitIds` in view: pan to their middle and, if they don't
   * fit the current framing, pull back far enough that they do. Used where
   * several units matter at once — a run of nerve checks, an objective taken.
   */
  private frameUnits(unitIds: string[], at: number): number {
    if (this.cameraMode === 'off' || this.downPos) return 0;
    const points = this.unitPoints(unitIds);
    if (points.length === 0) return 0;
    const end = this.plannedCamera();
    if (this.inView(points, end)) return 0;
    const centre = middle(points);
    const span = Math.max(...points.map((p) => p.distanceTo(centre))) * 2;
    const dist = Math.max(end.dist, this.closeUp(span * COMBAT_SPAN_MARGIN));
    const dur = this.scheduleMove(at, centre, dist);
    if (dur > 0) this.focusUnits(unitIds, at);
    return dur;
  }

  /**
   * Frame a blow on its two combatants: centre them and move in close enough to
   * read the fight, so the dice cards and then the strike play out in a close-up.
   * Returns how long the move takes, which the caller plays the blow after.
   */
  private frameCombat(unitIds: string[], at: number): number {
    if (this.cameraMode !== 'cinematic' || this.downPos) return 0;
    const points = this.unitPoints(unitIds);
    if (points.length === 0) return 0;

    // Remember where the player was looking from, to restore once the fighting stops.
    if (this.restoreDist === null) this.restoreDist = this.plannedCamera().dist;
    const centre = middle(points);
    // Close enough to fill the view with the pair, but never further out than the opening shot.
    const span = Math.max(...points.map((p) => p.distanceTo(centre))) * 2;
    const dur = this.scheduleMove(at, centre, this.closeUp(span * COMBAT_SPAN_MARGIN));
    if (dur > 0) this.focusUnits(unitIds, at);
    return dur;
  }

  /** Where the given units currently stand (the dying and the missing left out). */
  private unitPoints(unitIds: string[]): THREE.Vector3[] {
    return unitIds
      .map((id) => this.units.get(id))
      .filter((obj): obj is UnitObj => !!obj && !obj.fade)
      .map((obj) => obj.group.position.clone());
  }

  /** Pulse a unit's ring just before the camera moves to it, so the eye has somewhere to land. */
  private focusUnits(unitIds: string[], at: number): void {
    for (const id of new Set(unitIds)) {
      const obj = this.units.get(id);
      if (!obj) continue;
      this.at(Math.max(0, at - FOCUS_LEAD_MS), () => {
        obj.pulse = { start: this.now, end: this.now + FOCUS_PULSE_MS };
      });
    }
  }

  /**
   * View distance that keeps `span` world units across the view: the close-up a
   * fight plays in. Never nearer than {@link COMBAT_MAX_ZOOM} of the opening
   * framing, and never further out than that framing (a distant pair just gets
   * less of a move in).
   */
  private closeUp(span: number): number {
    const fit = this.fitDistance(Math.max(span, COMBAT_MIN_SPAN));
    const nearest = Math.max(this.controls.minDistance, this.homeDist * COMBAT_MAX_ZOOM);
    return THREE.MathUtils.clamp(fit, nearest, this.homeDist);
  }

  /** The view distance at which `span` world units across the ground fill the view. */
  private fitDistance(span: number): number {
    const fov = (this.camera.fov * Math.PI) / 180;
    return span / 2 / (Math.tan(fov / 2) * Math.min(1, this.camera.aspect));
  }

  /** Where the camera will be once everything already scheduled has played out. */
  private plannedCamera(): { target: THREE.Vector3; dist: number } {
    if (this.planned) return { target: this.planned.target.clone(), dist: this.planned.dist };
    return this.cam
      ? { target: this.cam.toTarget.clone(), dist: this.cam.toDist }
      : { target: this.controls.target.clone(), dist: this.camera.position.distanceTo(this.controls.target) };
  }

  /** Whether every point (and the dice card over its head) sits comfortably inside the view. */
  private inView(points: THREE.Vector3[], from: { target: THREE.Vector3; dist: number }): boolean {
    const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(from.dist);
    const cam = this.camera.clone();
    cam.position.copy(from.target).add(offset);
    cam.lookAt(from.target);
    cam.updateMatrixWorld();
    return points.every((p) =>
      [0, FOLLOW_HEAD].every((h) => {
        const n = p.clone().setY(p.y + TILE_TOP + h).project(cam);
        return n.z < 1 && Math.abs(n.x) <= FOLLOW_MARGIN_X && n.y <= FOLLOW_MARGIN_TOP && n.y >= -FOLLOW_MARGIN_BOTTOM;
      }),
    );
  }

  /**
   * Schedule a camera move `at` ms from now, to `target` (the pivot, on the
   * ground) and `dist` (view distance; null keeps the current one). Returns its length.
   */
  private scheduleMove(at: number, target: THREE.Vector3, dist: number | null): number {
    const from = this.plannedCamera();
    const travel = new THREE.Vector3(target.x - from.target.x, 0, target.z - from.target.z).length();
    const zoom = dist === null ? 0 : Math.abs(dist - from.dist);
    // Already looking at it: no nudge, and no wait for one.
    if (travel + zoom < CAMERA_STILL) return 0;
    const dur = THREE.MathUtils.clamp(PAN_MIN_MS + (travel + zoom) * PAN_MS_PER_UNIT, PAN_MIN_MS, PAN_MAX_MS);
    this.planned = { target: new THREE.Vector3(target.x, 0, target.z), dist: dist ?? from.dist };
    this.at(at, () => this.moveCamera(target, dist, dur));
    return dur;
  }

  /**
   * A unit the player has just picked to command belongs in front of them: if it
   * isn't comfortably in view (it, and the dice card about to appear over its
   * head), pan the pivot toward it — but only as far as it takes to clear the
   * margin, so the rest of the board stays roughly where they left it. Only the
   * pivot moves, so their zoom is untouched, and the pan is on their behalf: it
   * becomes the framing they get back once the activation has played out.
   */
  private panToSelected(id: string | null): void {
    if (id === this.pannedTo) return;
    this.pannedTo = id;
    if (id === null || this.cameraMode === 'off' || this.downPos) return;
    const obj = this.units.get(id);
    if (!obj || obj.fade) return;
    const point = obj.group.position.clone();
    const from = this.plannedCamera();
    if (this.inView([point], from)) return;
    // How far along the line from the pivot to the unit's own hex the pivot has
    // to slide. The unit only comes further into frame as it goes, so halve onto
    // the shortest one that works; 1 (the unit dead centre) always does.
    const flat = new THREE.Vector3(point.x, 0, point.z);
    let lo = 0; // known to leave it out of frame
    let hi = 1;
    for (let i = 0; i < SELECT_PAN_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (this.inView([point], { target: from.target.clone().lerp(flat, mid), dist: from.dist })) hi = mid;
      else lo = mid;
    }
    const target = from.target.clone().lerp(flat, Math.min(1, hi + SELECT_PAN_SLACK));
    const travel = target.distanceTo(from.target);
    if (travel < CAMERA_STILL) return;
    const dur = THREE.MathUtils.clamp(PAN_MIN_MS + travel * PAN_MS_PER_UNIT, PAN_MIN_MS, PAN_MAX_MS);
    this.playerView = { target: target.clone(), dist: from.dist };
    this.moveCamera(target, null, dur);
  }

  /** Glide back to the framing the player set for themselves, if they've been moved off it. */
  private returnToPlayerView(): void {
    const view = this.playerView;
    if (this.cameraMode === 'off' || !view || this.downPos) return;
    this.restoreDist = null;
    this.planned = null;
    const from = this.plannedCamera();
    const travel = new THREE.Vector3(view.target.x - from.target.x, 0, view.target.z - from.target.z).length();
    const zoom = Math.abs(view.dist - from.dist);
    if (travel + zoom < CAMERA_STILL) return;
    const dur = THREE.MathUtils.clamp(PAN_MIN_MS + (travel + zoom) * PAN_MS_PER_UNIT, PAN_MIN_MS, PAN_MAX_MS);
    this.moveCamera(view.target, view.dist, dur);
  }

  /** Take the camera as the player has just left it; that framing is theirs to get back. */
  private rememberPlayerView(): void {
    this.playerView = {
      target: this.controls.target.clone(),
      dist: this.camera.position.distanceTo(this.controls.target),
    };
  }

  /** Start a camera move now, from wherever the camera currently is. */
  private moveCamera(target: THREE.Vector3, dist: number | null, dur: number, linear = false): void {
    if (this.cameraMode === 'off' || this.downPos) return;
    const fromTarget = this.controls.target.clone();
    const fromDist = this.camera.position.distanceTo(fromTarget);
    this.cam = {
      fromTarget,
      toTarget: new THREE.Vector3(target.x, 0, target.z),
      fromDist,
      toDist: dist ?? fromDist,
      start: this.now,
      dur: Math.max(1, dur),
      ...(linear ? { linear: true } : {}),
    };
  }

  /** Glide the orbit pivot (and the camera with it, so the view angle holds) along the current move. */
  private stepCamera(): void {
    const move = this.cam;
    if (!move) return;
    const k = THREE.MathUtils.clamp((this.now - move.start) / move.dur, 0, 1);
    const eased = move.linear ? k : k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const target = move.fromTarget.clone().lerp(move.toTarget, eased);
    const dist = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(move.fromDist, move.toDist, eased),
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    if (k >= 1) this.cam = null;
  }

  /**
   * Jump to the end of whatever is playing: run every pending step at once, land
   * the camera where it was heading and drop the dice cards. Returns false when
   * there was nothing left to play.
   */
  skipAnimations(): boolean {
    if (this.timeline.length === 0 && this.busyUntil <= this.now) return false;
    this.now = Math.max(this.now, this.busyUntil);
    // Steps run in order, and may schedule more (a strike's hit, its reaction).
    for (let guard = 0; guard < 64 && this.timeline.length > 0; guard++) {
      const steps = this.timeline.splice(0, this.timeline.length).sort((a, b) => a.at - b.at);
      for (const step of steps) step.fn();
    }
    if (this.cam) {
      this.cam.start = this.now - this.cam.dur;
      this.stepCamera();
    }
    this.rolls.clear();
    for (const obj of this.units.values()) {
      obj.holdUntil = 0;
      obj.pulse = null;
    }
    this.busyUntil = this.now;
    return true;
  }

  /** Cut short every pending animation step and dice card (a replay jump). */
  clearAnimations(): void {
    this.timeline.length = 0;
    this.cam = null;
    this.planned = null;
    this.restoreDist = null;
    this.busyUntil = this.now;
    this.rolls.clear();
    for (const obj of this.units.values()) {
      obj.holdUntil = 0;
      obj.pulse = null;
      obj.walk = null;
      obj.mirror.rotation.z = 0;
      obj.animator.moveFor(0, { reset: true });
    }
  }

  /** Return the camera to the framing it had when the board was built. */
  resetCamera(): void {
    this.controls.reset();
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.handlePointerLeave);
    this.setPlanPreview(null);
    this.reachFillGeo?.dispose();
    this.reachFillMat?.dispose();
    this.provokeFillMat?.dispose();
    for (const g of this.contourGeo) g?.dispose();
    for (const m of this.contourMat) m?.dispose();
    this.previewLineMat?.dispose();
    this.previewDotGeo?.dispose();
    this.previewDotMat?.dispose();
    for (const t of this.badgeTextures.values()) t.dispose();
    this.starMaterial?.map?.dispose();
    this.starMaterial?.dispose();
    this.rolls.dispose();
    this.ringGeo.dispose();
    this.dashedRingGeo.dispose();
    for (const obj of this.units.values()) obj.outline.material.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // --- internals ----------------------------------------------------------

  private createUnit(id: string, owner: 0 | 1, name: string, big = false, flying = false): UnitObj {
    const group = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(BASE_RADIUS, BASE_RADIUS, BASE_HEIGHT, 28),
      new THREE.MeshStandardMaterial({ color: OWNER_COLORS[owner], roughness: 0.6 }),
    );
    base.position.y = TILE_TOP + BASE_HEIGHT / 2;
    base.userData.unitId = id;

    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    ring.visible = false;

    // The cutout: one atlas cell on a quad whose origin is the frames' shared
    // anchor (the base image's feet), sized once the atlas loads. Alpha-tested,
    // not blended, so overlapping cutouts need no sorting.
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide }),
    );
    sprite.userData.unitId = id;
    sprite.userData.isCutout = true;
    sprite.visible = false;

    // Shares the cutout's quad (and, once loaded, its texture window); never picked.
    const outline = new THREE.Mesh(sprite.geometry, outlineMaterial());
    outline.position.z = -0.002;
    outline.visible = false;
    outline.raycast = () => {};

    const mirror = new THREE.Group();
    mirror.add(outline, sprite);
    const tilt = new THREE.Group();
    tilt.rotation.x = -SPRITE_LEAN;
    tilt.add(mirror);
    const facing = new THREE.Group();
    facing.position.y = TILE_TOP + BASE_HEIGHT;
    facing.add(tilt);

    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    badge.scale.set(BADGE_SIZE, BADGE_SIZE, 1);
    badge.position.y = TILE_TOP + BADGE_HEIGHT;
    badge.visible = false;

    const stars = new THREE.Group();
    for (let i = 0; i < STAR_COUNT; i++) {
      const star = new THREE.Sprite(this.dizzyStarMaterial());
      star.scale.setScalar(STAR_SIZE);
      stars.add(star);
    }
    stars.visible = false;

    const spriteName = spriteFor(name);
    const anims = animationsFor(spriteName);
    const downPose = DOWN_POSES[spriteName] ?? null;
    const flags = (): UnitFlags => ({ dead: false, knocked: false, guarding: false });
    const obj: UnitObj = {
      id,
      size: big ? BIG_SCALE : 1,
      flying,
      hover: 0,
      owner,
      name,
      spriteName,
      group,
      facing,
      tilt,
      mirror,
      sprite,
      base,
      ring,
      badge,
      stars,
      anims,
      downPose: downPose && anims.death?.frames.some(([f]) => f === downPose) ? downPose : null,
      animator: new UnitAnimator(spriteName, anims),
      atlas: null,
      shownImage: null,
      // Everyone starts facing the enemy: P0 deploys on the left, P1 on the right.
      heading: new THREE.Vector3(owner === 0 ? 1 : -1, 0, 0),
      faceRight: owner === 0,
      targetPos: new THREE.Vector3(),
      targetTilt: 0,
      state: flags(),
      shown: flags(),
      holdUntil: 0,
      routed: false,
      fade: null,
      lunge: null,
      walk: null,
      flash: 0,
      pulse: null,
      ringRest: { visible: false, opacity: 0 },
      outline,
      cue: null,
    };

    loadSpriteAtlas(spriteName, framesOf(spriteName), owner).then(
      (atlas) => {
        if (this.disposed) return;
        obj.atlas = atlas;
        const map = atlas.texture.clone(); // shares the uploaded image; its own UV window
        map.repeat.set(atlas.repeatU, atlas.repeatV);
        map.needsUpdate = true;
        sprite.material.map = map;
        sprite.material.needsUpdate = true;
        sprite.geometry.translate(0.5 - atlas.anchorX / atlas.cellW, atlas.anchorY / atlas.cellH - 0.5, 0);
        // A Big model is drawn a head taller; the cutout's anchor is its feet,
        // so it grows upward and stays planted on its hex.
        sprite.scale.set(atlas.cellW * SPRITE_PX * obj.size, atlas.cellH * SPRITE_PX * obj.size, 1);
        const u = outline.material.uniforms;
        u.map!.value = map;
        u.uOffset!.value = map.offset; // the same vector the frame animation moves
        u.uRepeat!.value = map.repeat;
        u.uPixel!.value.set(1 / atlas.cellW, 1 / atlas.cellH);
        outline.scale.copy(sprite.scale);
        obj.shownImage = null; // force the current frame onto the new map
        sprite.visible = true;
      },
      (err) => console.error(err),
    );

    facing.add(stars); // follows the lunge, and the lean back
    group.add(ring, base, facing, badge);
    group.name = name;
    this.scene.add(group);
    return obj;
  }

  /** Run `fn` once board time is `delayMs` from now. */
  private at(delayMs: number, fn: () => void): void {
    this.timeline.push({ at: this.now + delayMs, fn });
  }

  private setHeading(obj: UnitObj, dir: THREE.Vector3): void {
    dir.y = 0;
    if (dir.lengthSq() > 1e-6) obj.heading.copy(dir.normalize());
  }

  /**
   * Lay out one strike starting `at` ms from now: the attacker's clip, its
   * lunge or missile, and the target's reaction timed to the clip's hit frame.
   * `land` is false for a blow the target turns aside — it still defends, but
   * nothing connects. Returns the hit and end times, relative to now.
   */
  private strike(
    attackerId: string,
    targetId: string,
    range: 'melee' | 'ranged',
    at: number,
    opts: { land?: boolean } = {},
  ): { hit: number; end: number } {
    const a = this.units.get(attackerId);
    const d = this.units.get(targetId);
    if (!a || !d) return { hit: at, end: at };
    const options: RangedClip[] | undefined = range === 'melee' ? a.anims.melee : a.anims.ranged;
    const clip = options?.[Math.floor(Math.random() * options.length)];
    const dur = clip ? clipDuration(clip) : 400;
    const hit = clip?.hitMs ?? dur / 2;

    this.at(at, () => {
      const toTarget = d.group.position.clone().sub(a.group.position).setY(0);
      this.setHeading(a, toTarget.clone());
      this.setHeading(d, toTarget.clone().negate());
      a.animator.play(clip);
      if (range === 'melee') {
        const dir = toTarget.normalize().multiplyScalar(LUNGE);
        a.lunge = { dir, start: this.now, hit: this.now + hit, end: this.now + dur };
      } else if (clip?.missile) {
        this.launchMissile(a, d, clip.missile, hit - (clip.missileMs ?? 150), hit);
      } else {
        this.at(hit, () => this.addTracer(attackerId, targetId, SHOT_COLOR));
      }
    });
    const land = opts.land ?? true;
    const defend: Clip | undefined =
      range === 'melee'
        ? (d.anims.defendMelee ?? d.anims.defendRanged)
        : (d.anims.defendRanged ?? d.anims.defendMelee);
    if (defend) {
      this.at(at + hit - (defend.hitMs ?? DEFEND_LEAD_MS), () => {
        if (!d.animator.busy) d.animator.play(defend);
      });
    } else {
      // No defend art: move the cutout itself, so the blow still meets someone
      // reacting to it rather than a unit standing perfectly still.
      this.at(at + hit - DODGE_MS, () => this.giveGround(d, a, land ? FLINCH : DODGE));
    }
    if (land) this.at(at + hit, () => this.flashUnit(targetId, 0.8));
    if (range === 'ranged' && this.cameraMode === 'cinematic' && !this.downPos) {
      // Swing to the shooter as it draws, then ride the shot in to its target —
      // but only for a shot short and slow enough to follow. A long one would
      // whip the camera across the board in a few frames, so it keeps the wide
      // framing that already holds both ends of it.
      const launch = Math.max(0, hit - (clip?.missileMs ?? 150));
      const flight = hit - launch;
      const span = a.group.position.distanceTo(d.group.position);
      if (span <= RIDE_MAX_SPAN && flight >= RIDE_MIN_MS) {
        const close = this.closeUp(0);
        this.at(at, () => this.moveCamera(a.group.position, close, Math.min(launch, SHOT_LEAD_MS)));
        this.at(at + launch, () => this.moveCamera(d.group.position, null, flight, true));
        this.planned = { target: d.group.position.clone().setY(0), dist: close };
      }
    }
    return { hit: at + hit, end: at + dur };
  }

  /**
   * A melee the defender answers: the swing goes in and is turned aside, then
   * after a beat the defender swings back. `land` says whether that answer
   * connects (a clash is two blows that both fail). Returns the counter's hit —
   * the moment that decides the fight, which its consequences (recoil,
   * knockdown, death) are timed to — and its end.
   */
  private exchange(
    attackerId: string,
    targetId: string,
    at: number,
    opts: { land?: boolean } = {},
  ): { hit: number; end: number } {
    const swing = this.strike(attackerId, targetId, 'melee', at, { land: false });
    return this.strike(targetId, attackerId, 'melee', swing.end + RIPOSTE_GAP_MS, opts);
  }

  /**
   * Whether a melee blow is answered — the defender swings back, to hurt the
   * attacker or to be turned aside in its turn. A defender that lost never got
   * to swing, and one flat on its back answers only on a natural 6, which is
   * the other thing the engine scores as a clash (see computeCombatResult).
   */
  private answered(e: Extract<GameEvent, { type: 'AttackResolved' }>): boolean {
    if (e.result.startsWith('attacker')) return true;
    if (e.result !== 'clash') return false;
    return !this.units.get(e.targetId)?.state.knocked || e.defenseDie === 6;
  }

  /** Shove a cutout `dist` back from whoever it is facing down, then let it recover. */
  private giveGround(obj: UnitObj, from: UnitObj, dist: number): void {
    const away = obj.group.position.clone().sub(from.group.position).setY(0);
    if (away.lengthSq() < 1e-6) return;
    obj.lunge = {
      dir: away.normalize().multiplyScalar(dist),
      start: this.now,
      hit: this.now + DODGE_MS,
      end: this.now + DODGE_MS + DODGE_RECOVER_MS,
    };
  }

  private launchMissile(from: UnitObj, to: UnitObj, image: string, startIn: number, hitIn: number): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: projectileTexture(image), alphaTest: 0.5 }));
    sprite.scale.setScalar(72 * SPRITE_PX * 0.8);
    sprite.visible = false;
    this.scene.add(sprite);
    const lift = TILE_TOP + BASE_HEIGHT + 0.55;
    this.missiles.push({
      sprite,
      from: from.group.position.clone().setY(from.targetPos.y + lift),
      to: to.group.position.clone().setY(to.targetPos.y + lift),
      start: this.now + Math.max(0, startIn),
      end: this.now + Math.max(1, hitIn),
      arc: /stone|spear|pitchfork/.test(image) ? 0.35 : 0.08,
    });
  }

  /** Apply held-back state changes (knockdown, death, guard) once their blow has landed. */
  private syncShown(obj: UnitObj): void {
    const { state, shown } = obj;
    if (state.dead && !shown.dead) this.startLeaving(obj);
    if (!state.dead && shown.dead) this.revive(obj); // replay rewind
    if (!state.dead && state.knocked !== shown.knocked) {
      // Stagger into the down pose, or climb back out of it.
      const fall = this.deathClip(obj, 'fall');
      if (fall && state.knocked) obj.animator.play(fall);
      else if (fall) obj.animator.play({ frames: [...fall.frames].reverse() });
    }
    obj.shown = { ...state };
    obj.targetTilt = state.knocked && !obj.downPose ? DOWN_LEAN : 0;
  }

  /**
   * The part of a unit's death clip before its down pose (`fall`, ending on
   * it) or after (`rest`, starting from it); undefined without a down pose.
   */
  private deathClip(obj: UnitObj, part: 'fall' | 'rest'): Clip | undefined {
    const frames = obj.anims.death?.frames;
    const i = frames?.findIndex(([f]) => f === obj.downPose) ?? -1;
    if (!frames || i < 0) return undefined;
    return { frames: part === 'fall' ? frames.slice(0, i + 1) : frames.slice(i) };
  }

  private startLeaving(obj: UnitObj): void {
    obj.lunge = null;
    obj.ring.visible = false;
    let fadeIn = 0;
    let flee: THREE.Vector3 | null = null;
    if (obj.routed) {
      flee = new THREE.Vector3(obj.owner === 0 ? -1 : 1, 0, 0);
      this.setHeading(obj, flee.clone());
      obj.animator.moveFor(ROUT_MS);
    } else {
      // Wesnoth plays the death clip, then fades; without one it just fades.
      // A downed unit finishes its fall from the down pose.
      const clip = obj.shown.knocked ? this.deathClip(obj, 'rest') : obj.anims.death;
      fadeIn = obj.animator.play(clip, { hold: true });
    }
    obj.fade = { start: this.now + fadeIn, end: this.now + fadeIn + (flee ? ROUT_MS : DEATH_FADE_MS), flee };
    // Blend while fading; a low alpha test still drops the cleared background.
    obj.sprite.material.alphaTest = 0.01;
    for (const m of [obj.sprite.material, obj.base.material]) {
      m.transparent = true;
      m.needsUpdate = true;
    }
  }

  private revive(obj: UnitObj): void {
    obj.fade = null;
    obj.routed = false;
    obj.animator.stop();
    obj.group.visible = true;
    obj.sprite.material.alphaTest = 0.5;
    for (const m of [obj.sprite.material, obj.base.material]) {
      m.transparent = false;
      m.opacity = 1;
      m.needsUpdate = true;
    }
  }

  /** Per-frame unit animation: frame, facing, lunge, tilt, fade and flash. */
  private animateUnit(obj: UnitObj, dtMs: number, lerp: number, camRight: THREE.Vector3): void {
    if (obj.walk) this.walkUnit(obj, obj.walk);
    else obj.group.position.lerp(obj.targetPos, lerp);
    if (this.now >= obj.holdUntil) this.syncShown(obj);

    // On Guard, hold the braced defence pose.
    const guardPose = obj.anims.defendMelee?.frames[1]?.[0] ?? null;
    obj.animator.pose = obj.shown.knocked ? obj.downPose : obj.shown.guarding ? guardPose : null;
    obj.animator.restless = !obj.shown.knocked && !obj.fade && !obj.walk;
    const image = obj.animator.update(dtMs);
    if (obj.atlas && image !== obj.shownImage) {
      const rect = obj.atlas.frames.get(image) ?? obj.atlas.frames.get(obj.animator.base);
      if (rect) obj.sprite.material.map?.offset.set(rect.u, rect.v);
      obj.shownImage = image;
    }

    // Wesnoth art faces east (it hflips only for westward facings, see its units/frame.cpp);
    // flip when the unit's heading points screen-left.
    const side = obj.heading.dot(camRight);
    if (Math.abs(side) > 0.05) obj.faceRight = side > 0;
    obj.mirror.scale.x = obj.faceRight ? 1 : -1;

    obj.facing.rotation.y = Math.atan2(
      this.camera.position.x - obj.group.position.x,
      this.camera.position.z - obj.group.position.z,
    );
    // A ring pulse marks what the camera is about to move to.
    if (obj.pulse && this.now >= obj.pulse.end) obj.pulse = null;
    const cue = obj.fade ? null : obj.cue;
    const hovered = cue !== null && cue.period > 0 && this.hoverUnitId === obj.id;
    // 0..1 breath of a clickable unit; one held steady (or pointed at) sits at its top.
    const breath =
      cue && cue.period > 0 && !hovered ? 0.5 - 0.5 * Math.cos((this.now / cue.period) * Math.PI * 2) : 1;
    if (obj.pulse && this.now >= obj.pulse.start && !obj.fade) {
      const wave = Math.sin(Math.PI * ((this.now - obj.pulse.start) / (obj.pulse.end - obj.pulse.start)));
      obj.ring.visible = true;
      obj.ring.material.opacity = Math.max(obj.ringRest.opacity, 0.3 + 0.7 * wave);
      obj.ring.scale.setScalar(1 + 0.4 * wave);
    } else if (cue) {
      obj.ring.visible = true;
      obj.ring.material.opacity = cue.far ? 0.3 + 0.35 * breath : 0.45 + 0.55 * breath;
      obj.ring.scale.setScalar(hovered ? CUE_HOVER_SCALE : 1 + CUE_SWELL * breath);
    } else if (obj.ring.scale.x !== 1 || obj.ring.material.opacity !== obj.ringRest.opacity) {
      // Back to the ring the view model asked for.
      obj.ring.scale.setScalar(1);
      obj.ring.visible = obj.ringRest.visible;
      obj.ring.material.opacity = obj.ringRest.opacity;
    }
    obj.outline.visible = cue !== null && obj.atlas !== null;
    if (cue && obj.atlas) {
      const u = obj.outline.material.uniforms;
      u.uColor!.value.setHex(cue.color);
      u.uOpacity!.value = cue.far ? 0.35 + 0.3 * breath : 0.55 + 0.45 * breath;
      u.uWidth!.value = hovered ? OUTLINE_HOVER_PX : OUTLINE_PX;
    }

    obj.tilt.rotation.z += (obj.targetTilt - obj.tilt.rotation.z) * lerp;
    const crouch = obj.shown.knocked && !obj.downPose && !obj.fade;
    obj.tilt.scale.x += ((crouch ? DOWN_WIDEN : 1) - obj.tilt.scale.x) * lerp;
    obj.tilt.scale.y += ((crouch ? DOWN_SQUASH : 1) - obj.tilt.scale.y) * lerp;
    this.spinStars(obj);

    // Melee lunge: lean in until the hit frame, then settle back.
    const off = new THREE.Vector3();
    if (obj.lunge) {
      const { dir, start, hit, end } = obj.lunge;
      if (this.now >= end) obj.lunge = null;
      else {
        const k = this.now < hit ? (this.now - start) / Math.max(1, hit - start) : (end - this.now) / Math.max(1, end - hit);
        off.addScaledVector(dir, THREE.MathUtils.clamp(k, 0, 1));
      }
    }

    if (obj.fade) {
      const f = THREE.MathUtils.clamp((this.now - obj.fade.start) / (obj.fade.end - obj.fade.start), 0, 1);
      if (obj.fade.flee) off.addScaledVector(obj.fade.flee, f * HEX_COL_STEP);
      obj.sprite.material.opacity = 1 - f;
      obj.base.material.opacity = 1 - f;
      obj.group.visible = f < 1;
    }
    // A flyer floats above its hex with a slow bob, and settles to earth when
    // knocked down or dying; its base ring stays put on the ground as a shadow.
    const airborne = obj.flying && !obj.shown.knocked && !obj.fade;
    obj.hover += ((airborne ? FLY_HOVER : 0) - obj.hover) * lerp;
    const lift = obj.hover + (airborne ? Math.sin((this.now / FLY_BOB_MS) * Math.PI * 2) * FLY_BOB : 0);
    obj.facing.position.set(off.x, TILE_TOP + BASE_HEIGHT + lift, off.z);
    obj.badge.position.y = TILE_TOP + BADGE_HEIGHT + lift;

    if (obj.flash > 0) {
      obj.flash = Math.max(0, obj.flash - (dtMs / 1000) * 3);
      // A basic material's colour multiplies the texture; > 1 washes it toward white.
      obj.sprite.material.color.setScalar(1 + obj.flash * 2.5);
    }
  }

  /** Circle the dizzy stars over a downed unit's head, twinkling as they go. */
  private spinStars(obj: UnitObj): void {
    const { stars, atlas } = obj;
    stars.visible = obj.shown.knocked && !obj.fade && atlas !== null;
    if (!stars.visible || !atlas) return;
    // Ride just over the head of whatever is drawn, crouched or posed.
    const rect = atlas.frames.get(obj.shownImage ?? '') ?? atlas.frames.get(obj.animator.base);
    const head = (atlas.anchorY - (rect?.top ?? 0)) * SPRITE_PX * obj.size * obj.tilt.scale.y;
    stars.position.set(0, head * Math.cos(SPRITE_LEAN) + STAR_CLEARANCE, -head * Math.sin(SPRITE_LEAN));
    const spin = (this.now / 1000) * STAR_SPIN;
    stars.children.forEach((star, i) => {
      const a = spin + (i / STAR_COUNT) * Math.PI * 2;
      star.position.set(Math.cos(a) * STAR_ORBIT, Math.sin(a * 2) * 0.03, Math.sin(a) * STAR_ORBIT * 0.8);
      star.scale.setScalar(STAR_SIZE * (0.85 + 0.15 * Math.sin(spin * 3 + i * 2)));
    });
  }

  /** Place a walking unit along its path (waiting at the origin until the walk starts), facing its current step. */
  private walkUnit(obj: UnitObj, walk: NonNullable<UnitObj['walk']>): void {
    const { path, start } = walk;
    const f = (this.now - start) / WALK_MS_PER_HEX;
    if (f >= path.length - 1) {
      obj.group.position.copy(path[path.length - 1]!);
      obj.mirror.rotation.z = 0;
      obj.walk = null;
      return;
    }
    const i = Math.max(0, Math.floor(f));
    const from = path[i]!;
    const to = path[i + 1]!;
    const k = THREE.MathUtils.clamp(f - i, 0, 1);
    obj.group.position.lerpVectors(from, to, k);
    // A tabletop hop per step: up and down, rocking onto alternate feet.
    const arc = Math.sin(Math.PI * k);
    obj.group.position.y += WALK_HOP * arc;
    obj.mirror.rotation.z = WALK_SWAY * arc * (i % 2 === 0 ? 1 : -1);
    if (f >= 0 && !walk.backward) this.setHeading(obj, to.clone().sub(from));
  }

  /** World points of the hexes a move walks through, origin and destination included. */
  private walkPath(from: Vec, to: Vec): THREE.Vector3[] {
    const cells = this.board ? makeHexGrid(this.board).pathWithin(from, to, this.width * this.height) : null;
    return (cells ?? [from, to]).map((c) => this.unitWorld(c));
  }

  private animateMissiles(): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]!;
      const f = (this.now - m.start) / (m.end - m.start);
      if (f >= 1) {
        this.scene.remove(m.sprite);
        m.sprite.material.dispose();
        this.missiles.splice(i, 1);
        continue;
      }
      m.sprite.visible = f >= 0;
      if (f < 0) continue;
      m.sprite.position.lerpVectors(m.from, m.to, f);
      m.sprite.position.y += Math.sin(Math.PI * f) * m.arc;
      // Point the (north-facing) image along its on-screen direction of travel.
      const a = m.from.clone().project(this.camera);
      const b = m.to.clone().project(this.camera);
      m.sprite.material.rotation = Math.atan2(b.y - a.y, (b.x - a.x) * this.camera.aspect) - Math.PI / 2;
    }
  }

  /**
   * The reach, drawn as one green field with a contour ring at each action's
   * boundary. The rings come from set membership rather than a radius, so the
   * bites that zones of control take out of the reach are outlined correctly too.
   */
  private drawHighlights(reach: ReachTile[]): void {
    const key = reach.map((t) => `${t.cost}${t.provokes > 0 ? '!' : ''}:${t.cell.x},${t.cell.y}`).join('|');
    if (key === this.reachKey) return;
    this.reachKey = key;
    this.highlightGroup.clear();
    if (reach.length === 0) return;

    this.reachFillGeo ??= new THREE.CircleGeometry(HEX_SIZE * 0.9, 6);
    this.reachFillMat ??= fillMaterial(MOVE_COLOR, REACH_FILL_OPACITY);
    // Amber where getting there breaks away from an enemy: the free hack can
    // cost the action *and* the ground, so it should not look like open field.
    this.provokeFillMat ??= fillMaterial(PROVOKE_COLOR, REACH_FILL_OPACITY + 0.06);

    for (const t of reach) {
      const tile = new THREE.Mesh(this.reachFillGeo, t.provokes > 0 ? this.provokeFillMat : this.reachFillMat);
      tile.rotation.x = -Math.PI / 2;
      const w = this.cellToWorld(t.cell);
      tile.position.set(w.x, this.surfaceAt(t.cell) + 0.03, w.z);
      this.highlightGroup.add(tile);
    }

    const maxCost = reach.reduce((n, t) => Math.max(n, t.cost), 0);
    const within = new Set<string>();
    for (let cost = 1; cost <= maxCost; cost++) {
      for (const t of reach) if (t.cost === cost) within.add(vecKey(t.cell));
      this.drawContour(within, cost - 1);
    }
  }

  /** Outline `within`: a ribbon on every hex edge whose far side lies outside it. */
  private drawContour(within: Set<string>, tier: number): void {
    const width = CONTOUR_WIDTH[Math.min(tier, CONTOUR_WIDTH.length - 1)]!;
    const opacity = CONTOUR_OPACITY[Math.min(tier, CONTOUR_OPACITY.length - 1)]!;
    const geo = (this.contourGeo[tier] ??= new THREE.PlaneGeometry(HEX_SIZE, width));
    const mat = (this.contourMat[tier] ??= fillMaterial(MOVE_COLOR, opacity));

    for (const cellKey of within) {
      const [x, y] = cellKey.split(',').map(Number) as [number, number];
      const cell = { x, y };
      const centre = this.cellToWorld(cell);
      const surface = this.surfaceAt(cell) + 0.045;
      // The six flat-top neighbours sit at 30°, 90°, … around the centre.
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 6 + (i * Math.PI) / 3;
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        // Resolve the far side through the board's own pixel-to-hex, so an edge
        // of the board (no neighbour at all) gets outlined like any other.
        const beyond = this.worldToCell(
          new THREE.Vector3(centre.x + HEX_STEP * dx, 0, centre.z + HEX_STEP * dz),
        );
        if (beyond && within.has(vecKey(beyond))) continue;
        const edge = new THREE.Mesh(geo, mat);
        // Lie flat, then turn the ribbon's length along the shared edge, which
        // runs perpendicular to the line joining the two hex centres.
        edge.rotation.set(-Math.PI / 2, 0, -(angle + Math.PI / 2));
        edge.position.set(centre.x + (HEX_STEP / 2) * dx, surface, centre.z + (HEX_STEP / 2) * dz);
        this.highlightGroup.add(edge);
      }
    }
  }

  /**
   * Trace the walk a hovered plan would take: the route it follows, a mark on
   * each hex where an action is actually spent, and a brighter one where it ends
   * — which for a strike is the hex the blow is thrown from.
   */
  setPlanPreview(preview: PlanPreview | null): void {
    for (const child of this.previewGroup.children) {
      if ((child as THREE.Line).isLine) (child as THREE.Line).geometry.dispose();
    }
    this.previewGroup.clear();
    if (!preview || preview.path.length < 2) return;

    const lift = (v: Vec): THREE.Vector3 => {
      const w = this.cellToWorld(v);
      return new THREE.Vector3(w.x, this.surfaceAt(v) + 0.09, w.z);
    };
    this.previewLineMat ??= new THREE.LineBasicMaterial({ color: MOVE_COLOR, transparent: true, opacity: 0.95 });
    this.previewDotGeo ??= new THREE.CircleGeometry(HEX_SIZE * 0.26, 12);
    this.previewDotMat ??= fillMaterial(MOVE_COLOR, 0.85);

    // One polyline, so the route stays continuous as it climbs over terrain.
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(preview.path.map(lift)),
      this.previewLineMat,
    );
    this.previewGroup.add(line);

    preview.waypoints.forEach((w, i) => {
      const dot = new THREE.Mesh(this.previewDotGeo!, this.previewDotMat!);
      dot.rotation.x = -Math.PI / 2;
      const at = lift(w);
      dot.position.set(at.x, at.y, at.z);
      // The last mark is where the unit comes to rest, so make it read as one.
      dot.scale.setScalar(i === preview.waypoints.length - 1 ? 1.5 : 1);
      this.previewGroup.add(dot);
    });
  }

  private drawOverlays(overlays: HexOverlay[]): void {
    this.overlays = overlays;
    for (const child of this.overlayGroup.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.overlayGroup.clear();
    // Later overlays sit a hair higher so small markers (flags) stay on top.
    overlays.forEach((o, i) => {
      const geo = new THREE.CircleGeometry(HEX_SIZE * (o.scale ?? 0.9), 6);
      const mat = new THREE.MeshBasicMaterial({
        color: o.color,
        transparent: true,
        opacity: o.opacity ?? 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      for (const c of o.cells) {
        const tile = new THREE.Mesh(geo, mat);
        tile.rotation.x = -Math.PI / 2;
        const w = this.cellToWorld(c);
        tile.position.set(w.x, this.surfaceAt(c) + 0.012 + i * 0.002, w.z);
        this.overlayGroup.add(tile);
      }
    });
  }

  /** Mode markings: flag markers on hexes and badges over units. */
  private drawMarkings(vm: BoardViewModel): void {
    this.markingsKey = vm.markingsKey;
    for (const child of this.markerGroup.children) ((child as THREE.Sprite).material as THREE.Material).dispose();
    this.markerGroup.clear();
    for (const m of vm.markers ?? []) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.badgeTexture(m.owner === 0 ? 'flag-0' : 'flag-1'), transparent: true }),
      );
      sprite.scale.set(BADGE_SIZE * 1.4, BADGE_SIZE * 1.4, 1);
      const w = this.cellToWorld(m.cell);
      sprite.position.set(w.x + HEX_SIZE * 0.3, this.surfaceAt(m.cell) + BADGE_SIZE * 0.7, w.z - HEX_SIZE * 0.2);
      this.markerGroup.add(sprite);
    }
    for (const [id, obj] of this.units) {
      const kind = vm.badges?.[id];
      obj.badge.visible = kind !== undefined;
      if (kind && obj.badge.material.map !== this.badgeTexture(kind)) {
        obj.badge.material.map = this.badgeTexture(kind);
        obj.badge.material.needsUpdate = true;
      }
    }
  }

  /** The shared material of the dizzy stars: a yellow five-pointed star. */
  private dizzyStarMaterial(): THREE.SpriteMaterial {
    if (this.starMaterial) return this.starMaterial;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const g = canvas.getContext('2d')!;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 14 : 6;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = STAR_COLOR;
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = 2.5;
    g.strokeStyle = '#1b1f27';
    g.stroke();
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    this.starMaterial = new THREE.SpriteMaterial({ map, alphaTest: 0.5 });
    return this.starMaterial;
  }

  /** A small canvas-drawn badge image, cached per kind. */
  private badgeTexture(kind: UnitBadge): THREE.Texture {
    let t = this.badgeTextures.get(kind);
    if (t) return t;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.lineJoin = 'round';
    g.lineWidth = 4;
    g.strokeStyle = '#1b1f27';
    if (kind === 'crown') {
      g.beginPath();
      g.moveTo(8, 50);
      g.lineTo(6, 18);
      g.lineTo(20, 32);
      g.lineTo(32, 10);
      g.lineTo(44, 32);
      g.lineTo(58, 18);
      g.lineTo(56, 50);
      g.closePath();
      g.fillStyle = CROWN_COLOR;
      g.fill();
      g.stroke();
    } else if (kind === 'guard') {
      g.beginPath();
      g.moveTo(32, 6);
      g.lineTo(54, 14);
      g.lineTo(54, 32);
      g.quadraticCurveTo(54, 50, 32, 60);
      g.quadraticCurveTo(10, 50, 10, 32);
      g.lineTo(10, 14);
      g.closePath();
      g.fillStyle = `#${GUARD_COLOR.toString(16).padStart(6, '0')}`;
      g.fill();
      g.stroke();
    } else {
      const color = `#${OWNER_COLORS[kind === 'flag-0' ? 0 : 1].toString(16).padStart(6, '0')}`;
      g.fillStyle = '#e8e2d4';
      g.fillRect(12, 6, 6, 54);
      g.strokeRect(12, 6, 6, 54);
      g.beginPath();
      g.moveTo(18, 8);
      g.lineTo(58, 20);
      g.lineTo(18, 34);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      g.stroke();
    }
    t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    this.badgeTextures.set(kind, t);
    return t;
  }

  private flashUnit(id: string, amount: number): void {
    const obj = this.units.get(id);
    if (obj) obj.flash = Math.max(obj.flash, amount);
  }

  /** Draw a short-lived bolt between two units (a shot without a missile image). */
  private addTracer(fromId: string, toId: string, color: number): void {
    const from = this.units.get(fromId);
    const to = this.units.get(toId);
    if (!from || !to) return;
    const a = from.group.position.clone().setY(from.targetPos.y + 0.7);
    const b = to.group.position.clone().setY(to.targetPos.y + 0.7);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.4, max: 0.4 });
  }

  private render = (): void => {
    if (this.disposed) return;
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const lerp = 1 - Math.pow(0.001, dt); // frame-rate independent smoothing

    // Animations run on wall-clock time (a slow frame doesn't slow them down);
    // only a long stall, like a background tab, is capped.
    const dtMs = Math.min(rawDt, 0.25) * 1000 * this.animSpeed;
    this.now += dtMs;
    for (let i = 0; i < this.timeline.length; ) {
      const step = this.timeline[i]!;
      if (step.at <= this.now) {
        this.timeline.splice(i, 1);
        step.fn();
      } else i++;
    }

    this.stepCamera();
    this.clampCameraTarget();
    this.controls.update();

    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    for (const obj of this.units.values()) this.animateUnit(obj, dtMs, lerp, camRight);
    this.animateMissiles();
    this.rolls.update(this.now, this.projectUnit);

    // Fade and retire tracers.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      } else {
        t.line.material.opacity = t.life / t.max;
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Turn editor drag painting on (a handler) or off (`null`). While on, a
   * left-drag reports a cell rectangle instead of orbiting — middle-drag orbits
   * and right-drag still pans. A press that barely moves is still a click.
   */
  setCellDrag(handler: ((from: Vec, to: Vec, done: boolean) => void) | null): void {
    this.onCellDrag = handler;
    this.drag = null;
    this.controls.mouseButtons = handler
      ? { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  private handlePointerDown = (ev: PointerEvent): void => {
    this.downPos = { x: ev.clientX, y: ev.clientY };
    this.drag = null;
    if (this.onCellDrag && ev.button === 0) {
      this.aimRay(ev);
      const cell = this.pickCell();
      if (cell && this.inBoard(cell)) this.drag = { from: cell, to: cell, key: `${cell.x},${cell.y}`, moved: false };
    }
  };

  private handlePointerUp = (ev: PointerEvent): void => {
    if (!this.downPos) return;
    const moved = Math.hypot(ev.clientX - this.downPos.x, ev.clientY - this.downPos.y);
    this.downPos = null;
    const drag = this.drag;
    this.drag = null;
    if (drag?.moved) return this.onCellDrag?.(drag.from, drag.to, true);
    if (moved > 6) return; // treat as a drag, not a click

    this.aimRay(ev);

    // Units first (their meshes carry userData.unitId), then a board cell.
    const unitId = this.pickUnit();
    if (unitId) {
      this.onUnitClick?.(unitId);
      return;
    }

    const cell = this.pickCell();
    if (cell) this.onCellClick?.(cell);
  };

  private handlePointerMove = (ev: PointerEvent): void => {
    if (this.drag && (ev.buttons & 1) !== 0 && this.downPos) {
      const moved = Math.hypot(ev.clientX - this.downPos.x, ev.clientY - this.downPos.y);
      this.aimRay(ev);
      const cell = this.pickCell();
      // Off the board the rectangle keeps its last in-board corner.
      if (cell && this.inBoard(cell)) {
        const key = `${cell.x},${cell.y}`;
        if (moved > 6 && (key !== this.drag.key || !this.drag.moved)) {
          this.drag = { ...this.drag, to: cell, key, moved: true };
          this.onCellDrag?.(this.drag.from, cell, false);
        }
      }
    }
    if (!this.onCellHover) return;
    if (ev.buttons !== 0) {
      this.hoverUnitId = null;
      return this.setHover(null); // orbiting/panning: hide the tooltip
    }
    this.aimRay(ev);
    // A figure stands over its own hex; report that rather than the tile behind it.
    const unitId = this.pickUnit();
    this.hoverUnitId = unitId ?? null;
    const target = unitId ? this.units.get(unitId)?.targetPos : undefined;
    const unitCell = target ? this.worldToCell(target) : null;
    this.setHover(unitCell ?? this.pickCell());
  };

  private handlePointerLeave = (): void => {
    this.hoverUnitId = null;
    this.setHover(null);
  };

  private inBoard(cell: Vec): boolean {
    return cell.x >= 0 && cell.y >= 0 && cell.x < this.width && cell.y < this.height;
  }

  private setHover(cell: Vec | null): void {
    const key = cell ? `${cell.x},${cell.y}` : null;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.onCellHover?.(cell);
  }

  private aimRay(ev: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /** The visible unit whose opaque figure is under the current ray. */
  private pickUnit(): string | undefined {
    const meshes: THREE.Object3D[] = [];
    for (const obj of this.units.values()) if (obj.group.visible) meshes.push(obj.group);
    const unitHits = this.raycaster.intersectObjects(meshes, true);
    return unitHits.find((h) => this.isSolidHit(h))?.object.userData.unitId as string | undefined;
  }

  /** The board cell under the current ray: nearest tile/feature hit, else the ground plane. */
  private pickCell(): Vec | null {
    // The nearest tile or feature hit resolves raised hexes by their top or side faces.
    const tileCell = this.raycaster.intersectObjects(this.tiles, false)[0]?.object.userData.cell as Vec | undefined;
    if (tileCell) return tileCell;
    const point = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, point)) return this.worldToCell(point);
    return null;
  }

  /** A cutout's quad is larger than its figure: only count clicks on opaque pixels. */
  private isSolidHit(hit: THREE.Intersection): boolean {
    if (!hit.object.userData.isCutout || !hit.uv) return true;
    const obj = this.units.get(hit.object.userData.unitId as string);
    const map = obj?.sprite.material.map;
    if (!obj?.atlas || !map) return false;
    return obj.atlas.alphaAt(map.offset.x + hit.uv.x * map.repeat.x, map.offset.y + hit.uv.y * map.repeat.y) > 0;
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.refitOpening();
  }

  /**
   * Set the opening shot, at the fixed viewing angle: the pivot on the middle of
   * the deployed units and close enough in that they fill the view (see
   * {@link startView}), falling back to the whole table when nothing is deployed
   * (the editor). The player can still pull out past the table — that wider
   * framing sets the zoom limit — but this is what "Reset view" gives back, and
   * what combat close-ups zoom in from.
   */
  private positionCamera(state: GameState): void {
    // Frame the full hex footprint (in world units), not the cell counts.
    const spanX = HEX_COL_STEP * (this.width - 1) + 2 * HEX_SIZE;
    const spanZ = HEX_ROW_STEP * (this.height - 1 + 0.5) + 2 * HEX_SIZE;
    const span = Math.max(spanX, spanZ);
    this.camera.position.set(0, span * 0.95, spanZ * 0.62 + 3);
    this.controls.target.set(0, 0, 0);
    const table = this.camera.position.length();
    this.controls.minDistance = 3;
    this.controls.maxDistance = table * 1.8;
    // Swing the same viewing angle onto the units: only the pivot and the
    // distance move, so the board is never seen from an angle it wasn't built for.
    const points = state.units.filter((u) => !u.dead).map((u) => this.unitWorld(u.pos));
    const start = this.startView(points);
    if (start) {
      const dir = this.camera.position.clone().normalize();
      this.controls.target.copy(start.target);
      this.camera.position.copy(start.target).addScaledVector(dir, start.dist);
    }
    this.homeDist = start ? start.dist : table;
    this.playerView = { target: this.controls.target.clone(), dist: this.homeDist };
    this.opening = start ? { points, ...start } : null;
    this.controls.update();
    this.controls.saveState();
  }

  /**
   * A canvas that changes shape (the window resized, a phone turned) frames a
   * different amount of ground, so re-fit the opening shot to it — but only
   * while that shot is still what's on screen. Once the player has moved the
   * camera, or the fighting has started and the units have left the deployment
   * it was fitted to, the view is no longer ours to set.
   */
  private refitOpening(): void {
    const open = this.opening;
    if (!open || this.cam || this.downPos) return;
    const dist = this.camera.position.distanceTo(this.controls.target);
    if (this.controls.target.distanceTo(open.target) > 0.01 || Math.abs(dist - open.dist) > 0.01) return;
    const start = this.startView(open.points);
    if (!start) return;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(start.target);
    this.camera.position.copy(start.target).addScaledVector(dir, start.dist);
    this.homeDist = start.dist;
    this.playerView = { target: start.target.clone(), dist: start.dist };
    this.opening = { points: open.points, ...start };
    this.controls.update();
    this.controls.saveState();
  }

  /**
   * Where to stand so every living unit is in view: the pivot in the middle of
   * them, and the closest distance that still holds them all — which pulls back
   * out again when a wide deployment would otherwise run off the edges of the
   * canvas. Null when nothing is deployed.
   */
  private startView(points: THREE.Vector3[]): { target: THREE.Vector3; dist: number } | null {
    if (points.length === 0) return null;
    const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3()).setY(0);
    // Stand as close as the units allow, judged by the same test the follow
    // camera uses (every unit, and the dice card over its head, comfortably
    // inside the frame) so the opening shot isn't one the first blow has to pan
    // away from. Fit is monotonic in the distance, so halve the range onto it.
    let lo = Math.max(this.controls.minDistance, this.fitDistance(START_MIN_SPAN)); // may be too close
    let hi = this.controls.maxDistance; // as far out as the player could zoom
    if (lo >= hi || !this.inView(points, { target, dist: hi })) return { target, dist: hi };
    for (let i = 0; i < START_FIT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (this.inView(points, { target, dist: mid })) hi = mid;
      else lo = mid;
    }
    return { target, dist: hi };
  }

  /**
   * A unit's point `height` above its base, in container pixels (null when
   * behind the camera) — how anything drawn in DOM over the board finds a unit.
   */
  projectUnit = (id: string, height: number): { x: number; y: number } | null => {
    const obj = this.units.get(id);
    if (!obj) return null;
    const p = obj.group.position.clone();
    p.y += TILE_TOP + height;
    p.project(this.camera);
    if (p.z > 1) return null;
    return {
      x: ((p.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - p.y) / 2) * this.container.clientHeight,
    };
  };

  /** Keep the orbit pivot on the board so panning can't lose the table. */
  private clampCameraTarget(): void {
    const t = this.controls.target;
    const halfX = this.originX + HEX_SIZE;
    const halfZ = this.originZ + HEX_SIZE;
    const x = THREE.MathUtils.clamp(t.x, -halfX, halfX);
    const z = THREE.MathUtils.clamp(t.z, -halfZ, halfZ);
    if (x !== t.x || z !== t.z || t.y !== 0) {
      // Shift the camera with the pivot so the clamp doesn't read as a rotation.
      this.camera.position.x += x - t.x;
      this.camera.position.y -= t.y;
      this.camera.position.z += z - t.z;
      t.set(x, 0, z);
    }
  }

  /** World X of column 0 / Z of row 0, so the board is centred on the origin. */
  private get originX(): number {
    return (HEX_COL_STEP * (this.width - 1)) / 2;
  }
  private get originZ(): number {
    return (HEX_ROW_STEP * (this.height - 1 + 0.5)) / 2;
  }

  /** Flat-top hex centre for an offset "odd-q" cell. */
  private cellToWorld(v: Vec): { x: number; z: number } {
    const x = HEX_COL_STEP * v.x - this.originX;
    const z = HEX_ROW_STEP * (v.y + 0.5 * (v.x & 1)) - this.originZ;
    return { x, z };
  }

  /** Where a unit's group sits: the hex centre, raised by the hex's elevation. */
  private unitWorld(v: Vec): THREE.Vector3 {
    const w = this.cellToWorld(v);
    return new THREE.Vector3(w.x, this.surfaceAt(v) - TILE_TOP, w.z);
  }

  /** World Y of a cell's top surface. */
  private surfaceAt(v: Vec): number {
    return surfaceY(this.board ? hexElevation(this.board, v) : 0);
  }

  /** Pixel-to-hex: invert the flat-top mapping, then cube-round to the nearest cell. */
  private worldToCell(point: THREE.Vector3): Vec | null {
    const px = point.x + this.originX;
    const pz = point.z + this.originZ;
    const fq = ((2 / 3) * px) / HEX_SIZE;
    const fr = ((-1 / 3) * px + (SQRT3 / 3) * pz) / HEX_SIZE;
    const { q, r } = cubeRound(fq, fr, -fq - fr);
    // axial -> offset "odd-q"
    const x = q;
    const y = r + (q - (q & 1)) / 2;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return { x, y };
  }
}
