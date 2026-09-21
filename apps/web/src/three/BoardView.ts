import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { vecKey, type GameEvent, type GameState, type Vec } from '@fansong/engine';
import { loadSpriteTexture } from './spriteTextures.js';
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
const TILE_LIGHT = 0x2a3140;
const TILE_DARK = 0x232936;
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
const SHOT_COLOR = 0x9fd0ff; // ranged tracer
const RIPOSTE_COLOR = 0xffd54a; // guard riposte tracer

// Units are paper cutouts: a Wesnoth sprite standing upright on a round base.
const TILE_TOP = 0.1; // tiles are 0.2 tall, centred on y = 0
const BASE_RADIUS = 0.36;
const BASE_HEIGHT = 0.06;
const SPRITE_PX = 1.8 / 72; // world units per sprite pixel (a 72px Wesnoth hex ≈ 1.8)
const SPRITE_LEAN = 0.18; // lean back (top away from the camera, radians) so the steep view doesn't squash it

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

interface UnitObj {
  group: THREE.Group;
  /** Turns the cutout to face the camera (yaw only, so it stays upright). */
  facing: THREE.Group;
  /** Knockdown pivot at the cutout's feet. */
  tilt: THREE.Group;
  sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  targetPos: THREE.Vector3;
  targetTilt: number;
  dead: boolean;
  /** 0..1 transient hit flash, decays each frame. */
  flash: number;
}

/**
 * Thin three.js view of a FanSong board. It renders the grid, terrain and units
 * and reports clicks (as a cell and/or a unit id) back through callbacks — it
 * never decides legality. Unit transforms are lerped toward targets derived from
 * `GameState`, so movement/knockdown/death animate; engine events add transient
 * combat flashes.
 */
