import * as THREE from "three";
import { sampleBilinear } from "@/levelgen/heightmap";
import { VEHICLE_CONFIG } from "@/shared/vehicleConfig";
import {
  bodyContactEmitRate,
  bodyImpactBurstCount,
  dustEmitRate,
  exhaustEmitRate,
  landingBurstCount,
  lateralSpeedMps,
  parseHexRgb,
  bodyImmersionWeight,
  bodyWaterSprayEmitRate,
  immersionDepthM,
  pondSurfaceYAt,
  splashEmitRate,
  waterSplashColor,
  waterWetness,
  type PondWetnessInput,
  type Rgb,
  type StreamSegmentInput,
} from "@/shared/offroadFxMath";
import {
  buildTerrainColorContext,
  dustColorFromTerrainAlbedo,
  terrainAlbedoAt,
  type GroundPalette,
  type TerrainColorContext,
} from "@/shared/terrainColor";
import { ParticlePool } from "./ParticlePool";
import { createSoftDiscTexture } from "./softDiscTexture";

export type OffroadFxWheelSample = {
  contact: boolean;
  suspensionLength: number;
  /**
   * Cumulative wheel spin angle (rad) from Rapier, if available.
   * Used to derive tread speed for dust kick; omit → throttle proxy.
   */
  rotation?: number;
  /** Front-wheel steer (rad), same as Rapier / mesh. Rear = 0. */
  steering?: number;
};

/** Dust spray elevation above wheel plane (rad) — body-relative loft. */
const DUST_ELEV_RAD = (28 * Math.PI) / 180;
const SPLASH_ELEV_RAD = (40 * Math.PI) / 180;
const BODY_ELEV_RAD = (32 * Math.PI) / 180;

export type OffroadFxSample = {
  position: { x: number; y: number; z: number };
  yaw: number;
  rotation: { x: number; y: number; z: number; w: number };
  linvel: { x: number; y: number; z: number };
  throttle: number;
  brake: number;
  /** "H" | "L" — 4L boosts dust */
  driveRange: "H" | "L";
  wheels: readonly OffroadFxWheelSample[];
  /** Chassis/cabin terrain contacts (world space). */
  bodyContacts?: readonly { x: number; y: number; z: number }[];
};

/**
 * Key body sample points for immersion drainage (chassis local).
 * Front/rear bumper lower edge, left/right rockers, belly — denser than a
 * simple 9-corner set; depth is measured vs pond surfaceY each frame.
 */
const BODY_WATER_LOCAL: readonly { x: number; y: number; z: number }[] = (() => {
  const hx = VEHICLE_CONFIG.chassisHalfExtents.x;
  const hy = -VEHICLE_CONFIG.chassisHalfExtents.y;
  const hz = VEHICLE_CONFIG.chassisHalfExtents.z;
  // Slightly above absolute bottom so points sit at rocker / bumper lip
  const yRocker = hy * 0.88;
  const yLip = hy * 0.72;
  return [
    // Front bumper lower edge
    { x: -hx * 0.75, y: yLip, z: hz * 0.98 },
    { x: 0, y: yLip, z: hz * 1.02 },
    { x: hx * 0.75, y: yLip, z: hz * 0.98 },
    // Rear bumper lower edge
    { x: -hx * 0.75, y: yLip, z: -hz * 0.98 },
    { x: 0, y: yLip, z: -hz * 1.02 },
    { x: hx * 0.75, y: yLip, z: -hz * 0.98 },
    // Left rocker (3)
    { x: -hx * 0.95, y: yRocker, z: hz * 0.45 },
    { x: -hx * 0.95, y: yRocker, z: 0 },
    { x: -hx * 0.95, y: yRocker, z: -hz * 0.45 },
    // Right rocker (3)
    { x: hx * 0.95, y: yRocker, z: hz * 0.45 },
    { x: hx * 0.95, y: yRocker, z: 0 },
    { x: hx * 0.95, y: yRocker, z: -hz * 0.45 },
    // Belly / centerline
    { x: 0, y: yRocker, z: hz * 0.35 },
    { x: 0, y: yRocker, z: 0 },
    { x: 0, y: yRocker, z: -hz * 0.35 },
    // Mid flanks (fill between rocker and bumper)
    { x: -hx * 0.55, y: yLip, z: 0 },
    { x: hx * 0.55, y: yLip, z: 0 },
  ];
})();

