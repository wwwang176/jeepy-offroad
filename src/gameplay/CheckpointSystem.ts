import type { LevelData } from "@/levelgen/types";
import { sampleBilinear } from "@/levelgen/heightmap";
import type { Pose2D, Vec3 } from "@/shared/types";
import { chassisSpawnY } from "@/shared/vehicleConfig";

/** Heightmap used to place chassis above real ground on respawn. */
export type TerrainSample = {
  heightmap: Float32Array;
  resolution: number;
  worldSize: number;
};

/**
 * Tracks last checkpoint XZ/yaw. Respawn Y is always derived from the
 * live heightmap — path polyline Y is grade-limited design height and
 * can sit below (or above) the stamped terrain.
 */
export class CheckpointSystem {
  private lastX: number;
  private lastZ: number;
  private lastYaw: number;

  constructor(
    start: Pose2D,
    private checkpoints: LevelData["checkpoints"],
    private terrain: TerrainSample,
  ) {
    this.lastX = start.position.x;
    this.lastZ = start.position.z;
    this.lastYaw = start.yaw;
  }

  update(pos: Vec3): void {
    for (const cp of this.checkpoints) {
      if (
        Math.hypot(pos.x - cp.position.x, pos.z - cp.position.z) <= cp.radius
      ) {
        this.lastX = cp.position.x;
        this.lastZ = cp.position.z;
        this.lastYaw = cp.yaw;
      }
    }
  }

  getRespawnPose(): Pose2D {
    const groundY = sampleBilinear(
      this.terrain.heightmap,
      this.terrain.resolution,
      this.terrain.worldSize,
      this.lastX,
      this.lastZ,
    );
    return {
      position: {
        x: this.lastX,
        y: chassisSpawnY(Number.isFinite(groundY) ? groundY : 0),
        z: this.lastZ,
      },
      yaw: this.lastYaw,
    };
  }
}
