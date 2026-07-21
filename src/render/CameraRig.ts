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
 * First-person head inertia (layer B): chassis-local eye offset driven by
 * linear acceleration (smoothed Δlinvel/dt). Constant velocity → a≈0 → rest.
 * Deadzone + LPF kill contact jitter when stuck on rocks / ledges.
 * Gains: metres of offset per (m/s²).
 *
 * Smooth rates are exponential lerp rates (1/s): lower = softer / more lag.
 * Asymmetric offset ease: snap lean-in on accel, slow return when a dies.
 */
/** Lean-in (away from rest) — high so throttle/accel reads immediately. */
const HEAD_OFFSET_SMOOTH_IN = 22;
/** Return-to-rest is slower so the lean lingers after accel drops. */
const HEAD_OFFSET_SMOOTH_OUT = 2.0;
/** Gains / max offsets halved for subtler cabin motion. */
const HEAD_GAIN_LON = 0.006;
const HEAD_GAIN_LAT = 0.005;
const HEAD_GAIN_VERT = 0.007;
/** Low-pass linvel before differencing (higher = snappier, noisier). */
const HEAD_VEL_SMOOTH = 18;
/** Accel LPF: fast when |a| grows (throttle hit), slower when |a| falls. */
const HEAD_ACCEL_SMOOTH_IN = 20;
const HEAD_ACCEL_SMOOTH_OUT = 7;
/** Clamp |a| per axis before gain (m/s²) to kill single-frame spikes. */
const HEAD_ACCEL_MAX = 22;
/** |a_local| below this (m/s²) treated as 0 — kills stuck micro-jitter. */
const HEAD_ACCEL_DEADZONE = 3.5;
const HEAD_MAX_UP = 0.03;
const HEAD_MAX_DOWN = 0.04;
const HEAD_MAX_FORE = 0.025;
const HEAD_MAX_AFT = 0.025;
const HEAD_MAX_LAT = 0.015;

/**
 * First-person impact shake (layer C): event impulse on wheel landing / body slam.
 * Position kicks in chassis local (m); pitch nod in rad; exponential decay.
 * Position kicks / caps halved with head gains.
 */
