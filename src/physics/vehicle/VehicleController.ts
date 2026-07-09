import RAPIER from "@dimforge/rapier3d-compat";
import type { InputActions } from "@/input/types";
import type { Pose2D, Vec3 } from "@/shared/types";
import { VEHICLE_CONFIG } from "@/shared/vehicleConfig";
import { clamp } from "@/shared/math";

const FIXED_DT = 1 / 60;

type WheelState = {
  localPos: { x: number; y: number; z: number };
  isFront: boolean;
  prevCompression: number;
  grounded: boolean;
};

function quatRotate(
  q: { x: number; y: number; z: number; w: number },
  v: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  // q * v * q^-1
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

function yawFromQuat(q: { x: number; y: number; z: number; w: number }): number {
  // yaw around +Y
  const siny = 2 * (q.w * q.y + q.z * q.x);
  const cosy = 1 - 2 * (q.y * q.y + q.x * q.x);
  return Math.atan2(siny, cosy);
}

export class VehicleController {
  private readonly body: RAPIER.RigidBody;
  private readonly wheels: WheelState[];
  private steerAngle = 0;

  constructor(world: RAPIER.World, pose: Pose2D) {
    const he = VEHICLE_CONFIG.chassisHalfExtents;
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pose.position.x, pose.position.y, pose.position.z)
      .setRotation({
        x: 0,
        y: Math.sin(pose.yaw / 2),
        z: 0,
        w: Math.cos(pose.yaw / 2),
      })
      .setLinearDamping(0.15)
      .setAngularDamping(0.4)
      .setCanSleep(false);
    this.body = world.createRigidBody(rbDesc);
    const coll = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setMass(VEHICLE_CONFIG.massKg)
      .setFriction(0.8)
      .setRestitution(0.0);
    world.createCollider(coll, this.body);

    this.wheels = VEHICLE_CONFIG.wheelPositions.map((p, i) => ({
      localPos: { x: p.x, y: p.y, z: p.z },
      isFront: i < 2, // FL, FR, RL, RR
      prevCompression: 0,
      grounded: false,
    }));
  }

  getChassisBody(): RAPIER.RigidBody {
    return this.body;
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
    this.steerAngle = 0;
    for (const w of this.wheels) {
      w.prevCompression = 0;
      w.grounded = false;
    }
  }

  /**
   * Apply suspension, tire friction, drive/brake. Does NOT call world.step().
   * `dt` should be FIXED_DT (1/60) when used in the fixed accumulator.
   */
  update(dt: number, input: InputActions, world: RAPIER.World): void {
    const stepDt = dt > 0 ? dt : FIXED_DT;
    const cfg = VEHICLE_CONFIG;
    const origin = this.body.translation();
    const rot = this.body.rotation();
    const linvel = this.body.linvel();
    const angvel = this.body.angvel();

    // Speed along chassis forward (local +Z)
    const forwardWorld = quatRotate(rot, { x: 0, y: 0, z: 1 });
    const speed =
      linvel.x * forwardWorld.x +
      linvel.y * forwardWorld.y +
      linvel.z * forwardWorld.z;

    // Speed-sensitive steer
    const steerFactor = clamp(1 - Math.abs(speed) / 25, 0.25, 1);
    const targetSteer = input.steer * cfg.maxSteerRad * steerFactor;
    this.steerAngle += (targetSteer - this.steerAngle) * clamp(10 * stepDt, 0, 1);

    const rayLen = cfg.suspRestLength + cfg.suspMaxTravel;
    let groundedCount = 0;

    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i];
      const localTop = wheel.localPos;
      const worldTop = {
        x: origin.x + quatRotate(rot, localTop).x,
        y: origin.y + quatRotate(rot, localTop).y,
        z: origin.z + quatRotate(rot, localTop).z,
      };
      const down = quatRotate(rot, { x: 0, y: -1, z: 0 });
      const ray = new RAPIER.Ray(worldTop, down);
      const hit = world.castRay(ray, rayLen, true, undefined, undefined, undefined, this.body);

      if (!hit) {
        wheel.grounded = false;
        wheel.prevCompression = 0;
        continue;
      }

      const dist = hit.timeOfImpact;
      const compression = clamp(cfg.suspRestLength - dist, 0, cfg.suspMaxTravel);
      const compressionVel = (compression - wheel.prevCompression) / stepDt;
      wheel.prevCompression = compression;
      wheel.grounded = true;
      groundedCount++;

      // Spring + damper along suspension (world up from ray normal approx -down)
      const springF = compression * cfg.springStiffness;
      const dampF = compressionVel * cfg.springDamping;
      const suspForce = Math.max(0, springF + dampF);
      const forceDir = { x: -down.x, y: -down.y, z: -down.z };
      this.body.addForceAtPoint(
        {
          x: forceDir.x * suspForce,
          y: forceDir.y * suspForce,
          z: forceDir.z * suspForce,
        },
        worldTop,
        true,
      );

      // Contact point
      const contact = {
        x: worldTop.x + down.x * dist,
        y: worldTop.y + down.y * dist,
        z: worldTop.z + down.z * dist,
      };

      // Wheel forward in world (steer front)
      const steer = wheel.isFront ? this.steerAngle : 0;
      const localFwd = {
        x: Math.sin(steer),
        y: 0,
        z: Math.cos(steer),
      };
      const localRight = {
        x: Math.cos(steer),
        y: 0,
        z: -Math.sin(steer),
      };
      const wFwd = quatRotate(rot, localFwd);
      const wRight = quatRotate(rot, localRight);

      // Velocity at contact (lin + ang x r)
      const rx = contact.x - origin.x;
      const ry = contact.y - origin.y;
      const rz = contact.z - origin.z;
      const velAt = {
        x: linvel.x + (angvel.y * rz - angvel.z * ry),
        y: linvel.y + (angvel.z * rx - angvel.x * rz),
        z: linvel.z + (angvel.x * ry - angvel.y * rx),
      };

      const vLong = velAt.x * wFwd.x + velAt.y * wFwd.y + velAt.z * wFwd.z;
      const vLat = velAt.x * wRight.x + velAt.y * wRight.y + velAt.z * wRight.z;

      // Drive / brake along forward (AWD: split engine force across wheels)
      const wheelCount = this.wheels.length;
      let drive = 0;
      if (input.brake > 0.1) {
        // Brake: oppose longitudinal velocity (per-wheel share of total brake)
        drive = -clamp(vLong, -1, 1) * (cfg.brakeForce / wheelCount) * input.brake;
      } else {
        // Engine: signed throttle (negative = reverse); total ≈ engineForce
        drive = input.throttle * (cfg.engineForce / wheelCount);
      }

      // Lateral friction (oppose side slip)
      let lat = -vLat * cfg.tireGripLat * (cfg.massKg / 4) * 8;

      // Longitudinal friction / drive blend
      let lon = drive;
      // Damping rolling when no input
      if (Math.abs(input.throttle) < 0.05 && input.brake < 0.1) {
        lon += -vLong * cfg.tireGripLong * 200;
      }

      // Friction ellipse clamp: normalize into unit ellipse, scale back only by 1/mag
      // (lat/mag already equals (latN/mag)*maxLat — do NOT multiply maxLat again)
      if (cfg.frictionEllipse) {
        const maxLat = cfg.tireGripLat * suspForce;
        const maxLon = cfg.tireGripLong * Math.max(suspForce, 1);
        const latN = lat / (maxLat || 1);
        const lonN = lon / (maxLon || 1);
        const mag = Math.hypot(latN, lonN);
        if (mag > 1) {
          const scale = 1 / mag;
          lat *= scale;
          lon *= scale;
        }
      }

      this.body.addForceAtPoint(
        {
          x: wFwd.x * lon + wRight.x * lat,
          y: wFwd.y * lon + wRight.y * lat,
          z: wFwd.z * lon + wRight.z * lat,
        },
        contact,
        true,
      );
    }

    // Soft anti-roll: damp local roll rate when airborne wheels uneven (simple angvel damp on Z in chassis)
    if (groundedCount >= 2) {
      const localAng = quatRotate(
        { x: -rot.x, y: -rot.y, z: -rot.z, w: rot.w },
        angvel,
      );
      // torque around local Z (roll) damping
      const rollDamp = -localAng.z * 800;
      const rollAxis = quatRotate(rot, { x: 0, y: 0, z: 1 });
      this.body.addTorque(
        {
          x: rollAxis.x * rollDamp,
          y: rollAxis.y * rollDamp,
          z: rollAxis.z * rollDamp,
        },
        true,
      );
    }
  }
}
