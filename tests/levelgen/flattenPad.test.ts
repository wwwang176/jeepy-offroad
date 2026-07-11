import { describe, expect, it } from "vitest";
import {
  createHeightmap,
  flattenDiskWithFalloff,
  sampleBilinear,
} from "@/levelgen/heightmap";
import { idx } from "@/shared/coords";
import { generateLevel } from "@/levelgen/generateLevel";
import { getBiome } from "@/biome/registry";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";

describe("flattenDiskWithFalloff", () => {
  it("sets interior cells to targetY", () => {
    const res = 64;
    const world = 128;
    const hm = createHeightmap(res, 10);
    // Uneven field
    for (let i = 0; i < hm.length; i++) hm[i] = 5 + (i % 7) * 0.3;

    flattenDiskWithFalloff(hm, res, world, { x: 0, z: 0 }, 4, 2, 12);

    expect(sampleBilinear(hm, res, world, 0, 0)).toBeCloseTo(12, 4);
    expect(sampleBilinear(hm, res, world, 1.5, 0)).toBeCloseTo(12, 4);
  });

  it("blends in falloff band and leaves far cells unchanged", () => {
    const res = 64;
    const world = 128;
    const hm = createHeightmap(res, 3);
    const farBefore = hm[idx(res, 2, 2)];

    flattenDiskWithFalloff(hm, res, world, { x: 0, z: 0 }, 3, 3, 20);

    const mid = sampleBilinear(hm, res, world, 4.5, 0); // in falloff ~3..6
    expect(mid).toBeGreaterThan(3);
    expect(mid).toBeLessThan(20);

    // Corner far from origin stays ~3
    const far = sampleBilinear(hm, res, world, 50, 50);
    expect(far).toBeCloseTo(farBefore, 5);
  });
});

describe("generateLevel start/finish pads", () => {
  it("flattens heightmap near start and finish", () => {
    const level = generateLevel({
      seed: 42,
      biome: getBiome("sand"),
      vehicle: VEHICLE_CAPABILITIES,
    });
    const { heightmap: hm, resolution: res, worldSize: ws } = level;
    const s = level.start.position;
    const f = level.finish.position;

    const yS0 = sampleBilinear(hm, res, ws, s.x, s.z);
    const yS1 = sampleBilinear(hm, res, ws, s.x + 2, s.z + 1);
    expect(Math.abs(yS1 - yS0)).toBeLessThan(0.15);

    const yF0 = sampleBilinear(hm, res, ws, f.x, f.z);
    const yF1 = sampleBilinear(hm, res, ws, f.x - 1.5, f.z + 1.5);
    expect(Math.abs(yF1 - yF0)).toBeLessThan(0.15);

    // Start/finish pose Y matches terrain
    expect(s.y).toBeCloseTo(yS0, 2);
    expect(f.y).toBeCloseTo(yF0, 2);
  });
});
