import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  airborne,
  isDeadlyFeature,
  isImpassableFeature,
  makeHexGrid,
  MORALE_RADIUS,
  vecEq,
  vecKey,
  WAR_CRY_RANGE,
  type BoardData,
  type GameEvent,
  type GameState,
  type Owner,
  type UnitTraits,
  type Vec,
} from '@fansong/engine';
import { loadSpriteAtlas, projectileTexture, type SpriteAtlas } from './spriteTextures.js';
import { animationsFor, clipDuration, framesOf, type Clip, type RangedClip, type SpriteAnimations } from './unitAnimations.js';
import { UnitAnimator } from './unitAnimator.js';
import { Effects } from './effects.js';
import { LavaEmbers, lavaPixel, LavaSurface, type Ember } from './lava.js';
import { Backdrop, DEFAULT_BACKDROP, type BackdropKind } from './backdrop.js';
import { sfx } from '../audio/sfx.js';
import { voiceFamily, type SfxName, type VoiceLine } from '../audio/sfxCues.js';
import { cellNoise, featureLayout } from './features.js';
import {
  activationResolveMs,
  activationRollMs,
  NERVE_RESOLVE_MS,
  NERVE_ROLL_MS,
  OPPOSED_ROLL_MS,
  ROLL_LINGER_MS,
  RollOverlay,
  type ZoneScoreText,
} from './rollOverlay.js';
import { describeActivation, describeCombat, describeNerve } from '../ui/rollView.js';
import type { PlanPreview, ReachTile } from '../game/planView.js';
import { BoardChunks } from './chunks.js';
import {
  hexElevation,
  LAVA_SINK,
  surfaceY,
  TILE_BOTTOM,
  TILE_TOP,
  tileRimColor,
  tileSideColor,
  tileTopColor,
} from './terrain.js';
import { DOWN_POSES, RIDING_SPRITES, spriteFor } from './unitSprites.js';

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
  /** Enemy units already done for the round, drawn dimmed while the human decides. */
  spentUnitIds?: string[];
  /** Units the reader is pointing at elsewhere (a log line), ringed above every other cue. */
  focusUnitIds?: string[];
  /** Whether the local human may currently interact. */
  interactive: boolean;
  /**
   * Let clicks see through what they can't act on: a figure or tree that isn't
   * a target passes the click to the reachable hex or target unit behind it.
   * Off where any unit may be what the click is for (the sandbox's editing tools).
   */
  pickThrough?: boolean;
  /**
   * Seats this screen commands. Any other side's unit traces its route on the
   * board before it walks; left unset (a replay), every move does.
   */
  localSeats?: readonly Owner[];
  /** Tinted hex sets under the move highlights (editor zones and objectives). */
  overlays?: HexOverlay[];
  /** Game-mode markers standing on hexes (flags at base or dropped). */
  markers?: BoardMarker[];
  /** Game-mode badges floating over units (a King's crown, a carried flag). */
  badges?: Record<string, UnitBadge>;
  /** Changes whenever `markers`/`badges` do; they are only redrawn then. */
  markingsKey?: string;
}

/** A badge over a unit: a crown (King), player 0's / player 1's carried flag, a Guard stance, or a war cry's inspiration. */
export type UnitBadge = 'crown' | 'flag-0' | 'flag-1' | 'guard' | 'inspired';

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

/** One zone's turn in the end-of-round scoring (see {@link BoardView.scoreZone}). */
export interface ZoneScore extends ZoneScoreText {
  cells: Vec[];
}

const OWNER_COLORS = [0x4f9dff, 0xff6b5b] as const; // P0 blue, P1 red
const BACKGROUND = 0x11151c;
const SILHOUETTE_BACKGROUND = 0x050308;
// Physical lighting divides indirect light by π, so ~π is "full" ambient.
const AMBIENT_LIGHT = 2.6;
const KEY_LIGHT = 1.1;
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
    forceSinglePass: true,
    depthWrite: false,
  });
}

/** Cells per side of a square block of the board merged into one mesh (see {@link BoardChunks}). */
const CHUNK_CELLS = 8;
/** How far a hex top reaches before its darker rim, as a fraction of its radius. */
const TILE_RIM_START = 0.94;
/** How far a legacy blocked cell stands above its elevation. */
const BLOCKED_RISE = 0.4;
/** How far a lava hex's open melt reaches before it can crust over toward a bank, as a fraction of its radius. */
const LAVA_POOL = 0.5;
/** Embers rising from each lava hex. */
const LAVA_EMBERS = 3;
/** The glow at the foot of a wall that drops into lava. */
const LAVA_WALL_GLOW = 0xc2481a;

/**
 * One draw call for many copies of a mesh: each `place` positions a scratch
 * object whose transform becomes that copy's. The geometry and material are
 * shared, not owned (see {@link clearInstances}).
 */
function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  place: ((o: THREE.Object3D) => void)[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, place.length);
  const o = new THREE.Object3D();
  place.forEach((fn, i) => {
    fn(o);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
  });
  // Its bounds span every copy, for culling (the default is the one geometry's).
  mesh.computeBoundingSphere();
  return mesh;
}

