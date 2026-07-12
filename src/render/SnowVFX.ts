import * as THREE from "three";
import { createSoftDiscTexture } from "./particles/softDiscTexture";

/**
 * Alpine snow atmosphere: falling flakes + near-ground blowing snow.
 * Camera-relative wrap (same idea as RainVFX). No splash pool.
 */

const FALL_COUNT = 700;
const FALL_AREA = 52;
const FALL_HEIGHT = 32;
const FALL_SPEED_MIN = 2.2;
const FALL_SPEED_MAX = 4.8;
const FALL_WIND_X = 1.4;
const FALL_WIND_Z = 2.6;

// Dense fine streamers — read as wind/airflow, not big puffs
const BLOW_COUNT = 1100;
const BLOW_AREA = 42;
const BLOW_HEIGHT_MIN = 0.08;
const BLOW_HEIGHT_MAX = 0.55;
const BLOW_SPEED_MIN = 9;
const BLOW_SPEED_MAX = 18;
const BLOW_WIND_X = 9.5;
const BLOW_WIND_Z = 3.8;

const DEAD_Y = -9999;

export type SnowVFXOptions = {
  getHeightAt: (x: number, z: number) => number;
  /** Scales particle counts (default 1). */
  density?: number;
};

export class SnowVFX {
  private readonly scene: THREE.Scene;
  private readonly getHeightAt: (x: number, z: number) => number;

  private readonly fallCount: number;
  private readonly blowCount: number;

  private readonly fallPos: Float32Array;
  private readonly fallSpeed: Float32Array;
  private readonly fallPhase: Float32Array;
  private readonly fallSize: Float32Array;
  private readonly fallGeo: THREE.BufferGeometry;
  private readonly fallMesh: THREE.Points;

  private readonly blowPos: Float32Array;
  private readonly blowSpeed: Float32Array;
  private readonly blowPhase: Float32Array;
  private readonly blowSize: Float32Array;
  private readonly blowGeo: THREE.BufferGeometry;
  private readonly blowMesh: THREE.Points;

  private readonly sharedTex: THREE.CanvasTexture;
  private time = 0;

