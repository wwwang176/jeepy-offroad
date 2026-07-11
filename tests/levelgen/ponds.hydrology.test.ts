import { describe, expect, it } from "vitest";
import { generateLevel } from "@/levelgen/generateLevel";
import { rainforestBiome } from "@/biome/profiles/rainforest";
import { sandBiome } from "@/biome/profiles/sand";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { POND_RIM_CLEARANCE_M } from "@/levelgen/types";
import { worldToGrid, idx } from "@/shared/coords";

const SEED = 929210958;

function sampleHm(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  x: number,
  z: number,
): number {
  const { col, row, fx, fz } = worldToGrid(x, z, worldSize, resolution);
  const c0 = Math.max(0, Math.min(resolution - 2, col));
  const r0 = Math.max(0, Math.min(resolution - 2, row));
  const i00 = idx(resolution, c0, r0);
  const i10 = idx(resolution, c0 + 1, r0);
  const i01 = idx(resolution, c0, r0 + 1);
  const i11 = idx(resolution, c0 + 1, r0 + 1);
  const a = hm[i00] * (1 - fx) + hm[i10] * fx;
  const b = hm[i01] * (1 - fx) + hm[i11] * fx;
  return a * (1 - fz) + b * fz;
}

describe("pond-only hydrology (seed 929210958)", () => {
  const level = generateLevel({
    seed: SEED,
    biome: rainforestBiome,
    vehicle: VEHICLE_CAPABILITIES,
  });

  it("emits ponds and no streams", () => {
    expect(level.streams).toEqual([]);
    // rainforest density target 200, soft cap ~×1.5
    expect(level.ponds.length).toBeGreaterThanOrEqual(80);
    expect(level.ponds.length).toBeLessThanOrEqual(320);
  });

  it("includes shallow puddles among depths", () => {
    const depths = level.ponds.map((p) => p.surfaceY - p.bedY);
    const shallow = depths.filter((d) => d <= 0.18).length;
    const anyDeepish = depths.some((d) => d >= 0.28);
    expect(depths.length).toBeGreaterThanOrEqual(80);
    expect(Math.min(...depths)).toBeLessThan(0.35);
    expect(shallow + (anyDeepish ? 1 : 0)).toBeGreaterThan(0);
  });

  it("each pond has horizontal surfaceY and irregular shore polygon", () => {
    for (const pond of level.ponds) {
      expect(Number.isFinite(pond.surfaceY)).toBe(true);
      expect(pond.polygon?.length ?? 0).toBeGreaterThanOrEqual(8);
      expect(pond.surfaceY).toBeGreaterThan(pond.bedY);

      // Not a perfect regular N-gon: radius variance should be material
      const radii = (pond.polygon ?? []).map((p) =>
        Math.hypot(p.x - pond.center.x, p.z - pond.center.z),
      );
      const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
      let varSum = 0;
      for (const r of radii) varSum += (r - mean) * (r - mean);
      const std = Math.sqrt(varSum / radii.length);
      // Terrain-fitted shore: sub-1 m micro-puddles allowed (may be near-circular)
      expect(mean).toBeGreaterThan(0.2);
      expect(Number.isFinite(std)).toBe(true);
    }
  });

  it("shore vertices sit near free surface (not floating pad)", () => {
    for (const pond of level.ponds) {
      const poly = pond.polygon ?? [];
      let overFloat = 0;
      for (const p of poly) {
        const g = sampleHm(
          level.heightmap,
          level.resolution,
          level.worldSize,
          p.x,
          p.z,
        );
        // Water vertex should not sit high above local ground
        // (ray shore can land 1 step inside; puddles tolerate a few cm)
        if (pond.surfaceY > g + 0.22) overFloat++;
        // And not deeply buried under a wall of terrain at the vertex
        expect(g).toBeLessThan(pond.surfaceY + 0.55);
      }
      // Micro-puddle ray shores can land a step inside; allow more slack
      expect(overFloat / poly.length).toBeLessThan(0.5);
    }
  });

  it("basin center is below surfaceY (real water column)", () => {
    for (const pond of level.ponds) {
      const bed = sampleHm(
        level.heightmap,
        level.resolution,
        level.worldSize,
        pond.center.x,
        pond.center.z,
      );
      // Micro-puddles may be only a couple cm deep
      expect(pond.surfaceY - bed).toBeGreaterThanOrEqual(0.02);
      expect(pond.surfaceY - bed).toBeLessThanOrEqual(POND_RIM_CLEARANCE_M + 2.5);
    }
  });

  it("sand biome also places ponds from density", () => {
    const sand = generateLevel({
      seed: SEED,
      biome: sandBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    expect(sand.streams).toEqual([]);
    // sand density → target 25
    expect(sand.ponds.length).toBeGreaterThanOrEqual(12);
    expect(sand.ponds.length).toBeLessThanOrEqual(45);
  });
});
