import { describe, expect, it } from "vitest";
import { forceFallbackLevel, generateLevel } from "@/levelgen/generateLevel";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";

describe("generateLevel (no validate/repair gate)", () => {
  it("forceFallbackLevel only sets meta flag (mild carve)", () => {
    const level = forceFallbackLevel({
      seed: 99,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    expect(level.meta.usedFallback).toBe(true);
    expect(level.heightmap.length).toBe(level.resolution * level.resolution);
    expect(level.pathPolyline.length).toBeGreaterThan(2);
  });

  it("generateLevel always returns a level without repair/fallback", () => {
    for (const seed of [1, 42, 99991, 1082233287]) {
      const level = generateLevel({
        seed,
        biome: cliffsBiome,
        vehicle: VEHICLE_CAPABILITIES,
      });
      expect(level.meta.usedFallback).toBe(false);
      expect(level.meta.repairAttempts).toBe(0);
      expect(level.pathPolyline.length).toBeGreaterThan(2);
      expect(level.baseHeightmap.length).toBe(level.heightmap.length);
    }
  });
});
