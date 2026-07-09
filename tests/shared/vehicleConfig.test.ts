import { describe, expect, it } from "vitest";
import {
  VEHICLE_CONFIG,
  chassisSpawnY,
} from "@/shared/vehicleConfig";

describe("vehicle suspension geometry", () => {
  it("leaves chassis bottom above ground at rest length", () => {
    const attachY = VEHICLE_CONFIG.wheelPositions[0].y;
    const halfY = VEHICLE_CONFIG.chassisHalfExtents.y;
    // Distance from COM to ground at zero compression
    const comAboveGround = -attachY + VEHICLE_CONFIG.suspRestLength;
    const chassisBottomAboveGround = comAboveGround - halfY;
    // Require positive ride height so body is not the primary support
    expect(chassisBottomAboveGround).toBeGreaterThan(0.12);
  });

  it("chassisSpawnY places COM above rest contact with clearance", () => {
    const groundY = 10;
    const comY = chassisSpawnY(groundY);
    const attachY = VEHICLE_CONFIG.wheelPositions[0].y;
    const distToGround = comY + attachY - groundY;
    // Spawn slightly compressed vs full rest (0.88 factor)
    expect(distToGround).toBeCloseTo(
      VEHICLE_CONFIG.suspRestLength * 0.88,
      5,
    );
    const bottomClearance =
      comY - VEHICLE_CONFIG.chassisHalfExtents.y - groundY;
    expect(bottomClearance).toBeGreaterThan(0.05);
  });
});
