import { VEHICLE_CAPABILITIES } from "./vehicleCapabilities";

const tw = VEHICLE_CAPABILITIES.trackWidth;
const wb = VEHICLE_CAPABILITIES.wheelBase;
const hx = tw / 2;
const hz = wb / 2;

/**
 * Suspension / mass geometry (local chassis space):
 * - Body origin (0,0,0) = lower-tub geometric center (mesh / colliders / wheels)
 * - Physical COM is pinned near the tub underside (see `centerOfMassLocal`)
 * - Wheel hardpoints sit just below the chassis underside (negative Y)
 * - Rest length reaches the ground with chassis bottom still clear of terrain
 *
 * At rest (compression ~0): ground is at attachY - restLength below body origin.
 * Chassis bottom = -chassisHalfExtents.y. Require:
 *   -attachY + restLength > chassisHalfExtents.y  (positive ground clearance)
 *
 * Visual alignment (JeepMesh low-poly Rubicon):
 * - body width ≈ 1.72 → halfX ≈ 0.86
 * - rocker length ≈ 2.6, bumper≈+1.4 / rear≈-1.3 → halfZ ≈ 1.35
 * - tub+doors roughly y∈[-0.35, 0.45]; cabin/hardtop y∈[0.45, 1.42]
 * Wheel attach must stay strictly outside every chassis cuboid.
 */
const CHASSIS_HALF_EXTENTS = { x: 0.88, y: 0.4, z: 1.35 } as const;

export const VEHICLE_CONFIG = {
  massKg: 1400,
  /**
   * Lower body / tub collider (shape centered on body origin).
   * Matched to JeepMesh body envelope, not the tall hardtop.
   */
  chassisHalfExtents: CHASSIS_HALF_EXTENTS,
  /**
   * Mass center in chassis local space (Rapier mass props, not body origin).
   * Pinned at the tub underside / rocker height so the jeep sits heavy and
   * resists tip on grades — approx. lower edge of the body collider.
   */
  centerOfMassLocal: {
    x: 0,
    y: -CHASSIS_HALF_EXTENTS.y,
    z: 0,
  },
  /**
   * Upper cabin / hardtop collider (local offset from body origin).
   * Collision shape only — mass is 0 so cabin volume does not raise COM.
   * Covers greenhouse so rocks/trees hit the cabin, not only the lower box.
   */
  cabinCollider: {
    halfExtents: { x: 0.84, y: 0.48, z: 1.0 },
    /** Center of cabin box in chassis local space. */
    center: { x: 0, y: 0.9, z: -0.12 },
  },
  /**
   * Suspension ray origins (chassis local).
   * May sit slightly inside the tub Y-range: rays only hit terrain
   * (SUSPENSION_RAY_GROUPS), never the chassis — so no self-hit launch.
   * Higher hardpoints + shorter rest = lower stance without stilts.
   */
  wheelPositions: [
    { x: -hx, y: -0.14, z: hz },
    { x: hx, y: -0.14, z: hz },
    { x: -hx, y: -0.14, z: -hz },
    { x: hx, y: -0.14, z: -hz },
  ],
  /**
   * Rapier suspension rest length: hardpoint → **wheel center** (not ground).
   * Chassis-bottom clearance target ≈ 0.5 m at rest:
   *   clearance = -attachY + rest + radius - chassisHalfY
   * When radius grows, rest shrinks so clearance holds.
   * Damper coeffs stay independent of rest length.
   */
  suspRestLength: 0.344,
  /**
   * Travel about rest (compress + droop). Must stay ≤ rest so min length ≥ 0.
   * Damper coeffs below are unchanged.
   */
  suspMaxTravel: 0.28,
  /** Legacy SI-ish spring (unused by Rapier vehicle controller; kept for docs/tests). */
  springStiffness: 28000,
  springDamping: 3200,
  /** Cap per-wheel suspension force (N). */
  maxSuspForce: 1400 * 9.81 * 2.4,
  /**
   * Rapier/Bullet-style suspension (DynamicRayCastVehicleController).
   * Damping feel lives here — leave alone when only changing ride height.
   */
  rapierSuspStiffness: 24,
  rapierSuspCompression: 4.2,
  rapierSuspRelaxation: 5.0,
  rapierFrictionSlip: 4.2,
  /**
   * Legacy peak engine force (N) — equals 4H peak.
   * Prefer `DRIVE_RANGES` / `computeDriveForces` for drive torque curves.
   */
  engineForce: 9000,
  brakeForce: 12000,
  /**
   * Rapier setWheelBrake scale on total brake force.
   * 0.02 was far too weak (~0.17 m/s²); 0.4 ≈ firm service brakes.
   */
  rapierBrakeScale: 0.4,
  maxSteerRad: (32 * Math.PI) / 180,
  tireGripLong: 1.1,
  tireGripLat: 1.0,
  frictionEllipse: true,
  /** Body collider friction kept low so raycast suspension carries load. */
  chassisFriction: 0.15,
  /**
   * Physics tire radius (m). +30% vs 0.32 → 0.416; rest adjusted so
   * chassis-bottom clearance stays ~0.5 m.
   */
  wheelRadius: 0.416,
  /** Spawn compression factor: lower = more preload = settles into contact faster. */
  spawnRestFactor: 0.88,
} as const;

/**
 * Chassis center Y for spawn/respawn given ground sample Y.
 *
 * Rapier: contact is hardpoint − rest − radius (rest = hardpoint→wheel center).
 * Slight preload on rest so suspension starts in the contact band.
 */
export function chassisSpawnY(groundY: number): number {
  const attachY = VEHICLE_CONFIG.wheelPositions[0].y;
  const rest =
    VEHICLE_CONFIG.suspRestLength * VEHICLE_CONFIG.spawnRestFactor;
  return groundY - attachY + rest + VEHICLE_CONFIG.wheelRadius;
}

export type VehicleConfig = typeof VEHICLE_CONFIG;

/**
 * Principal inertia of a solid box (half-extents `he`) of mass `m`,
 * about the given local COM (parallel-axis shift from the box center).
 */
export function chassisPrincipalInertia(
  mass: number,
  he: { x: number; y: number; z: number },
  comLocal: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  // Solid box about geometric center: I = m/12 * (full_a² + full_b²) = m/3 * (ha² + hb²)
  const ixx0 = (mass / 3) * (he.y * he.y + he.z * he.z);
  const iyy0 = (mass / 3) * (he.x * he.x + he.z * he.z);
  const izz0 = (mass / 3) * (he.x * he.x + he.y * he.y);
  // I_com = I_center + m (|r|² E − r⊗r) with r = center − com = −comLocal
  // ⇒ I_com_ii = I0_ii + m (r_j² + r_k²)
  const rx = -comLocal.x;
  const ry = -comLocal.y;
  const rz = -comLocal.z;
  return {
    x: ixx0 + mass * (ry * ry + rz * rz),
    y: iyy0 + mass * (rx * rx + rz * rz),
    z: izz0 + mass * (rx * rx + ry * ry),
  };
}