/** Empty a group of {@link instanced} meshes, freeing their per-copy buffers. */
function clearInstances(group: THREE.Group): void {
  for (const child of group.children) (child as THREE.InstancedMesh).dispose();
  group.clear();
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
/**
 * Vertex-shader tail that draws a cutout at the depth of its feet (the quad's
 * origin) rather than of the leaning quad itself: the top of the figure leans
 * back into the hex behind, and would otherwise sink into a rock or a raised
 * tile standing there. Measured from a little way in front of the feet, so the
 * figure's own base and hex never cover it either; what stands in the hexes in
 * front still does.
 */
const FEET_DEPTH_GLSL = /* glsl */ `
  {
    vec3 feet = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec2 toCam = cameraPosition.xz - feet.xz;
    feet.xz += toCam / max(length(toCam), 1e-4) * ${(HEX_SIZE * 0.7).toFixed(3)};
    vec4 feetClip = projectionMatrix * viewMatrix * vec4(feet, 1.0);
    gl_Position.z = feetClip.z / feetClip.w * gl_Position.w;
  }`;

/** Draw a built-in material's cutout at its feet's depth (see {@link FEET_DEPTH_GLSL}). */
function standAtFeet<M extends THREE.Material>(material: M): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>${FEET_DEPTH_GLSL}`);
  };
  material.customProgramCacheKey = () => 'feet-depth';
  return material;
}

/**
 * {@link standAtFeet}, plus a `whiteout` uniform (0..1) that paints over the
 * texture's colours with white, leaving only the cutout's shape at 1. The
 * uniform is the material's own, kept in `userData.whiteout`.
 */
function standAtFeetWithWhiteout(material: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  const whiteout = { value: 0 };
  material.userData.whiteout = whiteout;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.whiteout = whiteout;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>${FEET_DEPTH_GLSL}`);
    shader.fragmentShader = `uniform float whiteout;\n${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      'gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), whiteout);\n#include <dithering_fragment>',
    );
  };
  material.customProgramCacheKey = () => 'feet-depth-whiteout';
  return material;
}

function outlineMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null },
      uOffset: { value: new THREE.Vector2() },
      uRepeat: { value: new THREE.Vector2(1, 1) },
      uPixel: { value: new THREE.Vector2(1 / 72, 1 / 72) },
      uWidth: { value: OUTLINE_PX },
      uPixelRatio: { value: pixelRatio },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${FEET_DEPTH_GLSL}
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 uOffset;
      uniform vec2 uRepeat;
      uniform vec2 uPixel;
      uniform float uWidth;
      uniform float uPixelRatio;
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
        // Sprite pixels per CSS pixel, read off the quad's own slope so zoom,
        // a Big model and the close-up camera all count. The closer the sprite,
        // the fewer sprite pixels the outline spans, so it thins against the art.
        float texels = length(vec2(dFdx(vUv.x), dFdy(vUv.x))) / uPixel.x * uPixelRatio;
        float width = uWidth * clamp(pow(texels * ${OUTLINE_REF_ZOOM.toFixed(2)}, ${OUTLINE_THINNING.toFixed(2)}), ${OUTLINE_MIN_SCALE.toFixed(2)}, ${OUTLINE_MAX_SCALE.toFixed(2)});
        float near = 0.0;
        float far = 0.0;
        for (int i = 0; i < 12; i++) {
          float t = float(i) * 0.5235988;
          vec2 d = vec2(cos(t), sin(t)) * uPixel;
          near = max(near, max(alphaAt(vUv + d * width * 0.5), alphaAt(vUv + d * width)));
          far = max(far, alphaAt(vUv + d * width * 2.0));
        }
        float glow = max(near, far * 0.4);
        if (glow < 0.02) discard;
        gl_FragColor = vec4(uColor, glow * uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
}

// Every unit owns its base and cutout materials, and three sorts opaque meshes
// by material, so left alone they draw base, cutout, base, cutout… switching
// shader on every draw. Ordering them groups all the bases, then all the
// cutouts. Opaque, they are depth-tested, so the order changes nothing on screen.
const BASE_ORDER = 1;
const CUTOUT_ORDER = 2;

const SELECT_COLOR = 0xffd54a;
const FOCUS_COLOR = 0xffffff; // ring on a unit named by the hovered log line
const GUARD_COLOR = 0x53e0d0; // ring on a unit holding a Guard stance
const INSPIRED_COLOR = '#ffae3c'; // star over a unit inspired by a war cry
const INSPIRED_GLOW = 0xffae3c; // the same colour, for the war cry's rings and blinks
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
const OUTLINE_PX = 2; // outline width in sprite pixels at the reference zoom, widened under the pointer
const OUTLINE_HOVER_PX = 3;
const OUTLINE_REF_ZOOM = 2; // screen pixels per sprite pixel at which the widths above hold
const OUTLINE_THINNING = 0.8; // 0 keeps the outline a fixed share of the sprite, 1 a fixed width on screen
const OUTLINE_MIN_SCALE = 0.2; // limits on how far zoom thins or thickens it
const OUTLINE_MAX_SCALE = 1.5;

// An enemy that has already acted this round (or whose side turned over) has
// its base go dark while the human picks and plans, so what can still answer stands out.
const SPENT_BASE = new THREE.Color(0x2a2e36); // the colour its base fades toward

// Units are paper cutouts: a Wesnoth sprite standing upright on a round base.
const BASE_RADIUS = 0.36;
const BASE_HEIGHT = 0.06;
const SPRITE_PX = 1.8 / 72; // world units per sprite pixel (a 72px Wesnoth hex ≈ 1.8)
const BIG_SCALE = 1.3; // how much taller a Big unit's cutout stands (see the Big trait)

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
const WALK_SWAY = 0.12; // radians it rocks side to side, alternating each step (for sprites without walk frames)
const ROUTE_LEAD_MS = 450; // an opponent's route is traced this long before the unit sets off along it
const ROUTE_FADE_MS = 250; // and fades out this long once the unit arrives
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
const WAR_CRY_MS = 1100; // a Leader's war cry: its rallying clip and verdict before play goes on
const WAR_CRY_SHOUT_MS = 650; // the shout rolls out from the Leader this long before the camera turns to who hears it
const WAR_CRY_RINGS = 3; // rings of the shout rolling out from the Leader
const WAR_CRY_RING_GAP_MS = 170;
const WAR_CRY_WAVE_STEP_MS = 150; // the cry's wave lights the hexes one ring further out this often
const WAR_CRY_WAVE_HEX_MS = 700; // how long one hex stays lit as the wave passes
const INSPIRE_BLINKS = 3; // gold blinks an inspired friend gives, the star landing on the last
const INSPIRE_BLINK_MS = 260; // one blink
const INSPIRE_HOLD_MS = 450; // the stars stay in view this long before play goes on
const BADGE_POP_MS = 380; // a badge popping in over a unit, overshooting a little

// Combat effects (see effects.ts). No red anywhere: impacts are white and gold,
// dust takes the ground's colour, and a gruesome kill leaves ash, not blood.
const SPARK_COLORS = [0xffffff, 0xfff3c4, 0xffd98a];
const GOLD = 0xffcf4a;
const GOLD_COLORS = [0xffe28a, 0xffcf4a, 0xfff6d0];
const STEEL = 0xc9d6e3;
const STEEL_COLORS = [0xffffff, 0xc9d6e3, 0x9fb3c8];
const ASH_COLORS = [0x34313a, 0x57525e, 0x807a88];
const CHIP_COLORS = [0x8a8074, 0x6b635a, 0xb0a594];
const DUST_TINT = 0xb8a888; // what the ground's colour is lightened toward for dust
const WISP_COLOR = 0xcfe6ff;
const FEAR_COLOR = 0x6a3a9a;
const DEFLECT = 0.08; // how far a clash throws the two combatants apart
const BLOCK_STOP_MS = 110; // a blocked swing freezes this long where it is stopped: less than a blow that tells
const BLOCK_BEAT_MS = 60; // ...and a lone blocked swing holds this long after it before play goes on
const BLOCK_REPLY_MS = 120; // the blocker's answer starts this soon after the block, while the swing is still coming back
const SPAR_ODDS = [0.4, 0.1]; // chance a melee opens with at least one round of blocked blows, and with two
const BLOCK_BOUNCE = 0.16; // how far the swing's owner staggers back off the block
const BLOCK_BOUNCE_MS = 360;
const BLOCK_BRACE = 0.03; // how far the blocker shudders under it
const JOLT_MS = 220;
const TOUGH_HITCH_MS = 320; // a Tough unit freezes mid-death this long before it drops to the ground instead
const GLOW_MS = 1200; // gold rim glow on a Tough save
const BONE = 0xe8e0c8; // a Reassembling unit's bones pulling back together
const BONE_COLORS = [0xf4eedc, 0xe8e0c8, 0xbfb49a];
const PINCER_COLOR = 0xffa64a; // the jaws closing on a foe caught between two
const SHIELDWALL_COLOR = 0x8fc8ff; // shields locked along a line of friends
const RUSH_COLOR = 0xfff0c8; // the streaks a Rusher's charge trails
const RUSH_LUNGE = 1.7; // how much further a Rusher's charge leans into its target
const LEAF_COLORS = [0x3a7a42, 0x6fae4a, 0xa9d46a, 0xc9a13a];
const LEAF_GLOW = 0x9be07a; // the rim on a Woodwise unit fighting from the trees
const WHIRL_COLOR = 0xe8f0ff; // the blade trails round a Whirling unit beset on all sides
const STONE = 0xd8cfc0; // an Immovable unit digging in
const SLIP_COLOR = 0xbfe9ff; // the afterimages a Slippery unit leaves as it ducks away
const SLIP_GHOSTS = 6; // how many afterimages it leaves...
const SLIP_GHOST_MS = 100; // ...this far apart...
const SLIP_GHOST_LIFE = 0.9; // ...each lasting this many seconds
const QUERY_COLOR = 0xffe9a8; // the question mark over a Dumb unit told to act
const TRAMPLE_MS_PER_HEX = 190; // a trampled unit is driven back at this pace, faster than a walk
const TEETER = 0.4; // radians a Bad Balance unit rocks as it loses its footing...
const TEETER_MS = 350; // ...for this long after the shove ends, before it goes over
const DEFECT_MS = 450; // a turncoat's old colours drain this long before it turns
const REASSEMBLE_GATHER_MS = 650; // the bones drawing in, before the unit starts to climb up
const REASSEMBLE_STAGGER_MS = 250; // between one unit's reassembly and the next
const REASSEMBLE_HOLD_MS = 500; // standing, before the camera goes back to the player's view
const REASSEMBLE_MIN_SPAN = 8; // world units kept in view: looser than a fight, the ground around them matters
const ZONE_SPAN_MARGIN = 1.8; // how much of the view a zone being scored takes up
const ZONE_MIN_SPAN = 8; // world units kept in view around it, so who stands in and near it shows
const ZONE_SCORE_LEAD_MS = 250; // a zone's verdict is up this long before its point counts
const ZONE_SCORE_MS = 1700; // how long its verdict and glow last: fading only as the next zone's turn begins
const ZONE_UNHELD_COLOR = 0xcfd8e3; // the glow of a zone nobody takes
const ZONE_GLOW = 0.7; // its opacity at the brightest
const KEY_PAN_SPEED = 0.9; // WASD pans this many view distances per second, so it feels the same at any zoom
const KEY_PAN_EASE_IN = 0.12; // seconds for a WASD pan to come up to speed...
const KEY_PAN_EASE_OUT = 0.16; // ...and to glide to a stop once the keys are let go
const KEY_PAN_CODES = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] } as const;
const HIT_STOP_MS = 300; // a gruesome kill freezes the action this long on impact
const IMPACT_STOP_MS = 160; // any other blow that tells (a kill, knockdown, save, clash or parry) freezes this long
const IMPACT_WHITE = 20; // through that freeze the unit the blow met is drawn this bright: flat white
const SILHOUETTE_MS = 120; // the start of a gruesome kill's freeze is a flat silhouette: the victim white, all else dark
const SHOWN_FRAME_MAX_MS = 1000 / 30; // the most one frame counts toward a freeze, so a stalled frame can't swallow it
const SLOW_MO_MS = 1100; // then plays on in slow motion for this long (wall clock), easing back to full speed
const SLOW_MO_SCALE = 0.3; // board time runs this fast at the start of a gruesome kill's slow motion
const FEAR_WAVE_MS = 800; // time for a gruesome kill's fear to reach the edge of its radius
const FEAR_WALL_HEIGHT = 1.4; // the pale wall that fear spreads as
const FEAR_WALL_COLOR = 0xc8b4ff;
const HALO_COLOR = 0x9a6ad0; // the faint ring showing how far a coming gruesome kill's fear will reach
// A gruesome kill that is coming (the events say so before it plays): the build-up to it.
const DREAD_SPAN_MARGIN = 1.8; // its close-up is tighter than an ordinary fight's...
const DREAD_MIN_SPAN = 4.2;
const DREAD_MAX_ZOOM = 0.55;
const DREAD_FRAME_SLOW = 1.6; // ...and the camera takes this much longer to get there
const DREAD_DOLLY = 0.93; // then keeps creeping in to this fraction of its distance until the blow lands
const WINDUP_MS = 320; // the killer holds its swing (or its draw) at the peak this long
const DREAD_COLOR = 0xcdb8ff; // the power gathering in the killer as it does
const SPOT_IN_MS = 400; // the rest of the board darkens this fast as the build-up starts...
const SPOT_OUT_MS = 600; // ...and comes back this fast once the killer's triumph is over
const SPOT_DIM = 0.6; // how much a unit out of the spotlight darkens
const SPOT_LIGHT_DIM = 0.55; // how much the light on the board drops
const SHIVER_MS = 380; // a friend who will have to test its nerve shivers this often through the build-up
const PUSH_IN = 0.9; // on impact the camera lurches in to this fraction of its distance...
const PUSH_IN_MS = 260;
// An ordinary kill gets a lighter cut of the same camera work: no darkness, tilt or triumph.
const KILL_DOLLY = 0.96; // the camera creeps in to this fraction of its distance until the blow lands...
const KILL_PUSH_IN = 0.94; // ...lurches in to this fraction of it on impact...
const KILL_SLOW_MO_MS = 450; // ...and the fall plays in slow motion this long (wall clock)
const KILL_SLOW_MO_SCALE = 0.5;
const ROLL = 0.05; // ...and tilts this far (radians), easing back
const ROLL_MS = 900; // wall clock
const SLASH_COLOR = 0xf2ecff;
const SLASH_S = 1.3; // seconds of board time a killing slash hangs in the air
const THROW_MS = 700; // the victim is hurled back...
const THROW_DIST = 1.3;
const THROW_HEIGHT = 0.7;
const THROW_SPIN = 2.4; // radians it turns over in the air
const THROW_BREAK = 0.55; // ...and breaks apart this far into its flight
const VICTORY_AT_MS = 750; // after the kill the camera goes to the killer for its triumph...
const VICTORY_HOLD_MS = 1300; // ...and holds on it this long before the nerve checks
const FLEE_SLOW_MS = 900; // a friend who breaks and runs from a gruesome kill runs in slow motion this long (wall clock)
const FLEE_SLOW_SCALE = 0.45;
const SCORCH_SIZE = HEX_SIZE * 1.5; // the scorch a gruesome kill leaves, which lasts the whole game
const SHATTER_FADE_MS = 200; // a unit that shatters into motes is gone this fast
const COIL_MS = 260; // a blow that floors its target is gathered this long first: the striker sinks back before it goes
const COIL_BACK = 0.45; // how far it draws back as it gathers, as a fraction of its lunge...
const COIL_SQUASH = 0.14; // ...and how much it crouches into itself
const DREAD_COIL_MS = 620; // a gruesome kill is gathered this long before the swing (or the draw) even starts...
const DREAD_COIL_DEPTH = 1.6; // ...its killer sinking this much further back and down than for an ordinary heavy blow
const DREAD_BEATS = 2; // the heartbeats that sound through that gathering
/** How long before a melee blow lands its swing is heard. */
const SWING_SOUND_LEAD_MS = 130;
/** The beat between one activation die's sound and the next. */
const DIE_SOUND_GAP_MS = 90;
const FLAG_SOUNDS = {
  FlagPickedUp: 'flag-pickup',
  FlagDropped: 'flag-drop',
  FlagReturned: 'flag-return',
  FlagCaptured: 'flag-capture',
} as const satisfies Record<string, SfxName>;
const HEAVY_REACH = 1.5; // how much deeper than an ordinary lunge that blow drives in
const DASH_MS = 90; // the last of the swing, when it covers nearly all that ground
const DASH_STRETCH = 0.2; // how much the cutout stretches along the dash
const DASH_GHOSTS = 3; // afterimages it leaves over the dash...
const DASH_GHOST_LIFE = 0.32; // ...each lasting this many seconds
const HEAVY_STOP_MS = 220; // the freeze on a heavy killing blow's impact: longer than any other that tells
const DOWN_STOP_MS = 170; // ...and on one that only floors its target
const DOWN_IMPACT = 0.6; // how big that lesser blow's flash, sparks and shake are beside a killing one's
const DOWN_SLOW_MO_MS = 420; // then the victim leaves its feet in slow motion this long (wall clock)
const DOWN_SLOW_MO_SCALE = 0.4;
const DOWN_DOLLY = 0.97; // the camera creeps in to this fraction of its distance until a flooring blow lands...
const DOWN_PUSH_IN = 0.95; // ...and lurches in to this fraction of it on impact
const TOSS_MS = 380; // a unit struck down is in the air this long...
const TOSS_HEIGHT = 0.42; // ...rising this high...
const TOSS_BACK = 0.2; // ...thrown this far back from the blow...
const TOSS_LEAN = 0.55; // ...and tipping over this far (radians) at the top
const TOSS_SETTLE_MS = 320; // after it lands it bounces once and slides back to the middle of its hex
const SLAM_SQUASH = 0.3; // how flat it lands
const SLAM_SQUASH_MS = 260;
const SLAM_STOP_MS = 70; // the catch as it hits the ground
const PUSH_OFF_MS = 900; // a unit shoved off the table slides, topples and drops for this long
const LAVA_DEATH_MS = 1100; // a unit going into lava slides in, then sinks glowing for this long
const EMBER_COLORS = [0xffe08a, 0xffb13a, 0xff6a1a];
const SMOKE_COLORS = [0x3a3431, 0x55504c, 0x2a2624];
const STICK_MS = 500; // an arrow that lands stays in its target this long
const SHOT_ARC = 0.18; // a shot's apex rises this fraction of its length above the straight line...
const LOB_ARC = 0.3; // ...and a lobbed stone or spear's this much
const FLIGHT_MS_PER_UNIT = 55; // a missile's flight lasts this much longer per world unit past its first hex...
const FLIGHT_FREE = HEX_STEP; // ...so a shot at an adjacent hex keeps its clip's own timing
const TRAIL_STEP = 0.025; // a flying missile leaves a trail puff every this many world units
const TRAIL_COLORS = [0xfff4d6, 0xffe2a8, 0xffffff];
// A gruesome shot (see launchMissile and killFx): watched all the way in, and through.
const DREAD_SHOT_FLIGHT_MS = 260; // it stays in the air this much longer than an ordinary shot
const DREAD_SHOT_SLOW_AT = 0.35; // from this far into its flight...
const DREAD_SHOT_SLOW_MS = 900; // ...the rest plays in slow motion this long (wall clock), easing back
const DREAD_SHOT_SLOW_SCALE = 0.25;
const DREAD_SHOT_FOLLOW = 0.35; // the camera slides this far toward the victim while it flies
const CURSE_COLORS = [0x9a6ad0, 0xb25cff, 0xff4a2a, 0xff7a4a]; // its trail: dread and embers
const SHOT_SMOKE_COLORS = [0x6f6a78, 0x8d8896, 0xa9a4b2]; // the line of smoke it leaves hanging
const SMOKE_EVERY = 4; // trail steps between puffs of that smoke
const PIERCE_MS = 140; // it bursts out of its victim and buries itself in the ground behind in this long
const PIERCE_REACH = HEX_STEP * 0.95; // that far behind the victim, when the hex there is free...
const PIERCE_SHORT = HEX_SIZE * 0.45; // ...or this far, inside the victim's own hex, when someone stands behind
const SPEED_LINES = 14; // lines rushing in on its impact during the freeze
const PATH_HEX_MS = 520; // a hex under its flight stays lit this long as it passes
const LONG_SHOT_HEXES = 4; // a gruesome shot from this many hexes or more is called out by its length
const BLINKS = 3; // a knocked-down unit blinks this many times as it lands
const BLINK_MS = 160; // one blink: hidden for the first half, shown for the second
const PICK_FLASH = 1.25; // whiteout on a unit as it is picked to activate; above 1 it holds as a pure white shape first
const PICK_FLASH_FADE = 3.5; // whiteout lost per second
/**
 * The opponent's pick gets a beat of its own before its dice tumble: the unit
 * blanks white, its ring swells and its outline glows in its side's colour,
 * so the eye lands on who is activating before the card over it draws focus.
 */
const OPPONENT_PICK_MS = 550;
const OPPONENT_PICK_GLOW_MS = 1400;
const OPPONENT_PICK_PULSE_MS = 900;

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
const HAND_MOVE_SLACK = 0.05; // a press that shifts the camera by less than this fraction of its distance was a click, not a camera move
const ZOOM_STEADY = 0.2; // a close-up within this fraction of the current distance keeps that distance and only pans
const FIT_STEPS = 18; // halvings used to find the nearest distance that holds a set of units
const SELECT_PAN_STEPS = 12; // halvings used to find the shortest pan that brings a pick into frame
const SELECT_PAN_SLACK = 0.12; // extra fraction of that pan, so the pick isn't left on the margin
const FOCUS_LEAD_MS = 220; // how long before a camera move its units start pulsing
const FOCUS_PULSE_MS = 700;
const COMBAT_CARD_HOLD_MS = 600; // how long a blow's dice cards stay up after it lands
const COMBAT_CARD_LINGER_MS = 3000; // a blow's dice cards stay up at least this long, unless the next fight replaces them
const COMBAT_SPAN_MARGIN = 2.2; // how much of the close-up the two combatants take up
const COMBAT_MIN_SPAN = 5; // world units kept in view (~5 hexes), however close the pair stand
const COMBAT_MAX_ZOOM = 0.7; // never closer than this fraction of the player's own framing
const FRAME_LIFT = 0.55; // a close-up centres this high above a unit's base (mid-body, scaled by its size), not on its feet
// Two fighters standing in line with the camera hide one behind the other, so
// a close-up turns around them — only as far as it takes to show both.
const BODY_WIDTH = 0.6; // world width of a unit's body on screen: its torso, so weapons and shields may still overlap a little
const BODY_HEIGHT = 1.3; // fallback height of a unit's body, for a cutout whose art hasn't loaded
const SEPARATE_STEP = Math.PI / 60; // turns tried in steps of this (3°), nearest first
const HEADING_RETURN = Math.PI / 6; // a fight that left the camera turned further than this (30°) turns back to the player's heading

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

/** An opponent's move traced on the board: the route ahead of the walker and a mark on each hex still to come. */
interface Route {
  group: THREE.Group;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  /** One per hex after the origin; the last is the destination. */
  dots: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[];
  /** Hex centres on the board surface, origin first. */
  points: THREE.Vector3[];
  /** Board time the walk sets off. */
  start: number;
}

interface Missile {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  end: number;
  /** Height of the flight's apex above the straight line; longer shots arc higher. */
  arc: number;
  /** What happens where it ends: it sticks in its target, or kicks up the ground or the cover it hit. */
  ending: ShotEnding;
  /** Its landing effect has played. */
  landed: boolean;
  /** Where its trail last left a puff (null before it sets off). */
  trailAt: THREE.Vector3 | null;
  /** Trail puffs left so far, to space out a gruesome shot's smoke. */
  puffs: number;
  /**
   * A gruesome shot: it trails dread, embers and smoke, and once through its
   * victim it carries on into `pierce`, low behind it, and stays stuck there.
   */
  dread?: { pierce: THREE.Vector3 };
}

/** A gruesome shot's arrow, stuck in the ground behind its victim for the rest of the round. */
interface StuckArrow {
  sprite: THREE.Sprite;
  /** The way it was flying when it went in, to keep it pointing that way as the camera turns. */
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/** Where a shot ends: in its target, in the ground past it, or in the cover in front of it. */
type ShotEnding = 'hit' | 'miss' | 'cover';

/** A shot's apex height: it grows with the shot's length, so a long shot curves more. */
function shotArc(from: THREE.Vector3, to: THREE.Vector3, rate: number): number {
  return Math.hypot(to.x - from.x, to.z - from.z) * rate;
}

/** The point a fraction `f` of the way along a parabola from `from` to `to`, peaking `arc` above the chord. */
function arcPoint(
  from: THREE.Vector3,
  to: THREE.Vector3,
  arc: number,
  f: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  out.lerpVectors(from, to, f);
  out.y += 4 * arc * f * (1 - f);
  return out;
}

/** The middle of a set of points. */
function middle(points: THREE.Vector3[]): THREE.Vector3 {
  return points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
}

/** The signed turn (radians, within ±π) from heading `from` to heading `to`. */
function turnBetween(from: number, to: number): number {
  return THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
}

/** Where the camera stands: the orbit pivot on the ground, the view distance, and its heading around the table. */
interface View {
  target: THREE.Vector3;
  dist: number;
  /** Azimuth of the camera around the pivot (radians, as {@link THREE.Spherical}'s theta). */
  yaw: number;
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
  /** The tint baked into its sprite, if any. */
  tint: string | undefined;
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
  /** Whether this unit is a flyer (floats above its hex unless downed or grounded). */
  flying: boolean;
  /** A flyer weighed down by a flag it carries: it walks, so it stays on the ground. */
  grounded: boolean;
  /** Current hover height, lerped toward {@link FLY_HOVER} while airborne (0 on the ground). */
  hover: number;
  base: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Mode badge sprite (shares a texture per badge kind); hidden when none. */
  badge: THREE.Sprite;
  /** Whether the view model gives it a badge, which shows once {@link badgeHeld} has passed. */
  badgeOn: boolean;
  /** Board time before which its badge stays hidden: a war cry's star waits for the friend to take heart. */
  badgeHeld: number;
  /** Board time its badge popped in, while it is still growing to size. */
  badgePop: number | null;
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
  /**
   * Board times the fade-out starts / ends, while dying or fleeing. `drop` is
   * the push that shoved it off the table (it slides that way, topples by
   * `tilt` and sinks).
   */
  fade: {
    start: number;
    end: number;
    flee: THREE.Vector3 | null;
    drop?: THREE.Vector3;
    tilt?: number;
    /** Going into lava: the world offset it slides (and drops) to (zero when it falls in where it hovers), then it sinks. */
    melt?: THREE.Vector3;
    /** Hurled by a gruesome kill: the way it flies, and how far it turns over before it breaks apart. */
    thrown?: THREE.Vector3;
    spin?: number;
  } | null;
  /** Set by a UnitPushedOff event: the direction it is shoved off the table. */
  pushedOff: THREE.Vector3 | null;
  /** Set by a gruesome kill that leaves it on the board: the direction it is hurled. */
  thrown: THREE.Vector3 | null;
  /** Set by a lava death (pushed in or knocked out of the air): the world offset to the lava it goes into, height included. */
  intoLava: THREE.Vector3 | null;
  /** A knock the cutout takes and springs back from (a clash, a brace, a shudder of fear); `shake` wobbles instead. */
  jolt: { dir: THREE.Vector3; start: number; end: number; shake: boolean } | null;
  /** A rim glow traced around the figure (a Tough save), when no click cue is showing. */
  glow: { color: number; start: number; end: number; beats?: number } | null;
  /** Board times a knocked-down unit blinks between (see {@link BLINKS}). */
  blink: { start: number; end: number } | null;
  /**
   * A shove the cutout rides out and recovers from: a strike's lunge in, or a
   * dodge back. With `coil` (ms) it first sinks back for that long, gathering,
   * then drives in late and deep (see {@link COIL_BACK}, {@link HEAVY_REACH});
   * `depth` scales how far it sinks.
   */
  lunge: { dir: THREE.Vector3; start: number; hit: number; end: number; coil?: number; depth?: number } | null;
  /**
   * Struck off its feet: thrown back along `dir` in an arc from `start` to
   * `land`, tipping over by `lean`, then bouncing and sliding home until `end`.
   */
  toss: { dir: THREE.Vector3; start: number; land: number; end: number; lean: number } | null;
  /** A landing the cutout flattens under and springs back from. */
  squash: { start: number; end: number; amount: number } | null;
  /**
   * A move in progress: hex centres from origin to destination, walked from board
   * time `start` at `pace` ms a hex (a walk's, unless given). `backward` keeps the facing (a recoil).
   */
  walk: { path: THREE.Vector3[]; start: number; backward?: boolean; pace?: number; /** The last step heard. */ stepped?: number } | null;
  /** Board times a Bad Balance unit rocks between as a shove takes its footing. */
  teeter: { start: number; end: number } | null;
  /** Its traits from the latest GameState (null until the first update). */
  traits: UnitTraits | null;
  /** The side the state says it has gone over to, while it is still drawn in its old colours (see `turnCoat`). */
  turnTo: Owner | null;
  /** Its change of sides is on the timeline: the colours hold until that plays. */
  turning: boolean;
  /** 0..1 transient hit flash, decays each frame. */
  flash: number;
  /** Transient pick whiteout, decays each frame; 1 and above shows only the white shape. */
  whiteout: number;
  /** Whether the view model marks it spent, and how far (0..1) its base has darkened. */
  spent: boolean;
  spentShade: number;
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
  private readonly routes: Route[] = [];
  private readonly routeGroup = new THREE.Group();
  private routeDotGeo: THREE.CircleGeometry | null = null;
  /** See {@link BoardViewModel.localSeats}; null traces every move. */
  private localSeats: readonly Owner[] | null = null;
  private readonly missiles: Missile[] = [];
  private readonly stuckArrows: StuckArrow[] = [];
  private readonly effects = new Effects();
  /** Wall-clock time (ms, at animation speed): unlike {@link now} it runs on through a hit-stop. */
  private wallNow = 0;
  /**
   * Time on screen (ms, at animation speed): the wall clock with each frame's
   * share capped at {@link SHOWN_FRAME_MAX_MS}, so a frame that stalls (as the
   * one after an impact can, raising its effects) doesn't use up a hit-stop
   * the player never saw. Hit-stops, silhouettes and slow motion run on it.
   */
  private shownNow = 0;
  /** Board time stands still until time on screen reaches this (a hit-stop). */
  private freezeUntil = 0;
  /** Board time runs slow (from `scale`) between these times on screen, easing back to full speed. */
  private slowMo = { start: 0, end: 0, scale: SLOW_MO_SCALE };
  /** A hit-stop's impact frame, until this time on screen: the units the blow met drawn white. */
  private impact: { until: number; ids: string[] } | null = null;
  /** Camera shakes in progress, on the wall clock. */
  private shakes: { start: number; end: number; amp: number; kind: 'nudge' | 'rumble'; dir: THREE.Vector3 }[] = [];
  /** A tilt of the camera about its line of sight (a gruesome kill's impact), on the wall clock. */
  private cameraRoll: { start: number; end: number; amp: number } | null = null;
  /**
   * The board darkened around a gruesome kill, on board time: how lit each unit
   * stays (1 fully, 0 not at all; units not listed darken fully).
   */
  private spotlight: { lit: Map<string, number>; start: number; end: number } | null = null;
  /** The impact frame of a gruesome kill, until this time on screen: its victim white, all else dark. */
  private silhouette: { until: number; victim: string; killer: string | null } | null = null;
  private readonly ambient = new THREE.HemisphereLight(0xeef2ff, 0x5a5448, AMBIENT_LIGHT);
  private readonly keyLight = new THREE.DirectionalLight(0xffffff, KEY_LIGHT);
  /** Darkens the edges of the view while a gruesome kill plays. */
  private readonly vignette: HTMLElement;
  /** Deferred animation steps, run once board time reaches `at` (ms). */
  private readonly timeline: { at: number; fn: () => void }[] = [];
  /** Board time (ms) since the view was created; drives all animation. */
  private now = 0;
  /** When the current batch of combat animations finishes. */
  private busyUntil = 0;
  /** Until this board time, what is playing can't be skipped (a zone being scored). */
  private noSkipUntil = 0;
  /** The glow over the zone being scored, on board time. */
  private zoneGlow: { mesh: THREE.InstancedMesh; start: number; end: number } | null = null;
  /**
   * Move the camera to the action before playing it: off-screen activations and
   * moves are panned to (see {@link planPan}), and — in `cinematic` — every blow
   * is framed on its two combatants (see {@link frameCombat}). The animations
   * wait for the camera.
   */
  cameraMode: CameraMode = 'cinematic';
  /** A camera move in progress: the orbit pivot glides while the view distance and heading ease. */
  private cam: {
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromDist: number;
    toDist: number;
    fromYaw: number;
    toYaw: number;
    start: number;
    dur: number;
    /** Constant speed (a tracked projectile) rather than eased ends. */
    linear?: boolean;
  } | null = null;
  /**
   * Where the camera will stand once every move scheduled in this batch has run.
   * Each move is planned from here, not from where the camera happens to be now.
   */
  private planned: View | null = null;
  /**
   * The framing the player last set by hand; given back whenever they can act
   * again (its heading only when a fight turned the camera well away from it).
   */
  private playerView: View | null = null;
  /** Where the camera stood, and the scripted move it was making, when the press now held on it began. */
  private press: { view: View; pos: THREE.Vector3; move: BoardView['cam']; at: number } | null = null;
  /** Whether the player could act at the last update, to spot the moment they can again. */
  private wasInteractive = false;
  /** Whether the other side has activated a unit since the player could last act (see the "your turn" sound). */
  private opponentActed = false;
  /** The selection the camera has already answered, so a pick is panned to once. */
  private pannedTo: string | null = null;
  /** The selection that last flashed, so a pick flashes once per time it is made. */
  private flashedPick: string | null = null;
  /** The last unit picked on this screen, so committing its dice doesn't flash it a second time. */
  private ownPick: string | null = null;
  /** The distance of the opening shot (see {@link positionCamera}); combat never pulls further out than this. */
  private homeDist = 0;
  /**
   * How far the cutouts lean back (top away from the camera, radians): the
   * camera's angle above the table, followed every frame, so they sit square
   * to the screen rather than foreshortened however the player tips the view.
   */
  private spriteLean = 0;
  /**
   * The opening shot and the units it was fitted to, while it still stands: a
   * canvas that changes shape re-fits it (see {@link refitOpening}), until the
   * player moves the camera or the first blow plays.
   */
  private opening: { points: THREE.Vector3[]; head: number; target: THREE.Vector3; dist: number } | null = null;
  /** Dev aid: `?spar=2` opens every melee with that many rounds of blocked blows (see {@link spar}). */
  private readonly sparRounds = (() => {
    const spar = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('spar') : null;
    return spar === null ? null : Math.max(0, Math.floor(Number(spar)) || 0);
  })();
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
  /** Board tile and feature chunks, raycast for cell picking (`userData.cells` maps each triangle to its cell). */
  private readonly tiles: THREE.Mesh[] = [];
  private board: BoardData | null = null;
  /** The shader on the board's lava tops, its frame set each frame (null with no board built). */
  private lavaSurface: LavaSurface | null = null;
  /** Embers rising off the board's lava (null with no lava on it). */
  private lavaEmbers: LavaEmbers | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;
  private downPos: { x: number; y: number } | null = null;
  /** The WASD keys held down (by `code`, so the keys sit in the same place on any layout). */
  private readonly panKeys = new Set<keyof typeof KEY_PAN_CODES>();
  /** The WASD pan's current velocity over the ground, in world units per second (x right, y forward on screen). */
  private readonly panVel = new THREE.Vector2();
  /** A WASD pan is steering the camera (keys held, or still gliding to a stop). */
  private keyPanning = false;
  private hoverKey: string | null = null;
  /** The unit figure under the pointer, so a clickable one can answer it. */
  private hoverUnitId: string | null = null;
  /** What a click can act on right now (see {@link pickTarget}): target units, and reachable hexes by `x,y`. */
  private clickableUnits = new Set<string>();
  private clickableCells = new Set<string>();
  private pickThrough = false;
  private interactive = false;
  private readonly ringGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 40);
  private readonly dashedRingGeo = dashedRing();
  private clock = new THREE.Clock();
  /** The sky and ground around the table (see {@link setBackdrop}). */
  private backdrop = new Backdrop(DEFAULT_BACKDROP, HEX_COL_STEP, HEX_ROW_STEP, TILE_BOTTOM);

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.add(this.backdrop.group);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

    this.keyLight.position.set(6, 14, 8);
    this.scene.add(
      this.ambient,
      this.keyLight,
      this.overlayGroup,
      this.highlightGroup,
      this.previewGroup,
      this.routeGroup,
      this.markerGroup,
      this.effects.group,
    );

    // Left-drag orbits (around the table, and up and down over it), right-drag
    // (or shift/ctrl + left) or WASD pans across it, wheel zooms. A press that barely moves is still a click (see handlePointerUp).
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false; // pan along the ground, not the view plane
    this.controls.minPolarAngle = CAMERA_MIN_POLAR;
    this.controls.maxPolarAngle = CAMERA_MAX_POLAR;
    this.controls.zoomToCursor = true;
    // A hand on the camera takes it back: drop the scripted move, and adopt the
    // framing the player leaves it in as theirs. A press that never moved the
    // camera is only a click on the board, though: adopting where it found the
    // camera would make a close-up (or the glide back out of one) the framing
    // the next close-up moves in from, and fight after fight would ratchet in.
    // So a click changes nothing, and the move it interrupted carries on.
    this.controls.addEventListener('start', () => {
      this.press ??= { view: this.currentView(), pos: this.camera.position.clone(), move: this.cam, at: this.now };
      this.cam = null;
      this.planned = null;
      this.opening = null;
    });
    this.controls.addEventListener('end', () => {
      const press = this.press;
      this.press = null;
      if (!press) return this.rememberPlayerView();
      const slack = press.view.dist * HAND_MOVE_SLACK;
      // A click's jitter can turn or slide the camera a hair but never zooms it, so any zoom (a wheel notch) counts.
      const moved =
        Math.abs(this.currentView().dist - press.view.dist) > press.view.dist * 1e-3 ||
        this.camera.position.distanceTo(press.pos) > slack ||
        this.controls.target.distanceTo(press.view.target) > slack;
      if (moved) return this.rememberPlayerView();
      if (press.move && !this.cam) this.cam = { ...press.move, start: press.move.start + this.now - press.at };
    });

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.handlePointerLeave);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);

    // Under the dice and verdicts, so they stay bright while the board darkens.
    this.vignette = document.createElement('div');
    this.vignette.className = 'board-vignette';
    this.container.appendChild(this.vignette);
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
  /** The seat whose side of the table an upright (portrait) opening shot stands behind. */
  homeSeat: Owner = 0;

  buildBoard(state: GameState): void {
    const resized = state.board.width !== this.width || state.board.height !== this.height;
    this.clearBoard();
    this.board = state.board;
    this.width = state.board.width;
    this.height = state.board.height;
    const blocked = new Set(state.board.blocked);

    // Seamless flat-top hexes, a vertex on ±X (the columns) and a flat edge on ±Z
    // (the rows), each top ringed by a darker rim so the grid still reads. A top
    // only needs a wall where it drops to a lower neighbour or off the board, and
    // only as tall as that drop: the rest would be hidden against its neighbours.
    const board = state.board;
    const isLava = (v: Vec) => isDeadlyFeature(board.terrain?.[vecKey(v)]?.feature);
    const topOf = (v: Vec) =>
      surfaceY(hexElevation(board, v)) + (blocked.has(vecKey(v)) ? BLOCKED_RISE : 0) - (isLava(v) ? LAVA_SINK : 0);
    const up = new THREE.Vector3(0, 1, 0);
    const corner = (c: { x: number; z: number }, i: number, r: number, y: number) =>
      new THREE.Vector3(c.x + r * Math.cos((i * Math.PI) / 3), y, c.z + r * Math.sin((i * Math.PI) / 3));
    const chunks = new BoardChunks(CHUNK_CELLS);
    // Lava tops go in their own chunks under the lava shader, which reads each
    // vertex's red channel as its heat (see lava.ts).
    const lavaChunks = new BoardChunks(CHUNK_CELLS);
    const embers: Ember[] = [];
    // Edge i runs from corner i to i + 1 and faces the neighbour at its midpoint's angle.
    const outs = [0, 1, 2, 3, 4, 5].map((i) => new THREE.Vector3(Math.cos(((i + 0.5) * Math.PI) / 3), 0, Math.sin(((i + 0.5) * Math.PI) / 3)));
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = { x, y };
        const isBlocked = blocked.has(vecKey(cell));
        const lava = isLava(cell);
        const elev = hexElevation(board, cell);
        const topColor = isBlocked ? BLOCKED_COLOR : tileTopColor(cell, elev);
        const sideColor = isBlocked ? topColor : tileSideColor(cell, elev);
        const rimColor = tileRimColor(topColor);
        const c = this.cellToWorld(cell);
        const top = topOf(cell);
        const centre = new THREE.Vector3(c.x, top, c.z);
        // The neighbour across each edge (null off the board).
        const across = outs.map((out) => this.worldToCell(new THREE.Vector3(c.x + HEX_STEP * out.x, 0, c.z + HEX_STEP * out.z)));
        // A lava corner runs hot only if every hex meeting at it is lava, so a
        // pool reads as one flow and crusts over only along its banks.
        const bank = across.map((n) => !n || !isLava(n));
        const heat = (i: number) => (bank[(i + 5) % 6] || bank[i % 6] ? 0x000000 : 0xffffff);
        const hot = 0xffffff;
        for (let i = 0; i < 6; i++) {
          // Corners i and i + 1 run counter-clockwise seen from above, so each
          // triangle lists them in the opposite order to face up.
          const outer0 = corner(c, i, HEX_SIZE, top);
          const outer1 = corner(c, i + 1, HEX_SIZE, top);
          if (lava) {
            const pool0 = corner(c, i, HEX_SIZE * LAVA_POOL, top);
            const pool1 = corner(c, i + 1, HEX_SIZE * LAVA_POOL, top);
            lavaChunks.triangle(cell, centre, pool1, pool0, up, hot);
            lavaChunks.triangle(cell, pool0, outer1, outer0, up, [hot, heat(i + 1), heat(i)]);
            lavaChunks.triangle(cell, pool0, pool1, outer1, up, [hot, hot, heat(i + 1)]);
          } else {
            const inner0 = corner(c, i, HEX_SIZE * TILE_RIM_START, top);
            const inner1 = corner(c, i + 1, HEX_SIZE * TILE_RIM_START, top);
            chunks.triangle(cell, centre, inner1, inner0, up, topColor);
            chunks.triangle(cell, inner0, outer1, outer0, up, rimColor);
            chunks.triangle(cell, inner0, inner1, outer1, up, rimColor);
          }

          const beyond = across[i];
          const floor = beyond ? topOf(beyond) : TILE_BOTTOM;
          if (floor >= top - 1e-6) continue;
          const low0 = outer0.clone().setY(floor);
          const low1 = outer1.clone().setY(floor);
          // A wall dropping into lava glows at its foot.
          const foot = beyond && isLava(beyond) ? LAVA_WALL_GLOW : sideColor;
          chunks.triangle(cell, outer0, low1, low0, outs[i]!, [sideColor, foot, foot]);
          chunks.triangle(cell, outer0, outer1, low1, outs[i]!, [sideColor, sideColor, foot]);
        }
        if (lava) {
          for (let k = 0; k < LAVA_EMBERS; k++) {
            const ang = cellNoise(cell, 110 + k) * Math.PI * 2;
            const dist = 0.6 * HEX_SIZE * Math.sqrt(cellNoise(cell, 120 + k));
            embers.push({
              at: new THREE.Vector3(c.x + Math.cos(ang) * dist, top, c.z + Math.sin(ang) * dist),
              seed: [cellNoise(cell, 130 + k), cellNoise(cell, 140 + k), cellNoise(cell, 150 + k)],
            });
          }
        }
      }
    }
    this.addChunks(chunks, new THREE.MeshStandardMaterial({ vertexColors: true }));
    this.lavaSurface = new LavaSurface(HEX_COL_STEP, HEX_ROW_STEP);
    this.addChunks(lavaChunks, this.lavaSurface.material);
    if (embers.length > 0) {
      this.lavaEmbers = new LavaEmbers(embers, lavaPixel(HEX_COL_STEP));
      this.lavaEmbers.scale = this.particleScale();
      this.scene.add(this.lavaEmbers.points);
    }

    this.buildFeatures(board);
    this.placeBackdrop();
    if (resized) this.positionCamera(state);
  }

  /** Stand the board in another backdrop. */
  setBackdrop(kind: BackdropKind): void {
    if (kind === this.backdrop.kind) return;
    this.scene.remove(this.backdrop.group);
    this.backdrop.dispose();
    this.backdrop = new Backdrop(kind, HEX_COL_STEP, HEX_ROW_STEP, TILE_BOTTOM);
    this.scene.add(this.backdrop.group);
    this.placeBackdrop();
  }

  /** Tell the backdrop where the board lies, so its ground can meet the board's edge and grid. */
  private placeBackdrop(): void {
    if (!this.board) return;
    const first = this.cellToWorld({ x: 0, y: 0 });
    const last = this.cellToWorld({ x: this.width - 1, y: this.height - 1 });
    this.backdrop.setBoard(
      { x: (first.x + last.x) / 2, z: (first.z + last.z) / 2 + HEX_ROW_STEP / 4 },
      { x: (last.x - first.x) / 2 + HEX_SIZE, z: (last.z - first.z) / 2 + HEX_ROW_STEP * 0.75 },
      first,
    );
  }

  /** Add a board's merged chunks to the scene and to the pickable tiles (see {@link pickCell}). */
  private addChunks(chunks: BoardChunks, material: THREE.Material, feature = false): void {
    for (const mesh of chunks.meshes(material)) {
      mesh.userData.feature = feature;
      this.tiles.push(mesh);
      this.scene.add(mesh);
    }
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
    this.lavaSurface = null;
    if (this.lavaEmbers) {
      this.scene.remove(this.lavaEmbers.points);
      this.lavaEmbers.dispose();
      this.lavaEmbers = null;
    }
  }

  /** Low-poly rocks, buildings and trees; pickable as the hex they stand on. */
  private buildFeatures(board: BoardData): void {
    // Non-indexed, so every triangle keeps its own vertices and flat shading holds.
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const coneGeo = new THREE.ConeGeometry(1, 1, 7).toNonIndexed();
    const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 5).toNonIndexed();
    const up = new THREE.Vector3(0, 1, 0);
    const chunks = new BoardChunks(CHUNK_CELLS);
    for (const p of featureLayout(board, (v) => this.cellToWorld(v), HEX_SIZE)) {
      const [geometry, scale, rotY] =
        p.kind === 'rock'
          ? [rockGeo, new THREE.Vector3(p.radius, p.radius * p.squash, p.radius), p.rotY]
          : p.kind === 'box'
            ? [boxGeo, new THREE.Vector3(p.w, p.h, p.d), p.rotY]
            : [p.kind === 'cone' ? coneGeo : trunkGeo, new THREE.Vector3(p.radius, p.h, p.radius), 0];
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion().setFromAxisAngle(up, rotY),
        scale,
      );
      chunks.geometry(p.cell, geometry, matrix, p.color);
    }
    this.addChunks(chunks, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }), true);
    for (const g of [rockGeo, boxGeo, coneGeo, trunkGeo]) g.dispose();
  }

  /** Reconcile unit meshes and highlights with the given view model. */
  update(vm: BoardViewModel): void {
    const { state } = vm;
    this.localSeats = vm.localSeats ?? null;

    // Sync unit meshes (create/move/kill).
    const seen = new Set<string>();
    for (const u of state.units) {
      seen.add(u.id);
      let obj = this.units.get(u.id);
      // A unit whose look changed (an online host's stand-in opponent replaced
      // by the real army), or whose size or flight the dev sandbox rewrote, is
      // rebuilt with its new sprite.
      if (
        obj &&
        (obj.spriteName !== spriteFor(u.look ?? u.name) ||
          obj.tint !== u.tint ||
          obj.size !== (u.traits.big ? BIG_SCALE : 1) ||
          obj.flying !== u.traits.flying)
      ) {
        this.scene.remove(obj.group);
        this.units.delete(u.id);
        obj = undefined;
      }
      if (!obj) {
        obj = this.createUnit(u.id, u.owner, u.look ?? u.name, u.tint, u.traits.big, u.traits.flying);
        this.units.set(u.id, obj);
        obj.group.position.copy(this.unitWorld(u.pos));
      }
      obj.targetPos = this.unitWorld(u.pos);
      // One that changed sides keeps its mini, and its old colours until its defection plays.
      obj.turnTo = obj.owner !== u.owner ? u.owner : null;
      obj.traits = u.traits;
      obj.name = u.name;
      obj.state = { dead: u.dead, knocked: u.knockedDown, guarding: u.guarding && !u.dead };
      obj.grounded = u.traits.flying && !airborne(state, u);
      obj.spent = vm.spentUnitIds?.includes(u.id) ?? false;

      const isActive = state.activeUnitId === u.id;
      const isSelected = vm.selectedUnitId === u.id;
      const isSelectable = vm.selectableUnitIds.includes(u.id);
      const isAttackTarget = vm.attackTargetIds.includes(u.id);
      // Reachable on foot, then strikeable: the same red, held back, so "walk in
      // and hit this" is distinguishable from "hit this now" without a new colour.
      const isApproachTarget = !isAttackTarget && vm.approachTargetIds.includes(u.id);
      const isGuarding = u.guarding && !u.dead;
      const isShot = vm.shootTargetIds?.includes(u.id) ?? false;
      const isFocused = vm.focusUnitIds?.includes(u.id) ?? false;
      obj.cue = isFocused
        ? { color: FOCUS_COLOR, period: 0, far: false }
        : isAttackTarget || isApproachTarget
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
        this.effects.unmark(id);
        this.units.delete(id);
      }
    }

    this.drawHighlights(vm.reach);
    if (vm.overlays !== this.overlays) this.drawOverlays(vm.overlays ?? []);
    if (vm.markingsKey !== this.markingsKey) this.drawMarkings(vm);
    this.interactive = vm.interactive;
    this.pickThrough = vm.pickThrough ?? false;
    this.clickableUnits = new Set([...vm.selectableUnitIds, ...vm.attackTargetIds, ...vm.approachTargetIds]);
    this.clickableCells = new Set(vm.reach.map((t) => `${t.cell.x},${t.cell.y}`));
    this.renderer.domElement.style.cursor = vm.interactive ? 'pointer' : 'default';

    // The moment the player can act again, give them back the view they set.
    if (vm.interactive && !this.wasInteractive) {
      this.returnToPlayerView();
      // Against the AI or online, say so when play has come back from the other side.
      if (this.opponentActed && this.localSeats?.length === 1) this.sound('your-turn');
      this.opponentActed = false;
    }
    this.wasInteractive = vm.interactive;
    this.panToSelected(vm.selectedUnitId);
    if (vm.selectedUnitId !== this.flashedPick) {
      this.flashedPick = vm.selectedUnitId;
      if (vm.selectedUnitId) {
        this.ownPick = vm.selectedUnitId;
        this.flashPick(vm.selectedUnitId);
      }
    }
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
    let pair: [string, string] | null = null; // the two sides of the latest blow
    let gruesome = false; // whether the latest blow was a gruesome kill
    let ranged = false; // whether the latest blow was a shot
    let aftermath = t; // when the latest gruesome kill's aftermath (its killer's triumph) is over
    const dreaded = new Set<string>(); // friends shaken by a gruesome kill in this batch, who flee in slow motion
    let fleeSlowed = false; // whether the first of them to run has slowed time yet
    const toughSaved = new Set<string>(); // units whose killing blow Tough turned into a knockdown
    let reassembling = false; // whether this batch's Reassembling stand-ups are already laid out
    const landing = new Map<string, number>(); // when the latest blow's shove sets each unit down
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
          // The first friend to break from a gruesome kill runs in slow motion, trailing dread.
          if (e.type === 'UnitFled' && dreaded.has(e.unitId)) {
            if (!fleeSlowed) this.at(t, () => this.slowMotion(FLEE_SLOW_MS, FLEE_SLOW_SCALE));
            fleeSlowed = true;
            this.at(t, () => {
              obj.glow = { color: FEAR_WALL_COLOR, start: this.now, end: this.now + GLOW_MS };
            });
          }
          const cells = e.path ?? this.walkCells(e.from, e.to);
          // An opponent's route shows first, so the eye knows where it is headed.
          if (e.type === 'UnitMoved' && this.localSeats?.includes(obj.owner) !== true) {
            const start = this.now + t + ROUTE_LEAD_MS;
            this.at(t, () => this.traceRoute(obj.owner, cells, start));
            t += ROUTE_LEAD_MS;
          }
          // A Slippery unit ducks out of contact, and no one gets a hack at it.
          const hacked = events.slice(0, i).some((x) => x.type === 'FreeHackResolved' && x.targetId === e.unitId);
          if (obj.traits?.slippery && !hacked) this.at(t, () => this.slipFx(obj));
          // Walk hex by hex at a steady pace, so a longer move takes proportionally longer.
          const path = cells.map((c) => this.unitWorld(c));
          const dur = (path.length - 1) * WALK_MS_PER_HEX;
          // A runner bolting off-screen takes the camera with it.
          if (e.type === 'UnitFled') t += this.followRun(obj, path, t, dur);
          if (e.type === 'UnitFled') this.at(t, () => this.sound('flee'));
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
        // A new activation starts on a clean screen: the last fight's cards and verdict go.
        this.at(t, () => {
          this.rolls.retireFight();
          this.sound('select');
        });
        // The opponent's pick is news to whoever is watching; the player's own already flashed when they made it.
        // A group lights up together, so it is plain who shares the roll.
        const picked = e.group ?? [e.unitId];
        if (this.localSeats?.includes(e.player) === false) this.opponentActed = true;
        const news = !picked.includes(this.ownPick ?? '');
        for (const id of picked) if (id !== this.ownPick) this.at(t, () => (news ? this.markOpponentPick(id) : this.flashPick(id)));
        this.ownPick = null;
        for (const id of e.group ?? [e.unitId]) if (this.units.get(id)?.traits?.dumb) this.at(t, () => this.dumbFx(id));
        if (obj?.anims.leading) this.at(t, () => obj.animator.play(obj.anims.leading));
        // Hold the dice until the pick has registered.
        if (news) t += OPPONENT_PICK_MS;
      } else if (e.type === 'GroupMemberActivated') {
        // The next member of a group steps up once the last one's doings have shown.
        t = Math.max(t, settle);
        this.at(t, () => this.flashPick(e.unitId));
      } else if (e.type === 'DiceRolled') {
        const chosen = events.slice(0, i).find((x) => x.type === 'ActivationChosen' && x.unitId === e.unitId);
        const roll = describeActivation(e, after, chosen?.type === 'ActivationChosen' ? chosen.group?.length : 0);
        const start = t;
        const resolve = start + activationResolveMs(roll.dice.length);
        const end = start + activationRollMs(roll.dice.length);
        this.at(start, () => {
          this.rolls.addActivation(roll, this.now, end - start + ROLL_LINGER_MS);
          this.sound('dice-roll');
        });
        e.dice.forEach((die, k) =>
          this.at(resolve + k * DIE_SOUND_GAP_MS, () => this.sound(die >= e.quality || (k === 0 && e.inspired) ? 'die-success' : 'die-fail')),
        );
        if (roll.verdict) {
          const verdict = roll.verdict;
          this.at(resolve, () => this.rolls.addVerdict(verdict, this.now));
        }
        settle = resolve;
        t = end;
      } else if (e.type === 'UnitStoodUp' && e.reassembled) {
        // The round's free stand-ups play as one beat of their own, on the first.
        if (reassembling) return;
        reassembling = true;
        const ids = [e.unitId, ...after.flatMap((x) => (x.type === 'UnitStoodUp' && x.reassembled ? [x.unitId] : []))];
        t = this.reassemble(ids, Math.max(t, settle), hold);
        lastHit = settle = t;
      } else if (e.type === 'UnitStoodUp') {
        hold(e.unitId, settle);
        this.at(settle, () => this.sound('stand-up'));
      } else if (
        e.type === 'AttackResolved' ||
        e.type === 'ShotResolved' ||
        e.type === 'GuardRiposte' ||
        e.type === 'FreeHackResolved'
      ) {
        const roll = describeCombat(e, after);
        pair = e.type === 'GuardRiposte' ? [e.guardId, e.attackerId] : [e.attackerId, e.targetId];
        gruesome = e.gruesome === true;
        ranged = e.type === 'ShotResolved';
        landing.clear();
        // A gruesome kill is known before it plays: build up to it.
        const kill = killOf(e, pair, after);
        const dread = gruesome ? kill : null;
        // A blow plays in three beats: frame the pair, show their dice, then
        // strike while the cards are still up in the corners.
        t += this.pause(this.frameCombat(pair, t, dread ? 'gruesome' : kill ? 'kill' : null));
        const start = t;
        const windup = dread ? WINDUP_MS : 0;
        const cards = OPPOSED_ROLL_MS; // the cards show their outcome at once; a beat to read it
        // Whoever pair[0] is — attacker, shooter, hacker, riposting guard — the
        // blow only reaches pair[1] on a defender-side result. Anything else is
        // a miss, a getaway, a clash, or a parry the guard didn't land, and
        // must not flash the other unit as though it had connected.
        // A blow an Armored loser turned aside still connects — the armor, not a
        // parry, is what stops it (the ArmorHeld that follows plays the flare).
        const armored = after[0]?.type === 'ArmorHeld' ? after[0].unitId : undefined;
        // A free hack its target slips is turned aside too: the leaver gets away unhurt.
        const slipped = e.type === 'FreeHackResolved' && e.result === 'defenderRecoiled';
        const land = (e.result.startsWith('defender') && !slipped) || armored === pair[1];
        // Melee the defender answers plays as an exchange, so the swing goes in
        // and is turned aside before the answer comes back — landing when the
        // attacker lost the roll, turned aside in its turn when they clashed.
        const cover = e.type === 'ShotResolved' && (e.coverPenalty ?? 0) > 0;
        // A riposte or free hack tied by a master on the receiving end plays as
        // an exchange too: the swing is turned aside and the master's answer kills.
        const mastered = e.type !== 'AttackResolved' && after[0]?.type === 'MasteryStruck' && after[0].unitId === pair[1];
        // The killing blow (the last one, in an exchange) hangs at its peak before it lands.
        // A melee blow that puts its loser on the ground (and does no more) is the heavy one.
        const floored = ranged ? undefined : pair.find((id) => flooredBy(id, after));
        // So is an ordinary melee kill that leaves the body where it stood.
        const slain = kill && !dread && !ranged && fallsWhereItStood(kill.victim, after) ? kill.victim : undefined;
        // Now and then the two trade blocked blows first, and the fight is settled straight off the last of them.
        const sparring = e.type === 'AttackResolved' || e.type === 'GuardRiposte';
        const go = sparring ? this.spar(pair[0], pair[1], start + cards) : start + cards;
        const s: { hit: number; end: number; loosed?: number } = mastered
          ? this.exchange(pair[0], pair[1], go, { land: true, windup, heavy: slain === pair[0], lethal: true })
          : e.type === 'AttackResolved' && armored !== pair[1] && this.answered(e)
            ? this.exchange(pair[0], pair[1], go, {
                land: e.result.startsWith('attacker') || armored === pair[0],
                windup,
                heavy: floored === pair[0] || slain === pair[0],
                lethal: slain === pair[0],
              })
            : this.strike(pair[0], pair[1], ranged ? 'ranged' : 'melee', go, {
                land,
                cover,
                windup,
                heavy: land && (floored === pair[1] || slain === pair[1]),
                lethal: slain === pair[1],
              });
        // The camera and the dread close in on the blow that settles it, not on the sparring before.
        const closing = go - cards;
        if (dread) {
          aftermath = this.dreadPlay(dread, closing, s.hit, ranged ? s.loosed : undefined);
          for (const id of dread.shaken) dreaded.add(id);
        } else if (kill) {
          this.closeIn(kill.victim, closing, s.hit, KILL_DOLLY, KILL_PUSH_IN);
        } else if (floored) {
          this.closeIn(floored, closing, s.hit, DOWN_DOLLY, DOWN_PUSH_IN);
        }
        const [first, second] = pair;
        // The traits that swung the roll show as the first swing starts.
        const riposte = e.type === 'GuardRiposte';
        const pincer = riposte ? e.guardPincer : e.type !== 'ShotResolved' ? e.attackPincer : 0;
        const woods = riposte ? [e.guardWoodwise, e.attackerWoodwise] : [e.attackWoodwise, e.defenseWoodwise];
        const melee = e.type !== 'ShotResolved';
        this.at(start + cards, () => {
          if (pincer) this.pincerFx(first, second);
          if (e.type === 'AttackResolved' && e.defenseShieldwall) this.shieldwallFx(second, first);
          if (e.type === 'AttackResolved' && e.attackRusher) this.rushFx(first, second);
          if (woods[0]) this.woodwiseFx(first);
          if (woods[1]) this.woodwiseFx(second);
          if (melee) for (const id of [first, second]) this.whirlFx(id);
          if ((e.type === 'AttackResolved' && e.powerPenalty) || (e.type === 'ShotResolved' && e.aimPenalty)) this.sound('power-charge');
          if (e.type === 'FreeHackResolved') this.sound('free-hack');
        });
        // Two blows that both fail end in a clash; a lone swing that fails is simply blocked (see strike).
        if (e.type === 'AttackResolved' && e.result === 'clash' && !armored && this.answered(e)) {
          this.at(s.hit, () => this.clashFx(first, second));
        }
        if (e.type === 'GuardRiposte') {
          this.at(start + cards, () => this.guardFx(e.guardId));
          if (e.prevented) {
            this.at(s.hit, () => {
              this.parryFx(e.guardId, e.attackerId);
              this.sound('riposte');
            });
          }
        }
        const life = Math.max(COMBAT_CARD_LINGER_MS, s.hit - start + COMBAT_CARD_HOLD_MS);
        this.at(start, () => {
          this.rolls.addOpposed(roll, this.now, life);
        });
        // The conclusion lands along the bottom centre, between the two dice cards.
        // A long gruesome shot is called out by its length.
        const hexes = ranged && gruesome ? this.unitsShotHexes(pair[0], pair[1]) : null;
        const verdict =
          hexes !== null && hexes >= LONG_SHOT_HEXES
            ? { ...roll.verdict, detail: [roll.verdict.detail, `a ${hexes}-hex shot!`].filter(Boolean).join(' · ') }
            : roll.verdict;
        this.at(s.hit, () => this.rolls.addVerdict(verdict, this.now, 'bottom'));
        lastHit = s.hit;
        settle = s.hit;
        t = Math.max(s.end, dread ? aftermath : 0);
      } else if (e.type === 'NerveCheck') {
        // A run of checks (every nearby friend, or a whole routing warband) rolls at once.
        if (nerveAt === null) {
          const base = Math.max(lastHit, settle, aftermath) + NERVE_LEAD_MS;
          this.at(base, () => this.rolls.retireAll());
          // Widen out to hold every unit about to roll: their dice must not fall
          // outside a close-up on the two who just fought.
          const rolling = [e.unitId, ...after.filter((x) => x.type === 'NerveCheck').map((x) => x.unitId)];
          nerveAt = base + this.pause(this.frameUnits(rolling, base));
          t = Math.max(t, nerveAt);
        }
        const roll = describeNerve(e, after);
        const start = nerveAt;
        this.at(start, () => {
          this.rolls.addNerve(roll, this.now, NERVE_ROLL_MS + ROLL_LINGER_MS);
        });
        settle = start + NERVE_RESOLVE_MS;
        this.at(settle, () => this.sound(e.passed ? 'nerve-pass' : 'nerve-fail'));
        t = Math.max(t, start + NERVE_ROLL_MS);
      } else if (e.type === 'WarCry') {
        t = this.warCry(e.unitId, e.inspired, t);
        lastHit = settle = t;
      } else if (e.type === 'LeaderFallen') {
        const at = Math.max(lastHit, settle, aftermath) + NERVE_LEAD_MS;
        this.at(at, () => {
          this.rolls.addVerdict({ text: 'The Leader falls!', detail: 'friends who saw it test nerve', on: [], tone: 'kill' }, this.now);
          this.sound('leader-falls');
        });
        settle = at;
      } else if (e.type === 'WarbandBroken') {
        const at = Math.max(lastHit, settle, aftermath) + NERVE_LEAD_MS;
        this.at(at, () => {
          this.rolls.addVerdict({ text: `P${e.player}'s warband breaks!`, on: [], tone: 'kill' }, this.now);
          this.sound('warband-broken');
        });
        settle = at;
      } else if (e.type === 'ToughnessSaved') {
        toughSaved.add(e.unitId);
        this.at(lastHit, () => this.toughFx(e.unitId));
      } else if (e.type === 'ArmorHeld') {
        this.at(lastHit, () => this.armorFx(e.unitId));
      } else if (e.type === 'UnitRecoiled') {
        const obj = this.units.get(e.unitId);
        if (obj) {
          // Shoved back on the blow's hit frame, still facing its opponent: one
          // hex, or driven across two at a run by a Trample.
          const by = pair && !ranged ? this.units.get(pair[0] === e.unitId ? pair[1] : pair[0]) : undefined;
          const trampler = by?.traits?.trample ? by : null;
          const from = this.unitWorld(e.from);
          const to = this.unitWorld(e.to);
          const path = [from, to];
          if (Math.hypot(to.x - from.x, to.z - from.z) > HEX_STEP * 1.5) {
            const half = from.clone().lerp(to, 0.5);
            const mid = this.worldToCell(half);
            path.splice(1, 0, mid ? this.unitWorld(mid) : half);
          }
          const pace = trampler ? TRAMPLE_MS_PER_HEX : WALK_MS_PER_HEX;
          const dur = (path.length - 1) * pace;
          obj.walk = { path, start: this.now + lastHit, backward: true, pace };
          this.recoilFx(obj, from, to, lastHit, dur);
          if (trampler) this.trampleFx(trampler, path, lastHit, pace);
          // One the shove also floors goes down where it ends: a Bad Balance
          // unit only after rocking there a moment, fighting for its footing.
          const teeters = obj.traits?.badBalance === true && fallsAfter(e.unitId, after);
          const lands = lastHit + dur + (teeters ? TEETER_MS : 0);
          if (teeters) obj.teeter = { start: this.now + lastHit, end: this.now + lands };
          landing.set(e.unitId, lands);
          t = Math.max(t, lands);
        }
      } else if (e.type === 'UnitSupported') {
        // The friend behind braces the pushed unit on the blow's hit frame.
        this.at(lastHit, () => {
          this.rolls.addVerdict({ text: 'Supported', on: [e.supporterId], tone: 'save' }, this.now);
          this.braceFx(e.unitId, e.supporterId);
        });
      } else if (e.type === 'UnitHeldGround') {
        const by = pair ? (pair[0] === e.unitId ? pair[1] : pair[0]) : null;
        this.at(lastHit, () => {
          this.rolls.addVerdict({ text: 'Immovable', on: [e.unitId], tone: 'save' }, this.now);
          this.immovableFx(e.unitId, by);
        });
      } else if (e.type === 'UnitDefected') {
        const at = Math.max(lastHit, settle, aftermath) + NERVE_LEAD_MS;
        const obj = this.units.get(e.unitId);
        if (obj) obj.turning = true;
        this.at(at, () => {
          this.rolls.addVerdict({ text: 'Changes sides!', detail: `now fights for P${e.to}`, on: [e.unitId], tone: 'kill' }, this.now);
          this.defectFx(e.unitId, e.to);
        });
        settle = at;
        t = Math.max(t, at + DEFECT_MS + GLOW_MS / 2);
      } else if (e.type === 'UnitPushedOff') {
        // Only a push that kills slides off the table; a Tough save stays on the edge.
        const fate = after.find((x) => (x.type === 'UnitKilled' || x.type === 'ToughnessSaved') && x.unitId === e.unitId);
        const obj = this.units.get(e.unitId);
        const by = pair && this.units.get(pair[0] === e.unitId ? pair[1] : pair[0]);
        if (obj && by && fate?.type === 'UnitKilled') {
          obj.pushedOff = obj.targetPos.clone().sub(by.targetPos).setY(0).normalize();
        }
      } else if (e.type === 'UnitPushedIntoLava') {
        // Pushed into the lava hex beside it: it slides in there as it dies,
        // dropping to the lava's level when it is shoved off higher ground.
        const obj = this.units.get(e.unitId);
        if (obj) obj.intoLava = this.unitWorld(e.to).sub(obj.targetPos);
      } else if (e.type === 'UnitFellIntoLava') {
        // Knocked out of the air over lava: it drops straight into the melt beneath it.
        const obj = this.units.get(e.unitId);
        if (obj) obj.intoLava = new THREE.Vector3();
      } else if (e.type === 'UnitKnockedDown') {
        // A Tough unit freezes mid-death for a beat before it drops; one shoved
        // off its feet drops where the shove sets it down, with a thump.
        const shoved = landing.get(e.unitId);
        const at = Math.max(settle, shoved ?? 0) + (toughSaved.has(e.unitId) ? TOUGH_HITCH_MS : 0);
        hold(e.unitId, at);
        if (shoved !== undefined) this.at(shoved, () => this.thumpFx(e.unitId));
        // One that simply drops where it stands (a Tough save, a flyer brought down) still thuds.
        const dropsAt = at;
        // Struck down by the latest blow: the action catches on its impact.
        if (pair?.includes(e.unitId)) this.at(lastHit, () => this.hitStop(IMPACT_STOP_MS, [e.unitId]));
        const obj = this.units.get(e.unitId);
        // Struck down where it stands (not shoved over, nor saved from worse, nor
        // about to die of it): the blow lifts it off its feet and it slams down.
        const by = pair?.includes(e.unitId) ? this.units.get(pair[0] === e.unitId ? pair[1] : pair[0]) : undefined;
        const dies = after.some((x) => x.type === 'UnitKilled' && x.unitId === e.unitId);
        const tossed = obj && by && shoved === undefined && !toughSaved.has(e.unitId) && !dies;
        if (obj && by && tossed) {
          const land = lastHit + TOSS_MS;
          this.at(lastHit, () => this.tossUnit(obj, by));
          this.at(land, () => this.slamFx(obj));
          if (!ranged) this.at(land + 120, () => this.poiseFx(by));
          t = Math.max(t, land + TOSS_SETTLE_MS);
        } else if (obj && shoved === undefined && !dies) {
          this.at(dropsAt, () => this.sound('knockdown'));
        }
        if (obj) {
          const fall = this.deathClip(obj, 'fall');
          const down = at + (fall ? clipDuration(fall) : 200);
          this.at(tossed ? Math.max(down, lastHit + TOSS_MS + SLAM_SQUASH_MS) : down, () => this.blinkUnit(obj));
        }
      } else if (e.type === 'UnitKilled') {
        hold(e.unitId, Math.max(settle, landing.get(e.unitId) ?? 0));
        const obj = this.units.get(e.unitId);
        if (obj) {
          // A shove off the map is gruesome only when a Savage did the shoving.
          const fearful = gruesome;
          const shaken = shakenBy(after);
          const killer = pair && pair.includes(e.unitId) ? (pair[0] === e.unitId ? pair[1] : pair[0]) : null;
          const by = killer ? this.units.get(killer) : undefined;
          // A gruesome kill that leaves the body on the board hurls it away from its killer.
          if (fearful && by && !obj.pushedOff && !obj.intoLava) {
            const away = obj.targetPos.clone().sub(by.targetPos).setY(0);
            obj.thrown = away.lengthSq() > 1e-6 ? away.normalize() : null;
          }
          const shot = ranged;
          this.at(lastHit, () => this.killFx(obj, fearful, shaken, killer, shot));
          // An ordinary melee kill lifts the body off its feet as it dies: it
          // comes apart in the air or on the ground it slams into.
          if (by && !fearful && !shot && !obj.pushedOff && !obj.intoLava) {
            const land = lastHit + TOSS_MS;
            this.at(lastHit, () => this.tossUnit(obj, by));
            this.at(land, () => this.slamFx(obj));
            this.at(land + 120, () => this.poiseFx(by));
            t = Math.max(t, land + TOSS_SETTLE_MS);
          }
        }
      } else if (e.type === 'UnitRouted') {
        const obj = this.units.get(e.unitId);
        if (obj) obj.routed = true;
        hold(e.unitId, settle + 300);
        this.at(settle + 300, () => this.sound('routed'));
      } else if (
        e.type === 'FlagPickedUp' ||
        e.type === 'FlagCaptured' ||
        e.type === 'FlagReturned' ||
        e.type === 'FlagDropped'
      ) {
        // An objective decides games; show where it happened (free when already framed).
        t += this.pause(this.frameUnits([e.unitId], t));
        const sound = FLAG_SOUNDS[e.type];
        this.at(t, () => this.sound(sound));
      } else if (e.type === 'Turnover') {
        // Once the dice that caused it have each been heard.
        this.at(settle + 3 * DIE_SOUND_GAP_MS, () => this.sound('turnover'));
      } else if (e.type === 'ActivationEnded') {
        if (!events.some((x) => x.type === 'Turnover')) this.at(Math.max(t, settle), () => this.sound('end-activation'));
      } else if (e.type === 'GuardDeclared') {
        this.at(t, () => this.sound('guard-set'));
      } else if (e.type === 'MasteryStruck') {
        this.at(lastHit, () => this.sound('mastery'));
      } else if (e.type === 'ScoreChanged') {
        // A zone's point is heard as the zone is scored (see scoreZone).
        if (e.zone === undefined) this.at(Math.max(t, settle), () => this.sound('score'));
      } else if (e.type === 'RoundEnded') {
        // The marks where units fell last only for the round they fell in.
        this.at(t, () => {
          this.effects.clearMarks();
          this.clearStuckArrows();
          if (!events.some((x) => x.type === 'GameOver')) this.sound('round-start');
        });
      } else if (e.type === 'GameOver') {
        // A defeat only for someone playing one side of it: two at one screen, or a watcher, hear the winner's fanfare.
        const lost = this.localSeats?.length === 1 && !this.localSeats.includes(e.winner);
        this.at(t + 400, () => {
          this.sound(lost ? 'defeat' : 'victory');
          for (const obj of this.units.values()) {
            if (obj.owner === e.winner && !obj.state.dead) {
              obj.animator.play(obj.anims.victory ?? obj.anims.leading);
            }
          }
        });
      }
    });
    // The camera stays where the fighting left it: the next batch moves it only
    // as far as its own action needs, and the player gets their own framing back
    // once they can act (see returnToPlayerView).
    this.busyUntil = Math.max(this.busyUntil, this.now + t);
    return t;
  }

  /**
   * Show one zone being scored as a round ends: the camera goes to it, it glows
   * in the colour of whoever takes the point (pale when nobody does), and a
   * verdict over it gives the count and the reason. Returns how long (ms from
   * now) until the point counts; the verdict stays up a while longer.
   * Not skippable: it is the one moment that says where the points came from.
   */
  scoreZone(zone: ZoneScore): number {
    this.opening = null;
    let t = Math.min(MAX_QUEUE_MS, Math.max(0, this.busyUntil - this.now));
    this.planned = null;
    this.planned = this.plannedCamera();
    const points = zone.cells.map((c) => this.unitWorld(c));
    t += this.pause(this.frameZone(points, t));
    // Over the zone's far edge on screen, so the units standing in it stay in the clear.
    const anchor = (): { x: number; y: number } | null => {
      const on = points.map((p) => p.clone().setY(p.y + TILE_TOP + FOLLOW_HEAD).project(this.camera));
      if (on.length === 0 || on.some((p) => p.z > 1)) return null;
      return {
        x: ((on.reduce((sum, p) => sum + p.x, 0) / on.length + 1) / 2) * this.container.clientWidth,
        y: ((1 - Math.max(...on.map((p) => p.y))) / 2) * this.container.clientHeight,
      };
    };
    this.at(t, () => {
      if (zone.owner !== null) this.sound('score');
      this.glowZone(zone);
      this.rolls.addZoneScore(zone, this.now, ZONE_SCORE_MS, anchor);
    });
    t += ZONE_SCORE_LEAD_MS;
    this.busyUntil = Math.max(this.busyUntil, this.now + t);
    this.noSkipUntil = this.busyUntil;
    return t;
  }

  /**
   * Bring a zone into view to be scored — up close in the cinematic camera, only
   * if off screen when following. Returns the move's length.
   */
  private frameZone(points: THREE.Vector3[], at: number): number {
    if (this.cameraMode === 'off' || this.handOnCamera || points.length === 0) return 0;
    const end = this.plannedCamera();
    const centre = middle(points);
    if (this.cameraMode !== 'cinematic') {
      if (this.inView(points, end)) return 0;
      const pivot = centre.clone().setY(0);
      return this.scheduleMove(at, pivot, this.fitAround(points, pivot, end.dist, end.yaw));
    }
    const span = Math.max(...points.map((p) => p.distanceTo(centre))) * 2;
    const pivot = this.pivotFor(centre, end.yaw);
    const close = this.steadyZoom(this.closeUp(Math.max(span * ZONE_SPAN_MARGIN, ZONE_MIN_SPAN)));
    return this.scheduleMove(at, pivot, this.fitAround(points, pivot, close, end.yaw));
  }

  /** Light a zone's hexes up for as long as its verdict shows (see {@link scoreZone}). */
  private glowZone(zone: ZoneScore): void {
    this.clearZoneGlow();
    const geo = new THREE.CircleGeometry(HEX_SIZE, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: zone.owner === null ? ZONE_UNHELD_COLOR : OWNER_COLORS[zone.owner],
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const tiles = zone.cells.map((c) => (tile: THREE.Object3D) => {
      tile.rotation.set(-Math.PI / 2, 0, 0);
      const w = this.cellToWorld(c);
      tile.position.set(w.x, this.surfaceAt(c) + 0.03, w.z);
    });
    const mesh = instanced(geo, mat, tiles);
    this.scene.add(mesh);
    this.zoneGlow = { mesh, start: this.now, end: this.now + ZONE_SCORE_MS };
  }

  /** Swell the zone glow in, shimmer it, and take it away when its time is up. */
  private stepZoneGlow(): void {
    const glow = this.zoneGlow;
    if (!glow) return;
    if (this.now >= glow.end) {
      this.clearZoneGlow();
      return;
    }
    const k = (this.now - glow.start) / (glow.end - glow.start);
    const shimmer = 0.8 + 0.2 * Math.cos(k * Math.PI * 6);
    (glow.mesh.material as THREE.MeshBasicMaterial).opacity = ZONE_GLOW * Math.sin(Math.PI * k) * shimmer;
  }

  private clearZoneGlow(): void {
    const glow = this.zoneGlow;
    if (!glow) return;
    this.scene.remove(glow.mesh);
    glow.mesh.geometry.dispose();
    (glow.mesh.material as THREE.Material).dispose();
    glow.mesh.dispose();
    this.zoneGlow = null;
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
    if (this.cameraMode === 'off' || this.handOnCamera) return 0; // never fight a hand on the camera
    // Blows frame themselves (see frameCombat); this is about what leads up to them.
    const points: THREE.Vector3[] = [];
    for (const e of events) {
      if (e.type === 'ActivationChosen' || e.type === 'DiceRolled' || e.type === 'GroupMemberActivated') {
        const obj = this.units.get(e.unitId);
        if (obj && !obj.fade) points.push(obj.group.position.clone());
      } else if (e.type === 'UnitMoved') {
        if (e.path) points.push(...e.path.map((c) => this.unitWorld(c)));
        else points.push(this.unitWorld(e.from), this.unitWorld(e.to));
      }
    }
    if (points.length === 0) return 0;

    const end = this.plannedCamera();
    const ids = events.flatMap((e) =>
      e.type === 'ActivationChosen' || e.type === 'DiceRolled' || e.type === 'UnitMoved' ? [e.unitId] : [],
    );
    const head = this.headroom([...ids, ...events.flatMap((e) => (e.type === 'GroupMemberActivated' ? [e.unitId] : []))]);
    if (this.inView(points, end, head)) return 0;
    // Centre on the action, pulling back out of a close-up only as far as it takes to hold it.
    const centre = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length).setY(0);
    const dur = this.scheduleMove(at, centre, this.fitAround(points, centre, end.dist, end.yaw, head));
    if (dur > 0) this.focusUnits(ids, at);
    return dur;
  }

  /**
   * Follow a unit running `path` (world points, over `dur` ms from when it
   * sets off) when the run won't fit in view: bring it into view where it
   * breaks if it isn't, then glide alongside it to where it stops. Returns how
   * long the runner must wait for that first pan (0 when it needs none).
   */
  private followRun(obj: UnitObj, path: THREE.Vector3[], at: number, dur: number): number {
    if (this.cameraMode === 'off' || this.handOnCamera || path.length < 2) return 0;
    const view = this.plannedCamera();
    const head = this.headroom([obj.id]);
    if (this.inView(path, view, head)) return 0;
    let lead = 0;
    if (!this.inView([path[0]!], view, head)) {
      lead = this.pause(this.scheduleMove(at, this.pivotFor(this.bodyAt(obj, path[0]!), view.yaw), null));
      if (lead > 0) this.focusUnits([obj.id], at);
    }
    const goal = this.pivotFor(this.bodyAt(obj, path.at(-1)!), view.yaw);
    this.planned = { target: goal.clone(), dist: view.dist, yaw: view.yaw };
    this.at(at + lead, () => this.moveCamera(goal, null, dur, true));
    return lead;
  }

  /**
   * Keep every one of `unitIds` in view: pan to their middle and, if they don't
   * fit the current framing, pull back far enough that they do. Used where
   * several units matter at once — a run of nerve checks, an objective taken.
   */
  private frameUnits(unitIds: string[], at: number): number {
    if (this.cameraMode === 'off' || this.handOnCamera) return 0;
    const points = this.unitPoints(unitIds);
    if (points.length === 0) return 0;
    const end = this.plannedCamera();
    const head = this.headroom(unitIds);
    if (this.inView(points, end, head)) return 0;
    const pivot = this.pivotFor(this.bodyMiddle(unitIds) ?? middle(points), end.yaw);
    const dur = this.scheduleMove(at, pivot, this.fitAround(points, pivot, end.dist, end.yaw, head));
    if (dur > 0) this.focusUnits(unitIds, at);
    return dur;
  }

  /**
   * The nearest view distance, no nearer than `near`, at which every point (and
   * the dice card over it) sits comfortably in view around `target`, seen from
   * heading `yaw` — or as far out as the player could zoom when nothing nearer holds them.
   */
  private fitAround(points: THREE.Vector3[], target: THREE.Vector3, near: number, yaw: number, head = FOLLOW_HEAD): number {
    let lo = near; // may be too close
    let hi = this.controls.maxDistance;
    if (lo >= hi) return hi;
    if (this.inView(points, { target, dist: lo, yaw }, head)) return lo;
    if (!this.inView(points, { target, dist: hi, yaw }, head)) return hi;
    for (let i = 0; i < FIT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (this.inView(points, { target, dist: mid, yaw }, head)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** `dist`, unless it's so near the distance the camera will already be at that holding that one reads the same. */
  private steadyZoom(dist: number): number {
    const from = this.plannedCamera().dist;
    return Math.abs(dist - from) < from * ZOOM_STEADY ? from : dist;
  }

  /**
   * Frame a blow on its two combatants: centre them and move in close enough to
   * read the fight, so the dice cards and then the strike play out in a close-up.
   * If one would stand in front of the other, turn around them until both show.
   * One that will `kill` always moves in, and a gruesome kill is framed tighter,
   * and slower.
   * Returns how long the move takes, which the caller plays the blow after.
   */
  private frameCombat(unitIds: string[], at: number, kill: 'kill' | 'gruesome' | null = null): number {
    const dread = kill === 'gruesome';
    if (this.cameraMode !== 'cinematic' || this.handOnCamera) return 0;
    const points = this.unitPoints(unitIds);
    if (points.length === 0) return 0;

    const centre = middle(points);
    const yaw = this.separatingYaw(unitIds, this.plannedCamera().yaw);
    const pivot = this.pivotFor(this.bodyMiddle(unitIds) ?? centre, yaw);
    // Close enough to fill the view with the pair — unless the camera is nearly
    // there already, when a pan is enough. Only a kill always moves in.
    const span = Math.max(...points.map((p) => p.distanceTo(centre))) * 2;
    const close = dread
      ? this.closeUp(span * DREAD_SPAN_MARGIN, true)
      : kill
        ? this.closeUp(span * COMBAT_SPAN_MARGIN)
        : this.steadyZoom(this.closeUp(span * COMBAT_SPAN_MARGIN));
    // Both ends of a long shot stay in the frame from the start.
    const dist = this.fitAround(points, pivot, close, yaw, this.headroom(unitIds));
    const dur = this.scheduleMove(at, pivot, dist, dread ? DREAD_FRAME_SLOW : 1, yaw);
    if (dur > 0) this.focusUnits(unitIds, at);
    return dur;
  }

  /**
   * The heading nearest `yaw` from which the two units of `unitIds` don't cover
   * one another on screen, and no other unit stands in front of either: `yaw`
   * itself when they already stand clear, else the smallest turn around them
   * that clears them — side by side, or one far enough up the screen behind the
   * other. Anything but a pair keeps `yaw`.
   */
  private separatingYaw(unitIds: string[], yaw: number): number {
    const [a, b] = unitIds.map((id) => this.units.get(id));
    if (!a || !b || a.fade || b.fade || unitIds.length !== 2) return yaw;
    const pitch = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target)).phi;
    const offset = b.group.position.clone().sub(a.group.position);
    // Whether `other` and `unit` cover one another from `heading` — or, with
    // `inFront`, only whether `other` stands nearer the camera and covers `unit`.
    const overlap = (unit: UnitObj, other: UnitObj, heading: number, inFront = false): boolean => {
      // Across the screen: along the camera's right. Up it: ground further from
      // the camera rises by sin(elevation) = cos(pitch), height by sin(pitch).
      const off = other.group.position.clone().sub(unit.group.position);
      const across = off.x * Math.cos(heading) - off.z * Math.sin(heading);
      const away = -(off.x * Math.sin(heading) + off.z * Math.cos(heading));
      if (inFront && away >= 0) return false;
      const rise = off.y + this.flightHeight(other) - this.flightHeight(unit); // a flyer's feet are where it floats
      const up = away * Math.cos(pitch) + rise * Math.sin(pitch); // other's feet above unit's
      const width = (BODY_WIDTH * (unit.size + other.size)) / 2;
      return Math.abs(across) < width && up < this.bodyHeight(unit) && -up < this.bodyHeight(other);
    };
    // Bystanders matter only when they stand in front of a combatant; one behind is merely part of the scene.
    const bystanders = [...this.units.values()].filter((u) => u !== a && u !== b && !u.fade);
    const PAIR_HIDDEN = bystanders.length * 2 + 1; // the pair covering each other is worse than any number of bystanders in the way
    const hidden = (heading: number): number => {
      let n = overlap(a, b, heading) ? PAIR_HIDDEN : 0;
      for (const u of bystanders) n += Number(overlap(a, u, heading, true)) + Number(overlap(b, u, heading, true));
      return n;
    };
    let best = yaw;
    let least = hidden(yaw);
    if (least === 0) return yaw;
    for (let turn = SEPARATE_STEP; turn < Math.PI / 2; turn += SEPARATE_STEP) {
      for (const heading of [yaw + turn, yaw - turn]) {
        const n = hidden(heading);
        if (n === 0) return heading;
        if (n < least) [best, least] = [heading, n];
      }
    }
    // No heading shows both wholly: take the nearest that parts the pair with the fewest bystanders in the way.
    if (least < PAIR_HIDDEN) return best;
    // Side on parts them most; when even that won't do, it is the best there is.
    const side = Math.atan2(offset.x, offset.z) + Math.PI / 2;
    return Math.abs(turnBetween(yaw, side)) <= Math.PI / 2 ? side : side + Math.PI;
  }

  /** How tall a unit's body stands on screen: its pose's art (its base pose, unless `image` is given) from the feet up. */
  private bodyHeight(obj: UnitObj, image?: string | null): number {
    const rect = obj.atlas?.frames.get(image ?? obj.animator.base) ?? obj.atlas?.frames.get(obj.animator.base);
    return obj.atlas && rect ? (obj.atlas.anchorY - rect.top) * SPRITE_PX * obj.size : BODY_HEIGHT * obj.size;
  }

  /**
   * The camera closing on a kill whose blow starts `start` ms from now and lands
   * at `hit`: it creeps in on the pair to `dolly` of its distance, then lurches
   * in to `pushIn` of that on the victim as the blow lands.
   */
  private closeIn(victimId: string, start: number, hit: number, dolly: number, pushIn: number, loosed?: number): void {
    if (this.cameraMode !== 'cinematic' || this.handOnCamera) return;
    const held = this.plannedCamera();
    const dist = held.dist * dolly;
    const victim = this.units.get(victimId);
    // A gruesome shot: creep in until it is loosed, then slide after it toward its victim.
    const follow = victim && loosed !== undefined && loosed > start && loosed < hit;
    this.at(start, () => this.moveCamera(held.target, dist, (follow ? loosed : hit) - start, true));
    if (follow) {
      const along = this.pivotFor(this.bodyAt(victim, victim.targetPos), held.yaw).lerp(held.target, 1 - DREAD_SHOT_FOLLOW);
      this.at(loosed, () => this.moveCamera(along, dist, hit - loosed, true));
      this.planned = { ...held, target: along, dist };
    } else this.planned = { ...held, dist };
    if (!victim) return;
    // Halfway to the victim, so the killer stays in the shot.
    const view = this.plannedCamera();
    const to = this.pivotFor(this.bodyAt(victim, victim.targetPos), view.yaw).lerp(view.target, 0.5);
    this.at(hit, () => this.moveCamera(to, this.camera.position.distanceTo(this.controls.target) * pushIn, PUSH_IN_MS));
    this.planned = { ...view, target: to, dist: view.dist * pushIn };
  }

  /**
   * Lay out what surrounds a gruesome kill whose blow starts `start` ms from now
   * and lands at `hit`: the build-up (see {@link dreadFx}) while the camera
   * creeps in on the pair, a lurch in on the victim as the blow lands, then the
   * killer's triumph, played where the camera already holds it.
   * Returns when that triumph is over.
   */
  private dreadPlay(d: Kill, start: number, hit: number, loosed?: number): number {
    this.closeIn(d.victim, start, hit, DREAD_DOLLY, PUSH_IN, loosed);
    const triumph = hit + VICTORY_AT_MS;
    this.at(triumph, () => this.exult(d.killer));
    const end = triumph + VICTORY_HOLD_MS;
    this.at(start, () => this.dreadFx(d, hit - start, end - start));
    return end;
  }

  /**
   * The build-up to a gruesome kill landing in `toHit` ms: the board darkens
   * round its killer and victim (for `total` ms, through the killer's triumph),
   * a faint ring shows how far its fear will reach, and every friend inside it
   * who will have to test its nerve shivers.
   */
  private dreadFx(d: Kill,toHit: number, total: number): void {
    const lit = new Map<string, number>([
      [d.killer, 1],
      [d.victim, 1],
    ]);
    for (const id of d.shaken) lit.set(id, 0.5);
    this.spotlight = { lit, start: this.now, end: this.now + total };
    const victim = this.units.get(d.victim);
    if (victim) {
      const ground = victim.group.position.clone().setY(this.groundY(victim) + 0.03);
      this.effects.halo(ground, HALO_COLOR, MORALE_RADIUS * HEX_STEP, { life: toHit / 1000, opacity: 0.45 });
    }
    for (const id of d.shaken) {
      const friend = this.units.get(id);
      if (!friend) continue;
      for (let at = Math.random() * 120; at < toHit; at += SHIVER_MS) {
        this.at(at, () => {
          const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
          this.joltUnit(friend, camRight, 0.03, true, SHIVER_MS);
        });
      }
    }
  }

  /** A killer's triumph over a gruesome kill: its victory clip (or its rally, or a flourish of its weapon) in a glow of dread. */
  private exult(id: string): void {
    const obj = this.units.get(id);
    if (!obj || obj.state.dead || obj.fade) return;
    const clip = obj.anims.victory ?? obj.anims.leading ?? obj.anims.melee?.[0] ?? obj.anims.ranged?.[0];
    if (clip && !obj.shown.knocked) obj.animator.play(clip);
    obj.glow = { color: DREAD_COLOR, start: this.now, end: this.now + GLOW_MS };
    const ground = obj.group.position.clone().setY(this.groundY(obj) + 0.04);
    this.effects.ring(ground, DREAD_COLOR, 0.2, HEX_SIZE * 1.2, { life: 0.6, opacity: 0.7, additive: true });
  }

  /**
   * A Leader's war cry, starting `at` ms from now: frame the Leader as it rallies
   * and its shout rolls out in rings, then bring every friend it inspired into
   * view and roll the cry's wave out over the hexes it reaches, each friend
   * blinking gold as the wave gets to it, its star popping in on the last blink. Returns when the beat is over.
   */
  private warCry(leaderId: string, inspired: string[], at: number): number {
    let t = at + this.pause(this.frameUnits([leaderId], at));
    const leader = this.units.get(leaderId);
    const n = inspired.length;
    // The stars are already in the state: keep them hidden until each friend takes heart.
    const friends = inspired
      .map((id) => this.units.get(id))
      .filter((obj): obj is UnitObj => !!obj && !obj.fade);
    for (const obj of friends) obj.badgeHeld = Infinity;
    this.at(t, () => {
      if (leader?.anims.leading) leader.animator.play(leader.anims.leading);
      if (leader) this.shoutFx(leader);
      this.rolls.addVerdict(
        {
          text: 'War cry!',
          detail: n > 0 ? `${n} ${n === 1 ? 'friend' : 'friends'} inspired` : 'no one left to inspire',
          on: [leaderId],
          tone: 'save',
        },
        this.now,
      );
    });
    if (friends.length === 0) {
      // Nobody to rally, but the wave still shows how far the cry carried.
      const origin = leader ? this.worldToCell(leader.group.position) : null;
      if (origin) this.at(t, () => this.warCryWaveFx(origin));
      return t + Math.max(WAR_CRY_MS, WAR_CRY_RANGE * WAR_CRY_WAVE_STEP_MS);
    }
    t += WAR_CRY_SHOUT_MS;
    // Pull back to hold the Leader and everyone who heard it.
    t += this.pause(this.frameUnits([leaderId, ...friends.map((obj) => obj.id)], t));
    // Then the cry rolls out over the hexes it carries to, ring by ring, and
    // each friend takes heart as the wave reaches it.
    const origin = leader ? this.worldToCell(leader.group.position) : null;
    const grid = this.board ? makeHexGrid(this.board) : null;
    if (leader && origin) this.at(t, () => this.warCryWaveFx(origin));
    let end = t;
    for (const obj of friends) {
      const cell = this.worldToCell(obj.group.position);
      const rings = origin && cell && grid ? grid.distance(origin, cell) : 1;
      end = Math.max(end, this.inspireFx(obj, t + Math.max(0, rings - 1) * WAR_CRY_WAVE_STEP_MS));
    }
    return Math.max(at + WAR_CRY_MS, end + INSPIRE_HOLD_MS);
  }

  /** A war cry leaves the Leader: gold rings roll out over the ground from its feet. */
  private shoutFx(obj: UnitObj): void {
    this.flashUnit(obj.id, 0.4);
    this.sound('war-cry');
    obj.squash = { start: this.now, end: this.now + 320, amount: -0.12 };
    for (let i = 0; i < WAR_CRY_RINGS; i++) {
      this.at(i * WAR_CRY_RING_GAP_MS, () =>
        this.effects.ring(this.feet(obj), INSPIRED_GLOW, 0.3, HEX_SIZE * 4.5, {
          life: 0.9,
          opacity: 0.8 - i * 0.18,
          additive: true,
        }),
      );
    }
  }

  /**
   * A war cry's reach, lit as a wave: every hex it carries to (within
   * {@link WAR_CRY_RANGE} and in the Leader's line of sight, as the engine
   * rules it) glows gold, one ring further out every
   * {@link WAR_CRY_WAVE_STEP_MS}, each ring fainter than the last. Hexes
   * behind a rock or a wood stay dark, so the cry's shadow shows.
   */
  private warCryWaveFx(origin: Vec): void {
    if (!this.board) return;
    const grid = makeHexGrid(this.board);
    const rings: Vec[][] = Array.from({ length: WAR_CRY_RANGE }, () => []);
    for (const c of grid.cellsWithin(origin, WAR_CRY_RANGE)) {
      if (grid.lineOfSight(origin, c)) rings[grid.distance(origin, c) - 1]!.push(c);
    }
    rings.forEach((cells, i) => {
      if (cells.length === 0) return;
      const fade = 1 - i * 0.1; // each ring fainter than the last
      this.at(i * WAR_CRY_WAVE_STEP_MS, () =>
        this.flashHexes(cells, INSPIRED_GLOW, 0.16 * fade, 0.45 * fade, WAR_CRY_WAVE_HEX_MS),
      );
    });
  }

  /**
   * Light `cells` for `ms`: each glows `color` with a soft fill and a brighter
   * rim (peaking at `fill` and `rim` opacity), so it reads over any ground and
   * over the move highlights — a sharp flash, then a slower fade.
   */
  private flashHexes(cells: Vec[], color: number, fill: number, rim: number, ms: number): void {
    if (cells.length === 0) return;
    const place = cells.map((c) => (tile: THREE.Object3D) => {
      tile.rotation.set(-Math.PI / 2, 0, 0);
      const w = this.cellToWorld(c);
      tile.position.set(w.x, this.surfaceAt(c) + 0.02, w.z);
    });
    const layers = [
      { geo: new THREE.CircleGeometry(HEX_SIZE * 0.92, 6), peak: fill },
      { geo: new THREE.RingGeometry(HEX_SIZE * 0.85, HEX_SIZE * 0.94, 6), peak: rim },
    ].map(({ geo, peak }) => {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      return { mesh: instanced(geo, mat, place), geo, mat, peak };
    });
    const group = new THREE.Group();
    for (const l of layers) group.add(l.mesh);
    this.effects.add(
      group,
      ms / 1000,
      (k) => {
        const env = k < 0.12 ? k / 0.12 : (1 - k) / 0.88;
        for (const l of layers) l.mat.opacity = l.peak * env;
      },
      () => {
        for (const l of layers) {
          l.mesh.dispose();
          l.geo.dispose();
          l.mat.dispose();
        }
      },
    );
  }

  /**
   * A friend takes heart, starting `at` ms from now: it blinks gold
   * {@link INSPIRE_BLINKS} times, springing up a little on each, and its star
   * pops in on the last with a shower of sparks. Returns when the star has landed.
   */
  private inspireFx(obj: UnitObj, at: number): number {
    const blinks = INSPIRE_BLINKS * INSPIRE_BLINK_MS;
    this.at(at, () => {
      obj.glow = { color: INSPIRED_GLOW, start: this.now, end: this.now + blinks, beats: INSPIRE_BLINKS };
      this.sound('inspire');
      this.effects.ring(this.feet(obj), INSPIRED_GLOW, HEX_SIZE * 1.2, 0.3, { life: blinks / 1000, opacity: 0.7, additive: true });
    });
    for (let i = 0; i < INSPIRE_BLINKS; i++) {
      this.at(at + i * INSPIRE_BLINK_MS + INSPIRE_BLINK_MS / 2, () => {
        this.flashUnit(obj.id, 0.35);
        obj.squash = { start: this.now, end: this.now + INSPIRE_BLINK_MS * 0.8, amount: -0.08 };
      });
    }
    const landed = at + (INSPIRE_BLINKS - 1) * INSPIRE_BLINK_MS + INSPIRE_BLINK_MS / 2;
    this.at(landed, () => {
      obj.badgeHeld = 0;
      obj.badgePop = this.now;
      const star = obj.group.position.clone().setY(obj.group.position.y + TILE_TOP + BADGE_HEIGHT + obj.hover);
      this.effects.burst({
        at: star,
        count: 14,
        colors: [INSPIRED_GLOW, ...GOLD_COLORS],
        speed: [0.6, 1.6],
        up: 0.6,
        gravity: 2.5,
        drag: 2,
        life: [0.35, 0.6],
        size: [0.03, 0.06],
        shape: 'square',
        blend: 'add',
      });
    });
    return landed + BADGE_POP_MS;
  }

  /**
   * The top of a round, when Reassembling units haul themselves up: frame them
   * all, pull each one's bones back together in turn, let it climb out of its
   * down pose, then hand the player back the view they had. Starts `at` ms from
   * now; `hold` keeps a unit's shown state down until the given time. Returns
   * when the beat is over.
   */
  private reassemble(ids: string[], at: number, hold: (id: string, until: number) => void): number {
    const units = ids.map((id) => this.units.get(id)).filter((obj): obj is UnitObj => !!obj && !obj.fade);
    if (units.length === 0) return at;
    const t = at + this.pause(this.frameReassembly(ids, at));
    this.at(t, () =>
      this.rolls.addVerdict({ text: 'Reassembling', on: ids, tone: 'save' }, this.now, 'bottom'),
    );
    let end = t;
    units.forEach((obj, i) => {
      const start = t + i * REASSEMBLE_STAGGER_MS;
      this.at(start, () => this.reassembleFx(obj));
      // The shown state catches up as the bones come together: it climbs up.
      const up = start + REASSEMBLE_GATHER_MS;
      hold(obj.id, up);
      const fall = this.deathClip(obj, 'fall');
      end = Math.max(end, up + (fall ? clipDuration(fall) : 200));
    });
    return end + REASSEMBLE_HOLD_MS;
  }

  /**
   * Bring every reassembling unit into view — up close in the cinematic camera,
   * only if off screen when following. Returns the move's length.
   */
  private frameReassembly(unitIds: string[], at: number): number {
    if (this.cameraMode !== 'cinematic') return this.frameUnits(unitIds, at);
    if (this.handOnCamera) return 0;
    const points = this.unitPoints(unitIds);
    if (points.length === 0) return 0;
    const centre = middle(points);
    const span = Math.max(...points.map((p) => p.distanceTo(centre))) * 2;
    const { yaw } = this.plannedCamera();
    const pivot = this.pivotFor(this.bodyMiddle(unitIds) ?? centre, yaw);
    const close = this.steadyZoom(this.closeUp(Math.max(span * COMBAT_SPAN_MARGIN, REASSEMBLE_MIN_SPAN)));
    const dur = this.scheduleMove(at, pivot, this.fitAround(points, pivot, close, yaw, this.headroom(unitIds)));
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

  /** How high a unit floats once it has settled: a flyer's hover, unless it is grounded or down. */
  private flightHeight(obj: UnitObj): number {
    return obj.flying && !obj.grounded && !obj.shown.knocked ? FLY_HOVER : 0;
  }

  /**
   * The height above their bases that must stay in view to hold all of the given
   * units: the dice card over the tallest of them, lifted with it when it flies,
   * and the whole of a cutout that stands taller than its card.
   */
  private headroom(unitIds: string[]): number {
    const heads = unitIds
      .map((id) => this.units.get(id))
      .filter((obj): obj is UnitObj => !!obj && !obj.fade)
      .map((obj) => this.flightHeight(obj) + Math.max(FOLLOW_HEAD, BASE_HEIGHT + this.bodyHeight(obj)));
    return Math.max(FOLLOW_HEAD, ...heads);
  }

  /** Mid-body of a unit standing at `base` (its group position): what a close-up centres on, rather than its feet. */
  private bodyAt(obj: UnitObj, base: THREE.Vector3): THREE.Vector3 {
    return base.clone().setY(base.y + TILE_TOP + BASE_HEIGHT + obj.hover + FRAME_LIFT * obj.size);
  }

  /** The middle of the given units' bodies (the dying and the missing left out), or null when there are none. */
  private bodyMiddle(unitIds: string[]): THREE.Vector3 | null {
    const bodies = unitIds
      .map((id) => this.units.get(id))
      .filter((obj): obj is UnitObj => !!obj && !obj.fade)
      .map((obj) => this.bodyAt(obj, obj.group.position));
    return bodies.length > 0 ? middle(bodies) : null;
  }

  /**
   * The orbit pivot (on the ground) that puts `point` in the middle of the view:
   * the camera looks down at an angle, so it is where the line of sight through
   * `point` meets the ground, a little beyond it — seen from heading `yaw`.
   */
  private pivotFor(point: THREE.Vector3, yaw: number): THREE.Vector3 {
    const dir = this.viewDir(yaw);
    if (dir.y < 1e-3) return point.clone().setY(0);
    return point.clone().addScaledVector(dir, -point.y / dir.y).setY(0);
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
   * fight plays in. Measured from the player's own framing, not wherever the
   * last close-up left the camera, so fight after fight doesn't ratchet in:
   * never nearer than {@link COMBAT_MAX_ZOOM} of it, and never further out than
   * it. A `tight` one (a gruesome kill's) may come closer.
   */
  private closeUp(span: number, tight = false): number {
    const own = this.playerView?.dist ?? this.homeDist;
    const fit = this.fitDistance(Math.max(span, tight ? DREAD_MIN_SPAN : COMBAT_MIN_SPAN));
    const nearest = Math.max(this.controls.minDistance, own * (tight ? DREAD_MAX_ZOOM : COMBAT_MAX_ZOOM));
    return THREE.MathUtils.clamp(fit, nearest, Math.max(nearest, own));
  }

  /** The view distance at which `span` world units across the ground fill the view. */
  private fitDistance(span: number): number {
    const fov = (this.camera.fov * Math.PI) / 180;
    return span / 2 / (Math.tan(fov / 2) * Math.min(1, this.camera.aspect));
  }

  /** Where the camera will be once everything already scheduled has played out. */
  private plannedCamera(): View {
    if (this.planned) return { ...this.planned, target: this.planned.target.clone() };
    return this.cam
      ? { target: this.cam.toTarget.clone(), dist: this.cam.toDist, yaw: this.cam.toYaw }
      : this.currentView();
  }

  /** Where the camera stands right now. */
  private currentView(): View {
    const offset = this.camera.position.clone().sub(this.controls.target);
    return {
      target: this.controls.target.clone(),
      dist: offset.length(),
      yaw: new THREE.Spherical().setFromVector3(offset).theta,
    };
  }

  /** The direction from the pivot to the camera at heading `yaw`, at the angle the camera is tipped to. */
  private viewDir(yaw: number): THREE.Vector3 {
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    return new THREE.Vector3().setFromSpherical(s.set(1, s.phi, yaw));
  }

  /** Whether every point (and what stands `head` above it: a body, the dice card over it) sits comfortably inside the view. */
  private inView(points: THREE.Vector3[], from: View, head = FOLLOW_HEAD): boolean {
    const offset = this.viewDir(from.yaw).multiplyScalar(from.dist);
    const cam = this.camera.clone();
    cam.position.copy(from.target).add(offset);
    cam.lookAt(from.target);
    cam.updateMatrixWorld();
    return points.every((p) =>
      [0, head].every((h) => {
        const n = p.clone().setY(p.y + TILE_TOP + h).project(cam);
        return n.z < 1 && Math.abs(n.x) <= FOLLOW_MARGIN_X && n.y <= FOLLOW_MARGIN_TOP && n.y >= -FOLLOW_MARGIN_BOTTOM;
      }),
    );
  }

  /**
   * Schedule a camera move `at` ms from now, to `target` (the pivot, on the
   * ground), `dist` (view distance; null keeps the current one) and `yaw`
   * (heading; null keeps it too), taking `slow` times as long as usual.
   * Returns its length.
   */
  private scheduleMove(at: number, target: THREE.Vector3, dist: number | null, slow = 1, yaw: number | null = null): number {
    const from = this.plannedCamera();
    const travel = new THREE.Vector3(target.x - from.target.x, 0, target.z - from.target.z).length();
    const zoom = dist === null ? 0 : Math.abs(dist - from.dist);
    // A turn counts as the distance the camera swings through.
    const swing = yaw === null ? 0 : Math.abs(turnBetween(from.yaw, yaw)) * (dist ?? from.dist);
    // Already looking at it: no nudge, and no wait for one.
    if (travel + zoom + swing < CAMERA_STILL) return 0;
    const dur = slow * this.moveMs(travel + zoom + swing);
    this.planned = { target: new THREE.Vector3(target.x, 0, target.z), dist: dist ?? from.dist, yaw: yaw ?? from.yaw };
    this.at(at, () => this.moveCamera(target, dist, dur, false, yaw));
    return dur;
  }

  /** How long a camera move covering `length` world units (pan, zoom and swing together) takes. */
  private moveMs(length: number): number {
    return THREE.MathUtils.clamp(PAN_MIN_MS + length * PAN_MS_PER_UNIT, PAN_MIN_MS, PAN_MAX_MS);
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
    if (id === null || this.cameraMode === 'off' || this.handOnCamera) return;
    const obj = this.units.get(id);
    if (!obj || obj.fade) return;
    const point = obj.group.position.clone();
    const from = this.plannedCamera();
    const head = this.headroom([id]);
    if (this.inView([point], from, head)) return;
    // How far along the line from the pivot to the unit's own hex the pivot has
    // to slide. The unit only comes further into frame as it goes, so halve onto
    // the shortest one that works; 1 (the unit dead centre) always does.
    const flat = new THREE.Vector3(point.x, 0, point.z);
    let lo = 0; // known to leave it out of frame
    let hi = 1;
    for (let i = 0; i < SELECT_PAN_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (this.inView([point], { ...from, target: from.target.clone().lerp(flat, mid) }, head)) hi = mid;
      else lo = mid;
    }
    const target = from.target.clone().lerp(flat, Math.min(1, hi + SELECT_PAN_SLACK));
    const travel = target.distanceTo(from.target);
    if (travel < CAMERA_STILL) return;
    this.playerView = { ...from, target: target.clone() };
    this.moveCamera(target, null, this.moveMs(travel));
  }

  /**
   * Glide back to the framing the player set for themselves, if they've been
   * moved off it. A fight's turn around the table is only undone when it left
   * them looking from well off their own heading; a small one they keep.
   */
  private returnToPlayerView(): void {
    const view = this.playerView;
    if (this.cameraMode === 'off' || !view || this.handOnCamera) return;
    this.planned = null;
    const from = this.plannedCamera();
    const travel = new THREE.Vector3(view.target.x - from.target.x, 0, view.target.z - from.target.z).length();
    const zoom = Math.abs(view.dist - from.dist);
    const turn = Math.abs(turnBetween(from.yaw, view.yaw));
    const swing = turn > HEADING_RETURN ? turn * view.dist : 0;
    if (travel + zoom + swing < CAMERA_STILL) return;
    this.moveCamera(view.target, view.dist, this.moveMs(travel + zoom + swing), false, swing > 0 ? view.yaw : null);
  }

  /** Take the camera as the player has just left it; that framing is theirs to get back. */
  private rememberPlayerView(): void {
    this.playerView = this.currentView();
  }

  /**
   * Start a camera move now, from wherever the camera currently is. A null
   * `dist` keeps the current distance; a null `yaw` keeps the heading the camera
   * is already turning to.
   */
  private moveCamera(target: THREE.Vector3, dist: number | null, dur: number, linear = false, yaw: number | null = null): void {
    if (this.cameraMode === 'off' || this.handOnCamera) return;
    const from = this.currentView();
    this.cam = {
      fromTarget: from.target,
      toTarget: new THREE.Vector3(target.x, 0, target.z),
      fromDist: from.dist,
      toDist: dist ?? from.dist,
      fromYaw: from.yaw,
      // The short way round.
      toYaw: from.yaw + turnBetween(from.yaw, yaw ?? this.cam?.toYaw ?? from.yaw),
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
    const dir = this.viewDir(THREE.MathUtils.lerp(move.fromYaw, move.toYaw, eased));
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
    if (this.now < this.noSkipUntil) return false;
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
    this.effects.clear();
    this.resetTime();
    for (const obj of this.units.values()) {
      obj.holdUntil = 0;
      obj.pulse = null;
      obj.jolt = null;
      obj.teeter = null;
      obj.toss = null;
      obj.squash = null;
      obj.blink = null;
      obj.badgeHeld = 0;
      obj.badgePop = null;
      obj.facing.visible = true;
    }
    this.busyUntil = this.now;
    return true;
  }

  /** Cut short every pending animation step and dice card (a replay jump). */
  clearAnimations(): void {
    this.timeline.length = 0;
    this.cam = null;
    this.planned = null;
    this.busyUntil = this.now;
    this.noSkipUntil = 0;
    this.clearZoneGlow();
    this.rolls.clear();
    this.effects.clear();
    this.effects.clearMarks(true);
    this.clearStuckArrows();
    this.clearRoutes();
    this.resetTime();
    for (const obj of this.units.values()) {
      obj.holdUntil = 0;
      obj.pulse = null;
      obj.walk = null;
      obj.jolt = null;
      obj.teeter = null;
      obj.toss = null;
      obj.squash = null;
      obj.turning = false; // a change of sides left unplayed shows at once
      obj.glow = null;
      obj.blink = null;
      obj.badgeHeld = 0;
      obj.badgePop = null;
      obj.facing.visible = true;
      obj.mirror.rotation.z = 0;
      obj.animator.moveFor(0, { reset: true });
    }
  }

  /** Drop every hit-stop, slow motion, shake, tilt and darkening in progress. */
  private resetTime(): void {
    this.shakes = [];
    this.cameraRoll = null;
    this.freezeUntil = 0;
    this.slowMo = { start: 0, end: 0, scale: SLOW_MO_SCALE };
    this.spotlight = null;
    this.silhouette = null;
    this.impact = null;
  }

  /** Return the camera to the framing it had when the board was built. */
  resetCamera(): void {
    this.controls.reset();
  }

  /** Lean the cutouts back by the camera's angle above the table, to face it square on. */
  private followPitch(): void {
    const pitch = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target)).phi;
    this.spriteLean = Math.PI / 2 - pitch;
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
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.setPlanPreview(null);
    this.backdrop.dispose();
    this.reachFillGeo?.dispose();
    this.reachFillMat?.dispose();
    this.provokeFillMat?.dispose();
    for (const g of this.contourGeo) g?.dispose();
    for (const m of this.contourMat) m?.dispose();
    this.previewLineMat?.dispose();
    this.previewDotGeo?.dispose();
    this.previewDotMat?.dispose();
    this.clearRoutes();
    this.clearZoneGlow();
    this.routeDotGeo?.dispose();
    for (const t of this.badgeTextures.values()) t.dispose();
    this.starMaterial?.map?.dispose();
    this.starMaterial?.dispose();
    this.rolls.dispose();
    this.vignette.remove();
    this.effects.dispose();
    this.ringGeo.dispose();
    this.dashedRingGeo.dispose();
    for (const obj of this.units.values()) obj.outline.material.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // --- internals ----------------------------------------------------------

  private createUnit(id: string, owner: 0 | 1, name: string, tint: string | undefined, big = false, flying = false): UnitObj {
    const group = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(BASE_RADIUS, BASE_RADIUS, BASE_HEIGHT, 28),
      new THREE.MeshStandardMaterial({ color: OWNER_COLORS[owner], roughness: 0.6 }),
    );
    base.position.y = TILE_TOP + BASE_HEIGHT / 2;
    base.userData.unitId = id;
    base.renderOrder = BASE_ORDER;

    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.9, side: THREE.DoubleSide, forceSinglePass: true }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    ring.visible = false;

    // The cutout: one atlas cell on a quad whose origin is the frames' shared
    // anchor (the base image's feet), sized once the atlas loads. Alpha-tested,
    // not blended, so overlapping cutouts need no sorting.
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      standAtFeetWithWhiteout(new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, forceSinglePass: true })),
    );
    sprite.userData.unitId = id;
    sprite.userData.isCutout = true;
    sprite.renderOrder = CUTOUT_ORDER;
    sprite.visible = false;

    // Shares the cutout's quad (and, once loaded, its texture window); never picked.
    const outline = new THREE.Mesh(sprite.geometry, outlineMaterial(this.renderer.getPixelRatio()));
    outline.position.z = -0.002;
    outline.visible = false;
    outline.raycast = () => {};

    const mirror = new THREE.Group();
    mirror.add(outline, sprite);
    const tilt = new THREE.Group();
    tilt.rotation.x = -this.spriteLean;
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
      grounded: false,
      hover: 0,
      owner,
      name,
      spriteName,
      tint,
      group,
      facing,
      tilt,
      mirror,
      sprite,
      base,
      ring,
      badge,
      badgeOn: false,
      badgeHeld: 0,
      badgePop: null,
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
      pushedOff: null,
      thrown: null,
      intoLava: null,
      jolt: null,
      glow: null,
      blink: null,
      lunge: null,
      toss: null,
      squash: null,
      walk: null,
      teeter: null,
      traits: null,
      turnTo: null,
      turning: false,
      flash: 0,
      whiteout: 0,
      spent: false,
      spentShade: 0,
      pulse: null,
      ringRest: { visible: false, opacity: 0 },
      outline,
      cue: null,
    };

    loadSpriteAtlas(spriteName, framesOf(spriteName), owner, tint).then(
      (atlas) => {
        // Not if it has turned its coat meanwhile: that side's atlas is on its way.
        if (!this.disposed && obj.owner === owner) this.wearAtlas(obj, atlas);
      },
      (err) => console.error(err),
    );

    facing.add(stars); // follows the lunge, and the lean back
    group.add(ring, base, facing, badge);
    group.name = name;
    this.scene.add(group);
    return obj;
  }

  /** Dress a unit's cutout in `atlas`: its first, or its new side's once it has turned its coat. */
  private wearAtlas(obj: UnitObj, atlas: SpriteAtlas): void {
    const { sprite, outline } = obj;
    const first = obj.atlas === null;
    obj.atlas = atlas;
    const map = atlas.texture.clone(); // shares the uploaded image; its own UV window
    map.repeat.set(atlas.repeatU, atlas.repeatV);
    map.needsUpdate = true;
    sprite.material.map?.dispose();
    sprite.material.map = map;
    sprite.material.needsUpdate = true;
    if (first) sprite.geometry.translate(0.5 - atlas.anchorX / atlas.cellW, atlas.anchorY / atlas.cellH - 0.5, 0);
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
  }

  /**
   * Show a unit on the side the state says it has gone over to: its base takes
   * that side's colour at once, its cutout as soon as that side's art is in.
   */
  private turnCoat(obj: UnitObj): void {
    const owner = obj.turnTo;
    obj.turnTo = null;
    obj.turning = false;
    if (owner === null || owner === obj.owner) return;
    obj.owner = owner;
    loadSpriteAtlas(obj.spriteName, framesOf(obj.spriteName), owner, obj.tint).then(
      (atlas) => {
        if (!this.disposed && obj.owner === owner && this.units.get(obj.id) === obj) this.wearAtlas(obj, atlas);
      },
      (err) => console.error(err),
    );
  }

  /** Play a sound effect at the board's own pace: lower and slower in slow motion (a freeze is not a pace). */
  private sound(name: SfxName): void {
    const pace = this.timeScale();
    sfx.play(name, { rate: (pace === 0 ? 1 : Math.max(0.4, pace)) * this.animSpeed });
  }

  /** A unit's own grunt or cry, in the voice of its kind. */
  private voice(obj: UnitObj, line: VoiceLine): void {
    this.sound(`${voiceFamily(obj.spriteName)}-${line}`);
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
   * nothing connects; a shot that misses with `cover` hits the cover instead.
   * A `windup` (a gruesome kill's) holds the swing or the draw at its peak that
   * many ms longer, gathering dread, before it lets go — and is itself led up
   * to by a long gathering (see {@link forebodeFx}). A `heavy` melee blow
   * (one that floors its target) is gathered first — the striker sinks back on
   * the first frame of its swing — then driven in deep, and lands harder;
   * hardest when it is `lethal`.
   * A melee blow that doesn't land is shown blocked (see {@link blockFx}), and
   * its end comes a moment later, unless `block` is false.
   * Returns the hit and end times, relative to now.
   */
  private strike(
    attackerId: string,
    targetId: string,
    range: 'melee' | 'ranged',
    at: number,
    opts: { land?: boolean; cover?: boolean; windup?: number; heavy?: boolean; lethal?: boolean; block?: boolean } = {},
  ): { hit: number; end: number; loosed?: number } {
    const a = this.units.get(attackerId);
    const d = this.units.get(targetId);
    if (!a || !d) return { hit: at, end: at };
    const options: RangedClip[] | undefined = range === 'melee' ? a.anims.melee : a.anims.ranged;
    const picked = options?.[Math.floor(Math.random() * options.length)];
    const windup = opts.windup ?? 0;
    // The moment it lets go: the blow landing, or the missile leaving the shooter.
    const release = (c: RangedClip) =>
      (c.hitMs ?? clipDuration(c) / 2) - (range === 'ranged' ? (c.missileMs ?? 150) : 0);
    // What comes before the swing: a gruesome kill's long gathering (a shooter's
    // too, standing over its first frame), or a heavy blow's short one.
    const lead = windup > 0 ? DREAD_COIL_MS : opts.heavy && range === 'melee' ? COIL_MS : 0;
    const coil = range === 'melee' ? lead : 0;
    const peaked = picked && windup > 0 ? holdPeak(picked, release(picked), windup) : picked;
    const clip = peaked && lead > 0 ? holdPeak(peaked, 1, lead) : peaked;
    // A missile in the air longer the farther it has to go: the hit (and the
    // target's reaction to it) waits for it, while the release stays on the clip.
    // A gruesome shot stays up longer still, so its flight can be watched.
    const dreadShot = range === 'ranged' && windup > 0;
    const flight =
      range === 'ranged' && clip?.missile ? this.extraFlightMs(a, d) + (dreadShot ? DREAD_SHOT_FLIGHT_MS : 0) : 0;
    const dur = (clip ? clipDuration(clip) : 400 + windup + lead) + flight;
    const hit = (clip?.hitMs ?? (clip ? dur / 2 : 200 + windup + lead)) + flight;
    const land = opts.land ?? true;
    const ending: ShotEnding = land ? 'hit' : opts.cover ? 'cover' : 'miss';
    if (windup > 0) {
      const peak = (clip ? release(clip) : hit) - windup;
      this.at(at + Math.max(0, peak), () => this.gatherFx(a, windup));
    }
    // When a shot leaves the bow (a tracer, on its hit).
    const loosed = range === 'ranged' && clip?.missile ? Math.max(0, hit - flight - (clip.missileMs ?? 150)) : hit;
    if (dreadShot) this.dreadShot(a, d, at + loosed, at + hit);
    if (range === 'melee') {
      this.at(at + Math.max(0, hit - SWING_SOUND_LEAD_MS), () => this.sound('swing'));
    } else {
      this.at(at + loosed, () => {
        this.sound('bow-release');
        this.sound('arrow-fly');
      });
    }

    this.at(at, () => {
      const toTarget = d.group.position.clone().sub(a.group.position).setY(0);
      this.setHeading(a, toTarget.clone());
      this.setHeading(d, toTarget.clone().negate());
      a.animator.play(clip);
      this.voice(a, 'attack');
      if (windup > 0) this.forebodeFx(a, d, lead, hit);
      if (range === 'melee') {
        const dir = toTarget.normalize().multiplyScalar(LUNGE);
        a.lunge = { dir, start: this.now, hit: this.now + hit, end: this.now + dur, coil, depth: windup > 0 ? DREAD_COIL_DEPTH : 1 };
        if (coil > 0 && windup === 0) this.coilFx(a, d, coil);
      } else if (clip?.missile) {
        this.launchMissile(a, d, clip.missile, hit - flight - (clip.missileMs ?? 150), hit, ending, dreadShot);
      } else {
        this.at(hit, () => {
          const to = this.shotEnd(a, d, ending);
          this.addTracer(this.shotPoint(a), to, SHOT_COLOR);
          this.shotFx(to, ending);
        });
      }
    });
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
    if (land) {
      this.at(at + hit, () => {
        this.flashUnit(targetId, coil > 0 ? 1 : 0.8);
        if (range === 'melee') this.sound('hit');
        // A gruesome kill's impact is its own (see killFx).
        if (coil > 0 && windup === 0) this.smashFx(a, d, opts.lethal === true);
        else if (range === 'melee') this.impactFx(a, d);
      });
    }
    if (coil > 0) this.at(at + hit - DASH_MS, () => this.dashFx(a, d, windup > 0));
    if (!land && range === 'melee' && opts.block !== false) {
      this.at(at + hit, () => this.blockFx(a, d));
      return { hit: at + hit, end: at + dur + BLOCK_BEAT_MS };
    }
    return { hit: at + hit, end: at + dur, loosed: at + loosed };
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
    opts: { land?: boolean; windup?: number; heavy?: boolean; lethal?: boolean } = {},
  ): { hit: number; end: number } {
    const swing = this.strike(attackerId, targetId, 'melee', at, { land: false });
    // An answer that fails too is the clash, which has its own effect.
    // The answer comes straight off the block, not once the swing has been taken back.
    const reply = Math.min(swing.hit + BLOCK_REPLY_MS, swing.end + RIPOSTE_GAP_MS);
    const answer = this.strike(targetId, attackerId, 'melee', reply, { ...opts, block: false });
    return { hit: answer.hit, end: Math.max(answer.end, swing.end) };
  }

  /**
   * Sparring before a melee is settled, for suspense: now and then (see
   * {@link SPAR_ODDS}) the two trade a round or two of blocked blows — `firstId`
   * swings, then `secondId` — each coming straight off the block before it.
   * Only between two units on their feet. Returns when the blow that settles
   * the fight should start: `at` itself when they don't spar, else straight off
   * the last block.
   */
  private spar(firstId: string, secondId: string, at: number): number {
    const standing = [firstId, secondId].every((id) => {
      const obj = this.units.get(id);
      return obj && !obj.shown.knocked && !obj.shown.dead;
    });
    if (!standing) return at;
    const roll = Math.random();
    const rounds = this.sparRounds ?? SPAR_ODDS.filter((odds) => roll < odds).length;
    let t = at;
    for (let i = 0; i < rounds; i++) {
      const swing = this.strike(firstId, secondId, 'melee', t, { land: false });
      const answer = this.strike(secondId, firstId, 'melee', swing.hit + BLOCK_REPLY_MS, { land: false });
      t = answer.hit + BLOCK_REPLY_MS;
    }
    return t;
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

  /**
   * What sets a gruesome shot apart from a gruesome blow, from its loosing at
   * `loosed` to its landing at `hit` (both ms from now): a loud release, the
   * last of its flight in slow motion and the hexes under it lighting as it
   * passes. (A long one is called out by its length in its verdict.)
   */
  private dreadShot(a: UnitObj, d: UnitObj, loosed: number, hit: number): void {
    this.at(loosed, () => this.releaseFx(a, d));
    if (hit > loosed) {
      this.at(loosed + (hit - loosed) * DREAD_SHOT_SLOW_AT, () => this.slowMotion(DREAD_SHOT_SLOW_MS, DREAD_SHOT_SLOW_SCALE));
    }
    const from = this.worldToCell(a.targetPos);
    const to = this.worldToCell(d.targetPos);
    if (!from || !to || !this.board) return;
    // The hexes under the flight, each lit as the shot passes over it (its
    // ground track runs evenly from bow to victim).
    const span = d.targetPos.clone().sub(a.targetPos).setY(0);
    const seen = new Set<string>([vecKey(from)]);
    for (let k = 0; k <= 1.0001; k += 0.02) {
      const cell = this.worldToCell(a.targetPos.clone().addScaledVector(span, k));
      if (!cell || seen.has(vecKey(cell))) continue;
      seen.add(vecKey(cell));
      this.at(loosed + (hit - loosed) * k, () => this.flashHexes([cell], DREAD_COLOR, 0.14, 0.4, PATH_HEX_MS));
    }
  }

  /** How many hexes a shot from `shooterId` at `targetId` crosses (null when either is missing). */
  private unitsShotHexes(shooterId: string, targetId: string): number | null {
    const a = this.units.get(shooterId);
    const d = this.units.get(targetId);
    const from = a && this.worldToCell(a.targetPos);
    const to = d && this.worldToCell(d.targetPos);
    return from && to && this.board ? makeHexGrid(this.board).distance(from, to) : null;
  }

  /**
   * A gruesome shot let go: the shooter rocks back, the air bursts at the bow,
   * sparks fly after the arrow, dust kicks up at its feet and the camera punches in.
   */
  private releaseFx(a: UnitObj, d: UnitObj): void {
    const toward = d.group.position.clone().sub(a.group.position).setY(0);
    if (toward.lengthSq() < 1e-6) return;
    toward.normalize();
    this.joltUnit(a, toward.clone().negate(), 0.09, false, 280);
    const bow = this.shotPoint(a);
    this.effects.pop('hoop', bow, 0.15, 1.1, { life: 0.28, color: 0xffffff, opacity: 0.75 });
    this.effects.burst({
      at: bow,
      count: 16,
      colors: CURSE_COLORS,
      speed: [1.2, 2.6],
      dir: toward,
      cone: 0.35,
      drag: 4,
      life: [0.18, 0.35],
      size: [0.03, 0.06],
      blend: 'add',
    });
    const feet = this.feet(a);
    this.dust(feet, 8, 0.9);
    this.effects.ring(feet, 0xffffff, 0.2, HEX_SIZE * 1.1, { life: 0.35, opacity: 0.6, additive: true });
    this.shakeCamera('nudge', 0.14, 220, this.camera.getWorldDirection(new THREE.Vector3()));
  }

  /** How much longer than its clip's own flight a missile from `from` takes to reach `to`. */
  private extraFlightMs(from: UnitObj, to: UnitObj): number {
    const dist = Math.hypot(to.targetPos.x - from.targetPos.x, to.targetPos.z - from.targetPos.z);
    return Math.max(0, dist - FLIGHT_FREE) * FLIGHT_MS_PER_UNIT;
  }

  private launchMissile(
    from: UnitObj,
    to: UnitObj,
    image: string,
    startIn: number,
    hitIn: number,
    ending: ShotEnding,
    dread = false,
  ): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: projectileTexture(image), alphaTest: 0.5 }));
    sprite.scale.setScalar(72 * SPRITE_PX * 0.8);
    sprite.visible = false;
    this.scene.add(sprite);
    const start = this.shotPoint(from);
    const end = this.shotEnd(from, to, ending);
    this.missiles.push({
      sprite,
      from: start,
      to: end,
      start: this.now + Math.max(0, startIn),
      end: this.now + Math.max(1, hitIn),
      arc: shotArc(start, end, /stone|spear|pitchfork/.test(image) ? LOB_ARC : SHOT_ARC),
      ending,
      landed: false,
      trailAt: null,
      puffs: 0,
      ...(dread && ending === 'hit' ? { dread: { pierce: this.piercePoint(from, to) } } : {}),
    });
  }

  /**
   * Where a gruesome shot buries itself once through its victim: in the ground
   * most of a hex behind it, carrying on the way it flew — unless that would
   * take it through or into anyone else (or into rock, a building or off the
   * board), when it goes into the ground inside the victim's own hex instead.
   */
  private piercePoint(from: UnitObj, to: UnitObj): THREE.Vector3 {
    const dir = to.targetPos.clone().sub(from.targetPos).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const own = this.worldToCell(to.targetPos);
    const grid = this.board ? makeHexGrid(this.board) : null;
    const taken = new Set<string>();
    for (const obj of this.units.values()) {
      if (obj === to || obj.state.dead || obj.fade) continue;
      const cell = this.worldToCell(obj.targetPos);
      if (cell) taken.add(vecKey(cell));
    }
    // Every hex the arrow would cross on its way down must be clear.
    const clear = (reach: number): boolean => {
      for (let k = 0.1; k <= 1.0001; k += 0.1) {
        const cell = this.worldToCell(to.targetPos.clone().addScaledVector(dir, reach * k));
        if (!cell || !grid || !grid.inBounds(cell)) return false;
        if (own && vecEq(cell, own)) continue;
        if (taken.has(vecKey(cell)) || grid.isBlocked(cell) || isImpassableFeature(grid.feature(cell))) return false;
      }
      return true;
    };
    const reach = clear(PIERCE_REACH) ? PIERCE_REACH : PIERCE_SHORT;
    const point = to.targetPos.clone().addScaledVector(dir, reach);
    const cell = this.worldToCell(point);
    return point.setY((cell ? this.surfaceAt(cell) : to.targetPos.y + TILE_TOP) + 0.06);
  }

  /**
   * Where a shot ends: in the target's chest, in the ground just past it (a
   * miss), or low in front of it, where the cover it hid behind stands.
   */
  private shotEnd(from: UnitObj, to: UnitObj, ending: ShotEnding): THREE.Vector3 {
    const dir = to.group.position.clone().sub(from.group.position).setY(0).normalize();
    const ground = to.targetPos.y + TILE_TOP;
    if (ending === 'miss') return to.group.position.clone().addScaledVector(dir, HEX_SIZE * 0.8).setY(ground + 0.02);
    if (ending === 'cover') return to.group.position.clone().addScaledVector(dir, -HEX_SIZE * 0.55).setY(ground + 0.3);
    return this.shotPoint(to);
  }

  /**
   * Where a shot leaves a shooter, or strikes a target: the middle of its
   * art (see {@link bodyHeight}), so up with a flyer as it hovers and higher
   * on a Big one. The cutout leans back to face the camera (see
   * {@link spriteLean}), so that middle sits back along the lean, not straight
   * above its feet.
   */
  private shotPoint(obj: UnitObj): THREE.Vector3 {
    // The pose on screen now (a flyer's wings-up frame stands taller than its base pose).
    const up = this.bodyHeight(obj, obj.shownImage) / 2;
    const toCam = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
    const feet = obj.group.position.clone().add(obj.facing.position);
    return feet.addScaledVector(toCam, -up * Math.sin(this.spriteLean)).setY(feet.y + up * Math.cos(this.spriteLean));
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
    obj.targetTilt = obj.fade?.tilt ?? (state.knocked && !obj.downPose ? DOWN_LEAN : 0);
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
      obj.fade = { start: this.now, end: this.now + ROUT_MS, flee };
    } else if (obj.intoLava) {
      // Into the lava: it slides (or drops) into the melt and sinks, glowing, in
      // a spray of embers and a puff of smoke. No body is left to mark.
      const melt = obj.intoLava;
      obj.fade = { start: this.now, end: this.now + LAVA_DEATH_MS, flee: null, melt };
      const pool = obj.group.position.clone().add(melt).setY(this.groundY(obj) + melt.y - LAVA_SINK);
      this.at(LAVA_DEATH_MS * 0.25, () => this.lavaSplash(pool));
      this.at(LAVA_DEATH_MS * 0.3, () => this.releaseWisp(obj));
    } else if (obj.pushedOff) {
      // Shoved off the table: it slides over the edge, topples the way it was
      // pushed and drops out of sight, kicking up dust at the lip.
      const drop = obj.pushedOff;
      const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const tilt = drop.dot(camRight) >= 0 ? -1.2 : 1.2;
      obj.fade = { start: this.now, end: this.now + PUSH_OFF_MS, flee: null, drop, tilt };
      const lip = obj.group.position.clone().addScaledVector(drop, HEX_SIZE * 0.9).setY(this.groundY(obj));
      this.at(PUSH_OFF_MS * 0.3, () => this.dust(lip, 14, 0.9));
      this.at(PUSH_OFF_MS * 0.25, () => this.releaseWisp(obj));
      this.at(PUSH_OFF_MS, () => this.markFallen(obj));
    } else if (obj.thrown) {
      // Hurled by a gruesome kill: it flies back from its killer, turning over
      // as it goes, and bursts into motes in mid-air as its soul rises.
      const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const spin = (obj.thrown.dot(camRight) >= 0 ? -1 : 1) * THROW_SPIN;
      obj.animator.play(obj.shown.knocked ? this.deathClip(obj, 'rest') : obj.anims.death, { hold: true });
      obj.fade = { start: this.now, end: this.now + THROW_MS, flee: null, thrown: obj.thrown, spin };
      this.at(THROW_MS * THROW_BREAK, () => {
        this.shatter(obj);
        this.releaseWisp(obj);
        this.markFallen(obj);
      });
    } else {
      // Wesnoth plays the death clip, then fades; without one it just fades.
      // A downed unit finishes its fall from the down pose. As the fade begins
      // the body breaks up into motes of its own colours and its soul rises.
      const clip = obj.shown.knocked ? this.deathClip(obj, 'rest') : obj.anims.death;
      fadeIn = obj.animator.play(clip, { hold: true });
      // Lifted off its feet by the blow: the body lasts until it has come down.
      if (obj.toss) fadeIn = Math.max(fadeIn, obj.toss.land - this.now + 120);
      const shatters = obj.atlas !== null;
      obj.fade = { start: this.now + fadeIn, end: this.now + fadeIn + (shatters ? SHATTER_FADE_MS : DEATH_FADE_MS), flee };
      this.at(fadeIn, () => {
        this.shatter(obj);
        this.releaseWisp(obj);
        this.markFallen(obj);
      });
    }
    // Blend while fading; a low alpha test still drops the cleared background.
    obj.sprite.material.alphaTest = 0.01;
    for (const m of [obj.sprite.material, obj.base.material]) {
      m.transparent = true;
      m.needsUpdate = true;
    }
    // Blended, it sorts by distance among the other see-through things again.
    obj.base.renderOrder = obj.sprite.renderOrder = 0;
  }

  private revive(obj: UnitObj): void {
    obj.fade = null;
    obj.routed = false;
    obj.pushedOff = null;
    obj.thrown = null;
    obj.intoLava = null;
    this.effects.unmark(obj.id);
    this.effects.unmark(`scorch:${obj.id}`);
    obj.animator.stop();
    obj.group.visible = true;
    obj.sprite.material.alphaTest = 0.5;
    for (const m of [obj.sprite.material, obj.base.material]) {
      m.transparent = false;
      m.opacity = 1;
      m.needsUpdate = true;
    }
    obj.base.renderOrder = BASE_ORDER;
    obj.sprite.renderOrder = CUTOUT_ORDER;
  }

  /** Per-frame unit animation: frame, facing, lunge, tilt, fade and flash. */
  private animateUnit(obj: UnitObj, dtMs: number, lerp: number, camRight: THREE.Vector3): void {
    // A change of sides no defection is waiting to play (a sandbox edit, a replay jump) shows at once.
    if (obj.turnTo !== null && !obj.turning) this.turnCoat(obj);
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
    // Squash and stretch, worked out below with the lunge, the toss and the landing.
    let wide = 1;
    let tall = 1;

    // Every cutout turns by the camera's heading, not towards its position, so
    // they all stand parallel to the screen instead of fanning round the lens.
    obj.facing.rotation.y = Math.atan2(
      this.camera.position.x - this.controls.target.x,
      this.camera.position.z - this.controls.target.z,
    );
    obj.tilt.rotation.x = -this.spriteLean;
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
    if (obj.glow && this.now >= obj.glow.end) obj.glow = null;
    const glow = !cue && obj.glow && this.now >= obj.glow.start ? obj.glow : null;
    obj.outline.visible = (cue !== null || glow !== null) && obj.atlas !== null;
    if (cue && obj.atlas) {
      const u = obj.outline.material.uniforms;
      u.uColor!.value.setHex(cue.color);
      u.uOpacity!.value = cue.far ? 0.35 + 0.3 * breath : 0.55 + 0.45 * breath;
      u.uWidth!.value = hovered ? OUTLINE_HOVER_PX : OUTLINE_PX;
    } else if (glow && obj.atlas) {
      const u = obj.outline.material.uniforms;
      const k = (this.now - glow.start) / (glow.end - glow.start);
      u.uColor!.value.setHex(glow.color);
      // A blinking glow flares and dies `beats` times; any other fades in fast and out slowly.
      u.uOpacity!.value = glow.beats ? Math.sin(Math.PI * ((k * glow.beats) % 1)) ** 2 : Math.min(1, k * 8) * (1 - k * k);
      u.uWidth!.value = OUTLINE_HOVER_PX;
    }

    obj.tilt.rotation.z += (obj.targetTilt - obj.tilt.rotation.z) * lerp;
    if (obj.teeter && this.now >= obj.teeter.end) obj.teeter = null;
    if (obj.teeter && this.now >= obj.teeter.start) {
      // Losing its footing: it rocks wider and wider until it goes over.
      const k = (this.now - obj.teeter.start) / (obj.teeter.end - obj.teeter.start);
      obj.tilt.rotation.z = Math.sin(k * Math.PI * 4) * TEETER * (0.4 + 0.6 * k);
    }
    const crouch = obj.shown.knocked && !obj.downPose && !obj.fade;
    obj.tilt.scale.x += ((crouch ? DOWN_WIDEN : 1) - obj.tilt.scale.x) * lerp;
    obj.tilt.scale.y += ((crouch ? DOWN_SQUASH : 1) - obj.tilt.scale.y) * lerp;
    this.spinStars(obj);

    // Melee lunge: lean in until the hit frame, then settle back.
    const off = new THREE.Vector3();
    if (obj.lunge) {
      const { dir, start, hit, end, coil = 0, depth = 1 } = obj.lunge;
      const go = start + coil;
      const back = COIL_BACK * depth;
      const sag = COIL_SQUASH * depth;
      if (this.now >= end) obj.lunge = null;
      else if (coil > 0 && this.now < go) {
        // Gathering: it sinks back and down into itself.
        const k = THREE.MathUtils.clamp((this.now - start) / coil, 0, 1);
        const e = 1 - (1 - k) ** 2;
        off.addScaledVector(dir, -back * e);
        tall = 1 - sag * e;
        wide = 1 + sag * 0.7 * e;
      } else if (coil > 0 && this.now < hit) {
        // Let go: it hangs back through the swing, then covers the ground all at once, stretched along the way.
        const k = THREE.MathUtils.clamp((this.now - go) / Math.max(1, hit - go), 0, 1);
        const e = k ** 4;
        off.addScaledVector(dir, THREE.MathUtils.lerp(-back, HEAVY_REACH, e));
        const held = Math.max(0, 1 - k / 0.3);
        const stretch = 4 * e * (1 - e);
        tall = 1 - sag * held - 0.07 * stretch;
        wide = 1 + sag * 0.7 * held + DASH_STRETCH * stretch;
      } else if (coil > 0) {
        // It stays in on the blow a moment, then steps back.
        const k = THREE.MathUtils.clamp((end - this.now) / Math.max(1, end - hit), 0, 1);
        off.addScaledVector(dir, HEAVY_REACH * (1 - (1 - k) ** 2));
      } else {
        const k = this.now < hit ? (this.now - start) / Math.max(1, hit - start) : (end - this.now) / Math.max(1, end - hit);
        off.addScaledVector(dir, THREE.MathUtils.clamp(k, 0, 1));
      }
    }
    if (obj.jolt) {
      const { dir, start, end, shake } = obj.jolt;
      if (this.now >= end) obj.jolt = null;
      else if (this.now >= start) {
        const k = (this.now - start) / (end - start);
        // A knock springs out and back; a shudder wobbles, dying away.
        off.addScaledVector(dir, shake ? Math.sin(k * Math.PI * 6) * (1 - k) : Math.sin(k * Math.PI));
      }
    }

    let sink = 0;
    // A dying unit keeps its toss (it falls as it flies); any other way of leaving has its own motion.
    const leaves = obj.fade && (obj.fade.flee || obj.fade.drop || obj.fade.melt || obj.fade.thrown);
    if (obj.toss && (this.now >= obj.toss.end || leaves)) obj.toss = null;
    if (obj.toss && this.now >= obj.toss.start) {
      const { dir, start, land, end, lean } = obj.toss;
      if (this.now < land) {
        // In the air: up and back in an arc, tipping over at the top.
        const k = (this.now - start) / (land - start);
        off.addScaledVector(dir, 1 - (1 - k) ** 2);
        sink = -TOSS_HEIGHT * 4 * k * (1 - k);
        obj.tilt.rotation.z = lean * Math.sin(Math.PI * k);
      } else {
        // Down: one small bounce, sliding back to the middle of its hex.
        const k = (this.now - land) / (end - land);
        off.addScaledVector(dir, 1 - k * k * (3 - 2 * k));
        sink = -TOSS_HEIGHT * 0.16 * Math.sin(Math.PI * Math.min(1, k / 0.5));
      }
    }
    if (obj.squash && this.now >= obj.squash.end) obj.squash = null;
    if (obj.squash) {
      const k = (this.now - obj.squash.start) / (obj.squash.end - obj.squash.start);
      const a = obj.squash.amount * (1 - k) ** 2;
      tall *= 1 - a;
      wide *= 1 + a * 0.6;
    }
    obj.mirror.scale.set((obj.faceRight ? 1 : -1) * wide, tall, 1);
    if (obj.fade) {
      const f = THREE.MathUtils.clamp((this.now - obj.fade.start) / (obj.fade.end - obj.fade.start), 0, 1);
      if (obj.fade.flee) off.addScaledVector(obj.fade.flee, f * HEX_COL_STEP);
      if (obj.fade.drop) {
        // Slide to the lip, then over it and down.
        off.addScaledVector(obj.fade.drop, Math.min(1, f * 1.8) * HEX_SIZE * 1.1);
        sink = Math.max(0, f - 0.4) ** 2 * 3;
      }
      if (obj.fade.melt) {
        // Slide (and drop, off higher ground) into the pool, then sink into it.
        const slide = Math.min(1, f * 3);
        off.addScaledVector(obj.fade.melt, slide);
        sink = Math.max(0, f - 0.25) * 0.8 - obj.fade.melt.y * slide;
      }
      if (obj.fade.thrown) {
        // Flung back in an arc, turning over, rising until it bursts.
        off.addScaledVector(obj.fade.thrown, (1 - (1 - f) ** 2) * THROW_DIST);
        sink = -THROW_HEIGHT * Math.sin((Math.PI / 2) * Math.min(1, f / THROW_BREAK));
        obj.tilt.rotation.z = (obj.fade.spin ?? 0) * f;
      }
      // Pushed off, it stays solid until it is well over the edge; in lava, until
      // it is sinking; hurled, until it bursts (its motes take over from there).
      const gone = obj.fade.drop
        ? Math.max(0, f - 0.5) * 2
        : obj.fade.melt
          ? Math.max(0, f - 0.3) / 0.7
          : obj.fade.thrown
            ? f < THROW_BREAK ? 0 : 1
            : f;
      obj.sprite.material.opacity = 1 - gone;
      obj.base.material.opacity = 1 - (obj.fade.drop || obj.fade.thrown ? f : gone);
      obj.group.visible = f < 1;
    }
    // A flyer floats above its hex with a slow bob, and settles to earth when
    // knocked down, dying or carrying a flag; its base ring stays put on the
    // ground as a shadow.
    const airborne = obj.flying && !obj.grounded && !obj.shown.knocked && !obj.fade;
    obj.hover += ((airborne ? FLY_HOVER : 0) - obj.hover) * lerp;
    const lift = obj.hover + (airborne ? Math.sin((this.now / FLY_BOB_MS) * Math.PI * 2) * FLY_BOB : 0);
    obj.facing.position.set(off.x, TILE_TOP + BASE_HEIGHT + lift - sink, off.z);
    if (obj.blink && this.now >= obj.blink.end) obj.blink = null;
    obj.facing.visible = !obj.blink || ((this.now - obj.blink.start) % BLINK_MS) >= BLINK_MS / 2;
    obj.badge.position.y = TILE_TOP + BADGE_HEIGHT + lift;
    obj.badge.visible = obj.badgeOn && this.now >= obj.badgeHeld;
    if (obj.badgePop !== null && this.now >= obj.badgePop + BADGE_POP_MS) obj.badgePop = null;
    const pop = obj.badgePop !== null ? (this.now - obj.badgePop) / BADGE_POP_MS : 1;
    // Out of nothing to a little too big, then settling to size.
    const popScale = pop < 0.45 ? THREE.MathUtils.lerp(0.2, 1.45, pop / 0.45) : THREE.MathUtils.lerp(1.45, 1, (pop - 0.45) / 0.55);
    obj.badge.scale.set(BADGE_SIZE * popScale, BADGE_SIZE * popScale, 1);

    if (obj.flash > 0) obj.flash = Math.max(0, obj.flash - (dtMs / 1000) * 3);
    if (obj.whiteout > 0) obj.whiteout = Math.max(0, obj.whiteout - (dtMs / 1000) * PICK_FLASH_FADE);
    obj.sprite.material.userData.whiteout.value = Math.min(1, obj.whiteout);
    // A basic material's colour multiplies the texture; > 1 washes it toward white.
    obj.spentShade += ((obj.spent ? 1 : 0) - obj.spentShade) * lerp;
    obj.sprite.material.color.setScalar((1 + obj.flash * 2.5) * this.unitLight(obj.id));
    obj.base.material.color.setHex(OWNER_COLORS[obj.owner]).lerp(SPENT_BASE, obj.spentShade * 0.75);
    if (obj.fade?.melt) {
      // Sinking into lava it glows hotter and hotter: orange, then a searing yellow-white.
      const f = THREE.MathUtils.clamp((this.now - obj.fade.start) / (obj.fade.end - obj.fade.start), 0, 1);
      obj.sprite.material.color.setRGB(1 + 1.5 * f, 1 - 0.35 * f, 1 - 0.8 * f);
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
    stars.position.set(0, head * Math.cos(this.spriteLean) + STAR_CLEARANCE, -head * Math.sin(this.spriteLean));
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
    const f = (this.now - start) / (walk.pace ?? WALK_MS_PER_HEX);
    if (f >= path.length - 1) {
      obj.group.position.copy(path[path.length - 1]!);
      obj.mirror.rotation.z = 0;
      obj.walk = null;
      return;
    }
    const i = Math.max(0, Math.floor(f));
    // One footfall a hex, for a unit going forward under its own power.
    if (f >= 0 && !walk.backward && walk.stepped !== i) {
      walk.stepped = i;
      this.sound(obj.flying && !obj.grounded ? 'wingbeat' : RIDING_SPRITES.has(obj.spriteName) ? 'hoof' : 'step');
    }
    const from = path[i]!;
    const to = path[i + 1]!;
    const k = THREE.MathUtils.clamp(f - i, 0, 1);
    obj.group.position.lerpVectors(from, to, k);
    // A tabletop hop per step: up and down, rocking onto alternate feet —
    // unless the sprite has walk frames of its own to show the steps.
    if (!hasWalkFrames(obj.animator)) {
      const arc = Math.sin(Math.PI * k);
      obj.group.position.y += WALK_HOP * arc;
      obj.mirror.rotation.z = WALK_SWAY * arc * (i % 2 === 0 ? 1 : -1);
    }
    if (f >= 0 && !walk.backward) this.setHeading(obj, to.clone().sub(from));
  }

  /** The hexes a move walks through, origin and destination included. */
  private walkCells(from: Vec, to: Vec): Vec[] {
    const cells = this.board ? makeHexGrid(this.board).pathWithin(from, to, this.width * this.height) : null;
    return cells ?? [from, to];
  }

  /** Lay an opponent's route on the board; {@link animateRoutes} eats it up as the unit walks it. */
  private traceRoute(owner: Owner, cells: Vec[], start: number): void {
    if (cells.length < 2) return;
    const points = cells.map((c) => {
      const w = this.cellToWorld(c);
      return new THREE.Vector3(w.x, this.surfaceAt(c) + 0.09, w.z);
    });
    const color = OWNER_COLORS[owner];
    const group = new THREE.Group();
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    this.routeDotGeo ??= new THREE.CircleGeometry(HEX_SIZE * 0.26, 12);
    const dotMat = fillMaterial(color, 0.85);
    const dots = points.slice(1).map((at, i) => {
      const dot = new THREE.Mesh(this.routeDotGeo!, dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.copy(at);
      // Small steps along the way, and a mark that reads as where it will stand.
      dot.scale.setScalar(i === points.length - 2 ? 1.5 : 0.6);
      return dot;
    });
    group.add(line, ...dots);
    this.routeGroup.add(group);
    this.routes.push({ group, line, dots, points, start });
  }

  /** Trim each route to what lies ahead of its walker; fade it out once it has arrived. */
  private animateRoutes(): void {
    for (let r = this.routes.length - 1; r >= 0; r--) {
      const route = this.routes[r]!;
      const { points, line, dots } = route;
      const f = Math.max(0, (this.now - route.start) / WALK_MS_PER_HEX);
      const last = points.length - 1;
      if (f >= last) {
        const fade = 1 - ((f - last) * WALK_MS_PER_HEX) / ROUTE_FADE_MS;
        if (fade <= 0) {
          this.removeRoute(r);
          continue;
        }
        line.visible = false;
        dots[dots.length - 1]!.material.opacity = 0.85 * fade;
        continue;
      }
      const i = Math.floor(f);
      // The line starts under the walker: move its first live vertex there.
      const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const here = points[i]!.clone().lerp(points[i + 1]!, f - i);
      pos.setXYZ(i, here.x, here.y, here.z);
      pos.needsUpdate = true;
      line.geometry.setDrawRange(i, points.length - i);
      dots.forEach((dot, j) => (dot.visible = j + 1 > f));
    }
  }

  private removeRoute(index: number): void {
    const route = this.routes[index]!;
    this.routeGroup.remove(route.group);
    route.line.geometry.dispose();
    route.line.material.dispose();
    route.dots[0]?.material.dispose(); // one material, shared by every dot of the route
    this.routes.splice(index, 1);
  }

  private clearRoutes(): void {
    for (let r = this.routes.length - 1; r >= 0; r--) this.removeRoute(r);
  }

  private animateMissiles(): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]!;
      const f = (this.now - m.start) / (m.end - m.start);
      if (m.dread && f >= 1) {
        if (this.pierceMissile(m, m.dread.pierce)) this.missiles.splice(i, 1);
        continue;
      }
      if (f >= 1 && !m.landed) {
        m.landed = true;
        this.shotFx(m.to, m.ending);
        // An arrow that lands stays stuck in its target (or the ground) for a moment.
        if (m.ending !== 'cover') {
          m.sprite.position.copy(m.to);
          m.sprite.material.alphaTest = 0.01;
          m.sprite.material.transparent = true;
          m.sprite.material.needsUpdate = true;
        }
      }
      const gone = m.ending === 'cover' ? f >= 1 : this.now >= m.end + STICK_MS;
      if (gone) {
        this.scene.remove(m.sprite);
        m.sprite.material.dispose();
        this.missiles.splice(i, 1);
        continue;
      }
      if (f >= 1) {
        m.sprite.material.opacity = 1 - (this.now - m.end) / STICK_MS;
        continue;
      }
      m.sprite.visible = f >= 0;
      if (f < 0) continue;
      arcPoint(m.from, m.to, m.arc, f, m.sprite.position);
      this.missileTrail(m);
      // Point the (north-facing) image along its on-screen direction of travel:
      // nose up as it climbs, nose down as it drops.
      const a = arcPoint(m.from, m.to, m.arc, Math.max(0, f - 0.02));
      const b = arcPoint(m.from, m.to, m.arc, Math.min(1, f + 0.02));
      m.sprite.material.rotation = this.screenAngle(a, b);
    }
    for (const arrow of this.stuckArrows) arrow.sprite.material.rotation = this.screenAngle(arrow.from, arrow.to);
  }

  /**
   * A gruesome shot past its victim's chest: it bursts out the back in a spray
   * of ash and shards, flies on low into the ground behind (see
   * {@link piercePoint}) and stays stuck there. True once it has gone in, when
   * it leaves the flying missiles for the stuck arrows.
   */
  private pierceMissile(m: Missile, pierce: THREE.Vector3): boolean {
    const dir = pierce.clone().sub(m.to);
    if (!m.landed) {
      m.landed = true;
      this.shotFx(m.to, 'hit');
      this.sound('arrow-pierce');
      const out = dir.clone().setY(0).normalize();
      this.effects.burst({
        at: m.to,
        count: 26,
        colors: [...ASH_COLORS, ...CURSE_COLORS],
        speed: [1.6, 3.6],
        dir: out,
        cone: 0.3,
        up: 0.4,
        gravity: 6,
        drag: 1.2,
        life: [0.35, 0.7],
        size: [0.03, 0.07],
        shape: 'square',
        floor: pierce.y,
      });
    }
    const g = Math.min(1, (this.now - m.end) / PIERCE_MS);
    m.sprite.position.copy(m.to).lerp(pierce, g);
    m.sprite.material.rotation = this.screenAngle(m.to, pierce);
    this.missileTrail(m);
    if (g < 1) return false;
    // In: a puff of grit, and it stays where it struck for the rest of the round.
    this.dust(pierce, 7, 0.8);
    this.effects.ring(pierce.clone().setY(pierce.y - 0.03), DREAD_COLOR, 0.1, HEX_SIZE * 0.6, { life: 0.4, opacity: 0.6, additive: true });
    // Its head in the ground, the shaft sticking out back the way it came.
    m.sprite.position.addScaledVector(dir.normalize(), -m.sprite.scale.x * 0.28);
    this.stuckArrows.push({ sprite: m.sprite, from: m.to.clone(), to: pierce.clone() });
    return true;
  }

  /** Pull out every arrow left stuck in the ground (a new round, or a replay jump). */
  private clearStuckArrows(): void {
    for (const arrow of this.stuckArrows) {
      this.scene.remove(arrow.sprite);
      arrow.sprite.material.dispose();
    }
    this.stuckArrows.length = 0;
  }

  /** Leave a fading streak of puffs along the path a missile has flown since last frame. */
  private missileTrail(m: Missile): void {
    const here = m.sprite.position;
    if (!m.trailAt) {
      m.trailAt = here.clone();
      return;
    }
    const gap = m.trailAt.distanceTo(here);
    const steps = Math.floor(gap / TRAIL_STEP);
    for (let i = 1; i <= steps; i++) {
      const at = m.trailAt.clone().lerp(here, (i * TRAIL_STEP) / gap);
      if (m.dread) this.curseTrail(m, at);
      else {
        this.effects.burst({
          at,
          count: 1,
          colors: TRAIL_COLORS,
          speed: [0, 0.04],
          life: [0.14, 0.2],
          size: [0.07, 0.09],
          grow: 0.15,
          blend: 'add',
          opacity: 0.45,
        });
      }
    }
    if (steps > 0) m.trailAt.lerp(here, (steps * TRAIL_STEP) / gap);
    // A gruesome shot glows as it flies.
    if (m.dread) {
      this.effects.burst({ at: here, count: 1, colors: CURSE_COLORS, speed: [0, 0], life: [0.06, 0.06], size: [0.26, 0.3], blend: 'add', opacity: 0.6 });
    }
  }

  /**
   * One step of a gruesome shot's trail: a thick streak of dread and embers
   * that hangs longer than an ordinary one, embers dropping from it, and now and
   * then a puff of smoke that lingers along the line of fire after the kill.
   */
  private curseTrail(m: Missile, at: THREE.Vector3): void {
    const n = m.puffs++;
    this.effects.burst({
      at,
      count: 1,
      colors: CURSE_COLORS,
      speed: [0, 0.05],
      life: [0.3, 0.5],
      size: [0.1, 0.14],
      grow: 0.2,
      blend: 'add',
      opacity: 0.6,
    });
    if (n % 3 === 0) {
      this.effects.burst({
        at,
        count: 1,
        colors: EMBER_COLORS,
        speed: [0.05, 0.25],
        gravity: 2.5,
        drag: 1,
        life: [0.35, 0.6],
        size: [0.025, 0.04],
        shape: 'square',
        blend: 'add',
      });
    }
    if (n % SMOKE_EVERY === 0) {
      this.effects.burst({
        at,
        count: 1,
        colors: SHOT_SMOKE_COLORS,
        speed: [0, 0.05],
        gravity: -0.12, // it drifts up as it thins
        drag: 1,
        life: [1.3, 1.9],
        size: [0.08, 0.11],
        grow: 2.6,
        opacity: 0.32,
        jitter: 0.02,
      });
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
    clearInstances(this.highlightGroup);
    if (reach.length === 0) return;

    this.reachFillGeo ??= new THREE.CircleGeometry(HEX_SIZE * 0.9, 6);
    this.reachFillMat ??= fillMaterial(MOVE_COLOR, REACH_FILL_OPACITY);
    // Amber where getting there breaks away from an enemy: the free hack can
    // cost the action *and* the ground, so it should not look like open field.
    this.provokeFillMat ??= fillMaterial(PROVOKE_COLOR, REACH_FILL_OPACITY + 0.06);

    const place = (t: ReachTile) => (o: THREE.Object3D) => {
      o.rotation.set(-Math.PI / 2, 0, 0);
      const w = this.cellToWorld(t.cell);
      o.position.set(w.x, this.surfaceAt(t.cell) + 0.03, w.z);
    };
    const [provoked, open] = [reach.filter((t) => t.provokes > 0), reach.filter((t) => t.provokes <= 0)];
    this.highlightGroup.add(
      instanced(this.reachFillGeo, this.reachFillMat, open.map(place)),
      instanced(this.reachFillGeo, this.provokeFillMat, provoked.map(place)),
    );

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

    const edges: ((o: THREE.Object3D) => void)[] = [];
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
        edges.push((edge) => {
          // Lie flat, then turn the ribbon's length along the shared edge, which
          // runs perpendicular to the line joining the two hex centres.
          edge.rotation.set(-Math.PI / 2, 0, -(angle + Math.PI / 2));
          edge.position.set(centre.x + (HEX_STEP / 2) * dx, surface, centre.z + (HEX_STEP / 2) * dz);
        });
      }
    }
    this.highlightGroup.add(instanced(geo, mat, edges));
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
      const mesh = child as THREE.InstancedMesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    clearInstances(this.overlayGroup);
    // Later overlays sit a hair higher so small markers (flags) stay on top.
    overlays.forEach((o, i) => {
      const geo = new THREE.CircleGeometry(HEX_SIZE * (o.scale ?? 0.9), 6);
      const mat = new THREE.MeshBasicMaterial({
        color: o.color,
        transparent: true,
        opacity: o.opacity ?? 0.3,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        depthWrite: false,
      });
      const tiles = o.cells.map((c) => (tile: THREE.Object3D) => {
        tile.rotation.set(-Math.PI / 2, 0, 0);
        const w = this.cellToWorld(c);
        tile.position.set(w.x, this.surfaceAt(c) + 0.012 + i * 0.002, w.z);
      });
      this.overlayGroup.add(instanced(geo, mat, tiles));
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
      obj.badgeOn = kind !== undefined;
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
    } else if (kind === 'inspired') {
      // A five-pointed star.
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 28 : 12;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        g.lineTo(32 + r * Math.cos(a), 34 + r * Math.sin(a));
      }
      g.closePath();
      g.fillStyle = INSPIRED_COLOR;
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

  // --- combat effects (see effects.ts) --------------------------------------

  /** World Y of the ground a unit stands on. */
  private groundY(obj: UnitObj): number {
    return obj.targetPos.y + TILE_TOP;
  }

  /** Mid-body of a unit: where blows land and sparks fly from. */
  private chest(obj: UnitObj): THREE.Vector3 {
    return obj.group.position
      .clone()
      .add(obj.facing.position)
      .setY(obj.group.position.y + TILE_TOP + BASE_HEIGHT + obj.hover + 0.45 * obj.size);
  }

  /** Where two combatants' weapons meet. */
  private contact(a: UnitObj, b: UnitObj): THREE.Vector3 {
    return this.chest(a).lerp(this.chest(b), 0.5);
  }

  /** Dust in the colour of the ground at `at`: the tile's own colour, lightened. */
  private dustColors(at: THREE.Vector3): number[] {
    const cell = this.worldToCell(at);
    const top = new THREE.Color(cell ? tileTopColor(cell, this.board ? hexElevation(this.board, cell) : 0) : 0x2a3140);
    const dust = top.lerp(new THREE.Color(DUST_TINT), 0.55);
    return [
      dust.getHex(),
      dust.clone().multiplyScalar(0.78).getHex(),
      dust.clone().lerp(new THREE.Color(0xffffff), 0.25).getHex(),
    ];
  }

  /** A puff of ground-coloured dust at `at` (on the ground). */
  private dust(at: THREE.Vector3, count: number, strength = 1): void {
    this.effects.burst({
      at: at.clone().setY(at.y + 0.04),
      count,
      colors: this.dustColors(at),
      speed: [0.3 * strength, 0.9 * strength],
      flat: true,
      up: 0.25,
      drag: 2.5,
      life: [0.45, 0.8],
      size: [0.1, 0.18],
      grow: 2.2,
      opacity: 0.75,
      jitter: 0.12,
    });
  }

  /** The angle that turns an upward-pointing screen image to point from `a` to `b` on screen. */
  private screenAngle(a: THREE.Vector3, b: THREE.Vector3): number {
    const p = a.clone().project(this.camera);
    const q = b.clone().project(this.camera);
    return Math.atan2(q.y - p.y, (q.x - p.x) * this.camera.aspect) - Math.PI / 2;
  }

  /** Knock a cutout `dist` along `dir` and let it spring back (or wobble, with `shake`). */
  private joltUnit(obj: UnitObj, dir: THREE.Vector3, dist: number, shake = false, ms = JOLT_MS): void {
    const d = dir.clone().setY(0);
    if (d.lengthSq() < 1e-6) return;
    obj.jolt = { dir: d.normalize().multiplyScalar(dist), start: this.now, end: this.now + ms, shake };
  }

  /**
   * Shake the camera: a `nudge` shoves it once along `dir`, a `rumble` jitters
   * it. Never with the camera off or in hand.
   */
  private shakeCamera(
    kind: 'nudge' | 'rumble',
    amp: number,
    ms: number,
    dir = new THREE.Vector3(0, 1, 0),
  ): void {
    if (this.cameraMode === 'off' || this.handOnCamera) return;
    this.shakes.push({ start: this.wallNow, end: this.wallNow + ms, amp, kind, dir: dir.clone().normalize() });
  }

  private shakeOffset(): THREE.Vector3 {
    const out = new THREE.Vector3();
    this.shakes = this.shakes.filter((sh) => this.wallNow < sh.end);
    for (const sh of this.shakes) {
      const k = (this.wallNow - sh.start) / (sh.end - sh.start);
      const decay = (1 - k) * (1 - k);
      if (sh.kind === 'nudge') out.addScaledVector(sh.dir, sh.amp * Math.sin(Math.PI * k));
      else {
        const jitter = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        out.addScaledVector(jitter, 2 * sh.amp * decay);
      }
    }
    return out;
  }

  /**
   * Freeze the action for `ms` (time on screen), for the weight of a blow —
   * the units it met (`struck`) held white on the frozen frame.
   */
  private hitStop(ms: number, struck: string[] = []): void {
    this.freezeUntil = Math.max(this.freezeUntil, this.shownNow + ms);    if (struck.length === 0) return;
    const live = this.impact && this.shownNow < this.impact.until ? this.impact : null;
    this.impact = {
      until: Math.max(live?.until ?? 0, this.shownNow + ms),
      ids: [...new Set([...(live?.ids ?? []), ...struck])],
    };
  }

  /** Play the action in slow motion for `ms` (time on screen) once any hit-stop ends, starting at `scale` of full speed. */
  private slowMotion(ms: number, scale = SLOW_MO_SCALE): void {
    const start = Math.max(this.shownNow, this.freezeUntil);
    this.slowMo = { start, end: Math.max(this.slowMo.end, start + ms), scale };
  }

  /** How fast board time runs against the wall clock right now: still in a hit-stop, slow in a slow motion. */
  private timeScale(): number {
    if (this.shownNow < this.freezeUntil) return 0;
    const { start, end, scale } = this.slowMo;
    if (this.shownNow >= end || this.shownNow < start) return 1;
    const k = (this.shownNow - start) / (end - start);
    return scale + (1 - scale) * k * k;
  }

  /** How dark the board is around a gruesome kill right now: 0 not at all, 1 fully. */
  private spotAmount(): number {
    const s = this.spotlight;
    if (!s || this.now < s.start) return 0;
    if (this.now >= s.end) {
      this.spotlight = null;
      return 0;
    }
    return Math.min(1, (this.now - s.start) / SPOT_IN_MS, (s.end - this.now) / SPOT_OUT_MS);
  }

  /** The brightness a unit's cutout is drawn at: dimmed outside a gruesome kill's spotlight. */
  private unitLight(id: string): number {
    const k = this.spotAmount();
    if (k === 0) return 1;
    return 1 - SPOT_DIM * k * (1 - (this.spotlight?.lit.get(id) ?? 0));
  }

  /**
   * Grade the frame for a gruesome kill: the light on the board drops and the
   * edges of the view darken with its spotlight, and on its impact frame the
   * scene goes flat — its victim white, the killer outlined, everything else dark.
   */
  private grade(): void {
    const k = this.spotAmount();
    const sil = this.silhouette && this.shownNow < this.silhouette.until ? this.silhouette : null;
    if (!sil) this.silhouette = null;
    if (this.impact && this.shownNow >= this.impact.until) this.impact = null;
    // Any other hit-stop's frame: the units the blow met go white, the board as it is.
    if (!sil && this.impact) {
      for (const id of this.impact.ids) this.units.get(id)?.sprite.material.color.setScalar(IMPACT_WHITE);
    }
    const light = sil ? 0.06 : 1 - SPOT_LIGHT_DIM * k;
    this.ambient.intensity = AMBIENT_LIGHT * light;
    this.keyLight.intensity = KEY_LIGHT * light;
    this.backdrop.group.visible = !sil;
    (this.scene.background as THREE.Color).setHex(sil ? SILHOUETTE_BACKGROUND : BACKGROUND);
    this.vignette.style.opacity = String(sil ? 1 : k);
    if (!sil) return;
    for (const obj of this.units.values()) {
      if (obj.id === sil.victim) {
        obj.sprite.material.color.setScalar(20);
        obj.outline.visible = false;
      } else {
        obj.sprite.material.color.setScalar(0.03);
        if (obj.id === sil.killer && obj.atlas) {
          const u = obj.outline.material.uniforms;
          obj.outline.visible = true;
          u.uColor!.value.setHex(0xffffff);
          u.uOpacity!.value = 1;
          u.uWidth!.value = OUTLINE_HOVER_PX;
        }
      }
    }
  }

  /** How far the camera is tilted about its line of sight right now (a gruesome kill's impact). */
  private rollAngle(): number {
    const r = this.cameraRoll;
    if (!r) return 0;
    if (this.wallNow >= r.end) {
      this.cameraRoll = null;
      return 0;
    }
    // Snaps over, then eases back upright.
    const k = (this.wallNow - r.start) / (r.end - r.start);
    return r.amp * (k < 0.12 ? k / 0.12 : (1 - (k - 0.12) / 0.88) ** 2);
  }

  /** A blow that connects: a small white spark where it lands. */
  private impactFx(a: UnitObj, d: UnitObj): void {
    this.effects.burst({
      at: this.chest(d).lerp(this.chest(a), 0.25),
      count: 10,
      colors: SPARK_COLORS,
      speed: [1.2, 2.4],
      dir: d.group.position.clone().sub(a.group.position).setY(0.3),
      cone: 0.7,
      gravity: 3,
      drag: 3,
      life: [0.15, 0.3],
      size: [0.035, 0.06],
      blend: 'add',
    });
  }

  /**
   * The gathering before a blow that will floor `d`, over `ms`: a ring in the
   * striker's colour draws tight under it, motes rise, its rim lights, the
   * ground trembles, and just before it goes its weapon catches the light.
   */
  private coilFx(a: UnitObj, d: UnitObj, ms: number): void {
    const color = OWNER_COLORS[a.owner];
    const feet = this.feet(a);
    this.effects.ring(feet, color, HEX_SIZE * 1.35, 0.25, { life: ms / 1000, opacity: 0.85, additive: true });
    this.effects.ring(feet, 0xffffff, HEX_SIZE * 0.9, 0.2, { life: (ms / 1000) * 0.8, opacity: 0.5, additive: true });
    this.effects.burst({
      at: this.chest(a),
      count: 14,
      colors: [color, 0xffffff, 0xfff3c4],
      speed: [0.1, 0.4],
      up: 0.5,
      gravity: -1,
      drag: 1,
      life: [0.3, 0.55],
      size: [0.03, 0.06],
      blend: 'add',
      jitter: 0.4,
    });
    this.dust(feet, 6, 0.6);
    a.glow = { color, start: this.now, end: this.now + ms + 250 };
    const toward = d.group.position.clone().sub(a.group.position).setY(0).normalize();
    // The one about to take it sees it coming.
    this.joltUnit(d, toward, 0.025, true, ms);
    this.at(ms * 0.7, () => {
      const glint = this.chest(a).addScaledVector(toward, 0.12);
      glint.y += 0.3 * a.size;
      this.effects.icon('ting', glint, 0.5, { life: 0.26, spin: 1.4, additive: true });
    });
    if (this.cameraMode === 'cinematic') this.shakeCamera('rumble', 0.012, ms);
  }

  /** The last of a heavy swing, as the striker covers the ground: afterimages behind it, speed lines, dirt kicked back. */
  private dashFx(a: UnitObj, d: UnitObj, dread = false): void {
    const dir = d.group.position.clone().sub(a.group.position).setY(0).normalize();
    const color = dread ? DREAD_COLOR : new THREE.Color(OWNER_COLORS[a.owner]).lerp(new THREE.Color(0xffffff), 0.45).getHex();
    // A gruesome kill's dash leaves more of them, and they hang longer (it lands in slow motion).
    const ghosts = dread ? DASH_GHOSTS + 2 : DASH_GHOSTS;
    for (let i = 0; i < ghosts; i++) {
      this.at((i * DASH_MS) / ghosts, () => this.afterimage(a, color, dread ? DASH_GHOST_LIFE * 2 : DASH_GHOST_LIFE));
    }
    const feet = this.feet(a);
    const body = feet.clone().add(new THREE.Vector3(a.facing.position.x, 0, a.facing.position.z));
    const ahead = body.clone().addScaledVector(dir, HEX_SIZE * 0.9);
    const along = this.screenAngle(body, ahead);
    for (const lift of [0.25, 0.5, 0.75]) {
      this.effects.streak(body.clone().setY(feet.y + lift * a.size + a.hover), along, 1.3 - lift * 0.4, dread ? 0.09 : 0.06, {
        life: dread ? 0.45 : 0.28,
        color: dread ? DREAD_COLOR : 0xffffff,
        opacity: 0.8,
      });
    }
    this.effects.burst({
      at: body,
      count: 14,
      colors: this.dustColors(feet),
      speed: [0.9, 2],
      dir: dir.clone().negate().setY(0.4),
      cone: 0.4,
      drag: 2.5,
      life: [0.4, 0.7],
      size: [0.1, 0.18],
      grow: 2,
      opacity: 0.75,
      jitter: 0.1,
    });
  }

  /**
   * A heavy blow landing: a long freeze on a white flash, an impact star and a
   * ring bursting off the point it struck, a slash across the victim, sparks
   * and chips sprayed out the far side, a shockwave along the ground, the
   * camera punched in — then slow motion as the victim leaves its feet. One
   * that only floors its target (not `lethal`) is the same blow at
   * {@link DOWN_IMPACT} of the size, without the flash or the punch of the camera.
   */
  private smashFx(a: UnitObj, d: UnitObj, lethal: boolean): void {
    const k = lethal ? 1 : DOWN_IMPACT;
    this.hitStop(lethal ? HEAVY_STOP_MS : DOWN_STOP_MS, [d.id]);
    this.slowMotion(DOWN_SLOW_MO_MS * k, DOWN_SLOW_MO_SCALE);
    const dir = d.group.position.clone().sub(a.group.position).setY(0).normalize();
    const at = this.chest(d).lerp(this.chest(a), 0.25);
    const ground = this.feet(d);
    if (lethal) this.effects.pop('soft', at, 0.8, 2, { life: 0.2, opacity: 0.7, color: 0xfff3c4 });
    this.effects.pop('burst', at, 0.55 * k, 1.5 * k, { life: 0.24, rotation: Math.random() * Math.PI, spin: 0.5 });
    this.effects.pop('hoop', at, 0.3, 1.9 * k, { life: 0.36, opacity: 0.8 * k });
    const along = this.screenAngle(a.group.position, d.group.position);
    const cut = Math.random() < 0.5 ? -0.95 : 0.95;
    this.effects.streak(at, along + cut, 1.6 * (0.5 + 0.5 * k), 0.28 * k, { life: 0.34 });
    if (lethal) {
      this.effects.streak(at, along + cut * 1.2, 2.1, 0.08, { life: 0.26, color: OWNER_COLORS[a.owner], opacity: 0.9 });
    }
    this.effects.burst({
      at,
      count: Math.round(34 * k),
      colors: SPARK_COLORS,
      speed: [1.8, 4.6 * (0.5 + 0.5 * k)],
      dir: dir.clone().setY(0.35),
      cone: 0.55,
      gravity: 6,
      drag: 2.2,
      life: [0.25, 0.55],
      size: [0.035, 0.075],
      blend: 'add',
    });
    this.effects.burst({
      at,
      count: Math.round(14 * k),
      colors: SPARK_COLORS,
      speed: [1.2, 2.6],
      gravity: 3,
      drag: 3,
      life: [0.15, 0.32],
      size: [0.03, 0.055],
      blend: 'add',
    });
    this.effects.burst({
      at,
      count: Math.round(10 * k),
      colors: CHIP_COLORS,
      speed: [1.4, 2.8],
      dir: dir.clone().setY(0.6),
      cone: 0.6,
      up: 0.8,
      gravity: 9,
      life: [0.6, 0.95],
      size: [0.04, 0.07],
      shape: 'square',
      floor: ground.y,
    });
    this.effects.ring(ground, 0xffffff, 0.25, HEX_SIZE * 1.5 * (0.5 + 0.5 * k), { life: 0.45, opacity: 0.8 * k, additive: true });
    this.dust(ground, Math.round(10 * k), 1.5);
    this.shakeCamera('rumble', 0.05 * k, 240);
    if (this.cameraMode === 'cinematic') {
      this.shakeCamera('nudge', 0.1 * k, 220, dir);
      if (lethal) this.shakeCamera('nudge', 0.22, 180, this.camera.getWorldDirection(new THREE.Vector3()));
    }
  }

  /** Lift a unit `by` has just struck down off its feet: up and back from the blow, tipping over, to land a moment later. */
  private tossUnit(obj: UnitObj, by: UnitObj): void {
    if (obj.fade) return;
    const away = obj.group.position.clone().sub(by.group.position).setY(0);
    if (away.lengthSq() < 1e-6) return;
    away.normalize();
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    obj.lunge = null;
    obj.toss = {
      dir: away.clone().multiplyScalar(TOSS_BACK),
      start: this.now,
      land: this.now + TOSS_MS,
      end: this.now + TOSS_MS + TOSS_SETTLE_MS,
      lean: (away.dot(camRight) >= 0 ? -1 : 1) * TOSS_LEAN,
    };
    this.dust(this.feet(obj), 6, 0.9);
  }

  /**
   * A tossed unit hitting the ground: it flattens, dust and pebbles jump, a
   * ripple runs out, stars fly off its head (if it lives) and the camera jars.
   */
  private slamFx(obj: UnitObj): void {
    if (!obj.toss || (obj.fade && this.now >= obj.fade.start)) return; // never left the ground, or already gone
    this.sound('knockdown');
    const ground = this.feet(obj).add(new THREE.Vector3(obj.facing.position.x, 0, obj.facing.position.z));
    obj.squash = { start: this.now, end: this.now + SLAM_SQUASH_MS, amount: SLAM_SQUASH };
    this.hitStop(SLAM_STOP_MS);
    const dust = this.dustColors(ground);
    this.dust(ground, 24, 1.9);
    this.effects.ring(ground, dust[2]!, 0.2, HEX_SIZE * 1.15, { life: 0.45, opacity: 0.75, thick: true });
    this.effects.ring(ground, 0xffffff, 0.15, HEX_SIZE * 1.4, { life: 0.4, opacity: 0.6, additive: true });
    this.effects.burst({
      at: ground,
      count: 12,
      colors: CHIP_COLORS,
      speed: [0.6, 1.6],
      flat: true,
      up: 2.2,
      gravity: 9,
      life: [0.5, 0.85],
      size: [0.035, 0.06],
      shape: 'square',
      floor: ground.y,
      jitter: 0.15,
    });
    if (!obj.state.dead) {
      const head = ground.clone().setY(ground.y + 0.45 * obj.size);
      this.effects.pop('burst', head, 0.2, 0.7, { life: 0.22, color: 0xffe066, opacity: 0.9 });
      this.effects.burst({
        at: head,
        count: 10,
        colors: GOLD_COLORS,
        speed: [0.8, 1.8],
        up: 1.2,
        gravity: 5,
        drag: 1.5,
        life: [0.3, 0.6],
        size: [0.04, 0.07],
        blend: 'add',
      });
    }
    this.shakeCamera('rumble', 0.03, 200);
    if (this.cameraMode === 'cinematic') this.shakeCamera('nudge', 0.08, 200, new THREE.Vector3(0, -1, 0));
  }

  /** The striker over the foe it has just floored: a ring in its colour rolls out from its feet and its rim lights. */
  private poiseFx(obj: UnitObj): void {
    if (obj.state.dead || obj.fade) return;
    const color = OWNER_COLORS[obj.owner];
    this.effects.ring(this.feet(obj), color, 0.2, HEX_SIZE * 1.1, { life: 0.6, opacity: 0.6, additive: true });
    obj.glow = { color, start: this.now, end: this.now + 700 };
  }

  /**
   * A swing `d` blocks: it stops dead on a steel arc in front of the blocker,
   * sparks spray back the way it came, the blocker shudders and holds, and the
   * swing's owner staggers back off it.
   */
  private blockFx(a: UnitObj, d: UnitObj): void {
    if (d.fade || a.fade) return;
    this.sound('block');
    this.hitStop(BLOCK_STOP_MS);
    const back = a.group.position.clone().sub(d.group.position).setY(0);
    const at = this.chest(d).lerp(this.chest(a), 0.35);
    this.effects.icon('arc', at, 0.6, {
      life: 0.35,
      opacity: 0.9,
      color: STEEL,
      rotation: this.screenAngle(d.group.position, a.group.position),
      additive: true,
    });
    this.effects.icon('ting', at, 0.4, { life: 0.3, spin: 0.6, color: STEEL, additive: true });
    this.effects.burst({
      at,
      count: 14,
      colors: STEEL_COLORS,
      speed: [1.4, 2.8],
      dir: back.clone().setY(0.4),
      cone: 0.8,
      gravity: 5,
      drag: 2,
      life: [0.2, 0.4],
      size: [0.03, 0.06],
      blend: 'add',
    });
    this.flashUnit(d.id, 0.3);
    this.joltUnit(d, back.clone().negate(), BLOCK_BRACE, true, BLOCK_BOUNCE_MS);
    this.joltUnit(a, back, BLOCK_BOUNCE, false, BLOCK_BOUNCE_MS);
    if (this.cameraMode === 'cinematic') this.shakeCamera('nudge', 0.04, 160, back.clone().normalize());
  }

  /** 1a–1c. A clash: sparks and a glint where the blades meet, both thrown apart, the defender's ward rippling out. */
  private clashFx(aId: string, dId: string): void {
    const a = this.units.get(aId);
    const d = this.units.get(dId);
    if (!a || !d) return;
    this.sound('clash');
    this.hitStop(IMPACT_STOP_MS, [aId, dId]);
    const at = this.contact(a, d);
    const across = d.group.position.clone().sub(a.group.position).setY(0);
    // 1a: a burst of white-gold sparks and a four-point glint.
    this.effects.burst({
      at,
      count: 22,
      colors: SPARK_COLORS,
      speed: [1.5, 3.2],
      up: 0.6,
      gravity: 5,
      drag: 2,
      life: [0.2, 0.45],
      size: [0.035, 0.07],
      blend: 'add',
    });
    this.effects.icon('ting', at, 0.55, { life: 0.35, spin: 0.6, additive: true });
    // 1b: a pale arc where the blades turned, and both knocked back a step.
    this.effects.icon('arc', at, 0.7, {
      life: 0.3,
      opacity: 0.8,
      color: 0xe8f0ff,
      rotation: this.screenAngle(a.group.position, d.group.position),
      additive: true,
    });
    this.joltUnit(a, across.clone().negate(), DEFLECT);
    this.joltUnit(d, across, DEFLECT);
    // 1c: the defender held — a ripple in its side's colour.
    this.effects.ring(d.group.position.clone().setY(this.groundY(d) + 0.03), OWNER_COLORS[d.owner], 0.3, 0.75, {
      life: 0.5,
      opacity: 0.8,
      additive: true,
    });
  }

  /** 2a–2c. Pushed back: dust kicked up along the skid, chevrons streaking through, a nudge of the camera. */
  private recoilFx(obj: UnitObj, from: THREE.Vector3, to: THREE.Vector3, at: number, ms = WALK_MS_PER_HEX): void {
    const push = to.clone().sub(from).setY(0);
    // 2a: dust at its feet all along the skid (sampled as it slides).
    for (let i = 0; i < 4; i++) {
      this.at(at + (i * ms) / 4, () => this.dust(obj.group.position.clone().setY(this.groundY(obj)), 5, 0.7));
    }
    this.at(at, () => {
      this.sound('skid');
      // 2b: chevrons pointing the way it is shoved.
      this.effects.icon('chevron', this.chest(obj), 0.42, {
        life: 0.35,
        rotation: this.screenAngle(from, to),
        drift: push.clone().multiplyScalar(0.8),
      });
      // 2c: the camera gives a little with it (close-ups only).
      if (this.cameraMode === 'cinematic') this.shakeCamera('nudge', 0.06, 200, push);
    });
  }

  /** 3a–3b. Braced by a friend: a bar of light between them with a shield on it, and the friend takes the weight. */
  private braceFx(unitId: string, supporterId: string): void {
    const obj = this.units.get(unitId);
    const friend = this.units.get(supporterId);
    if (!obj || !friend) return;
    this.sound('brace');
    const a = this.chest(obj);
    const b = this.chest(friend);
    // The teal the "Supported" verdict is written in (a team colour would paint red through P1's units).
    const color = GUARD_COLOR;
    this.effects.beam(a, b, color, 0.035, { life: 0.7 });
    this.effects.icon('shield', a.clone().lerp(b, 0.5).setY(Math.max(a.y, b.y) + 0.25), 0.36, { life: 0.9, color });
    this.joltUnit(friend, friend.group.position.clone().sub(obj.group.position), 0.1);
  }

  /** Reassembling: a ring of pale bone light closes in on the fallen unit and its shards fly back together. */
  private reassembleFx(obj: UnitObj): void {
    if (obj.state.dead) return;
    this.sound('reassemble');
    const ground = obj.group.position.clone().setY(this.groundY(obj) + 0.04);
    const chest = this.chest(obj);
    this.effects.ring(ground, BONE, HEX_SIZE * 0.95, 0.25, { life: REASSEMBLE_GATHER_MS / 1000, opacity: 0.9, additive: true });
    // Shards thrown out from the unit fall straight back in: a burst with gravity pulling toward it.
    this.effects.burst({
      at: ground.clone().setY(ground.y + 0.05),
      count: 22,
      colors: BONE_COLORS,
      speed: [0.6, 1.4],
      flat: true,
      up: 1.2,
      gravity: 5,
      drag: 1,
      life: [0.3, 0.55],
      size: [0.03, 0.06],
      shape: 'square',
    });
    this.at(REASSEMBLE_GATHER_MS, () => {
      this.flashUnit(obj.id, 0.4);
      this.effects.ring(ground, BONE, 0.2, HEX_SIZE * 0.7, { life: 0.35, opacity: 0.7, additive: true });
      this.effects.burst({
        at: chest,
        count: 14,
        colors: BONE_COLORS,
        speed: [0.4, 1],
        up: 0.6,
        gravity: 2,
        drag: 2,
        life: [0.3, 0.6],
        size: [0.03, 0.05],
        blend: 'add',
      });
      obj.glow = { color: BONE, start: this.now, end: this.now + GLOW_MS };
    });
  }

  /** The ground under a unit where it is drawn now. */
  private feet(obj: UnitObj): THREE.Vector3 {
    return obj.group.position.clone().setY(this.groundY(obj) + 0.04);
  }

  /** The standing units in contact with `obj` as they are drawn now: its friends, or its foes. */
  private beside(obj: UnitObj, friends: boolean): UnitObj[] {
    const at = obj.group.position;
    return [...this.units.values()].filter(
      (o) =>
        o !== obj &&
        (o.owner === obj.owner) === friends &&
        !o.shown.dead &&
        !o.shown.knocked &&
        !o.fade &&
        Math.hypot(o.group.position.x - at.x, o.group.position.z - at.z) < HEX_STEP * 1.3,
    );
  }

  /**
   * Pincer: the striker and the friend on the far side of its foe close on it
   * like jaws — a bar of light through the foe, chevrons driving in from both
   * ends, a ring tightening under it, and the friend feinting in.
   */
  private pincerFx(strikerId: string, targetId: string): void {
    const s = this.units.get(strikerId);
    const t = this.units.get(targetId);
    if (!s || !t) return;
    const far = t.group.position.clone().multiplyScalar(2).sub(s.group.position);
    const friend = this.beside(t, false).find(
      (o) => o !== s && Math.hypot(o.group.position.x - far.x, o.group.position.z - far.z) < HEX_STEP * 0.5,
    );
    if (!friend) return;
    const mid = this.chest(t);
    this.effects.beam(this.chest(s), this.chest(friend), PINCER_COLOR, 0.03, { life: 0.6, opacity: 0.85 });
    for (const jaw of [s, friend]) {
      const from = this.chest(jaw).lerp(mid, 0.3);
      this.effects.icon('chevron', from, 0.4, {
        life: 0.5,
        color: PINCER_COLOR,
        rotation: this.screenAngle(jaw.group.position, t.group.position),
        drift: mid.clone().sub(from).multiplyScalar(0.6),
      });
    }
    this.effects.ring(this.feet(t), PINCER_COLOR, HEX_SIZE * 1.2, 0.3, { life: 0.5, opacity: 0.8, additive: true });
    const close = t.group.position.clone().sub(friend.group.position);
    this.setHeading(friend, close.clone());
    this.joltUnit(friend, close, 0.14, false, 320);
  }

  /**
   * Shieldwall: the defender and every friend standing with it raise shields
   * toward the blow, joined along the line, and the friends lean in to lock them.
   */
  private shieldwallFx(defenderId: string, attackerId: string): void {
    const d = this.units.get(defenderId);
    const a = this.units.get(attackerId);
    if (!d) return;
    const friends = this.beside(d, true);
    if (friends.length === 0) return;
    const toward = a ? a.group.position.clone().sub(d.group.position).setY(0).normalize().multiplyScalar(0.22) : new THREE.Vector3();
    const low = (o: UnitObj) => this.feet(o).setY(this.groundY(o) + 0.32);
    for (const o of [d, ...friends]) {
      this.effects.icon('shield', this.chest(o).add(toward), o === d ? 0.5 : 0.4, { life: 0.8, color: SHIELDWALL_COLOR, opacity: 0.9 });
      if (o === d) continue;
      this.effects.beam(low(d), low(o), SHIELDWALL_COLOR, 0.03, { life: 0.8, opacity: 0.7 });
      this.joltUnit(o, d.group.position.clone().sub(o.group.position), 0.08, false, 300);
    }
    this.effects.ring(this.feet(d), SHIELDWALL_COLOR, 0.3, HEX_SIZE * 0.9, { life: 0.5, opacity: 0.7, additive: true });
  }

  /** Rusher: the charge carries on into the blow — a deeper lunge, streaks trailing behind it and dirt thrown back. */
  private rushFx(attackerId: string, targetId: string): void {
    const a = this.units.get(attackerId);
    const d = this.units.get(targetId);
    if (!a || !d) return;
    const dir = d.group.position.clone().sub(a.group.position).setY(0).normalize();
    if (a.lunge) a.lunge.dir.multiplyScalar(RUSH_LUNGE);
    this.sound('whoosh-trait');
    const feet = this.feet(a);
    const behind = feet.clone().addScaledVector(dir, -HEX_SIZE * 0.7);
    const along = this.screenAngle(behind, feet);
    for (const lift of [0.2, 0.5, 0.8]) {
      this.effects.streak(behind.clone().setY(feet.y + lift * a.size + a.hover), along, 1.1 - lift * 0.4, 0.07, {
        life: 0.4,
        color: RUSH_COLOR,
        opacity: 0.85,
      });
    }
    this.effects.burst({
      at: feet,
      count: 12,
      colors: this.dustColors(feet),
      speed: [0.8, 1.8],
      dir: dir.clone().negate().setY(0.35),
      cone: 0.45,
      drag: 2.5,
      life: [0.4, 0.7],
      size: [0.1, 0.17],
      grow: 2,
      opacity: 0.75,
      jitter: 0.1,
    });
    if (this.cameraMode === 'cinematic') this.shakeCamera('nudge', 0.05, 220, dir);
  }

  /** Woodwise: the forest fights with it — leaves whirl up off the unit and it takes a green rim. */
  private woodwiseFx(id: string): void {
    const obj = this.units.get(id);
    if (!obj) return;
    const ground = this.feet(obj);
    this.effects.burst({
      at: this.chest(obj),
      count: 22,
      colors: LEAF_COLORS,
      speed: [0.5, 1.3],
      flat: true,
      up: 0.9,
      gravity: 1.8,
      drag: 1.8,
      life: [0.8, 1.3],
      size: [0.045, 0.085],
      shape: 'square',
      jitter: 0.3,
      floor: ground.y,
      bounce: 0,
    });
    this.effects.ring(ground, LEAF_GLOW, 0.25, HEX_SIZE * 0.85, { life: 0.6, opacity: 0.6, additive: true });
    obj.glow = { color: LEAF_GLOW, start: this.now, end: this.now + GLOW_MS };
  }

  /**
   * Whirling: with two or more foes on it, where anyone else would be
   * outnumbered, its blade sweeps the whole ring of them and each gives a little.
   */
  private whirlFx(id: string): void {
    const obj = this.units.get(id);
    if (!obj?.traits?.whirling || obj.shown.knocked) return;
    const foes = this.beside(obj, false);
    if (foes.length < 2) return;
    this.sound('whoosh-trait');
    const ground = this.feet(obj);
    this.effects.whirl(ground.clone().setY(ground.y + 0.4 * obj.size + obj.hover), WHIRL_COLOR, HEX_SIZE * 0.95, { life: 0.7, turns: 1.25, opacity: 1 });
    this.effects.ring(ground, WHIRL_COLOR, 0.3, HEX_STEP * 0.95, { life: 0.45, opacity: 0.55, additive: true });
    for (const foe of foes) this.joltUnit(foe, foe.group.position.clone().sub(obj.group.position), 0.07, false, 260);
  }

  /**
   * Immovable: the shove breaks on it. It digs in — a ring drawing tight under
   * it, grit thrown up from its heels, a stone rim — and whoever pushed bounces off.
   */
  private immovableFx(id: string, byId: string | null): void {
    const obj = this.units.get(id);
    if (!obj) return;
    this.sound('brace');
    this.hitStop(IMPACT_STOP_MS, [id]);
    const ground = this.feet(obj);
    this.effects.ring(ground, STONE, HEX_SIZE * 1.15, 0.38, { life: 0.4, opacity: 0.9, additive: true });
    this.effects.ring(ground, STONE, HEX_SIZE * 0.8, 0.38, { life: 0.55, opacity: 0.6, thick: true });
    this.effects.burst({
      at: ground,
      count: 16,
      colors: CHIP_COLORS,
      speed: [0.5, 1.3],
      flat: true,
      up: 1.5,
      gravity: 8,
      life: [0.4, 0.7],
      size: [0.035, 0.065],
      shape: 'square',
      jitter: 0.2,
      floor: ground.y,
    });
    this.dust(ground, 8, 1.1);
    obj.glow = { color: STONE, start: this.now, end: this.now + GLOW_MS };
    const by = byId ? this.units.get(byId) : undefined;
    if (by) this.joltUnit(by, by.group.position.clone().sub(obj.group.position), 0.16, false, 300);
    if (this.cameraMode === 'cinematic') this.shakeCamera('nudge', 0.05, 200, new THREE.Vector3(0, -1, 0));
  }

  /**
   * Trample: the trampler follows its blow through, and the ground takes a
   * stamp on each hex of `path` its victim is driven across (at `pace` ms a hex).
   */
  private trampleFx(by: UnitObj, path: THREE.Vector3[], at: number, pace: number): void {
    const push = path[path.length - 1]!.clone().sub(path[0]!).setY(0);
    this.at(at, () => {
      this.sound('whoosh-trait');
      this.joltUnit(by, push, 0.14, false, 380);
      this.shakeCamera('rumble', 0.035, 260);
    });
    path.slice(0, -1).forEach((p, i) =>
      this.at(at + i * pace, () => {
        const ground = p.clone().setY(p.y + TILE_TOP + 0.03);
        this.effects.ring(ground, this.dustColors(ground)[2]!, 0.15, HEX_SIZE * 0.85, { life: 0.4, opacity: 0.7, thick: true });
        this.dust(ground, 12, 1.4);
      }),
    );
  }

  /** A unit shoved off its feet hits the ground where the shove set it down: dust, a ripple and a jar of the camera. */
  private thumpFx(id: string): void {
    const obj = this.units.get(id);
    if (!obj || obj.state.dead) return;
    this.sound('knockdown');
    const ground = this.feet(obj);
    this.dust(ground, 12, 1.2);
    this.effects.ring(ground, this.dustColors(ground)[2]!, 0.2, HEX_SIZE * 0.8, { life: 0.4, opacity: 0.6 });
    if (this.cameraMode === 'cinematic') this.shakeCamera('nudge', 0.04, 180, new THREE.Vector3(0, -1, 0));
  }

  /**
   * Slippery: it ducks out of contact leaving afterimages behind, and every
   * foe that would have had a hack at it swings at the air where it stood.
   */
  private slipFx(obj: UnitObj): void {
    const foes = this.beside(obj, false);
    if (foes.length === 0) return;
    this.sound('whoosh-trait');
    // Along the bottom, not over the unit: a verdict there would cover the afterimages.
    this.rolls.addVerdict({ text: 'Slips away', detail: 'Slippery: no free hack', on: [obj.id], tone: 'neutral' }, this.now, 'bottom');
    const was = obj.group.position.clone();
    const gap = this.chest(obj);
    // One where it stood, then one every third of a hex over the first two it runs.
    for (let i = 0; i < SLIP_GHOSTS; i++) this.at(i * SLIP_GHOST_MS, () => this.afterimage(obj));
    this.dust(this.feet(obj), 6, 0.8);
    for (const foe of foes) {
      const swing = was.clone().sub(foe.group.position);
      this.setHeading(foe, swing.clone());
      this.joltUnit(foe, swing, 0.1, false, 260);
      this.effects.icon('arc', this.chest(foe).lerp(gap, 0.6), 0.5, {
        life: 0.3,
        opacity: 0.5,
        color: SLIP_COLOR,
        rotation: this.screenAngle(foe.group.position, was),
        additive: true,
      });
    }
  }

  /** A pale copy of a unit left standing where it is this instant, fading out. */
  private afterimage(obj: UnitObj, color = SLIP_COLOR, life = SLIP_GHOST_LIFE): void {
    const ghost = this.ghost(obj, obj.shownImage ?? obj.animator.base, color);
    if (!ghost) return;
    const { root, mat, map } = ghost;
    root.position.y += obj.hover;
    this.effects.add(
      root,
      life,
      (k) => {
        // Holds bright, then fades over its second half.
        mat.opacity = 0.85 * Math.min(1, (1 - k) / 0.5);
      },
      () => {
        mat.dispose();
        map.dispose();
      },
    );
  }

  /** Dumb: a question mark wobbles over its head as it is told to act. */
  private dumbFx(id: string): void {
    const obj = this.units.get(id);
    if (!obj) return;
    this.sound('dumb');
    // Beside its head, clear of the dice card that sits over it.
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const chest = this.chest(obj);
    const head = chest.setY(chest.y + 0.5 * obj.size).addScaledVector(camRight, -0.35);
    this.effects.icon('query', head, 0.5, { life: 1.1, rise: 0.15, color: QUERY_COLOR, rotation: 0.3, spin: -0.6 });
  }

  /**
   * Disloyal: it changes sides where it stands. Its old colours drain off it as
   * it wavers; then, in a white flash, it turns on its old friends in its new
   * side's colours, which burst out from under it.
   */
  private defectFx(id: string, to: Owner): void {
    const obj = this.units.get(id);
    if (!obj) return;
    this.sound('defect');
    const was = OWNER_COLORS[to === 0 ? 1 : 0];
    const now = OWNER_COLORS[to];
    const ground = this.feet(obj);
    const chest = this.chest(obj);
    this.effects.ring(ground, was, HEX_SIZE * 1.3, 0.25, { life: DEFECT_MS / 1000, opacity: 0.9, additive: true });
    this.effects.burst({
      at: chest,
      count: 16,
      colors: [was],
      speed: [0.3, 0.9],
      flat: true,
      up: 0.6,
      gravity: 4,
      drag: 1.5,
      life: [0.4, 0.7],
      size: [0.04, 0.07],
      shape: 'square',
      floor: ground.y,
    });
    this.joltUnit(obj, new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), 0.05, true, DEFECT_MS);
    this.at(DEFECT_MS, () => {
      obj.whiteout = PICK_FLASH;
      this.turnCoat(obj);
      this.setHeading(obj, obj.heading.clone().negate());
      this.effects.ring(ground, now, 0.25, HEX_SIZE * 1.6, { life: 0.6, opacity: 0.9, additive: true });
      this.effects.wall(ground, now, 0.2, HEX_SIZE * 1.1, 0.9, { life: 0.6, opacity: 0.6 });
      this.effects.burst({
        at: chest,
        count: 22,
        colors: [now, 0xffffff],
        speed: [0.4, 1.2],
        up: 1.1,
        gravity: 1.5,
        drag: 1.5,
        life: [0.5, 0.9],
        size: [0.04, 0.07],
        blend: 'add',
      });
      obj.glow = { color: now, start: this.now, end: this.now + GLOW_MS };
    });
  }

  /** Knocked down: the unit blinks out and back {@link BLINKS} times as it hits the ground. */
  private blinkUnit(obj: UnitObj): void {
    if (obj.state.dead) return; // finished off before it landed; the death has its own
    obj.blink = { start: this.now, end: this.now + BLINKS * BLINK_MS };
    this.sound('dizzy');
  }

  /**
   * 6d, 7a–7f. A killing blow: a shockwave — and for a gruesome one (dealt by
   * `killerId`, with a shot if `ranged`), a hit-stop opening on a flat
   * silhouette, slow motion, the killing stroke hanging in the air, a lurch of
   * the camera, ash, a wall of fear and a scorch that stays.
   */
  private killFx(obj: UnitObj, gruesome: boolean, shakenIds: string[], killerId: string | null = null, ranged = false): void {
    const ground = obj.group.position.clone().setY(this.groundY(obj) + 0.035);
    // One that goes over the edge or into lava is heard going (see lavaSplash); the rest cry out.
    if (obj.pushedOff) this.sound('pushed-off');
    else if (!obj.intoLava) this.voice(obj, 'death');
    if (gruesome) this.sound('gruesome-kill');
    if (gruesome && shakenIds.length > 0) this.sound('dread-wave');
    this.effects.ring(ground, 0xffffff, 0.2, 1.1, { life: 0.5, opacity: 0.85, additive: true });
    if (!gruesome) {
      if (killerId) this.hitStop(IMPACT_STOP_MS, [obj.id]);
      // The camera closed in on this one: let the fall play out slowly in its close-up.
      if (killerId && this.cameraMode === 'cinematic' && !this.handOnCamera) this.slowMotion(KILL_SLOW_MO_MS, KILL_SLOW_MO_SCALE);
      return;
    }
    // 7a: the heavy version — a freeze on impact (its first instants a flat
    // silhouette) easing out of slow motion, a bigger double shockwave, a hard
    // shake with a tilt of the camera, and a burst of ash and dark shards.
    this.hitStop(HIT_STOP_MS);
    this.silhouette = { until: this.shownNow + SILHOUETTE_MS, victim: obj.id, killer: killerId };
    this.slowMotion(SLOW_MO_MS);
    this.effects.ring(ground, 0xffffff, 0.3, 2.2, { life: 0.7, opacity: 0.9, additive: true });
    this.shakeCamera('rumble', 0.1, 380);
    const killer = killerId ? this.units.get(killerId) : undefined;
    if (ranged) this.speedLinesFx(this.chest(obj));
    if (killer) {
      this.slashFx(killer, obj, ranged);
      if (this.cameraMode !== 'off' && !this.handOnCamera) {
        const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
        const side = obj.group.position.clone().sub(killer.group.position).dot(camRight);
        this.cameraRoll = { start: this.wallNow, end: this.wallNow + ROLL_MS, amp: side >= 0 ? -ROLL : ROLL };
      }
    }
    const chest = this.chest(obj);
    this.effects.burst({
      at: chest,
      count: 36,
      colors: ASH_COLORS,
      speed: [0.8, 2.2],
      up: 0.5,
      gravity: 1.5,
      drag: 1.8,
      life: [0.6, 1.2],
      size: [0.07, 0.14],
      grow: 1.6,
      opacity: 0.85,
      jitter: 0.1,
    });
    this.effects.burst({
      at: chest,
      count: 14,
      colors: ASH_COLORS,
      speed: [1.8, 3.2],
      up: 1,
      gravity: 8,
      life: [0.5, 0.8],
      size: [0.04, 0.07],
      shape: 'square',
      floor: ground.y,
    });
    // 7b: fear spreads out to the edge of its reach as a pale wall, and every
    // friend it reaches — each about to test its nerve — starts and shudders as it passes.
    const reach = MORALE_RADIUS * HEX_STEP;
    this.effects.ring(ground, FEAR_COLOR, 0.2, reach, { life: FEAR_WAVE_MS / 1000, opacity: 0.55, thick: true });
    this.effects.ring(ground, FEAR_COLOR, 0.1, reach, { life: FEAR_WAVE_MS / 1000, opacity: 0.9 });
    this.effects.wall(ground, FEAR_WALL_COLOR, 0.2, reach, FEAR_WALL_HEIGHT, { life: FEAR_WAVE_MS / 1000, opacity: 0.7 });
    for (const id of shakenIds) {
      const friend = this.units.get(id);
      if (!friend) continue;
      // The ring spreads as 1 - (1 - k)³, so it reaches distance d at k = 1 - ∛(1 - d/reach).
      const d = Math.min(1, friend.group.position.distanceTo(obj.group.position) / reach);
      const when = (1 - Math.cbrt(1 - d)) * FEAR_WAVE_MS;
      this.at(when, () => {
        const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
        this.joltUnit(friend, camRight, 0.05, true, 420);
        const head = friend.group.position.clone().setY(friend.group.position.y + TILE_TOP + BADGE_HEIGHT + friend.hover + 0.1);
        this.effects.icon('alarm', head, 0.4, { life: 1.1, rise: 0.15, color: FEAR_WALL_COLOR });
      });
    }
    // 7f: a scorch burned into the ground where it died, lasting the rest of the
    // game (not in lava, which took the body).
    if (!obj.intoLava) {
      const cell = this.worldToCell(obj.targetPos);
      const y = cell ? this.surfaceAt(cell) : this.groundY(obj);
      this.effects.mark(`scorch:${obj.id}`, 'scorch', obj.targetPos.clone().setY(y + 0.008), SCORCH_SIZE, 0.8, true);
    }
  }

  /**
   * The long gathering before a gruesome kill, over `ms` (its blow landing
   * `toHit` ms from now): the killer's rim lights, dread is drawn in to it from
   * all round in waves, ash lifts off the ground, a heartbeat thuds — each beat
   * a ring closing under it and a knock of the camera, harder than the last —
   * and the victim sees it coming: it starts, and shakes until the blow lands.
   */
  private forebodeFx(a: UnitObj, d: UnitObj, ms: number, toHit: number): void {
    const feet = this.feet(a);
    const chest = this.chest(a);
    a.glow = { color: DREAD_COLOR, start: this.now, end: this.now + toHit };
    // Motes drawn in to the killer from a circle round it.
    const waves = 4;
    for (let w = 0; w < waves; w++) {
      this.at((w * ms) / waves, () => {
        const life = 0.32;
        for (let i = 0; i < 14; i++) {
          const turn = Math.random() * Math.PI * 2;
          const r = 0.75 + Math.random() * 0.45;
          const from = new THREE.Vector3(Math.cos(turn) * r, (Math.random() - 0.3) * 0.7, Math.sin(turn) * r);
          this.effects.burst({
            at: chest.clone().add(from),
            count: 1,
            colors: [DREAD_COLOR, 0xffffff, HALO_COLOR],
            speed: [(r / life) * 0.85, (r / life) * 0.85],
            dir: from.clone().negate(),
            cone: 0,
            life: [life, life],
            size: [0.06, 0.11],
            grow: 0.3,
            blend: 'add',
          });
        }
      });
    }
    // Ash and grit lifting off the ground round it.
    this.effects.burst({
      at: feet,
      count: 22,
      colors: ASH_COLORS,
      speed: [0, 0.15],
      flat: true,
      up: 0.55,
      gravity: -0.6,
      life: [ms / 1000, (ms / 1000) * 1.6],
      size: [0.03, 0.06],
      shape: 'square',
      opacity: 0.8,
      jitter: HEX_SIZE * 0.8,
    });
    // The heartbeat: each beat harder than the last.
    for (let b = 0; b < DREAD_BEATS; b++) {
      const strength = (b + 1) / DREAD_BEATS;
      this.at((b * ms) / DREAD_BEATS, () => {
        this.sound('heartbeat');
        this.effects.ring(feet, DREAD_COLOR, HEX_SIZE * (1.5 + 0.4 * strength), 0.25, {
          life: (ms / DREAD_BEATS / 1000) * 0.9,
          opacity: 0.5 + 0.4 * strength,
          thick: true,
          additive: true,
        });
        this.effects.pop('hoop', chest, 0.5, 1.1 + 0.5 * strength, { life: 0.3, color: DREAD_COLOR, opacity: 0.35 * strength });
        this.dust(feet, 6, 0.7);
        this.shakeCamera('rumble', 0.012 + 0.02 * strength, 180);
        if (this.cameraMode === 'cinematic') this.shakeCamera('nudge', 0.03 + 0.04 * strength, 200, new THREE.Vector3(0, -1, 0));
      });
    }
    // The victim sees it coming.
    const away = d.group.position.clone().sub(a.group.position).setY(0);
    const head = d.group.position.clone().setY(d.group.position.y + TILE_TOP + BADGE_HEIGHT + d.hover + 0.1);
    this.effects.icon('alarm', head, 0.42, { life: Math.min(1.1, toHit / 1000), rise: 0.12, color: FEAR_WALL_COLOR });
    this.joltUnit(d, away, 0.04, true, toHit);
  }

  /** 7d. A killer gathering itself for a gruesome blow over `ms`: dread closing in on it, motes rising, a rim of light. */
  private gatherFx(obj: UnitObj, ms: number): void {
    const ground = obj.group.position.clone().setY(this.groundY(obj) + 0.04);
    this.effects.ring(ground, DREAD_COLOR, HEX_SIZE * 1.4, 0.3, { life: ms / 1000, opacity: 0.8, additive: true });
    this.effects.burst({
      at: this.chest(obj),
      count: 18,
      colors: [DREAD_COLOR, 0xffffff, HALO_COLOR],
      speed: [0.1, 0.35],
      up: 0.4,
      gravity: -0.8, // they drift upward
      drag: 1,
      life: [0.4, 0.8],
      size: [0.03, 0.06],
      blend: 'add',
      jitter: 0.45,
    });
    obj.glow = { color: DREAD_COLOR, start: this.now, end: this.now + ms + 300 };
    this.shakeCamera('rumble', 0.03, ms);
    // The weapon catches the light at the top of the swing, and a last ring snaps shut on it.
    const glint = this.chest(obj);
    glint.y += 0.35 * obj.size;
    this.effects.icon('ting', glint, 0.85, { life: Math.min(0.4, ms / 1000), spin: 1.6, additive: true });
    this.effects.pop('burst', glint, 0.25, 0.8, { life: 0.22, color: DREAD_COLOR, opacity: 0.8 });
    this.effects.ring(ground, 0xffffff, HEX_SIZE * 1.1, 0.15, { life: (ms / 1000) * 0.7, opacity: 0.7, additive: true });
  }

  /**
   * 7e. The killing stroke, left hanging in the air through the slow motion: a
   * slash across the victim, or for a shot, a streak down its whole flight.
   */
  private slashFx(killer: UnitObj, victim: UnitObj, ranged: boolean): void {
    const at = this.chest(victim);
    const along = this.screenAngle(killer.group.position, victim.group.position);
    if (ranged) {
      const from = this.shotPoint(killer);
      const mid = from.clone().lerp(at, 0.5);
      // A shot with an arrow to watch leaves its own trail of smoke down the line instead.
      const missile = killer.anims.ranged?.some((c) => c.missile) === true;
      if (!missile) {
        this.effects.streak(mid, this.screenAngle(from, at), this.viewLength(from, at), 0.14, { life: SLASH_S, color: SLASH_COLOR, opacity: 0.9 });
      }
      this.effects.streak(at, along + Math.PI / 2, 0.9, 0.22, { life: SLASH_S * 0.8, color: SLASH_COLOR });
    } else {
      const tilt = Math.random() < 0.5 ? -0.6 : 0.6;
      this.effects.streak(at, along + tilt, 1.7, 0.32, { life: SLASH_S, color: SLASH_COLOR });
      this.effects.streak(at.clone().setY(at.y + 0.12), along + tilt * 1.25, 1.2, 0.12, { life: SLASH_S * 0.8, color: DREAD_COLOR, opacity: 0.8 });
    }
  }

  /**
   * A gruesome shot's impact: lines rushing in on it from all round, held on
   * the frozen frame (they run on board time) and gone as the slow motion starts.
   */
  private speedLinesFx(at: THREE.Vector3): void {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    for (let i = 0; i < SPEED_LINES; i++) {
      const turn = ((i + Math.random() * 0.6) / SPEED_LINES) * Math.PI * 2;
      const r = 0.75 + Math.random() * 0.45;
      const pos = at.clone().addScaledVector(right, Math.cos(turn) * r).addScaledVector(up, Math.sin(turn) * r);
      this.effects.streak(pos, turn - Math.PI / 2, 0.45 + Math.random() * 0.35, 0.05, {
        life: 0.4,
        color: i % 3 === 0 ? DREAD_COLOR : SLASH_COLOR,
        opacity: 0.85,
      });
    }
  }

  /** How long the segment a–b looks across the view: its length with the part along the line of sight taken out. */
  private viewLength(a: THREE.Vector3, b: THREE.Vector3): number {
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const d = b.clone().sub(a);
    return d.addScaledVector(forward, -d.dot(forward)).length();
  }

  /** 6b. Break a dying unit into motes sampled from its own pixels, which drift up and away. */
  private shatter(obj: UnitObj): void {
    const atlas = obj.atlas;
    const rect = atlas && (atlas.frames.get(obj.shownImage ?? '') ?? atlas.frames.get(obj.animator.base));
    if (!atlas || !rect) return;
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    const toCam = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
    const flip = obj.faceRight ? 1 : -1;
    const px = SPRITE_PX * obj.size;
    const stride = Math.max(2, Math.round(atlas.cellW / 26));
    const origin = obj.group.position.clone().add(obj.facing.position);
    for (let y = 0; y < atlas.cellH; y += stride) {
      for (let x = 0; x < atlas.cellW; x += stride) {
        const u = rect.u + ((x + stride / 2) / atlas.cellW) * atlas.repeatU;
        const v = rect.v + (1 - (y + stride / 2) / atlas.cellH) * atlas.repeatV;
        const color = atlas.colorAt(u, v);
        if (color === null) continue;
        const lx = (x + stride / 2 - atlas.anchorX) * px * flip;
        const ly = (atlas.anchorY - y - stride / 2) * px;
        const at = origin
          .clone()
          .addScaledVector(camRight, lx)
          .addScaledVector(toCam, -ly * Math.sin(this.spriteLean))
          .setY(origin.y + ly * Math.cos(this.spriteLean));
        this.effects.burst({
          at,
          count: 1,
          colors: [color],
          speed: [0.1, 0.45],
          up: 0.35 + Math.random() * 0.3,
          gravity: -0.4, // they drift upward
          drag: 0.6,
          life: [0.7, 1.4],
          size: [stride * px * 0.9, stride * px * 1.1],
          grow: 0.3,
          shape: 'square',
        });
      }
    }
  }

  /**
   * A glowing see-through copy of a unit's cutout where it is now, showing
   * `image` (or its standing frame): the caller animates it, and frees its `mat` and `map`.
   */
  private ghost(obj: UnitObj, image: string, color: number) {
    const atlas = obj.atlas;
    const rect = atlas && (atlas.frames.get(image) ?? atlas.frames.get(obj.animator.base));
    const source = obj.sprite.material.map;
    if (!atlas || !rect || !source) return null;
    const map = source.clone(); // shares the uploaded image; its own UV window
    map.offset.set(rect.u, rect.v);
    map.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map,
      color,
      transparent: true,
      opacity: 0,
      alphaTest: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(obj.sprite.geometry, mat); // the shared quad, not owned
    const mirror = new THREE.Group();
    mirror.scale.x = obj.mirror.scale.x;
    mirror.add(mesh);
    const tilt = new THREE.Group();
    tilt.rotation.x = -this.spriteLean;
    tilt.add(mirror);
    const root = new THREE.Group();
    root.add(tilt);
    // From wherever the body is now (a unit shoved off the table has slid away from its hex).
    root.position.set(
      obj.group.position.x + obj.facing.position.x,
      obj.group.position.y + TILE_TOP + BASE_HEIGHT,
      obj.group.position.z + obj.facing.position.z,
    );
    root.rotation.y = obj.facing.rotation.y;
    return { root, mesh, mat, map };
  }

  /** 6a. A pale ghost of the fallen unit, standing as it did in life, rises and fades. */
  private releaseWisp(obj: UnitObj): void {
    const ghost = this.ghost(obj, obj.animator.base, WISP_COLOR);
    if (!ghost) return;
    this.sound('ghost-rise');
    const { root, mesh, mat, map } = ghost;
    const y0 = root.position.y;
    const { x: sx, y: sy } = obj.sprite.scale;
    this.effects.add(
      root,
      1.5,
      (k) => {
        root.position.y = y0 + k * 1.1;
        // Thins and stretches as it goes up.
        mesh.scale.set(sx * (1 - 0.35 * k), sy * (1 + 0.2 * k), 1);
        mat.opacity = 0.55 * Math.min(1, k * 5) * (1 - k);
      },
      () => {
        mat.dispose();
        map.dispose();
      },
    );
  }

  /** 6c. Leave a faint token where a unit fell, until the round ends. */
  /** A body hitting lava: a flash ring, embers flung up and a puff of dark smoke. */
  private lavaSplash(at: THREE.Vector3): void {
    this.effects.ring(at.clone().setY(at.y + 0.02), 0xff8a2a, 0.1, HEX_SIZE * 0.9, { life: 0.5, additive: true });
    this.sound('lava-sink');
    this.effects.burst({
      at: at.clone().setY(at.y + 0.05),
      count: 26,
      colors: EMBER_COLORS,
      speed: [0.5, 1.4],
      up: 1.6,
      gravity: 2.2,
      drag: 1.2,
      life: [0.5, 1.1],
      size: [0.04, 0.09],
      blend: 'add',
      jitter: HEX_SIZE * 0.3,
    });
    this.effects.burst({
      at: at.clone().setY(at.y + 0.1),
      count: 10,
      colors: SMOKE_COLORS,
      speed: [0.05, 0.25],
      up: 0.5,
      drag: 1.5,
      life: [0.9, 1.5],
      size: [0.14, 0.24],
      grow: 2.5,
      opacity: 0.55,
      jitter: HEX_SIZE * 0.25,
    });
  }

  private markFallen(obj: UnitObj): void {
    const cell = this.worldToCell(obj.targetPos);
    const y = cell ? this.surfaceAt(cell) : this.groundY(obj);
    this.effects.mark(obj.id, 'fallen', obj.targetPos.clone().setY(y + 0.015), HEX_SIZE * 0.75, 0.5);
  }

  /** A blow turned aside by armor: a steel shield flares on the unit and sparks glance off it. */
  private armorFx(id: string): void {
    const obj = this.units.get(id);
    if (!obj) return;
    this.sound('armor-clang');
    this.hitStop(IMPACT_STOP_MS, [id]);
    this.flashUnit(id, 0.35);
    const chest = this.chest(obj);
    this.effects.icon('shield', chest, 0.5, { life: 0.45, color: STEEL });
    this.effects.burst({
      at: chest,
      count: 18,
      colors: STEEL_COLORS,
      speed: [1.5, 3],
      up: 0.6,
      gravity: 6,
      drag: 1.5,
      life: [0.2, 0.45],
      size: [0.03, 0.06],
      shape: 'square',
      blend: 'add',
    });
  }

  /** 8a–8b. A Tough save: a gold ward flares and shatters, and the unit freezes mid-death with a gold rim. */
  private toughFx(id: string): void {
    const obj = this.units.get(id);
    if (!obj) return;
    this.sound('tough-save');
    this.hitStop(IMPACT_STOP_MS, [id]);
    this.flashUnit(id, 0.5);
    const chest = this.chest(obj);
    const ground = obj.group.position.clone().setY(this.groundY(obj) + 0.04);
    this.effects.ring(ground, GOLD, 0.6, 0.35, { life: 0.35, opacity: 0.95, additive: true });
    this.effects.icon('shield', chest, 0.55, { life: 0.35, color: GOLD });
    this.at(300, () =>
      this.effects.burst({
        at: chest,
        count: 26,
        colors: GOLD_COLORS,
        speed: [1, 2.4],
        up: 0.4,
        gravity: 4,
        drag: 1.5,
        life: [0.4, 0.8],
        size: [0.04, 0.08],
        shape: 'square',
        blend: 'add',
      }),
    );
    obj.glow = { color: GOLD, start: this.now, end: this.now + GLOW_MS };
    // Caught in the first frame of its death until the save lets it drop.
    const first = obj.anims.death?.frames[0];
    if (first) obj.animator.play({ frames: [[first[0], TOUGH_HITCH_MS]] });
  }

  /** 9a–9b. Where a shot ends: a spark in its target, a flick of dust past it, or chips off the cover. */
  private shotFx(at: THREE.Vector3, ending: ShotEnding): void {
    this.sound(ending === 'hit' ? 'arrow-hit' : ending === 'cover' ? 'arrow-cover' : 'arrow-miss');
    if (ending === 'hit') {
      this.effects.burst({
        at,
        count: 12,
        colors: SPARK_COLORS,
        speed: [1, 2.2],
        gravity: 3,
        drag: 3,
        life: [0.15, 0.3],
        size: [0.035, 0.06],
        blend: 'add',
      });
    } else if (ending === 'miss') {
      this.dust(at, 7, 0.8);
    } else {
      this.effects.burst({
        at,
        count: 12,
        colors: CHIP_COLORS,
        speed: [0.8, 1.8],
        up: 0.8,
        gravity: 7,
        life: [0.4, 0.7],
        size: [0.035, 0.065],
        shape: 'square',
        floor: at.y - 0.3,
      });
      this.effects.burst({
        at,
        count: 6,
        colors: SPARK_COLORS,
        speed: [1, 2],
        life: [0.1, 0.2],
        size: [0.03, 0.05],
        blend: 'add',
      });
    }
  }

  /** 10a. A guard's riposte: crossed blades over the guard as it answers. */
  private guardFx(guardId: string): void {
    const obj = this.units.get(guardId);
    if (!obj) return;
    // Above the Guard badge it answers from.
    const at = obj.group.position.clone().setY(obj.group.position.y + TILE_TOP + BADGE_HEIGHT + BADGE_SIZE + obj.hover);
    this.effects.icon('blades', at, 0.42, { life: 0.8, rise: 0.12 });
  }

  /** 10a. A riposte that stops the attack: a sharp gold arc and sparks where it meets the attacker. */
  private parryFx(guardId: string, attackerId: string): void {
    const g = this.units.get(guardId);
    const a = this.units.get(attackerId);
    if (!g || !a) return;
    this.hitStop(IMPACT_STOP_MS, [attackerId]);
    const at = this.contact(g, a);
    this.effects.icon('arc', at, 0.85, {
      life: 0.4,
      color: GOLD,
      rotation: this.screenAngle(g.group.position, a.group.position),
      additive: true,
    });
    this.effects.burst({
      at,
      count: 16,
      colors: GOLD_COLORS,
      speed: [1.4, 2.8],
      gravity: 5,
      drag: 2,
      life: [0.2, 0.4],
      size: [0.035, 0.065],
      blend: 'add',
    });
  }


  private flashUnit(id: string, amount: number): void {
    const obj = this.units.get(id);
    if (obj) obj.flash = Math.max(obj.flash, amount);
  }

  /** Blank a unit to a white silhouette for a moment: it has just been picked to activate. */
  private flashPick(id: string): void {
    const obj = this.units.get(id);
    if (obj) obj.whiteout = PICK_FLASH;
  }

  /** Make a pick the player didn't make plain: flash, a swelling ring and a glow in its side's colour. */
  private markOpponentPick(id: string): void {
    this.flashPick(id);
    const obj = this.units.get(id);
    if (!obj) return;
    obj.pulse = { start: this.now, end: this.now + OPPONENT_PICK_PULSE_MS };
    obj.glow = { color: OWNER_COLORS[obj.owner]!, start: this.now, end: this.now + OPPONENT_PICK_GLOW_MS };
  }

  /** Draw a short-lived bolt between two points (a shot without a missile image). */
  private addTracer(a: THREE.Vector3, b: THREE.Vector3, color: number): void {
    const arc = shotArc(a, b, SHOT_ARC);
    const points = Array.from({ length: 17 }, (_, i) => arcPoint(a, b, arc, i / 16));
    const geo = new THREE.BufferGeometry().setFromPoints(points);
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
    // A hit-stop holds board time still, and a slow motion slows it, while the
    // wall clock (and the camera shake) runs on.
    const wallDt = Math.min(rawDt, 0.25) * 1000 * this.animSpeed;
    this.wallNow += wallDt;
    this.shownNow += Math.min(rawDt * 1000, SHOWN_FRAME_MAX_MS) * this.animSpeed;
    const dtMs = wallDt * this.timeScale();    this.now += dtMs;
    for (let i = 0; i < this.timeline.length; ) {
      const step = this.timeline[i]!;
      if (step.at <= this.now) {
        this.timeline.splice(i, 1);
        step.fn();
      } else i++;
    }

    this.stepCamera();
    this.stepKeyPan(Math.min(rawDt, 0.1));
    this.clampCameraTarget();
    this.controls.update();
    this.followPitch();

    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    for (const obj of this.units.values()) this.animateUnit(obj, dtMs, lerp, camRight);
    this.grade();
    this.animateMissiles();
    this.animateRoutes();
    this.stepZoneGlow();
    this.effects.update(dtMs);
    this.rolls.update(this.now, this.projectUnit);
    // Lava flows on the wall clock, so a hit-stop doesn't freeze it; wrapped
    // hourly to keep the shaders' float maths precise.
    const lavaTime = (this.wallNow / 1000) % 3600;
    if (this.lavaSurface) this.lavaSurface.time = this.wallNow;
    if (this.lavaEmbers) this.lavaEmbers.time = lavaTime;

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

    // Shake and tilt the camera for this frame only, so the orbit controls never see it.
    const shake = this.shakeOffset();
    const roll = this.rollAngle();
    this.camera.position.add(shake);
    this.camera.rotateZ(roll);
    this.backdrop.update(this.camera);
    this.renderer.render(this.scene, this.camera);
    this.camera.rotateZ(-roll);
    this.camera.position.sub(shake);
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
    const pick = this.pickTarget();
    if (pick.unitId) this.onUnitClick?.(pick.unitId);
    else if (pick.cell) this.onCellClick?.(pick.cell);
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
    // Hover resolves exactly as a click would, so the preview shows what it commits.
    const pick = this.pickTarget();
    this.hoverUnitId = pick.unitId ?? null;
    if (this.pickThrough && this.interactive) {
      this.renderer.domElement.style.cursor = pick.actionable ? 'pointer' : 'default';
    }
    // A figure stands over its own hex; report that rather than the tile behind it.
    const target = pick.unitId ? this.units.get(pick.unitId)?.targetPos : undefined;
    this.setHover(target ? this.worldToCell(target) : pick.cell);
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

  /**
   * What a click on the current ray lands on. Plainly, the nearest opaque unit
   * figure, else the nearest hex. With {@link pickThrough} the ray first passes
   * through figures and trees it can't act on (an ally in front, a bystander, a
   * forest on an unreachable hex) to the nearest target unit or reachable hex
   * behind them. The ground itself stays solid, so a hex hidden behind a hill is
   * never picked. With nothing actionable on the ray, the plain pick stands.
   */
  private pickTarget(): { unitId?: string; cell: Vec | null; actionable: boolean } {
    const hits: { distance: number; unitId?: string; cell?: Vec; feature?: boolean }[] = [];
    const meshes: THREE.Object3D[] = [];
    for (const obj of this.units.values()) if (obj.group.visible) meshes.push(obj.group);
    for (const h of this.raycaster.intersectObjects(meshes, true)) {
      if (this.isSolidHit(h)) hits.push({ distance: h.distance, unitId: h.object.userData.unitId as string });
    }
    // Tile and feature hits resolve raised hexes by their top or side faces.
    for (const h of this.raycaster.intersectObjects(this.tiles, false)) {
      const cell = h.faceIndex != null ? (h.object.userData.cells as Vec[])[h.faceIndex] : undefined;
      if (cell) hits.push({ distance: h.distance, cell, feature: h.object.userData.feature === true });
    }
    const plane = hits.some((h) => h.cell) ? null : this.pickPlane();
    if (plane) hits.push({ distance: plane.distance, cell: plane.cell });
    hits.sort((a, b) => a.distance - b.distance);
    const reachable = (c: Vec) => this.clickableCells.has(`${c.x},${c.y}`);

    if (this.pickThrough && this.interactive) {
      for (const h of hits) {
        if (h.unitId) {
          if (this.clickableUnits.has(h.unitId)) return { unitId: h.unitId, cell: null, actionable: true };
        } else if (h.cell) {
          if (reachable(h.cell)) return { cell: h.cell, actionable: true };
          if (!h.feature) break; // the ground hides whatever lies beyond it
        }
      }
    }
    // Units first (their meshes carry userData.unitId), then the nearest hex.
    const unitId = hits.find((h) => h.unitId)?.unitId;
    if (unitId) return { unitId, cell: null, actionable: this.clickableUnits.has(unitId) };
    const cell = hits.find((h) => h.cell)?.cell ?? null;
    return { cell, actionable: cell !== null && reachable(cell) };
  }

  /** The board cell under the current ray: nearest tile/feature hit, else the ground plane. */
  private pickCell(): Vec | null {
    // The nearest tile or feature hit resolves raised hexes by their top or side faces.
    const hit = this.raycaster.intersectObjects(this.tiles, false)[0];
    const tileCell = hit?.faceIndex != null ? (hit.object.userData.cells as Vec[])[hit.faceIndex] : undefined;
    return tileCell ?? this.pickPlane()?.cell ?? null;
  }

  /** Where the current ray meets the ground plane, off the tiles. */
  private pickPlane(): { cell: Vec; distance: number } | null {
    const point = new THREE.Vector3();
    const cell = this.raycaster.ray.intersectPlane(this.groundPlane, point) ? this.worldToCell(point) : null;
    return cell && { cell, distance: this.raycaster.ray.origin.distanceTo(point) };
  }

  /** A cutout's quad is larger than its figure: only count clicks on opaque pixels. */
  private isSolidHit(hit: THREE.Intersection): boolean {
    if (!hit.object.userData.isCutout || !hit.uv) return true;
    const obj = this.units.get(hit.object.userData.unitId as string);
    const map = obj?.sprite.material.map;
    if (!obj?.atlas || !map) return false;
    return obj.atlas.alphaAt(map.offset.x + hit.uv.x * map.repeat.x, map.offset.y + hit.uv.y * map.repeat.y) > 0;
  }

  /** Pixels per world unit at unit distance, which keeps point sprites sized in world units. */
  private particleScale(): number {
    const h = (this.container.clientHeight || 1) * this.renderer.getPixelRatio();
    return h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.effects.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
    if (this.lavaEmbers) this.lavaEmbers.scale = this.particleScale();
    this.refitOpening();
  }

  /**
   * Set the opening shot, at its own viewing angle: the pivot on the middle of
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
    this.standBehindHome(state);
    const table = this.camera.position.length();
    this.controls.minDistance = 3;
    this.controls.maxDistance = table * 1.8;
    // Swing the same viewing angle onto the units: only the pivot and the
    // distance move, so every match opens at the same angle.
    const living = state.units.filter((u) => !u.dead);
    const points = living.map((u) => this.unitWorld(u.pos));
    // The cutouts aren't loaded yet, so a flyer's hover and a Big unit's height are taken from its traits.
    const head = Math.max(
      FOLLOW_HEAD,
      ...living.map(
        (u) => (airborne(state, u) ? FLY_HOVER : 0) + BASE_HEIGHT + BODY_HEIGHT * (u.traits.big ? BIG_SCALE : 1),
      ),
    );
    const start = this.startView(points, head);
    if (start) {
      const dir = this.camera.position.clone().normalize();
      this.controls.target.copy(start.target);
      this.camera.position.copy(start.target).addScaledVector(dir, start.dist);
    }
    this.followPitch();
    this.homeDist = start ? start.dist : table;
    this.playerView = { ...this.currentView(), dist: this.homeDist };
    this.opening = start ? { points, head, ...start } : null;
    this.controls.update();
    this.controls.saveState();
  }

  /**
   * On an upright canvas (a phone held in portrait) a table seen side-on runs
   * off both edges, so turn the opening shot to stand behind the home seat's
   * warband and look down the table at the enemy, to the nearest quarter turn.
   */
  private standBehindHome(state: GameState): void {
    if (this.camera.aspect >= 1) return;
    const side = (home: boolean): THREE.Vector3[] =>
      state.units.filter((u) => !u.dead && (u.owner === this.homeSeat) === home).map((u) => this.unitWorld(u.pos));
    const mine = side(true);
    const theirs = side(false);
    if (mine.length === 0 || theirs.length === 0) return;
    const toEnemy = middle(theirs).sub(middle(mine)).setY(0);
    if (toEnemy.lengthSq() < 1e-6) return;
    const s = new THREE.Spherical().setFromVector3(this.camera.position);
    s.theta = Math.round(Math.atan2(-toEnemy.x, -toEnemy.z) / (Math.PI / 2)) * (Math.PI / 2);
    this.camera.position.setFromSpherical(s);
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
    if (!open || this.cam || this.handOnCamera) return;
    const dist = this.camera.position.distanceTo(this.controls.target);
    if (this.controls.target.distanceTo(open.target) > 0.01 || Math.abs(dist - open.dist) > 0.01) return;
    const start = this.startView(open.points, open.head);
    if (!start) return;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(start.target);
    this.camera.position.copy(start.target).addScaledVector(dir, start.dist);
    this.homeDist = start.dist;
    this.playerView = this.currentView();
    this.opening = { points: open.points, head: open.head, ...start };
    this.controls.update();
    this.controls.saveState();
  }

  /**
   * Where to stand so every living unit is in view: the pivot in the middle of
   * them, and the closest distance that still holds them all — which pulls back
   * out again when a wide deployment would otherwise run off the edges of the
   * canvas. Null when nothing is deployed.
   */
  private startView(points: THREE.Vector3[], head: number): { target: THREE.Vector3; dist: number } | null {
    if (points.length === 0) return null;
    const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3()).setY(0);
    // Stand as close as the units allow, judged by the same test the follow
    // camera uses (every unit, and the dice card over its head, comfortably
    // inside the frame) so the opening shot isn't one the first blow has to pan
    // away from. Fit is monotonic in the distance, so halve the range onto it.
    let lo = Math.max(this.controls.minDistance, this.fitDistance(START_MIN_SPAN)); // may be too close
    let hi = this.controls.maxDistance; // as far out as the player could zoom
    const { yaw } = this.currentView();
    if (lo >= hi || !this.inView(points, { target, dist: hi, yaw }, head)) return { target, dist: hi };
    for (let i = 0; i < START_FIT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (this.inView(points, { target, dist: mid, yaw }, head)) hi = mid;
      else lo = mid;
    }
    return { target, dist: hi };
  }

  /**
   * A unit's point `height` above its base, in container pixels (null when
   * behind the camera) — how anything drawn in DOM over the board finds a unit.
   * A flyer's base is where it floats, so a card over it clears its body.
   */
  projectUnit = (id: string, height: number): { x: number; y: number } | null => {
    const obj = this.units.get(id);
    if (!obj) return null;
    const p = obj.group.position.clone();
    p.y += TILE_TOP + obj.hover + height;
    p.project(this.camera);
    if (p.z > 1) return null;
    return {
      x: ((p.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - p.y) / 2) * this.container.clientHeight,
    };
  };

  /** The player is steering the camera (a pointer on it, or WASD), so scripted moves keep off it. */
  private get handOnCamera(): boolean {
    return this.downPos !== null || this.keyPanning;
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!(e.code in KEY_PAN_CODES) || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    this.panKeys.add(e.code as keyof typeof KEY_PAN_CODES);
    // A hand on the camera takes it back, as a drag does.
    this.keyPanning = true;
    this.cam = null;
    this.planned = null;
    this.opening = null;
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.panKeys.delete(e.code as keyof typeof KEY_PAN_CODES);
  };

  /** Keys let go while the window is away never send their keyup. */
  private handleBlur = (): void => {
    this.panKeys.clear();
  };

  /**
   * Slide the camera over the ground with WASD, relative to where it faces:
   * the velocity eases toward the held direction and glides to a stop on release.
   * Runs on the wall clock, so a hit-stop doesn't freeze it.
   */
  private stepKeyPan(dt: number): void {
    if (!this.keyPanning) return;
    const want = new THREE.Vector2();
    for (const code of this.panKeys) want.add(new THREE.Vector2(...KEY_PAN_CODES[code]));
    const dist = this.camera.position.distanceTo(this.controls.target);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(dist * KEY_PAN_SPEED);
    const ease = want.lengthSq() > 0 ? KEY_PAN_EASE_IN : KEY_PAN_EASE_OUT;
    this.panVel.lerp(want, 1 - Math.exp(-dt / ease));
    if (want.lengthSq() === 0 && this.panVel.length() < dist * 0.005) {
      this.panVel.set(0, 0);
      this.keyPanning = false;
      this.rememberPlayerView();
      return;
    }
    const forward = this.controls.target.clone().sub(this.camera.position).setY(0).normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const step = right.multiplyScalar(this.panVel.x * dt).addScaledVector(forward, this.panVel.y * dt);
    this.controls.target.add(step);
    this.camera.position.add(step);
  }

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

