import * as THREE from "three";
import { sampleBilinear } from "@/levelgen/heightmap";
import { VEHICLE_CONFIG } from "@/shared/vehicleConfig";
import {
  lateralSpeedMps,
  streamWetness,
  type StreamSegmentInput,
} from "@/shared/offroadFxMath";
import {
  buildTerrainColorContext,
  pathProximity,
  terrainAlbedoAt,
  type GroundPalette,
  type TerrainColorContext,
} from "@/shared/terrainColor";
import {
  classifyTrackSurface,
  trackDepositStrength,
  trackHalfWidth,
  trackMarkColor,
  trackMinSpacing,
  trackSegmentLife,
  trackSpawnAlpha,
} from "@/shared/tireTrackMath";

export type TireTrackWheelSample = {
  contact: boolean;
  suspensionLength: number;
};

export type TireTrackSample = {
  position: { x: number; y: number; z: number };
  yaw: number;
  rotation: { x: number; y: number; z: number; w: number };
  linvel: { x: number; y: number; z: number };
  throttle: number;
  brake: number;
  wheels: readonly TireTrackWheelSample[];
};

export type TireTrackOptions = {
  segmentsPerWheel?: number;
  streams?: readonly StreamSegmentInput[];
  terrain?: {
    heightmap: Float32Array;
    resolution: number;
    worldSize: number;
    pathPolyline: readonly { x: number; z: number }[];
    groundPalette: GroundPalette;
    pathWidth?: number;
  };
  /** Flat sandbox ground Y */
  flatGroundY?: number;
  /**
   * Custom ground height (e.g. menu infinite strip).
   * Wins over heightmap / flatGroundY when set.
   */
  sampleGroundY?: (x: number, z: number) => number;
};

type WheelTrail = {
  hasLast: boolean;
  lastX: number;
  lastY: number;
  lastZ: number;
  lastDx: number;
  lastDz: number;
};

type SegmentMeta = {
  alive: boolean;
  life: number;
  maxLife: number;
  baseAlpha: number;
};

const VISUAL_TRACK_OUTSET = 0.16;
const Y_BIAS = 0.035; // sit slightly above terrain to reduce z-fight
const WHEEL_COUNT = 4;

/**
 * Fading tire-mark ribbons under each wheel. Surface-aware (mud / path / wet).
 */
export class TireTrackSystem {
  private readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly segmentsPerWheel: number;
  private readonly capacity: number;
  private readonly metas: SegmentMeta[];
  private readonly cursors: number[];
  private readonly trails: WheelTrail[];
  private streams: readonly StreamSegmentInput[] = [];
  private terrainCtx: TerrainColorContext | null = null;
  private heightmap: Float32Array | null = null;
  private resolution = 0;
  private worldSize = 0;
  private flatGroundY: number | null = null;
  private customSampleGroundY: ((x: number, z: number) => number) | null =
    null;
  private readonly _q = new THREE.Quaternion();
  private readonly _local = new THREE.Vector3();