export type OffroadFxOptions = {
  /** Max live particles (default 900). */
  capacity?: number;
  streams?: readonly StreamSegmentInput[];
  /** Pond wetness (current pond-only hydrology). */
  ponds?: readonly PondWetnessInput[];
  waterColor?: string;
  /**
   * Level terrain for dust that matches vertex-colored ground.
   * When omitted (sandbox), falls back to `fallbackDustColor`.
   */
  terrain?: {
    heightmap: Float32Array;
    resolution: number;
    worldSize: number;
    pathPolyline: readonly { x: number; z: number }[];
    groundPalette: GroundPalette;
    pathWidth?: number;
  };
  /** Sandbox / no heightmap */
  fallbackDustColor?: Rgb;
};

const VISUAL_TRACK_OUTSET = 0.16;
const DUST_ACC = new Float32Array(4);
const SPLASH_ACC = new Float32Array(4);
const EXHAUST_ACC = { v: 0 };
const BODY_ACC = { v: 0 };

/**
 * Off-road VFX: tire dust tinted from terrain albedo (same as mesh), landing
 * bursts, stream splash, side-slip plumes, and light exhaust.
 */
export class OffroadFx {
  private readonly group = new THREE.Group();
  private readonly dust: ParticlePool;
  private readonly splash: ParticlePool;
  private readonly exhaust: ParticlePool;
  private readonly sharedTex: THREE.CanvasTexture;
  private streams: readonly StreamSegmentInput[] = [];
  private ponds: readonly PondWetnessInput[] = [];
  private splashColor: Rgb = { r: 0.72, g: 0.82, b: 0.88 };
  private readonly bodyWaterAcc = { v: 0 };
  private fallbackDust: Rgb = dustColorFromTerrainAlbedo(
    parseHexRgb("#9a8f78"),
  );
  private terrainCtx: TerrainColorContext | null = null;
  private heightmap: Float32Array | null = null;
  private resolution = 0;
  private worldSize = 0;
  private prevContact: boolean[] = [false, false, false, false];
  private prevBodyContactCount = 0;
  /** Previous wheel rotation (rad); NaN = not primed. */
  private readonly prevWheelRot = new Float32Array(4).fill(Number.NaN);
  private readonly _q = new THREE.Quaternion();
  private readonly _local = new THREE.Vector3();
  private readonly _world = new THREE.Vector3();
  /** Chassis basis in world (from full pose quat — follows pitch/roll/yaw). */
  private readonly _chassisFwd = new THREE.Vector3();
  private readonly _chassisRight = new THREE.Vector3();
  private readonly _chassisUp = new THREE.Vector3();
  /** Per-puff scratch: wheel forward / right / spray dir. */
  private readonly _wheelFwd = new THREE.Vector3();
  private readonly _wheelRight = new THREE.Vector3();
  private readonly _sprayDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, opts?: OffroadFxOptions) {
    this.group.name = "offroad-fx";
    this.sharedTex = createSoftDiscTexture(64);
    // Higher pool for denser small puffs (rates ×2 → keep headroom)
    const cap = opts?.capacity ?? 3600;
    // Budget: dust bulk, splash medium, exhaust thin
    this.dust = new ParticlePool(Math.floor(cap * 0.62), this.sharedTex);
    this.splash = new ParticlePool(Math.floor(cap * 0.28), this.sharedTex);
    this.exhaust = new ParticlePool(Math.floor(cap * 0.1), this.sharedTex);
    this.dust.points.name = "fx-dust";
    this.splash.points.name = "fx-splash";
    this.exhaust.points.name = "fx-exhaust";
    this.group.add(this.dust.points);
    this.group.add(this.splash.points);
    this.group.add(this.exhaust.points);
    scene.add(this.group);

    if (opts?.streams) this.streams = opts.streams;
    if (opts?.ponds) this.ponds = opts.ponds;
    if (opts?.waterColor) {
      this.splashColor = waterSplashColor(opts.waterColor);
    }
    if (opts?.fallbackDustColor) {
      this.fallbackDust = dustColorFromTerrainAlbedo(opts.fallbackDustColor);
    }
    if (opts?.terrain) {
      this.setTerrain(opts.terrain);
    }
  }

  setStreams(streams: readonly StreamSegmentInput[]): void {
    this.streams = streams;
  }

  setPonds(ponds: readonly PondWetnessInput[]): void {
    this.ponds = ponds;
  }

  private wetnessAt(x: number, z: number, y?: number): number {
    return waterWetness(x, z, this.streams, this.ponds, y);
  }

  setTerrain(terrain: NonNullable<OffroadFxOptions["terrain"]>): void {
    this.heightmap = terrain.heightmap;
    this.resolution = terrain.resolution;
    this.worldSize = terrain.worldSize;
    this.terrainCtx = buildTerrainColorContext({
      groundPalette: terrain.groundPalette,
      heightmap: terrain.heightmap,
      pathPolyline: terrain.pathPolyline,
      pathWidth: terrain.pathWidth,
    });
  }

  /**
   * Sample dust RGB under world XZ (matches TerrainMesh vertex color, shaded
   * for unlit sprites).
   */
  sampleDustColor(x: number, z: number): Rgb {
    if (!this.terrainCtx || !this.heightmap) {
      return this.fallbackDust;
    }
    const h = sampleBilinear(
      this.heightmap,
      this.resolution,
      this.worldSize,
      x,
      z,
    );
    const albedo = terrainAlbedoAt(x, z, h, this.terrainCtx);
    return dustColorFromTerrainAlbedo(albedo);
  }

  /**
   * Simulate + emit for one render frame. Call after mesh/vehicle sync.
   */
  update(dt: number, sample: OffroadFxSample): void {
    const dtClamped = Math.min(0.05, Math.max(0, dt));
    if (dtClamped <= 0) return;

    this._q.set(
      sample.rotation.x,
      sample.rotation.y,
      sample.rotation.z,
      sample.rotation.w,
    );

    const yaw = sample.yaw;
    const vx = sample.linvel.x;
    const vy = sample.linvel.y;
    const vz = sample.linvel.z;
    const speed = Math.hypot(vx, vz);
    const lat = lateralSpeedMps(vx, vz, yaw);
    const latAbs = Math.abs(lat);
    const rangeBoost = sample.driveRange === "L" ? 1.35 : 1;

    // Full body axes (local +Z fwd, +X right, +Y up) — spray follows pitch/roll
    this._chassisFwd.set(0, 0, 1).applyQuaternion(this._q).normalize();
    this._chassisRight.set(1, 0, 0).applyQuaternion(this._q).normalize();
    this._chassisUp.set(0, 1, 0).applyQuaternion(this._q).normalize();

    const nWheels = Math.min(4, sample.wheels.length);
    const radius = VEHICLE_CONFIG.wheelRadius;

    for (let i = 0; i < nWheels; i++) {
      const w = sample.wheels[i];
      const contactPos = this.wheelContactWorld(
        i,
        w.suspensionLength,
        radius,
        sample,
      );
      const wet = this.wetnessAt(contactPos.x, contactPos.z, contactPos.y);
      const dustCol = this.sampleDustColor(contactPos.x, contactPos.z);

      // --- Landing burst ---
      const burst = landingBurstCount(this.prevContact[i], w.contact, vy);
      if (burst > 0) {
        const isWet = wet > 0.35;
        const pool = isWet ? this.splash : this.dust;
        const col = isWet ? this.splashColor : dustCol;
        pool.emitMany(burst, (k) => {
          const ang = (k / burst) * Math.PI * 2 + i;
          const outward = 1.2 + Math.random() * 2.5;
          return {
            x: contactPos.x + Math.cos(ang) * 0.12,
            y: contactPos.y + 0.04,
            z: contactPos.z + Math.sin(ang) * 0.12,
            vx: Math.cos(ang) * outward + vx * 0.15,
            vy: 1.5 + Math.random() * 2.8 + Math.min(4, -vy * 0.25),
            vz: Math.sin(ang) * outward + vz * 0.15,
            r: jitterColor(col.r, 0.04),
            g: jitterColor(col.g, 0.04),
            b: jitterColor(col.b, 0.04),
            size: isWet
              ? 0.24 + Math.random() * 0.24
              : 0.32 + Math.random() * 0.32,
            life: isWet
              ? 0.28 + Math.random() * 0.2
              : 0.4 + Math.random() * 0.35,
            drag: isWet ? 2.2 : 1.4,
            gravityScale: isWet ? 1.4 : 0.85,
          };
        });
      }

      // Tread speed (m/s): wheel ω×r if rotation known, else throttle proxy.
      const treadMps = this.treadSpeedMps(i, w.rotation, dtClamped, sample.throttle);

      // --- Continuous dust (dry) / splash (wet) ---
      if (w.contact) {
        // Prefer tread for "how hard tires are working"; chassis speed only
        // for light roll when freewheeling with little throttle.
        const workSpeed = Math.max(speed, Math.abs(treadMps));
        const dustR = dustEmitRate({
          grounded: true,
          throttle: sample.throttle,
          brake: sample.brake,
          speedMps: workSpeed,
          lateralAbsMps: latAbs,
          rangeBoost,
        });
        // Suppress dry dust when fully wet
        const dryFactor = 1 - clamp01(wet * 1.15);
        DUST_ACC[i] += dustR * dryFactor * dtClamped;

        const splashR = splashEmitRate({
          grounded: true,
          wetness: wet,
          speedMps: workSpeed,
          throttle: sample.throttle,
        });
        SPLASH_ACC[i] += splashR * dtClamped;

        const steer = w.steering ?? 0;
        while (DUST_ACC[i] >= 1) {
          DUST_ACC[i] -= 1;
          this.emitDustPuff(
            contactPos,
            treadMps,
            lat,
            steer,
            sample.throttle,
            dustCol,
          );
        }
        while (SPLASH_ACC[i] >= 1) {
          SPLASH_ACC[i] -= 1;
          this.emitSplashPuff(contactPos, treadMps, lat, steer);
        }
      } else {
        DUST_ACC[i] = 0;
        SPLASH_ACC[i] = 0;
      }

      this.prevContact[i] = w.contact;
    }

    // --- Body / cabin scrapes (any collider vs terrain) ---
    const bodyPts = sample.bodyContacts ?? [];
    const bodyN = bodyPts.length;
    const bodyBurst = bodyImpactBurstCount(
      this.prevBodyContactCount,
      bodyN,
      vy,
    );
    if (bodyBurst > 0 && bodyN > 0) {
      this.emitBodyBurst(bodyPts, bodyBurst, vx, vy, vz);
    }
    if (bodyN > 0) {
      const bodyR = bodyContactEmitRate({
        contactCount: bodyN,
        speedMps: speed,
        vy,
      });
      BODY_ACC.v += bodyR * dtClamped;
      while (BODY_ACC.v >= 1) {
        BODY_ACC.v -= 1;
        const p = bodyPts[(Math.random() * bodyN) | 0];
        const wet = this.wetnessAt(p.x, p.z, p.y);
        // Body scrapes: chassis rear + loft (no wheel steer)
        const bodyTread = sample.throttle * 12;
        if (wet > 0.45) {
          this.emitSplashPuff(p, bodyTread, lat, 0);
        } else {
          const col = this.sampleDustColor(p.x, p.z);
          this.emitBodyDustPuff(p, bodyTread, lat, col);
        }
      }
    } else {
      BODY_ACC.v = 0;
    }
    this.prevBodyContactCount = bodyN;

    // --- Body drainage: key-point immersion (depth vs surfaceY) + pose weight ---
    // Wheels keep independent tire splash; this is chassis-only.
    if (this.ponds.length > 0 || this.streams.length > 0) {
      // rollLean / pitchLean: which body side/nose is lower in world Y
      const rollLean = this._chassisRight.y;
      const pitchLean = this._chassisFwd.y;

      let wetCount = 0;
      let wetSum = 0;
      let depthSum = 0;
      let totalWeight = 0;
      let pickX = sample.position.x;
      let pickZ = sample.position.z;
      let pickSurfY =
        sample.position.y - VEHICLE_CONFIG.chassisHalfExtents.y * 0.2;
      let pickWeight = 0;

      for (let i = 0; i < BODY_WATER_LOCAL.length; i++) {
        const lp = BODY_WATER_LOCAL[i];
        this._local.set(lp.x, lp.y, lp.z).applyQuaternion(this._q);
        const wx = sample.position.x + this._local.x;
        const wy = sample.position.y + this._local.y;
        const wz = sample.position.z + this._local.z;

        // XZ: must be over water. Depth: how far sample is under free surface.
        const wetXZ = this.wetnessAt(wx, wz);
        if (wetXZ < 0.08) continue;

        const surf = pondSurfaceYAt(wx, wz, this.ponds);
        // No pond surface (stream-only legacy): treat slight belly dip as depth
        const surfaceY =
          surf ??
          wy + 0.08; // if only stream wetness, assume sample is just under
        const depth = immersionDepthM(surfaceY, wy, 0.015);
        // Shallow fording: body can sit slightly above free surface while
        // still displacing water — allow small negative margin via wetXZ-only
        // contribution when depth is tiny but XZ is fully in pond.
        const depthEff =
          depth > 0
            ? depth
            : wetXZ > 0.55
              ? 0.04 * wetXZ
              : 0;
        if (depthEff < 0.012) continue;

        const weight = bodyImmersionWeight({
          wetnessXZ: wetXZ,
          depthM: depthEff,
          localX: lp.x,
          localZ: lp.z,
          rollLean,
          pitchLean,
        });
        if (weight <= 0) continue;

        wetCount++;
        wetSum += wetXZ;
        depthSum += depthEff;
        totalWeight += weight;
        // Weighted reservoir: prefer deeper / low-side samples for spawn
        if (Math.random() * totalWeight < weight) {
          pickX = wx;
          pickZ = wz;
          pickSurfY = surfaceY;
          pickWeight = weight;
        }
      }

      if (wetCount > 0 && totalWeight > 0) {
        const rate = bodyWaterSprayEmitRate({
          meanDepthM: depthSum / wetCount,
          meanWetness: wetSum / wetCount,
          speedMps: speed,
          wetSampleCount: wetCount,
          totalWeight,
        });
        this.bodyWaterAcc.v += rate * dtClamped;
        while (this.bodyWaterAcc.v >= 1) {
          this.bodyWaterAcc.v -= 1;
          this.emitBodyWaterSpray(
            { x: pickX, y: pickSurfY, z: pickZ },
            vx,
            vz,
            speed,
            lat,
            sample.position,
            pickWeight,
          );
        }
      } else {
        this.bodyWaterAcc.v = 0;
      }
    }

    // --- Exhaust (rear bumper local) ---
    const exR = exhaustEmitRate({
      throttle: sample.throttle,
      speedMps: speed,
    });
    EXHAUST_ACC.v += exR * dtClamped;
    while (EXHAUST_ACC.v >= 1) {
      EXHAUST_ACC.v -= 1;
      this.emitExhaust(sample);
    }

    this.dust.update(dtClamped);
    this.splash.update(dtClamped);
    this.exhaust.update(dtClamped);
  }

  private wheelContactWorld(
    wheelIndex: number,
    suspLen: number,
    radius: number,
    sample: OffroadFxSample,
  ): { x: number; y: number; z: number } {
    const hard =
      VEHICLE_CONFIG.wheelPositions[wheelIndex] ??
      VEHICLE_CONFIG.wheelPositions[0];
    const side = hard.x >= 0 ? 1 : -1;
    // Near tire bottom (hardpoint → wheel center = suspLen, then −radius)
    this._local.set(
      hard.x + side * VISUAL_TRACK_OUTSET,
      hard.y - suspLen - radius * 0.92,
      hard.z,
    );
    this._local.applyQuaternion(this._q);
    this._world.set(
      sample.position.x + this._local.x,
      sample.position.y + this._local.y,
      sample.position.z + this._local.z,
    );
    return { x: this._world.x, y: this._world.y, z: this._world.z };
  }

  private emitBodyBurst(
    pts: readonly { x: number; y: number; z: number }[],
    count: number,
    vx: number,
    vy: number,
    vz: number,
  ): void {
    const n = pts.length;
    if (n === 0 || count <= 0) return;
    this.dust.emitMany(count, (k) => {
      const p = pts[k % n];
      const col = this.sampleDustColor(p.x, p.z);
      const ang = (k / count) * Math.PI * 2;
      const outward = 1.4 + Math.random() * 2.8;
      return {
        x: p.x + Math.cos(ang) * 0.1,
        y: p.y + 0.05,
        z: p.z + Math.sin(ang) * 0.1,
        vx: Math.cos(ang) * outward + vx * 0.2,
        vy: 1.8 + Math.random() * 3 + Math.min(5, Math.max(0, -vy) * 0.3),
        vz: Math.sin(ang) * outward + vz * 0.2,
        r: jitterColor(col.r, 0.04),
        g: jitterColor(col.g, 0.04),
        b: jitterColor(col.b, 0.04),
        size: 0.28 + Math.random() * 0.35,
        life: 0.4 + Math.random() * 0.4,
        drag: 1.3,
        gravityScale: 0.8,
      };
    });
  }

  /**
   * Wheel rolling axis in world: chassis basis rotated by steer about body up.
   * Chassis local: +Z forward, +X right (matches JeepMesh / physics).
   */
  private setWheelBasis(steerRad: number): void {
    const c = Math.cos(steerRad);
    const s = Math.sin(steerRad);
    // wheelFwd = R_up(steer) * chassisFwd
    this._wheelFwd
      .copy(this._chassisFwd)
      .multiplyScalar(c)
      .addScaledVector(this._chassisRight, s)
      .normalize();
    // wheelRight = R_up(steer) * chassisRight
    this._wheelRight
      .copy(this._chassisRight)
      .multiplyScalar(c)
      .addScaledVector(this._chassisFwd, -s)
      .normalize();
  }

  /**
   * Spray velocity: opposite wheel roll (body+steer), lofted by elevation
   * toward chassis up (not world-horizontal rear).
   */
  private sprayVelocity(
    treadMps: number,
    steerRad: number,
    elevRad: number,
    speedScale: number,
    sideKick: number,
    throttleHint: number,
  ): { vx: number; vy: number; vz: number } {
    this.setWheelBasis(steerRad);
    // Forward tread → spray opposite wheel forward
    const along = -Math.sign(treadMps || throttleHint || 1);
    const elev = elevRad + (Math.random() - 0.5) * 0.08;
    const ce = Math.cos(elev);
    const se = Math.sin(elev);
    // dir = along*wheelFwd * cos(elev) + chassisUp * sin(elev) + side*wheelRight
    this._sprayDir
      .copy(this._wheelFwd)
      .multiplyScalar(along * ce)
      .addScaledVector(this._chassisUp, se)
      .addScaledVector(this._wheelRight, sideKick * 0.15)
      .normalize();
    const mag =
      (speedScale + Math.abs(treadMps) * 0.12) * 3 * (0.85 + Math.random() * 0.3);
    const j = () => (Math.random() - 0.5) * 0.35;
    return {
      vx: this._sprayDir.x * mag + j(),
      vy: this._sprayDir.y * mag + j(),
      vz: this._sprayDir.z * mag + j(),
    };
  }

  /** Scrape puff at a chassis contact (slightly more outward than tire dust). */
  private emitBodyDustPuff(
    pos: { x: number; y: number; z: number },
    treadMps: number,
    lat: number,
    col: Rgb,
  ): void {
    const sideKick = -Math.sign(lat || 0) * (0.5 + Math.abs(lat) * 0.4);
    const vel = this.sprayVelocity(
      treadMps,
      0,
      BODY_ELEV_RAD,
      0.8,
      sideKick,
      0,
    );
    const jitter = () => (Math.random() - 0.5) * 1.1;
    this.dust.emit({
      x: pos.x + jitter() * 0.2,
      y: pos.y + 0.03 + Math.random() * 0.08,
      z: pos.z + jitter() * 0.2,
      vx: vel.vx,
      vy: vel.vy,
      vz: vel.vz,
      r: jitterColor(col.r, 0.035),
      g: jitterColor(col.g, 0.035),
      b: jitterColor(col.b, 0.035),
      size: 0.22 + Math.random() * 0.3,
      life: 0.35 + Math.random() * 0.4,
      drag: 1.15 + Math.random() * 0.4,
      gravityScale: 0.6 + Math.random() * 0.35,
    });
  }

  /**
   * Signed tread speed (m/s) for spray kick.
   * Prefer d(rotation)/dt × radius; if unknown, map throttle → synthetic tread.
   */
  private treadSpeedMps(
    wheelIndex: number,
    rotation: number | undefined,
    dt: number,
    throttle: number,
  ): number {
    // Throttle proxy: full throttle ≈ 12 m/s equivalent tread (burnout on ice)
    const throttleProxy = throttle * 12;

    if (rotation == null || !Number.isFinite(rotation) || dt <= 1e-6) {
      return throttleProxy;
    }
    const prev = this.prevWheelRot[wheelIndex];
    this.prevWheelRot[wheelIndex] = rotation;
    if (!Number.isFinite(prev)) {
      return throttleProxy;
    }
    const dRot = rotation - prev;
    // Unwrap large jumps (teleport / respawn)
    if (Math.abs(dRot) > Math.PI * 4) {
      return throttleProxy;
    }
    const omega = dRot / dt; // rad/s
    const spinMps = omega * VEHICLE_CONFIG.wheelRadius;
    // If wheel barely spinning but driver is on the gas, still show kick (slip)
    if (Math.abs(spinMps) < 0.35 && Math.abs(throttle) > 0.15) {
      return throttleProxy;
    }
    return spinMps;
  }

  private emitDustPuff(
    pos: { x: number; y: number; z: number },
    /** Signed tread / throttle proxy (m/s), NOT chassis long speed. */
    treadMps: number,
    lat: number,
    steerRad: number,
    throttle: number,
    col: Rgb,
  ): void {
    const sideKick = -Math.sign(lat || 0) * (0.4 + Math.abs(lat) * 0.35);
    const th = Math.abs(throttle);
    const vel = this.sprayVelocity(
      treadMps,
      steerRad,
      DUST_ELEV_RAD,
      1.2 + th * 0.15,
      sideKick,
      throttle,
    );
    const jitter = () => (Math.random() - 0.5) * 0.9;
    this.dust.emit({
      x: pos.x + jitter() * 0.15,
      y: pos.y + 0.02 + Math.random() * 0.06,
      z: pos.z + jitter() * 0.15,
      vx: vel.vx,
      vy: vel.vy,
      vz: vel.vz,
      r: jitterColor(col.r, 0.035),
      g: jitterColor(col.g, 0.035),
      b: jitterColor(col.b, 0.035),
      size: 0.24 + Math.random() * 0.32 + th * 0.12,
      life: 0.35 + Math.random() * 0.4,
      drag: 1.1 + Math.random() * 0.5,
      gravityScale: 0.55 + Math.random() * 0.35,
    });
  }

  private emitSplashPuff(
    pos: { x: number; y: number; z: number },
    treadMps: number,
    lat: number,
    steerRad: number,
  ): void {
    const sideKick =
      (Math.random() - 0.5) * 2.2 - Math.sign(lat || 0) * 0.5;
    const vel = this.sprayVelocity(
      treadMps,
      steerRad,
      SPLASH_ELEV_RAD,
      1.8,
      sideKick,
      0,
    );
    const col = this.splashColor;
    this.splash.emit({
      x: pos.x + (Math.random() - 0.5) * 0.2,
      y: pos.y + 0.05,
      z: pos.z + (Math.random() - 0.5) * 0.2,
      vx: vel.vx,
      vy: vel.vy,
      vz: vel.vz,
      r: jitterColor(col.r, 0.12),
      g: jitterColor(col.g, 0.1),
      b: jitterColor(col.b, 0.08),
      size: 0.2 + Math.random() * 0.24,
      life: 0.22 + Math.random() * 0.22,
      drag: 2.0,
      gravityScale: 1.5,
    });
  }

  /**
   * Body drainage / bow wake. Side peel is always vehicle left/right (chassis),
   * so reverse does not flip L/R. Along-travel still follows velocity.
   */
  private emitBodyWaterSpray(
    pos: { x: number; y: number; z: number },
    vx: number,
    vz: number,
    speedMps: number,
    lat: number,
    chassisOrigin: { x: number; y: number; z: number },
    immersionWeight = 1,
  ): void {
    const col = this.splashColor;
    // Travel dir in XZ (forward or reverse); fallback nose
    let tx = vx;
    let tz = vz;
    const horiz = Math.hypot(tx, tz);
    if (horiz > 0.35) {
      tx /= horiz;
      tz /= horiz;
    } else {
      tx = this._chassisFwd.x;
      tz = this._chassisFwd.z;
      const fl = Math.hypot(tx, tz) || 1;
      tx /= fl;
      tz /= fl;
    }

    // Vehicle body axes — fixed L/R even when reversing
    let sxAxis = this._chassisRight.x;
    let szAxis = this._chassisRight.z;
    const srl = Math.hypot(sxAxis, szAxis) || 1;
    sxAxis /= srl;
    szAxis /= srl;

    const sideSign = Math.random() < 0.5 ? -1 : 1;
    const sideAmt =
      (0.85 + Math.random() * 1.1) * sideSign -
      Math.sign(lat || 0) * 0.25;

    const along = 0.75 + Math.random() * 0.55;
    const loft = 0.55 + Math.random() * 0.75;
    const depthBoost = clamp01(immersionWeight / 1.8);
    const mag =
      (2.4 + Math.min(7, Math.abs(speedMps) * 0.85) + depthBoost * 1.6) *
      (0.85 + Math.random() * 0.4);

    const dirX = tx * along + sxAxis * sideAmt;
    const dirZ = tz * along + szAxis * sideAmt;
    const dirY = loft;
    const len = Math.hypot(dirX, dirY, dirZ) || 1;

    const halfX = VEHICLE_CONFIG.chassisHalfExtents.x;
    const outSide = (halfX + 0.25 + Math.random() * 0.35) * sideSign;
    const outAlong = 0.1 + Math.random() * 0.5;
    const sx =
      chassisOrigin.x +
      sxAxis * outSide +
      tx * outAlong +
      (Math.random() - 0.5) * 0.2;
    const sz =
      chassisOrigin.z +
      szAxis * outSide +
      tz * outAlong +
      (Math.random() - 0.5) * 0.2;
    const sy = pos.y + 0.12 + Math.random() * 0.18;

    this.splash.emit({
      x: sx,
      y: sy,
      z: sz,
      vx: (dirX / len) * mag + (Math.random() - 0.5) * 0.5,
      vy: (dirY / len) * mag * 0.95 + 0.6 + Math.random() * 1.1,
      vz: (dirZ / len) * mag + (Math.random() - 0.5) * 0.5,
      r: jitterColor(col.r, 0.1),
      g: jitterColor(col.g, 0.09),
      b: jitterColor(col.b, 0.07),
      size: 0.22 + Math.random() * 0.28 + depthBoost * 0.08,
      life: 0.35 + Math.random() * 0.35,
      drag: 1.35 + Math.random() * 0.4,
      gravityScale: 1.05 + Math.random() * 0.25,
    });
  }

  private emitExhaust(sample: OffroadFxSample): void {
    // Rear center of chassis (local)
    this._local.set(
      (Math.random() - 0.5) * 0.25,
      0.15 + Math.random() * 0.1,
      -1.45,
    );
    this._local.applyQuaternion(this._q);
    const x = sample.position.x + this._local.x;
    const y = sample.position.y + this._local.y;
    const z = sample.position.z + this._local.z;
    const gray = 0.22 + Math.random() * 0.12;
    // Exhaust: chassis rear + slight body-up (follows pitch/roll)
    const speed = 0.8 + Math.random();
    this.exhaust.emit({
      x,
      y,
      z,
      vx:
        -this._chassisFwd.x * speed +
        this._chassisUp.x * 0.35 +
        sample.linvel.x * 0.3,
      vy:
        -this._chassisFwd.y * speed +
        this._chassisUp.y * 0.35 +
        0.15,
      vz:
        -this._chassisFwd.z * speed +
        this._chassisUp.z * 0.35 +
        sample.linvel.z * 0.3,
      r: gray,
      g: gray * 0.98,
      b: gray * 0.95,
      size: 0.2 + Math.random() * 0.24,
      life: 0.28 + Math.random() * 0.28,
      drag: 0.9,
      gravityScale: -0.15, // slight rise
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    this.dust.dispose();
    this.splash.dispose();
    this.exhaust.dispose();
    this.sharedTex.dispose();
  }
}

function jitterColor(c: number, amt: number): number {
  return Math.min(1, Math.max(0, c + (Math.random() - 0.5) * 2 * amt));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Sandbox default ground albedo before dust shade. */
export const SANDBOX_DUST_COLOR: Rgb = parseHexRgb("#9a8f78");
