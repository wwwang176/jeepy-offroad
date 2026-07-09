import * as THREE from "three";
import type { Vec3 } from "@/shared/types";
import { clamp } from "@/shared/math";

export type CameraMode = "third" | "first";

export type CameraPose = {
  position: Vec3;
  yaw: number;
  rotation?: { x: number; y: number; z: number; w: number };
};

/** Match original spring-arm: back 8m, up 3.5m. */
const TP_DIST_DEFAULT = Math.hypot(8, 3.5);
const TP_DEFAULT_PITCH = Math.atan2(3.5, 8);
const LOOK_SENS = 0.005; // rad per pixel
const TP_PITCH_MIN = 0.08;
const TP_PITCH_MAX = 1.35;
const FP_PITCH_MIN = -1.2;
const FP_PITCH_MAX = 1.2;
/** First-person free-look follow rate (higher = snappier). */
const FP_LOOK_SMOOTH = 14;

/** Third-person follow / look smoothing rate (higher = snappier). */
const TP_FOLLOW_SMOOTH = 10;
/**
 * EXP: hard-mount TP position + look to pose (no LERP).
 * Used to A/B test vehicle/camera "out of phase" vs smooth follow.
 * Set false to restore exponential follow.
 */
const TP_HARD_FOLLOW = true;

export class CameraRig {
  mode: CameraMode = "third";
  private readonly desired = new THREE.Vector3();
  private readonly lookDesired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly current = new THREE.Vector3();
  private lookInitialized = false;
  /** Cabin eye in chassis local space (+Z = vehicle forward). */
  private readonly eyeLocal = new THREE.Vector3(0, 1.25, 0.25);
  private readonly tmp = new THREE.Vector3();
  private readonly chassisQuat = new THREE.Quaternion();
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

  /** Third-person orbit relative to vehicle yaw (rad). */
  private orbitYaw = 0;
  /** Third-person elevation angle from horizontal (rad). */
  private orbitPitch = TP_DEFAULT_PITCH;
  /** Spring-arm length (m). */
  private orbitDist = TP_DIST_DEFAULT;
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
    this.camera.fov = mode === "third" ? 55 : 72;
    this.camera.updateProjectionMatrix();
    // Snap follow camera when entering third person
    if (mode === "third") {
      this.current.copy(this.camera.position);
      // Next update will hard-snap look to vehicle (avoid stale look from FP)
      this.lookInitialized = false;
    } else {
      // Entering FP: no lag from previous third-person session
      this.fpYaw = this.fpYawTarget;
      this.fpPitch = this.fpPitchTarget;
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
      // Drag right → orbit so the view pans right around the jeep.
      this.orbitYaw -= dx * LOOK_SENS;
      // Drag up (negative dy) → lower pitch → more level / hood view.
      this.orbitPitch = clamp(
        this.orbitPitch + dy * LOOK_SENS,
        TP_PITCH_MIN,
        TP_PITCH_MAX,
      );
      return;
    }
    // Drive targets only; smoothed angles catch up in update().
    this.fpYawTarget -= dx * LOOK_SENS;
    // Drag up (dy < 0) → look up (standard mouse-look).
    this.fpPitchTarget = clamp(
      this.fpPitchTarget - dy * LOOK_SENS,
      FP_PITCH_MIN,
      FP_PITCH_MAX,
    );
  }

  /** Reset free look (e.g. after respawn if desired). */
  resetLook(): void {
    this.orbitYaw = 0;
    this.orbitPitch = TP_DEFAULT_PITCH;
    this.fpYaw = 0;
    this.fpPitch = 0;
    this.fpYawTarget = 0;
    this.fpPitchTarget = 0;
  }

  /**
   * Absolute third-person orbit. Useful for visual QA screenshots.
   * orbitYaw/pitch in radians (relative to vehicle yaw); optional arm length m.
   */
  setOrbit(orbitYaw: number, orbitPitch?: number, dist?: number): void {
    this.orbitYaw = orbitYaw;
    if (orbitPitch != null) {
      this.orbitPitch = clamp(orbitPitch, TP_PITCH_MIN, TP_PITCH_MAX);
    }
    if (dist != null && dist > 0.5) {
      this.orbitDist = dist;
    }
  }

  getOrbit(): { yaw: number; pitch: number; dist: number } {
    return { yaw: this.orbitYaw, pitch: this.orbitPitch, dist: this.orbitDist };
  }

  update(dt: number, pose: CameraPose, opts?: { snap?: boolean }): void {
    if (this.mode === "third") {
      const yaw = pose.yaw + this.orbitYaw;
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
      // Look target tracks chassis with same smoothing as camera position —
      // raw pose.y chatter was causing distant ghosting / micro-shake.
      this.lookDesired.set(
        pose.position.x,
        pose.position.y + 1.2,
        pose.position.z,
      );
      if (TP_HARD_FOLLOW || opts?.snap || dt <= 0 || !this.lookInitialized) {
        this.current.copy(this.desired);
        this.look.copy(this.lookDesired);
        this.lookInitialized = true;
      } else {
        const k = 1 - Math.exp(-TP_FOLLOW_SMOOTH * dt);
        this.current.lerp(this.desired, k);
        this.look.lerp(this.lookDesired, k);
      }
      this.camera.position.copy(this.current);
      // Third person: world-up lookAt (stable chase)
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.look);
      return;
    }

    // First person: hard-mount to chassis so pitch/roll/yaw shake with the jeep.
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

    this.tmp.copy(this.eyeLocal).applyQuaternion(this.chassisQuat);
    this.camera.position.set(
      pose.position.x + this.tmp.x,
      pose.position.y + this.tmp.y,
      pose.position.z + this.tmp.z,
    );

    // Ease free-look toward mouse targets (exponential, frame-rate independent)
    if (opts?.snap || dt <= 0) {
      this.fpYaw = this.fpYawTarget;
      this.fpPitch = this.fpPitchTarget;
    } else {
      const k = 1 - Math.exp(-FP_LOOK_SMOOTH * dt);
      this.fpYaw += (this.fpYawTarget - this.fpYaw) * k;
      this.fpPitch += (this.fpPitchTarget - this.fpPitch) * k;
    }

    // Chassis shake + facing fix (-Z = vehicle forward) + free look
    this.lookEuler.set(this.fpPitch, this.fpYaw, 0, "YXZ");
    this.lookExtra.setFromEuler(this.lookEuler);
    this.camera.quaternion
      .copy(this.chassisQuat)
      .multiply(this.camFacingFix)
      .multiply(this.lookExtra);
    this.tmp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.camera.up.copy(this.tmp);
  }
}
