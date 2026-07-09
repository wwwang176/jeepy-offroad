import { describe, expect, it } from "vitest";
import { assignPathHeights, fallbackPath } from "@/levelgen/path";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { PATH_SAFETY_FACTOR } from "@/levelgen/types";
import { yawToDir } from "@/shared/math";

describe("assignPathHeights", () => {
  it("keeps slopes within safety budget", () => {
    const flat = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 4 },
      { x: 0, y: 0, z: 8 },
      { x: 0, y: 50, z: 12 },
    ];
    const out = assignPathHeights(flat, VEHICLE_CAPABILITIES);
    const limit =
      Math.tan(VEHICLE_CAPABILITIES.maxSlopeRad) * PATH_SAFETY_FACTOR + 1e-6;
    for (let i = 1; i < out.length; i++) {
      const horiz =
        Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z) || 1e-6;
      const dh = Math.abs(out[i].y - out[i - 1].y);
      expect(dh / horiz).toBeLessThanOrEqual(limit);
      expect(dh).toBeLessThanOrEqual(
        VEHICLE_CAPABILITIES.maxStepHeight * PATH_SAFETY_FACTOR + 1e-6,
      );
    }
  });
});

describe("fallbackPath", () => {
  it("uses yaw PI/2 when corridor runs along +X", () => {
    const { startYaw, endYaw, points } = fallbackPath(256, VEHICLE_CAPABILITIES);
    expect(startYaw).toBeCloseTo(Math.PI / 2, 5);
    expect(endYaw).toBeCloseTo(Math.PI / 2, 5);
    const d = yawToDir(startYaw);
    expect(d.x).toBeCloseTo(1, 5);
    expect(points[points.length - 1].x).toBeGreaterThan(points[0].x);
  });
});