/** A kill about to play: who deals it, who dies, and which friends of the dead will test their nerve. */
interface Kill {
  killer: string;
  victim: string;
  shaken: string[];
}

type Blow = Extract<GameEvent, { type: 'AttackResolved' | 'ShotResolved' | 'GuardRiposte' | 'FreeHackResolved' }>;

const isBlow = (e: GameEvent): e is Blow =>
  e.type === 'AttackResolved' || e.type === 'ShotResolved' || e.type === 'GuardRiposte' || e.type === 'FreeHackResolved';

/**
 * The kill a blow between `pair` makes, or null when its loser lives (the blow
 * didn't kill, or Tough turned it into a knockdown). `after` is the rest of the
 * batch: the victim's death, and the nerve checks it causes, come before the
 * next blow.
 */
function killOf(e: Blow, pair: [string, string], after: readonly GameEvent[]): Kill | null {
  const victim = e.result.startsWith('defender') ? pair[1] : pair[0];
  const killer = victim === pair[1] ? pair[0] : pair[1];
  const next = after.findIndex(isBlow);
  const until = next < 0 ? after : after.slice(0, next);
  const k = until.findIndex((x) => x.type === 'UnitKilled' && x.unitId === victim);
  if (k < 0) return null;
  return { killer, victim, shaken: shakenBy(until.slice(k + 1)) };
}

