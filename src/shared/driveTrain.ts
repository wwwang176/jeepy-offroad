import { clamp } from "./math";

/** Transfer-case range: High (road) / Low (crawl). */
export type DriveRange = "H" | "L";

export interface DriveRangeConfig {
  /** HUD / debug label, e.g. "4H". */
  label: string;
  /** Peak longitudinal engine force at zero speed (N, total all wheels). */
  peakForce: number;
  /** Speed where available engine torque falls to zero (m/s). */
  vMax: number;
  /**
   * Torque–speed falloff exponent on free factor `t = max(0, 1 - |v|/vMax)`:
   * `available = t ^ falloffPower`.
   * - `> 1`: holds more torque at low/mid crawl, drops harder near vMax
   * - `1`: linear
   * - `< 1`: drops earlier (softer launch)
   */
  falloffPower: number;
  /** Coasting engine-brake force when throttle ~0 (N, total). */
  engineBrakeForce: number;
  /** Multiplier on service brake (W+S). */
  brakeScale: number;
}

/**
 * Jeep-style transfer case: 4H for travel, 4L for steep crawl.
 * Peak force × speed curve (A+B) — not a full multi-ratio gearbox.
 */
export const DRIVE_RANGES: Record<DriveRange, DriveRangeConfig> = {
  H: {
    label: "4H",
    peakForce: 9000,
    vMax: 26,
    falloffPower: 1.1,
    engineBrakeForce: 1600,
    brakeScale: 1,
  },
  L: {
    label: "4L",
    // ~2.4× launch torque for ~28°+ grades without needing global force buffs
    peakForce: 22000,
    vMax: 10,
    // Stay strong through crawl band, then cut hard near low-range redline
    falloffPower: 1.35,
    engineBrakeForce: 4500,
    brakeScale: 1.2,
  },
} as const;

export const DEFAULT_DRIVE_RANGE: DriveRange = "H";

export interface DriveCommand {
  /** Signed chassis-forward speed (m/s), Rapier currentVehicleSpeed. */
  speed: number;
  /** -1..1 throttle (negative = reverse). */
  throttle: number;
  /** 0..1 service brake. */
  brake: number;
  range: DriveRange;
  wheelCount: number;
  /** Base service brake force before range scale (N, total). */
  baseBrakeForce: number;
  /**
   * Rapier setWheelBrake scale (matches VEHICLE_CONFIG.rapierBrakeScale).
   * Kept explicit so drive math stays unit-testable.
   */
  rapierBrakeScale?: number;
}

export interface DriveForces {
  enginePerWheel: number;
  brakePerWheel: number;
  /** Total available engine magnitude before throttle (N). */
  availableEngineForce: number;
  label: string;
  range: DriveRange;
}

/**
 * Torque available at current speed for a range (0 at |speed| >= vMax).
 * Pure function — used by VehicleController and unit tests.
 */
export function torqueAvailable(speed: number, range: DriveRange): number {
  const cfg = DRIVE_RANGES[range];
  const u = clamp(Math.abs(speed) / cfg.vMax, 0, 1);
  const free = Math.max(0, 1 - u);
  return cfg.peakForce * Math.pow(free, cfg.falloffPower);
}

/**
 * Map throttle/brake/range/speed → per-wheel engine + brake for Rapier.
 *
 * - Engine: throttle × torque curve (signed)
 * - Service brake (brake > 0.1): brakes only, no engine
 * - Coast: engine-brake opposing motion (stronger in 4L)
 */
export function computeDriveForces(cmd: DriveCommand): DriveForces {
  const cfg = DRIVE_RANGES[cmd.range];
  const n = Math.max(1, cmd.wheelCount);
  const rapierBrakeScale = cmd.rapierBrakeScale ?? 0.4;
  const available = torqueAvailable(cmd.speed, cmd.range);

  let engineTotal = 0;
  let brakeTotal = 0;

  if (cmd.brake > 0.1) {
    brakeTotal =
      cmd.baseBrakeForce * cfg.brakeScale * clamp(cmd.brake, 0, 1) * rapierBrakeScale;
  } else {
    const throttle = clamp(cmd.throttle, -1, 1);
    if (Math.abs(throttle) > 0.05) {
      engineTotal = throttle * available;
    } else if (Math.abs(cmd.speed) > 0.4) {
      // Engine braking: oppose travel direction (no drive torque while coasting).
      brakeTotal = cfg.engineBrakeForce * rapierBrakeScale;
    }
  }

  return {
    enginePerWheel: engineTotal / n,
    brakePerWheel: brakeTotal / n,
    availableEngineForce: available,
    label: cfg.label,
    range: cmd.range,
  };
}

export function toggleDriveRange(current: DriveRange): DriveRange {
  return current === "H" ? "L" : "H";
}
