import * as THREE from "three";
import type { Vec3 } from "@/shared/types";
import { clamp, deltaAngle, lerp, wrapAngle } from "@/shared/math";
import {
  bodySlamImpact01,
  wheelLandingImpact01,
} from "@/shared/offroadFxMath";

export type CameraMode = "third" | "first";

export type CameraPose = {
  position: Vec3;
  yaw: number;
  rotation?: { x: number; y: number; z: number; w: number };
};

export type CameraUpdateOpts = {
  snap?: boolean;
  /** Ground-plane speed (m/s); scales third-person yaw lag (slower = more lag). */
  speedMps?: number;
  /**
   * Chassis linear velocity (m/s). FP uses Δv/dt for head inertia (B)
   * and vy for impact shake (C).
   */
  linvel?: { x: number; y: number; z: number };
  /** Per-wheel ground contact this frame; FP impact uses air→ground edges. */
  wheelContacts?: boolean[];
  /** Chassis/cabin terrain contact count; FP impact uses 0→N body slam. */
  bodyContactCount?: number;
};

/** Match original spring-arm: back 8m, up 3.5m. */
const TP_DIST_DEFAULT = Math.hypot(8, 3.5);
const TP_DEFAULT_PITCH = Math.atan2(3.5, 8);
/** Must match `setMode` FOV values (deg). */
const TP_FOV_DEG = 55;
const FP_FOV_DEG = 72;
/** Base look sens calibrated for third-person FOV (rad per pixel). */
const LOOK_SENS = 0.005;
/**
 * FP uses wider FOV → same angular step sweeps less of the frame.
 * Scale by tan(halfFov) so on-screen pan speed matches third-person,
 * then /2 — FOV-only match still felt too fast in cabin view.
 */
const FP_LOOK_SENS =
  (LOOK_SENS *
    (Math.tan(((FP_FOV_DEG / 2) * Math.PI) / 180) /
      Math.tan(((TP_FOV_DEG / 2) * Math.PI) / 180))) /
  2;
const TP_PITCH_MIN = 0.08;
const TP_PITCH_MAX = 1.35;
const FP_PITCH_MIN = -1.2;
const FP_PITCH_MAX = 1.2;
/** First-person free-look follow rate (higher = snappier). */
const FP_LOOK_SMOOTH = 14;
/** Third-person orbit look follow rate (mouse yaw/pitch ease). */
const TP_LOOK_SMOOTH = 14;

/**
 * Third-person vertical / look-pitch ease rate (higher = snappier).
 * Horizontal XZ is always hard-tracked so jeep mesh and camera stay in phase.
 */
const TP_FOLLOW_SMOOTH = 10;

/**
 * Chase-cam vehicle-yaw lag: spring-arm heading eases toward pose.yaw so
 * turns briefly show the vehicle side. Position XZ still hard-tracks the arm
 * built from the lagged yaw (no position time-delay → no mesh/cam jump).
 */
/** Half the original rates → ~2× more visible turn lag. */
const TP_YAW_LAG_RATE_LOW = 1.75;
const TP_YAW_LAG_RATE_HIGH = 6;
/** Speed (m/s) at which lag rate reaches HIGH (~36 km/h). */
const YAW_LAG_SPEED_REF = 10;
/** Max shortest-arc lag (rad, ~69°) so spinouts don't drag forever. */
const TP_YAW_LAG_MAX = 1.2;

/**
 * First-person head inertia (layer B) — underdamped oscillator on **lateral X
 * and longitudinal Z only** (no vertical Y soft-follow — seat eye Y is hard):
 *
 *   x'' + 2 ζ ω x' + ω² x = −ω² S a_local
 *   ⇔  x'' = −ω² (x + S a) − 2 ζ ω v
 *   x_eq = −S a   (sustained accel holds lean; a→0 returns to seat)
 *
 * Input a is estimated from Δlinvel (filtered). Turn-perpendicular component
 * is scaled down so slide direction-changes do not thrash the head.
 * Vertical bumps still contribute via impact layer C (landing kick / pitch).
 */