/** Whether `unitId` is knocked down before the next blow in `after`: the blow that shoved it also floors it. */
function fallsAfter(unitId: string, after: readonly GameEvent[]): boolean {
  const next = after.findIndex(isBlow);
  return (next < 0 ? after : after.slice(0, next)).some((x) => x.type === 'UnitKnockedDown' && x.unitId === unitId);
}

/**
 * Whether the blow `after` follows leaves `unitId` on the ground where it
 * stood, and no worse: knocked down before the next blow without being shoved
 * there, saved by Tough from a kill, or killed.
 */
function flooredBy(unitId: string, after: readonly GameEvent[]): boolean {
  const next = after.findIndex(isBlow);
  const until = (next < 0 ? after : after.slice(0, next)).filter((x) => 'unitId' in x && x.unitId === unitId);
  return (
    until.some((x) => x.type === 'UnitKnockedDown') &&
    !until.some((x) => x.type === 'UnitRecoiled' || x.type === 'ToughnessSaved' || x.type === 'UnitKilled')
  );
}

/** Whether the blow `after` follows leaves `unitId`'s body on its own hex: not shoved off the table or into lava. */
function fallsWhereItStood(unitId: string, after: readonly GameEvent[]): boolean {
  const next = after.findIndex(isBlow);
  return !(next < 0 ? after : after.slice(0, next)).some(
    (x) =>
      (x.type === 'UnitPushedOff' || x.type === 'UnitPushedIntoLava' || x.type === 'UnitFellIntoLava') &&
      x.unitId === unitId,
  );
}