const IMPACT_DECAY = 12;
const IMPACT_KICK_Y = 0.0225;
const IMPACT_KICK_Z = 0.0125;
const IMPACT_KICK_PITCH = 0.035;
const IMPACT_KICK_ROLL = 0.02;
const IMPACT_BODY_SCALE = 1.25;
const IMPACT_MAX_Y = 0.035;
const IMPACT_MAX_Z = 0.02;
const IMPACT_MAX_PITCH = 0.055;
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
  /** Accel-driven head offset in chassis local (m); rest at 0. */
  private readonly headOffsetLocal = new THREE.Vector3();
  private readonly headOffsetTarget = new THREE.Vector3();
  private readonly impactOffsetLocal = new THREE.Vector3();
  /** Smoothed linvel used for Δv/dt (world). */
  private readonly smoothLinvel = new THREE.Vector3();
  private readonly prevSmoothLinvel = new THREE.Vector3();
  /** Smoothed chassis-local accel after deadzone. */
  private readonly smoothAccelLocal = new THREE.Vector3();
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
    this.headOffsetTarget.set(0, 0, 0);
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
      this.headOffsetTarget.set(0, 0, 0);
      this.impactOffsetLocal.set(0, 0, 0);
      this.impactPitch = 0;
      this.impactRoll = 0;
      this.seedLinvel(opts);
      // Seed contact history without firing (spawn / settle / mode switch).
      this.seedImpactContacts(opts);
    } else {
      // B: accel → local offset target; ease toward it (const vel → home).
      this.updateHeadFromAccel(dt, opts);
      // C: detect landings / body slam, then decay residual kick.
      if (this.impactCooldown > 0) {
        this.impactCooldown = Math.max(0, this.impactCooldown - dt);
      }
      this.applyImpactImpulses(opts);
      const decay = Math.exp(-IMPACT_DECAY * dt);
      this.impactOffsetLocal.multiplyScalar(decay);
      this.impactPitch *= decay;
      this.impactRoll *= decay;
      this.rememberImpactContacts(opts);
    }

    // Eye = hard-mount + head inertia (+ impact on final camera only)
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

    // Chassis + facing fix (-Z = vehicle forward) + free look + impact nod/roll
    this.lookEuler.set(
      this.fpPitch + this.impactPitch,
      this.fpYaw,
      this.impactRoll,
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
    this.linvelSeeded = true;
  }

  /** Zero chassis-local accel components inside deadzone (m/s²). */
  private static deadzoneAxis(v: number, dead: number): number {
    return Math.abs(v) < dead ? 0 : v;
  }

  /**
   * Layer B: smooth linvel → Δv/dt → local accel LPF + deadzone → offset target.
   * Stuck contact jitter stays below deadzone so the eye returns to rest.
   */
  private updateHeadFromAccel(dt: number, opts?: CameraUpdateOpts): void {
    const v = opts?.linvel;
    if (!v) {
      this.headOffsetTarget.set(0, 0, 0);
      this.smoothAccelLocal.set(0, 0, 0);
    } else if (!this.linvelSeeded || dt <= 1e-6) {
      this.smoothLinvel.set(v.x, v.y, v.z);
      this.prevSmoothLinvel.set(v.x, v.y, v.z);
      this.smoothAccelLocal.set(0, 0, 0);
      this.linvelSeeded = true;
      this.headOffsetTarget.set(0, 0, 0);
    } else {
      // 1) Low-pass raw linvel (kills high-freq contact noise before Δ)
      const velK = 1 - Math.exp(-HEAD_VEL_SMOOTH * dt);
      this.smoothLinvel.x += (v.x - this.smoothLinvel.x) * velK;
      this.smoothLinvel.y += (v.y - this.smoothLinvel.y) * velK;
      this.smoothLinvel.z += (v.z - this.smoothLinvel.z) * velK;

      const invDt = 1 / dt;
      this.tmp.set(
        (this.smoothLinvel.x - this.prevSmoothLinvel.x) * invDt,
        (this.smoothLinvel.y - this.prevSmoothLinvel.y) * invDt,
        (this.smoothLinvel.z - this.prevSmoothLinvel.z) * invDt,
      );
      this.prevSmoothLinvel.copy(this.smoothLinvel);

      // 2) World → chassis local, hard cap spikes
      this.tmp.applyQuaternion(this.chassisQuatInv);
      this.tmp.x = clamp(this.tmp.x, -HEAD_ACCEL_MAX, HEAD_ACCEL_MAX);
      this.tmp.y = clamp(this.tmp.y, -HEAD_ACCEL_MAX, HEAD_ACCEL_MAX);
      this.tmp.z = clamp(this.tmp.z, -HEAD_ACCEL_MAX, HEAD_ACCEL_MAX);

      // 3) Asymmetric low-pass local accel (snap onset, softer decay)
      this.smoothAccelLocal.x = CameraRig.easeHeadAxis(
        this.smoothAccelLocal.x,
        this.tmp.x,
        dt,
        HEAD_ACCEL_SMOOTH_IN,
        HEAD_ACCEL_SMOOTH_OUT,
      );
      this.smoothAccelLocal.y = CameraRig.easeHeadAxis(
        this.smoothAccelLocal.y,
        this.tmp.y,
        dt,
        HEAD_ACCEL_SMOOTH_IN,
        HEAD_ACCEL_SMOOTH_OUT,
      );
      this.smoothAccelLocal.z = CameraRig.easeHeadAxis(
        this.smoothAccelLocal.z,
        this.tmp.z,
        dt,
        HEAD_ACCEL_SMOOTH_IN,
        HEAD_ACCEL_SMOOTH_OUT,
      );

      // 4) Deadzone — micro jitter from stuck contacts dies here
      const ax = CameraRig.deadzoneAxis(
        this.smoothAccelLocal.x,
        HEAD_ACCEL_DEADZONE,
      );
      const ay = CameraRig.deadzoneAxis(
        this.smoothAccelLocal.y,
        HEAD_ACCEL_DEADZONE,
      );
      const az = CameraRig.deadzoneAxis(
        this.smoothAccelLocal.z,
        HEAD_ACCEL_DEADZONE,
      );

      // Inertia: head lags opposite chassis acceleration
      this.headOffsetTarget.set(
        -ax * HEAD_GAIN_LAT,
        -ay * HEAD_GAIN_VERT,
        -az * HEAD_GAIN_LON,
      );
      this.headOffsetTarget.x = clamp(
        this.headOffsetTarget.x,
        -HEAD_MAX_LAT,
        HEAD_MAX_LAT,
      );
      this.headOffsetTarget.y = clamp(
        this.headOffsetTarget.y,
        -HEAD_MAX_DOWN,
        HEAD_MAX_UP,
      );
      this.headOffsetTarget.z = clamp(
        this.headOffsetTarget.z,
        -HEAD_MAX_AFT,
        HEAD_MAX_FORE,
      );
    }

    // Per-axis asymmetric ease: snappier lean-in, slower settle back to 0.
    this.headOffsetLocal.x = CameraRig.easeHeadAxis(
      this.headOffsetLocal.x,
      this.headOffsetTarget.x,
      dt,
      HEAD_OFFSET_SMOOTH_IN,
      HEAD_OFFSET_SMOOTH_OUT,
    );
    this.headOffsetLocal.y = CameraRig.easeHeadAxis(
      this.headOffsetLocal.y,
      this.headOffsetTarget.y,
      dt,
      HEAD_OFFSET_SMOOTH_IN,
      HEAD_OFFSET_SMOOTH_OUT,
    );
    this.headOffsetLocal.z = CameraRig.easeHeadAxis(
      this.headOffsetLocal.z,
      this.headOffsetTarget.z,
      dt,
      HEAD_OFFSET_SMOOTH_IN,
      HEAD_OFFSET_SMOOTH_OUT,
    );
  }

  /**
   * Exponential lerp toward target. If |target| < |current| (heading home),
   * use slower `rateOut` so onset is snappy and return lingers.
   */
  private static easeHeadAxis(
    current: number,
    target: number,
    dt: number,
    rateIn: number,
    rateOut: number,
  ): number {
    const returning = Math.abs(target) < Math.abs(current) - 1e-6;
    const rate = returning ? rateOut : rateIn;
    const k = 1 - Math.exp(-rate * dt);
    return current + (target - current) * k;
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

    // Down + slightly aft in chassis local; nod pitch down (+pitch = look up).
    this.impactOffsetLocal.y -= s * IMPACT_KICK_Y;
    this.impactOffsetLocal.z -= s * IMPACT_KICK_Z;
    this.impactPitch -= s * IMPACT_KICK_PITCH;
    if (bodyS * IMPACT_BODY_SCALE >= wheelS && bodyS > 0) {
      // Deterministic light roll on body slam (no RNG — stable tests).
      this.impactRoll += s * IMPACT_KICK_ROLL * (bodyN % 2 === 0 ? 1 : -1);
    }

    this.impactOffsetLocal.y = clamp(
      this.impactOffsetLocal.y,
      -IMPACT_MAX_Y,
      IMPACT_MAX_Y,
    );
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
    this.impactPitch = clamp(
      this.impactPitch,
      -IMPACT_MAX_PITCH,
      IMPACT_MAX_PITCH,
    );
    this.impactRoll = clamp(
      this.impactRoll,
      -IMPACT_MAX_ROLL,
      IMPACT_MAX_ROLL,
    );
  }
}