  constructor(scene: THREE.Scene, opts: SnowVFXOptions) {
    this.scene = scene;
    this.getHeightAt = opts.getHeightAt;
    const dens = Math.max(0.25, Math.min(2, opts.density ?? 1));
    this.fallCount = Math.max(80, Math.floor(FALL_COUNT * dens));
    this.blowCount = Math.max(60, Math.floor(BLOW_COUNT * dens));
    this.sharedTex = createSoftDiscTexture(48);

    // --- Falling flakes ---
    this.fallPos = new Float32Array(this.fallCount * 3);
    this.fallSpeed = new Float32Array(this.fallCount);
    this.fallPhase = new Float32Array(this.fallCount);
    this.fallSize = new Float32Array(this.fallCount);
    for (let i = 0; i < this.fallCount; i++) {
      this.fallPos[i * 3] = (Math.random() - 0.5) * FALL_AREA;
      this.fallPos[i * 3 + 1] = Math.random() * FALL_HEIGHT;
      this.fallPos[i * 3 + 2] = (Math.random() - 0.5) * FALL_AREA;
      this.fallSpeed[i] =
        FALL_SPEED_MIN + Math.random() * (FALL_SPEED_MAX - FALL_SPEED_MIN);
      this.fallPhase[i] = Math.random() * Math.PI * 2;
      this.fallSize[i] = 3.5 + Math.random() * 5;
    }
    this.fallGeo = new THREE.BufferGeometry();
    this.fallGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.fallPos, 3),
    );
    this.fallGeo.setAttribute(
      "aSize",
      new THREE.BufferAttribute(this.fallSize, 1),
    );
    const fallMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this.sharedTex },
        uColor: { value: new THREE.Color(0.95, 0.97, 1.0) },
        uOpacity: { value: 0.72 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vFade = 1.0;
          gl_PointSize = max(1.5, aSize * (180.0 / -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          float a = t.a * uOpacity * vFade;
          if (a < 0.02) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.fallMesh = new THREE.Points(this.fallGeo, fallMat);
    this.fallMesh.name = "snow-fall";
    this.fallMesh.frustumCulled = false;
    this.fallMesh.renderOrder = 4;
    scene.add(this.fallMesh);

    // --- Ground blowing snow ---
    this.blowPos = new Float32Array(this.blowCount * 3);
    this.blowSpeed = new Float32Array(this.blowCount);
    this.blowPhase = new Float32Array(this.blowCount);
    this.blowSize = new Float32Array(this.blowCount);
    for (let i = 0; i < this.blowCount; i++) {
      this.blowPos[i * 3] = (Math.random() - 0.5) * BLOW_AREA;
      this.blowPos[i * 3 + 1] = DEAD_Y;
      this.blowPos[i * 3 + 2] = (Math.random() - 0.5) * BLOW_AREA;
      this.blowSpeed[i] =
        BLOW_SPEED_MIN + Math.random() * (BLOW_SPEED_MAX - BLOW_SPEED_MIN);
      this.blowPhase[i] = Math.random() * Math.PI * 2;
      this.blowSize[i] = 2.2 + Math.random() * 3.2;
    }
    this.blowGeo = new THREE.BufferGeometry();
    this.blowGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.blowPos, 3),
    );
    this.blowGeo.setAttribute(
      "aSize",
      new THREE.BufferAttribute(this.blowSize, 1),
    );
    const blowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this.sharedTex },
        uColor: { value: new THREE.Color(0.9, 0.93, 0.98) },
        uOpacity: { value: 0.28 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, aSize * (140.0 / -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          float a = t.a * uOpacity;
          if (a < 0.012) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.blowMesh = new THREE.Points(this.blowGeo, blowMat);
    this.blowMesh.name = "snow-blow";
    this.blowMesh.frustumCulled = false;
    this.blowMesh.renderOrder = 4;
    scene.add(this.blowMesh);

    // Scatter blow flakes once around origin; first update repositions to cam
    for (let i = 0; i < this.blowCount; i++) {
      this.respawnBlow(i, { x: 0, y: 10, z: 0 }, true);
    }
  }

  update(dt: number, camPos: { x: number; y: number; z: number }): void {
    if (dt <= 0) return;
    const step = Math.min(dt, 0.05);
    this.time += step;
    this.updateFall(step, camPos);
    this.updateBlow(step, camPos);
  }

  private updateFall(
    dt: number,
    camPos: { x: number; y: number; z: number },
  ): void {
    const pos = this.fallPos;
    const half = FALL_AREA * 0.5;
    const t = this.time;

    for (let i = 0; i < this.fallCount; i++) {
      const i3 = i * 3;
      const phase = this.fallPhase[i]!;
      const sway = Math.sin(t * 1.6 + phase) * 0.55;
      pos[i3]! += (FALL_WIND_X + sway) * dt;
      pos[i3 + 1]! -= this.fallSpeed[i]! * dt;
      pos[i3 + 2]! += (FALL_WIND_Z + Math.cos(t * 1.1 + phase) * 0.35) * dt;

      let dx = pos[i3]! - camPos.x;
      let dz = pos[i3 + 2]! - camPos.z;
      if (dx > half) pos[i3]! -= FALL_AREA;
      else if (dx < -half) pos[i3]! += FALL_AREA;
      if (dz > half) pos[i3 + 2]! -= FALL_AREA;
      else if (dz < -half) pos[i3 + 2]! += FALL_AREA;

      const groundY = this.getHeightAt(pos[i3]!, pos[i3 + 2]!);
      if (pos[i3 + 1]! < groundY + 0.05) {
        pos[i3] = camPos.x + (Math.random() - 0.5) * FALL_AREA;
        pos[i3 + 1] =
          camPos.y + FALL_HEIGHT * 0.35 + Math.random() * FALL_HEIGHT * 0.65;
        pos[i3 + 2] = camPos.z + (Math.random() - 0.5) * FALL_AREA;
        this.fallPhase[i] = Math.random() * Math.PI * 2;
      }
    }
    this.fallGeo.attributes.position!.needsUpdate = true;
  }

  private updateBlow(
    dt: number,
    camPos: { x: number; y: number; z: number },
  ): void {
    const pos = this.blowPos;
    const half = BLOW_AREA * 0.5;
    const t = this.time;
    const windLen = Math.hypot(BLOW_WIND_X, BLOW_WIND_Z) || 1;
    const wx = BLOW_WIND_X / windLen;
    const wz = BLOW_WIND_Z / windLen;

    for (let i = 0; i < this.blowCount; i++) {
      const i3 = i * 3;
      if (pos[i3 + 1]! <= DEAD_Y + 1) {
        this.respawnBlow(i, camPos, true);
        continue;
      }
      const spd = this.blowSpeed[i]!;
      const phase = this.blowPhase[i]!;
      const lift = Math.sin(t * 5.5 + phase) * 0.06;
      pos[i3]! += wx * spd * dt;
      pos[i3 + 2]! += wz * spd * dt;
      // Keep hugging terrain
      const gY = this.getHeightAt(pos[i3]!, pos[i3 + 2]!);
      const targetY =
        gY +
        BLOW_HEIGHT_MIN +
        (BLOW_HEIGHT_MAX - BLOW_HEIGHT_MIN) * (0.35 + 0.65 * ((i % 7) / 7)) +
        lift;
      pos[i3 + 1] = pos[i3 + 1]! * 0.85 + targetY * 0.15;

      let dx = pos[i3]! - camPos.x;
      let dz = pos[i3 + 2]! - camPos.z;
      if (dx > half || dx < -half || dz > half || dz < -half) {
        this.respawnBlow(i, camPos, false);
      }
    }
    this.blowGeo.attributes.position!.needsUpdate = true;
  }

  private respawnBlow(
    i: number,
    camPos: { x: number; y: number; z: number },
    scatter: boolean,
  ): void {
    const i3 = i * 3;
    // Prefer respawn upwind so flakes blow across the view
    const windLen = Math.hypot(BLOW_WIND_X, BLOW_WIND_Z) || 1;
    const wx = BLOW_WIND_X / windLen;
    const wz = BLOW_WIND_Z / windLen;
    if (scatter) {
      this.blowPos[i3] = camPos.x + (Math.random() - 0.5) * BLOW_AREA;
      this.blowPos[i3 + 2] = camPos.z + (Math.random() - 0.5) * BLOW_AREA;
    } else {
      // Edge of volume opposite wind
      const side = (Math.random() - 0.5) * BLOW_AREA;
      this.blowPos[i3] = camPos.x - wx * (BLOW_AREA * 0.48) + -wz * side * 0.35;
      this.blowPos[i3 + 2] =
        camPos.z - wz * (BLOW_AREA * 0.48) + wx * side * 0.35;
    }
    const gY = this.getHeightAt(this.blowPos[i3]!, this.blowPos[i3 + 2]!);
    this.blowPos[i3 + 1] =
      gY +
      BLOW_HEIGHT_MIN +
      Math.random() * (BLOW_HEIGHT_MAX - BLOW_HEIGHT_MIN);
    this.blowPhase[i] = Math.random() * Math.PI * 2;
  }

  dispose(): void {
    this.scene.remove(this.fallMesh);
    this.fallGeo.dispose();
    (this.fallMesh.material as THREE.Material).dispose();

    this.scene.remove(this.blowMesh);
    this.blowGeo.dispose();
    (this.blowMesh.material as THREE.Material).dispose();

    this.sharedTex.dispose();
  }
}
