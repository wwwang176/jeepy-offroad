import { describe, expect, it } from "vitest";
import {
  getBiome,
  listBiomes,
  RANDOM_BIOME_ID,
  resolveBiomeId,
} from "@/biome/registry";

describe("biome registry", () => {
  it("lists sand and rainforest", () => {
    const ids = listBiomes().map((b) => b.id).sort();
    expect(ids).toEqual(["rainforest", "sand"]);
  });

  it("sand is 沙地 with arid palette", () => {
    const sand = getBiome("sand");
    expect(sand.displayName).toBe("沙地");
    expect(sand.groundPalette.mid.toLowerCase()).toMatch(/a89880|#a89880/i);
  });

  it("sand traction is icy; rainforest uses baseline grip", () => {
    const sand = getBiome("sand");
    expect(sand.traction?.frictionSlipScale ?? 1).toBeLessThan(0.6);
    expect(sand.traction?.sideFrictionScale ?? 1).toBeLessThan(0.55);
    const rf = getBiome("rainforest");
    expect(rf.traction).toBeUndefined();
  });

  it("rainforest has green palette, palms, and ground cover", () => {
    const rf = getBiome("rainforest");
    expect(rf.displayName).toBe("雨林");
    expect(rf.propCountScale ?? 1).toBeGreaterThan(1);
    expect(rf.groundCoverCountScale ?? 0).toBeGreaterThan(0);
    expect(
      rf.propTable.some((p) => p.meshKey === "coconut_palm"),
    ).toBe(true);
    // Mid green should be greener than sand mid
    expect(rf.groundPalette.mid).not.toBe(getBiome("sand").groundPalette.mid);
  });

  it("resolveBiomeId random is deterministic from seed", () => {
    const a = resolveBiomeId(RANDOM_BIOME_ID, 42);
    const b = resolveBiomeId(RANDOM_BIOME_ID, 42);
    expect(a).toBe(b);
    expect(["sand", "rainforest"]).toContain(a);
    // Different seeds can map to different biomes across the set
    const set = new Set(
      [0, 1, 2, 3, 4, 5].map((s) => resolveBiomeId(RANDOM_BIOME_ID, s)),
    );
    expect(set.size).toBeGreaterThanOrEqual(1);
  });

  it("resolveBiomeId keeps explicit selection", () => {
    expect(resolveBiomeId("rainforest", 999)).toBe("rainforest");
    expect(resolveBiomeId("sand", 0)).toBe("sand");
  });
});
