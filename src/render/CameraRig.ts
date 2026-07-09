import * as THREE from "three";
import type { Vec3 } from "@/shared/types";
import { yawToDir } from "@/shared/math";

export type CameraMode = "third" | "first";

export class CameraRig {
  mode: CameraMode = "third";
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly current = new THREE.Vector3();

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

  update(
    dt: number,
    pose: { position: Vec3; yaw: number },
  ): void {
    const forward = yawToDir(pose.yaw);
    if (this.mode === "third") {
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
    } else {
      this.camera.position.set(
        pose.position.x + forward.x * 0.35,
        pose.position.y + 1.35,
        pose.position.z + forward.z * 0.35,
      );
      this.look.set(
        pose.position.x + forward.x * 10,
        pose.position.y + 1.35,
        pose.position.z + forward.z * 10,
      );
      this.camera.lookAt(this.look);
    }
  }
}
