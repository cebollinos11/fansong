import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { vecKey, type BoardData, type GameEvent, type GameState, type Vec } from '@fansong/engine';
import { loadSpriteAtlas, projectileTexture, type SpriteAtlas } from './spriteTextures.js';
import { animationsFor, clipDuration, framesOf, type Clip, type RangedClip, type SpriteAnimations } from './unitAnimations.js';
import { UnitAnimator } from './unitAnimator.js';
import { featureLayout, type FeaturePiece } from './features.js';
import { hexElevation, surfaceY, TILE_TOP, tileHeight, tileSideColor, tileTopColor } from './terrain.js';
import { spriteFor } from './unitSprites.js';

/** Everything the board needs to draw one frame's worth of interaction state. */
export interface BoardViewModel {
  state: GameState;
  /** Cells the active unit may move into (Move command targets). */
  moveTargets: Vec[];
  /** Enemy unit ids the active unit may attack. */
  attackTargetIds: string[];
  /** Own units that may be activated (awaitingActivation phase). */
  selectableUnitIds: string[];
  /** Unit the human has selected but not yet committed dice for. */
  selectedUnitId: string | null;
  /** Whether the local human may currently interact. */
  interactive: boolean;
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
const ATTACK_COLOR = 0xff5252;
const SELECT_COLOR = 0xffd54a;
const GUARD_COLOR = 0x53e0d0; // ring on a unit holding a Guard stance
const SHOT_COLOR = 0x9fd0ff; // ranged tracer, for a shooter without a missile image

// Units are paper cutouts: a Wesnoth sprite standing upright on a round base.
const BASE_RADIUS = 0.36;
const BASE_HEIGHT = 0.06;
const SPRITE_PX = 1.8 / 72; // world units per sprite pixel (a 72px Wesnoth hex ≈ 1.8)
const SPRITE_LEAN = 0.18; // lean back (top away from the camera, radians) so the steep view doesn't squash it

// Animation timing (ms). Clip timings come from Wesnoth; these fill the gaps.
const LUNGE = 0.3; // how far (world units) a melee strike leans into its target
const MOVE_ANIM_MS = 600; // the slide between hexes, roughly (see the position lerp)
const DEFEND_LEAD_MS = 126; // Wesnoth's defend reaction starts this long before impact
const DEATH_FADE_MS = 600; // fade after a death clip (or instead of one)
const ROUT_MS = 700; // a routed unit flees toward its own board edge while fading
const MAX_QUEUE_MS = 1500; // most a new batch waits behind the previous one's animations

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

/** The status flags that change how a unit is drawn. */
interface UnitFlags {
  dead: boolean;
  knocked: boolean;
  guarding: boolean;
}

interface UnitObj {
  owner: 0 | 1;
  group: THREE.Group;
  /** Turns the cutout to face the camera (yaw only, so it stays upright); carries the melee lunge. */
  facing: THREE.Group;
  /** Knockdown pivot at the cutout's feet. */
  tilt: THREE.Group;
  /** Flips the cutout to face screen-left. */
  mirror: THREE.Group;
  sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  base: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  anims: SpriteAnimations;
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
  lunge: { dir: THREE.Vector3; start: number; hit: number; end: number } | null;
  /** 0..1 transient hit flash, decays each frame. */
  flash: number;
}

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

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly resizeObserver: ResizeObserver;

