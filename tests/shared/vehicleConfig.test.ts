import { describe, expect, it } from "vitest";
import {
  VEHICLE_CONFIG,
  chassisSpawnY,
} from "@/shared/vehicleConfig";

describe("vehicle suspension geometry", () => {
  it("places ray origins outside the chassis cuboid", () => {
    const halfY = VEHICLE_CONFIG.chassisHalfExtents.y;
    for (const w of VEHICLE_CONFIG.wheelPositions) {
      // Strictly below chassis bottom so solid/self casts cannot start inside
      expect(w.y).toBeLessThan(-halfY);
    }
  });

  it("leaves chassis bottom above ground at rest length", () => {
    const attachY = VEHICLE_CONFIG.wheelPositions[0].y;
    const halfY = VEHICLE_CONFIG.chassisHalfExtents.y;
    const comAboveGround = -attachY + VEHICLE_CONFIG.suspRestLength;
    const chassisBottomAboveGround = comAboveGround - halfY;
    expect(chassisBottomAboveGround).toBeGreaterThan(0.02);
  });

  it("chassisSpawnY places COM above rest contact with clearance", () => {
    const groundY = 10;
    const comY = chassisSpawnY(groundY);
    const attachY = VEHICLE_CONFIG.wheelPositions[0].y;
    const distToGround = comY + attachY - groundY;
    expect(distToGround).toBeCloseTo(
      VEHICLE_CONFIG.suspRestLength * 0.92,
      5,
    );
    const bottomClearance =
      comY - VEHICLE_CONFIG.chassisHalfExtents.y - groundY;
    expect(bottomClearance).toBeGreaterThan(0.02);
  });
});
