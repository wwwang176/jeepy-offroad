import { describe, expect, it } from "vitest";
import {
  classifyTrackSurface,
  trackDepositStrength,
  trackHalfWidth,
  trackMarkColor,
  trackMinSpacing,
  trackSegmentLife,
  trackSpawnAlpha,
} from "@/shared/tireTrackMath";

describe("classifyTrackSurface", () => {
  it("prefers wet over path", () => {
    expect(classifyTrackSurface(1, 0.5)).toBe("wet");
    expect(classifyTrackSurface(0.8, 0)).toBe("path");
    expect(classifyTrackSurface(0, 0)).toBe("mud");
  });

  it("classifies snow when coverage is high", () => {
    expect(classifyTrackSurface(0, 0, 0.5)).toBe("snow");
    expect(classifyTrackSurface(0.9, 0, 0.5)).toBe("snow");
    expect(classifyTrackSurface(0.9, 0.5, 0.9)).toBe("wet");
  });
});

describe("trackDepositStrength", () => {
  it("is zero when airborne, wet, or nearly stopped", () => {
    expect(
      trackDepositStrength({
        grounded: false,
        speedMps: 10,
        throttle: 1,
        brake: 0,
        lateralAbsMps: 0,
        surface: "mud",
      }),
    ).toBe(0);
    expect(
      trackDepositStrength({
        grounded: true,
        speedMps: 10,
        throttle: 1,
        brake: 0,
        lateralAbsMps: 0,
        surface: "wet",
      }),
    ).toBe(0);
    expect(
      trackDepositStrength({
        grounded: true,
        speedMps: 0.1,
        throttle: 0,
        brake: 0,
        lateralAbsMps: 0,
        surface: "mud",
      }),
    ).toBe(0);
  });

  it("is stronger for brake/slip and mud vs path", () => {
    const roll = trackDepositStrength({
      grounded: true,
      speedMps: 6,
      throttle: 0,
      brake: 0,
      lateralAbsMps: 0,
      surface: "mud",
    });
    const brake = trackDepositStrength({
      grounded: true,
      speedMps: 6,
      throttle: 0,
      brake: 1,
      lateralAbsMps: 0,
      surface: "mud",
    });
    const slip = trackDepositStrength({
      grounded: true,
      speedMps: 6,
      throttle: 0,
      brake: 0,
      lateralAbsMps: 5,
      surface: "mud",
    });
    const path = trackDepositStrength({
      grounded: true,
      speedMps: 6,
      throttle: 0,
      brake: 1,
      lateralAbsMps: 0,
      surface: "path",
    });
    expect(brake).toBeGreaterThan(roll);
    expect(slip).toBeGreaterThan(roll);
    expect(path).toBeLessThan(brake);
  });
});

describe("trackHalfWidth / color / life", () => {
  it("widens with strength and mud", () => {
    const pathW = trackHalfWidth({
      strength: 0.5,
      surface: "path",
      lateralAbsMps: 0,
    });
    const mudW = trackHalfWidth({
      strength: 0.5,
      surface: "mud",
      lateralAbsMps: 0,
    });
    const slipW = trackHalfWidth({
      strength: 0.5,
      surface: "mud",
      lateralAbsMps: 5,
    });
    expect(mudW).toBeGreaterThan(pathW);
    expect(slipW).toBeGreaterThan(mudW);
  });

  it("marks are mid coffee tones (readable, not black)", () => {
    const ground = { r: 0.7, g: 0.6, b: 0.45 };
    const c = trackMarkColor("mud", ground, 0.8);
    expect(c.r).toBeGreaterThan(0.12);
    expect(c.r).toBeLessThan(0.5);
    expect(c.r).toBeLessThan(ground.r);
    expect(c.g).toBeLessThan(c.r + 0.08);
  });

  it("snow marks are cool blue-grey, not coffee mud", () => {
    const c = trackMarkColor("snow", { r: 0.5, g: 0.5, b: 0.5 }, 0.7);
    expect(c.b).toBeGreaterThan(c.r);
    expect(c.r).toBeGreaterThan(0.4);
    expect(c.r).toBeLessThan(0.85);
  });

  it("mud lasts longer than path", () => {
    expect(trackSegmentLife("mud", 0.5)).toBeGreaterThan(
      trackSegmentLife("path", 0.5),
    );
  });

  it("spawn alpha rises with strength", () => {
    expect(trackSpawnAlpha(1, "mud")).toBeGreaterThan(
      trackSpawnAlpha(0.2, "mud"),
    );
  });

  it("spacing stays in a sane band", () => {
    expect(trackMinSpacing(0)).toBeGreaterThanOrEqual(0.14);
    expect(trackMinSpacing(30)).toBeLessThanOrEqual(0.45);
  });
});
