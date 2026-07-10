import { describe, expect, it } from "vitest";
import { validateLevel } from "@/levelgen/validate";
import { generateLevel } from "@/levelgen/generateLevel";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";

/**
 * validateLevel remains as an optional diagnostic tool; generateLevel no longer
 * gates on it. These tests only cover the pure validator on hand-broken levels.
 */
describe("validateLevel (diagnostic only)", () => {
  it("can still inspect a generated level", () => {
    const level = generateLevel({
      seed: 7,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    // May or may not be ok — must not throw
    const v = validateLevel(level, VEHICLE_CAPABILITIES);
    expect(typeof v.ok).toBe("boolean");
    expect(Array.isArray(v.reasons)).toBe(true);
  });

  it("fails when path empty", () => {
    const level = generateLevel({
      seed: 7,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    level.pathPolyline = [];
    expect(validateLevel(level, VEHICLE_CAPABILITIES).ok).toBe(false);
  });

  it("fails when path point leaves the map", () => {
    const level = generateLevel({
      seed: 7,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    const p = level.pathPolyline[Math.floor(level.pathPolyline.length / 2)];
    p.x = level.worldSize;
    p.z = level.worldSize;
    expect(validateLevel(level, VEHICLE_CAPABILITIES).ok).toBe(false);
  });
});
