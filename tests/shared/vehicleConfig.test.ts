import { describe, expect, it } from "vitest";
import {
  VEHICLE_CONFIG,
  chassisPrincipalInertia,
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

  it("cabin sits above body origin (shape offset, mass stays on tub)", () => {
    // Policy: cabin is collision offset only; mass/COM live on the lower tub.
    expect(VEHICLE_CONFIG.cabinCollider.center.y).toBeGreaterThan(
      VEHICLE_CONFIG.chassisHalfExtents.y,
    );
  });

  it("pins COM at the lower edge of the body tub", () => {
    const he = VEHICLE_CONFIG.chassisHalfExtents;
    const com = VEHICLE_CONFIG.centerOfMassLocal;
    expect(com.x).toBe(0);
    expect(com.z).toBe(0);
    // Underside of lower cuboid (body origin is tub center)
    expect(com.y).toBeCloseTo(-he.y, 5);
    // Still at/above wheel hardpoints so mass isn't below the axles in a weird way
    for (const w of VEHICLE_CONFIG.wheelPositions) {
      expect(com.y).toBeGreaterThanOrEqual(w.y - 0.05);
    }
  });

  it("chassisPrincipalInertia grows when COM is shifted off the geometric center", () => {
    const he = VEHICLE_CONFIG.chassisHalfExtents;
    const m = VEHICLE_CONFIG.massKg;
    const atCenter = chassisPrincipalInertia(m, he, { x: 0, y: 0, z: 0 });
    const atBottom = chassisPrincipalInertia(
      m,
      he,
      VEHICLE_CONFIG.centerOfMassLocal,
    );
    // Pitch/roll inertia (x/z) must increase with vertical COM offset
    expect(atBottom.x).toBeGreaterThan(atCenter.x);
    expect(atBottom.z).toBeGreaterThan(atCenter.z);
    // Yaw about vertical axis through center is unchanged for pure Y shift
    expect(atBottom.y).toBeCloseTo(atCenter.y, 5);
  });
});
