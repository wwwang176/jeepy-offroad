import { describe, expect, it } from "vitest";
import {
  VEHICLE_CONFIG,
  chassisSpawnY,
} from "@/shared/vehicleConfig";

describe("vehicle suspension geometry", () => {
  it("places ray origins outside the lower chassis cuboid", () => {
    const halfY = VEHICLE_CONFIG.chassisHalfExtents.y;
    for (const w of VEHICLE_CONFIG.wheelPositions) {
      // Strictly below chassis bottom so solid/self casts cannot start inside
      expect(w.y).toBeLessThan(-halfY);
    }
  });

  it("places ray origins outside the cabin cuboid as well", () => {
    const cabin = VEHICLE_CONFIG.cabinCollider;
    const cabinBottom = cabin.center.y - cabin.halfExtents.y;
    for (const w of VEHICLE_CONFIG.wheelPositions) {
      expect(w.y).toBeLessThan(cabinBottom);
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
      VEHICLE_CONFIG.suspRestLength * VEHICLE_CONFIG.spawnRestFactor,
      5,
    );
    const bottomClearance =
      comY - VEHICLE_CONFIG.chassisHalfExtents.y - groundY;
    expect(bottomClearance).toBeGreaterThan(0.02);
  });

  it("lower body extents roughly match JeepMesh envelope", () => {
    // bodyW 1.72, rocker ~2.6 long — collider should not be the old short box
    expect(VEHICLE_CONFIG.chassisHalfExtents.x).toBeGreaterThanOrEqual(0.85);
    expect(VEHICLE_CONFIG.chassisHalfExtents.z).toBeGreaterThanOrEqual(1.3);
    const cabinTop =
      VEHICLE_CONFIG.cabinCollider.center.y +
      VEHICLE_CONFIG.cabinCollider.halfExtents.y;
    // Hardtop visual roof ≈ 1.42
    expect(cabinTop).toBeGreaterThan(1.2);
  });

  it("cabin sits above COM origin (shape offset, mass stays low on tub)", () => {
    // Policy: cabin is collision offset only; COM policy documented as body origin.
    expect(VEHICLE_CONFIG.cabinCollider.center.y).toBeGreaterThan(
      VEHICLE_CONFIG.chassisHalfExtents.y,
    );
  });
});
