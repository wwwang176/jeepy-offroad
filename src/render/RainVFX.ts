import * as THREE from "three";

/**
 * Light rain + ground splash VFX (ported from island-conquest StormVFX,
 * rain volume ~½ of the storm baseline; no lightning).
 *
 * 2 draw calls: rain Points + splash Points. Camera-relative wrap.
 */

// Half of island-conquest StormVFX defaults
const RAIN_COUNT = 1500;
const RAIN_AREA = 60;
const RAIN_HEIGHT = 40;
const RAIN_SPEED = 37.5;
const WIND_X = 2;
const WIND_Z = 5;

const SPLASH_COUNT = 6000;
const SPLASH_SPAWN_RATE = 600; // /s — ×2 vs prior light-rain baseline
const SPLASH_RADIUS = 30;
const SPLASH_LIFE_MIN = 0.08;
const SPLASH_LIFE_MAX = 0.15;

const DEAD_Y = -9999;

const _rainDir = new THREE.Vector3(WIND_X, -RAIN_SPEED, WIND_Z).normalize();

const rainVertexShader = /* glsl */ `
uniform vec3 uRainDir;
attribute float aOpacity;
varying float vOpacity;
varying vec2 vStreakDir;
void main() {
  vOpacity = aOpacity;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 vp = mvPosition.xyz;
  vec3 vd = mat3(modelViewMatrix) * uRainDir;
  float negZ = -vp.z;
  vec2 sv = vec2(
    vd.x * negZ + vp.x * vd.z,
    vd.y * negZ + vp.y * vd.z
  );
  float len = length(sv);
  vStreakDir = len > 0.001 ? sv / len : vec2(0.0, -1.0);
  float cosAim = abs(dot(normalize(vd), normalize(vp)));
  float streakScale = 1.0 - cosAim;
  gl_PointSize = max(2.0, 10.0 * streakScale * (200.0 / negZ));
  gl_Position = projectionMatrix * mvPosition;
}
`;

const rainFragmentShader = /* glsl */ `
varying float vOpacity;
varying vec2 vStreakDir;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  vec2 dir = vec2(vStreakDir.x, -vStreakDir.y);
  float along = dot(uv, dir);
  vec2 perp = uv - along * dir;
  float across = length(perp);
  float maskAcross = smoothstep(0.008, 0.0, across);
  float maskAlong = smoothstep(0.5, 0.05, abs(along));
  float mask = maskAcross * maskAlong;
  if (mask < 0.01) discard;
  gl_FragColor = vec4(0.75, 0.8, 0.85, vOpacity * mask * 0.5);
}
`;

const splashVertexShader = /* glsl */ `
attribute float aSize;
attribute float aOpacity;
varying float vOpacity;
void main() {
  vOpacity = aOpacity;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (200.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const splashFragmentShader = /* glsl */ `
