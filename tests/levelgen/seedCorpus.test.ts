import { describe, expect, it } from "vitest";
import { generateLevel } from "@/levelgen/generateLevel";
import { validateLevel } from "@/levelgen/validate";
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

describe("seed corpus GeometricSolvability", () => {
  it("fixed corpus seeds all validate", () => {
    for (const seed of FIXED_CORPUS) {
      const level = generateLevel({
        seed,
        biome: cliffsBiome,
        vehicle: VEHICLE_CAPABILITIES,
      });
      const v = validateLevel(level, VEHICLE_CAPABILITIES);
      expect(v.ok, `seed ${seed}: ${v.reasons.join("; ")}`).toBe(true);
    }
  });

  it("20 random seeds from meta-seed all validate", () => {
    for (const seed of RANDOM_20) {
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
