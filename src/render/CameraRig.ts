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
  /** Chassis linear velocity (m/s); used for FP impact shake (vy). */
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
 * First-person head soft-follow (layer B): eye lags hard-mount target in world
 * space, then offset is clamped in chassis local (m). Higher smooth = tighter.
 */
const HEAD_POS_SMOOTH = 11;
const HEAD_MAX_UP = 0.06;
const HEAD_MAX_DOWN = 0.08;
const HEAD_MAX_FORE = 0.05;
const HEAD_MAX_AFT = 0.05;
const HEAD_MAX_LAT = 0.03;

/**
 * First-person impact shake (layer C): event impulse on wheel landing / body slam.
 * Position kicks in chassis local (m); pitch nod in rad; exponential decay.
 */
const IMPACT_DECAY = 12;
const IMPACT_KICK_Y = 0.045;
const IMPACT_KICK_Z = 0.025;
const IMPACT_KICK_PITCH = 0.035;
const IMPACT_KICK_ROLL = 0.02;
const IMPACT_BODY_SCALE = 1.25;
const IMPACT_MAX_Y = 0.07;
const IMPACT_MAX_Z = 0.04;
const IMPACT_MAX_PITCH = 0.055;
const IMPACT_MAX_ROLL = 0.04;

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
  private readonly impactOffsetLocal = new THREE.Vector3();
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
  /** Soft-follow eye has been seeded (false after mode switch / reset / snap). */
  private fpEyeInitialized = false;
  /** Transient impact pitch (rad, + = look up; landings kick negative). */
  private impactPitch = 0;
  /** Transient impact roll (rad). */
  private impactRoll = 0;
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

  /** Clear FP soft-follow + impact (next FP update hard-snaps eye). */
  private resetHeadState(): void {
    this.fpEyeInitialized = false;
    this.impactOffsetLocal.set(0, 0, 0);
    this.impactPitch = 0;
    this.impactRoll = 0;
    this.prevWheelContacts = [];
    this.prevBodyContactCount = 0;
    this.impactContactsSeeded = false;
  }

  /** World-space FP eye before impact kick (tests / debug). */
  getFpEyeWorld(): { x: number; y: number; z: number } {
    return {
      x: this.fpEyeWorld.x,
      y: this.fpEyeWorld.y,
      z: this.fpEyeWorld.z,
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
    // + head soft-follow (B) + impact impulse (C).
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
      this.fpEyeWorld.copy(this.desiredEye);
      this.fpEyeInitialized = true;
      this.impactOffsetLocal.set(0, 0, 0);
      this.impactPitch = 0;
      this.impactRoll = 0;
      // Seed contact history without firing (spawn / settle / mode switch).
      this.seedImpactContacts(opts);
    } else {
      // B: soft-follow hard-mount target, clamp lag in chassis local.
      const headK = 1 - Math.exp(-HEAD_POS_SMOOTH * dt);
      this.fpEyeWorld.x += (this.desiredEye.x - this.fpEyeWorld.x) * headK;
      this.fpEyeWorld.y += (this.desiredEye.y - this.fpEyeWorld.y) * headK;
      this.fpEyeWorld.z += (this.desiredEye.z - this.fpEyeWorld.z) * headK;

      this.tmp.subVectors(this.fpEyeWorld, this.desiredEye);
      this.tmp.applyQuaternion(this.chassisQuatInv);
      this.tmp.x = clamp(this.tmp.x, -HEAD_MAX_LAT, HEAD_MAX_LAT);
      this.tmp.y = clamp(this.tmp.y, -HEAD_MAX_DOWN, HEAD_MAX_UP);
      this.tmp.z = clamp(this.tmp.z, -HEAD_MAX_AFT, HEAD_MAX_FORE);
      this.tmp.applyQuaternion(this.chassisQuat);
      this.fpEyeWorld.copy(this.desiredEye).add(this.tmp);

      // C: detect landings / body slam, then decay residual kick.
      this.applyImpactImpulses(opts);
      const decay = Math.exp(-IMPACT_DECAY * dt);
      this.impactOffsetLocal.multiplyScalar(decay);
      this.impactPitch *= decay;
      this.impactRoll *= decay;
      this.rememberImpactContacts(opts);
    }

    // Final eye = soft head + chassis-local impact offset
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
   */
  private applyImpactImpulses(opts?: CameraUpdateOpts): void {
    if (!this.impactContactsSeeded) {
      this.seedImpactContacts(opts);
      return;
    }
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
    const bodyS = bodySlamImpact01(this.prevBodyContactCount, bodyN, vy);
    // Body slam reads heavier than a single wheel landing.
    const s = Math.max(wheelS, bodyS * IMPACT_BODY_SCALE);
    if (s <= 0) return;

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
