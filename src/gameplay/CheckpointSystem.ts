import type { LevelData } from "@/levelgen/types";
import type { Pose2D, Vec3 } from "@/shared/types";
import { chassisSpawnY } from "@/shared/vehicleConfig";

export class CheckpointSystem {
  private last: Pose2D;

  constructor(start: Pose2D, private checkpoints: LevelData["checkpoints"]) {
    this.last = {
      position: { ...start.position },
      yaw: start.yaw,
    };
  }

  update(pos: Vec3): void {
    for (const cp of this.checkpoints) {
      if (
        Math.hypot(pos.x - cp.position.x, pos.z - cp.position.z) <= cp.radius
      ) {
        this.last = {
          position: {
            x: cp.position.x,
            y: chassisSpawnY(cp.position.y),
            z: cp.position.z,
          },
          yaw: cp.yaw,
        };
      }
    }
  }

  getRespawnPose(): Pose2D {
    return {
      position: { ...this.last.position },
      yaw: this.last.yaw,
    };
  }
}
