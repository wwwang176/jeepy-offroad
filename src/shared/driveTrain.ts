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
  /**
   * Overspeed engine-brake gain (N per m/s above flat V_term), before
   * rapierBrakeScale. 0 = disabled (4H). Applied via setWheelBrake when
   * |speed| > flatTermSpeed; does not set serviceBraking (no brake lamps).
   */
  engineBrakeGain: number;
  /** Multiplier on service brake only (opposite-throttle or explicit brake). */
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
    // Future-ready: same V_term solver; gain 0 = no 檔煞 yet
    engineBrakeGain: 0,
    brakeScale: 1,
  },
  L: {
    label: "4L",
    // ~2.4× launch torque for ~28°+ grades without needing global force buffs
    peakForce: 22000,
    vMax: 10,
    // Stay strong through crawl band, then cut hard near low-range redline
    falloffPower: 1.35,
    // N per (m/s) over flat full-throttle term (~33 km/h); scale with overshoot
    engineBrakeGain: 4500,
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
  /**
   * Flat full-throttle terminal speed for this range (m/s), computed once
   * at session start via solveFlatThrottleTermSpeedMps. Required for 檔煞.
   */
  flatTermSpeedMps: number;
}

export interface DriveForces {
  enginePerWheel: number;
  /**
   * Total wheel brake for Rapier (= service + engine-brake).
   * Invariant: serviceBrakePerWheel + engineBrakePerWheel.
   */
  brakePerWheel: number;
  /** Explicit / opposite-throttle component only. */
  serviceBrakePerWheel: number;
  /** Overspeed 檔煞 component (0 at or below flat V_term). */
  engineBrakePerWheel: number;
  /**
   * Driver service-brake intent — brake lamps should follow this, not
   * engine-brake (檔煞 must not light the lights).
   */
  serviceBraking: boolean;
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
 * Linear drag proxy matching Rapier-style linear damping:
 * F ≈ mass × linearDamping × |speed|.
 */
export function linearDampingDragN(
  massKg: number,
  linearDamping: number,
  speedMps: number,
): number {
  return Math.max(0, massKg) * Math.max(0, linearDamping) * Math.abs(speedMps);
}

/**
 * Flat full-throttle terminal speed (m/s): solve
 *   torqueAvailable(v, range) = mass × linearDamping × v
 * once at session start (not per frame). Same API for H and L.
 *
 * Binary search on (0, vMax). If damping ≤ 0, returns vMax.
 */
export function solveFlatThrottleTermSpeedMps(
  range: DriveRange,
  massKg: number,
  linearDamping: number,
): number {
  const cfg = DRIVE_RANGES[range];
  const vMax = cfg.vMax;
  if (vMax <= 0) return 0;
  if (massKg <= 0 || linearDamping <= 0) return vMax;

  const fNet = (v: number): number =>
    torqueAvailable(v, range) - linearDampingDragN(massKg, linearDamping, v);

  // At v→0+, torque → peak > 0, drag → 0 → fNet > 0 (accelerating).
  // At vMax, torque = 0, drag > 0 → fNet < 0. Root in (0, vMax).
  let lo = 0;
  let hi = vMax;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) * 0.5;
    if (fNet(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
}

/** Precompute H/L flat term speeds for a chassis (session start). */
export function computeFlatTermSpeedsMps(
  massKg: number,
  linearDamping: number,
): Record<DriveRange, number> {
  return {
    H: solveFlatThrottleTermSpeedMps("H", massKg, linearDamping),
    L: solveFlatThrottleTermSpeedMps("L", massKg, linearDamping),
  };
}

/**
 * Speed below this (m/s) while holding opposite input switches to reverse/drive
 * instead of staying in brake-only (arcade stop-then-go).
 */
export const OPPOSITE_BRAKE_SPEED_EPS = 0.55;

/** |throttle| below this counts as no drive torque. */
export const COAST_THROTTLE_EPS = 0.05;

/**
 * Map throttle/brake/range/speed → per-wheel engine + brake for Rapier.
 *
 * - Below flat V_term: normal drive / freewheel coast
 * - |speed| > flat V_term and engineBrakeGain > 0: 檔煞 ∝ overshoot (no lamps)
 * - Opposite throttle / explicit brake: service brake (lamps on)
 */
export function computeDriveForces(cmd: DriveCommand): DriveForces {
  const cfg = DRIVE_RANGES[cmd.range];
  const n = Math.max(1, cmd.wheelCount);
  const rapierBrakeScale = cmd.rapierBrakeScale ?? 0.08;
  const available = torqueAvailable(cmd.speed, cmd.range);
  const throttle = clamp(cmd.throttle, -1, 1);
  const speed = cmd.speed;
  const absSpeed = Math.abs(speed);
  const vTerm = Math.max(0, cmd.flatTermSpeedMps);

  let engineTotal = 0;
  let serviceBrakeTotal = 0;
  let engineBrakeTotal = 0;

  const explicitBrake = cmd.brake > 0.1;
  const oppositeThrottle =
    Math.abs(throttle) > COAST_THROTTLE_EPS &&
    absSpeed > OPPOSITE_BRAKE_SPEED_EPS &&
    Math.sign(throttle) !== Math.sign(speed);

  const serviceBraking = explicitBrake || oppositeThrottle;

  if (serviceBraking) {
    const brakeAmt = explicitBrake ? clamp(cmd.brake, 0, 1) : 1;
    serviceBrakeTotal =
      cmd.baseBrakeForce * cfg.brakeScale * brakeAmt * rapierBrakeScale;
  } else if (Math.abs(throttle) > COAST_THROTTLE_EPS) {
    engineTotal = throttle * available;
  }

  // Overspeed 檔煞 (deadzone 0): only when gain > 0 and past flat term
  if (cfg.engineBrakeGain > 0 && absSpeed > vTerm) {
    const overshoot = absSpeed - vTerm;
    engineBrakeTotal =
      cfg.engineBrakeGain * overshoot * rapierBrakeScale;
  }

  const brakeTotal = serviceBrakeTotal + engineBrakeTotal;

  return {
    enginePerWheel: engineTotal / n,
    brakePerWheel: brakeTotal / n,
    serviceBrakePerWheel: serviceBrakeTotal / n,
    engineBrakePerWheel: engineBrakeTotal / n,
    serviceBraking,
    availableEngineForce: available,
    label: cfg.label,
    range: cmd.range,
  };
}

export function toggleDriveRange(current: DriveRange): DriveRange {
  return current === "H" ? "L" : "H";
}