export class BoardView {
  onUnitClick: ((id: string) => void) | null = null;
  onCellClick: ((cell: Vec) => void) | null = null;

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
  private readonly highlightGroup = new THREE.Group();
  private width = 0;
  private height = 0;
  private disposed = false;
  private downPos: { x: number; y: number } | null = null;
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

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop(this.render);
  }

  /** Build the static board (grid + terrain). Call once per match. */
  buildBoard(state: GameState): void {
    this.width = state.board.width;
    this.height = state.board.height;
    const blocked = new Set(state.board.blocked);

    // A flat-top hex prism: a 6-sided cylinder, whose default orientation already
    // points its vertices along ±X (columns) and its flat edges along ±Z (rows).
    const tileGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.94, HEX_SIZE * 0.94, 0.2, 6);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const key = vecKey({ x, y });
        const isBlocked = blocked.has(key);
        const color = isBlocked ? BLOCKED_COLOR : (x + y) % 2 === 0 ? TILE_LIGHT : TILE_DARK;
        const mat = new THREE.MeshStandardMaterial({ color });
        const tile = new THREE.Mesh(tileGeo, mat);
        const w = this.cellToWorld({ x, y });
        tile.position.set(w.x, isBlocked ? 0.25 : 0, w.z);
        if (isBlocked) tile.scale.y = 3;
        this.scene.add(tile);
      }
    }

    this.positionCamera();
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
      obj.targetTilt = u.knockedDown ? Math.PI / 2.4 : 0;
      obj.dead = u.dead;

      const isActive = state.activeUnitId === u.id;
      const isSelected = vm.selectedUnitId === u.id;
      const isSelectable = vm.selectableUnitIds.includes(u.id);
      const isAttackTarget = vm.attackTargetIds.includes(u.id);
      const isGuarding = u.guarding && !u.dead;
      obj.ring.visible = isActive || isSelected || isSelectable || isAttackTarget || isGuarding;
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

  /** Trigger transient combat FX from a batch of engine events. */
  animateEvents(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'AttackResolved') {
        this.flashUnit(e.attackerId, 0.6);
        this.flashUnit(e.targetId, 1);
      } else if (e.type === 'ShotResolved') {
        this.addTracer(e.attackerId, e.targetId, SHOT_COLOR);
        this.flashUnit(e.targetId, 1);
      } else if (e.type === 'GuardRiposte') {
        // The guard strikes back along the line of the incoming attack.
        this.addTracer(e.guardId, e.attackerId, RIPOSTE_COLOR);
        this.flashUnit(e.guardId, 0.9);
        this.flashUnit(e.attackerId, e.prevented ? 1 : 0.5);
      } else if (e.type === 'ToughnessSaved') {
        this.flashUnit(e.unitId, 0.7);
      } else if (e.type === 'UnitKilled' || e.type === 'UnitRouted') {
        this.flashUnit(e.unitId, 1);
      } else if (e.type === 'UnitKnockedDown') {
        this.flashUnit(e.unitId, 0.8);
      }
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

    // The cutout: a unit quad with its origin at the bottom edge, sized once the
    // sprite loads. Alpha-tested (not blended) so overlapping cutouts need no sorting.
    const spriteGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const sprite = new THREE.Mesh(
      spriteGeo,
      new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide }),
    );
    sprite.userData.unitId = id;
    sprite.visible = false;

    const tilt = new THREE.Group();
    tilt.add(sprite);
    const facing = new THREE.Group();
    facing.position.y = TILE_TOP + BASE_HEIGHT;
    facing.add(tilt);

    loadSpriteTexture(spriteFor(name), owner).then(
      ({ texture, width, height }) => {
        if (this.disposed) return;
        sprite.material.map = texture;
        sprite.material.needsUpdate = true;
        // Wesnoth sprites face left; mirror P0 (deployed on the left) to face the enemy.
        sprite.scale.set(width * SPRITE_PX * (owner === 0 ? -1 : 1), height * SPRITE_PX, 1);
        sprite.visible = true;
      },
      (err) => console.error(err),
    );

    group.add(ring, base, facing);
    group.name = name;
    this.scene.add(group);
    return {
      group,
      facing,
      tilt,
      sprite,
      ring,
      targetPos: new THREE.Vector3(),
      targetTilt: 0,
      dead: false,
      flash: 0,
    };
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
      tile.position.set(w.x, 0.13, w.z);
      this.highlightGroup.add(tile);
    }
  }

  private flashUnit(id: string, amount: number): void {
    const obj = this.units.get(id);
    if (obj) obj.flash = Math.max(obj.flash, amount);
  }

  /** Draw a short-lived bolt between two units (a shot or a riposte). */
  private addTracer(fromId: string, toId: string, color: number): void {
    const from = this.units.get(fromId);
    const to = this.units.get(toId);
    if (!from || !to) return;
    const a = from.group.position.clone().setY(0.7);
    const b = to.group.position.clone().setY(0.7);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.4, max: 0.4 });
  }

  private render = (): void => {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const lerp = 1 - Math.pow(0.001, dt); // frame-rate independent smoothing

    this.clampCameraTarget();
    this.controls.update();

    for (const obj of this.units.values()) {
      obj.group.position.lerp(obj.targetPos, lerp);
      obj.facing.rotation.y = Math.atan2(
        this.camera.position.x - obj.group.position.x,
        this.camera.position.z - obj.group.position.z,
      );
      obj.tilt.rotation.x = -SPRITE_LEAN;
      obj.tilt.rotation.z += (obj.targetTilt - obj.tilt.rotation.z) * lerp;

      const targetScale = obj.dead ? 0.001 : 1;
      const s = obj.group.scale.x + (targetScale - obj.group.scale.x) * lerp;
      obj.group.scale.setScalar(Math.max(0.001, s));
      obj.group.visible = !(obj.dead && s < 0.02);

      if (obj.flash > 0) {
        obj.flash = Math.max(0, obj.flash - dt * 3);
        // A basic material's colour multiplies the texture; > 1 washes it toward white.
        obj.sprite.material.color.setScalar(1 + obj.flash * 2.5);
      }
    }

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

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Units first (their meshes carry userData.unitId), then a board cell.
    const meshes: THREE.Object3D[] = [];
    for (const obj of this.units.values()) if (obj.group.visible) meshes.push(obj.group);
    const unitHits = this.raycaster.intersectObjects(meshes, true);
    const unitId = unitHits[0]?.object.userData.unitId as string | undefined;
    if (unitId) {
      this.onUnitClick?.(unitId);
      return;
    }

    const point = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, point)) {
      const cell = this.worldToCell(point);
      if (cell) this.onCellClick?.(cell);
    }
  };

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

  private unitWorld(v: Vec): THREE.Vector3 {
    const w = this.cellToWorld(v);
    return new THREE.Vector3(w.x, 0, w.z);
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