varying float vOpacity;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float alpha = vOpacity * (1.0 - d * 2.0);
  gl_FragColor = vec4(0.8, 0.85, 0.9, alpha);
}
`;

export type RainVFXOptions = {
  /** World height at (x,z). */
  getHeightAt: (x: number, z: number) => number;
};

export class RainVFX {
  private readonly scene: THREE.Scene;
  private readonly getHeightAt: (x: number, z: number) => number;

  private readonly rainPositions: Float32Array;
  private readonly rainGeo: THREE.BufferGeometry;
  private readonly rainMesh: THREE.Points;

  private readonly splashPositions: Float32Array;
  private readonly splashSizes: Float32Array;
  private readonly splashOpacities: Float32Array;
  private readonly splashGeo: THREE.BufferGeometry;
  private readonly splashMesh: THREE.Points;
  private readonly splashLife: Float32Array;
  private readonly splashMaxLife: Float32Array;
  private readonly splashVx: Float32Array;
  private readonly splashVy: Float32Array;
  private readonly splashVz: Float32Array;
  private splashNextIndex = 0;
  private splashAccum = 0;
  /** False until first update with real camera — avoid world-origin rain burst. */
  private seededAroundCamera = false;
  /** Delay splash intro slightly so first frames aren't a splash wave. */
  private splashIntroDelay = 0.35;

  constructor(scene: THREE.Scene, opts: RainVFXOptions) {
    this.scene = scene;
    this.getHeightAt = opts.getHeightAt;

    // --- Rain (park dead until first camera seed) ---
    const rainPos = new Float32Array(RAIN_COUNT * 3);
    const rainOpacity = new Float32Array(RAIN_COUNT);
    for (let i = 0; i < RAIN_COUNT; i++) {
      const i3 = i * 3;
      rainPos[i3] = 0;
      rainPos[i3 + 1] = DEAD_Y;
      rainPos[i3 + 2] = 0;
      rainOpacity[i] = 0.3 + Math.random() * 0.7;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
    rainGeo.setAttribute(
      "aOpacity",
      new THREE.BufferAttribute(rainOpacity, 1),
    );
    const rainMat = new THREE.ShaderMaterial({
      uniforms: { uRainDir: { value: _rainDir } },
      vertexShader: rainVertexShader,
      fragmentShader: rainFragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const rainMesh = new THREE.Points(rainGeo, rainMat);
    rainMesh.name = "rain-streaks";
    rainMesh.frustumCulled = false;
    scene.add(rainMesh);
    this.rainPositions = rainPos;
    this.rainGeo = rainGeo;
    this.rainMesh = rainMesh;

    // --- Ground splashes ---
    const splashPos = new Float32Array(SPLASH_COUNT * 3);
    const sizes = new Float32Array(SPLASH_COUNT);
    const opacities = new Float32Array(SPLASH_COUNT);
    for (let i = 0; i < SPLASH_COUNT; i++) {
      splashPos[i * 3 + 1] = DEAD_Y;
      sizes[i] = 0;
      opacities[i] = 0;
    }
    const splashGeo = new THREE.BufferGeometry();
    splashGeo.setAttribute("position", new THREE.BufferAttribute(splashPos, 3));
    splashGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    splashGeo.setAttribute(
      "aOpacity",
      new THREE.BufferAttribute(opacities, 1),
    );
    const splashMat = new THREE.ShaderMaterial({
      vertexShader: splashVertexShader,
      fragmentShader: splashFragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const splashMesh = new THREE.Points(splashGeo, splashMat);
    splashMesh.name = "rain-splashes";
    splashMesh.frustumCulled = false;
    scene.add(splashMesh);

    this.splashPositions = splashPos;
    this.splashSizes = sizes;
    this.splashOpacities = opacities;
    this.splashGeo = splashGeo;
    this.splashMesh = splashMesh;
    this.splashLife = new Float32Array(SPLASH_COUNT);
    this.splashMaxLife = new Float32Array(SPLASH_COUNT);
    this.splashVx = new Float32Array(SPLASH_COUNT);
    this.splashVy = new Float32Array(SPLASH_COUNT);
    this.splashVz = new Float32Array(SPLASH_COUNT);
  }

  update(dt: number, camPos: { x: number; y: number; z: number }): void {
    if (dt <= 0) return;
    // Cap step so tab-out doesn't teleport every drop
    const step = Math.min(dt, 0.05);
    if (!this.seededAroundCamera) {
      this.seedRainAroundCamera(camPos);
      this.seededAroundCamera = true;
    }
    this.updateRain(step, camPos);
    this.updateSplashes(step, camPos);
  }

  /**
   * First live frame: place drops around the real camera with random heights
   * (not world origin). Same idea as alpine SnowVFX fall seed.
   */
  private seedRainAroundCamera(camPos: {
    x: number;
    y: number;
    z: number;
  }): void {
    const pos = this.rainPositions;
    for (let i = 0; i < RAIN_COUNT; i++) {
      const i3 = i * 3;
      const x = camPos.x + (Math.random() - 0.5) * RAIN_AREA;
      const z = camPos.z + (Math.random() - 0.5) * RAIN_AREA;
      const gY = this.getHeightAt(x, z);
      // Full column: near ground up through sky above camera
      const y =
        gY +
        0.5 +
        Math.random() *
          Math.max(RAIN_HEIGHT, camPos.y - gY + RAIN_HEIGHT * 0.5);
      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;
    }
    this.rainGeo.attributes.position!.needsUpdate = true;
  }

  private updateRain(
    dt: number,
    camPos: { x: number; y: number; z: number },
  ): void {
    const pos = this.rainPositions;
    const halfArea = RAIN_AREA * 0.5;
    const fallDist = RAIN_SPEED * dt;
    const windDx = WIND_X * dt;
    const windDz = WIND_Z * dt;

    for (let i = 0; i < RAIN_COUNT; i++) {
      const i3 = i * 3;
      // Still parked (should only happen before seed)
      if (pos[i3 + 1]! <= DEAD_Y + 1) continue;

      pos[i3] += windDx;
      pos[i3 + 1] -= fallDist;
      pos[i3 + 2] += windDz;

      const dx = pos[i3] - camPos.x;
      const dz = pos[i3 + 2] - camPos.z;
      if (dx > halfArea) pos[i3] -= RAIN_AREA;
      else if (dx < -halfArea) pos[i3] += RAIN_AREA;
      if (dz > halfArea) pos[i3 + 2] -= RAIN_AREA;
      else if (dz < -halfArea) pos[i3 + 2] += RAIN_AREA;

      const groundY = this.getHeightAt(pos[i3], pos[i3 + 2]);
      if (pos[i3 + 1] < groundY) {
        pos[i3] = camPos.x + (Math.random() - 0.5) * RAIN_AREA;
        // Respawn across full height band (not a single sky sheet)
        const gY = this.getHeightAt(pos[i3], pos[i3 + 2]);
        pos[i3 + 1] =
          gY +
          0.5 +
          Math.random() *
            Math.max(RAIN_HEIGHT, camPos.y - gY + RAIN_HEIGHT * 0.5);
        pos[i3 + 2] = camPos.z + (Math.random() - 0.5) * RAIN_AREA;
      }
    }
    this.rainGeo.attributes.position!.needsUpdate = true;
  }

  private updateSplashes(
    dt: number,
    camPos: { x: number; y: number; z: number },
  ): void {
    // Don't full-burst splash on enter — wait a short beat, then rate-limit as usual
    if (this.splashIntroDelay > 0) {
      this.splashIntroDelay -= dt;
      return;
    }
    this.splashAccum += SPLASH_SPAWN_RATE * dt;
    while (this.splashAccum >= 1) {
      this.splashAccum -= 1;
      this.spawnOneSplash(camPos);
    }

    const pos = this.splashPositions;
    const life = this.splashLife;
    const maxLife = this.splashMaxLife;
    const opac = this.splashOpacities;
    const sz = this.splashSizes;
    const vx = this.splashVx;
    const vy = this.splashVy;
    const vz = this.splashVz;
    let anyAlive = false;

    for (let i = 0; i < SPLASH_COUNT; i++) {
      if (life[i] <= 0) continue;
      anyAlive = true;
      life[i] -= dt;
      const i3 = i * 3;
      vy[i] -= 12 * dt;
      pos[i3] += vx[i] * dt;
      pos[i3 + 1] += vy[i] * dt;
      pos[i3 + 2] += vz[i] * dt;

      if (life[i] <= 0) {
        life[i] = 0;
        pos[i3 + 1] = DEAD_Y;
        sz[i] = 0;
        opac[i] = 0;
      } else {
        opac[i] = (life[i] / maxLife[i]) * 0.8;
      }
    }

    if (anyAlive || this.splashAccum > 0) {
      this.splashGeo.attributes.position!.needsUpdate = true;
      this.splashGeo.attributes.aSize!.needsUpdate = true;
      this.splashGeo.attributes.aOpacity!.needsUpdate = true;
    }
  }

  private spawnOneSplash(camPos: { x: number; y: number; z: number }): void {
    const idx = this.splashNextIndex;
    this.splashNextIndex = (this.splashNextIndex + 1) % SPLASH_COUNT;

    const rx = camPos.x + (Math.random() - 0.5) * SPLASH_RADIUS * 2;
    const rz = camPos.z + (Math.random() - 0.5) * SPLASH_RADIUS * 2;
    const groundY = this.getHeightAt(rx, rz);

    const i3 = idx * 3;
    this.splashPositions[i3] = rx;
    this.splashPositions[i3 + 1] = groundY + 0.05;
    this.splashPositions[i3 + 2] = rz;

    this.splashVx[idx] = (Math.random() - 0.5) * 0.75;
    this.splashVy[idx] = 0.75 + Math.random() * 1;
    this.splashVz[idx] = (Math.random() - 0.5) * 0.75;

    const lifeVal =
      SPLASH_LIFE_MIN + Math.random() * (SPLASH_LIFE_MAX - SPLASH_LIFE_MIN);
    this.splashLife[idx] = lifeVal;
    this.splashMaxLife[idx] = lifeVal;
    this.splashSizes[idx] = 0.225 + Math.random() * 0.3;
    this.splashOpacities[idx] = 0.7;
  }

  dispose(): void {
    this.scene.remove(this.rainMesh);
    this.rainGeo.dispose();
    (this.rainMesh.material as THREE.Material).dispose();

    this.scene.remove(this.splashMesh);
    this.splashGeo.dispose();
    (this.splashMesh.material as THREE.Material).dispose();
  }
}