  constructor(scene: THREE.Scene, opts?: TireTrackOptions) {
    this.group.name = "tire-tracks";
    this.segmentsPerWheel = opts?.segmentsPerWheel ?? 72;
    this.capacity = this.segmentsPerWheel * WHEEL_COUNT;

    this.positions = new Float32Array(this.capacity * 4 * 3);
    this.colors = new Float32Array(this.capacity * 4 * 4);
    this.metas = new Array(this.capacity);
    this.cursors = [0, 0, 0, 0];
    this.trails = [];
    for (let w = 0; w < WHEEL_COUNT; w++) {
      this.trails.push({
        hasLast: false,
        lastX: 0,
        lastY: 0,
        lastZ: 0,
        lastDx: 0,
        lastDz: 1,
      });
    }
    for (let i = 0; i < this.capacity; i++) {
      this.metas[i] = {
        alive: false,
        life: 0,
        maxLife: 1,
        baseAlpha: 0,
      };
      // park dead verts underground
      for (let v = 0; v < 4; v++) {
        this.positions[(i * 4 + v) * 3 + 1] = -999;
      }
    }

    const indices = new Uint32Array(this.capacity * 6);
    for (let i = 0; i < this.capacity; i++) {
      const b = i * 4;
      const o = i * 6;
      indices[o] = b;
      indices[o + 1] = b + 1;
      indices[o + 2] = b + 2;
      indices[o + 3] = b + 1;
      indices[o + 4] = b + 3;
      indices[o + 5] = b + 2;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute(
      "aColor",
      new THREE.BufferAttribute(this.colors, 4),
    );
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Custom shader so per-vertex alpha works (MeshBasic ignores color.a).
    // Use aColor — do not redeclare Three's built-in `color`.
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL1,
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          if (vColor.a < 0.02) discard;
          gl_FragColor = vColor;
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "tire-track-mesh";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.group.add(this.mesh);
    scene.add(this.group);

    if (opts?.streams) this.streams = opts.streams;
    if (opts?.flatGroundY != null) this.flatGroundY = opts.flatGroundY;
    if (opts?.sampleGroundY) this.customSampleGroundY = opts.sampleGroundY;
    if (opts?.terrain) {
      this.heightmap = opts.terrain.heightmap;
      this.resolution = opts.terrain.resolution;
      this.worldSize = opts.terrain.worldSize;
      this.terrainCtx = buildTerrainColorContext({
        groundPalette: opts.terrain.groundPalette,
        heightmap: opts.terrain.heightmap,
        pathPolyline: opts.terrain.pathPolyline,
        pathWidth: opts.terrain.pathWidth,
      });
    }
  }

  update(dt: number, sample: TireTrackSample): void {
    const dtClamped = Math.min(0.05, Math.max(0, dt));
    this._q.set(
      sample.rotation.x,
      sample.rotation.y,
      sample.rotation.z,
      sample.rotation.w,
    );

    const vx = sample.linvel.x;
    const vz = sample.linvel.z;
    const speed = Math.hypot(vx, vz);
    const yaw = sample.yaw;
    const lat = Math.abs(lateralSpeedMps(vx, vz, yaw));

    // Travel direction (prefer velocity; fall back to chassis forward)
    let dirX = vx;
    let dirZ = vz;
    const dirLen = Math.hypot(dirX, dirZ);
    if (dirLen > 0.4) {
      dirX /= dirLen;
      dirZ /= dirLen;
    } else {
      dirX = Math.sin(yaw);
      dirZ = Math.cos(yaw);
    }

    const nWheels = Math.min(WHEEL_COUNT, sample.wheels.length);
    const radius = VEHICLE_CONFIG.wheelRadius;
    let posDirty = false;
    let colDirty = false;

    for (let i = 0; i < nWheels; i++) {
      const w = sample.wheels[i];
      const trail = this.trails[i];
      if (!w.contact) {
        trail.hasLast = false;
        continue;
      }

      const contact = this.wheelContactWorld(i, w.suspensionLength, radius, sample);
      const groundY = this.sampleGroundY(contact.x, contact.z);
      const y = groundY + Y_BIAS;
      const pathW = this.terrainCtx
        ? pathProximity(
            contact.x,
            contact.z,
            this.terrainCtx.pathPolyline,
            this.terrainCtx.pathHalfWidth,
          )
        : 0;
      const wet = streamWetness(contact.x, contact.z, this.streams);
      const surface = classifyTrackSurface(pathW, wet);
      const strength = trackDepositStrength({
        grounded: true,
        speedMps: speed,
        throttle: sample.throttle,
        brake: sample.brake,
        lateralAbsMps: lat,
        surface,
      });

      if (strength <= 0.02) {
        // Still update last if moving so we don't jump when strength returns
        if (trail.hasLast) {
          const dist = Math.hypot(contact.x - trail.lastX, contact.z - trail.lastZ);
          if (dist > trackMinSpacing(speed)) {
            trail.lastX = contact.x;
            trail.lastY = y;
            trail.lastZ = contact.z;
            trail.lastDx = dirX;
            trail.lastDz = dirZ;
          }
        } else {
          trail.hasLast = true;
          trail.lastX = contact.x;
          trail.lastY = y;
          trail.lastZ = contact.z;
          trail.lastDx = dirX;
          trail.lastDz = dirZ;
        }
        continue;
      }

      if (!trail.hasLast) {
        trail.hasLast = true;
        trail.lastX = contact.x;
        trail.lastY = y;
        trail.lastZ = contact.z;
        trail.lastDx = dirX;
        trail.lastDz = dirZ;
        continue;
      }

      const dist = Math.hypot(contact.x - trail.lastX, contact.z - trail.lastZ);
      if (dist < trackMinSpacing(speed)) continue;

      // Segment direction from last → current
      let sx = contact.x - trail.lastX;
      let sz = contact.z - trail.lastZ;
      const sl = Math.hypot(sx, sz);
      if (sl < 1e-5) continue;
      sx /= sl;
      sz /= sl;
      // Perpendicular in XZ
      const px = -sz;
      const pz = sx;

      const halfW = trackHalfWidth({
        strength,
        surface,
        lateralAbsMps: lat,
      });
      const albedo = this.sampleAlbedo(contact.x, contact.z, groundY);
      const rgb = trackMarkColor(surface, albedo, strength);
      const alpha = trackSpawnAlpha(strength, surface);
      const life = trackSegmentLife(surface, strength);

      // Smooth lateral: average last/current travel for less zigzag
      const lx0 = trail.lastX + px * halfW;
      const lz0 = trail.lastZ + pz * halfW;
      const rx0 = trail.lastX - px * halfW;
      const rz0 = trail.lastZ - pz * halfW;
      const lx1 = contact.x + px * halfW;
      const lz1 = contact.z + pz * halfW;
      const rx1 = contact.x - px * halfW;
      const rz1 = contact.z - pz * halfW;

      const segIndex =
        i * this.segmentsPerWheel +
        (this.cursors[i] % this.segmentsPerWheel);
      this.cursors[i] = (this.cursors[i] + 1) % this.segmentsPerWheel;

      this.writeSegment(
        segIndex,
        lx0,
        trail.lastY,
        lz0,
        rx0,
        trail.lastY,
        rz0,
        lx1,
        y,
        lz1,
        rx1,
        y,
        rz1,
        rgb.r,
        rgb.g,
        rgb.b,
        alpha,
        life,
      );
      posDirty = true;
      colDirty = true;

      trail.lastX = contact.x;
      trail.lastY = y;
      trail.lastZ = contact.z;
      trail.lastDx = sx;
      trail.lastDz = sz;
    }

    // Fade all segments
    if (dtClamped > 0) {
      for (let i = 0; i < this.capacity; i++) {
        const m = this.metas[i];
        if (!m.alive) continue;
        m.life -= dtClamped;
        if (m.life <= 0) {
          m.alive = false;
          this.killSegment(i);
          posDirty = true;
          colDirty = true;
          continue;
        }
        const t = m.life / m.maxLife;
        // Hold full alpha then fade
        const fade = t > 0.45 ? 1 : t / 0.45;
        const a = m.baseAlpha * fade;
        this.setSegmentAlpha(i, a);
        colDirty = true;
      }
    }

    if (posDirty) {
      (
        this.geometry.getAttribute("position") as THREE.BufferAttribute
      ).needsUpdate = true;
    }
    if (colDirty) {
      (
        this.geometry.getAttribute("aColor") as THREE.BufferAttribute
      ).needsUpdate = true;
    }
  }

  private writeSegment(
    i: number,
    lx0: number,
    y0a: number,
    lz0: number,
    rx0: number,
    y0b: number,
    rz0: number,
    lx1: number,
    y1a: number,
    lz1: number,
    rx1: number,
    y1b: number,
    rz1: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
    life: number,
  ): void {
    const m = this.metas[i];
    m.alive = true;
    m.life = life;
    m.maxLife = life;
    m.baseAlpha = alpha;

    const base = i * 4;
    // v0 left-start, v1 right-start, v2 left-end, v3 right-end
    const verts = [
      [lx0, y0a, lz0],
      [rx0, y0b, rz0],
      [lx1, y1a, lz1],
      [rx1, y1b, rz1],
    ];
    for (let v = 0; v < 4; v++) {
      const p = base + v;
      this.positions[p * 3] = verts[v][0];
      this.positions[p * 3 + 1] = verts[v][1];
      this.positions[p * 3 + 2] = verts[v][2];
      this.colors[p * 4] = r;
      this.colors[p * 4 + 1] = g;
      this.colors[p * 4 + 2] = b;
      this.colors[p * 4 + 3] = alpha;
    }
  }

  private setSegmentAlpha(i: number, a: number): void {
    const base = i * 4;
    for (let v = 0; v < 4; v++) {
      this.colors[(base + v) * 4 + 3] = a;
    }
  }

  private killSegment(i: number): void {
    const base = i * 4;
    for (let v = 0; v < 4; v++) {
      this.positions[(base + v) * 3 + 1] = -999;
      this.colors[(base + v) * 4 + 3] = 0;
    }
  }

  private wheelContactWorld(
    wheelIndex: number,
    suspLen: number,
    radius: number,
    sample: TireTrackSample,
  ): { x: number; y: number; z: number } {
    const hard =
      VEHICLE_CONFIG.wheelPositions[wheelIndex] ??
      VEHICLE_CONFIG.wheelPositions[0];
    const side = hard.x >= 0 ? 1 : -1;
    this._local.set(
      hard.x + side * VISUAL_TRACK_OUTSET,
      hard.y - suspLen - radius * 0.92,
      hard.z,
    );
    this._local.applyQuaternion(this._q);
    return {
      x: sample.position.x + this._local.x,
      y: sample.position.y + this._local.y,
      z: sample.position.z + this._local.z,
    };
  }

  private sampleGroundY(x: number, z: number): number {
    if (this.customSampleGroundY) {
      return this.customSampleGroundY(x, z);
    }
    if (this.heightmap && this.resolution > 0) {
      return sampleBilinear(
        this.heightmap,
        this.resolution,
        this.worldSize,
        x,
        z,
      );
    }
    return this.flatGroundY ?? 0;
  }

  private sampleAlbedo(
    x: number,
    z: number,
    height: number,
  ): { r: number; g: number; b: number } {
    if (this.terrainCtx) {
      return terrainAlbedoAt(x, z, height, this.terrainCtx);
    }
    return { r: 0.55, g: 0.48, b: 0.38 };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
