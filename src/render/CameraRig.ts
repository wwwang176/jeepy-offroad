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
  private readonly eyeLocal = new THREE.Vector3(0, 1.35, 0.35);
  private readonly lookLocal = new THREE.Vector3(0, 1.35, 10);
  private readonly tmp = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();

  constructor(private camera: THREE.PerspectiveCamera) {
    this.setMode("third");
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.camera.fov = mode === "third" ? 55 : 72;
    this.camera.updateProjectionMatrix();
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
      this.camera.lookAt(this.look);
      return;
    }

    // First person: follow full chassis orientation (yaw + pitch + roll)
    if (pose.rotation) {
      this.quat.set(
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.rotation.w,
      );
    } else {
      this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
    }

    this.tmp.copy(this.eyeLocal).applyQuaternion(this.quat);
    this.camera.position.set(
      pose.position.x + this.tmp.x,
      pose.position.y + this.tmp.y,
      pose.position.z + this.tmp.z,
    );

    this.tmp.copy(this.lookLocal).applyQuaternion(this.quat);
    this.look.set(
      pose.position.x + this.tmp.x,
      pose.position.y + this.tmp.y,
      pose.position.z + this.tmp.z,
    );
    this.camera.lookAt(this.look);
  }
}
