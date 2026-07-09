import RAPIER from "@dimforge/rapier3d-compat";
import type { InputActions } from "@/input/types";
import type { Pose2D, Vec3 } from "@/shared/types";
import { VEHICLE_CONFIG } from "@/shared/vehicleConfig";
import { clamp } from "@/shared/math";
import {
  SUSPENSION_RAY_GROUPS,
  VEHICLE_COLLIDER_GROUPS,
} from "@/physics/collisionGroups";

function yawFromQuat(q: { x: number; y: number; z: number; w: number }): number {
  const siny = 2 * (q.w * q.y + q.z * q.x);
  const cosy = 1 - 2 * (q.y * q.y + q.x * q.x);
  return Math.atan2(siny, cosy);
}

/**
 * Rapier built-in raycast vehicle — avoids hand-rolled force bugs that
 * launched the chassis (self-hit TOI / unstable damper).
 */
export class VehicleController {
  private readonly world: RAPIER.World;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly numWheels: number;

  constructor(world: RAPIER.World, pose: Pose2D) {
    this.world = world;
    const he = VEHICLE_CONFIG.chassisHalfExtents;
    const cabin = VEHICLE_CONFIG.cabinCollider;
    const mass = VEHICLE_CONFIG.massKg;

    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pose.position.x, pose.position.y, pose.position.z)
      .setRotation({
        x: 0,
        y: Math.sin(pose.yaw / 2),
        z: 0,
        w: Math.cos(pose.yaw / 2),
      })
      .setLinearDamping(0.05)
      .setAngularDamping(0.4)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(rbDesc);

