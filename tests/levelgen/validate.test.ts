import { describe, expect, it } from "vitest";
import { validateLevel } from "@/levelgen/validate";
import { generateLevel } from "@/levelgen/generateLevel";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";

describe("validateLevel", () => {
  it("passes a generated level", () => {
    const level = generateLevel({
      seed: 7,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    expect(validateLevel(level, VEHICLE_CAPABILITIES).ok).toBe(true);
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

  it("fails when path ribbon too narrow", () => {
    const level = generateLevel({
      seed: 7,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    // Corrupt: force path polyline midpoints to map corner (off ribbon)
    const p = level.pathPolyline[Math.floor(level.pathPolyline.length / 2)];
    p.x = level.worldSize; // outside
    p.z = level.worldSize;
    expect(validateLevel(level, VEHICLE_CAPABILITIES).ok).toBe(false);
  });
});