  private readonly units = new Map<string, UnitObj>();
  private readonly tracers: Tracer[] = [];
  private readonly missiles: Missile[] = [];
  /** Deferred animation steps, run once board time reaches `at` (ms). */
  private readonly timeline: { at: number; fn: () => void }[] = [];
  /** Board time (ms) since the view was created; drives all animation. */
  private now = 0;
  /** When the current batch of combat animations finishes. */
  private busyUntil = 0;
  /** Dev aid: `?animSpeed=0.25` plays animations at quarter speed. */
  private readonly animSpeed = import.meta.env.DEV
    ? Number(new URLSearchParams(window.location.search).get('animSpeed')) || 1
    : 1;
  private readonly highlightGroup = new THREE.Group();
  /** Board tiles and feature meshes, raycast for cell picking (each carries `userData.cell`). */
  private readonly tiles: THREE.Mesh[] = [];
  private board: BoardData | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;
  private downPos: { x: number; y: number } | null = null;
  private hoverKey: string | null = null;
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

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 14, 8);
    this.scene.add(ambient, key, this.highlightGroup);

    // Left-drag orbits, right-drag (or shift/ctrl + left) pans across the table,
    // wheel zooms. A press that barely moves is still a click (see handlePointerUp).
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false; // pan along the ground, not the view plane
    this.controls.minPolarAngle = CAMERA_MIN_POLAR;
    this.controls.maxPolarAngle = CAMERA_MAX_POLAR;
    this.controls.zoomToCursor = true;

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.handlePointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop(this.render);
  }

  /** Build the static board (grid + terrain). Call once per match. */
  buildBoard(state: GameState): void {
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
    this.positionCamera();
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
      if (!obj) {
        obj = this.createUnit(u.id, u.owner, u.name);
        this.units.set(u.id, obj);
        obj.group.position.copy(this.unitWorld(u.pos));
      }
      obj.targetPos = this.unitWorld(u.pos);
      obj.state = { dead: u.dead, knocked: u.knockedDown, guarding: u.guarding && !u.dead };

      const isActive = state.activeUnitId === u.id;
      const isSelected = vm.selectedUnitId === u.id;
      const isSelectable = vm.selectableUnitIds.includes(u.id);
      const isAttackTarget = vm.attackTargetIds.includes(u.id);
      const isGuarding = u.guarding && !u.dead;
      obj.ring.visible =
        !obj.fade && (isActive || isSelected || isSelectable || isAttackTarget || isGuarding);
      const ringColor = isAttackTarget
        ? ATTACK_COLOR
        : isActive || isSelected
          ? SELECT_COLOR
          : isGuarding
            ? GUARD_COLOR
            : 0x8fa3bf;
      obj.ring.material.color.setHex(ringColor);
      obj.ring.material.opacity =
        isActive || isSelected || isAttackTarget ? 0.95 : isGuarding ? 0.7 : 0.4;
    }
    // Remove meshes for units no longer present (shouldn't happen, but be safe).
    for (const [id, obj] of this.units) {
      if (!seen.has(id)) {
        this.scene.remove(obj.group);
        this.units.delete(id);
      }
    }

    this.drawHighlights(vm.moveTargets);
    this.renderer.domElement.style.cursor = vm.interactive ? 'pointer' : 'default';
  }

  /**
   * Play a batch of engine events as Wesnoth-style animations. Steps are laid
   * out on a timeline: each strike plays its attack clip, the target reacts on
   * the clip's hit frame, and knockdowns/deaths wait for that same moment
   * (the GameState that already contains them is held back until then).
   */
  animateEvents(events: GameEvent[]): void {
    let t = Math.min(MAX_QUEUE_MS, Math.max(0, this.busyUntil - this.now));
    let lastHit = t; // when the most recent blow lands, for its consequences
    const hold = (id: string, until: number) => {
      const obj = this.units.get(id);
      if (obj) obj.holdUntil = Math.max(obj.holdUntil, this.now + until);
    };

    for (const e of events) {
      if (e.type === 'UnitMoved') {
        const obj = this.units.get(e.unitId);
        if (obj) {
          this.setHeading(obj, this.unitWorld(e.to).sub(this.unitWorld(e.from)));
          obj.animator.moveFor(MOVE_ANIM_MS);
        }
      } else if (e.type === 'ActivationChosen') {
        const obj = this.units.get(e.unitId);
        if (obj?.anims.leading) this.at(t, () => obj.animator.play(obj.anims.leading));
      } else if (e.type === 'AttackResolved' || e.type === 'ShotResolved') {
        const s = this.strike(e.attackerId, e.targetId, e.type === 'AttackResolved' ? 'melee' : 'ranged', t);
        lastHit = s.hit;
        t = s.end;
      } else if (e.type === 'GuardRiposte') {
        const s = this.strike(e.guardId, e.attackerId, 'melee', t);
        lastHit = s.hit;
        t = s.end;
      } else if (e.type === 'ToughnessSaved') {
        this.at(lastHit, () => this.flashUnit(e.unitId, 0.7));
      } else if (e.type === 'UnitKnockedDown' || e.type === 'UnitKilled') {
        hold(e.unitId, lastHit);
      } else if (e.type === 'UnitRouted') {
        const obj = this.units.get(e.unitId);
        if (obj) obj.routed = true;
        hold(e.unitId, lastHit + 300);
      } else if (e.type === 'GameOver') {
        this.at(t + 400, () => {
          for (const obj of this.units.values()) {
            if (obj.owner === e.winner && !obj.state.dead) {
              obj.animator.play(obj.anims.victory ?? obj.anims.leading);
            }
          }
        });
      }
    }
    this.busyUntil = Math.max(this.busyUntil, this.now + t);
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
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // --- internals ----------------------------------------------------------

  private createUnit(id: string, owner: 0 | 1, name: string): UnitObj {
    const group = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(BASE_RADIUS, BASE_RADIUS, BASE_HEIGHT, 28),
      new THREE.MeshStandardMaterial({ color: OWNER_COLORS[owner], roughness: 0.6 }),
    );
    base.position.y = TILE_TOP + BASE_HEIGHT / 2;
    base.userData.unitId = id;

    const ringGeo = new THREE.RingGeometry(0.42, 0.52, 28);
    const ring = new THREE.Mesh(
      ringGeo,
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

    const mirror = new THREE.Group();
    mirror.add(sprite);
    const tilt = new THREE.Group();
    tilt.rotation.x = -SPRITE_LEAN;
    tilt.add(mirror);
    const facing = new THREE.Group();
    facing.position.y = TILE_TOP + BASE_HEIGHT;
    facing.add(tilt);

    const spriteName = spriteFor(name);
    const anims = animationsFor(spriteName);
    const flags = (): UnitFlags => ({ dead: false, knocked: false, guarding: false });
    const obj: UnitObj = {
      owner,
      group,
      facing,
      tilt,
      mirror,
      sprite,
      base,
      ring,
      anims,
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
      flash: 0,
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
        sprite.scale.set(atlas.cellW * SPRITE_PX, atlas.cellH * SPRITE_PX, 1);
        obj.shownImage = null; // force the current frame onto the new map
        sprite.visible = true;
      },
      (err) => console.error(err),
    );

    group.add(ring, base, facing);
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
   * Returns the hit and end times, relative to now.
   */
  private strike(
    attackerId: string,
    targetId: string,
    range: 'melee' | 'ranged',
    at: number,
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
    const defend: Clip | undefined =
      range === 'melee'
        ? (d.anims.defendMelee ?? d.anims.defendRanged)
        : (d.anims.defendRanged ?? d.anims.defendMelee);
    this.at(at + hit - (defend?.hitMs ?? DEFEND_LEAD_MS), () => {
      if (!d.animator.busy) d.animator.play(defend);
    });
    this.at(at + hit, () => this.flashUnit(targetId, 0.8));
    return { hit: at + hit, end: at + dur };
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
    obj.shown = { ...state };
    obj.targetTilt = state.knocked ? Math.PI / 2.4 : 0;
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
    } else if (!obj.shown.knocked) {
      // Wesnoth plays the death clip, then fades; without one it just fades.
      fadeIn = obj.animator.play(obj.anims.death, { hold: true });
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
    obj.group.position.lerp(obj.targetPos, lerp);
    if (this.now >= obj.holdUntil) this.syncShown(obj);

    // On Guard, hold the braced defence pose.
    const guardPose = obj.anims.defendMelee?.frames[1]?.[0] ?? null;
    obj.animator.pose = obj.shown.guarding && !obj.shown.knocked ? guardPose : null;
    obj.animator.restless = !obj.shown.knocked && !obj.fade;
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
    obj.tilt.rotation.z += (obj.targetTilt - obj.tilt.rotation.z) * lerp;

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
    obj.facing.position.set(off.x, TILE_TOP + BASE_HEIGHT, off.z);

    if (obj.flash > 0) {
      obj.flash = Math.max(0, obj.flash - (dtMs / 1000) * 3);
      // A basic material's colour multiplies the texture; > 1 washes it toward white.
      obj.sprite.material.color.setScalar(1 + obj.flash * 2.5);
    }
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

  private drawHighlights(moveTargets: Vec[]): void {
    this.highlightGroup.clear();
    if (moveTargets.length === 0) return;
    // A flat hexagon matching the tile footprint (a 6-gon lies flat in XZ).
    const geo = new THREE.CircleGeometry(HEX_SIZE * 0.9, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: MOVE_COLOR,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    });
    for (const t of moveTargets) {
      const tile = new THREE.Mesh(geo, mat);
      tile.rotation.x = -Math.PI / 2;
      const w = this.cellToWorld(t);
      tile.position.set(w.x, this.surfaceAt(t) + 0.03, w.z);
      this.highlightGroup.add(tile);
    }
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

    this.clampCameraTarget();
    this.controls.update();

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

    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    for (const obj of this.units.values()) this.animateUnit(obj, dtMs, lerp, camRight);
    this.animateMissiles();

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

  private handlePointerDown = (ev: PointerEvent): void => {
    this.downPos = { x: ev.clientX, y: ev.clientY };
  };

  private handlePointerUp = (ev: PointerEvent): void => {
    if (!this.downPos) return;
    const moved = Math.hypot(ev.clientX - this.downPos.x, ev.clientY - this.downPos.y);
    this.downPos = null;
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
    if (!this.onCellHover) return;
    if (ev.buttons !== 0) return this.setHover(null); // orbiting/panning: hide the tooltip
    this.aimRay(ev);
    // A figure stands over its own hex; report that rather than the tile behind it.
    const unitId = this.pickUnit();
    const target = unitId ? this.units.get(unitId)?.targetPos : undefined;
    const unitCell = target ? this.worldToCell(target) : null;
    this.setHover(unitCell ?? this.pickCell());
  };

  private handlePointerLeave = (): void => this.setHover(null);

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
  }

  private positionCamera(): void {
    // Frame the full hex footprint (in world units), not the cell counts.
    const spanX = HEX_COL_STEP * (this.width - 1) + 2 * HEX_SIZE;
    const spanZ = HEX_ROW_STEP * (this.height - 1 + 0.5) + 2 * HEX_SIZE;
    const span = Math.max(spanX, spanZ);
    this.camera.position.set(0, span * 0.95, spanZ * 0.62 + 3);
    this.controls.target.set(0, 0, 0);
    const home = this.camera.position.length();
    this.controls.minDistance = 3;
    this.controls.maxDistance = home * 1.8;
    this.controls.update();
    this.controls.saveState();
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
