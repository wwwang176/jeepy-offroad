import { describe, expect, it } from "vitest";
import { generateLevel } from "@/levelgen/generateLevel";
import { validateLevel } from "@/levelgen/validate";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { forceFallbackLevel } from "@/levelgen/generateLevel";

describe("repair and fallback", () => {
  it("forceFallbackLevel is valid and sets usedFallback", () => {
    const level = forceFallbackLevel({
      seed: 99,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    expect(level.meta.usedFallback).toBe(true);
    const v = validateLevel(level, VEHICLE_CAPABILITIES);
    expect(v.ok, v.reasons.join("; ")).toBe(true);
  });

  it("generateLevel always returns ok validation", () => {
    for (const seed of [1, 42, 99991]) {
      const level = generateLevel({
        seed,
        biome: cliffsBiome,
        vehicle: VEHICLE_CAPABILITIES,
      });
      const v = validateLevel(level, VEHICLE_CAPABILITIES);
      expect(v.ok, `seed ${seed}: ${v.reasons.join("; ")}`).toBe(true);
    }
  });
});
