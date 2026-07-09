import RAPIER from "@dimforge/rapier3d-compat";
import { TERRAIN_COLLIDER_GROUPS } from "@/physics/collisionGroups";

export class PhysicsWorld {
  private constructor(private readonly world: RAPIER.World) {}

  static async create(): Promise<PhysicsWorld> {
    // RAPIER.init already done in boot
    return new PhysicsWorld(new RAPIER.World({ x: 0, y: -9.81, z: 0 }));
  }

  getWorld(): RAPIER.World {
    return this.world;
  }

  step(): void {
    this.world.step();
  }

  /** Free Rapier WASM world resources (call on session teardown). */
  destroy(): void {
    this.world.free();
  }

  createGroundPlane(y = 0): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, y, 0),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(500, 0.1, 500)
        .setTranslation(0, 0, 0)
        .setCollisionGroups(TERRAIN_COLLIDER_GROUPS)
        .setSolverGroups(TERRAIN_COLLIDER_GROUPS),
      body,
    );
  }
}
