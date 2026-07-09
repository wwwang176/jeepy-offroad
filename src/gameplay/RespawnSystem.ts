import type { InputActions } from "@/input/types";
import type { VehicleController } from "@/physics/vehicle/VehicleController";
import type { Vec3 } from "@/shared/types";
import type { CheckpointSystem } from "./CheckpointSystem";

export class RespawnSystem {
  private lock = 0;

  constructor(
    private killY: number,
    private checkpoints: CheckpointSystem,
    private vehicle: VehicleController,
  ) {}

  update(dt: number, pos: Vec3, input: InputActions): void {
    if (this.lock > 0) {
      this.lock -= dt;
      return;
    }
    if (pos.y < this.killY || input.respawn) {
      this.vehicle.reset(this.checkpoints.getRespawnPose());
      this.lock = 0.25;
    }
  }

  inputLocked(): boolean {
    return this.lock > 0;
  }
}
