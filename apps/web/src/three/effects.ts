import * as THREE from 'three';

/**
 * Combat effects: short-lived sparks, dust, rings, icons and ground marks laid
 * over the board. The board view decides *when* each plays (on its combat
 * timeline); this only knows how to draw them and let them fade.
 *
 * Nothing here is red: a hit reads as white, gold, dust or ash, so it suits a
 * skeleton as well as a spearman.
 *
 * Everything runs on the time the board feeds {@link Effects.update}, so a
 * hit-stop (which freezes board time) freezes the effects with it.
 */

/** A burst of particles from one point. Ranges are [min, max], picked per particle. */
export interface BurstSpec {
  at: THREE.Vector3;
  count: number;
  /** Picked from at random, per particle. */
  colors: number[];
  /** World units per second. */
  speed: [number, number];
  /** Bias the burst this way (normalised); with `cone` < 1 the burst is a spray, not a sphere. */
  dir?: THREE.Vector3;
  /** 0 = straight along `dir`, 1 = any direction. Default 1. */
  cone?: number;
  /** Keep velocities horizontal (a ring of dust along the ground). */
  flat?: boolean;
  /** Extra upward speed added to every particle. */
  up?: number;
  /** Downward acceleration (world units / s²). */
  gravity?: number;
  /** Fraction of speed lost per second. */
  drag?: number;
  /** Seconds. */
  life: [number, number];
  /** World size. */
  size: [number, number];
  /** Size multiplier reached at the end of life (a dust puff swells). Default 1. */
  grow?: number;
  /** Soft round blob, or a hard square chip. Default soft. */
  shape?: 'soft' | 'square';
  /** Additive glow (sparks) or ordinary paint (dust, ash). Default normal. */
  blend?: 'add' | 'normal';
  /** Starting opacity. Default 1. */
  opacity?: number;
  /** Scatter the start points within this radius. */
  jitter?: number;
  /** World Y the particles land on and bounce off (pebbles). */
  floor?: number;
  /** Speed kept by a bounce, 0..1. Default 0.35. */
  bounce?: number;
}

/** Canvas-drawn images the effects use. */
export type FxTexture =
  | 'soft'
  | 'ting'
  | 'chevron'
  | 'shield'
  | 'skull'
  | 'blades'
  | 'arc'
  | 'crack'
  | 'fallen';

interface Fx {
  obj: THREE.Object3D;
  age: number;
  life: number;
  /** Called every frame with the 0..1 progress. */
  step: (k: number) => void;
  dispose: () => void;
}

const CAPACITY = 2400;

