import RAPIER from "@dimforge/rapier3d-compat";
import type { InputActions } from "@/input/types";
import type { Pose2D, Vec3 } from "@/shared/types";
import {
  chassisPrincipalInertia,
  VEHICLE_CONFIG,
} from "@/shared/vehicleConfig";
import {
  computeDriveForces,
  computeFlatTermSpeedsMps,
  DEFAULT_DRIVE_RANGE,
  type DriveRange,
} from "@/shared/driveTrain";
import { clamp } from "@/shared/math";
import {
  SUSPENSION_RAY_GROUPS,
  VEHICLE_COLLIDER_GROUPS,
} from "@/physics/collisionGroups";
import type { BiomeTraction } from "@/biome/types";
import {
  cloneRenderPose,
  cloneWheelVisuals,
  lerpRenderPose,
  lerpWheelVisuals,
  type RenderPose,
  type RenderWheelVisual,
} from "./visualInterpolation";

function yawFromQuat(q: { x: number; y: number; z: number; w: number }): number {
  const siny = 2 * (q.w * q.y + q.z * q.x);
  const cosy = 1 - 2 * (q.y * q.y + q.x * q.x);
  return Math.atan2(siny, cosy);
}

export type { RenderPose, RenderWheelVisual };

export type VehicleControllerOptions = {
  /** Biome surface grip (sand = ice-like). Omit = baseline. */
  traction?: BiomeTraction;
};

/**
 * Rapier built-in raycast vehicle — avoids hand-rolled force bugs that
 * launched the chassis (self-hit TOI / unstable damper).
 */
export class VehicleController {
  private readonly world: RAPIER.World;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly numWheels: number;
  /** Chassis + cabin colliders (for body-contact dust / scrapes). */
  private readonly colliders: RAPIER.Collider[] = [];
  /** Last applied transfer-case range (for HUD / debug). */
  private lastDriveRange: DriveRange = DEFAULT_DRIVE_RANGE;
  private lastDriveLabel = "4H";
  private lastAvailableEngine = 0;
  /** True only for explicit / opposite-throttle brake (not 4L 檔煞). */
  private lastServiceBraking = false;
  /** Smoothed front-wheel steer angle (rad), eases toward input target. */
  private steerCurrent = 0;
  /** Effective brake scale after biome traction (vs VEHICLE_CONFIG). */
  private readonly rapierBrakeScale: number;
  /**
   * Flat full-throttle terminal speeds (m/s), solved once from mass × damping
   * vs torque curve — not updated per frame.
   */
  private readonly flatTermByRange: Record<DriveRange, number>;

  /**
   * Render double-buffer (Fix Your Timestep):
   * after each fixed physics step, prev ← curr ← live body state.
   * Frame render uses lerp(prev, curr, acc/FIXED_DT).
   */
  private prevRenderPose: RenderPose | null = null;
  private currRenderPose: RenderPose | null = null;
  private prevWheelVisuals: RenderWheelVisual[] | null = null;
  private currWheelVisuals: RenderWheelVisual[] | null = null;

  constructor(
    world: RAPIER.World,
    pose: Pose2D,
    opts?: VehicleControllerOptions,
  ) {
    this.world = world;
    const cfg = VEHICLE_CONFIG;
    const he = cfg.chassisHalfExtents;
    const cabin = cfg.cabinCollider;
    const mass = cfg.massKg;

    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pose.position.x, pose.position.y, pose.position.z)
      .setRotation({
        x: 0,
        y: Math.sin(pose.yaw / 2),
        z: 0,
        w: Math.cos(pose.yaw / 2),
      })
      .setLinearDamping(cfg.chassisLinearDamping)
      .setAngularDamping(cfg.chassisAngularDamping)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(rbDesc);

    // Session-constant flat V_term for overspeed 檔煞 (4L gain > 0).
    this.flatTermByRange = computeFlatTermSpeedsMps(
      mass,
      cfg.chassisLinearDamping,
    );

