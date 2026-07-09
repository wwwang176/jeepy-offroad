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
  suspRestLength: 0.45,
  suspMaxTravel: 0.25,
  /** ~1.2–1.5 Hz natural frequency for 1400 kg / 4 wheels — avoid launch spikes. */
  springStiffness: 32000,
  springDamping: 2800,
  /** Cap per-wheel suspension force (N) so first-contact damper cannot rocket the chassis. */
  maxSuspForce: 1400 * 9.81 * 2.0,
  engineForce: 9000,
  brakeForce: 12000,
  maxSteerRad: (32 * Math.PI) / 180,
  tireGripLong: 1.1,
  tireGripLat: 1.0,
  frictionEllipse: true,
  /** Body collider friction kept low so raycast suspension carries load. */
  chassisFriction: 0.15,
  wheelRadius: 0.35,
} as const;

/**
 * Chassis center Y for spawn/respawn given ground sample Y.
 * Sits near rest length with light preload so rays hit without deep penetration.
 */
export function chassisSpawnY(groundY: number): number {
  const attachY = VEHICLE_CONFIG.wheelPositions[0].y;
  // COM = ground - attachY + rest * 0.92 (light preload; avoid burying chassis in terrain)
  return groundY - attachY + VEHICLE_CONFIG.suspRestLength * 0.92;
}

export type VehicleConfig = typeof VEHICLE_CONFIG;
