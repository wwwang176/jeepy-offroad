import { describe, expect, it } from "vitest";
import {
  computeDriveForces,
  DRIVE_RANGES,
  toggleDriveRange,
  torqueAvailable,
} from "@/shared/driveTrain";

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
    expect(torqueAvailable(DRIVE_RANGES.H.vMax + 5, "H")).toBe(0);
  });

  it("4L still has strong crawl torque at speeds where 4H has already lost a lot", () => {
    // Mid crawl ~5 m/s: low range should still deliver high force
    const crawlSpeed = 5;
    const l = torqueAvailable(crawlSpeed, "L");
    const h = torqueAvailable(crawlSpeed, "H");
    expect(l).toBeGreaterThan(h);
    // 4L should retain a large fraction of peak at crawlSpeed
    expect(l).toBeGreaterThan(DRIVE_RANGES.L.peakForce * 0.35);
  });

  it("4L has near-zero torque past its redline while 4H can still pull", () => {
    const pastLowRedline = DRIVE_RANGES.L.vMax + 0.5;
    expect(torqueAvailable(pastLowRedline, "L")).toBe(0);
    expect(torqueAvailable(pastLowRedline, "H")).toBeGreaterThan(0);
  });

  it("full throttle maps through the curve into per-wheel engine force", () => {
    const n = 4;
    const atRest = computeDriveForces({
      speed: 0,
      throttle: 1,
      brake: 0,
      range: "L",
      wheelCount: n,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.02,
    });
    expect(atRest.enginePerWheel).toBeCloseTo(DRIVE_RANGES.L.peakForce / n, 5);
    expect(atRest.brakePerWheel).toBe(0);
    expect(atRest.label).toBe("4L");

    const atRedline = computeDriveForces({
      speed: DRIVE_RANGES.L.vMax,
      throttle: 1,
      brake: 0,
      range: "L",
      wheelCount: n,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.02,
    });
    expect(atRedline.enginePerWheel).toBe(0);
  });

  it("reverse uses signed throttle on the same curve", () => {
    const f = computeDriveForces({
      speed: 0,
      throttle: -1,
      brake: 0,
      range: "H",
      wheelCount: 4,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.02,
    });
    expect(f.enginePerWheel).toBeCloseTo(-DRIVE_RANGES.H.peakForce / 4, 5);
  });

  it("service brake disables engine and scales with range", () => {
    const h = computeDriveForces({
      speed: 5,
      throttle: 1,
      brake: 1,
      range: "H",
      wheelCount: 4,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.02,
    });
    const l = computeDriveForces({
      speed: 5,
      throttle: 1,
      brake: 1,
      range: "L",
      wheelCount: 4,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.02,
    });
    expect(h.enginePerWheel).toBe(0);
    expect(l.enginePerWheel).toBe(0);
    expect(l.brakePerWheel).toBeGreaterThan(h.brakePerWheel);
  });

  it("coasting applies stronger engine brake in 4L than 4H", () => {
    const h = computeDriveForces({
      speed: 8,
      throttle: 0,
      brake: 0,
      range: "H",
      wheelCount: 4,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.02,
    });
    const l = computeDriveForces({
      speed: 8,
      throttle: 0,
      brake: 0,
      range: "L",
      wheelCount: 4,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.02,
    });
    expect(h.enginePerWheel).toBe(0);
    expect(l.enginePerWheel).toBe(0);
    expect(l.brakePerWheel).toBeGreaterThan(h.brakePerWheel);
    expect(h.brakePerWheel).toBeGreaterThan(0);
  });

  it("static hold needs no engine brake at near-zero speed", () => {
    const f = computeDriveForces({
      speed: 0.1,
      throttle: 0,
      brake: 0,
      range: "L",
      wheelCount: 4,
      baseBrakeForce: 12000,
      rapierBrakeScale: 0.02,
    });
    expect(f.brakePerWheel).toBe(0);
    expect(f.enginePerWheel).toBe(0);
  });
});
