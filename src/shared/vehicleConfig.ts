import { VEHICLE_CAPABILITIES } from "./vehicleCapabilities";

const tw = VEHICLE_CAPABILITIES.trackWidth;
const wb = VEHICLE_CAPABILITIES.wheelBase;
const hx = tw / 2;
const hz = wb / 2;

/**
 * Suspension geometry (local chassis space):
 * - COM at origin; chassis box half-height `chassisHalfExtents.y`
 * - Wheel hardpoints sit near the chassis underside (negative Y)
 * - Rest length reaches the ground with chassis bottom still clear of terrain
 *
 * At rest (compression ~0): ground is at attachY - restLength below COM.
 * Chassis bottom = -chassisHalfExtents.y. Require:
 *   -attachY + restLength > chassisHalfExtents.y  (positive ground clearance)
 */
export const VEHICLE_CONFIG = {
  massKg: 1400,
  chassisHalfExtents: { x: 0.9, y: 0.4, z: 1.3 },
  /**
   * Suspension ray origins — MUST be outside the chassis cuboid
   * (half-height 0.4 → bottom at y=-0.4). Origins inside the body with
   * solid raycasts yield TOI=0 every frame and launch the vehicle.
   */
  wheelPositions: [
    { x: -hx, y: -0.42, z: hz },
    { x: hx, y: -0.42, z: hz },
    { x: -hx, y: -0.42, z: -hz },
    { x: hx, y: -0.42, z: -hz },
  ],
  /** Distance from hardpoint to contact at zero compression. */
  suspRestLength: 0.52, // was 0.45; +~15% for longer visual spring / travel
  /**
   * Extra travel past rest — longer extension helps wheels stay planted on
   * small bumps / articulation (slightly more "grounded time").
   */
  suspMaxTravel: 0.39, // was 0.34; +~15%
  /** Legacy SI-ish spring (unused by Rapier vehicle controller; kept for docs/tests). */
  springStiffness: 28000,
  springDamping: 3200,
  /** Cap per-wheel suspension force (N). */
  maxSuspForce: 1400 * 9.81 * 2.4,
  /**
   * Rapier/Bullet-style suspension (DynamicRayCastVehicleController).
   * Higher compression/relaxation = less bounce, more time on the ground.
   */
  rapierSuspStiffness: 24,
  rapierSuspCompression: 4.2,
  rapierSuspRelaxation: 5.0,
  rapierFrictionSlip: 4.2,
  engineForce: 9000,
  brakeForce: 12000,
  maxSteerRad: (32 * Math.PI) / 180,
  tireGripLong: 1.1,
  tireGripLat: 1.0,
  frictionEllipse: true,
  /** Body collider friction kept low so raycast suspension carries load. */
  chassisFriction: 0.15,
  wheelRadius: 0.35,
  /** Spawn compression factor: lower = more preload = settles into contact faster. */
  spawnRestFactor: 0.86,
} as const;

/**
 * Chassis center Y for spawn/respawn given ground sample Y.
 * Slight preload so suspension is already in the contact band at spawn.
 */
export function chassisSpawnY(groundY: number): number {
  const attachY = VEHICLE_CONFIG.wheelPositions[0].y;
  return (
    groundY - attachY + VEHICLE_CONFIG.suspRestLength * VEHICLE_CONFIG.spawnRestFactor
  );
}

export type VehicleConfig = typeof VEHICLE_CONFIG;
