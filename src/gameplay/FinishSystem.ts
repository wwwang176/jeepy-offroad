import type { LevelData } from "@/levelgen/types";
import type { Vec3 } from "@/shared/types";

export class FinishSystem {
  constructor(private finish: LevelData["finish"]) {}

  isFinished(position: Vec3): boolean {
    const he = this.finish.halfExtents;
    const p = this.finish.position;
    return (
      Math.abs(position.x - p.x) <= he.x &&
      Math.abs(position.y - p.y) <= he.y &&
      Math.abs(position.z - p.z) <= he.z
    );
  }

  getFinish(): LevelData["finish"] {
    return this.finish;
  }
}