    // Lower tub / doors — all mass lives here. Shape stays body-centered;
    // COM is pinned to the tub underside (Cannon-style: shape ≠ COM).
    const com = VEHICLE_CONFIG.centerOfMassLocal;
    const inertia = chassisPrincipalInertia(mass, he, com);
    this.colliders.push(
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
          .setMassProperties(
            mass,
            { x: com.x, y: com.y, z: com.z },
            { x: inertia.x, y: inertia.y, z: inertia.z },
            { x: 0, y: 0, z: 0, w: 1 },
          )
          .setFriction(VEHICLE_CONFIG.chassisFriction)
          .setRestitution(0)
          .setCollisionGroups(VEHICLE_COLLIDER_GROUPS)
          .setSolverGroups(VEHICLE_COLLIDER_GROUPS),
        this.body,
      ),
    );

    // Cabin / hardtop — collision only (mass 0). Offset up for roof hits;
    // must not contain wheel hardpoints (center.y - halfY > attachY).
    this.colliders.push(
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
      ),
    );

    // Compound mass props: COM at tub underside, cabin massless.
    this.body.recomputeMassPropertiesFromColliders();

    this.controller = world.createVehicleController(this.body);
    // Local axes: up = Y (1), forward = Z (2)
    this.controller.indexUpAxis = 1;
    // Rapier JS binding typo: setter is named `setIndexForwardAxis`
    (
      this.controller as unknown as { setIndexForwardAxis: number }
    ).setIndexForwardAxis = 2;

    const t = opts?.traction;
    const slipScale = t?.frictionSlipScale ?? 1;
    const sideScale = t?.sideFrictionScale ?? 1;
    const brakeScale = t?.brakeScale ?? 1;
    this.rapierBrakeScale = cfg.rapierBrakeScale * brakeScale;
    const frictionSlip = cfg.rapierFrictionSlip * slipScale;
    const sideFriction = cfg.rapierSideFrictionStiffness * sideScale;

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
      this.controller.setWheelFrictionSlip(i, frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, sideFriction);
    }
    this.numWheels = cfg.wheelPositions.length;
    // Spawn: no history yet — snap both buffers so first frames don't ghost.
    this.snapRenderState();
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
  }

  /**
   * Force prev = curr = live pose (spawn / respawn / teleport).
   * Avoids interpolating across a discontinuity.
   */
  snapRenderState(): void {
    const pose = this.getPose();
    const wheels = this.getWheelVisuals();
    this.prevRenderPose = cloneRenderPose(pose);
    this.currRenderPose = cloneRenderPose(pose);
    this.prevWheelVisuals = cloneWheelVisuals(wheels);
    this.currWheelVisuals = cloneWheelVisuals(wheels);
  }

  /**
   * Call once after each fixed `physics.step()` while the body is continuous.
   * Shifts the render double-buffer forward by one physics tick.
   */
  commitRenderSnapshot(): void {
    const pose = this.getPose();
    const wheels = this.getWheelVisuals();
    if (this.currRenderPose) {
      this.prevRenderPose = this.currRenderPose;
    } else {
      this.prevRenderPose = cloneRenderPose(pose);
    }
    if (this.currWheelVisuals) {
      this.prevWheelVisuals = this.currWheelVisuals;
    } else {
      this.prevWheelVisuals = cloneWheelVisuals(wheels);
    }
    this.currRenderPose = cloneRenderPose(pose);
    this.currWheelVisuals = cloneWheelVisuals(wheels);
  }

  /**
   * Pose for this render frame. `alpha` = remaining accumulator / FIXED_DT.
   */
  getRenderPose(alpha: number): RenderPose {
    if (!this.prevRenderPose || !this.currRenderPose) {
      return this.getPose();
    }
    return lerpRenderPose(this.prevRenderPose, this.currRenderPose, alpha);
  }

  /** Wheel visuals for this render frame (same alpha as getRenderPose). */
  getRenderWheelVisuals(alpha: number): RenderWheelVisual[] {
    if (!this.prevWheelVisuals || !this.currWheelVisuals) {
      return this.getWheelVisuals();
    }
    return lerpWheelVisuals(
      this.prevWheelVisuals,
      this.currWheelVisuals,
      alpha,
    );
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

  /** Per-wheel ground contact flags (length = wheel count). */
  getWheelContacts(): boolean[] {
    const out: boolean[] = [];
    for (let i = 0; i < this.numWheels; i++) {
      out.push(!!this.controller.wheelIsInContact(i));
    }
    return out;
  }

  /** Chassis linear velocity in world space (m/s). */
  getLinvel(): { x: number; y: number; z: number } {
    const v = this.body.linvel();
    return { x: v.x, y: v.y, z: v.z };
  }

  /**
   * World-space contact points where any chassis/cabin collider touches terrain.
   * Wheels are raycast-only (not listed) — body scrapes, belly, sides, roof.
   */
  getBodyContactPoints(): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    const maxPts = 24;
    for (const col of this.colliders) {
      if (out.length >= maxPts) break;
      this.world.contactPairsWith(col, (other) => {
        if (out.length >= maxPts) return;
        // Skip other colliders on the same rigid body
        if (other.parent()?.handle === this.body.handle) return;
        this.world.contactPair(col, other, (manifold) => {
          if (out.length >= maxPts) return;
          const n = manifold.numSolverContacts();
          for (let i = 0; i < n && out.length < maxPts; i++) {
            const p = manifold.solverContactPoint(i);
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
              out.push({ x: p.x, y: p.y, z: p.z });
            }
          }
        });
      });
    }
    return out;
  }

  /** Active transfer-case range after last update(). */
  getDriveRange(): DriveRange {
    return this.lastDriveRange;
  }

  getDriveLabel(): string {
    return this.lastDriveLabel;
  }

  /**
   * Driver service-brake intent for brake lamps.
   * False during 4L coast engine-brake.
   */
  isServiceBraking(): boolean {
    return this.lastServiceBraking;
  }

  /** Peak available engine force (N) at current speed/range before throttle. */
  getAvailableEngineForce(): number {
    return this.lastAvailableEngine;
  }

  /**
   * Ground-plane speed (m/s) for HUD speedometer.
   * Uses horizontal linvel so airborne / sideways still reads.
   */
  getSpeedMps(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z);
  }

  /** Signed chassis-forward speed from Rapier vehicle controller (m/s). */
  getForwardSpeedMps(): number {
    return this.controller.currentVehicleSpeed();
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
   *
   * Rapier `wheelSuspensionLength` = hardpoint → **wheel center** along the
   * suspension ray (NOT hardpoint → ground). See ray_cast_vehicle_controller:
   *   suspension_length = hit_distance - radius
   *   center = hard_point + direction * suspension_length
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
      // Airborne: Rapier leaves rest length (not max droop)
      let susp =
        raw != null && Number.isFinite(raw) ? raw : rest;
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
    this.steerCurrent = 0;
    for (let i = 0; i < this.numWheels; i++) {
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
      this.controller.setWheelSteering(i, 0);
    }
    // Teleport: do not interpolate from pre-reset pose.
    this.snapRenderState();
  }

  /**
   * Apply engine/brake/steer then integrate vehicle rays.
   * Drive uses transfer-case range + torque–speed curve (see driveTrain.ts).
   * Caller still runs world.step() after this.
   */
  update(dt: number, input: InputActions, _world: RAPIER.World): void {
    const cfg = VEHICLE_CONFIG;
    const speed = this.controller.currentVehicleSpeed();
    const range = input.driveRange ?? DEFAULT_DRIVE_RANGE;
    const drive = computeDriveForces({
      speed,
      throttle: input.throttle,
      brake: input.brake,
      range,
      wheelCount: this.numWheels,
      baseBrakeForce: cfg.brakeForce,
      rapierBrakeScale: this.rapierBrakeScale,
      flatTermSpeedMps: this.flatTermByRange[range],
    });
    this.lastDriveRange = drive.range;
    this.lastDriveLabel = drive.label;
    this.lastAvailableEngine = drive.availableEngineForce;
    this.lastServiceBraking = drive.serviceBraking;

    // Steering still eases off with speed (road feel in 4H; 4L stays agile).
    const steerRefSpeed = range === "L" ? 12 : 25;
    const steerFactor = clamp(1 - Math.abs(speed) / steerRefSpeed, 0.25, 1);
    // Input: +steer = right (D). Rapier vehicle steering is opposite of our
    // keyboard convention, so negate for correct left/right.
    const steerTarget = -input.steer * cfg.maxSteerRad * steerFactor;
    // Exponential LERP: softens instant A/D snaps → more slide-friendly turn-in.
    const steerK = 1 - Math.exp(-cfg.steerSmooth * Math.max(dt, 0));
    this.steerCurrent += (steerTarget - this.steerCurrent) * steerK;
    const steer = this.steerCurrent;

    for (let i = 0; i < this.numWheels; i++) {
      const isFront = i < 2;
      this.controller.setWheelSteering(i, isFront ? steer : 0);
      this.controller.setWheelEngineForce(i, drive.enginePerWheel);
      this.controller.setWheelBrake(i, drive.brakePerWheel);
    }

    this.controller.updateVehicle(
      dt,
      undefined,
      SUSPENSION_RAY_GROUPS,
    );
  }
}