    // Lower tub / doors — all mass lives here so COM stays at body origin
    // (Cannon-style: shape offset free, COM controlled separately from cabin volume).
    // setMass auto-computes box inertia about the collider center (0,0,0).
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
        .setMass(mass)
        .setFriction(VEHICLE_CONFIG.chassisFriction)
        .setRestitution(0)
        .setCollisionGroups(VEHICLE_COLLIDER_GROUPS)
        .setSolverGroups(VEHICLE_COLLIDER_GROUPS),
      this.body,
    );

    // Cabin / hardtop — collision only (mass 0). Offset up for roof hits;
    // must not contain wheel hardpoints (center.y - halfY > attachY).
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        cabin.halfExtents.x,
        cabin.halfExtents.y,
        cabin.halfExtents.z,
      )
        .setTranslation(cabin.center.x, cabin.center.y, cabin.center.z)
        .setMass(0)
        .setFriction(VEHICLE_CONFIG.chassisFriction)
        .setRestitution(0)
        .setCollisionGroups(VEHICLE_COLLIDER_GROUPS)
        .setSolverGroups(VEHICLE_COLLIDER_GROUPS),
      this.body,
    );

    // Ensure compound mass props reflect colliders (COM at lower-body origin).
    this.body.recomputeMassPropertiesFromColliders();

    this.controller = world.createVehicleController(this.body);
    // Local axes: up = Y (1), forward = Z (2)
    this.controller.indexUpAxis = 1;
    // Rapier JS binding typo: setter is named `setIndexForwardAxis`
    (
      this.controller as unknown as { setIndexForwardAxis: number }
    ).setIndexForwardAxis = 2;

    const cfg = VEHICLE_CONFIG;
    for (let i = 0; i < cfg.wheelPositions.length; i++) {
      const p = cfg.wheelPositions[i];
      // Suspension ray direction in chassis space (toward ground)
      this.controller.addWheel(
        { x: p.x, y: p.y, z: p.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        cfg.suspRestLength,
        cfg.wheelRadius,
      );
      // Soften spring + stronger dampers → less hop, longer tire contact on chatter
      this.controller.setWheelSuspensionStiffness(i, cfg.rapierSuspStiffness);
      this.controller.setWheelSuspensionCompression(i, cfg.rapierSuspCompression);
      this.controller.setWheelSuspensionRelaxation(i, cfg.rapierSuspRelaxation);
      this.controller.setWheelMaxSuspensionForce(i, cfg.maxSuspForce);
      this.controller.setWheelMaxSuspensionTravel(i, cfg.suspMaxTravel);
      this.controller.setWheelFrictionSlip(i, cfg.rapierFrictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, 1.15);
    }
    this.numWheels = cfg.wheelPositions.length;
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
  }

  getChassisBody(): RAPIER.RigidBody {
    return this.body;
  }

  getGroundedCount(): number {
    let n = 0;
    for (let i = 0; i < this.numWheels; i++) {
      if (this.controller.wheelIsInContact(i)) n++;
    }
    return n;
  }

  getPose(): {
    position: Vec3;
    yaw: number;
    rotation: { x: number; y: number; z: number; w: number };
  } {
    const t = this.body.translation();
    const r = this.body.rotation();
    return {
      position: { x: t.x, y: t.y, z: t.z },
      yaw: yawFromQuat(r),
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    };
  }

  /**
   * Per-wheel visuals after updateVehicle(): suspension travel, spin, steer.
   * suspensionLength is hardpoint → ground contact along the ray.
   */
  getWheelVisuals(): {
    suspensionLength: number;
    rotation: number;
    steering: number;
  }[] {
    const rest = VEHICLE_CONFIG.suspRestLength;
    const maxTravel = VEHICLE_CONFIG.suspMaxTravel;
    const out: {
      suspensionLength: number;
      rotation: number;
      steering: number;
    }[] = [];
    for (let i = 0; i < this.numWheels; i++) {
      const raw = this.controller.wheelSuspensionLength(i);
      // When airborne Rapier may report null or full extension
      let susp =
        raw != null && Number.isFinite(raw)
          ? raw
          : rest + maxTravel;
      // Clamp to physical range
      susp = Math.min(rest + maxTravel, Math.max(rest - maxTravel, susp));
      out.push({
        suspensionLength: susp,
        rotation: this.controller.wheelRotation(i) ?? 0,
        steering: this.controller.wheelSteering(i) ?? 0,
      });
    }
    return out;
  }

  reset(pose: Pose2D): void {
    this.body.setTranslation(
      { x: pose.position.x, y: pose.position.y, z: pose.position.z },
      true,
    );
    this.body.setRotation(
      {
        x: 0,
        y: Math.sin(pose.yaw / 2),
        z: 0,
        w: Math.cos(pose.yaw / 2),
      },
      true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < this.numWheels; i++) {
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
      this.controller.setWheelSteering(i, 0);
    }
  }

  /**
   * Apply engine/brake/steer then integrate vehicle rays.
   * Caller still runs world.step() after this.
   */
  update(dt: number, input: InputActions, _world: RAPIER.World): void {
    const cfg = VEHICLE_CONFIG;
    const speed = this.controller.currentVehicleSpeed();
    const steerFactor = clamp(1 - Math.abs(speed) / 25, 0.25, 1);
    // Input: +steer = right (D). Rapier vehicle steering is opposite of our
    // keyboard convention, so negate for correct left/right.
    const steer = -input.steer * cfg.maxSteerRad * steerFactor;

    let enginePerWheel = 0;
    let brakePerWheel = 0;
    if (input.brake > 0.1) {
      brakePerWheel = (cfg.brakeForce / this.numWheels) * input.brake * 0.02;
    } else {
      // Engine force: modest — controller applies as continuous force
      enginePerWheel = input.throttle * (cfg.engineForce / this.numWheels);
    }

    for (let i = 0; i < this.numWheels; i++) {
      const isFront = i < 2;
      this.controller.setWheelSteering(i, isFront ? steer : 0);
      this.controller.setWheelEngineForce(i, enginePerWheel);
      this.controller.setWheelBrake(i, brakePerWheel);
    }

    this.controller.updateVehicle(
      dt,
      undefined,
      SUSPENSION_RAY_GROUPS,
    );
  }
}