/** The units testing their nerve over a death: the run of checks that comes straight after it. */
function shakenBy(after: readonly GameEvent[]): string[] {
  const next = after.findIndex((x) => x.type !== 'NerveCheck');
  return (next < 0 ? after : after.slice(0, next)).flatMap((x) => (x.type === 'NerveCheck' ? [x.unitId] : []));
}

/**
 * `clip` with the frame showing just before `at` ms (the top of a swing, a bow
 * at full draw) held `ms` longer, and its moment of impact moved with it.
 */
function holdPeak<C extends Clip>(clip: C, at: number, ms: number): C {
  const hitMs = clip.hitMs ?? clipDuration(clip) / 2;
  let end = 0;
  let held = false;
  const frames = clip.frames.map(([image, d]): [string, number] => {
    end += d;
    if (held || end < at) return [image, d];
    held = true;
    return [image, d + ms];
  });
  const last = frames[frames.length - 1];
  if (!held && last) last[1] += ms;
  return { ...clip, frames, hitMs: hitMs + ms };
}

/**
 * Whether a sprite's move clip actually animates. Many Wesnoth ones hold a single
 * pose (a rider's "moving" frame) or just the base image, and still want the hop.
 */
function hasWalkFrames(animator: UnitAnimator): boolean {
  return new Set(animator.anims.move?.frames.map(([f]) => f)).size > 1;
}
