import { describe, expect, it } from "vitest";
import { generateLevel } from "@/levelgen/generateLevel";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { mulberry32 } from "@/levelgen/rng";

/** Spec §12: fixed seeds plus 20 random uint32 from fixed meta-seed. */
const FIXED_CORPUS = [1, 2, 7, 42, 99, 12345, 99991];

function randomSeedsFromMeta(metaSeed: number, count: number): number[] {
  const rng = mulberry32(metaSeed >>> 0);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push((rng() * 0x100000000) >>> 0);
  }
  return out;
}

const META_SEED = 20260709;
const RANDOM_20 = randomSeedsFromMeta(META_SEED, 20);

describe("seed corpus (generate only — no solvability gate)", () => {
  it("fixed corpus seeds all generate", () => {
    for (const seed of FIXED_CORPUS) {
      const level = generateLevel({
        seed,
        biome: cliffsBiome,
        vehicle: VEHICLE_CAPABILITIES,
      });
      expect(level.meta.usedFallback, `seed ${seed}`).toBe(false);
      expect(level.pathPolyline.length).toBeGreaterThan(2);
      expect(level.heightmap.length).toBe(level.resolution ** 2);
    }
  });

  it("20 random seeds from meta-seed all generate", () => {
    for (const seed of RANDOM_20) {
      const level = generateLevel({
        seed,
        biome: cliffsBiome,
        vehicle: VEHICLE_CAPABILITIES,
      });
      expect(level.meta.usedFallback, `seed ${seed}`).toBe(false);
      expect(level.pathPolyline.length).toBeGreaterThan(2);
    }
  });
});
