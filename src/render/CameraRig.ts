import * as THREE from "three";
import type { Vec3 } from "@/shared/types";
import { clamp, deltaAngle, lerp, wrapAngle } from "@/shared/math";

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

export class CameraRig {
  mode: CameraMode = "third";
  private readonly desired = new THREE.Vector3();
  private readonly lookDesired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly current = new THREE.Vector3();
  private lookInitialized = false;
  /** Cabin eye in chassis local space (+Z = vehicle forward). */
  private readonly eyeLocal = new THREE.Vector3(0, 1.15, 0.25);
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
