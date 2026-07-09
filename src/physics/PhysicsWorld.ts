import RAPIER from "@dimforge/rapier3d-compat";

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

  createGroundPlane(y = 0): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, y, 0),
    );
    // Cuboid half-extents: top surface at y + 0.1
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(500, 0.1, 500).setTranslation(0, 0, 0),
      body,
    );
  }
}
