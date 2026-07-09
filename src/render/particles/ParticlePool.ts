import * as THREE from "three";

export type EmitParticleOpts = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  g: number;
  b: number;
  size: number;
  life: number;
  /** Optional drag (1/s); higher = slows faster. Default 1.2. */
  drag?: number;
  /** Optional gravity scale (1 = normal -9.5-ish). Default 1. */
  gravityScale?: number;
};

type Slot = {
  alive: boolean;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  drag: number;
  gravityScale: number;
  baseSize: number;
};

/**
 * Fixed-capacity point sprite pool. Overwrites oldest when full.
 */
export class ParticlePool {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly slots: Slot[];
  private cursor = 0;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly texture: THREE.Texture;
  private readonly ownsTexture: boolean;

  constructor(
    capacity: number,
    texture: THREE.Texture,
    opts?: { ownsTexture?: boolean; depthWrite?: boolean },
  ) {
    this.capacity = Math.max(8, capacity | 0);
    this.texture = texture;
    this.ownsTexture = opts?.ownsTexture ?? false;

    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    this.alphas = new Float32Array(this.capacity);
    this.slots = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      this.slots[i] = {
        alive: false,
        life: 0,
        maxLife: 1,
        vx: 0,
        vy: 0,
        vz: 0,
        drag: 1.2,
        gravityScale: 1,
        baseSize: 0.4,
      };
      this.positions[i * 3 + 1] = -9999;
      this.alphas[i] = 0;
      this.sizes[i] = 0;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(this.colors, 3),
    );
    this.geometry.setAttribute(
      "aSize",
      new THREE.BufferAttribute(this.sizes, 1),
    );
    this.geometry.setAttribute(
      "aAlpha",
      new THREE.BufferAttribute(this.alphas, 1),
    );

    // ShaderMaterial already injects `position` (+ `color` when vertexColors).
    // Do NOT redeclare those — redefinition fails VALIDATE_STATUS.
    // GLSL1 keeps texture2D / gl_FragColor working on WebGL2.
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL1,
      uniforms: {
        uMap: { value: texture },
        uScale: { value: 280 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float dist = max(0.5, -mvPosition.z);
          gl_PointSize = aSize * (uScale / dist);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float a = tex.a * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite: opts?.depthWrite ?? false,
      blending: THREE.NormalBlending,
      // Injects `attribute vec3 color` — required; do not declare it in shader body.
      vertexColors: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.name = "particle-pool";
    this.points.renderOrder = 3;
  }

  emit(o: EmitParticleOpts): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const s = this.slots[i];
    s.alive = true;
    s.life = o.life;
    s.maxLife = Math.max(o.life, 1e-3);
    s.vx = o.vx;
    s.vy = o.vy;
    s.vz = o.vz;
    s.drag = o.drag ?? 1.2;
    s.gravityScale = o.gravityScale ?? 1;
    s.baseSize = o.size;

    const i3 = i * 3;
    this.positions[i3] = o.x;
    this.positions[i3 + 1] = o.y;
    this.positions[i3 + 2] = o.z;
    this.colors[i3] = o.r;
    this.colors[i3 + 1] = o.g;
    this.colors[i3 + 2] = o.b;
    this.sizes[i] = o.size;
    this.alphas[i] = 0.95;
  }

  emitMany(count: number, factory: (i: number) => EmitParticleOpts): void {
    const n = Math.max(0, Math.floor(count));
    for (let i = 0; i < n; i++) this.emit(factory(i));
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const g = -9.5;
    let dirty = false;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (!s.alive) continue;
      dirty = true;
      s.life -= dt;
      if (s.life <= 0) {
        s.alive = false;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        this.positions[i * 3 + 1] = -9999;
        continue;
      }
      const t = s.life / s.maxLife;
      // Fade in quickly, out slowly
      const fade = t > 0.75 ? (1 - t) / 0.25 : t < 0.15 ? t / 0.15 : 1;
      this.alphas[i] = 0.98 * fade * Math.min(1, t * 1.5);

      const drag = Math.exp(-s.drag * dt);
      s.vx *= drag;
      s.vz *= drag;
      s.vy = s.vy * drag + g * s.gravityScale * dt;

      const i3 = i * 3;
      this.positions[i3] += s.vx * dt;
      this.positions[i3 + 1] += s.vy * dt;
      this.positions[i3 + 2] += s.vz * dt;

      // Mild expand — keep puffs small/dense rather than big blobs
      this.sizes[i] = s.baseSize * (1.0 + (1 - t) * 0.35);
    }
    if (dirty) {
      (
        this.geometry.getAttribute("position") as THREE.BufferAttribute
      ).needsUpdate = true;
      (
        this.geometry.getAttribute("color") as THREE.BufferAttribute
      ).needsUpdate = true;
      (
        this.geometry.getAttribute("aSize") as THREE.BufferAttribute
      ).needsUpdate = true;
      (
        this.geometry.getAttribute("aAlpha") as THREE.BufferAttribute
      ).needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    if (this.ownsTexture) this.texture.dispose();
  }
}
