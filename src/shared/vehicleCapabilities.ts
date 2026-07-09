export const VEHICLE_CAPABILITIES = {
  maxSlopeRad: (28 * Math.PI) / 180,
  maxStepHeight: 0.45,
  minTurnRadius: 6.0,
  trackWidth: 1.6,
  wheelBase: 2.4,
  pathClearance: 0.8,
} as const;

export type VehicleCapabilities = typeof VEHICLE_CAPABILITIES;
