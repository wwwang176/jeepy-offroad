import { describe, expect, it } from "vitest";
import {
  computeDriveForces,
  computeFlatTermSpeedsMps,
  DRIVE_RANGES,
  linearDampingDragN,
  solveFlatThrottleTermSpeedMps,
  toggleDriveRange,
  torqueAvailable,
} from "@/shared/driveTrain";
import { VEHICLE_CONFIG } from "@/shared/vehicleConfig";

const mass = VEHICLE_CONFIG.massKg;
const damp = VEHICLE_CONFIG.chassisLinearDamping;

const baseCmd = {
  wheelCount: 4,
  baseBrakeForce: 12000,
  rapierBrakeScale: 0.4,
} as const;

describe("driveTrain torque curves (4H / 4L)", () => {
  it("toggles transfer case H ↔ L", () => {
    expect(toggleDriveRange("H")).toBe("L");
    expect(toggleDriveRange("L")).toBe("H");
  });

  it("4L peak at rest is much higher than 4H", () => {
    const h = torqueAvailable(0, "H");
    const l = torqueAvailable(0, "L");
    expect(h).toBe(DRIVE_RANGES.H.peakForce);
    expect(l).toBe(DRIVE_RANGES.L.peakForce);
    expect(l / h).toBeGreaterThan(2);
  });

  it("available torque falls to zero at each range vMax", () => {
    expect(torqueAvailable(DRIVE_RANGES.H.vMax, "H")).toBe(0);
    expect(torqueAvailable(DRIVE_RANGES.L.vMax, "L")).toBe(0);
  });

  it("full throttle maps through the curve into per-wheel engine force", () => {
    const vTerm = solveFlatThrottleTermSpeedMps("L", mass, damp);
    const atRest = computeDriveForces({
      speed: 0,
      throttle: 1,
      brake: 0,
      range: "L",
      flatTermSpeedMps: vTerm,
      ...baseCmd,
      rapierBrakeScale: 0.02,
    });
    expect(atRest.enginePerWheel).toBeCloseTo(DRIVE_RANGES.L.peakForce / 4, 5);
    expect(atRest.brakePerWheel).toBe(0);
    expect(atRest.serviceBraking).toBe(false);
  });
});

describe("flat V_term (mass × linearDamping)", () => {
  it("solves torqueAvailable(v) = m * d * v for both ranges", () => {
    const terms = computeFlatTermSpeedsMps(mass, damp);
    // 4H ≈ 75.6 km/h, 4L ≈ 33.4 km/h with current params
    expect(terms.H).toBeGreaterThan(20);
    expect(terms.H).toBeLessThan(22);
    expect(terms.H * 3.6).toBeCloseTo(75.6, 0);

    expect(terms.L).toBeGreaterThan(9);
    expect(terms.L).toBeLessThan(9.5);
    expect(terms.L * 3.6).toBeCloseTo(33.4, 0);

    for (const range of ["H", "L"] as const) {
      const v = terms[range];
      const avail = torqueAvailable(v, range);
      const drag = linearDampingDragN(mass, damp, v);
      expect(avail).toBeCloseTo(drag, 0);
      expect(v).toBeLessThan(DRIVE_RANGES[range].vMax);
    }
  });

  it("returns vMax when damping is zero", () => {
    expect(solveFlatThrottleTermSpeedMps("L", mass, 0)).toBe(
      DRIVE_RANGES.L.vMax,
    );
  });
});