/** One pool of point particles, drawn in one call. */
class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly shape: Float32Array;
  private readonly vel = new Float32Array(CAPACITY * 3);
  private readonly age = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly size0 = new Float32Array(CAPACITY);
  private readonly grow = new Float32Array(CAPACITY);
  private readonly alpha0 = new Float32Array(CAPACITY);
  private readonly gravity = new Float32Array(CAPACITY);
  private readonly drag = new Float32Array(CAPACITY);
  private readonly floor = new Float32Array(CAPACITY);
  private readonly bounce = new Float32Array(CAPACITY);
  private count = 0;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;

  constructor(additive: boolean) {
    this.pos = new Float32Array(CAPACITY * 3);
    this.col = new Float32Array(CAPACITY * 3);
    this.alpha = new Float32Array(CAPACITY);
    this.size = new Float32Array(CAPACITY);
    this.shape = new Float32Array(CAPACITY);
    const attr = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', attr(this.pos, 3));
    this.geometry.setAttribute('color', attr(this.col, 3));
    this.geometry.setAttribute('aAlpha', attr(this.alpha, 1));
    this.geometry.setAttribute('aSize', attr(this.size, 1));
    this.geometry.setAttribute('aShape', attr(this.shape, 1));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float aAlpha;
        attribute float aSize;
        attribute float aShape;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vShape;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vShape = aShape;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, aSize * uScale / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vShape;
        void main() {
          float a = vAlpha;
          if (vShape < 0.5) {
            float d = length(gl_PointCoord - 0.5);
            a *= smoothstep(0.5, 0.15, d);
          }
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  set scale(v: number) {
    this.material.uniforms.uScale!.value = v;
  }

  emit(s: BurstSpec): void {
    const color = new THREE.Color();
    const dir = s.dir?.clone().normalize();
    const cone = s.cone ?? 1;
    const rand = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
    for (let n = 0; n < s.count; n++) {
      if (this.count >= CAPACITY) return;
      const i = this.count++;
      // A random direction, pulled toward `dir` by (1 - cone).
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (s.flat) v.y = 0;
      if (v.lengthSq() < 1e-6) v.set(1, 0, 0);
      v.normalize();
      if (dir) v.multiplyScalar(cone).addScaledVector(dir, 1 - cone).normalize();
      v.multiplyScalar(rand(s.speed));
      v.y += s.up ?? 0;
      const j = s.jitter ?? 0;
      const jx = (Math.random() * 2 - 1) * j;
      const jz = (Math.random() * 2 - 1) * j;
      const jy = s.flat ? 0 : (Math.random() * 2 - 1) * j * 0.5;
      this.pos.set([s.at.x + jx, s.at.y + jy, s.at.z + jz], i * 3);
      this.vel.set([v.x, v.y, v.z], i * 3);
      color.setHex(s.colors[Math.floor(Math.random() * s.colors.length)]!);
      this.col.set([color.r, color.g, color.b], i * 3);
      this.age[i] = 0;
      this.life[i] = rand(s.life);
      this.size0[i] = rand(s.size);
      this.size[i] = this.size0[i]!;
      this.grow[i] = s.grow ?? 1;
      this.alpha0[i] = s.opacity ?? 1;
      this.alpha[i] = this.alpha0[i]!;
      this.shape[i] = s.shape === 'square' ? 1 : 0;
      this.gravity[i] = s.gravity ?? 0;
      this.drag[i] = s.drag ?? 0;
      this.floor[i] = s.floor ?? -Infinity;
      this.bounce[i] = s.bounce ?? 0.35;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; ) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) {
        this.kill(i);
        continue;
      }
      const k = this.age[i]! / this.life[i]!;
      const damp = Math.max(0, 1 - this.drag[i]! * dt);
      const o = i * 3;
      this.vel[o]! *= damp;
      this.vel[o + 2]! *= damp;
      this.vel[o + 1] = this.vel[o + 1]! * damp - this.gravity[i]! * dt;
      this.pos[o]! += this.vel[o]! * dt;
      this.pos[o + 1]! += this.vel[o + 1]! * dt;
      this.pos[o + 2]! += this.vel[o + 2]! * dt;
      if (this.pos[o + 1]! < this.floor[i]!) {
        this.pos[o + 1] = this.floor[i]!;
        this.vel[o + 1] = Math.abs(this.vel[o + 1]!) * this.bounce[i]!;
        this.vel[o]! *= 0.6;
        this.vel[o + 2]! *= 0.6;
      }
      this.size[i] = this.size0[i]! * (1 + (this.grow[i]! - 1) * k);
      // Hold, then fade over the last 60% of life.
      this.alpha[i] = this.alpha0[i]! * Math.min(1, (1 - k) / 0.6);
      i++;
    }
    this.geometry.setDrawRange(0, this.count);
    for (const name of ['position', 'color', 'aAlpha', 'aSize', 'aShape']) {
      (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** Swap the last live particle into slot `i`. */
  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const copy = (a: Float32Array, n: number) => a.copyWithin(i * n, last * n, last * n + n);
    for (const a of [this.pos, this.vel, this.col]) copy(a, 3);
    for (const a of [
      this.alpha,
      this.size,
      this.shape,
      this.age,
      this.life,
      this.size0,
      this.grow,
      this.alpha0,
      this.gravity,
      this.drag,
      this.floor,
      this.bounce,
    ]) {
      copy(a, 1);
    }
  }

  clear(): void {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** How a flat ring or an icon comes and goes. */
interface Envelope {
  /** Seconds. */
  life: number;
  opacity?: number;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly glow = new Particles(true);
  private readonly paint = new Particles(false);
  private readonly items: Fx[] = [];
  private readonly textures = new Map<FxTexture, THREE.Texture>();
  private readonly thinRing = new THREE.RingGeometry(0.9, 1, 56);
  private readonly thickRing = new THREE.RingGeometry(0.55, 1, 56);
  private readonly plane = new THREE.PlaneGeometry(1, 1);
  private readonly beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  /** Persistent ground marks, by key (a fallen unit's id). */
  private readonly marks = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();

  constructor() {
    this.group.add(this.paint.points, this.glow.points);
  }

  /** Keep particle sizes in world units: call when the canvas or the field of view changes. */
  setViewport(heightPx: number, fovDeg: number): void {
    const scale = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.glow.scale = scale;
    this.paint.scale = scale;
  }

  burst(spec: BurstSpec): void {
    (spec.blend === 'add' ? this.glow : this.paint).emit(spec);
  }

  /** A flat ring on the ground growing from radius `from` to `to`, fading as it goes. */
  ring(
    at: THREE.Vector3,
    color: number,
    from: number,
    to: number,
    env: Envelope & { thick?: boolean; additive?: boolean },
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: env.opacity ?? 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: env.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(env.thick ? this.thickRing : this.thinRing, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    mesh.renderOrder = 1;
    const peak = env.opacity ?? 0.9;
    this.add(mesh, env.life, (k) => {
      // Fast out, slowing as it spreads.
      const e = 1 - Math.pow(1 - k, 3);
      mesh.scale.setScalar(Math.max(0.001, from + (to - from) * e));
      mat.opacity = peak * (1 - k);
    }, () => mat.dispose());
  }

  /**
   * A billboard image over the action. It pops in (overshooting a little),
   * holds, then fades over the last 40% of its life, rising by `rise`.
   */
  icon(
    tex: FxTexture,
    at: THREE.Vector3,
    size: number,
    env: Envelope & { color?: number; rise?: number; rotation?: number; spin?: number; additive?: boolean; drift?: THREE.Vector3 },
  ): void {
    const mat = new THREE.SpriteMaterial({
      map: this.texture(tex),
      color: env.color ?? 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      rotation: env.rotation ?? 0,
      blending: env.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    sprite.renderOrder = 3;
    const peak = env.opacity ?? 1;
    this.add(sprite, env.life, (k) => {
      const pop = k < 0.15 ? 0.4 + (1.15 - 0.4) * (k / 0.15) : k < 0.25 ? 1.15 - 0.15 * ((k - 0.15) / 0.1) : 1;
      sprite.scale.setScalar(size * pop);
      sprite.position.copy(at);
      sprite.position.y += (env.rise ?? 0) * k;
      if (env.drift) sprite.position.addScaledVector(env.drift, k);
      mat.rotation = (env.rotation ?? 0) + (env.spin ?? 0) * k;
      mat.opacity = peak * Math.min(1, (1 - k) / 0.4);
    }, () => mat.dispose());
  }

  /** An image lying flat on the ground (a crack), fading over the last half of its life. */
  decal(tex: FxTexture, at: THREE.Vector3, size: number, env: Envelope & { color?: number; rotation?: number }): void {
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture(tex),
      color: env.color ?? 0xffffff,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(this.plane, mat);
    mesh.rotation.set(-Math.PI / 2, 0, env.rotation ?? Math.random() * Math.PI * 2);
    mesh.position.copy(at);
    mesh.renderOrder = 1;
    const peak = env.opacity ?? 1;
    this.add(mesh, env.life, (k) => {
      // Spreads out fast, like a crack running through stone.
      mesh.scale.setScalar(size * Math.min(1, 0.3 + k * 8));
      mat.opacity = peak * Math.min(1, (1 - k) / 0.5);
    }, () => mat.dispose());
  }

  /** A bright bar joining two points, flaring then fading. */
  beam(a: THREE.Vector3, b: THREE.Vector3, color: number, width: number, env: Envelope): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.beamGeo, mat);
    const span = b.clone().sub(a);
    mesh.position.copy(a).addScaledVector(span, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize());
    mesh.renderOrder = 2;
    const peak = env.opacity ?? 1;
    this.add(mesh, env.life, (k) => {
      const w = width * (k < 0.2 ? k / 0.2 : 1);
      mesh.scale.set(w, span.length(), w);
      mat.opacity = peak * Math.min(1, (1 - k) / 0.6);
    }, () => mat.dispose());
  }

  /**
   * Any other short-lived object: `step` gets the 0..1 progress each frame and
   * `dispose` frees what the object owns once its `life` (seconds) runs out.
   */
  add(obj: THREE.Object3D, life: number, step: (k: number) => void, dispose: () => void = () => {}): void {
    step(0);
    this.group.add(obj);
    this.items.push({ obj, age: 0, life, step, dispose });
  }

  /** Lay a lasting mark on the ground under `key`, replacing any it had. */
  mark(key: string, tex: FxTexture, at: THREE.Vector3, size: number, opacity: number): void {
    this.unmark(key);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture(tex),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const mesh = new THREE.Mesh(this.plane, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    mesh.scale.setScalar(size);
    mesh.userData.opacity = opacity;
    this.marks.set(key, mesh);
    this.group.add(mesh);
  }

  unmark(key: string): void {
    const mesh = this.marks.get(key);
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.material.dispose();
    this.marks.delete(key);
  }

  clearMarks(): void {
    for (const key of [...this.marks.keys()]) this.unmark(key);
  }

  /** Advance every effect by `dtMs` of board time. */
  update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.glow.update(dt);
    this.paint.update(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const fx = this.items[i]!;
      fx.age += dt;
      if (fx.age >= fx.life) {
        this.retire(i);
        continue;
      }
      fx.step(fx.age / fx.life);
    }
    // Marks ease in once laid.
    for (const mesh of this.marks.values()) {
      const target = mesh.userData.opacity as number;
      if (mesh.material.opacity < target) mesh.material.opacity = Math.min(target, mesh.material.opacity + dt * 1.5);
    }
  }

  /** Drop every effect in flight (a skip or a replay jump). Lasting marks stay. */
  clear(): void {
    this.glow.clear();
    this.paint.clear();
    for (let i = this.items.length - 1; i >= 0; i--) this.retire(i);
  }

  dispose(): void {
    this.clear();
    this.clearMarks();
    this.glow.dispose();
    this.paint.dispose();
    for (const t of this.textures.values()) t.dispose();
    for (const g of [this.thinRing, this.thickRing, this.plane, this.beamGeo]) g.dispose();
  }

  private retire(i: number): void {
    const fx = this.items[i]!;
    this.group.remove(fx.obj);
    fx.dispose();
    this.items.splice(i, 1);
  }

  private texture(kind: FxTexture): THREE.Texture {
    let t = this.textures.get(kind);
    if (t) return t;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    drawTexture(canvas.getContext('2d')!, kind);
    t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(kind, t);
    return t;
  }
}

const INK = '#1b1f27';

/**
 * Draw one effect image on a 128px canvas. Shapes are white (tinted by the
 * material's colour) with a dark outline where they need to read over busy art.
 */
function drawTexture(g: CanvasRenderingContext2D, kind: FxTexture): void {
  const c = 64;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = INK;
  g.fillStyle = '#ffffff';
  switch (kind) {
    case 'soft': {
      const grad = g.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      return;
    }
    case 'ting': {
      // A four-point glint: long thin rays with a bright core.
      const grad = g.createRadialGradient(c, c, 0, c, c, 30);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#fffbe8';
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? 60 : 7;
        const a = -Math.PI / 2 + (i * Math.PI) / 4;
        g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      return;
    }
    case 'chevron': {
      // Two chevrons pointing up (the sprite is turned to point along the push).
      g.lineWidth = 12;
      for (const y of [30, 62]) {
        g.beginPath();
        g.moveTo(26, y + 30);
        g.lineTo(c, y);
        g.lineTo(102, y + 30);
        g.strokeStyle = INK;
        g.lineWidth = 20;
        g.stroke();
        g.strokeStyle = '#ffffff';
        g.lineWidth = 11;
        g.stroke();
      }
      return;
    }
    case 'shield': {
      g.beginPath();
      g.moveTo(c, 10);
      g.lineTo(108, 26);
      g.lineTo(108, 62);
      g.quadraticCurveTo(108, 100, c, 120);
      g.quadraticCurveTo(20, 100, 20, 62);
      g.lineTo(20, 26);
      g.closePath();
      g.fill();
      g.lineWidth = 8;
      g.stroke();
      g.beginPath();
      g.moveTo(c, 30);
      g.lineTo(c, 100);
      g.moveTo(38, 56);
      g.lineTo(90, 56);
      g.lineWidth = 7;
      g.globalAlpha = 0.35;
      g.stroke();
      g.globalAlpha = 1;
      return;
    }
    case 'skull': {
      g.fillStyle = '#ece6d6';
      g.beginPath();
      g.arc(c, 54, 40, Math.PI * 0.85, Math.PI * 2.15);
      g.lineTo(88, 96);
      g.lineTo(40, 96);
      g.closePath();
      g.fill();
      g.fillRect(44, 92, 40, 20);
      g.lineWidth = 6;
      g.stroke();
      g.strokeRect(44, 92, 40, 20);
      g.fillStyle = INK;
      for (const x of [46, 82]) {
        g.beginPath();
        g.ellipse(x, 60, 12, 14, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.moveTo(c, 72);
      g.lineTo(58, 86);
      g.lineTo(70, 86);
      g.closePath();
      g.fill();
      g.lineWidth = 4;
      for (const x of [56, 64, 72]) {
        g.beginPath();
        g.moveTo(x, 94);
        g.lineTo(x, 110);
        g.stroke();
      }
      return;
    }
    case 'blades': {
      // Two crossed swords.
      for (const flip of [1, -1]) {
        g.save();
        g.translate(c, c);
        g.rotate((flip * Math.PI) / 4);
        g.beginPath();
        g.moveTo(-6, 40);
        g.lineTo(-6, -40);
        g.lineTo(0, -54);
        g.lineTo(6, -40);
        g.lineTo(6, 40);
        g.closePath();
        g.fillStyle = '#ffffff';
        g.fill();
        g.lineWidth = 5;
        g.stroke();
        g.fillStyle = '#d8d0bc';
        g.fillRect(-18, 36, 36, 8);
        g.strokeRect(-18, 36, 36, 8);
        g.fillRect(-4, 44, 8, 14);
        g.strokeRect(-4, 44, 8, 14);
        g.restore();
      }
      return;
    }
    case 'arc': {
      // A curved slash, thick in the middle and tapering at both ends.
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(c, 96, 70, Math.PI * 1.15, Math.PI * 1.85);
      g.arc(c, 116, 80, Math.PI * 1.8, Math.PI * 1.2, true);
      g.closePath();
      g.fill();
      return;
    }
    case 'crack': {
      // Jagged cracks running out from a centre, darkest at the core.
      g.strokeStyle = 'rgba(10,10,14,0.85)';
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 7; i++) {
        let a = (i / 7) * Math.PI * 2 + rnd() * 0.5;
        let x = c;
        let y = c;
        g.beginPath();
        g.moveTo(x, y);
        for (let s = 0; s < 5; s++) {
          a += (rnd() - 0.5) * 0.9;
          const len = 8 + rnd() * 6;
          x += Math.cos(a) * len;
          y += Math.sin(a) * len;
          g.lineTo(x, y);
        }
        g.lineWidth = 3 + rnd() * 3;
        g.stroke();
      }
      g.fillStyle = 'rgba(10,10,14,0.6)';
      g.beginPath();
      g.arc(c, c, 10, 0, Math.PI * 2);
      g.fill();
      return;
    }
    case 'fallen': {
      // A flat grey token with crossed swords: where someone fell.
      g.fillStyle = '#6d6a64';
      g.beginPath();
      g.arc(c, c, 56, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = '#2a2b2f';
      g.stroke();
      g.strokeStyle = '#c9c3b4';
      g.lineWidth = 9;
      for (const flip of [1, -1]) {
        g.beginPath();
        g.moveTo(c - 30 * flip, c - 30);
        g.lineTo(c + 30 * flip, c + 30);
        g.stroke();
      }
      return;
    }
  }
}
