import { describe, expect, it } from "vitest";
import { generateLevel } from "@/levelgen/generateLevel";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { hashFloat32Array } from "@/shared/hash";

const FIXED_20 = [
  1, 2, 3, 5, 7, 11, 13, 17, 19, 23,
  42, 99, 256, 1024, 4096, 12345, 54321, 99991, 100000, 20260709,
];

describe("generateLevel reproducibility", () => {
  it("20 fixed seeds: heightmap hash and POIs match across two runs", () => {
    for (const seed of FIXED_20) {
      const input = { seed, biome: cliffsBiome, vehicle: VEHICLE_CAPABILITIES };
      const a = generateLevel(input);
      const b = generateLevel(input);
      expect(hashFloat32Array(a.heightmap), `hm seed ${seed}`).toBe(
        hashFloat32Array(b.heightmap),
      );
      expect(JSON.stringify(a.checkpoints), `cp seed ${seed}`).toBe(
        JSON.stringify(b.checkpoints),
      );
      expect(JSON.stringify(a.start), `start seed ${seed}`).toBe(
        JSON.stringify(b.start),
      );
      expect(JSON.stringify(a.finish), `finish seed ${seed}`).toBe(
        JSON.stringify(b.finish),
      );
      expect(JSON.stringify(a.pathPolyline), `path seed ${seed}`).toBe(
        JSON.stringify(b.pathPolyline),
      );
    }
  });
});