describe("overspeed engine brake (檔煞)", () => {
  const vTermL = solveFlatThrottleTermSpeedMps("L", mass, damp);
  const vTermH = solveFlatThrottleTermSpeedMps("H", mass, damp);

  it("4H never engine-brakes (gain 0)", () => {
    const f = computeDriveForces({
      speed: vTermH + 5,
      throttle: 0,
      brake: 0,
      range: "H",
      flatTermSpeedMps: vTermH,
      ...baseCmd,
    });
    expect(f.engineBrakePerWheel).toBe(0);
    expect(f.serviceBraking).toBe(false);
  });

  it("4L freewheels at and below flat V_term", () => {
    for (const speed of [0, vTermL * 0.5, vTermL]) {
      const f = computeDriveForces({
        speed,
        throttle: 0,
        brake: 0,
        range: "L",
        flatTermSpeedMps: vTermL,
        ...baseCmd,
      });
      expect(f.engineBrakePerWheel).toBe(0);
      expect(f.serviceBraking).toBe(false);
    }
  });

  it("4L overspeed brake ∝ (|v| - V_term), no serviceBraking", () => {
    const over1 = 1;
    const over2 = 2;
    const a = computeDriveForces({
      speed: vTermL + over1,
      throttle: 0,
      brake: 0,
      range: "L",
      flatTermSpeedMps: vTermL,
      ...baseCmd,
    });
    const b = computeDriveForces({
      speed: vTermL + over2,
      throttle: 0,
      brake: 0,
      range: "L",
      flatTermSpeedMps: vTermL,
      ...baseCmd,
    });
    expect(a.engineBrakePerWheel).toBeGreaterThan(0);
    expect(a.serviceBrakePerWheel).toBe(0);
    expect(a.serviceBraking).toBe(false);
    expect(b.engineBrakePerWheel).toBeCloseTo(a.engineBrakePerWheel * 2, 5);
    expect(a.brakePerWheel).toBeCloseTo(
      a.serviceBrakePerWheel + a.engineBrakePerWheel,
      8,
    );
    // gain * overshoot * scale / wheels
    expect(a.engineBrakePerWheel).toBeCloseTo(
      (DRIVE_RANGES.L.engineBrakeGain * over1 * baseCmd.rapierBrakeScale) /
        baseCmd.wheelCount,
      5,
    );
  });

  it("4L reverse overspeed also engine-brakes", () => {
    const f = computeDriveForces({
      speed: -(vTermL + 1.5),
      throttle: 0,
      brake: 0,
      range: "L",
      flatTermSpeedMps: vTermL,
      ...baseCmd,
    });
    expect(f.engineBrakePerWheel).toBeGreaterThan(0);
    expect(f.serviceBraking).toBe(false);
  });

  it("4L full throttle past V_term still engine-brakes (downhill governor)", () => {
    const f = computeDriveForces({
      speed: vTermL + 2,
      throttle: 1,
      brake: 0,
      range: "L",
      flatTermSpeedMps: vTermL,
      ...baseCmd,
    });
    expect(f.enginePerWheel).toBeGreaterThanOrEqual(0);
    expect(f.engineBrakePerWheel).toBeGreaterThan(0);
    expect(f.serviceBraking).toBe(false);
  });

  it("opposite throttle is serviceBraking, not only 檔煞", () => {
    const f = computeDriveForces({
      speed: 6,
      throttle: -1,
      brake: 0,
      range: "L",
      flatTermSpeedMps: vTermL,
      ...baseCmd,
    });
    expect(f.serviceBraking).toBe(true);
    expect(f.serviceBrakePerWheel).toBeGreaterThan(0);
    // May also have engine-brake if 6 > vTerm (~9.3? 6 < 9.3 so no)
    expect(f.engineBrakePerWheel).toBe(0);
  });

  it("service brake lights intent even when also overspeed", () => {
    const f = computeDriveForces({
      speed: vTermL + 3,
      throttle: 0,
      brake: 1,
      range: "L",
      flatTermSpeedMps: vTermL,
      ...baseCmd,
    });
    expect(f.serviceBraking).toBe(true);
    expect(f.serviceBrakePerWheel).toBeGreaterThan(0);
    expect(f.engineBrakePerWheel).toBeGreaterThan(0);
  });

  it("engine-brake scales with rapierBrakeScale", () => {
    const a = computeDriveForces({
      speed: vTermL + 1,
      throttle: 0,
      brake: 0,
      range: "L",
      flatTermSpeedMps: vTermL,
      wheelCount: 4,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.2,
    });
    const b = computeDriveForces({
      speed: vTermL + 1,
      throttle: 0,
      brake: 0,
      range: "L",
      flatTermSpeedMps: vTermL,
      wheelCount: 4,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.4,
    });
    expect(b.engineBrakePerWheel).toBeCloseTo(a.engineBrakePerWheel * 2, 5);
  });
});