/** Natural frequency ω (rad/s) per soft axis [lat X, lon Z]. */
const HEAD_OMEGA = { x: 10, z: 11 } as const;
/** Damping ratio ζ < 1 → overshoot + ring (lower = more bounce). */
const HEAD_ZETA = { x: 0.35, z: 0.35 } as const;
/** Steady lean S (m per m/s²): x_eq = −S·a. */
const HEAD_S = { x: 0.0045, z: 0.004 } as const;
/** Cap |ẋ| (m/s local). */
const HEAD_VEL_MAX = 0.55;
/** Travel limits (m) — X/Z only; head Y soft offset is always 0. */
const HEAD_MAX_FORE = 0.028;
const HEAD_MAX_AFT = 0.028;
const HEAD_MAX_LAT = 0.028;
/** Low-pass linvel before Δv/dt. */
const HEAD_VEL_SMOOTH = 12;
/** Low-pass estimated a_local (1/s). */
const HEAD_ACCEL_SMOOTH = 10;
const HEAD_ACCEL_MAX = 16;
const HEAD_ACCEL_DEADZONE = 2.8;
/** Perp-to-velocity accel scale / cap (slide dir-change) for position. */
const HEAD_TURN_ACCEL_SCALE = 0.15;
const HEAD_TURN_PERP_CAP = 5;
const HEAD_TURN_SPLIT_SPEED = 1.2;
/**
 * Roll uses more of the turn-perpendicular a so direction changes read as lean
 * (position stays calmer via HEAD_TURN_ACCEL_SCALE).
 */
const HEAD_TURN_ACCEL_SCALE_ROLL = 0.55;
const HEAD_TURN_PERP_CAP_ROLL = 10;

/**
 * Head roll (rad) from lateral accel only — same oscillator as position:
 * φ'' = −ω²(φ + S a_lat) − 2ζω φ̇, underdamped overshoot around φ_eq = −S a_lat.
 * Not driven by vertical a (bumps stay pitch/offset, not extra roll thrash).
 */
const HEAD_ROLL_OMEGA = 9;
const HEAD_ROLL_ZETA = 0.34;
/** rad per m/s²; a_lat≈5 → ~3.5° at equilibrium before clamp. */
const HEAD_ROLL_S = 0.012;
const HEAD_ROLL_MAX = 0.09; // ~5.2°
const HEAD_ROLL_VEL_MAX = 1.8;
const HEAD_ROLL_DEADZONE = 1.8;
const HEAD_ROLL_ACCEL_SMOOTH = 9;

/**
 * First-person impact shake (layer C): event impulse on wheel landing / body slam.
 * Vertical plane is hard-locked to chassis: no local-Y position kick, no pitch nod
 * (those crawl the hood in FP). Only longitudinal Z + roll remain.
 */
const IMPACT_DECAY = 12;
const IMPACT_KICK_Z = 0.0125;
const IMPACT_KICK_ROLL = 0.02;
const IMPACT_BODY_SCALE = 1.25;
const IMPACT_MAX_Z = 0.02;
const IMPACT_MAX_ROLL = 0.04;
/** Min time between impact kicks (s) — stops contact-flicker spam when stuck. */
const IMPACT_COOLDOWN_S = 0.18;
/** Ignore soft body scrapes for camera (|vy| below this = no body slam kick). */
const IMPACT_BODY_MIN_DOWN_MPS = 1.0;

