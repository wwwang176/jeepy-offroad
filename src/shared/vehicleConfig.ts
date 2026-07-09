import { VEHICLE_CAPABILITIES } from "./vehicleCapabilities";

const tw = VEHICLE_CAPABILITIES.trackWidth;
const wb = VEHICLE_CAPABILITIES.wheelBase;
const hx = tw / 2;
const hz = wb / 2;

export const VEHICLE_CONFIG = {
  massKg: 1400,
  chassisHalfExtents: { x: 0.9, y: 0.45, z: 1.3 },
  wheelPositions: [
    { x: -hx, y: 0.1, z: hz },
    { x: hx, y: 0.1, z: hz },
    { x: -hx, y: 0.1, z: -hz },
    { x: hx, y: 0.1, z: -hz },
  ],
  suspRestLength: 0.55,
  suspMaxTravel: 0.25,
  springStiffness: 42000,
  springDamping: 4500,
  engineForce: 9000,
  brakeForce: 12000,
  maxSteerRad: (32 * Math.PI) / 180,
  tireGripLong: 1.1,
  tireGripLat: 1.0,
  frictionEllipse: true,
} as const;

export type VehicleConfig = typeof VEHICLE_CONFIG;
