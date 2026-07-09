import * as THREE from "three";
import type { Vec3 } from "@/shared/types";
import { yawToDir } from "@/shared/math";

export type CameraMode = "third" | "first";

export type CameraPose = {
  position: Vec3;
  yaw: number;
  rotation?: { x: number; y: number; z: number; w: number };
};

export class CameraRig {
  mode: CameraMode = "third";
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly current = new THREE.Vector3();
  /** Cabin eye in chassis local space. */
  private readonly eyeLocal = new THREE.Vector3(0, 1.25, 0.2);
  private readonly tmp = new THREE.Vector3();
  private readonly chassisQuat = new THREE.Quaternion();

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
    }
  }

  toggle(): void {
    this.setMode(this.mode === "third" ? "first" : "third");
  }

  update(dt: number, pose: CameraPose): void {
    if (this.mode === "third") {
      const forward = yawToDir(pose.yaw);
      this.desired.set(
        pose.position.x - forward.x * 8,
        pose.position.y + 3.5,
        pose.position.z - forward.z * 8,
      );
      this.look.set(
        pose.position.x,
        pose.position.y + 1.2,
        pose.position.z,
      );
      const k = 1 - Math.exp(-10 * dt);
      this.current.lerp(this.desired, k);
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

    // Camera orientation = chassis orientation (full 6DOF cabin shake)
    this.camera.quaternion.copy(this.chassisQuat);
    // Keep Three's up vector in chassis space for correct matrix updates
    this.tmp.set(0, 1, 0).applyQuaternion(this.chassisQuat);
    this.camera.up.copy(this.tmp);
  }
}