export class CameraRig {
  mode: CameraMode = "third";
  private readonly desired = new THREE.Vector3();
  private readonly lookDesired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly current = new THREE.Vector3();
  private lookInitialized = false;
  /** Cabin eye rest pose in chassis local space (+Z = vehicle forward). */
  private readonly eyeLocal = new THREE.Vector3(0, 1.15, 0.25);
  private readonly tmp = new THREE.Vector3();
  private readonly desiredEye = new THREE.Vector3();
  private readonly fpEyeWorld = new THREE.Vector3();
  /** Head offset x in chassis local (m); spring anchors at 0. */
  private readonly headOffsetLocal = new THREE.Vector3();
  /** Head offset velocity ẋ in chassis local (m/s). */
  private readonly headVelLocal = new THREE.Vector3();
  /** Inertial head roll (rad) and rate; driven by a_lat only. */
  private headRoll = 0;
  private headRollVel = 0;
  private smoothAccelLatRoll = 0;
  private readonly impactOffsetLocal = new THREE.Vector3();
  /** Smoothed linvel used for Δv/dt (world). */
  private readonly smoothLinvel = new THREE.Vector3();
  private readonly prevSmoothLinvel = new THREE.Vector3();
  /** Filtered chassis-local accel driving position oscillators. */
  private readonly smoothAccelLocal = new THREE.Vector3();
  /** Scratch for world accel used by roll path (more turn-perp). */
  private readonly tmpRollA = new THREE.Vector3();
  private readonly chassisQuat = new THREE.Quaternion();
  private readonly chassisQuatInv = new THREE.Quaternion();
  private readonly lookExtra = new THREE.Quaternion();
  private readonly lookEuler = new THREE.Euler(0, 0, 0, "YXZ");
  /**
   * Three.js cameras look down local -Z; our chassis forward is +Z.
   * Multiply by 180° yaw so FP faces the hood, not the tailgate.
   */
  private readonly camFacingFix = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI,
  );
  /** FP head state seeded (false after mode switch / reset / snap). */
  private fpEyeInitialized = false;
  private linvelSeeded = false;
  /** Transient impact pitch (rad, + = look up; landings kick negative). */
  private impactPitch = 0;
  /** Transient impact roll (rad). */
  private impactRoll = 0;
  /** Seconds remaining before another impact kick may fire. */
  private impactCooldown = 0;
  private prevWheelContacts: boolean[] = [];
  private prevBodyContactCount = 0;
  private impactContactsSeeded = false;

  /** Third-person orbit relative to vehicle yaw (rad, smoothed). */
  private orbitYaw = 0;
  /** Third-person elevation angle from horizontal (rad, smoothed). */
  private orbitPitch = TP_DEFAULT_PITCH;
  /** Mouse targets; `update` eases `orbitYaw`/`orbitPitch` toward these. */
  private orbitYawTarget = 0;
  private orbitPitchTarget = TP_DEFAULT_PITCH;
  /** Spring-arm length (m). */
  private orbitDist = TP_DIST_DEFAULT;
  /**
   * Lagged vehicle yaw for third-person spring-arm heading (rad).
   * Mouse orbit is layered on top: armYaw = followYaw + orbitYaw.
   */
  private followYaw = 0;
  private followYawInitialized = false;
  /** First-person free look (smoothed) relative to chassis (rad). */
  private fpYaw = 0;
  private fpPitch = 0;
  /** Mouse target angles; `update` eases `fpYaw`/`fpPitch` toward these. */
  private fpYawTarget = 0;
  private fpPitchTarget = 0;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.setMode("third");
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.camera.fov = mode === "third" ? TP_FOV_DEG : FP_FOV_DEG;
    this.camera.updateProjectionMatrix();
    // Snap follow camera when entering third person
    if (mode === "third") {
      this.current.copy(this.camera.position);
      // Next update will hard-snap look + followYaw to vehicle (avoid stale lag from FP)
      this.lookInitialized = false;
      this.followYawInitialized = false;
      // No lag from previous session's orbit targets
      this.orbitYaw = this.orbitYawTarget;
      this.orbitPitch = this.orbitPitchTarget;
    } else {
      // Entering FP: no lag from previous third-person session; reseed head.
      this.fpYaw = this.fpYawTarget;
      this.fpPitch = this.fpPitchTarget;
      this.resetHeadState();
    }
  }

  toggle(): void {
    this.setMode(this.mode === "third" ? "first" : "third");
  }

  /**
   * Apply mouse-drag deltas (pixels). Right/down are positive.
   * Works in both third-person orbit and first-person freelook.
   */
  applyLookDelta(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    if (this.mode === "third") {
      // Drive targets only; smoothed angles catch up in update().
      // Drag right → orbit so the view pans right around the jeep.
      this.orbitYawTarget -= dx * LOOK_SENS;
      // Drag up (negative dy) → lower pitch → more level / hood view.
      this.orbitPitchTarget = clamp(
        this.orbitPitchTarget + dy * LOOK_SENS,
        TP_PITCH_MIN,
        TP_PITCH_MAX,
      );
      return;
    }
    // Drive targets only; smoothed angles catch up in update().
    // FOV-scaled so drag feels like third-person on-screen.
    this.fpYawTarget -= dx * FP_LOOK_SENS;
    // Drag up (dy < 0) → look up (standard mouse-look).
    this.fpPitchTarget = clamp(
      this.fpPitchTarget - dy * FP_LOOK_SENS,
      FP_PITCH_MIN,
      FP_PITCH_MAX,
    );
  }

  /** Reset free look (e.g. after respawn if desired). */
  resetLook(): void {
    this.orbitYaw = 0;
    this.orbitPitch = TP_DEFAULT_PITCH;
    this.orbitYawTarget = 0;
    this.orbitPitchTarget = TP_DEFAULT_PITCH;
    this.fpYaw = 0;
    this.fpPitch = 0;
    this.fpYawTarget = 0;
    this.fpPitchTarget = 0;
    // Next third-person update snaps followYaw to pose (no residual turn lag).
    this.followYawInitialized = false;
    this.resetHeadState();
  }

  /** Clear FP head inertia + impact (next FP update hard-snaps). */
  private resetHeadState(): void {
    this.fpEyeInitialized = false;
    this.linvelSeeded = false;
    this.headOffsetLocal.set(0, 0, 0);
    this.headVelLocal.set(0, 0, 0);
    this.headRoll = 0;
    this.headRollVel = 0;
    this.smoothAccelLatRoll = 0;
    this.smoothLinvel.set(0, 0, 0);
    this.prevSmoothLinvel.set(0, 0, 0);
    this.smoothAccelLocal.set(0, 0, 0);
    this.impactOffsetLocal.set(0, 0, 0);
    this.impactPitch = 0;
    this.impactRoll = 0;
    this.impactCooldown = 0;
    this.prevWheelContacts = [];
    this.prevBodyContactCount = 0;
    this.impactContactsSeeded = false;
  }

  /** World-space FP eye with head inertia, before impact kick (tests / debug). */
  getFpEyeWorld(): { x: number; y: number; z: number } {
    return {
      x: this.fpEyeWorld.x,
      y: this.fpEyeWorld.y,
      z: this.fpEyeWorld.z,
    };
  }

  /** Chassis-local head offset from accel inertia (m; tests / debug). */
  getHeadOffsetLocal(): { x: number; y: number; z: number } {
    return {
      x: this.headOffsetLocal.x,
      y: this.headOffsetLocal.y,
      z: this.headOffsetLocal.z,
    };
  }

  /** Residual impact pitch rad (tests / debug). */
  getImpactPitch(): number {
    return this.impactPitch;
  }

  /** Inertial head roll rad (tests / debug); excludes impact roll kick. */
  getHeadRoll(): number {
    return this.headRoll;
  }

  /** Lagged spring-arm vehicle yaw (for tests / debug). */
  getFollowYaw(): number {
    return this.followYaw;
  }

  /**
   * Absolute third-person orbit. Useful for visual QA screenshots.
   * orbitYaw/pitch in radians (relative to vehicle yaw); optional arm length m.
   * Snaps both current and target (no ease lag).
   */
  setOrbit(orbitYaw: number, orbitPitch?: number, dist?: number): void {
    this.orbitYaw = orbitYaw;
    this.orbitYawTarget = orbitYaw;
    if (orbitPitch != null) {
      const p = clamp(orbitPitch, TP_PITCH_MIN, TP_PITCH_MAX);
      this.orbitPitch = p;
      this.orbitPitchTarget = p;
    }
    if (dist != null && dist > 0.5) {
      this.orbitDist = dist;
    }
  }

  getOrbit(): { yaw: number; pitch: number; dist: number } {
    return { yaw: this.orbitYaw, pitch: this.orbitPitch, dist: this.orbitDist };
  }

  /**
   * Apply biome third-person spring-arm defaults (e.g. higher alpine overview).
   * Omit fields to keep global defaults. Resets mouse orbit yaw to 0.
   */
  setThirdPersonDefaults(opts?: {
    pitch?: number;
    dist?: number;
  }): void {
    const pitch = clamp(
      opts?.pitch ?? TP_DEFAULT_PITCH,
      TP_PITCH_MIN,
      TP_PITCH_MAX,
    );
    const dist = Math.max(3, opts?.dist ?? TP_DIST_DEFAULT);
    this.orbitPitch = pitch;
    this.orbitPitchTarget = pitch;
    this.orbitDist = dist;
    this.orbitYaw = 0;
    this.orbitYawTarget = 0;
  }

  update(dt: number, pose: CameraPose, opts?: CameraUpdateOpts): void {
    if (this.mode === "third") {
      const snap = opts?.snap || dt <= 0 || !this.lookInitialized;

      // Ease orbit look toward mouse targets (exponential, frame-rate independent)
      if (snap) {
        this.orbitYaw = this.orbitYawTarget;
        this.orbitPitch = this.orbitPitchTarget;
      } else {
        const lookK = 1 - Math.exp(-TP_LOOK_SMOOTH * dt);
        this.orbitYaw += (this.orbitYawTarget - this.orbitYaw) * lookK;
        this.orbitPitch += (this.orbitPitchTarget - this.orbitPitch) * lookK;
      }

      // Vehicle-yaw lag: show a bit of the side on turns (more at low speed).
      if (snap || !this.followYawInitialized) {
        this.followYaw = pose.yaw;
        this.followYawInitialized = true;
      } else {
        const speed = Math.abs(opts?.speedMps ?? 0);
        const rate = lerp(
          TP_YAW_LAG_RATE_LOW,
          TP_YAW_LAG_RATE_HIGH,
          clamp(speed / YAW_LAG_SPEED_REF, 0, 1),
        );
        const err = deltaAngle(this.followYaw, pose.yaw);
        const yawK = 1 - Math.exp(-rate * dt);
        this.followYaw = wrapAngle(this.followYaw + err * yawK);
        // Cap residual lag so 360° spinouts do not drag the arm forever.
        const lag = deltaAngle(this.followYaw, pose.yaw);
        if (Math.abs(lag) > TP_YAW_LAG_MAX) {
          this.followYaw = wrapAngle(
            pose.yaw - Math.sign(lag) * TP_YAW_LAG_MAX,
          );
        }
      }

      const yaw = this.followYaw + this.orbitYaw;
      const pitch = this.orbitPitch;
      const dist = this.orbitDist;
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const horiz = dist * cosP;
      this.desired.set(
        pose.position.x - Math.sin(yaw) * horiz,
        pose.position.y + dist * sinP,
        pose.position.z - Math.cos(yaw) * horiz,
      );
      // Look aim at chassis (Y offset for hood framing).
      this.lookDesired.set(
        pose.position.x,
        pose.position.y + 1.2,
        pose.position.z,
      );
      if (snap) {
        this.current.copy(this.desired);
        this.look.copy(this.lookDesired);
        this.lookInitialized = true;
      } else {
        // XZ hard-follow: same phase as jeep mesh (no chase lag / jump).
        // Arm heading may lag vehicle yaw, but position is still hard-tracked
        // to the current-frame desired arm — no position time-delay.
        this.current.x = this.desired.x;
        this.current.z = this.desired.z;
        this.look.x = this.lookDesired.x;
        this.look.z = this.lookDesired.z;
        // Only ease height + look pitch (Y) to absorb suspension hop.
        const k = 1 - Math.exp(-TP_FOLLOW_SMOOTH * dt);
        this.current.y += (this.desired.y - this.current.y) * k;
        this.look.y += (this.lookDesired.y - this.look.y) * k;
      }
      this.camera.position.copy(this.current);
      // Third person: world-up lookAt (stable chase)
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.look);
      return;
    }

    // First person: chassis orientation hard-mount (pitch/roll/yaw with the jeep)
    // + accel-driven head inertia (B) + impact impulse (C).
    // Do NOT use lookAt(worldUp) — that strips roll and flattens body lean.
    if (pose.rotation) {
      this.chassisQuat.set(
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.rotation.w,
      );
    } else {
      this.chassisQuat.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        pose.yaw,
      );
    }
    this.chassisQuatInv.copy(this.chassisQuat).invert();

    // Hard-mount rest eye in world space
    this.tmp.copy(this.eyeLocal).applyQuaternion(this.chassisQuat);
    this.desiredEye.set(
      pose.position.x + this.tmp.x,
      pose.position.y + this.tmp.y,
      pose.position.z + this.tmp.z,
    );

    const snap = opts?.snap || dt <= 0 || !this.fpEyeInitialized;
    if (snap) {
      this.fpEyeInitialized = true;
      this.headOffsetLocal.set(0, 0, 0);
      this.headVelLocal.set(0, 0, 0);
      this.headRoll = 0;
      this.headRollVel = 0;
      this.smoothAccelLatRoll = 0;
      this.impactOffsetLocal.set(0, 0, 0);
      this.impactPitch = 0;
      this.impactRoll = 0;
      this.seedLinvel(opts);
      // Seed contact history without firing (spawn / settle / mode switch).
      this.seedImpactContacts(opts);
    } else {
      // B: a_local → underdamped pos (X/Z) + lateral roll; Y hard 0
      this.updateHeadFromAccel(dt, opts);
      // C: landings / body slam (Z + roll only; vertical plane locked)
      if (this.impactCooldown > 0) {
        this.impactCooldown = Math.max(0, this.impactCooldown - dt);
      }
      this.applyImpactImpulses(opts);
      const decay = Math.exp(-IMPACT_DECAY * dt);
      this.impactOffsetLocal.multiplyScalar(decay);
      this.impactOffsetLocal.y = 0; // vertical plane hard-lock
      this.impactPitch = 0;
      this.impactRoll *= decay;
      this.rememberImpactContacts(opts);
    }

    // Eye = hard-mount seat + head XZ (+ impact XZ). Local Y always seat.
    this.headOffsetLocal.y = 0;
    this.impactOffsetLocal.y = 0;
    this.tmp.copy(this.headOffsetLocal).applyQuaternion(this.chassisQuat);
    this.fpEyeWorld.copy(this.desiredEye).add(this.tmp);
    this.tmp.copy(this.impactOffsetLocal).applyQuaternion(this.chassisQuat);
    this.camera.position.copy(this.fpEyeWorld).add(this.tmp);

    // Ease free-look toward mouse targets (exponential, frame-rate independent)
    if (snap) {
      this.fpYaw = this.fpYawTarget;
      this.fpPitch = this.fpPitchTarget;
    } else {
      const k = 1 - Math.exp(-FP_LOOK_SMOOTH * dt);
      this.fpYaw += (this.fpYawTarget - this.fpYaw) * k;
      this.fpPitch += (this.fpPitchTarget - this.fpPitch) * k;
    }

    // Chassis + facing fix + free look + inertial/impact roll (no impact pitch)
    this.lookEuler.set(
      this.fpPitch,
      this.fpYaw,
      this.headRoll + this.impactRoll,
      "YXZ",
    );
    this.lookExtra.setFromEuler(this.lookEuler);
    this.camera.quaternion
      .copy(this.chassisQuat)
      .multiply(this.camFacingFix)
      .multiply(this.lookExtra);
    this.tmp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.camera.up.copy(this.tmp);
  }

  private seedLinvel(opts?: CameraUpdateOpts): void {
    const v = opts?.linvel;
    if (v) {
      this.smoothLinvel.set(v.x, v.y, v.z);
      this.prevSmoothLinvel.set(v.x, v.y, v.z);
    } else {
      this.smoothLinvel.set(0, 0, 0);
      this.prevSmoothLinvel.set(0, 0, 0);
    }
    this.smoothAccelLocal.set(0, 0, 0);
    this.smoothAccelLatRoll = 0;
    this.linvelSeeded = true;
  }

  private static deadzoneAxis(v: number, dead: number): number {
    return Math.abs(v) < dead ? 0 : v;
  }

  /** World accel: along-track full, perp scaled/capped. Writes into `out`. */
  private static applyTurnSplit(
    ax: number,
    ay: number,
    az: number,
    vx: number,
    vy: number,
    vz: number,
    perpScale: number,
    perpCap: number,
    out: THREE.Vector3,
  ): void {
    const sp = Math.hypot(vx, vy, vz);
    if (sp <= HEAD_TURN_SPLIT_SPEED) {
      out.set(ax, ay, az);
      return;
    }
    const invSp = 1 / sp;
    const dx = vx * invSp;
    const dy = vy * invSp;
    const dz = vz * invSp;
    const aPar = ax * dx + ay * dy + az * dz;
    let px = ax - aPar * dx;
    let py = ay - aPar * dy;
    let pz = az - aPar * dz;
    const pMag = Math.hypot(px, py, pz);
    if (pMag > perpCap) {
      const s = perpCap / pMag;
      px *= s;
      py *= s;
      pz *= s;
    }
    out.set(
      aPar * dx + px * perpScale,
      aPar * dy + py * perpScale,
      aPar * dz + pz * perpScale,
    );
  }

  /**
   * Estimate a_local from Δlinvel, then integrate position oscillators and
   * lateral head roll (underdamped, φ_eq = −S a_lat).
   */
  private updateHeadFromAccel(dt: number, opts?: CameraUpdateOpts): void {
    const v = opts?.linvel;
    if (!v) {
      this.smoothAccelLocal.set(0, 0, 0);
      this.smoothAccelLatRoll = 0;
    } else if (!this.linvelSeeded || dt <= 1e-6) {
      this.smoothLinvel.set(v.x, v.y, v.z);
      this.prevSmoothLinvel.set(v.x, v.y, v.z);
      this.smoothAccelLocal.set(0, 0, 0);
      this.smoothAccelLatRoll = 0;
      this.linvelSeeded = true;
    } else {
      const velK = 1 - Math.exp(-HEAD_VEL_SMOOTH * dt);
      this.smoothLinvel.x += (v.x - this.smoothLinvel.x) * velK;
      this.smoothLinvel.y += (v.y - this.smoothLinvel.y) * velK;
      this.smoothLinvel.z += (v.z - this.smoothLinvel.z) * velK;

      const invDt = 1 / dt;
      const rawAx =
        (this.smoothLinvel.x - this.prevSmoothLinvel.x) * invDt;
      const rawAy =
        (this.smoothLinvel.y - this.prevSmoothLinvel.y) * invDt;
      const rawAz =
        (this.smoothLinvel.z - this.prevSmoothLinvel.z) * invDt;
      this.prevSmoothLinvel.copy(this.smoothLinvel);

      // Position path: heavy turn damp. Roll path: keep more lateral G.
      CameraRig.applyTurnSplit(
        rawAx,
        rawAy,
        rawAz,
        this.smoothLinvel.x,
        this.smoothLinvel.y,
        this.smoothLinvel.z,
        HEAD_TURN_ACCEL_SCALE,
        HEAD_TURN_PERP_CAP,
        this.tmp,
      );
      CameraRig.applyTurnSplit(
        rawAx,
        rawAy,
        rawAz,
        this.smoothLinvel.x,
        this.smoothLinvel.y,
        this.smoothLinvel.z,
        HEAD_TURN_ACCEL_SCALE_ROLL,
        HEAD_TURN_PERP_CAP_ROLL,
        this.tmpRollA,
      );

      this.tmp.applyQuaternion(this.chassisQuatInv);
      this.tmp.x = clamp(this.tmp.x, -HEAD_ACCEL_MAX, HEAD_ACCEL_MAX);
      this.tmp.z = clamp(this.tmp.z, -HEAD_ACCEL_MAX, HEAD_ACCEL_MAX);
      // Y soft-follow disabled — do not drive vertical head offset from ay.

      this.tmpRollA.applyQuaternion(this.chassisQuatInv);
      const aLatRoll = clamp(
        this.tmpRollA.x,
        -HEAD_ACCEL_MAX,
        HEAD_ACCEL_MAX,
      );

      const aK = 1 - Math.exp(-HEAD_ACCEL_SMOOTH * dt);
      const aKr = 1 - Math.exp(-HEAD_ROLL_ACCEL_SMOOTH * dt);
      this.smoothAccelLocal.x += (this.tmp.x - this.smoothAccelLocal.x) * aK;
      this.smoothAccelLocal.y = 0;
      this.smoothAccelLocal.z += (this.tmp.z - this.smoothAccelLocal.z) * aK;
      this.smoothAccelLatRoll +=
        (aLatRoll - this.smoothAccelLatRoll) * aKr;
    }

    const ax = CameraRig.deadzoneAxis(
      this.smoothAccelLocal.x,
      HEAD_ACCEL_DEADZONE,
    );
    const az = CameraRig.deadzoneAxis(
      this.smoothAccelLocal.z,
      HEAD_ACCEL_DEADZONE,
    );
    const aRoll = CameraRig.deadzoneAxis(
      this.smoothAccelLatRoll,
      HEAD_ROLL_DEADZONE,
    );

    const hx = CameraRig.integrateHeadOscillator(
      this.headOffsetLocal.x,
      this.headVelLocal.x,
      ax,
      dt,
      HEAD_OMEGA.x,
      HEAD_ZETA.x,
      HEAD_S.x,
      -HEAD_MAX_LAT,
      HEAD_MAX_LAT,
      HEAD_VEL_MAX,
    );
    const hz = CameraRig.integrateHeadOscillator(
      this.headOffsetLocal.z,
      this.headVelLocal.z,
      az,
      dt,
      HEAD_OMEGA.z,
      HEAD_ZETA.z,
      HEAD_S.z,
      -HEAD_MAX_AFT,
      HEAD_MAX_FORE,
      HEAD_VEL_MAX,
    );
    // Vertical: hard seat (no B-layer bob). Impact C may still add local Y.
    this.headOffsetLocal.set(hx.x, 0, hz.x);
    this.headVelLocal.set(hx.v, 0, hz.v);

    const hr = CameraRig.integrateHeadOscillator(
      this.headRoll,
      this.headRollVel,
      aRoll,
      dt,
      HEAD_ROLL_OMEGA,
      HEAD_ROLL_ZETA,
      HEAD_ROLL_S,
      -HEAD_ROLL_MAX,
      HEAD_ROLL_MAX,
      HEAD_ROLL_VEL_MAX,
    );
    this.headRoll = hr.x;
    this.headRollVel = hr.v;
  }

  /**
   * Semi-implicit Euler for x'' = −ω²(x + S a) − 2ζω ẋ.
   * Positive chassis accel (forward / up / right) displaces head negative
   * (and rolls opposite for a_lat).
   */
  private static integrateHeadOscillator(
    x: number,
    v: number,
    aLocal: number,
    dt: number,
    omega: number,
    zeta: number,
    s: number,
    xMin: number,
    xMax: number,
    vMax: number,
  ): { x: number; v: number } {
    const w = omega;
    const acc = -w * w * (x + s * aLocal) - 2 * zeta * w * v;
    let nv = v + acc * dt;
    nv = clamp(nv, -vMax, vMax);
    let nx = x + nv * dt;
    if (nx < xMin) {
      nx = xMin;
      if (nv < 0) nv = 0;
    } else if (nx > xMax) {
      nx = xMax;
      if (nv > 0) nv = 0;
    }
    // Park tiny residual when a≈0 and nearly still
    if (
      Math.abs(aLocal) < 1e-3 &&
      Math.abs(nx) < 1.2e-4 &&
      Math.abs(nv) < 1e-3
    ) {
      return { x: 0, v: 0 };
    }
    return { x: nx, v: nv };
  }

  private seedImpactContacts(opts?: CameraUpdateOpts): void {
    const wheels = opts?.wheelContacts;
    this.prevWheelContacts = wheels ? wheels.slice() : [];
    this.prevBodyContactCount = opts?.bodyContactCount ?? 0;
    this.impactContactsSeeded = true;
  }

  private rememberImpactContacts(opts?: CameraUpdateOpts): void {
    if (!this.impactContactsSeeded) {
      this.seedImpactContacts(opts);
      return;
    }
    const wheels = opts?.wheelContacts;
    if (wheels) {
      this.prevWheelContacts = wheels.slice();
    }
    if (opts?.bodyContactCount != null) {
      this.prevBodyContactCount = opts.bodyContactCount;
    }
  }

  /**
   * One-shot kicks from wheel air→ground and body 0→N contacts.
   * Strength curves match dust FX (`wheelLandingImpact01` / `bodySlamImpact01`).
   * Soft body scrapes and cooldown suppress stuck contact-flicker spam.
   */
  private applyImpactImpulses(opts?: CameraUpdateOpts): void {
    if (!this.impactContactsSeeded) {
      this.seedImpactContacts(opts);
      return;
    }
    if (this.impactCooldown > 0) return;

    const vy = opts?.linvel?.y ?? 0;
    const wheels = opts?.wheelContacts;
    let wheelS = 0;
    if (wheels && wheels.length > 0) {
      const n = Math.max(wheels.length, this.prevWheelContacts.length);
      for (let i = 0; i < n; i++) {
        const was = this.prevWheelContacts[i] ?? false;
        const now = wheels[i] ?? false;
        wheelS = Math.max(wheelS, wheelLandingImpact01(was, now, vy));
      }
    }
    const bodyN = opts?.bodyContactCount ?? 0;
    let bodyS = bodySlamImpact01(this.prevBodyContactCount, bodyN, vy);
    // Soft belly scrapes while wedged: ignore for camera (FX may still puff).
    if (bodyS > 0 && Math.max(0, -vy) < IMPACT_BODY_MIN_DOWN_MPS) {
      bodyS = 0;
    }
    // Body slam reads heavier than a single wheel landing.
    const s = Math.max(wheelS, bodyS * IMPACT_BODY_SCALE);
    if (s <= 0) return;

    this.impactCooldown = IMPACT_COOLDOWN_S;

    // Longitudinal only in chassis local. Vertical plane stays on seat.
    this.impactOffsetLocal.z -= s * IMPACT_KICK_Z;
    this.impactOffsetLocal.y = 0;
    this.impactPitch = 0;
    if (bodyS * IMPACT_BODY_SCALE >= wheelS && bodyS > 0) {
      // Deterministic light roll on body slam (no RNG — stable tests).
      this.impactRoll += s * IMPACT_KICK_ROLL * (bodyN % 2 === 0 ? 1 : -1);
    }

    this.impactOffsetLocal.z = clamp(
      this.impactOffsetLocal.z,
      -IMPACT_MAX_Z,
      IMPACT_MAX_Z,
    );
    this.impactOffsetLocal.x = clamp(
      this.impactOffsetLocal.x,
      -HEAD_MAX_LAT,
      HEAD_MAX_LAT,
    );
    this.impactOffsetLocal.y = 0;
    this.impactRoll = clamp(
      this.impactRoll,
      -IMPACT_MAX_ROLL,
      IMPACT_MAX_ROLL,
    );
  }
}
